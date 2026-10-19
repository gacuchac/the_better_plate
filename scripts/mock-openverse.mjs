// Stand-in for the Openverse image API, for automated tests only (labeled test fixtures, not real photos).
// Matches like a strict search: every word of q must appear in the title or tags.
// Usage: node scripts/mock-openverse.mjs <port>   or   import { startMockOpenverse } from "./mock-openverse.mjs"
import { createServer } from "node:http";
import { crc32, deflateSync } from "node:zlib";

const FIXTURES = [
  { id: "11111111-1111-4111-8111-111111111111", title: "Test fixture: grilled chicken breast", tags: ["chicken", "grilled", "dinner"], license: "by", license_version: "2.0", creator: "Fixture Photographer", provider: "flickr", color: [0xc8, 0x9b, 0x6a] },
  { id: "22222222-2222-4222-8222-222222222222", title: "Test fixture: lemon chicken with rice", tags: ["lemon", "chicken", "rice"], license: "cc0", license_version: "1.0", creator: null, provider: "wikimedia", color: [0xe6, 0xd2, 0x8a] },
  { id: "33333333-3333-4333-8333-333333333333", title: "Test fixture: chicken salad (non-commercial)", tags: ["chicken", "salad"], license: "by-nc", license_version: "4.0", creator: "Excluded", provider: "flickr", color: [0x80, 0xa0, 0x60] },
  { id: "44444444-4444-4444-8444-444444444444", title: "Test fixture: steamed broccoli", tags: ["broccoli", "steamed", "vegetable"], license: "by-sa", license_version: "4.0", creator: "<a href='x'>Fixture</a> Cook", provider: "wikimedia", color: [0x5a, 0x8a, 0x4a] },
];

function png([r, g, b], w = 96, h = 64) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [r, g, b]).flat())]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))), chunk("IEND", Buffer.alloc(0))]);
}

function toApi(f, base) {
  return {
    id: f.id,
    title: f.title,
    creator: f.creator,
    license: f.license,
    license_version: f.license_version,
    license_url: `https://creativecommons.org/licenses/${f.license}/${f.license_version}/`,
    foreign_landing_url: `https://example.org/photo/${f.id}`,
    url: `https://example.org/full/${f.id}.jpg`,
    thumbnail: `${base}/v1/images/${f.id}/thumb/`,
    provider: f.provider,
    source: f.provider,
    width: 1200,
    height: 800,
    mature: false,
    tags: f.tags.map((name) => ({ name })),
  };
}

export function startMockOpenverse(port = 0) {
  const queries = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const base = `http://localhost:${server.address().port}`;
    const m = /^\/v1\/images\/(?:([0-9a-f-]{36})\/(thumb\/)?)?$/.exec(url.pathname);
    if (!m) return res.writeHead(404).end();
    const [, id, thumb] = m;
    if (!id) {
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      queries.push(q);
      const words = q.split(/\s+/).filter(Boolean);
      const results = FIXTURES.filter((f) => words.every((w) => `${f.title} ${f.tags.join(" ")}`.toLowerCase().includes(w))).map((f) => toApi(f, base));
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ result_count: results.length, results }));
    }
    const f = FIXTURES.find((x) => x.id === id);
    if (!f) return res.writeHead(404).end();
    if (thumb) {
      res.writeHead(200, { "content-type": "image/png" });
      return res.end(png(f.color));
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(toApi(f, base)));
  });
  return new Promise((resolve) => server.listen(port, () => resolve({ url: `http://localhost:${server.address().port}`, queries, close: () => server.close() })));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { url } = await startMockOpenverse(Number(process.argv[2] ?? 4197));
  console.log(`mock Openverse on ${url}`);
}
