import fs from "node:fs";
import path from "node:path";

const DIR = path.join(process.cwd(), ".data");

/** Public base URL for links handed to phones/agents: env → tunnel file → request host. */
export function publicBaseUrl(req?: Request): string {
  if (process.env.AGENTPAY_BASE_URL) {
    const configured = process.env.AGENTPAY_BASE_URL.replace(/\/$/, "");
    if (req) {
      const configuredUrl = new URL(configured);
      const requestUrl = new URL(req.url);
      const localHosts = new Set(["localhost", "127.0.0.1"]);
      if (localHosts.has(configuredUrl.hostname) && localHosts.has(requestUrl.hostname)) {
        return requestUrl.origin;
      }
    }
    return configured;
  }
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, "");
  try {
    const f = path.join(DIR, "public-url.txt");
    if (fs.existsSync(f)) {
      const u = fs.readFileSync(f, "utf8").trim();
      if (u) return u.replace(/\/$/, "");
    }
  } catch {}
  if (req) {
    const h = req.headers;
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3210";
    const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") || host.startsWith("192.168.") ? "http" : "https");
    return `${proto}://${host}`;
  }
  return "http://localhost:3210";
}
