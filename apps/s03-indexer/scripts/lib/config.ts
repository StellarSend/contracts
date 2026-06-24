// Resolve smoke-run configuration from CLI flags and environment variables.
//
// Precedence: CLI flag > environment variable > sensible local default. Every
// value has a local-friendly default so a contributor can run the smoke flow with
// zero flags against a standard stellar/quickstart standalone network.

import { existsSync } from "node:fs";
import path from "node:path";

import type { SmokeConfig, SmokeMode } from "./types";

export interface ParsedArgs {
  flags: Record<string, string>;
  bools: Set<string>;
  positionals: string[];
}

export function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string> = {};
  const bools = new Set<string>();
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }

    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    const key = rawKey.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

    if (inlineValue !== undefined) {
      flags[key] = inlineValue;
      continue;
    }

    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      bools.add(key);
    } else {
      flags[key] = next;
      i += 1;
    }
  }

  return { flags, bools, positionals };
}

const packageRoot = path.resolve(import.meta.dir, "..", "..");
const repoRoot = path.resolve(packageRoot, "..", "..");

function resolveContractsRepo(explicit?: string): string {
  const configured =
    explicit ??
    process.env.SO4_CONTRACTS_REPO ??
    process.env.CONTRACTS_REPO_PATH ??
    process.env.CONTRACTS_REPO;

  if (configured) {
    return path.resolve(configured);
  }

  const candidates = [
    path.resolve(repoRoot, "..", "contracts"),
    path.resolve(packageRoot, "..", "contracts"),
    "/home/sunny/zero/so4-market-project/contracts",
  ];

  return candidates.find((candidate) => existsSync(path.join(candidate, "scripts"))) ?? candidates[0];
}

function resolveMode(value: string | undefined): SmokeMode {
  switch ((value ?? "auto").toLowerCase()) {
    case "fresh":
      return "fresh";
    case "existing":
      return "existing";
    default:
      return "auto";
  }
}

export function buildConfig(argv: string[]): SmokeConfig {
  const { flags, bools } = parseArgs(argv);

  const network = (flags.network ?? process.env.SMOKE_NETWORK ?? "local").toLowerCase();
  const source = flags.source ?? process.env.SMOKE_SOURCE ?? "so4-local";
  const keeper = flags.keeper ?? process.env.SMOKE_KEEPER ?? source;

  const sorobanRpcEndpoint =
    flags.sorobanEndpoint ??
    process.env.SMOKE_SOROBAN_ENDPOINT ??
    process.env.SOROBAN_ENDPOINT ??
    "http://localhost:8000/soroban/rpc";

  const horizonEndpoint =
    flags.horizonEndpoint ??
    process.env.SMOKE_HORIZON_ENDPOINT ??
    process.env.ENDPOINT ??
    "http://localhost:8000";

  const friendbotUrl =
    flags.friendbotUrl ?? process.env.SMOKE_FRIENDBOT_URL ?? "http://localhost:8000/friendbot";

  const graphqlEndpoint =
    flags.graphqlEndpoint ??
    process.env.SMOKE_GRAPHQL_ENDPOINT ??
    process.env.INDEXER_GRAPHQL_URL ??
    "http://localhost:3000";

  const reportPath = path.resolve(
    flags.report ?? process.env.SMOKE_REPORT ?? path.join(packageRoot, ".smoke", "report.json"),
  );

  return {
    network,
    contractsRepo: resolveContractsRepo(flags.contractsRepo),
    source,
    keeper,
    longCode: flags.longCode ?? process.env.SMOKE_LONG_CODE ?? "TWBTC",
    shortCode: flags.shortCode ?? process.env.SMOKE_SHORT_CODE ?? "TUSDC",
    mode: resolveMode(flags.mode),
    horizonEndpoint,
    sorobanRpcEndpoint,
    friendbotUrl,
    graphqlEndpoint,
    indexerLagTolerance: Number(flags.lagTolerance ?? process.env.SMOKE_LAG_TOLERANCE ?? 2),
    waitTimeoutMs: Number(flags.waitTimeout ?? process.env.SMOKE_WAIT_TIMEOUT_MS ?? 180_000),
    skipReferral: bools.has("skipReferral") || process.env.SMOKE_SKIP_REFERRAL === "1",
    skipIndexerRestart:
      bools.has("skipIndexerRestart") || process.env.SMOKE_SKIP_INDEXER_RESTART === "1",
    skipIndexerCheck: bools.has("skipIndexerCheck") || process.env.SMOKE_SKIP_INDEXER_CHECK === "1",
    reportPath,
  };
}

export const SMOKE_PATHS = { packageRoot, repoRoot };
