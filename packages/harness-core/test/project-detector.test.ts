import { describe, expect, it } from "vitest";
import { ProjectDetector, type ProjectMetadataReader } from "../src/project-detector.js";

class FakeMetadataReader implements ProjectMetadataReader {
  private readonly failures = new Map<string, Error>();
  constructor(private readonly files: Record<string, string>) {}
  readText(relativePath: string): string | undefined {
    const failure = this.failures.get(relativePath);
    if (failure) throw failure;
    return this.files[relativePath];
  }
  throwOn(relativePath: string, error: Error): void {
    this.failures.set(relativePath, error);
  }
}

function fakeReader(files: Record<string, string>): FakeMetadataReader {
  return new FakeMetadataReader(files);
}

describe("ProjectDetector Node candidate discovery", () => {
  it("detects exact Node verification scripts with pnpm argv templates", () => {
    const detector = new ProjectDetector(
      fakeReader({
        "package.json": JSON.stringify({
          scripts: {
            test: "vitest",
            lint: "eslint .",
            typecheck: "tsc --noEmit",
            build: "vite build",
          },
        }),
        "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
      }),
    );

    expect(detector.detect()).toMatchObject({
      kinds: ["node"],
      candidates: [
        { candidateId: "node.test", purpose: "test", argv: ["pnpm", "test"], confirmedByUser: false },
        { candidateId: "node.lint", purpose: "lint", argv: ["pnpm", "run", "lint"], confirmedByUser: false },
        { candidateId: "node.typecheck", purpose: "typecheck", argv: ["pnpm", "run", "typecheck"], confirmedByUser: false },
        { candidateId: "node.build", purpose: "build", argv: ["pnpm", "run", "build"], confirmedByUser: false },
      ],
    });
  });

  it("does not turn install, deploy, prepare, or unknown scripts into candidates", () => {
    const profile = new ProjectDetector(
      fakeReader({
        "package.json": JSON.stringify({
          scripts: { install: "npm i", deploy: "ship", prepare: "setup", custom: "echo x" },
        }),
      }),
    ).detect();
    expect(profile.candidates).toEqual([]);
    expect(profile.notices.join(" ")).toContain("install");
  });

  it("uses fixed argv templates and never copies script body text", () => {
    const profile = new ProjectDetector(
      fakeReader({
        "package.json": JSON.stringify({
          scripts: { test: "vitest --reporter=verbose --coverage" },
        }),
      }),
    ).detect();
    expect(profile.candidates[0]?.argv).toEqual(["npm", "test"]);
    const allText = JSON.stringify(profile);
    expect(allText).not.toContain("--reporter");
    expect(allText).not.toContain("--coverage");
  });

  it("includes workingDirectory, timeoutMs, and reason in each candidate", () => {
    const profile = new ProjectDetector(
      fakeReader({
        "package.json": JSON.stringify({ scripts: { test: "x", lint: "y" } }),
      }),
    ).detect();
    expect(profile.candidates[0]).toMatchObject({
      workingDirectory: ".",
      timeoutMs: 120_000,
      confirmedByUser: false,
      reason: "package.json script: test",
    });
    expect(profile.candidates[1]?.reason).toBe("package.json script: lint");
  });
});

describe("ProjectDetector Node package-manager precedence", () => {
  it.each([
    ["package-lock.json", ["npm", "test"]],
    ["yarn.lock", ["yarn", "test"]],
    [undefined, ["npm", "test"]],
  ])("selects the expected manager for lockfile %s", (lockfile, argv) => {
    const files = { "package.json": JSON.stringify({ scripts: { test: "x" } }) } as Record<string, string>;
    if (lockfile) files[lockfile] = "present";
    expect(new ProjectDetector(fakeReader(files)).detect().candidates[0]?.argv).toEqual(argv);
  });

  it("prefers pnpm over npm lockfile", () => {
    const profile = new ProjectDetector(
      fakeReader({
        "package.json": JSON.stringify({ scripts: { test: "x" } }),
        "pnpm-lock.yaml": "present",
        "package-lock.json": "present",
      }),
    ).detect();
    expect(profile.candidates[0]?.argv).toEqual(["pnpm", "test"]);
  });

  it("prefers npm lockfile over yarn lockfile", () => {
    const profile = new ProjectDetector(
      fakeReader({
        "package.json": JSON.stringify({ scripts: { test: "x" } }),
        "package-lock.json": "present",
        "yarn.lock": "present",
      }),
    ).detect();
    expect(profile.candidates[0]?.argv).toEqual(["npm", "test"]);
  });
});

describe("ProjectDetector malformed Node metadata", () => {
  it("returns a notice instead of throwing for invalid package JSON", () => {
    const profile = new ProjectDetector(fakeReader({ "package.json": "{" })).detect();
    expect(profile.kinds).toEqual([]);
    expect(profile.notices).toContain("package.json could not be parsed");
  });

  it("returns a notice for non-object package JSON", () => {
    const profile = new ProjectDetector(
      fakeReader({ "package.json": JSON.stringify("not an object") }),
    ).detect();
    expect(profile.kinds).toEqual([]);
    expect(profile.notices).toContain("package.json could not be parsed");
  });

  it("returns a notice for array package JSON", () => {
    const profile = new ProjectDetector(
      fakeReader({ "package.json": JSON.stringify([1, 2, 3]) }),
    ).detect();
    expect(profile.kinds).toEqual([]);
    expect(profile.notices).toContain("package.json could not be parsed");
  });

  it("returns a notice when scripts field is not an object", () => {
    const profile = new ProjectDetector(
      fakeReader({ "package.json": JSON.stringify({ scripts: "not an object" }) }),
    ).detect();
    expect(profile.kinds).toEqual(["node"]);
    expect(profile.candidates).toEqual([]);
    expect(profile.notices).toContain("package.json scripts field is not an object");
  });

  it("returns a notice when a relevant script value is not a string", () => {
    const profile = new ProjectDetector(
      fakeReader({
        "package.json": JSON.stringify({ scripts: { test: 42, lint: "eslint ." } }),
      }),
    ).detect();
    expect(profile.candidates.map((c) => c.candidateId)).toEqual(["node.lint"]);
    expect(profile.notices.join(" ")).toContain("test");
  });

  it("does not flag missing scripts as an error", () => {
    const profile = new ProjectDetector(
      fakeReader({ "package.json": JSON.stringify({ name: "my-pkg" }) }),
    ).detect();
    expect(profile.kinds).toEqual(["node"]);
    expect(profile.candidates).toEqual([]);
  });
});

describe("ProjectDetector immutable snapshots", () => {
  it("freezes the returned profile, candidates, and argv arrays", () => {
    const profile = new ProjectDetector(
      fakeReader({
        "package.json": JSON.stringify({
          scripts: { test: "x", lint: "y", typecheck: "z", build: "w" },
        }),
        "pnpm-lock.yaml": "present",
      }),
    ).detect();

    expect(Object.isFrozen(profile)).toBe(true);
    expect(Object.isFrozen(profile.kinds)).toBe(true);
    expect(Object.isFrozen(profile.candidates)).toBe(true);
    expect(Object.isFrozen(profile.notices)).toBe(true);
    for (const candidate of profile.candidates) {
      expect(Object.isFrozen(candidate)).toBe(true);
      expect(Object.isFrozen(candidate.argv)).toBe(true);
    }
  });

  it("throws TypeError when mutating profile fields through a cast", () => {
    const profile = new ProjectDetector(
      fakeReader({ "package.json": JSON.stringify({ scripts: { test: "x" } }) }),
    ).detect();

    expect(() => {
      (profile as unknown as { kinds: string[] }).kinds.push("python");
    }).toThrow(TypeError);
    expect(() => {
      (profile as unknown as { notices: string[] }).notices.push("injected");
    }).toThrow(TypeError);
    expect(() => {
      (profile.candidates as unknown as { push: (x: unknown) => void }).push(null);
    }).toThrow(TypeError);
  });

  it("throws TypeError when mutating a candidate or its argv", () => {
    const profile = new ProjectDetector(
      fakeReader({ "package.json": JSON.stringify({ scripts: { test: "x" } }) }),
    ).detect();

    const candidate = profile.candidates[0]!;
    expect(() => {
      (candidate as unknown as { purpose: string }).purpose = "build";
    }).toThrow(TypeError);
    expect(() => {
      (candidate.argv as unknown as { push: (x: string) => void }).push("injected");
    }).toThrow(TypeError);
    expect(() => {
      (candidate as unknown as { confirmedByUser: boolean }).confirmedByUser = true;
    }).toThrow(TypeError);
  });
});
