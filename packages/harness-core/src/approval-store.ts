import type { Action, ApprovalRequest, ApprovalScope } from "@todex/contracts";
import type { Clock, GovernanceContext } from "./llm.js";
import { computeActionFingerprint } from "./guardrail.js";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const NON_PREFIXABLE_REASONS = new Set([
  "dependency_install",
  "deletion",
  "git_modification",
  "network_command",
  "ci_deployment_change",
]);

interface Grant {
  readonly runId: string;
  readonly fingerprint: string;
  readonly scope: "run" | "command_prefix";
  readonly expiresAt?: Date;
}

export interface InMemoryApprovalStoreOptions {
  readonly clock: Clock;
  readonly idFactory: () => string;
}

export class InMemoryApprovalStore {
  private readonly requests = new Map<string, ApprovalRequest>();
  private readonly grants: Grant[] = [];
  private readonly clock: Clock;
  private readonly idFactory: () => string;

  constructor(options: InMemoryApprovalStoreOptions) {
    this.clock = options.clock;
    this.idFactory = options.idFactory;
  }

  create(request: ApprovalRequest): ApprovalRequest {
    const stored: ApprovalRequest = {
      ...request,
      riskReasons: [...request.riskReasons],
    };
    this.requests.set(stored.approvalId, stored);
    return { ...stored, riskReasons: [...stored.riskReasons] };
  }

  get(approvalId: string): ApprovalRequest | undefined {
    const request = this.requests.get(approvalId);
    return request
      ? { ...request, riskReasons: [...request.riskReasons] }
      : undefined;
  }

  decide(approvalId: string, decision: ApprovalScope, now: Date): ApprovalRequest {
    const request = this.requests.get(approvalId);
    if (!request) {
      throw new Error("approval_not_found");
    }
    if (request.state !== "pending") {
      throw new Error("approval_already_decided");
    }

    if (request.expiresAt) {
      const expiry = new Date(request.expiresAt);
      if (now > expiry) {
        const expired: ApprovalRequest = {
          ...request,
          state: "expired",
        };
        this.requests.set(approvalId, expired);
        throw new Error("approval_expired");
      }
    }

    if (decision === "deny") {
      const denied: ApprovalRequest = {
        ...request,
        state: "denied",
        decision: "deny",
        decidedAt: now.toISOString(),
        riskReasons: [...request.riskReasons],
      };
      this.requests.set(approvalId, denied);
      return { ...denied, riskReasons: [...denied.riskReasons] };
    }

    const approved: ApprovalRequest = {
      ...request,
      state: "approved",
      decision,
      decidedAt: now.toISOString(),
      riskReasons: [...request.riskReasons],
    };
    this.requests.set(approvalId, approved);

    if (decision === "run") {
      this.grants.push({
        runId: request.runId,
        fingerprint: request.fingerprint,
        scope: "run",
      });
    } else if (decision === "command_prefix") {
      if (this.isPrefixable(request)) {
        this.grants.push({
          runId: request.runId,
          fingerprint: request.fingerprint,
          scope: "command_prefix",
          expiresAt: new Date(now.getTime() + SEVEN_DAYS_MS),
        });
      }
    }

    return { ...approved, riskReasons: [...approved.riskReasons] };
  }

  matchesGrant(context: GovernanceContext, action: Action, now: Date): boolean {
    const fingerprint = computeActionFingerprint(action, context.projectId);

    for (const grant of this.grants) {
      if (grant.fingerprint !== fingerprint) {
        continue;
      }

      if (grant.scope === "run" && grant.runId === context.runId) {
        return true;
      }

      if (grant.scope === "command_prefix") {
        if (!grant.expiresAt || grant.expiresAt > now) {
          return true;
        }
      }
    }

    return false;
  }

  private isPrefixable(request: ApprovalRequest): boolean {
    if (request.tool !== "run_shell_command_with_approval") {
      return false;
    }
    return !request.riskReasons.some((r) => NON_PREFIXABLE_REASONS.has(r));
  }
}
