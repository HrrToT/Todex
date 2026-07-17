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

const PYTEST_MARKER = /\[tool\.pytest(?:\.ini_options)?\]|\[pytest\]|(?:^|\s)pytest(?:[<>=!~\s]|$)/im;
const RUFF_MARKER = /\[tool\.ruff\]|(?:^|\s)ruff(?:[<>=!~\s]|$)/im;
const MYPY_MARKER = /\[tool\.mypy\]|(?:^|\s)mypy(?:[<>=!~\s]|$)/im;

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
    this.detectPython(kinds, candidates, notices);

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
    const manager = this.selectManager(notices);

    if (manager !== undefined) {
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
    } else {
      notices.push("node package manager could not be determined");
    }

    let ignoredCount = 0;
    for (const name of Object.keys(scriptObj)) {
      if (!RECOGNIZED_NODE_SCRIPTS.has(name)) {
        ignoredCount++;
      }
    }
    if (ignoredCount > 0) {
      notices.push(
        `package.json contains ${ignoredCount} scripts not used as verification candidates`,
      );
    }
  }

  private detectPython(
    kinds: ProjectKind[],
    candidates: DetectedCommandCandidate[],
    notices: string[],
  ): void {
    const pyprojectText = this.safeReadText("pyproject.toml", notices);
    const pytestIniText = this.safeReadText("pytest.ini", notices);
    const requirementsText = this.safeReadText("requirements.txt", notices);

    const hasPyproject = pyprojectText !== undefined;
    const hasPytestIni = pytestIniText !== undefined;
    const hasRequirements = requirementsText !== undefined;

    if (!hasPyproject && !hasPytestIni && !hasRequirements) return;

    kinds.push("python");

    const hasPytestEvidence =
      hasPytestIni ||
      (pyprojectText !== undefined && PYTEST_MARKER.test(pyprojectText)) ||
      (requirementsText !== undefined && PYTEST_MARKER.test(requirementsText));

    const hasRuffEvidence =
      (pyprojectText !== undefined && RUFF_MARKER.test(pyprojectText)) ||
      (requirementsText !== undefined && RUFF_MARKER.test(requirementsText));

    const hasMypyEvidence =
      (pyprojectText !== undefined && MYPY_MARKER.test(pyprojectText)) ||
      (requirementsText !== undefined && MYPY_MARKER.test(requirementsText));

    if (hasPytestEvidence) {
      candidates.push(
        createCandidate(
          "python.pytest",
          "test",
          ["python", "-m", "pytest"],
          "python pytest marker found",
        ),
      );
    }
    if (hasRuffEvidence) {
      candidates.push(
        createCandidate(
          "python.ruff",
          "lint",
          ["python", "-m", "ruff", "check", "."],
          "python ruff marker found",
        ),
      );
    }
    if (hasMypyEvidence) {
      candidates.push(
        createCandidate(
          "python.mypy",
          "typecheck",
          ["python", "-m", "mypy", "."],
          "python mypy marker found",
        ),
      );
    }

    if (!hasPytestEvidence && !hasRuffEvidence && !hasMypyEvidence) {
      notices.push(
        "python project detected but no supported verification command was found",
      );
    }
  }

  private safeReadText(relativePath: string, notices: string[]): string | undefined {
    try {
      return this.reader.readText(relativePath);
    } catch {
      notices.push(`${relativePath} could not be read`);
      return undefined;
    }
  }

  private selectManager(notices: string[]): string | undefined {
    const lockfiles: ReadonlyArray<readonly [string, string]> = [
      ["pnpm-lock.yaml", "pnpm"],
      ["package-lock.json", "npm"],
      ["yarn.lock", "yarn"],
    ];

    for (const [path, manager] of lockfiles) {
      let content: string | undefined;
      try {
        content = this.reader.readText(path);
      } catch {
        notices.push(`${path} could not be read`);
        return undefined;
      }
      if (content !== undefined) {
        return manager;
      }
    }
    return "npm";
  }
}
