import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import { NodeCommandRunner, type SpawnLike } from "../src/main/node-command-runner.js";

class FakeChild extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  kill = vi.fn();
}

describe("NodeCommandRunner", () => {
  it("starts a fixed argv without shell mode and returns its bounded outcome", async () => {
    const child = new FakeChild();
    const spawn = vi.fn<SpawnLike>().mockReturnValue(child);
    const runner = new NodeCommandRunner({ spawn });
    const running = runner.run({
      argv: ["pnpm", "test"],
      workingDirectory: "C:\\fixtures\\node",
      timeoutMs: 500,
    });
    child.stdout.emit("data", Buffer.from("passed\n"));
    child.emit("close", 0);

    await expect(running).resolves.toMatchObject({
      exitCode: 0,
      condition: "success",
      stdout: "passed\n",
    });
    expect(spawn).toHaveBeenCalledWith("pnpm", ["test"], {
      cwd: "C:\\fixtures\\node",
      shell: false,
      windowsHide: true,
    });
  });

  it("never invokes a shell when an executable cannot be started", async () => {
    const child = new FakeChild();
    const spawn = vi.fn<SpawnLike>().mockReturnValue(child);
    const runner = new NodeCommandRunner({ spawn });
    const running = runner.run({ argv: ["missing-command"], workingDirectory: "C:\\fixture", timeoutMs: 500 });
    child.emit("error", Object.assign(new Error("missing"), { code: "ENOENT" }));

    await expect(running).resolves.toMatchObject({ exitCode: null, condition: "command_not_found" });
    expect(spawn.mock.calls[0]?.[2]).toMatchObject({ shell: false });
  });
});
