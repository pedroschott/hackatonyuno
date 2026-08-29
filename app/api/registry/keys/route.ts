import { registryPublicKey } from "@/lib/data";

export async function GET() {
  try {
    return Response.json({ algorithm: "Ed25519", public_key: registryPublicKey() }, {
      headers: { "cache-control": "public, max-age=3600" },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Registry key unavailable" }, { status: 503 });
  }
}
