// Stellar CLI + Soroban RPC helpers for the smoke runner.
//
// All on-chain actions go through the `stellar` CLI so the smoke flow uses the
// exact same code path a contributor would type by hand, and so signing stays
// inside the CLI keystore (no raw secret keys ever touch this process).

import { run, type RunResult } from "./process";

export interface StellarContext {
  network: string;
  source: string;
  rpcUrl: string;
}

/** Resolve a CLI key name to its G... public address. */
export function keyAddress(name: string): string | undefined {
  const result = run("stellar", ["keys", "address", name]);
  if (result.code !== 0) {
    return undefined;
  }
  const address = result.stdout.trim();
  return /^G[A-Z2-7]{55}$/.test(address) ? address : undefined;
}

/** Generate a local-only CLI key if it does not already exist. */
export function ensureKey(name: string, network: string): string {
  const existing = keyAddress(name);
  if (existing) {
    return existing;
  }

  run("stellar", ["keys", "generate", "--global", name, "--network", network], { check: true });
  const address = keyAddress(name);
  if (!address) {
    throw new Error(`Generated key "${name}" but could not resolve its address.`);
  }
  return address;
}

/** Fund an address from a local friendbot. Best-effort; returns success. */
export async function fundFromFriendbot(friendbotUrl: string, address: string): Promise<boolean> {
  try {
    const url = `${friendbotUrl}?addr=${encodeURIComponent(address)}`;
    const response = await fetch(url, { method: "GET" });
    return response.ok;
  } catch {
    return false;
  }
}

/** Invoke a contract function, returning the raw RunResult. */
export function invokeRaw(
  ctx: StellarContext,
  contractId: string,
  fn: string,
  args: string[],
  options: { stream?: boolean } = {},
): RunResult {
  return run(
    "stellar",
    [
      "contract",
      "invoke",
      "--id",
      contractId,
      "--source",
      ctx.source,
      "--network",
      ctx.network,
      "--",
      fn,
      ...args,
    ],
    { stream: options.stream },
  );
}

/** Invoke a contract function and throw on failure, returning trimmed stdout. */
export function invoke(
  ctx: StellarContext,
  contractId: string,
  fn: string,
  args: string[],
): string {
  const result = invokeRaw(ctx, contractId, fn, args);
  if (result.code !== 0) {
    const tail = result.stderr.trim() || result.stdout.trim();
    throw new Error(`invoke ${fn} on ${contractId} failed (${result.code}): ${tail}`);
  }
  return result.stdout.trim();
}

/** Invoke and JSON-parse the result. Falls back to the raw string when not JSON. */
export function invokeJson<T = unknown>(
  ctx: StellarContext,
  contractId: string,
  fn: string,
  args: string[],
): T {
  const out = invoke(ctx, contractId, fn, args);
  try {
    return JSON.parse(out) as T;
  } catch {
    return out as unknown as T;
  }
}

/** Latest ledger sequence from the Soroban RPC, or undefined when unreachable. */
export async function getLatestLedger(rpcUrl: string): Promise<number | undefined> {
  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getLatestLedger" }),
    });
    if (!response.ok) {
      return undefined;
    }
    const body = (await response.json()) as { result?: { sequence?: number } };
    return body.result?.sequence;
  } catch {
    return undefined;
  }
}

/** True when the Soroban RPC answers getLatestLedger. */
export async function rpcReachable(rpcUrl: string): Promise<boolean> {
  return (await getLatestLedger(rpcUrl)) !== undefined;
}

/** Basic HTTP reachability probe (used for Horizon). */
export async function httpReachable(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: "GET" });
    // Any HTTP answer (even 4xx) proves the service is listening.
    return response.status > 0;
  } catch {
    return false;
  }
}
