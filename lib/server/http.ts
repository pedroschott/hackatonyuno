import { NextResponse } from "next/server";
import { EngineError } from "@/lib/engine";
import { publicBaseUrl } from "./db";
import { loadAuthenticatedState, publicState } from "./state";

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function json(body: unknown, init: ResponseInit = {}) {
  return NextResponse.json(body, { ...init, headers: { ...CORS, "Cache-Control": "no-store", ...(init.headers ?? {}) } });
}

export function error(message: string, status = 400, extra: Record<string, unknown> = {}) {
  return json({ error: message, ...extra }, { status });
}

export function options() {
  return new Response(null, { status: 204, headers: CORS });
}

/** Wrap a handler: JSON-parse errors and EngineErrors become clean responses. */
export function handle(fn: () => Promise<Response> | Response) {
  return (async () => {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof EngineError) return error(e.message, e.status);
      if (e instanceof SyntaxError) return error("Invalid JSON body", 400);
      console.error(e);
      return error(e instanceof Error ? e.message : "Internal error", 500);
    }
  })();
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  const text = await req.text();
  if (!text.trim()) return {} as T;
  return JSON.parse(text) as T;
}

/** Shape returned to panels: full data + base url. */
export async function stateResponse(
  req?: Request,
  extra: Record<string, unknown> = {},
  options: { publicOnly?: boolean } = {},
) {
  let state = publicState();
  if (!options.publicOnly) {
    state = (await loadAuthenticatedState()).state;
  }
  return json({
    ...extra,
    state,
    public_base_url: publicBaseUrl(req),
    server_time: new Date().toISOString(),
  });
}

export function mandateLinks(base: string, id: string) {
  return {
    approval_url: `${base}/m/mandates/${id}`,
    status_url: `${base}/api/mandates/${id}/status`,
    mandate_url: `${base}/api/mandates/${id}`,
  };
}
