import type { Action, ToolResult } from "@todex/contracts";
import type { ToolDispatcher } from "./llm.js";
import type { PathResolver } from "./guardrail.js";
import {
  getRelativePath,
  isSensitivePath,
  isWithinWorkspace,
} from "./guardrail.js";

export interface SearchMatch {
  readonly path: string;
  readonly line: number;
  readonly context: string;
}

export interface WorkspaceFs {
  list(path: string, maxDepth: number): Promise<readonly string[]>;
  readText(path: string): Promise<string>;
  searchText(path: string, query: string): Promise<readonly SearchMatch[]>;
  snapshot(paths: readonly string[]): Promise<ReadonlyMap<string, string | undefined>>;
  commit(next: ReadonlyMap<string, string | undefined>): Promise<void>;
}

export interface PatchMetadata {
  readonly byteLength: number;
  readonly affectedPaths: readonly string[];
}

export interface FileToolsDeps {
  readonly workspaceRoot: string;
  readonly fs: WorkspaceFs;
  readonly pathResolver: PathResolver;
}

const MAX_LIST_ENTRIES = 100;
const MAX_READ_BYTES = 64 * 1024;
const MAX_SEARCH_RESULTS = 20;
const MAX_SEARCH_CONTEXT_CHARS = 240;
const DEFAULT_MAX_DEPTH = 8;

interface PathCheck {
  readonly ok: boolean;
  readonly reason?: string;
  readonly relative?: string;
}

function checkPath(
  path: string,
  workspaceRoot: string,
  resolver: PathResolver,
): PathCheck {
  const canonical = resolver.resolveCanonical(workspaceRoot, path);
  if (!isWithinWorkspace(canonical, workspaceRoot)) {
    return { ok: false, reason: "workspace_escape" };
  }
  const relative = getRelativePath(canonical, workspaceRoot);
  if (isSensitivePath(relative)) {
    return { ok: false, reason: "sensitive_path" };
  }
  return { ok: true, relative };
}

function makeResultId(actionId: string): string {
  return `${actionId}-result`;
}

function rejected(actionId: string, reason: string): ToolResult {
  return {
    resultId: makeResultId(actionId),
    actionId,
    status: "rejected",
    summary: `denied: ${reason}`,
  };
}

function failed(actionId: string, summary: string): ToolResult {
  return {
    resultId: makeResultId(actionId),
    actionId,
    status: "failed",
    summary,
  };
}

function succeeded(actionId: string, summary: string, truncatedOutput?: string): ToolResult {
  return {
    resultId: makeResultId(actionId),
    actionId,
    status: "succeeded",
    summary,
    ...(truncatedOutput !== undefined ? { truncatedOutput } : {}),
  };
}

function truncateContent(content: string): { text: string; truncated: boolean } {
  const byteLength = Buffer.byteLength(content, "utf8");
  if (byteLength <= MAX_READ_BYTES) {
    return { text: content, truncated: false };
  }
  let text = content;
  let currentBytes = byteLength;
  while (currentBytes > MAX_READ_BYTES && text.length > 0) {
    text = text.slice(0, Math.floor(text.length * (MAX_READ_BYTES / currentBytes)));
    currentBytes = Buffer.byteLength(text, "utf8");
  }
  return { text, truncated: true };
}

function truncateContext(context: string): string {
  if (context.length <= MAX_SEARCH_CONTEXT_CHARS) {
    return context;
  }
  return context.slice(0, MAX_SEARCH_CONTEXT_CHARS);
}

export class FileTools implements ToolDispatcher {
  private readonly workspaceRoot: string;
  private readonly fs: WorkspaceFs;
  private readonly pathResolver: PathResolver;

  constructor(deps: FileToolsDeps) {
    this.workspaceRoot = deps.workspaceRoot;
    this.fs = deps.fs;
    this.pathResolver = deps.pathResolver;
  }

  async dispatch(
    action: Action,
    context: { runId: string; actionId: string },
  ): Promise<ToolResult> {
    switch (action.tool) {
      case "list_files":
        return this.handleListFiles(action, context);
      case "read_file":
        return this.handleReadFile(action, context);
      case "search_text":
        return this.handleSearchText(action, context);
      case "apply_patch":
        return this.handleApplyPatch(action, context);
      default:
        return {
          resultId: makeResultId(context.actionId),
          actionId: context.actionId,
          status: "skipped",
          summary: "unsupported_file_tool",
        };
    }
  }

  private async handleListFiles(
    action: Action,
    context: { runId: string; actionId: string },
  ): Promise<ToolResult> {
    if (action.tool !== "list_files") {
      return failed(context.actionId, "internal_error");
    }
    const pathCheck = checkPath(action.path, this.workspaceRoot, this.pathResolver);
    if (!pathCheck.ok) {
      return rejected(context.actionId, pathCheck.reason!);
    }

    let entries: readonly string[];
    try {
      entries = await this.fs.list(action.path, action.maxDepth ?? DEFAULT_MAX_DEPTH);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return failed(context.actionId, `list error: ${message}`);
    }

    const filtered = entries.filter((p) => !isSensitivePath(p));

    if (filtered.length > MAX_LIST_ENTRIES) {
      return succeeded(
        context.actionId,
        filtered.slice(0, MAX_LIST_ENTRIES).join("\n"),
        "[truncated]",
      );
    }
    return succeeded(context.actionId, filtered.join("\n"));
  }

  private async handleReadFile(
    action: Action,
    context: { runId: string; actionId: string },
  ): Promise<ToolResult> {
    if (action.tool !== "read_file") {
      return failed(context.actionId, "internal_error");
    }
    const pathCheck = checkPath(action.path, this.workspaceRoot, this.pathResolver);
    if (!pathCheck.ok) {
      return rejected(context.actionId, pathCheck.reason!);
    }

    let content: string;
    try {
      content = await this.fs.readText(action.path);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return failed(context.actionId, `read error: ${message}`);
    }

    const { text, truncated } = truncateContent(content);
    if (truncated) {
      return succeeded(context.actionId, text, "[truncated]");
    }
    return succeeded(context.actionId, text);
  }

  private async handleSearchText(
    action: Action,
    context: { runId: string; actionId: string },
  ): Promise<ToolResult> {
    if (action.tool !== "search_text") {
      return failed(context.actionId, "internal_error");
    }
    const searchPath = action.path ?? ".";
    const pathCheck = checkPath(searchPath, this.workspaceRoot, this.pathResolver);
    if (!pathCheck.ok) {
      return rejected(context.actionId, pathCheck.reason!);
    }

    let matches: readonly SearchMatch[];
    try {
      matches = await this.fs.searchText(searchPath, action.query);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return failed(context.actionId, `search error: ${message}`);
    }

    const filtered = matches.filter((m) => !isSensitivePath(m.path));
    const maxResults = Math.min(action.maxResults || 20, MAX_SEARCH_RESULTS);
    const truncated = filtered.length > maxResults;
    const limited = filtered.slice(0, maxResults);
    const formatted = limited
      .map((m) => `${m.path}:${m.line}:${truncateContext(m.context)}`)
      .join("\n");

    if (truncated) {
      return succeeded(context.actionId, formatted, "[truncated]");
    }
    return succeeded(context.actionId, formatted);
  }

  private async handleApplyPatch(
    _action: Action,
    context: { runId: string; actionId: string },
  ): Promise<ToolResult> {
    return {
      resultId: makeResultId(context.actionId),
      actionId: context.actionId,
      status: "skipped",
      summary: "patch_not_implemented",
    };
  }
}
