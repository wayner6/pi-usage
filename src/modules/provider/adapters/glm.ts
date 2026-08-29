import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Metric, UsageAdapter, UsageSnapshot } from "../../../core/types.ts";
import { safeError, sameOriginFetch } from "../../../core/security.ts";

const BIGMODEL_API_ORIGIN = "https://open.bigmodel.cn";
const ZAI_API_ORIGIN = "https://api.z.ai";

interface StoredAuth {
  [key: string]: {
    type?: string;
    apiKey?: string;
    key?: string;
  };
}

interface QuotaLimitResponse {
  code: number;
  msg?: string;
  success?: boolean;
  data?: {
    level?: string;
    limits?: Array<{
      type: string;
      percentage: number;
      nextResetTime?: number;
      currentValue?: number;
      usage?: number;
      remaining?: number;
    }>;
  };
}

async function resolveLocalGLMAuth(): Promise<string | undefined> {
  try {
    const authPath = join(getAgentDir(), "auth.json");
    const raw = await readFile(authPath, "utf8");
    const parsed = JSON.parse(raw) as StoredAuth;
    const candidates = [
      parsed.glm,
      parsed["zai-coding-cn"],
      parsed.zai,
      parsed.zhipu,
      parsed.bigmodel,
    ];
    for (const item of candidates) {
      if (item) {
        const key = item.apiKey || item.key;
        if (key) return key;
      }
    }
  } catch {
    // Ignore fallback errors
  }
  return undefined;
}

export const glmAdapter: UsageAdapter = {
  id: "glm",
  label: "GLM / 智谱 BigModel",
  canHandle(target) {
    const pid = target.providerId.toLowerCase();
    if (
      pid === "glm" ||
      pid === "zhipu" ||
      pid === "bigmodel" ||
      pid === "zai" ||
      pid === "zai-coding-cn"
    ) {
      return true;
    }
    if (target.baseUrl) {
      try {
        const host = new URL(target.baseUrl).host;
        if (host.includes("bigmodel.cn") || host.includes("z.ai")) return true;
      } catch {
        return false;
      }
    }
    return false;
  },
  async fetch({ target, signal, fetchFn }): Promise<UsageSnapshot> {
    const fetchedAt = new Date().toISOString();
    const authRecord = target.auth?.auth as Record<string, unknown> | undefined;
    let apiKey = (authRecord?.apiKey ?? authRecord?.key) as string | undefined;

    if (!apiKey) {
      apiKey = await resolveLocalGLMAuth();
    }

    if (!apiKey) {
      return {
        adapterId: this.id,
        sourceProviderId: target.providerId,
        displayName: "GLM",
        state: "unauthorized",
        fetchedAt,
        accounts: [],
        error: "No API key found in Pi auth for GLM / Zhipu",
      };
    }

    try {
      // Determine base URL: choose between open.bigmodel.cn or api.z.ai based on target.baseUrl
      const isZai = target.baseUrl?.includes("api.z.ai");
      const baseOrigin = isZai ? ZAI_API_ORIGIN : BIGMODEL_API_ORIGIN;

      // 1. Priority: Query official GLM Coding Plan usage quota limit endpoint
      // GET /api/monitor/usage/quota/limit
      // Authorization: <apiKey> (or Bearer <apiKey>)
      try {
        const quotaRes = await sameOriginFetch(
          new URL("/api/monitor/usage/quota/limit", baseOrigin),
          {
            method: "GET",
            headers: {
              Authorization: apiKey,
              Accept: "application/json",
            },
            signal,
          },
          fetchFn,
          baseOrigin,
        );

        if (quotaRes.ok) {
          const quotaJson = (await quotaRes.json()) as QuotaLimitResponse;
          if (quotaJson.success && quotaJson.data?.limits) {
            const limits = quotaJson.data.limits;
            const tokenLimits = limits
              .filter((l) => l.type === "TOKENS_LIMIT")
              .sort((a, b) => (a.nextResetTime ?? 0) - (b.nextResetTime ?? 0));

            const metrics: Metric[] = [];
            const planLevel = quotaJson.data.level ? quotaJson.data.level.toUpperCase() : "Coding Plan";

            // Multi-window tokens limit (e.g. 5h and weekly/7d)
            if (tokenLimits.length > 0) {
              tokenLimits.forEach((tl, idx) => {
                const label = idx === 0 ? "GLM 5h" : "GLM 7d";
                const used = Math.max(0, Math.min(100, tl.percentage));
                const remainingFraction = (100 - used) / 100;
                const resetAt = tl.nextResetTime ? new Date(tl.nextResetTime).toISOString() : undefined;
                metrics.push({
                  kind: "quota-window",
                  id: `glm-window-${idx}`,
                  label,
                  remainingFraction,
                  ...(resetAt ? { resetAt } : {}),
                });
              });
            }

            // MCP monthly limit
            const mcp = limits.find((l) => l.type === "TIME_LIMIT");
            if (mcp && mcp.usage && mcp.usage > 0) {
              const remaining = mcp.remaining ?? (mcp.usage - (mcp.currentValue ?? 0));
              metrics.push({
                kind: "quota-window",
                id: "glm-mcp",
                label: "MCP Monthly",
                remainingFraction: Math.max(0, Math.min(1, remaining / mcp.usage)),
                detail: `${mcp.currentValue ?? 0}/${mcp.usage}`,
              });
            }

            metrics.push({
              kind: "status",
              id: "glm-plan-level",
              label: "Plan",
              value: planLevel,
            });

            // Format summary
            let summary = `GLM · ${planLevel}`;
            if (metrics.length > 0 && metrics[0]!.kind === "quota-window") {
              const parts = metrics
                .filter((m): m is Extract<Metric, { kind: "quota-window" }> => m.kind === "quota-window" && m.id.startsWith("glm-window"))
                .map((m) => {
                  const sub = m.label.replace(/^GLM\s+/, "");
                  return `${sub} ${Math.round(m.remainingFraction * 100)}%`;
                });
              if (parts.length > 0) {
                summary = `GLM ${parts.join(" · ")}`;
              }
            }

            return {
              adapterId: this.id,
              sourceProviderId: target.providerId,
              displayName: "GLM",
              state: "ok",
              fetchedAt,
              summary,
              accounts: [
                {
                  id: "glm-coding-plan",
                  provider: "glm",
                  label: `GLM ${planLevel}`,
                  status: "available",
                  metrics,
                },
              ],
            };
          }
        }
      } catch {
        // Fallback to Pay-as-you-go verification
      }

      // 2. Fallback: Pay-As-You-Go standard API Key probe via completions
      const probeRes = await sameOriginFetch(
        new URL(target.baseUrl ? new URL(target.baseUrl).pathname + "/chat/completions" : "/api/paas/v4/chat/completions", baseOrigin),
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "glm-4.7",
            messages: [{ role: "user", content: "hi" }],
            max_tokens: 1,
          }),
          signal,
        },
        fetchFn,
        baseOrigin,
      );

      if (probeRes.status === 401 || probeRes.status === 403) {
        return {
          adapterId: this.id,
          sourceProviderId: target.providerId,
          displayName: "GLM",
          state: "unauthorized",
          fetchedAt,
          accounts: [],
          error: `GLM returned HTTP ${probeRes.status} (API key invalid or expired)`,
        };
      }

      // Read rate-limit headers if returned by proxy/gateway
      const reqRemaining = probeRes.headers.get("x-ratelimit-remaining-requests");
      const reqLimit = probeRes.headers.get("x-ratelimit-limit-requests");
      const metrics: Metric[] = [];

      if (reqRemaining != null && reqLimit != null) {
        const rem = Number(reqRemaining);
        const lim = Number(reqLimit);
        if (lim > 0) {
          metrics.push({
            kind: "quota-window",
            id: "glm-rpm",
            label: "GLM Requests",
            remainingFraction: Math.max(0, Math.min(1, rem / lim)),
          });
        }
      }

      metrics.push({
        kind: "status",
        id: "glm-plan-type",
        label: "Plan",
        value: "Pay-as-you-go",
        detail: "Standard API Key (Active)",
      });

      return {
        adapterId: this.id,
        sourceProviderId: target.providerId,
        displayName: "GLM",
        state: "ok",
        fetchedAt,
        summary: "GLM · Pay-as-you-go",
        accounts: [
          {
            id: "glm-payg-account",
            provider: "glm",
            label: "GLM (BigModel)",
            status: "available",
            metrics,
          },
        ],
      };
    } catch (error) {
      throw new Error(safeError(error));
    }
  },
};
