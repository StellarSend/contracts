// Shared types for the local smoke flow.
//
// The smoke runner exercises the full stack — contract deploy/bootstrap, on-chain
// protocol actions, the SubQuery indexer runtime, and the GraphQL query layer — so
// every step is tagged with the layer it belongs to. When a step fails the report
// names that layer, which is what lets a contributor tell "contracts didn't deploy"
// apart from "the indexer never caught up" without reading the whole log.

export type SmokeLayer =
  | "preflight"
  | "services"
  | "contracts-deploy"
  | "contract-action"
  | "indexer-runtime"
  | "graphql-query"
  | "frontend-config";

export type StepStatus = "ok" | "failed" | "skipped";

export interface StepResult {
  name: string;
  layer: SmokeLayer;
  status: StepStatus;
  startedAt: string;
  durationMs: number;
  /** Human-readable note (skip reason, summary, etc.). */
  detail?: string;
  /** Error message when status is "failed". */
  error?: string;
  /** Structured payload — ledger numbers, tx hashes, contract keys, counts. */
  data?: Record<string, unknown>;
}

/** How the smoke run sources its deployment. */
export type SmokeMode = "auto" | "fresh" | "existing";

export interface SmokeConfig {
  /** Stellar network alias used by the stellar CLI and deploy scripts. */
  network: string;
  /** Absolute path to the SO4 contracts repo. */
  contractsRepo: string;
  /** stellar CLI key name that signs admin/deploy transactions. */
  source: string;
  /** stellar CLI key name granted keeper roles (defaults to source). */
  keeper: string;
  /** Long/index token ticker for the bootstrapped market. */
  longCode: string;
  /** Short token ticker for the bootstrapped market. */
  shortCode: string;
  /** Deployment sourcing strategy. */
  mode: SmokeMode;
  /** Horizon endpoint reachable from the host. */
  horizonEndpoint: string;
  /** Soroban RPC endpoint reachable from the host. */
  sorobanRpcEndpoint: string;
  /** Optional friendbot URL used to fund a freshly generated local key. */
  friendbotUrl?: string;
  /** SubQuery GraphQL endpoint. */
  graphqlEndpoint: string;
  /** Max ledgers the indexer may lag behind head and still count as caught up. */
  indexerLagTolerance: number;
  /** How long to wait for the indexer to catch up, in milliseconds. */
  waitTimeoutMs: number;
  /** Skip the optional referral register/set step. */
  skipReferral: boolean;
  /** Skip indexer rebuild/restart (assume it is already running with fresh config). */
  skipIndexerRestart: boolean;
  /** Skip the GraphQL assertion phase (contracts-only smoke). */
  skipIndexerCheck: boolean;
  /** Where to write the JSON smoke report. */
  reportPath: string;
}

export interface EntityCounts {
  markets: number;
  deposits: number;
  orders: number;
  positions: number;
  transfers: number;
  positionChanges: number;
  referralCodes: number;
}

export interface SmokeReport {
  network: string;
  mode: SmokeMode;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  success: boolean;
  contractsRepo: string;
  source: string;
  keeperAddress?: string;
  services: Record<string, boolean>;
  /** Deployment + action artifacts: contract IDs, market token, keys, tx hashes. */
  artifacts: Record<string, unknown>;
  graphql?: {
    endpoint: string;
    reachable: boolean;
    lastProcessedHeight?: number;
    targetHeight?: number;
    counts?: EntityCounts;
    assertions?: Array<{ entity: string; expected: number; actual: number; ok: boolean }>;
  };
  steps: StepResult[];
  /** First failing step, surfaced at the top so the broken layer is obvious. */
  failure?: { step: string; layer: SmokeLayer; error: string };
}
