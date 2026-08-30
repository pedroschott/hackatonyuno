export async function developerApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  const body = response.status === 204 ? null : ((await response.json()) as T & { error?: string });
  if (!response.ok) throw new Error(body?.error ?? response.statusText);
  return body as T;
}
