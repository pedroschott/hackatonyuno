import fs from "node:fs";
import path from "node:path";
import { seedData, type Data } from "@/lib/engine";

const DIR = path.join(process.cwd(), ".data");
const FILE = path.join(DIR, "state.json");

type G = typeof globalThis & { __agentpayDb?: Data };
const g = globalThis as G;

function load(): Data {
  try {
    if (fs.existsSync(FILE)) return JSON.parse(fs.readFileSync(FILE, "utf8")) as Data;
  } catch (e) {
    console.warn("[agentpay] could not read state file, reseeding", e);
  }
  const d = seedData();
  persist(d);
  return d;
}

function persist(d: Data) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(d));
  } catch (e) {
    console.warn("[agentpay] could not persist state", e);
  }
}

export function getData(): Data {
  if (!g.__agentpayDb) g.__agentpayDb = load();
  return g.__agentpayDb;
}

/** Apply a pure engine transition and persist. Serialized by Node's single thread. */
export function mutate<R>(fn: (d: Data) => [Data, R]): R {
  const [next, result] = fn(getData());
  g.__agentpayDb = next;
  persist(next);
  return result;
}

export function resetData(): Data {
  const d = seedData();
  g.__agentpayDb = d;
  persist(d);
  return d;
}

/** Public base URL for links handed to phones/agents: env → tunnel file → request host. */
export function publicBaseUrl(req?: Request): string {
  if (process.env.AGENTPAY_BASE_URL) return process.env.AGENTPAY_BASE_URL.replace(/\/$/, "");
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
