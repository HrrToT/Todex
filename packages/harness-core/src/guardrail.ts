import type { Action, ApprovalRequest } from "@todex/contracts";
import type {
  Clock,
  GovernanceContext,
  GovernanceController,
  GovernanceDecision,
  ApprovalStore,
} from "./llm.js";

export interface PathResolver {
  resolveCanonical(workspaceRoot: string, path: string): string;
}

const SHELL_CONCAT_PATTERN = /[;&|><`\r\n]|\$\(/;
const ENCODED_POWERSHELL_PATTERN = /-EncodedCommand|Invoke-Expression|\biex\b/i;
const ELEVATION_PATTERN = /\bsudo\b|\brunas\b/i;
const SYSTEM_CONFIG_PATTERN = /\breg\s+(add|delete|import)\b|Set-ItemProperty|system32/i;

const POWERSHELL_EXECUTABLES = new Set(["powershell", "pwsh"]);
const POWERSHELL_ENCODED_FLAGS = new Set(["-encodedcommand", "-enc", "-e"]);
const POWERSHELL_POLICY_FLAGS = new Set(["-executionpolicy", "-ep"]);

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export function computeActionFingerprint(action: Action, projectId: string): string {
  switch (action.tool) {
    case "run_shell_command_with_approval": {
      const tokens = action.command.trim().split(/\s+/);
      const executable = (tokens[0] ?? "").toLowerCase();
      const subcommandTokens = tokens.slice(1);
      return `run_shell_command_with_approval:${projectId}:${executable}:${subcommandTokens.join(" ")}`;
    }
    default:
      return `${action.tool}:${projectId}`;
  }
}

function normalizePath(p: string): string {
  p = p.replace(/\\/g, "/");
  const isAbsolute = p.startsWith("/") || /^[A-Za-z]:/.test(p);
  const parts = p.split("/");
  const result: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (result.length > 0 && result[result.length - 1] !== "..") {
        result.pop();
      } else {
        result.push("..");
      }
    } else {
      result.push(part);
    }
  }
  const body = result.join("/");
  if (isAbsolute && !/^[A-Za-z]:/.test(body)) {
    return "/" + body;
  }
  return body;
}

function isWithinWorkspace(canonicalPath: string, workspaceRoot: string): boolean {
  const root = normalizePath(workspaceRoot);
  return canonicalPath === root || canonicalPath.startsWith(root + "/");
}

function getRelativePath(canonicalPath: string, workspaceRoot: string): string {
  const root = normalizePath(workspaceRoot);
  if (canonicalPath === root) return ".";
  if (canonicalPath.startsWith(root + "/")) {
    return canonicalPath.slice(root.length + 1);
  }
  return canonicalPath;
}

function isSensitivePath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/");
  const segments = normalized.split("/").filter((s) => s !== "");
  const basename = (segments[segments.length - 1] ?? "").toLowerCase();

  if (basename === ".env") return true;
  if (basename.startsWith(".env.") && basename !== ".env.example") return true;
  if (basename === ".npmrc") return true;
  if (basename === ".pypirc") return true;
  if (basename === ".netrc") return true;
  if (/^credentials\./.test(basename)) return true;
  if (/^secrets\./.test(basename)) return true;
  if (basename.endsWith(".pem")) return true;
  if (basename.endsWith(".key")) return true;
  if (basename === "id_rsa") return true;
  if (basename === "id_ed25519") return true;

  const lowerSegments = segments.map((s) => s.toLowerCase());
  if (lowerSegments.includes(".aws")) return true;
  if (lowerSegments.includes(".ssh")) return true;

  for (let i = 0; i < lowerSegments.length - 1; i++) {
    if (lowerSegments[i] === ".git" && lowerSegments[i + 1] === "config") return true;
  }

  return false;
}

interface ShellClassification {
  readonly decision: "require_approval" | "deny";
  readonly denyReason?: string;
  readonly riskReasons: string[];
}

function extractExecutable(command: string): { executable: string; rest: string } {
  const trimmed = command.trim();
  if (trimmed.startsWith('"')) {
    const end = trimmed.indexOf('"', 1);
    if (end === -1) {
      return { executable: trimmed.slice(1), rest: "" };
    }
    return { executable: trimmed.slice(1, end), rest: trimmed.slice(end + 1) };
  }
  const match = trimmed.match(/^(\S+)/);
  if (!match) {
    return { executable: "", rest: "" };
  }
  return { executable: match[1], rest: trimmed.slice(match[1].length) };
}

function executableBasename(executable: string): string {
  const normalized = executable.replace(/\\/g, "/");
  const lastSlash = normalized.lastIndexOf("/");
  const basename = lastSlash === -1 ? normalized : normalized.slice(lastSlash + 1);
  return basename.toLowerCase().replace(/\.exe$/, "");
}

function detectPowerShellObfuscation(command: string): string | undefined {
  const { executable, rest } = extractExecutable(command);
  const basename = executableBasename(executable);
  if (!POWERSHELL_EXECUTABLES.has(basename)) return undefined;

  const tokens = rest.trim().split(/\s+/).filter((s) => s !== "");
  for (const token of tokens) {
    const flag = token.toLowerCase().split(":")[0];
    if (POWERSHELL_ENCODED_FLAGS.has(flag)) return "complex_shell";
    if (POWERSHELL_POLICY_FLAGS.has(flag)) return "privilege_or_system_command";
  }
  return undefined;
}

function classifyShellCommand(command: string): ShellClassification {
  const riskReasons: string[] = ["free_shell"];

  if (SHELL_CONCAT_PATTERN.test(command)) {
    return { decision: "deny", denyReason: "complex_shell", riskReasons };
  }
  if (ENCODED_POWERSHELL_PATTERN.test(command)) {
    return { decision: "deny", denyReason: "complex_shell", riskReasons };
  }
  const powershellReason = detectPowerShellObfuscation(command);
  if (powershellReason) {
    return { decision: "deny", denyReason: powershellReason, riskReasons };
  }
  if (ELEVATION_PATTERN.test(command)) {
    return { decision: "deny", denyReason: "privilege_or_system_command", riskReasons };
  }
  if (SYSTEM_CONFIG_PATTERN.test(command)) {
    return { decision: "deny", denyReason: "privilege_or_system_command", riskReasons };
  }

  const lowerCommand = command.toLowerCase();
  if (/\bnpm\s+install\b|\bpip\s+install\b|\bpnpm\s+install\b|\byarn\s+install\b/.test(lowerCommand)) {
    riskReasons.push("dependency_install");
  }
  if (/\brm\b|\bdel\b|\brmdir\b|\bremove-item\b/i.test(command)) {
    riskReasons.push("deletion");
  }
  if (/\bgit\s+(commit|push|reset|rebase|merge|cherry-pick)\b/.test(lowerCommand)) {
    riskReasons.push("git_modification");
  }
  if (/\bcurl\b|\bwget\b|\binvoke-webrequest\b/i.test(command)) {
    riskReasons.push("network_command");
  }
  if (/\.github[\\/]workflows[\\/]|render\.yaml/i.test(command)) {
    riskReasons.push("ci_deployment_change");
  }

  return { decision: "require_approval", riskReasons };
}

interface PathCheckResult {
  readonly decision: "allow" | "deny" | "skip";
  readonly denyReason?: string;
}

function checkActionPath(
  action: Action,
  workspaceRoot: string,
  resolver: PathResolver,
): PathCheckResult {
  let pathToCheck: string | undefined;

  switch (action.tool) {
    case "list_files":
      pathToCheck = action.path;
      break;
    case "read_file":
      pathToCheck = action.path;
      break;
    case "search_text":
      pathToCheck = action.path;
      break;
    case "run_shell_command_with_approval":
      pathToCheck = action.cwd;
      break;
    default:
      return { decision: "skip" };
  }

  if (pathToCheck === undefined) {
    return { decision: "allow" };
  }

  const canonical = resolver.resolveCanonical(workspaceRoot, pathToCheck);
  if (!isWithinWorkspace(canonical, workspaceRoot)) {
    return { decision: "deny", denyReason: "workspace_escape" };
  }

  const relative = getRelativePath(canonical, workspaceRoot);
  if (isSensitivePath(relative)) {
    return { decision: "deny", denyReason: "sensitive_path" };
  }

  return { decision: "allow" };
}

export interface GuardrailDeps {
  readonly pathResolver: PathResolver;
  readonly approvalStore: ApprovalStore;
  readonly clock: Clock;
  readonly approvalIdFactory: () => string;
}

export class Guardrail implements GovernanceController {
  private readonly pathResolver: PathResolver;
  private readonly approvalStore: ApprovalStore;
  private readonly clock: Clock;
  private readonly approvalIdFactory: () => string;

  constructor(deps: GuardrailDeps) {
    this.pathResolver = deps.pathResolver;
    this.approvalStore = deps.approvalStore;
    this.clock = deps.clock;
    this.approvalIdFactory = deps.approvalIdFactory;
  }

  evaluate(action: Action, context: GovernanceContext): GovernanceDecision {
    const classification = this.classify(action, context.workspaceRoot);

    if (classification.decision === "deny") {
      return { decision: "deny", reason: classification.denyReason! };
    }

    if (classification.decision === "allow") {
      return { decision: "allow", reason: "safe_action" };
    }

    const now = this.clock.now();
    if (this.approvalStore.matchesGrant(context, action, now)) {
      return { decision: "allow", reason: "approved_scope" };
    }

    const fingerprint = computeActionFingerprint(action, context.projectId);
    const request: ApprovalRequest = {
      approvalId: this.approvalIdFactory(),
      runId: context.runId,
      actionId: context.actionId,
      tool: action.tool,
      riskReasons: classification.riskReasons,
      fingerprint,
      state: "pending",
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + SEVEN_DAYS_MS).toISOString(),
    };

    return { decision: "require_approval", request };
  }

  private classify(
    action: Action,
    workspaceRoot: string,
  ):
    | { decision: "allow" }
    | { decision: "deny"; denyReason: string }
    | { decision: "require_approval"; riskReasons: string[] } {
    switch (action.tool) {
      case "list_files":
      case "read_file":
      case "search_text": {
        const pathCheck = checkActionPath(action, workspaceRoot, this.pathResolver);
        if (pathCheck.decision === "deny") {
          return { decision: "deny", denyReason: pathCheck.denyReason! };
        }
        return { decision: "allow" };
      }

      case "run_shell_command_with_approval": {
        if (action.cwd) {
          const cwdCheck = checkActionPath(action, workspaceRoot, this.pathResolver);
          if (cwdCheck.decision === "deny") {
            return { decision: "deny", denyReason: cwdCheck.denyReason! };
          }
        }
        const shellResult = classifyShellCommand(action.command);
        if (shellResult.decision === "deny") {
          return { decision: "deny", denyReason: shellResult.denyReason! };
        }
        return { decision: "require_approval", riskReasons: shellResult.riskReasons };
      }

      case "apply_patch":
      case "remember":
      case "finish":
      case "run_configured_command":
        return { decision: "allow" };
    }
  }
}
