import { realpathSync } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

import type { SearchMatch, WorkspaceFs } from "@todex/harness-core";
import { isSensitivePath, type PathResolver } from "@todex/harness-core";

export interface NodeWorkspaceFsOptions {
  readonly workspaceRoot: string;
}

const MAX_LIST_ENTRIES = 1_000;
const MAX_SEARCH_FILES = 1_000;
const MAX_SEARCH_LINE_LENGTH = 4_096;

export class NodeWorkspaceFs implements WorkspaceFs, PathResolver {
  private readonly root: string;

  constructor(options: NodeWorkspaceFsOptions) {
    this.root = realpathSync.native(resolve(options.workspaceRoot));
  }

  resolveCanonical(workspaceRoot: string, path: string): string {
    if (resolve(workspaceRoot) !== this.root) {
      throw new Error("workspace_root_mismatch");
    }
    return this.resolveChecked(path);
  }

  async list(path: string, maxDepth: number): Promise<readonly string[]> {
    const start = this.resolveChecked(path);
    const entries: string[] = [];
    await this.listFrom(start, maxDepth, entries);
    return entries;
  }

  async readText(path: string): Promise<string> {
    return readFile(this.resolveChecked(path), "utf8");
  }

  async searchText(path: string, query: string): Promise<readonly SearchMatch[]> {
    const start = this.resolveChecked(path);
    const files: string[] = [];
    await this.collectFiles(start, files);
    const matches: SearchMatch[] = [];
    for (const file of files) {
      const content = await readFile(file, "utf8");
      const relativePath = this.toRelative(file);
      for (const [index, line] of content.split(/\r?\n/).entries()) {
        if (line.includes(query)) {
          matches.push({ path: relativePath, line: index + 1, context: line.slice(0, MAX_SEARCH_LINE_LENGTH) });
        }
      }
    }
    return matches;
  }

  async snapshot(paths: readonly string[]): Promise<ReadonlyMap<string, string | undefined>> {
    const output = new Map<string, string | undefined>();
    for (const path of paths) {
      const target = this.resolveChecked(path, true);
      try {
        output.set(path, await readFile(target, "utf8"));
      } catch (error) {
        if (isMissing(error)) {
          output.set(path, undefined);
          continue;
        }
        throw error;
      }
    }
    return output;
  }

  async commit(next: ReadonlyMap<string, string | undefined>): Promise<void> {
    const resolved = [...next.entries()].map(([path, content]) => ({ path, content, target: this.resolveChecked(path, true) }));
    for (const entry of resolved) {
      if (entry.content === undefined) {
        await rm(entry.target, { force: true });
      } else {
        await mkdir(dirname(entry.target), { recursive: true });
        await writeFile(entry.target, entry.content, "utf8");
      }
    }
  }

  private resolveChecked(path: string, allowMissing = false): string {
    const candidate = resolve(this.root, path);
    if (!this.isWithinRoot(candidate)) {
      throw new Error("workspace_escape");
    }
    const canonical = this.canonicalize(candidate, allowMissing);
    if (!this.isWithinRoot(canonical)) {
      throw new Error("workspace_escape");
    }
    const relativePath = this.toRelative(canonical);
    if (isSensitivePath(relativePath)) {
      throw new Error("sensitive_path");
    }
    return canonical;
  }

  private canonicalize(candidate: string, allowMissing: boolean): string {
    try {
      return realpathSync(candidate);
    } catch (error) {
      if (!allowMissing || !isMissing(error)) {
        throw error;
      }
      const parent = dirname(candidate);
      if (parent === candidate) {
        throw error;
      }
      return resolve(this.canonicalize(parent, true), relative(parent, candidate));
    }
  }

  private isWithinRoot(candidate: string): boolean {
    return candidate === this.root || candidate.startsWith(`${this.root}\\`) || candidate.startsWith(`${this.root}/`);
  }

  private toRelative(path: string): string {
    return relative(this.root, path).replace(/\\/g, "/") || ".";
  }

  private async listFrom(directory: string, remainingDepth: number, entries: string[]): Promise<void> {
    if (entries.length >= MAX_LIST_ENTRIES) return;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = this.resolveChecked(this.toRelative(resolve(directory, entry.name)));
      const relativePath = this.toRelative(target);
      if (isSensitivePath(relativePath)) continue;
      entries.push(relativePath);
      if (entries.length >= MAX_LIST_ENTRIES) return;
      if (entry.isDirectory() && remainingDepth > 0) {
        await this.listFrom(target, remainingDepth - 1, entries);
      }
    }
  }

  private async collectFiles(target: string, files: string[]): Promise<void> {
    if (files.length >= MAX_SEARCH_FILES) return;
    const info = await stat(target);
    if (!info.isDirectory()) {
      files.push(target);
      return;
    }
    for (const entry of await readdir(target, { withFileTypes: true })) {
      const child = this.resolveChecked(this.toRelative(resolve(target, entry.name)));
      if (isSensitivePath(this.toRelative(child))) continue;
      if (entry.isDirectory()) {
        await this.collectFiles(child, files);
      } else if (entry.isFile()) {
        files.push(child);
      }
      if (files.length >= MAX_SEARCH_FILES) return;
    }
  }
}

function isMissing(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && (error as NodeJS.ErrnoException).code === "ENOENT";
}
