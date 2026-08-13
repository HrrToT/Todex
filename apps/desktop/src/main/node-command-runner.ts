import { spawn as nodeSpawn } from "node:child_process";

import type { CommandExecution, CommandRunner } from "@todex/harness-core";

export interface SpawnedProcess {
  readonly stdout?: { on(event: "data", listener: (chunk: Buffer | string) => void): unknown };
  readonly stderr?: { on(event: "data", listener: (chunk: Buffer | string) => void): unknown };
  once(event: "error", listener: (error: NodeJS.ErrnoException) => void): unknown;
  once(event: "close", listener: (exitCode: number | null) => void): unknown;
  kill(): unknown;
}

export type SpawnLike = (
  command: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly shell: false; readonly windowsHide: true },
) => SpawnedProcess;

export interface NodeCommandRunnerOptions {
  readonly spawn?: SpawnLike;
  readonly maxOutputBytes?: number;
}

const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;

export class NodeCommandRunner implements CommandRunner {
  private readonly spawn: SpawnLike;
  private readonly maxOutputBytes: number;

  constructor(options: NodeCommandRunnerOptions = {}) {
    this.spawn = options.spawn ?? nodeSpawn;
    this.maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  }

  run(input: { readonly argv: readonly string[]; readonly workingDirectory: string; readonly timeoutMs: number }, signal?: AbortSignal): Promise<CommandExecution> {
    const [command, ...args] = input.argv;
    if (!command) {
      return Promise.resolve(emptyExecution("command_not_found"));
    }
    const startedAt = Date.now();
    let child: SpawnedProcess;
    try {
      child = this.spawn(command, args, { cwd: input.workingDirectory, shell: false, windowsHide: true });
    } catch {
      return Promise.resolve(emptyExecution("execution_error"));
    }
    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const append = (current: string, chunk: Buffer | string) => {
        const combined = current + chunk.toString();
        return Buffer.byteLength(combined, "utf8") > this.maxOutputBytes
          ? combined.slice(0, this.maxOutputBytes)
          : combined;
      };
      const finish = (exitCode: number | null, condition: CommandExecution["condition"]) => {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abort);
        resolve({ exitCode, durationMs: Date.now() - startedAt, stdout, stderr, condition });
      };
      const abort = () => child.kill();
      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, input.timeoutMs);
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      child.stdout?.on("data", (chunk: Buffer | string) => { stdout = append(stdout, chunk); });
      child.stderr?.on("data", (chunk: Buffer | string) => { stderr = append(stderr, chunk); });
      child.once("error", (error: NodeJS.ErrnoException) => {
        finish(null, error.code === "ENOENT" ? "command_not_found" : "execution_error");
      });
      child.once("close", (exitCode: number | null) => {
        finish(exitCode, timedOut ? "timeout" : exitCode === 0 ? "success" : "test_failure");
      });
    });
  }
}

function emptyExecution(condition: CommandExecution["condition"]): CommandExecution {
  return { exitCode: null, durationMs: 0, stdout: "", stderr: "", condition };
}
