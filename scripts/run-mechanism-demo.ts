import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { runMechanismDemo } from "../packages/harness-core/src/mechanism-demo.js";
import type { MechanismDemoReport } from "../packages/harness-core/src/mechanism-demo.js";

export type { MechanismDemoReport } from "../packages/harness-core/src/mechanism-demo.js";

export const DEMO_REPORT_PATH = ".todex/demo/mechanism-report.json";
const DEMO_REPORT_DIR = ".todex/demo";

export interface DemoReportWriterDeps {
  readonly mkdir: (path: string, options: { recursive: boolean }) => Promise<unknown>;
  readonly writeFile: (path: string, data: string, encoding?: BufferEncoding) => Promise<unknown>;
}

export interface MechanismDemoCliDeps {
  readonly runDemo: () => Promise<MechanismDemoReport>;
  readonly writer: DemoReportWriterDeps;
  readonly log: (line: string) => void;
  readonly setExitCode: (code: number) => void;
}

export async function writeDemoReport(
  report: MechanismDemoReport,
  deps: DemoReportWriterDeps,
): Promise<void> {
  if (!report.allPassed) {
    throw new Error("demo_report_failed");
  }
  const json = JSON.stringify(report, null, 2);
  try {
    await deps.mkdir(DEMO_REPORT_DIR, { recursive: true });
    await deps.writeFile(DEMO_REPORT_PATH, json, "utf8");
  } catch {
    throw new Error("demo_report_failed");
  }
}

export async function runMechanismDemoCli(deps: MechanismDemoCliDeps): Promise<void> {
  try {
    const report = await deps.runDemo();
    await writeDemoReport(report, deps.writer);
    deps.log(`workspace-escape: ${report.workspaceEscape.passed ? "passed" : "failed"}`);
    deps.log(`repair-feedback: ${report.repairFeedback.passed ? "passed" : "failed"}`);
    deps.log(`approval-isolation: ${report.approvalIsolation.passed ? "passed" : "failed"}`);
    deps.log(`report: ${DEMO_REPORT_PATH}`);
  } catch {
    deps.log("mechanism-demo: failed");
    deps.setExitCode(1);
  }
}

function main(): Promise<void> {
  return runMechanismDemoCli({
    runDemo: runMechanismDemo,
    writer: { mkdir, writeFile },
    log: console.log,
    setExitCode: (code) => {
      process.exitCode = code;
    },
  });
}

const isMain =
  typeof process !== "undefined" &&
  import.meta.url === pathToFileURL(process.argv[1] ?? "").href;

if (isMain) {
  main().catch(() => {
    console.log("mechanism-demo: failed");
    process.exitCode = 1;
  });
}
