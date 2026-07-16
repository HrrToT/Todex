import type {
  ConfiguredCommand,
  VerificationClassification,
  VerificationResult,
} from "@todex/contracts";

export type CommandExecutionCondition =
  | "success"
  | "test_failure"
  | "quality_failure"
  | "build_failure"
  | "command_not_found"
  | "dependency_missing"
  | "timeout"
  | "execution_error"
  | "cancelled";

export interface CommandExecution {
  readonly exitCode: number | null;
  readonly durationMs: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly condition: CommandExecutionCondition;
}

export interface CommandRunner {
  run(input: {
    readonly argv: readonly string[];
    readonly workingDirectory: string;
    readonly timeoutMs: number;
  }): Promise<CommandExecution>;
}

export interface ConfiguredCommandRegistry {
  find(projectId: string, commandId: string): ConfiguredCommand | undefined;
}

export interface VerificationFeedback {
  readonly classification: VerificationClassification;
  readonly commandId: string;
  readonly exitCode: number | null;
  readonly durationMs: number;
  readonly failureSummary: string;
  readonly relatedPaths: readonly string[];
  readonly repairAttempts: number;
}

export interface VerificationRunnerDeps {
  readonly registry: ConfiguredCommandRegistry;
  readonly commandRunner: CommandRunner;
  readonly verificationIdFactory?: () => string;
}

const MAX_FAILURE_SUMMARY_LENGTH = 2000;
const MAX_RELATED_PATHS = 20;

const CONDITION_TO_CLASSIFICATION: Record<CommandExecutionCondition, VerificationClassification> = {
  success: "passed",
  test_failure: "test_failure",
  quality_failure: "quality_failure",
  build_failure: "build_failure",
  command_not_found: "command_not_found",
  dependency_missing: "dependency_missing",
  timeout: "timeout",
  execution_error: "execution_error",
  cancelled: "cancelled",
};

const SENSITIVE_VALUE_PATTERN =
  /((?:api[_-]?key|secret|token|password|credential|private[_-]?key)\s*[=:]\s*)[^\s,;\r\n]+/gi;

const WINDOWS_ABSOLUTE_PATH_PATTERN = /[A-Za-z]:[\\/][^\s\r\n]*/g;
const UNIX_ABSOLUTE_PATH_PATTERN = /(?<![^\s])(\/[^\s\r\n]*)/g;

const RELATIVE_PATH_PATTERN = /(?:[a-zA-Z0-9_.-]+\/)+[a-zA-Z0-9_.-]+\.[a-zA-Z0-9]+/g;

function redactSensitiveValues(text: string): string {
  return text.replace(SENSITIVE_VALUE_PATTERN, "$1[REDACTED]");
}

function redactAbsolutePaths(text: string): string {
  return text
    .replace(WINDOWS_ABSOLUTE_PATH_PATTERN, "[REDACTED_PATH]")
    .replace(UNIX_ABSOLUTE_PATH_PATTERN, "[REDACTED_PATH]");
}

function applyRedaction(stdout: string, stderr: string): string {
  const combined = `${stdout}\n${stderr}`;
  return redactAbsolutePaths(redactSensitiveValues(combined));
}

function truncateSummary(text: string): string {
  if (text.length <= MAX_FAILURE_SUMMARY_LENGTH) {
    return text;
  }
  return text.slice(0, MAX_FAILURE_SUMMARY_LENGTH);
}

function extractRelatedPaths(redactedText: string): string[] {
  const matches = redactedText.match(RELATIVE_PATH_PATTERN) ?? [];
  const unique = [...new Set(matches)];
  return unique.slice(0, MAX_RELATED_PATHS);
}

let verificationCounter = 0;
function defaultVerificationIdFactory(): string {
  verificationCounter += 1;
  return `verification-${verificationCounter}`;
}

export class VerificationRunner {
  private readonly registry: ConfiguredCommandRegistry;
  private readonly commandRunner: CommandRunner;
  private readonly verificationIdFactory: () => string;

  constructor(deps: VerificationRunnerDeps) {
    this.registry = deps.registry;
    this.commandRunner = deps.commandRunner;
    this.verificationIdFactory = deps.verificationIdFactory ?? defaultVerificationIdFactory;
  }

  async run(input: {
    readonly projectId: string;
    readonly commandId: string;
    readonly runId: string;
  }): Promise<VerificationResult> {
    const command = this.registry.find(input.projectId, input.commandId);

    if (!command || !command.confirmedByUser) {
      return {
        verificationId: this.verificationIdFactory(),
        runId: input.runId,
        commandId: input.commandId,
        classification: "command_not_found",
        exitCode: null,
        durationMs: 0,
        failureSummary: "command not found or not confirmed",
        relatedPaths: [],
      };
    }

    const execution = await this.commandRunner.run({
      argv: command.argv,
      workingDirectory: command.workingDirectory,
      timeoutMs: command.timeoutMs,
    });

    const classification = CONDITION_TO_CLASSIFICATION[execution.condition];
    const redacted = applyRedaction(execution.stdout, execution.stderr);
    const failureSummary = truncateSummary(redacted);
    const relatedPaths = extractRelatedPaths(redacted);

    return {
      verificationId: this.verificationIdFactory(),
      runId: input.runId,
      commandId: input.commandId,
      classification,
      exitCode: execution.exitCode,
      durationMs: execution.durationMs,
      failureSummary,
      relatedPaths,
    };
  }

  toFeedback(result: VerificationResult, repairAttempts: number): VerificationFeedback {
    return {
      classification: result.classification,
      commandId: result.commandId,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      failureSummary: result.failureSummary,
      relatedPaths: result.relatedPaths,
      repairAttempts,
    };
  }
}
