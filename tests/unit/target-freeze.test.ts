/**
 * 测试功能：验证 Planner 的 Target 冻结只覆盖关键静态文件，跳过依赖树和无关 Profile，
 * 同时保证执行前完整性复核仍能发现 Agent 代码变化。
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  digestBytes,
  validatePortablePath,
  validateStableId,
  withContentDigest,
  type ArtifactRef,
  type ConfigSnapshot,
  type JsonObject,
  type Ref,
  type TargetDescriptor,
} from "../../src/core/models.js";
import {
  freezeTarget,
  verifyTargetIntegrity,
  type PlanningArtifactCommitRequest,
} from "../../src/planning/target.js";

const CREATED_AT = "2026-09-09T00:00:00.000Z";

test("轻量冻结跳过 node_modules 和无关 Profile，但仍检测关键代码变化", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dsheval-target-freeze-"));
  const bytesById = new Map<string, Uint8Array>();
  try {
    await Promise.all([
      mkdir(path.join(root, "package", "lib"), { recursive: true }),
      mkdir(path.join(root, "package", "node_modules", "large-dependency"), { recursive: true }),
      mkdir(path.join(root, "dsh-home", "profiles", "selected"), { recursive: true }),
      mkdir(path.join(root, "dsh-home", "profiles", "unrelated"), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(path.join(root, "package", "lib", "bin.js"), "import './helper.js';\n", "utf8"),
      writeFile(path.join(root, "package", "lib", "helper.js"), "export const value = 1;\n", "utf8"),
      writeFile(path.join(root, "package", "package.json"), JSON.stringify({
        name: "@example/dsh",
        version: "1.0.0",
        type: "module",
      }), "utf8"),
      writeFile(
        path.join(root, "package", "node_modules", "large-dependency", "payload.js"),
        "export const dependency = 1;\n",
        "utf8",
      ),
      writeFile(
        path.join(root, "dsh-home", "profiles", "selected", "package.json"),
        JSON.stringify({ name: "selected-profile", version: "1.0.0" }),
        "utf8",
      ),
      writeFile(
        path.join(root, "dsh-home", "profiles", "unrelated", "ignored.json"),
        JSON.stringify({ ignored: true }),
        "utf8",
      ),
    ]);

    const descriptor = withContentDigest({
      schema: "dsheval.mvp.target-descriptor/v1" as const,
      targetId: validateStableId<"TargetId">("target.light-freeze"),
      targetType: "FULL_AGENT" as const,
      sourceRoot: root,
      dshExecutable: "package/lib/bin.js",
      dshHome: "dsh-home",
      profile: "selected",
      targetIdentity: "dshagent",
    }) as TargetDescriptor;
    const effectiveConfig: JsonObject = Object.freeze({ dshVersion: "1.0.0" });
    const commitArtifact = async (request: PlanningArtifactCommitRequest): Promise<ArtifactRef> => {
      bytesById.set(request.artifactId, Buffer.from(request.bytes));
      return withContentDigest({
        schema: "dsheval.mvp.artifact/v1" as const,
        artifactId: validateStableId<"ArtifactId">(request.artifactId),
        scope: request.scope,
        artifactType: request.artifactType,
        logicalName: request.logicalName,
        mediaType: request.mediaType,
        portablePath: validatePortablePath(request.portablePath),
        byteLength: request.bytes.byteLength,
        artifactContentDigest: digestBytes(request.bytes),
        sensitivity: request.sensitivity,
        redactionState: "NOT_REQUIRED" as const,
        state: "COMMITTED" as const,
        createdAt: request.createdAt,
        producerVersion: request.producerVersion,
      }) as ArtifactRef;
    };
    const readArtifact = async (ref: Ref<ArtifactRef>): Promise<Uint8Array> => {
      const bytes = bytesById.get(String(ref.id));
      if (bytes === undefined) throw new Error(`missing test artifact ${ref.id}`);
      return bytes;
    };

    const snapshot = await freezeTarget(
      descriptor,
      { targetRoot: root } as ConfigSnapshot,
      {
        createdAt: CREATED_AT,
        producerVersion: "test",
        commitArtifact,
        effectiveConfig,
      },
    );
    const sourceManifest = JSON.parse(
      Buffer.from(await readArtifact(snapshot.sourceManifestRef)).toString("utf8"),
    ) as { entries: readonly { portablePath: string }[] };
    const homeManifest = JSON.parse(
      Buffer.from(await readArtifact(snapshot.dshHomeManifestRef)).toString("utf8"),
    ) as { entries: readonly { portablePath: string }[] };
    const sourcePaths = sourceManifest.entries.map((entry) => entry.portablePath);
    const homePaths = homeManifest.entries.map((entry) => entry.portablePath);

    assert.ok(sourcePaths.includes("package/lib/bin.js"));
    assert.ok(sourcePaths.includes("package/lib/helper.js"));
    assert.equal(sourcePaths.some((value) => value.includes("node_modules")), false);
    assert.equal(sourcePaths.some((value) => value.startsWith("dsh-home/")), false);
    assert.ok(homePaths.includes("profiles/selected/package.json"));
    assert.equal(homePaths.some((value) => value.includes("profiles/unrelated")), false);

    await writeFile(
      path.join(root, "package", "node_modules", "large-dependency", "payload.js"),
      "export const dependency = 2;\n",
      "utf8",
    );
    assert.deepEqual(
      await verifyTargetIntegrity(snapshot, { readArtifact, effectiveConfig }),
      { status: "VALID", reasonCodes: [] },
    );

    await writeFile(path.join(root, "package", "lib", "helper.js"), "export const value = 2;\n", "utf8");
    const changed = await verifyTargetIntegrity(snapshot, { readArtifact, effectiveConfig });
    assert.equal(changed.status, "INVALID");
    assert.ok(changed.reasonCodes.includes("SOURCE_MANIFEST_CHANGED"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
