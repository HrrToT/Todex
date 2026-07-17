export interface ProjectMetadataReader {
  readText(relativePath: string): string | undefined;
}

export type ProjectKind = "node" | "python";

export interface DetectedCommandCandidate {
  readonly candidateId: string;
  readonly purpose: "test" | "lint" | "typecheck" | "build";
  readonly argv: readonly string[];
  readonly workingDirectory: ".";
  readonly timeoutMs: 120_000;
  readonly confirmedByUser: false;
  readonly reason: string;
}

export interface DetectedProjectProfile {
  readonly kinds: readonly ProjectKind[];
  readonly candidates: readonly DetectedCommandCandidate[];
  readonly notices: readonly string[];
}

const NODE_SCRIPT_RULES = [
  { name: "test", purpose: "test", buildArgv: (manager: string) => [manager, "test"] },
  { name: "lint", purpose: "lint", buildArgv: (manager: string) => [manager, "run", "lint"] },
  { name: "typecheck", purpose: "typecheck", buildArgv: (manager: string) => [manager, "run", "typecheck"] },
  { name: "build", purpose: "build", buildArgv: (manager: string) => [manager, "run", "build"] },
] as const;

const RECOGNIZED_NODE_SCRIPTS = new Set(["test", "lint", "typecheck", "build"]);

function createCandidate(
  candidateId: string,
  purpose: "test" | "lint" | "typecheck" | "build",
  argv: readonly string[],
  reason: string,
): DetectedCommandCandidate {
  return Object.freeze({
    candidateId,
    purpose,
    argv: Object.freeze([...argv]),
    workingDirectory: ".",
    timeoutMs: 120_000,
    confirmedByUser: false,
    reason,
  });
}

export class ProjectDetector {
  constructor(private readonly reader: ProjectMetadataReader) {}

  detect(): DetectedProjectProfile {
    const kinds: ProjectKind[] = [];
    const candidates: DetectedCommandCandidate[] = [];
    const notices: string[] = [];

    this.detectNode(kinds, candidates, notices);

    return Object.freeze({
      kinds: Object.freeze(kinds),
      candidates: Object.freeze(candidates),
      notices: Object.freeze(notices),
    });
  }

  private detectNode(
    kinds: ProjectKind[],
    candidates: DetectedCommandCandidate[],
    notices: string[],
  ): void {
    let packageJsonText: string | undefined;
    try {
      packageJsonText = this.reader.readText("package.json");
    } catch {
      notices.push("package.json could not be read");
      return;
    }

    if (packageJsonText === undefined) return;

    let pkg: unknown;
    try {
      pkg = JSON.parse(packageJsonText);
    } catch {
      notices.push("package.json could not be parsed");
      return;
    }

    if (typeof pkg !== "object" || pkg === null || Array.isArray(pkg)) {
      notices.push("package.json could not be parsed");
      return;
    }

    kinds.push("node");

    const scripts = (pkg as Record<string, unknown>).scripts;
    if (scripts === undefined) return;

    if (typeof scripts !== "object" || scripts === null || Array.isArray(scripts)) {
      notices.push("package.json scripts field is not an object");
      return;
    }

    const scriptObj = scripts as Record<string, unknown>;
    const manager = this.selectManager();

    for (const rule of NODE_SCRIPT_RULES) {
      const value = scriptObj[rule.name];
      if (value === undefined) continue;
      if (typeof value !== "string") {
        notices.push(`package.json script ${rule.name} is not a string`);
        continue;
      }
      candidates.push(
        createCandidate(
          `node.${rule.name}`,
          rule.purpose,
          rule.buildArgv(manager),
          `package.json script: ${rule.name}`,
        ),
      );
    }

    const ignored: string[] = [];
    for (const name of Object.keys(scriptObj)) {
      if (!RECOGNIZED_NODE_SCRIPTS.has(name)) {
        ignored.push(name);
      }
    }
    if (ignored.length > 0) {
      notices.push(
        `package.json scripts not used as verification candidates: ${ignored.join(", ")}`,
      );
    }
  }

  private selectManager(): string {
    if (this.fileExists("pnpm-lock.yaml")) return "pnpm";
    if (this.fileExists("package-lock.json")) return "npm";
    if (this.fileExists("yarn.lock")) return "yarn";
    return "npm";
  }

  private fileExists(relativePath: string): boolean {
    try {
      return this.reader.readText(relativePath) !== undefined;
    } catch {
      return false;
    }
  }
}
