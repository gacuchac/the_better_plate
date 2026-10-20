import { lookup } from "node:dns";
import { request } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";

// Fetches a file from a link someone else supplied (a connected assistant's image link) without
// letting that link reach this server's own network: https only, every address the name resolves
// to is checked, the connection is pinned to the checked address, and each redirect is checked again.

const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [
  ["::", 128], ["::1", 128], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64],
  ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
] as const) blocked.addSubnet(net, prefix, "ipv6");

/** True only for globally routable unicast addresses. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  return !blocked.check(address, family === 4 ? "ipv4" : "ipv6");
}

export class PublicFetchError extends Error {}

const pinnedLookup: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { all: true }, (err, addresses) => {
    if (err) return callback(err, "", 0);
    const safe = addresses.find((a) => isPublicAddress(a.address));
    if (!safe || addresses.some((a) => !isPublicAddress(a.address))) {
      return callback(new PublicFetchError("That link points to a private address"), "", 0);
    }
    if (options.all) (callback as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [safe]);
    else callback(null, safe.address, safe.family);
  });
};

function checkUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new PublicFetchError("That isn't a valid link");
  }
  if (url.protocol !== "https:") throw new PublicFetchError("Only https links are accepted");
  if (url.username || url.password) throw new PublicFetchError("Links with sign-in details aren't accepted");
  if (url.port && url.port !== "443") throw new PublicFetchError("Only standard https links are accepted");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && !isPublicAddress(host)) throw new PublicFetchError("That link points to a private address");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || (!host.includes(".") && !isIP(host))) {
    throw new PublicFetchError("That link points to a private address");
  }
  return url;
}

function getOnce(url: URL, maxBytes: number, timeoutMs: number): Promise<{ status: number; location?: string; type: string; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      { method: "GET", lookup: pinnedLookup, agent: false, timeout: timeoutMs, headers: { accept: "image/*", "user-agent": "TheBetterPlate/1.0 (recipe photo upload)" } },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          return resolve({ status, location: res.headers.location, type: "", body: Buffer.alloc(0) });
        }
        const declared = Number(res.headers["content-length"] ?? 0);
        if (declared > maxBytes) {
          req.destroy();
          return reject(new PublicFetchError("That image is too large"));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            req.destroy();
            reject(new PublicFetchError("That image is too large"));
          } else chunks.push(chunk);
        });
        res.on("end", () => resolve({ status, type: String(res.headers["content-type"] ?? ""), body: Buffer.concat(chunks) }));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new PublicFetchError("The link took too long to answer")));
    req.on("error", (err) => reject(err instanceof PublicFetchError ? err : new PublicFetchError("Couldn't download from that link")));
    req.end();
  });
}

/** Downloads a public https file, following at most three redirects. */
export async function fetchPublicFile(raw: string, { maxBytes, timeoutMs = 15_000 }: { maxBytes: number; timeoutMs?: number }): Promise<{ type: string; body: Buffer }> {
  let url = checkUrl(raw);
  for (let hop = 0; hop <= 3; hop++) {
    const res = await getOnce(url, maxBytes, timeoutMs);
    if (res.status >= 300 && res.status < 400) {
      if (!res.location) throw new PublicFetchError("The link redirected nowhere");
      url = checkUrl(new URL(res.location, url).toString());
      continue;
    }
    if (res.status !== 200) throw new PublicFetchError(`The link answered ${res.status}`);
    return { type: res.type, body: res.body };
  }
  throw new PublicFetchError("The link redirected too many times");
}
