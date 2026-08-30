import type { Api, AuthResult, Model, Provider } from "@earendil-works/pi-ai";

export type UsageState =
  | "ok"
  | "empty"
  | "stale"
  | "unsupported"
  | "not-installed"
  | "unauthorized"
  | "incompatible"
  | "unavailable";

export type Metric =
  | { kind: "balance"; id: string; label: string; amount: number; currency: string; detail?: string }
  | { kind: "quota-window"; id: string; label: string; remainingFraction: number; resetAt?: string; detail?: string }
  | { kind: "credits"; id: string; label: string; remaining: number; unit: string; detail?: string }
  | { kind: "usage-limit"; id: string; label: string; used: number; limit: number; unit: string; detail?: string }
  | { kind: "rate-limit"; id: string; label: string; value: number; unit: string; detail?: string }
  | { kind: "status"; id: string; label: string; value: string; detail?: string }
  | { kind: "custom"; id: string; label: string; value: string; detail?: string };

export interface UsageAccount {
  id: string;
  provider: string;
  label: string;
  status?: string;
  disabled?: boolean;
  unavailable?: boolean;
  metrics: Metric[];
  rawGroups?: unknown;
  error?: string;
}

export interface UsageSnapshot {
  adapterId: string;
  sourceProviderId: string;
  displayName: string;
  state: UsageState;
  fetchedAt: string;
  stale?: boolean;
  accounts: UsageAccount[];
  summary?: string;
  error?: string;
  diagnostic?: string;
}

export interface ProviderTarget {
  providerId: string;
  model?: Model<Api>;
  provider?: Provider<Api>;
  baseUrl?: string;
  auth?: AuthResult;
  authError?: string;
  configuredModelIds?: string[];
}

export interface FetchContext {
  target: ProviderTarget;
  signal: AbortSignal;
  force: boolean;
  fetchFn: typeof fetch;
}

export interface UsageAdapter {
  id: string;
  label: string;
  canHandle(target: ProviderTarget): boolean;
  fetch(context: FetchContext): Promise<UsageSnapshot>;
}
