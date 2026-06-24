// Thin wrapper around child_process for the smoke runner.
//
// Two modes: `run` captures stdout/stderr (used when we need the output, e.g. a
// contract key returned by an invoke) and `runStreaming` inherits stdio (used for
// long deploy/bootstrap commands so the contributor sees live progress).

import { spawnSync } from "node:child_process";

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** When true, a non-zero exit code throws ProcessError instead of returning. */
  check?: boolean;
  /** Inherit the parent stdio so output streams live (no capture). */
  stream?: boolean;
  /** Max buffer for captured output in bytes (default 32 MiB). */
  maxBuffer?: number;
}

export interface RunResult {
  command: string;
  code: number;
  stdout: string;
  stderr: string;
}

export class ProcessError extends Error {
  constructor(
    message: string,
    readonly result: RunResult,
  ) {
    super(message);
    this.name = "ProcessError";
  }
}

export function run(command: string, args: string[], options: RunOptions = {}): RunResult {
  const printable = `${command} ${args.join(" ")}`.trim();

  const completed = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: "utf8",
    stdio: options.stream ? "inherit" : "pipe",
    maxBuffer: options.maxBuffer ?? 32 * 1024 * 1024,
  });

  if (completed.error) {
    const result: RunResult = { command: printable, code: -1, stdout: "", stderr: completed.error.message };
    if (options.check) {
      throw new ProcessError(`Failed to run ${printable}: ${completed.error.message}`, result);
    }
    return result;
  }

  const result: RunResult = {
    command: printable,
    code: completed.status ?? -1,
    stdout: (completed.stdout ?? "").toString(),
    stderr: (completed.stderr ?? "").toString(),
  };

  if (options.check && result.code !== 0) {
    const tail = result.stderr.trim() || result.stdout.trim();
    throw new ProcessError(`Command exited ${result.code}: ${printable}\n${tail}`, result);
  }

  return result;
}

/** True when a binary is resolvable on PATH. */
export function hasBinary(binary: string): boolean {
  const probe =
    process.platform === "win32"
      ? run("where", [binary])
      : run("sh", ["-c", `command -v ${binary}`]);
  return probe.code === 0 && probe.stdout.trim().length > 0;
}
