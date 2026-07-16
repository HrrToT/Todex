import type { Action, ToolResult } from "@todex/contracts";
import type { ToolDispatcher } from "./llm.js";
import type { PathResolver } from "./guardrail.js";
import { checkPath, isSensitivePath } from "./guardrail.js";
import { inspectUnifiedDiff, extractDiffPath } from "./patch-inspector.js";
import type { MemoryStore } from "./memory-store.js";
import type { TraceStore } from "./trace-store.js";

export type { PatchMetadata } from "./patch-inspector.js";
export { inspectUnifiedDiff } from "./patch-inspector.js";

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

interface ParsedDiffLine {
  type: "context" | "add" | "remove";
  content: string;
}

interface ParsedHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: ParsedDiffLine[];
}

interface ParsedDiffFile {
  oldPath: string | null;
  newPath: string | null;
  hunks: ParsedHunk[];
}

function parseHunkHeader(line: string): { oldStart: number; oldCount: number; newStart: number; newCount: number } | null {
  const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
  if (!match) return null;
  const oldStart = parseInt(match[1], 10);
  const oldCount = match[2] !== undefined ? parseInt(match[2], 10) : 1;
  const newStart = parseInt(match[3], 10);
  const newCount = match[4] !== undefined ? parseInt(match[4], 10) : 1;
  return { oldStart, oldCount, newStart, newCount };
}

function parseUnifiedDiff(patch: string): ParsedDiffFile[] | null {
  const lines = patch.split("\n");
  const files: ParsedDiffFile[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("diff --git") || line.startsWith("index ")) {
      i++;
      continue;
    }

    if (line.startsWith("--- ")) {
      if (i + 1 >= lines.length || !lines[i + 1].startsWith("+++ ")) {
        return null;
      }
      const oldPath = extractDiffPath(lines[i].slice(4));
      const newPath = extractDiffPath(lines[i + 1].slice(4));
      i += 2;

      const hunks: ParsedHunk[] = [];

      while (i < lines.length && lines[i].startsWith("@@")) {
        const hunkHeader = parseHunkHeader(lines[i]);
        if (hunkHeader === null) return null;
        i++;

        const hunkLines: ParsedDiffLine[] = [];

        while (i < lines.length) {
          const hunkLine = lines[i];
          if (
            hunkLine.startsWith("@@") ||
            hunkLine.startsWith("--- ") ||
            hunkLine.startsWith("diff --git")
          ) {
            break;
          }
          if (hunkLine.startsWith(" ")) {
            hunkLines.push({ type: "context", content: hunkLine.slice(1) });
          } else if (hunkLine.startsWith("-")) {
            hunkLines.push({ type: "remove", content: hunkLine.slice(1) });
          } else if (hunkLine.startsWith("+")) {
            hunkLines.push({ type: "add", content: hunkLine.slice(1) });
          } else if (hunkLine.startsWith("\\")) {
            // No newline at end of file marker - skip
          } else {
            break;
          }
          i++;
        }

        const contextLineCount = hunkLines.filter((l) => l.type === "context").length;
        const removeLineCount = hunkLines.filter((l) => l.type === "remove").length;
        const addLineCount = hunkLines.filter((l) => l.type === "add").length;
        if (hunkHeader.oldCount !== contextLineCount + removeLineCount) return null;
        if (hunkHeader.newCount !== contextLineCount + addLineCount) return null;

        hunks.push({ ...hunkHeader, lines: hunkLines });
      }

      if (hunks.length === 0) return null;
      files.push({ oldPath, newPath, hunks });
    } else {
      i++;
    }
  }

  if (files.length === 0) return null;
  return files;
}

function applyHunks(
  content: string | undefined,
  hunks: ParsedHunk[],
): { ok: boolean; result: string | undefined } {
  let lines: string[];
  let hadTrailingNewline: boolean;

  if (content === undefined) {
    lines = [];
    hadTrailingNewline = true;
  } else {
    hadTrailingNewline = content.endsWith("\n");
    lines = content.split("\n");
    if (hadTrailingNewline && lines.length > 0 && lines[lines.length - 1] === "") {
      lines.pop();
    }
  }

  let offset = 0;

  for (const hunk of hunks) {
    const oldLines: string[] = [];
    const newLines: string[] = [];

    for (const line of hunk.lines) {
      if (line.type === "context") {
        oldLines.push(line.content);
        newLines.push(line.content);
      } else if (line.type === "remove") {
        oldLines.push(line.content);
      } else if (line.type === "add") {
        newLines.push(line.content);
      }
    }

    if (hunk.oldStart === 0 && hunk.oldCount === 0) {
      if (oldLines.length !== 0) {
        return { ok: false, result: content };
      }
      lines = [...newLines];
      offset += newLines.length;
      continue;
    }

    const startPos = hunk.oldStart - 1 + offset;

    for (let j = 0; j < oldLines.length; j++) {
      if (startPos + j >= lines.length || lines[startPos + j] !== oldLines[j]) {
        return { ok: false, result: content };
      }
    }

    lines = [
      ...lines.slice(0, startPos),
      ...newLines,
      ...lines.slice(startPos + oldLines.length),
    ];

    offset += newLines.length - oldLines.length;
  }

  if (lines.length === 0) {
    return { ok: true, result: undefined };
  }

  return { ok: true, result: lines.join("\n") + (hadTrailingNewline ? "\n" : "") };
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
    context: { runId: string; actionId: string; projectId: string },
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
    const pathCheck = checkPath(this.workspaceRoot, action.path, this.pathResolver);
    if (pathCheck.decision === "deny") {
      return rejected(context.actionId, pathCheck.denyReason!);
    }

    let entries: readonly string[];
    try {
      entries = await this.fs.list(action.path, action.maxDepth ?? DEFAULT_MAX_DEPTH);
    } catch {
      return failed(context.actionId, "list_failed");
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
    const pathCheck = checkPath(this.workspaceRoot, action.path, this.pathResolver);
    if (pathCheck.decision === "deny") {
      return rejected(context.actionId, pathCheck.denyReason!);
    }

    let content: string;
    try {
      content = await this.fs.readText(action.path);
    } catch {
      return failed(context.actionId, "read_failed");
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
    const pathCheck = checkPath(this.workspaceRoot, searchPath, this.pathResolver);
    if (pathCheck.decision === "deny") {
      return rejected(context.actionId, pathCheck.denyReason!);
    }

    let matches: readonly SearchMatch[];
    try {
      matches = await this.fs.searchText(searchPath, action.query);
    } catch {
      return failed(context.actionId, "search_failed");
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
    action: Action,
    context: { runId: string; actionId: string },
  ): Promise<ToolResult> {
    if (action.tool !== "apply_patch") {
      return failed(context.actionId, "internal_error");
    }

    const metadata = inspectUnifiedDiff(action.patch);
    if (metadata === undefined) {
      return failed(context.actionId, "patch_invalid");
    }

    for (const target of metadata.affectedPaths) {
      const pathCheck = checkPath(this.workspaceRoot, target, this.pathResolver);
      if (pathCheck.decision === "deny") {
        return rejected(context.actionId, pathCheck.denyReason!);
      }
    }

    const files = parseUnifiedDiff(action.patch);
    if (files === null) {
      return failed(context.actionId, "patch_invalid");
    }

    const paths = files
      .map((f) => f.newPath ?? f.oldPath)
      .filter((p): p is string => p !== null);
    let snapshot: ReadonlyMap<string, string | undefined>;
    try {
      snapshot = await this.fs.snapshot(paths);
    } catch {
      return failed(context.actionId, "snapshot_failed");
    }

    const next = new Map<string, string | undefined>();
    for (const file of files) {
      const path = file.newPath ?? file.oldPath;
      if (path === null) continue;

      const current = snapshot.get(path);
      const result = applyHunks(current, file.hunks);
      if (!result.ok) {
        return failed(context.actionId, "patch_conflict");
      }

      if (file.newPath === null && file.oldPath !== null) {
        next.set(file.oldPath, undefined);
      } else {
        next.set(path, result.result);
      }
    }

    try {
      await this.fs.commit(next);
    } catch {
      return failed(context.actionId, "commit_failed");
    }

    return succeeded(context.actionId, `patch applied: ${files.length} file(s)`);
  }
}

export interface HarnessDispatcherDeps {
  readonly fileTools: FileTools;
  readonly memoryStore: MemoryStore;
  readonly traceStore: TraceStore;
}

export class HarnessDispatcher implements ToolDispatcher {
  private readonly fileTools: FileTools;
  private readonly memoryStore: MemoryStore;
  private readonly traceStore: TraceStore;

  constructor(deps: HarnessDispatcherDeps) {
    this.fileTools = deps.fileTools;
    this.memoryStore = deps.memoryStore;
    this.traceStore = deps.traceStore;
  }

  async dispatch(
    action: Action,
    context: { runId: string; actionId: string; projectId: string },
  ): Promise<ToolResult> {
    switch (action.tool) {
      case "list_files":
      case "read_file":
      case "search_text":
      case "apply_patch":
        return this.fileTools.dispatch(action, context);
      case "remember":
        return this.handleRemember(action, context);
      default:
        return {
          resultId: makeResultId(context.actionId),
          actionId: context.actionId,
          status: "skipped",
          summary: "unsupported_tool",
        };
    }
  }

  private handleRemember(
    action: Action,
    context: { runId: string; actionId: string; projectId: string },
  ): ToolResult {
    if (action.tool !== "remember") {
      return failed(context.actionId, "internal_error");
    }

    const validEventIds = new Set(
      this.traceStore.list(context.runId).map((e) => e.eventId),
    );

    const seen = new Set<string>();
    for (const id of action.traceEventIds) {
      if (!validEventIds.has(id) || seen.has(id)) {
        return failed(context.actionId, "invalid_trace_evidence");
      }
      seen.add(id);
    }

    try {
      this.memoryStore.remember({
        projectId: context.projectId,
        kind: action.kind,
        trustLevel: "agent_observed",
        content: action.content,
        sourceTraceIds: [...action.traceEventIds],
      });
      return succeeded(context.actionId, `remembered: ${action.kind}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "sensitive_content") {
        return failed(context.actionId, "sensitive_content");
      }
      if (message.startsWith("invalid memory entry")) {
        return failed(context.actionId, "remember_invalid");
      }
      return failed(context.actionId, "remember_failed");
    }
  }
}
