import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Metric, UsageAdapter, UsageSnapshot } from "../../../core/types.ts";
import { safeError, sameOriginFetch } from "../../../core/security.ts";

const ANTHROPIC_API_ORIGIN = "https://api.anthropic.com";

interface StoredAuth {
  anthropic?: {
    type?: string;
    access?: string;
    refresh?: string;
    apiKey?: string;
    key?: string;
    expires?: number;
  };
}

async function resolveLocalAnthropicAuth(): Promise<{ token?: string | undefined; isOAuth: boolean; expires?: number | undefined }> {
  try {
    const authPath = join(getAgentDir(), "auth.json");
    const raw = await readFile(authPath, "utf8");
    const parsed = JSON.parse(raw) as StoredAuth;
    const anthropic = parsed.anthropic;
    if (anthropic) {
      const isOAuth = anthropic.type === "oauth" || !!anthropic.access;
      const token = anthropic.access || anthropic.apiKey || anthropic.key;
      return { token, isOAuth, expires: anthropic.expires };
    }
  } catch {
    // Ignore fallback errors
  }
  return { isOAuth: false };
}

export const anthropicAdapter: UsageAdapter = {
  id: "anthropic",
  label: "Anthropic Claude",
  canHandle(target) {
    const pid = target.providerId.toLowerCase();
    if (pid === "anthropic" || pid === "claude") return true;
    if (target.baseUrl) {
      try {
        const origin = new URL(target.baseUrl).origin;
        if (origin.includes("anthropic.com")) return true;
      } catch {
        return false;
      }
    }
    return false;
  },
  async fetch({ target, signal, fetchFn }): Promise<UsageSnapshot> {
    const fetchedAt = new Date().toISOString();
    const authRecord = target.auth?.auth as Record<string, unknown> | undefined;
    let token = (authRecord?.apiKey ?? authRecord?.access ?? authRecord?.key) as string | undefined;
    let isOAuth = false;
    let expires: number | undefined;

    if (!token) {
      const local = await resolveLocalAnthropicAuth();
      token = local.token;
      isOAuth = local.isOAuth;
      expires = local.expires;
    } else {
      const local = await resolveLocalAnthropicAuth();
      isOAuth = local.isOAuth;
      expires = local.expires;
    }

    if (!token) {
      return {
        adapterId: this.id,
        sourceProviderId: target.providerId,
        displayName: "Claude",
        state: "unauthorized",
        fetchedAt,
        accounts: [],
        error: "No API key or OAuth subscription found in Pi auth for Anthropic",
      };
    }

    try {
      // For Claude Pro / Max OAuth subscription accounts or API keys:
      // Send a lightweight headers probe to https://api.anthropic.com/v1/messages
      // This retrieves active rate-limit headers without consuming tokens or failing unexpectedly
      const headers: Record<string, string> = {
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      };

      if (isOAuth) {
        headers["authorization"] = `Bearer ${token}`;
      } else {
        headers["x-api-key"] = token;
      }

      const res = await sameOriginFetch(
        new URL("/v1/messages", ANTHROPIC_API_ORIGIN),
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: "claude-sonnet-4-6",
            messages: [{ role: "user", content: "" }],
            max_tokens: 1,
          }),
          signal,
        },
        fetchFn,
        ANTHROPIC_API_ORIGIN,
      );

      if (res.status === 401) {
        return {
          adapterId: this.id,
          sourceProviderId: target.providerId,
          displayName: "Claude",
          state: "unauthorized",
          fetchedAt,
          accounts: [],
          error: "Anthropic returned HTTP 401 Unauthorized (token or key expired)",
        };
      }

      // Check standard anthropic rate-limit headers
      const reqRemaining = res.headers.get("anthropic-ratelimit-requests-remaining");
      const reqLimit = res.headers.get("anthropic-ratelimit-requests-limit");
      const reqReset = res.headers.get("anthropic-ratelimit-requests-reset");
      const tokensRemaining = res.headers.get("anthropic-ratelimit-tokens-remaining");
      const tokensLimit = res.headers.get("anthropic-ratelimit-tokens-limit");
      const tokensReset = res.headers.get("anthropic-ratelimit-tokens-reset");

      const metrics: Metric[] = [];

      if (reqRemaining != null && reqLimit != null) {
        const remaining = Number(reqRemaining);
        const limit = Number(reqLimit);
        if (limit > 0) {
          const m: Metric = {
            kind: "quota-window",
            id: "claude-requests",
            label: "Claude Requests",
            remainingFraction: Math.max(0, Math.min(1, remaining / limit)),
            ...(reqReset ? { resetAt: reqReset } : {}),
          };
          metrics.push(m);
        }
      }

      if (tokensRemaining != null && tokensLimit != null) {
        const remaining = Number(tokensRemaining);
        const limit = Number(tokensLimit);
        if (limit > 0) {
          const m: Metric = {
            kind: "quota-window",
            id: "claude-tokens",
            label: "Claude Tokens",
            remainingFraction: Math.max(0, Math.min(1, remaining / limit)),
            ...(tokensReset ? { resetAt: tokensReset } : {}),
          };
          metrics.push(m);
        }
      }

      const planType = isOAuth ? "Subscription (Claude Pro/Max)" : "API Key";
      let summary = `Claude · ${isOAuth ? "Pro/Max" : "Active"}`;

      if (metrics.length > 0) {
        const primary = metrics[0]!;
        if (primary.kind === "quota-window") {
          summary = `Claude ${Math.round(primary.remainingFraction * 100)}%`;
        }
      }

      const statusMetric: Metric = {
        kind: "status",
        id: "claude-plan",
        label: "Plan",
        value: planType,
        detail: expires ? `Expires in ${Math.max(0, Math.round((expires - Date.now()) / 60000))}m` : "Active",
      };

      metrics.push(statusMetric);

      const accounts = [
        {
          id: isOAuth ? "claude-subscription" : "claude-api-key",
          provider: "anthropic",
          label: isOAuth ? "Claude Subscription" : "Claude API Account",
          status: "available" as const,
          metrics,
        },
      ];

      return {
        adapterId: this.id,
        sourceProviderId: target.providerId,
        displayName: "Claude",
        state: "ok",
        fetchedAt,
        summary,
        accounts,
      };
    } catch (error) {
      throw new Error(safeError(error));
    }
  },
};
