import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Metric, UsageAdapter, UsageSnapshot } from "../../../core/types.ts";
import { isUrlOnDomain, safeError, sameOriginFetch } from "../../../core/security.ts";

const XAI_AUTH_ORIGIN = "https://auth.x.ai";
const XAI_USERINFO_PATH = "/oauth2/userinfo";
const XAI_API_ORIGIN = "https://api.x.ai";

interface XAIUserInfo {
  sub?: string;
  name?: string;
  email?: string;
  email_verified?: boolean;
}

interface XAIErrorResponse {
  code?: string;
  error?: string;
}

async function resolveLocalXAIAuth(): Promise<{ accessToken?: string | undefined }> {
  try {
    const authPath = join(getAgentDir(), "auth.json");
    const raw = await readFile(authPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, { access?: string; apiKey?: string }>;
    const xai = parsed.xai;
    if (xai) {
      return { accessToken: xai.access ?? xai.apiKey };
    }
  } catch {
    // Ignore fallback errors
  }
  return {};
}

export const xaiAdapter: UsageAdapter = {
  id: "xai",
  label: "xAI / Grok",
  canHandle(target) {
    const pid = target.providerId.toLowerCase();
    const nativeId = pid === "xai" || pid === "grok";
    if (target.baseUrl) return isUrlOnDomain(target.baseUrl, "x.ai");
    return nativeId;
  },
  async fetch({ target, signal, fetchFn }): Promise<UsageSnapshot> {
    const fetchedAt = new Date().toISOString();
    const authRecord = target.auth?.auth as Record<string, unknown> | undefined;
    let accessToken = (authRecord?.apiKey ?? authRecord?.access) as string | undefined;

    if (!accessToken) {
      const local = await resolveLocalXAIAuth();
      accessToken = local.accessToken;
    }

    if (!accessToken) {
      return {
        adapterId: this.id,
        sourceProviderId: target.providerId,
        displayName: "xAI Grok",
        state: "unauthorized",
        fetchedAt,
        accounts: [],
        error: "No access token found in Pi auth for xai",
      };
    }

    try {
      // 1. Verify OAuth token identity with auth.x.ai
      const userinfoRes = await sameOriginFetch(
        new URL(XAI_USERINFO_PATH, XAI_AUTH_ORIGIN),
        {
          method: "GET",
          headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
          signal,
        },
        fetchFn,
        XAI_AUTH_ORIGIN,
      );

      if (userinfoRes.status === 401 || userinfoRes.status === 403) {
        return {
          adapterId: this.id,
          sourceProviderId: target.providerId,
          displayName: "xAI Grok",
          state: "unauthorized",
          fetchedAt,
          accounts: [],
          error: `xAI returned HTTP ${userinfoRes.status} (token expired or invalid)`,
        };
      }

      if (!userinfoRes.ok) throw new Error(`xAI userinfo returned HTTP ${userinfoRes.status}`);
      const info = (await userinfoRes.json()) as XAIUserInfo;
      const userLabel = info.email || info.name || "Grok Account";
      const userId = info.sub || "xai-user";

      // 2. Query billing / spending limit status via lightweight probe
      // xAI returns HTTP 402 with code: 'personal-team-blocked:spending-limit' when credit limit is hit or subscription is required
      let statusText = "Active";
      let limitHit = false;

      try {
        const probeRes = await sameOriginFetch(
          new URL("/v1/chat/completions", XAI_API_ORIGIN),
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "grok-4.6",
              messages: [{ role: "user", content: "" }],
              max_tokens: 1,
            }),
            signal,
          },
          fetchFn,
          XAI_API_ORIGIN,
        );

        if (probeRes.status === 402) {
          limitHit = true;
          const errData = (await probeRes.json().catch(() => ({}))) as XAIErrorResponse;
          if (errData.code?.includes("spending-limit") || errData.error?.includes("credits")) {
            statusText = "Limit Reached";
          }
        } else if (probeRes.status === 401 || probeRes.status === 403) {
          statusText = "API Access Unauthorized";
        }
      } catch (error) {
        // The status probe is best-effort, but cancellation must stop the refresh.
        if (signal.aborted) throw error;
      }

      const metrics: Metric[] = [
        {
          kind: "status",
          id: "grok-subscription",
          label: "Subscription",
          value: statusText,
          detail: limitHit ? "Out of credits or subscription needed" : "Connected",
        },
      ];

      const accounts = [
        {
          id: userId,
          provider: "xai",
          label: userLabel,
          status: limitHit ? "limit_reached" : "available",
          metrics,
        },
      ];

      return {
        adapterId: this.id,
        sourceProviderId: target.providerId,
        displayName: "xAI Grok",
        state: "ok",
        fetchedAt,
        summary: `Grok · ${statusText}`,
        accounts,
      };
    } catch (error) {
      throw new Error(safeError(error));
    }
  },
};
