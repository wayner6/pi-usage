export function isUrlOnDomain(value: string, domain: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    const expected = domain.toLowerCase();
    return hostname === expected || hostname.endsWith(`.${expected}`);
  } catch {
    return false;
  }
}

export function bridgeUsageUrl(baseUrl: string, force = false): URL {
  const base = new URL(baseUrl);
  const result = new URL("/v0/resource/plugins/pi-bridge/usage", base.origin);
  if (force) result.searchParams.set("refresh", "1");
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

export function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]").replace(/sk-[A-Za-z0-9_-]+/g, "sk-…");
}
