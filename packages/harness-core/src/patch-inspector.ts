export interface PatchMetadata {
  readonly byteLength: number;
  readonly affectedPaths: readonly string[];
}

export function extractDiffPath(header: string): string | null {
  const trimmed = header.trim();
  if (trimmed === "/dev/null") return null;
  if (trimmed.startsWith("b/")) return trimmed.slice(2);
  if (trimmed.startsWith("a/")) return trimmed.slice(2);
  return trimmed;
}

export function inspectUnifiedDiff(patch: string): PatchMetadata | undefined {
  const lines = patch.split("\n");
  const affectedPaths: string[] = [];
  let hasHunk = false;
  let hasFileHeader = false;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("--- ")) {
      if (i + 1 >= lines.length || !lines[i + 1].startsWith("+++ ")) {
        return undefined;
      }
      hasFileHeader = true;
      const oldPath = extractDiffPath(lines[i].slice(4));
      const newPath = extractDiffPath(lines[i + 1].slice(4));
      const path = newPath ?? oldPath;
      if (path !== null) {
        affectedPaths.push(path);
      }
      i += 2;
      continue;
    }

    if (line.startsWith("@@")) {
      hasHunk = true;
    }

    i++;
  }

  if (!hasFileHeader || !hasHunk || affectedPaths.length === 0) {
    return undefined;
  }

  return {
    byteLength: Buffer.byteLength(patch, "utf8"),
    affectedPaths: [...new Set(affectedPaths)],
  };
}
