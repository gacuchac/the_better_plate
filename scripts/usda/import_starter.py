#!/usr/bin/env python3
"""Build the versioned starter food catalog from USDA FoodData Central.

Reads exact SR Legacy descriptions from starter_foods.txt, resolves each to an
FDC ID through the official search API (exact case-insensitive match only),
fetches full records in batches and writes a normalized, source-attributed
snapshot to data/catalog/starter-catalog.json plus a human-readable report.

Nothing is guessed: descriptions without an exact match are listed in the
report and left out. Values are copied from USDA per 100 g as published.

Usage:
  python3 scripts/usda/import_starter.py            # uses USDA_FDC_API_KEY / USDA_API_KEY / DEMO_KEY
  python3 scripts/usda/import_starter.py --check    # verify snapshot integrity offline

Stdlib only, so it runs anywhere Python 3.10+ exists.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LIST_FILE = Path(__file__).with_name("starter_foods.txt")
OUT_FILE = ROOT / "data" / "catalog" / "starter-catalog.json"
REPORT_FILE = ROOT / "data" / "catalog" / "IMPORT_REPORT.md"

DATA_TYPE = "SR Legacy"
BATCH_SIZE = 20
FDP_SUFFIX = "(Includes foods for USDA's Food Distribution Program)"

# Nutrients carried into the catalog, keyed by FDC nutrient id.
# key: stable app nutrient key; FDC ids are the official identifiers.
TRACKED_NUTRIENTS = [
    # (app key, FDC nutrient id, display name, unit)
    ("energy_kcal", 1008, "Energy", "kcal"),
    ("protein", 1003, "Protein", "g"),
    ("fat_total", 1004, "Total fat", "g"),
    ("fat_saturated", 1258, "Saturated fat", "g"),
    ("carbohydrate", 1005, "Carbohydrate", "g"),
    ("fiber", 1079, "Fiber", "g"),
    ("sugars_total", 2000, "Total sugars", "g"),
    ("cholesterol", 1253, "Cholesterol", "mg"),
    ("sodium", 1093, "Sodium", "mg"),
    ("potassium", 1092, "Potassium", "mg"),
    ("calcium", 1087, "Calcium", "mg"),
    ("iron", 1089, "Iron", "mg"),
    ("magnesium", 1090, "Magnesium", "mg"),
    ("zinc", 1095, "Zinc", "mg"),
    ("vitamin_c", 1162, "Vitamin C", "mg"),
    ("vitamin_a_rae", 1106, "Vitamin A (RAE)", "µg"),
    ("vitamin_d", 1114, "Vitamin D (D2 + D3)", "µg"),
    ("vitamin_b12", 1178, "Vitamin B12", "µg"),
    ("folate_dfe", 1190, "Folate (DFE)", "µg"),
]
FDC_UNIT_ALIASES = {"KCAL": "kcal", "G": "g", "MG": "mg", "UG": "µg", "µG": "µg"}


def api_key() -> tuple[str, str]:
    for name in ("USDA_FDC_API_KEY", "USDA_API_KEY"):
        value = os.environ.get(name, "").strip()
        if value:
            return value, name
    return "DEMO_KEY", "DEMO_KEY"


def base_url() -> str:
    return os.environ.get("USDA_FDC_API_BASE_URL", "https://api.nal.usda.gov/fdc/v1").rstrip("/")


class ApiError(Exception):
    pass


def post_json(path: str, body: dict, key: str, attempts: int = 4) -> object:
    url = f"{base_url()}{path}?api_key={key}"
    data = json.dumps(body).encode()
    for attempt in range(attempts):
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.load(resp)
        except urllib.error.HTTPError as err:
            if err.code in (429, 500, 502, 503, 504) and attempt < attempts - 1:
                time.sleep(2 ** (attempt + 1))
                continue
            # Never echo the URL: it carries the API key.
            detail = err.read(300).decode("utf-8", "replace")
            raise ApiError(f"USDA API {path} failed with HTTP {err.code}: {detail}") from None
        except urllib.error.URLError as err:
            if attempt < attempts - 1:
                time.sleep(2 ** (attempt + 1))
                continue
            raise SystemExit(f"USDA API {path} unreachable: {err.reason}") from None
    raise AssertionError("unreachable")


def read_list() -> list[str]:
    names = []
    for line in LIST_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            names.append(line)
    if len(names) != len({n.lower() for n in names}):
        raise SystemExit("starter_foods.txt has duplicate entries")
    return names


def search_terms(name: str) -> str:
    """Search query without Lucene syntax characters; the exact match uses the original."""
    return re.sub(r"\s+", " ", re.sub(r"[()/%+\-:!\"\[\]{}^~*?\\&|,]", " ", name)).strip()


def resolve(names: list[str], key: str) -> tuple[dict[str, int], dict[str, list[str]]]:
    found: dict[str, int] = {}
    misses: dict[str, list[str]] = {}
    for name in names:
        try:
            result = post_json(
                "/foods/search",
                {"query": search_terms(name), "dataType": [DATA_TYPE], "pageSize": 50},
                key,
            )
        except ApiError as err:
            misses[name] = [f"search error: {err}"]
            continue
        foods = result.get("foods", []) if isinstance(result, dict) else []
        # USDA tags some standard entries with the Food Distribution Program note; same food.
        wanted = {name.lower(), f"{name} {FDP_SUFFIX}".lower()}
        exact = [f for f in foods if f.get("description", "").strip().lower() in wanted]
        if exact:
            found[name] = int(exact[0]["fdcId"])
        else:
            misses[name] = [f.get("description", "") for f in foods[:5]]
    return found, misses


def normalize(food: dict, retrieved_at: str) -> dict:
    by_id = {}
    for fn in food.get("foodNutrients", []):
        nutrient = fn.get("nutrient") or {}
        nid = nutrient.get("id")
        if nid is not None and fn.get("amount") is not None:
            by_id[int(nid)] = (float(fn["amount"]), nutrient.get("unitName", ""))

    nutrients = {}
    for key, nid, _name, unit in TRACKED_NUTRIENTS:
        if nid in by_id:
            amount, fdc_unit = by_id[nid]
            got_unit = FDC_UNIT_ALIASES.get(fdc_unit.upper(), fdc_unit)
            if got_unit != unit:
                raise SystemExit(f"Unit mismatch for fdcId {food['fdcId']} nutrient {nid}: {fdc_unit}")
            nutrients[key] = amount
        # Missing nutrients are omitted on purpose: not reported is not zero.

    portions = []
    for p in sorted(food.get("foodPortions", []), key=lambda p: p.get("sequenceNumber") or 0):
        grams = p.get("gramWeight")
        if not grams:
            continue
        unit = (p.get("measureUnit") or {}).get("name") or ""
        label = " ".join(
            str(part).strip()
            for part in (p.get("amount"), unit if unit and unit != "undetermined" else "", p.get("modifier") or p.get("portionDescription") or "")
            if part not in (None, "")
        ).strip()
        portions.append({"label": label, "gramWeight": float(grams)})

    fdc_id = int(food["fdcId"])
    return {
        "id": f"fdc:{fdc_id}",
        "fdcId": fdc_id,
        "description": food["description"],
        "dataType": food.get("dataType", DATA_TYPE),
        "category": (food.get("foodCategory") or {}).get("description"),
        "ndbNumber": food.get("ndbNumber"),
        "publicationDate": food.get("publicationDate"),
        "nutrientsPer100g": nutrients,
        "portions": portions,
        "source": {
            "publisher": "U.S. Department of Agriculture, Agricultural Research Service, FoodData Central",
            "dataset": DATA_TYPE,
            "url": f"https://fdc.nal.usda.gov/food-details/{fdc_id}/nutrients",
            "retrievedAt": retrieved_at,
            "license": "Public domain (CC0 1.0), per FoodData Central",
        },
    }


def content_hash(foods: list[dict]) -> str:
    stable = [{k: v for k, v in f.items() if k != "source"} | {"source": {k: v for k, v in f["source"].items() if k != "retrievedAt"}} for f in foods]
    return hashlib.sha256(json.dumps(stable, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def build() -> None:
    key, key_source = api_key()
    names = read_list()
    print(flush=True)
    print(f"Resolving {len(names)} descriptions against FDC {DATA_TYPE} (key: {key_source})", flush=True)
    found, misses = resolve(names, key)

    retrieved_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    ids = sorted(set(found.values()))
    foods: list[dict] = []
    for i in range(0, len(ids), BATCH_SIZE):
        batch = post_json("/foods", {"fdcIds": ids[i : i + BATCH_SIZE], "format": "full"}, key)
        foods.extend(normalize(f, retrieved_at) for f in batch)
    foods.sort(key=lambda f: f["description"].lower())

    digest = content_hash(foods)
    previous = json.loads(OUT_FILE.read_text()) if OUT_FILE.exists() else None
    if previous and previous.get("contentSha256") == digest:
        print("USDA content unchanged; keeping existing snapshot and version.")
        version = previous["version"]
        retrieved_at = previous["retrievedAt"]
        foods = previous["foods"]
    else:
        version = f"usda-sr-legacy-{retrieved_at[:10]}-{digest[:8]}"

    snapshot = {
        "schema": "betterplate.catalog/1",
        "version": version,
        "retrievedAt": retrieved_at,
        "source": {
            "name": "USDA FoodData Central",
            "dataset": DATA_TYPE,
            "api": base_url(),
            "citation": "U.S. Department of Agriculture, Agricultural Research Service. FoodData Central. fdc.nal.usda.gov",
        },
        "nutrients": [
            {"key": k, "fdcNutrientId": nid, "name": name, "unit": unit} for k, nid, name, unit in TRACKED_NUTRIENTS
        ],
        "contentSha256": digest,
        "foods": foods,
    }
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(json.dumps(snapshot, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")

    lines = [
        "# Starter catalog import report",
        "",
        f"- Version: `{version}`",
        f"- Retrieved: {retrieved_at}",
        f"- Dataset: USDA FoodData Central, {DATA_TYPE}",
        f"- Requested: {len(names)}; imported: {len(foods)}; unmatched: {len(misses)}",
        "",
        "Generated by `scripts/usda/import_starter.py`. Do not edit by hand.",
        "",
    ]
    if misses:
        lines += ["## Unmatched descriptions (left out, not guessed)", ""]
        for name, suggestions in misses.items():
            lines.append(f"- `{name}`")
            for s in suggestions:
                lines.append(f"  - candidate: {s}")
        lines.append("")
    missing_counts = {k: sum(1 for f in foods if k not in f["nutrientsPer100g"]) for k, *_ in TRACKED_NUTRIENTS}
    lines += ["## Nutrient coverage (foods without a reported value)", ""]
    lines += [f"- {k}: {n}" for k, n in missing_counts.items()]
    REPORT_FILE.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Wrote {len(foods)} foods to {OUT_FILE.relative_to(ROOT)}; {len(misses)} unmatched (see report)")


def check() -> None:
    snapshot = json.loads(OUT_FILE.read_text(encoding="utf-8"))
    assert snapshot["schema"] == "betterplate.catalog/1"
    assert content_hash(snapshot["foods"]) == snapshot["contentSha256"], "content hash mismatch"
    ids = [f["fdcId"] for f in snapshot["foods"]]
    assert len(ids) == len(set(ids)), "duplicate fdcId"
    print(f"OK {snapshot['version']}: {len(ids)} foods")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true", help="verify the committed snapshot offline")
    args = parser.parse_args()
    try:
        check() if args.check else build()
    except ApiError as err:
        raise SystemExit(str(err)) from None
