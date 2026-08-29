import { stateResponse, options } from "@/lib/server/http";
export const OPTIONS = options;
export async function GET(req: Request) {
  try {
    return await stateResponse(req);
  } catch {
    return stateResponse(req, {}, { publicOnly: true });
  }
}
