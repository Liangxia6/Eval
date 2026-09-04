/**
 * 测试职责：守住 MVP 八个模块和独立 dynamic 扩展的依赖方向，并拒绝重复 Core 实体、空壳和占位实现。
 * 直接扫描 `src/`；覆盖生产代码整体结构，不依赖运行 Fixture。
 */
import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const SOURCE_ROOT = path.resolve("src");
const MODULES = Object.freeze([
  "app",
  "core",
  "planning",
  "runtime",
  "observation",
  "evaluation",
  "storage",
  "platform",
  "dynamic",
]);
const BUSINESS_MODULES = new Set(MODULES.filter((name) => name !== "app"));

async function sourceFiles(root = SOURCE_ROOT): Promise<readonly string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(async (entry) => {
        const absolute = path.join(root, entry.name);
        if (entry.isDirectory()) return sourceFiles(absolute);
        return entry.isFile() && entry.name.endsWith(".ts") ? [absolute] : [];
      }),
  );
  return nested.flat();
}

function moduleOf(file: string): string {
  return path.relative(SOURCE_ROOT, file).split(path.sep)[0]!;
}

function importedModule(file: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const resolved = path.resolve(path.dirname(file), specifier);
  const relative = path.relative(SOURCE_ROOT, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
  return relative.split(path.sep)[0];
}

test("MVP-CT-ARCH-001: business modules and dynamic extension depend only on themselves/core; MVP composition stays in app", async () => {
  const actualModules = (await readdir(SOURCE_ROOT, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(actualModules, [...MODULES].sort());

  const violations: string[] = [];
  for (const file of await sourceFiles()) {
    const owner = moduleOf(file);
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(/\bfrom\s+["']([^"']+)["']/gu)) {
      const dependency = importedModule(file, match[1]!);
      if (
        dependency !== undefined &&
        owner !== "app" &&
        BUSINESS_MODULES.has(owner) &&
        dependency !== owner &&
        dependency !== "core"
      ) {
        violations.push(`${path.relative(SOURCE_ROOT, file)} -> ${dependency}`);
      }
    }
  }
  assert.deepEqual(violations, []);

  const appSources = await Promise.all(
    (await sourceFiles(path.join(SOURCE_ROOT, "app"))).map(async (file) => ({
      file,
      source: await readFile(file, "utf8"),
    })),
  );
  const concreteConstructors = [
    "FileRepository",
    "FileArtifactStore",
    "EvaluationPlanner",
    "FileEnvironmentSensor",
  ];
  for (const constructorName of concreteConstructors) {
    const owners = appSources
      .filter(({ source }) => new RegExp(`\\bnew\\s+${constructorName}\\b`, "u").test(source))
      .map(({ file }) => path.basename(file));
    assert.deepEqual(owners, ["bootstrap.ts"], `${constructorName} must be composed only by bootstrap.ts`);
  }
});

test("MVP-CT-ARCH-002: release gate rejects duplicate Core entities and empty or placeholder production shells", async () => {
  const files = await sourceFiles();
  const canonicalEntities = [
    "TargetDescriptor",
    "TargetSnapshot",
    "InspectionSnapshot",
    "EvaluationPack",
    "ConfigSnapshot",
    "EvaluationPlan",
    "ObservationPlan",
    "EvidenceContract",
    "EvaluationRun",
    "EvaluationCase",
    "ExecutionAttempt",
    "EnvironmentInstance",
    "ObservationSession",
    "SourceDescriptor",
    "RawObservation",
    "CollectionStatus",
    "FileSnapshot",
    "FileDiff",
    "EvidenceRecord",
    "EvidenceBundle",
    "EvidenceClosure",
    "JudgementRecord",
    "CheckResult",
    "GateDecision",
    "ResetVerification",
    "EvaluationReport",
    "ArtifactRef",
  ];

  const violations: string[] = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    const relative = path.relative(SOURCE_ROOT, file);
    assert.ok((await stat(file)).size > 0, `${relative} is an empty production shell`);
    if (/\b(?:TODO|FIXME|NotImplemented)\b/u.test(source)) {
      violations.push(`${relative}: placeholder marker`);
    }
    if (moduleOf(file) !== "core") {
      for (const entity of canonicalEntities) {
        const declarationPatterns = [
          `^[ \\t]*(?:export[ \\t]+)?interface[ \\t]+${entity}\\b[^\\n{]*\\{`,
          `^[ \\t]*(?:export[ \\t]+)?type[ \\t]+${entity}\\b[^\\n=]*=`,
          `^[ \\t]*(?:export[ \\t]+)?class[ \\t]+${entity}\\b[^\\n{]*\\{`,
        ];
        if (declarationPatterns.some((pattern) => new RegExp(pattern, "mu").test(source))) {
          violations.push(`${relative}: duplicate ${entity}`);
        }
      }
    }
  }
  assert.deepEqual(violations, []);
});
