const SENSITIVE_KEYS = /authorization|api[-_]?key|token|secret|password/i;

export function normalizeOrigin(baseUrl: string): URL | undefined {
  try {
    return new URL(baseUrl);
  } catch {
    return undefined;
  }
}

export function bridgeUrl(baseUrl: string, path: "capabilities" | "usage", force = false): URL {
  const base = new URL(baseUrl);
  const result = new URL(`/v0/resource/plugins/pi-bridge/${path}`, base.origin);
  if (force && path === "usage") result.searchParams.set("refresh", "1");
  return result;
}

export async function sameOriginFetch(
  url: URL,
  init: RequestInit,
  fetchFn: typeof fetch,
  expectedOrigin: string,
  redirects = 0,
): Promise<Response> {
  if (url.origin !== expectedOrigin) throw new Error("Refusing to send credentials across origins");
  const response = await fetchFn(url, { ...init, redirect: "manual" });
  if (response.status >= 300 && response.status < 400) {
    if (redirects >= 3) throw new Error("Too many redirects");
    const location = response.headers.get("location");
    if (!location) return response;
    const next = new URL(location, url);
    if (next.origin !== expectedOrigin) throw new Error("Refusing cross-origin authenticated redirect");
    return sameOriginFetch(next, init, fetchFn, expectedOrigin, redirects + 1);
  }
  return response;
}

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SENSITIVE_KEYS.test(key) ? "[REDACTED]" : redact(item)]));
  }
  return value;
}

export function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]").replace(/sk-[A-Za-z0-9_-]+/g, "sk-…");
}
