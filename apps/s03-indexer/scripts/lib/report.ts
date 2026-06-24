// Step runner and JSON report writer for the smoke flow.
//
// Each protocol action is wrapped in `step()`, which records timing, status, the
// owning layer, and any structured data (ledgers, tx hashes, contract keys). The
// first failure is promoted to `report.failure` so the report's top tells you which
// layer broke. Fatal steps abort the run; non-fatal steps (e.g. the optional
// referral path) record a failure and continue.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import type {
  EntityCounts,
  SmokeConfig,
  SmokeLayer,
  SmokeReport,
  StepResult,
} from "./types";

export class StepAborted extends Error {
  constructor(readonly step: StepResult) {
    super(`Aborted at step: ${step.name}`);
    this.name = "StepAborted";
  }
}

export interface StepOptions {
  /** Abort the whole run when this step fails (default true). */
  fatal?: boolean;
}

export class SmokeRun {
  private readonly startedAt = Date.now();
  private readonly steps: StepResult[] = [];
  private readonly artifacts: Record<string, unknown> = {};
  private readonly services: Record<string, boolean> = {};
  private keeperAddress?: string;
  private graphql?: SmokeReport["graphql"];
  private failure?: SmokeReport["failure"];

  constructor(private readonly config: SmokeConfig) {}

  /** Run a labelled step, recording its outcome on the report. */
  async step<T>(
    name: string,
    layer: SmokeLayer,
    fn: () => Promise<T> | T,
    options: StepOptions = {},
  ): Promise<T | undefined> {
    const fatal = options.fatal ?? true;
    const startedAt = new Date().toISOString();
    const started = Date.now();
    process.stdout.write(`\n▸ [${layer}] ${name}\n`);

    try {
      const value = await fn();
      const record: StepResult = {
        name,
        layer,
        status: "ok",
        startedAt,
        durationMs: Date.now() - started,
      };
      if (value && typeof value === "object" && !Array.isArray(value)) {
        record.data = value as Record<string, unknown>;
      }
      this.steps.push(record);
      process.stdout.write(`  ✔ ${name}\n`);
      return value;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const record: StepResult = {
        name,
        layer,
        status: "failed",
        startedAt,
        durationMs: Date.now() - started,
        error: message,
      };
      this.steps.push(record);
      this.failure ??= { step: name, layer, error: message };
      process.stderr.write(`  ✖ ${name}: ${message}\n`);

      if (fatal) {
        throw new StepAborted(record);
      }
      return undefined;
    }
  }

  /** Record a skipped step so the report shows the decision explicitly. */
  skip(name: string, layer: SmokeLayer, detail: string): void {
    this.steps.push({
      name,
      layer,
      status: "skipped",
      startedAt: new Date().toISOString(),
      durationMs: 0,
      detail,
    });
    process.stdout.write(`\n⊘ [${layer}] ${name} — skipped: ${detail}\n`);
  }

  setArtifact(key: string, value: unknown): void {
    this.artifacts[key] = value;
  }

  mergeArtifacts(values: Record<string, unknown>): void {
    Object.assign(this.artifacts, values);
  }

  setService(name: string, reachable: boolean): void {
    this.services[name] = reachable;
  }

  setKeeperAddress(address: string): void {
    this.keeperAddress = address;
  }

  setGraphql(graphql: SmokeReport["graphql"]): void {
    this.graphql = graphql;
  }

  hasFailure(): boolean {
    return this.failure !== undefined;
  }

  build(): SmokeReport {
    return {
      network: this.config.network,
      mode: this.config.mode,
      startedAt: new Date(this.startedAt).toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - this.startedAt,
      success: !this.failure,
      contractsRepo: this.config.contractsRepo,
      source: this.config.source,
      keeperAddress: this.keeperAddress,
      services: this.services,
      artifacts: this.artifacts,
      graphql: this.graphql,
      steps: this.steps,
      failure: this.failure,
    };
  }

  /** Write the report JSON to disk and return its path. */
  write(): string {
    const report = this.build();
    mkdirSync(path.dirname(this.config.reportPath), { recursive: true });
    writeFileSync(this.config.reportPath, `${JSON.stringify(report, null, 2)}\n`);
    return this.config.reportPath;
  }
}

/** Compare observed counts against the minimums the smoke flow expects. */
export function buildAssertions(
  counts: EntityCounts,
  expected: Partial<EntityCounts>,
): Array<{ entity: string; expected: number; actual: number; ok: boolean }> {
  return Object.entries(expected).map(([entity, min]) => {
    const actual = counts[entity as keyof EntityCounts] ?? 0;
    return { entity, expected: min ?? 0, actual, ok: actual >= (min ?? 0) };
  });
}
