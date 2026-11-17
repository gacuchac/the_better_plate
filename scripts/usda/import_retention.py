#!/usr/bin/env python3
"""Import the USDA Table of Nutrient Retention Factors, Release 6 (2007).

Retention factors say how much of a nutrient is left after a food is cooked a
given way (for example vitamin C in leafy vegetables boiled and drained). The
app applies them to raw ingredients that a recipe cooks (ADR-014).

Nothing is guessed: every factor is copied as published by USDA ARS (Nutrient
Data Laboratory). The file is public domain. Writes
data/catalog/retention-factors.json with a hash of the source file.

Usage:
  python3 scripts/usda/import_retention.py           # download and normalize
  python3 scripts/usda/import_retention.py --check   # verify the snapshot offline

Cloud sessions can't reach USDA hosts; the "USDA retention import" workflow
runs this on GitHub Actions and commits the snapshot. Stdlib only.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import sys
import urllib.request
import zipfile
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT_FILE = ROOT / "data" / "catalog" / "retention-factors.json"

ARS_BASE = "https://www.ars.usda.gov/ARSUserFiles/80400525/Data/retn/"
LANDING = (
    "https://www.ars.usda.gov/northeast-area/beltsville-md-bhnrc/beltsville-human-nutrition-research-center/"
    "methods-and-application-of-food-composition-laboratory/mafcl-site-pages/nutrient-retention-factors/"
)
CANDIDATES = [ARS_BASE + name for name in ("retn06.txt", "retn06.zip", "Retn06.txt", "RETN06.txt", "retn6.txt")]
CITATION = (
    "U.S. Department of Agriculture, Agricultural Research Service. 2007. USDA Table of Nutrient Retention "
    "Factors, Release 6. Nutrient Data Laboratory."
)
UA = {"User-Agent": "the-better-plate-catalog-import/1.0"}
# Release 6 has about 290 cooking codes; far fewer means a wrong or truncated file.
MIN_CODES = 200


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read()


class Links(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.hrefs: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            for k, v in attrs:
                if k == "href" and v:
                    self.hrefs.append(v)


def discover() -> list[str]:
    """Links on the ARS retention page that look like the data file."""
    try:
        html = fetch(LANDING).decode("utf-8", "replace")
    except Exception as err:  # noqa: BLE001
        print(f"landing page: {err}", file=sys.stderr)
        return []
    parser = Links()
    parser.feed(html)
    found = []
    for href in parser.hrefs:
        if re.search(r"retn", href, re.I) and re.search(r"\.(txt|zip)$", href, re.I):
            found.append(urllib.request.urljoin(LANDING, href))
    print("landing page links:", found or [h for h in parser.hrefs if "retn" in h.lower()], file=sys.stderr)
    return found


def text_files(blob: bytes, url: str) -> list[tuple[str, str]]:
    if blob[:2] == b"PK":
        out = []
        with zipfile.ZipFile(io.BytesIO(blob)) as z:
            print(f"{url} zip members: {z.namelist()}", file=sys.stderr)
            for name in z.namelist():
                if name.lower().endswith(".txt"):
                    out.append((name, z.read(name).decode("latin-1")))
        return out
    return [(url, blob.decode("latin-1"))]


def parse(text: str) -> list[dict]:
    """SR-style rows: fields split by ^, text wrapped in ~."""
    rows = []
    for line in text.splitlines():
        if "^" not in line:
            continue
        fields = [f.strip().strip("~").strip() for f in line.split("^")]
        rows.append(fields)
    return rows


def normalize(rows: list[list[str]]) -> dict:
    """Release 6 rows: retention code, food group code, description, nutrient number, nutrient name, retention %, date."""
    codes: dict[str, dict] = {}
    nutrients: dict[str, str] = {}
    for f in rows:
        if len(f) < 6 or not f[0].isdigit() or not f[3].isdigit():
            continue
        code, group, desc, nutr_no, nutr_name, amount = f[0], f[1], f[2], f[3], f[4], f[5]
        try:
            value = float(amount)
        except ValueError:
            continue
        entry = codes.setdefault(code, {"code": int(code), "foodGroup": group, "description": desc, "retention": {}})
        entry["retention"][nutr_no] = value
        nutrients[nutr_no] = nutr_name
    return {
        "nutrients": [{"nutrNo": int(k), "name": v} for k, v in sorted(nutrients.items(), key=lambda kv: int(kv[0]))],
        "factors": sorted(codes.values(), key=lambda e: e["code"]),
    }


def content_hash(data: dict) -> str:
    body = json.dumps({"nutrients": data["nutrients"], "factors": data["factors"]}, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(body.encode()).hexdigest()


def run() -> int:
    urls = CANDIDATES + discover()
    for url in urls:
        try:
            blob = fetch(url)
        except Exception as err:  # noqa: BLE001
            print(f"{url}: {err}", file=sys.stderr)
            continue
        for name, text in text_files(blob, url):
            print(f"{name}: first lines:\n" + "\n".join(text.splitlines()[:5]), file=sys.stderr)
            data = normalize(parse(text))
            if len(data["factors"]) < MIN_CODES:
                print(f"{name}: only {len(data['factors'])} codes, skipping", file=sys.stderr)
                continue
            snapshot = {
                "schema": "betterplate.retention/1",
                "retrievedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "source": {
                    "name": "USDA Table of Nutrient Retention Factors, Release 6 (2007)",
                    "publisher": "U.S. Department of Agriculture, Agricultural Research Service, Nutrient Data Laboratory",
                    "url": url,
                    "fileSha256": hashlib.sha256(blob).hexdigest(),
                    "citation": CITATION,
                    "license": "Public domain (U.S. Government work)",
                    "units": "Percent of the raw food's nutrient left after cooking",
                },
                **data,
            }
            snapshot["contentSha256"] = content_hash(snapshot)
            OUT_FILE.write_text(json.dumps(snapshot, indent=1, ensure_ascii=False) + "\n")
            print(f"Wrote {OUT_FILE.relative_to(ROOT)}: {len(data['factors'])} codes, {len(data['nutrients'])} nutrients")
            return 0
    print("No usable retention factor file found", file=sys.stderr)
    return 1


def check() -> int:
    data = json.loads(OUT_FILE.read_text())
    if data.get("schema") != "betterplate.retention/1":
        print("bad schema", file=sys.stderr)
        return 1
    if content_hash(data) != data.get("contentSha256"):
        print("content hash mismatch", file=sys.stderr)
        return 1
    if len(data["factors"]) < MIN_CODES:
        print("too few codes", file=sys.stderr)
        return 1
    for f in data["factors"]:
        for v in f["retention"].values():
            if not 0 <= v <= 200:
                print(f"implausible factor {v} in code {f['code']}", file=sys.stderr)
                return 1
    print(f"OK: {len(data['factors'])} codes")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    sys.exit(check() if args.check else run())
