import { describe, expect, it } from "vitest";
import {
  VerificationRunner,
  type CommandRunner,
  type CommandExecution,
  type CommandExecutionCondition,
  type ConfiguredCommandRegistry,
} from "../src/verification-runner.js";
import type { ConfiguredCommand } from "@todex/contracts";

function makeCommand(overrides: Partial<ConfiguredCommand> = {}): ConfiguredCommand {
  return {
    commandId: "p1.test",
    projectId: "p1",
    purpose: "test",
    argv: ["pnpm", "test"],
    workingDirectory: ".",
    timeoutMs: 10_000,
    confirmedByUser: true,
    ...overrides,
  };
}

function makeRegistry(commands: ConfiguredCommand[]): ConfiguredCommandRegistry {
  return {
    find: (projectId, commandId) =>
      commands.find((c) => c.projectId === projectId && c.commandId === commandId),
  };
}

function makeCommandRunner(execution: CommandExecution): CommandRunner & { calls: { argv: readonly string[]; workingDirectory: string; timeoutMs: number }[] } {
  const calls: { argv: readonly string[]; workingDirectory: string; timeoutMs: number }[] = [];
  return {
    calls,
    run: async (input) => {
      calls.push({ argv: input.argv, workingDirectory: input.workingDirectory, timeoutMs: input.timeoutMs });
      return execution;
    },
  };
}

function makeExecution(condition: CommandExecutionCondition, overrides: Partial<CommandExecution> = {}): CommandExecution {
  return {
    exitCode: condition === "success" ? 0 : 1,
    durationMs: 100,
    stdout: "",
    stderr: "",
    condition,
    ...overrides,
  };
}

describe("VerificationRunner command authorization", () => {
  it("runs only a confirmed command for the current project", async () => {
    const command = makeCommand();
    const registry = makeRegistry([command]);
    const commandRunner = makeCommandRunner(makeExecution("success"));
    const runner = new VerificationRunner({ registry, commandRunner });

    const result = await runner.run({ projectId: "p1", commandId: "p1.test", runId: "r1" });

    expect(commandRunner.calls).toEqual([
      { argv: ["pnpm", "test"], workingDirectory: ".", timeoutMs: 10_000 },
    ]);
    expect(result.classification).toBe("passed");
    expect(result.commandId).toBe("p1.test");
    expect(result.runId).toBe("r1");
    expect(result.exitCode).toBe(0);
    expect(result.durationMs).toBe(100);
  });

  it("does not call CommandRunner for unknown command", async () => {
    const registry = makeRegistry([makeCommand()]);
    const commandRunner = makeCommandRunner(makeExecution("success"));
    const runner = new VerificationRunner({ registry, commandRunner });

    const result = await runner.run({ projectId: "p1", commandId: "unknown.cmd", runId: "r1" });

    expect(result.classification).toBe("command_not_found");
    expect(commandRunner.calls).toHaveLength(0);
  });

  it("does not call CommandRunner for mismatched project", async () => {
    const registry = makeRegistry([makeCommand({ projectId: "p1", commandId: "p1.test" })]);
    const commandRunner = makeCommandRunner(makeExecution("success"));
    const runner = new VerificationRunner({ registry, commandRunner });

    const result = await runner.run({ projectId: "p2", commandId: "p1.test", runId: "r1" });

    expect(result.classification).toBe("command_not_found");
    expect(commandRunner.calls).toHaveLength(0);
  });

  it("does not call CommandRunner for unconfirmed command", async () => {
    const registry = makeRegistry([makeCommand({ confirmedByUser: false })]);
    const commandRunner = makeCommandRunner(makeExecution("success"));
    const runner = new VerificationRunner({ registry, commandRunner });

    const result = await runner.run({ projectId: "p1", commandId: "p1.test", runId: "r1" });

    expect(result.classification).toBe("command_not_found");
    expect(commandRunner.calls).toHaveLength(0);
  });

  it("does not call CommandRunner when registry returns a command with wrong projectId", async () => {
    const wrongCommand = makeCommand({ projectId: "p2", commandId: "p1.test", confirmedByUser: true });
    const lyingRegistry: ConfiguredCommandRegistry = {
      find: () => wrongCommand,
    };
    const commandRunner = makeCommandRunner(makeExecution("success"));
    const runner = new VerificationRunner({ registry: lyingRegistry, commandRunner });

    const result = await runner.run({ projectId: "p1", commandId: "p1.test", runId: "r1" });

    expect(result.classification).toBe("command_not_found");
    expect(commandRunner.calls).toHaveLength(0);
  });

  it("does not call CommandRunner when registry returns a command with wrong commandId", async () => {
    const wrongCommand = makeCommand({ projectId: "p1", commandId: "p2.lint", confirmedByUser: true });
    const lyingRegistry: ConfiguredCommandRegistry = {
      find: () => wrongCommand,
    };
    const commandRunner = makeCommandRunner(makeExecution("success"));
    const runner = new VerificationRunner({ registry: lyingRegistry, commandRunner });

    const result = await runner.run({ projectId: "p1", commandId: "p1.test", runId: "r1" });

    expect(result.classification).toBe("command_not_found");
    expect(commandRunner.calls).toHaveLength(0);
  });
});

describe("VerificationRunner classification mapping", () => {
  const conditions: CommandExecutionCondition[] = [
    "success",
    "test_failure",
    "quality_failure",
    "build_failure",
    "command_not_found",
    "dependency_missing",
    "timeout",
    "execution_error",
    "cancelled",
  ];

  for (const condition of conditions) {
    it(`maps ${condition} to correct classification`, async () => {
      const registry = makeRegistry([makeCommand()]);
      const commandRunner = makeCommandRunner(makeExecution(condition));
      const runner = new VerificationRunner({ registry, commandRunner });

      const result = await runner.run({ projectId: "p1", commandId: "p1.test", runId: "r1" });

      const expected =
        condition === "success" ? "passed" : condition;
      expect(result.classification).toBe(expected);
    });
  }
});

describe("VerificationRunner redaction and truncation", () => {
  it("redacts sensitive values from failure summary", async () => {
    const registry = makeRegistry([makeCommand()]);
    const commandRunner = makeCommandRunner(
      makeExecution("test_failure", {
        stdout: "TOKEN=secret-value in output",
        stderr: "API_KEY=another-secret here",
      }),
    );
    const runner = new VerificationRunner({ registry, commandRunner });

    const result = await runner.run({ projectId: "p1", commandId: "p1.test", runId: "r1" });

    expect(result.failureSummary).not.toContain("secret-value");
    expect(result.failureSummary).not.toContain("another-secret");
    expect(result.failureSummary).toContain("[REDACTED]");
  });

  it("redacts absolute host paths from failure summary", async () => {
    const registry = makeRegistry([makeCommand()]);
    const commandRunner = makeCommandRunner(
      makeExecution("test_failure", {
        stderr: "Error at C:\\Users\\Lenovo\\project\\src\\file.ts",
      }),
    );
    const runner = new VerificationRunner({ registry, commandRunner });

    const result = await runner.run({ projectId: "p1", commandId: "p1.test", runId: "r1" });

    expect(result.failureSummary).not.toContain("C:\\Users\\Lenovo");
    expect(result.failureSummary).not.toContain("C:\\Users");
  });

  it("redacts unix absolute paths from failure summary", async () => {
    const registry = makeRegistry([makeCommand()]);
    const commandRunner = makeCommandRunner(
      makeExecution("test_failure", {
        stderr: "Error at /home/user/project/src/file.ts line 5",
      }),
    );
    const runner = new VerificationRunner({ registry, commandRunner });

    const result = await runner.run({ projectId: "p1", commandId: "p1.test", runId: "r1" });

    expect(result.failureSummary).not.toContain("/home/user");
  });

  it("truncates failure summary to at most 2000 characters", async () => {
    const registry = makeRegistry([makeCommand()]);
    const longOutput = "x".repeat(2500);
    const commandRunner = makeCommandRunner(
      makeExecution("test_failure", { stderr: longOutput }),
    );
    const runner = new VerificationRunner({ registry, commandRunner });

    const result = await runner.run({ projectId: "p1", commandId: "p1.test", runId: "r1" });

    expect(result.failureSummary.length).toBeLessThanOrEqual(2000);
  });

  it("retains at most 20 related paths", async () => {
    const registry = makeRegistry([makeCommand()]);
    const paths: string[] = [];
    for (let i = 0; i < 25; i++) {
      paths.push(`src/file${i}.ts`);
    }
    const commandRunner = makeCommandRunner(
      makeExecution("test_failure", { stderr: paths.join("\n") }),
    );
    const runner = new VerificationRunner({ registry, commandRunner });

    const result = await runner.run({ projectId: "p1", commandId: "p1.test", runId: "r1" });

    expect(result.relatedPaths.length).toBeLessThanOrEqual(20);
    expect(result.relatedPaths.length).toBe(20);
  });

  it("extracts only relative paths as related paths", async () => {
    const registry = makeRegistry([makeCommand()]);
    const commandRunner = makeCommandRunner(
      makeExecution("test_failure", {
        stderr: "src/relative/file.ts\nC:\\Users\\Lenovo\\absolute.ts\npackages/core/lib.ts",
      }),
    );
    const runner = new VerificationRunner({ registry, commandRunner });

    const result = await runner.run({ projectId: "p1", commandId: "p1.test", runId: "r1" });

    expect(result.relatedPaths).toContain("src/relative/file.ts");
    expect(result.relatedPaths).toContain("packages/core/lib.ts");
    expect(result.relatedPaths.some((p) => p.includes("Users"))).toBe(false);
  });

  it("does not leak sensitive values into related paths", async () => {
    const registry = makeRegistry([makeCommand()]);
    const commandRunner = makeCommandRunner(
      makeExecution("test_failure", {
        stderr: "TOKEN=secret-value\nsrc/file.ts",
      }),
    );
    const runner = new VerificationRunner({ registry, commandRunner });

    const result = await runner.run({ projectId: "p1", commandId: "p1.test", runId: "r1" });

    const allText = result.failureSummary + result.relatedPaths.join("");
    expect(allText).not.toContain("secret-value");
  });

  it("produces a full 2500-char seeded error with redaction and limits", async () => {
    const registry = makeRegistry([makeCommand()]);
    const sensitive = "TOKEN=secret-value";
    const absPath = "C:\\Users\\Lenovo\\project\\src\\file.ts";
    const paths: string[] = [];
    for (let i = 0; i < 25; i++) {
      paths.push(`src/file${i}.ts`);
    }
    const padding = "z".repeat(2500);
    const stderr = `${sensitive}\n${absPath}\n${paths.join("\n")}\n${padding}`;
    const commandRunner = makeCommandRunner(
      makeExecution("test_failure", { stderr }),
    );
    const runner = new VerificationRunner({ registry, commandRunner });

    const result = await runner.run({ projectId: "p1", commandId: "p1.test", runId: "r1" });

    expect(result.failureSummary.length).toBeLessThanOrEqual(2000);
    expect(result.relatedPaths.length).toBeLessThanOrEqual(20);
    expect(result.failureSummary).not.toContain("secret-value");
    expect(result.failureSummary).not.toContain("C:\\Users");
    expect(result.relatedPaths.length).toBe(20);
  });

  it("redacts unix absolute paths after parentheses boundary", async () => {
    const registry = makeRegistry([makeCommand()]);
    const commandRunner = makeCommandRunner(
      makeExecution("test_failure", {
        stderr: "Error at (/home/lenovo/project/src/a.ts:12)",
      }),
    );
    const runner = new VerificationRunner({ registry, commandRunner });

    const result = await runner.run({ projectId: "p1", commandId: "p1.test", runId: "r1" });

    expect(result.failureSummary).not.toContain("/home/lenovo");
    expect(result.failureSummary).not.toContain("/private");
  });

  it("redacts unix absolute paths after quote boundary", async () => {
    const registry = makeRegistry([makeCommand()]);
    const commandRunner = makeCommandRunner(
      makeExecution("test_failure", {
        stderr: 'file="/private/tmp/error.log"',
      }),
    );
    const runner = new VerificationRunner({ registry, commandRunner });

    const result = await runner.run({ projectId: "p1", commandId: "p1.test", runId: "r1" });

    expect(result.failureSummary).not.toContain("/private/tmp");
  });

  it("redacts unix absolute paths after equals boundary", async () => {
    const registry = makeRegistry([makeCommand()]);
    const commandRunner = makeCommandRunner(
      makeExecution("test_failure", {
        stderr: "path=/var/log/app/error.log",
      }),
    );
    const runner = new VerificationRunner({ registry, commandRunner });

    const result = await runner.run({ projectId: "p1", commandId: "p1.test", runId: "r1" });

    expect(result.failureSummary).not.toContain("/var/log");
  });

  it("redacts unix absolute paths after bracket boundary", async () => {
    const registry = makeRegistry([makeCommand()]);
    const commandRunner = makeCommandRunner(
      makeExecution("test_failure", {
        stderr: "files=[/opt/app/config.json,/etc/app.conf]",
      }),
    );
    const runner = new VerificationRunner({ registry, commandRunner });

    const result = await runner.run({ projectId: "p1", commandId: "p1.test", runId: "r1" });

    expect(result.failureSummary).not.toContain("/opt/app");
    expect(result.failureSummary).not.toContain("/etc/app");
  });

  it("does not redact relative paths like src/file.ts or package/name", async () => {
    const registry = makeRegistry([makeCommand()]);
    const commandRunner = makeCommandRunner(
      makeExecution("test_failure", {
        stderr: "src/file.ts\npackage/name\npackages/core/lib.ts",
      }),
    );
    const runner = new VerificationRunner({ registry, commandRunner });

    const result = await runner.run({ projectId: "p1", commandId: "p1.test", runId: "r1" });

    expect(result.failureSummary).toContain("src/file.ts");
    expect(result.failureSummary).toContain("package/name");
    expect(result.failureSummary).toContain("packages/core/lib.ts");
  });

  it("redacts all absolute path fragments and secrets from complex output", async () => {
    const registry = makeRegistry([makeCommand()]);
    const commandRunner = makeCommandRunner(
      makeExecution("test_failure", {
        stderr: 'at (/home/lenovo/project/src/a.ts:12)\nfile="/private/tmp/error.log"\nTOKEN=secret-value\nsrc/relative.ts',
      }),
    );
    const runner = new VerificationRunner({ registry, commandRunner });

    const result = await runner.run({ projectId: "p1", commandId: "p1.test", runId: "r1" });

    const allText = result.failureSummary + result.relatedPaths.join("");
    expect(allText).not.toContain("secret-value");
    expect(allText).not.toContain("/home/lenovo");
    expect(allText).not.toContain("/private/tmp");
    expect(result.relatedPaths).toContain("src/relative.ts");
    expect(result.relatedPaths.some((p) => p.includes("home"))).toBe(false);
    expect(result.relatedPaths.some((p) => p.includes("private"))).toBe(false);
  });
});

describe("VerificationRunner toFeedback", () => {
  it("projects a VerificationResult into an immutable feedback with repair count", async () => {
    const registry = makeRegistry([makeCommand()]);
    const commandRunner = makeCommandRunner(makeExecution("test_failure"));
    const runner = new VerificationRunner({ registry, commandRunner });

    const result = await runner.run({ projectId: "p1", commandId: "p1.test", runId: "r1" });
    const feedback = runner.toFeedback(result, 2);

    expect(feedback.classification).toBe("test_failure");
    expect(feedback.commandId).toBe("p1.test");
    expect(feedback.exitCode).toBe(1);
    expect(feedback.durationMs).toBe(100);
    expect(feedback.failureSummary).toBe(result.failureSummary);
    expect(feedback.relatedPaths).toEqual(result.relatedPaths);
    expect(feedback.repairAttempts).toBe(2);
  });
});

describe("VerificationRunner CommandRunner reject convergence", () => {
  it("catches a thrown Error and returns execution_error with redacted summary", async () => {
    const registry = makeRegistry([makeCommand()]);
    const throwingRunner: CommandRunner = {
      run: async () => {
        throw new Error("spawn failed TOKEN=secret-value at /home/user/project/src/file.ts");
      },
    };
    const runner = new VerificationRunner({ registry, commandRunner: throwingRunner });

    const result = await runner.run({ projectId: "p1", commandId: "p1.test", runId: "r1" });

    expect(result.classification).toBe("execution_error");
    expect(result.exitCode).toBeNull();
    expect(result.failureSummary).not.toContain("secret-value");
    expect(result.failureSummary).not.toContain("/home/user");
    expect(result.failureSummary.length).toBeLessThanOrEqual(2000);
  });

  it("catches a rejected promise and returns execution_error", async () => {
    const registry = makeRegistry([makeCommand()]);
    const rejectingRunner: CommandRunner = {
      run: async () => Promise.reject(new Error("timeout SIGKILL")),
    };
    const runner = new VerificationRunner({ registry, commandRunner: rejectingRunner });

    const result = await runner.run({ projectId: "p1", commandId: "p1.test", runId: "r1" });

    expect(result.classification).toBe("execution_error");
    expect(result.failureSummary).toContain("SIGKILL");
  });

  it("catches a non-Error throw and returns execution_error", async () => {
    const registry = makeRegistry([makeCommand()]);
    const throwingRunner: CommandRunner = {
      run: async () => {
        throw "string error TOKEN=leaked";
      },
    };
    const runner = new VerificationRunner({ registry, commandRunner: throwingRunner });

    const result = await runner.run({ projectId: "p1", commandId: "p1.test", runId: "r1" });

    expect(result.classification).toBe("execution_error");
    expect(result.failureSummary).not.toContain("leaked");
  });
});
