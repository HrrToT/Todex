import { extractFile, listPackage } from "@electron/asar";
import { posix } from "node:path";
import { pathToFileURL } from "node:url";
import * as ts from "typescript";

export type DesktopPackageCheckName =
  | "main-preload"
  | "main-run-service"
  | "renderer-document"
  | "renderer-live-workbench"
  | "preload-run-bridge";

export type DesktopPackageCheck = Readonly<{
  name: DesktopPackageCheckName;
  passed: boolean;
}>;

export type DesktopPackageVerification = Readonly<{
  allPassed: boolean;
  checks: readonly DesktopPackageCheck[];
}>;

export type VerifyDesktopPackageOptions = Readonly<{
  archivePath: string;
}>;

export const DEFAULT_DESKTOP_PACKAGE_ARCHIVE = "apps/desktop/release/win-unpacked/resources/app.asar";

const PRELOAD_PATH = "dist/main/preload.js";
const RUN_SERVICE_PATH = "dist/main/desktop-run-service.js";
const RENDERER_DOCUMENT_PATH = "dist/renderer/index.html";
const RENDERER_ASSET_PATH = "dist/renderer/assets/";

function normalizeArchivePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\/+/, "");
}

function archiveReadPath(value: string): string {
  return value.replace(/^[\\/]+/, "");
}

function rendererBundlePath(document: string, entries: ReadonlyMap<string, string>): string | undefined {
  const source = /<script[^>]+src=["']([^"']+\.js)["']/i.exec(document)?.[1];
  if (!source) return undefined;
  const assetPrefix = source.startsWith("./assets/")
    ? "./assets/"
    : source.startsWith("/assets/")
      ? "/assets/"
      : undefined;
  if (!assetPrefix) return undefined;

  const relativeSource = posix.normalize(source.slice(assetPrefix.length));
  if (relativeSource === "." || relativeSource === ".." || relativeSource.startsWith("../")) return undefined;

  const candidate = `${RENDERER_ASSET_PATH}${relativeSource}`;
  return entries.get(candidate);
}

function readArchiveText(archivePath: string, entryPath: string | undefined): string | undefined {
  if (!entryPath) return undefined;
  try {
    return extractFile(archivePath, entryPath).toString("utf8");
  } catch {
    return undefined;
  }
}

function propertyName(property: ts.ObjectLiteralElementLike): string | undefined {
  if (!ts.isPropertyAssignment(property)) return undefined;
  if (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) return property.name.text;
  return undefined;
}

function objectProperty(object: ts.ObjectLiteralExpression, name: string): ts.PropertyAssignment | undefined {
  const property = object.properties.find((candidate) => propertyName(candidate) === name);
  return property && ts.isPropertyAssignment(property) ? property : undefined;
}

function hasCall(node: ts.Node, predicate: (call: ts.CallExpression) => boolean): boolean {
  let found = false;
  const visit = (candidate: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(candidate) && predicate(candidate)) {
      found = true;
      return;
    }
    ts.forEachChild(candidate, visit);
  };
  visit(node);
  return found;
}

function callsInvoke(node: ts.Node, channel: string): boolean {
  return hasCall(node, (call) => ts.isIdentifier(call.expression)
    && call.expression.text === "invoke"
    && call.arguments.length > 0
    && ts.isStringLiteral(call.arguments[0])
    && call.arguments[0].text === channel);
}

function bindingNameIsInvoke(name: ts.BindingName | undefined): boolean {
  return name !== undefined && ts.isIdentifier(name) && name.text === "invoke";
}

function hasLocalInvokeBinding(node: ts.Node): boolean {
  let found = false;
  const visit = (candidate: ts.Node): void => {
    if (found) return;
    if ((ts.isVariableDeclaration(candidate) || ts.isParameter(candidate)) && bindingNameIsInvoke(candidate.name)) {
      found = true;
      return;
    }
    if ((ts.isFunctionDeclaration(candidate) || ts.isFunctionExpression(candidate) || ts.isClassDeclaration(candidate))
      && bindingNameIsInvoke(candidate.name)) {
      found = true;
      return;
    }
    ts.forEachChild(candidate, visit);
  };
  visit(node);
  return found;
}

function isIpcRendererInvokeCall(call: ts.CallExpression): boolean {
  return ts.isPropertyAccessExpression(call.expression)
    && ts.isIdentifier(call.expression.expression)
    && call.expression.expression.text === "ipcRenderer"
    && call.expression.name.text === "invoke";
}

function isTopLevelInvokeHelper(statement: ts.Statement): boolean {
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.some((declaration) => bindingNameIsInvoke(declaration.name)
      && declaration.initializer !== undefined
      && hasCall(declaration.initializer, isIpcRendererInvokeCall));
  }
  return ts.isFunctionDeclaration(statement)
    && bindingNameIsInvoke(statement.name)
    && hasCall(statement, isIpcRendererInvokeCall);
}

function definesIpcInvokeHelper(sourceFile: ts.SourceFile): boolean {
  return sourceFile.statements.some(isTopLevelInvokeHelper);
}

function hasPreloadRunBridge(preload: string | undefined): boolean {
  if (!preload) return false;

  const sourceFile = ts.createSourceFile("preload.js", preload, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let bridge: ts.ObjectLiteralExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (bridge || !ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) {
      if (!bridge) ts.forEachChild(node, visit);
      return;
    }

    const target = node.expression;
    if (ts.isIdentifier(target.expression)
      && target.expression.text === "contextBridge"
      && target.name.text === "exposeInMainWorld"
      && node.arguments.length >= 2
      && ts.isStringLiteral(node.arguments[0])
      && node.arguments[0].text === "todex"
      && ts.isObjectLiteralExpression(node.arguments[1])) {
      bridge = node.arguments[1];
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  const run = bridge && objectProperty(bridge, "run");
  const runObject = run && ts.isObjectLiteralExpression(run.initializer) ? run.initializer : undefined;
  if (!runObject || !definesIpcInvokeHelper(sourceFile)) return false;

  return (["start", "cancel", "subscribe"] as const).every((method) => {
    const property = objectProperty(runObject, method);
    return property !== undefined
      && !hasLocalInvokeBinding(property.initializer)
      && callsInvoke(property.initializer, `run.${method}`);
  });
}

export async function verifyDesktopPackage(options: VerifyDesktopPackageOptions): Promise<DesktopPackageVerification> {
  let entries: ReadonlyMap<string, string> = new Map();
  try {
    entries = new Map(listPackage(options.archivePath, { isPack: false }).map((entry) => [normalizeArchivePath(entry), archiveReadPath(entry)]));
  } catch {
    // A missing or malformed archive produces fixed failed checks only.
  }

  const preloadEntry = entries.get(PRELOAD_PATH);
  const hasPreload = preloadEntry !== undefined;
  const hasRunService = entries.has(RUN_SERVICE_PATH);
  const rendererDocumentEntry = entries.get(RENDERER_DOCUMENT_PATH);
  const hasRendererDocument = rendererDocumentEntry !== undefined;
  const rendererDocument = readArchiveText(options.archivePath, rendererDocumentEntry);
  const rendererBundle = readArchiveText(options.archivePath, rendererBundlePath(rendererDocument ?? "", entries));
  const preload = readArchiveText(options.archivePath, preloadEntry);

  const checks: readonly DesktopPackageCheck[] = Object.freeze([
    Object.freeze({ name: "main-preload", passed: hasPreload }),
    Object.freeze({ name: "main-run-service", passed: hasRunService }),
    Object.freeze({ name: "renderer-document", passed: hasRendererDocument }),
    Object.freeze({
      name: "renderer-live-workbench",
      passed: rendererBundle?.includes('data-todex-surface":"live-workbench"') === true
        || rendererBundle?.includes('data-todex-surface="live-workbench"') === true,
    }),
    Object.freeze({ name: "preload-run-bridge", passed: hasPreloadRunBridge(preload) }),
  ]);

  return Object.freeze({
    allPassed: checks.every((check) => check.passed),
    checks,
  });
}

const isMain =
  typeof process !== "undefined"
  && import.meta.url === pathToFileURL(process.argv[1] ?? "").href;

if (isMain) {
  const archivePath = process.env.TODEX_DESKTOP_ARCHIVE ?? DEFAULT_DESKTOP_PACKAGE_ARCHIVE;
  const result = await verifyDesktopPackage({ archivePath });
  console.log(JSON.stringify(result, null, 2));
  if (!result.allPassed) process.exitCode = 1;
}
