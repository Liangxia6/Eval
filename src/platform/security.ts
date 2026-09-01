import { randomBytes, randomUUID } from "node:crypto";
import { access, lstat, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { execFile, spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import process from "node:process";
import { promisify } from "node:util";

import {
  LINUX_SETPRIV_PATH,
  linuxSetprivArguments,
} from "../core/contracts.js";

import {
  digestValue,
  type PreparedObserverBinding,
  validateContentDigest,
  validateIsoDateTime,
  validateStableId,
  validateVersionedAssetId,
} from "../core/models.js";

const execFileAsync = promisify(execFile);

export interface OsIdentity {
  name: string;
  uid: number;
  gid: number;
}

export interface SecurityCheck {
  name: string;
  status: "PASS" | "FAIL" | "FIXTURE_LIMITATION";
  detail: string;
}

export interface SecurityPreflightResult {
  status: "PASSED" | "FAILED" | "FIXTURE_ONLY";
  targetIdentity?: OsIdentity;
  observerIdentity: OsIdentity;
  judgeIdentity: OsIdentity;
  checks: readonly SecurityCheck[];
  isolationLevel: "AGENT_SEPARATED" | "PROCESS_FIXTURE";
  networkPolicyVerified: boolean;
  telemetryDisabled: boolean;
}

export interface PreparedObserverBindingRuntime {
  binding: PreparedObserverBinding;
  /** Host path is process-only and never part of the public Binding. */
  workspacePath: string;
}

async function identityByName(name: string): Promise<OsIdentity> {
  if (!/^[a-z_][a-z0-9_-]{0,31}$/.test(name)) throw new Error("invalid OS identity name");
  const [{ stdout: uidText }, { stdout: gidText }] = await Promise.all([
    execFileAsync("/usr/bin/id", ["-u", name], { encoding: "utf8" }),
    execFileAsync("/usr/bin/id", ["-g", name], { encoding: "utf8" }),
  ]);
  const uid = Number.parseInt(uidText.trim(), 10);
  const gid = Number.parseInt(gidText.trim(), 10);
  if (!Number.isSafeInteger(uid) || !Number.isSafeInteger(gid)) {
    throw new Error(`identity ${name} did not resolve to numeric uid/gid`);
  }
  return { name, uid, gid };
}

async function currentIdentity(): Promise<OsIdentity> {
  const uid = process.getuid?.();
  const gid = process.getgid?.();
  if (uid === undefined || gid === undefined) throw new Error("POSIX identity APIs unavailable");
  let name = `uid-${uid}`;
  try {
    name = (await execFileAsync("/usr/bin/id", ["-un"], { encoding: "utf8" })).stdout.trim();
  } catch {
    // Numeric identity is still an observed fact; the name remains explicit.
  }
  return { name, uid, gid };
}

async function accessAs(identity: OsIdentity, target: string, mode: "read" | "write"): Promise<boolean> {
  const flag = mode === "read" ? "-r" : "-w";
  return await new Promise<boolean>((resolve, reject) => {
    const child = spawn(
      LINUX_SETPRIV_PATH,
      linuxSetprivArguments(identity.uid, identity.gid, "/usr/bin/test", [flag, target]),
      {
        shell: false,
        stdio: "ignore",
        env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" },
      },
    );
    child.once("error", reject);
    child.once("close", (code) => resolve(code === 0));
  });
}

async function verifyIdentityDrop(identity: OsIdentity): Promise<{
  ok: boolean;
  detail: string;
}> {
  const program = [
    'import { readFileSync } from "node:fs";',
    "const [uidText, gidText] = process.argv.slice(1);",
    "const uid = Number(uidText); const gid = Number(gidText);",
    "if (process.getuid?.() !== uid || process.geteuid?.() !== uid) process.exit(10);",
    "if (process.getgid?.() !== gid || process.getegid?.() !== gid) process.exit(11);",
    "if ((process.getgroups?.() ?? []).some((group) => group !== gid)) process.exit(12);",
    'const status = readFileSync("/proc/self/status", "utf8");',
    'const field = (name) => status.match(new RegExp(`^${name}:\\\\s*(.+)$`, "m"))?.[1]?.trim();',
    'const uidColumns = (field("Uid") ?? "").split(/\\s+/).map(Number);',
    'if (uidColumns.length !== 4 || uidColumns.some((value) => value !== uid)) process.exit(15);',
    'const gidColumns = (field("Gid") ?? "").split(/\\s+/).map(Number);',
    'if (gidColumns.length !== 4 || gidColumns.some((value) => value !== gid)) process.exit(16);',
    'for (const name of ["CapInh", "CapPrm", "CapEff", "CapAmb"]) {',
    '  if (!/^0+$/.test(field(name) ?? "")) process.exit(13);',
    "}",
    'if (field("NoNewPrivs") !== "1") process.exit(14);',
  ].join("");
  const arguments_ = linuxSetprivArguments(identity.uid, identity.gid, process.execPath, [
    "--input-type=module",
    "-e",
    program,
    String(identity.uid),
    String(identity.gid),
  ]);
  return await new Promise((resolve) => {
    let settled = false;
    const settle = (result: { ok: boolean; detail: string }): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const child = spawn(LINUX_SETPRIV_PATH, arguments_, {
      shell: false,
      stdio: "ignore",
      env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" },
    });
    child.once("error", (error) => {
      settle({ ok: false, detail: `identity launcher error: ${error.message}` });
    });
    child.once("close", (code) => {
      const failureDetails: Readonly<Record<number, string>> = {
        10: "launched process real/effective uid did not match dshagent",
        11: "launched process real/effective gid did not match dshagent",
        12: "launched process retained an unexpected supplementary group",
        13: "launched process retained an inheritable, permitted, effective, or ambient capability",
        14: "launched process did not have no_new_privs enabled",
        15: "launched process real/effective/saved/filesystem uid did not match dshagent",
        16: "launched process real/effective/saved/filesystem gid did not match dshagent",
        126: "identity launcher could not invoke the verification process",
        127: "identity launcher could not apply the required privilege transition",
      };
      settle({
        ok: code === 0,
        detail: code === 0
          ? "uid/gid switch, supplementary-group clearing, capability drop, and no_new_privs verified"
          : failureDetails[code ?? -1] ?? `identity verification exited with code ${code ?? "signal"}`,
      });
    });
  });
}

async function tcpConnectAs(
  identity: OsIdentity,
  host: string,
  port: number,
  timeoutMs: number,
): Promise<boolean> {
  const program = [
    'import net from "node:net";',
    "const [host, portText, timeoutText] = process.argv.slice(1);",
    "const socket = net.createConnection({host, port: Number(portText)});",
    "const done = (code) => { socket.destroy(); process.exit(code); };",
    "socket.setTimeout(Number(timeoutText), () => done(1));",
    "socket.once('connect', () => done(0));",
    "socket.once('error', () => done(1));",
  ].join("");
  return await new Promise<boolean>((resolve) => {
    const child = spawn(
      LINUX_SETPRIV_PATH,
      linuxSetprivArguments(identity.uid, identity.gid, process.execPath, [
        "--input-type=module",
        "-e",
        program,
        host,
        String(port),
        String(timeoutMs),
      ]),
      {
        shell: false,
        stdio: "ignore",
        env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" },
      },
    );
    child.once("error", () => resolve(false));
    child.once("close", (code) => resolve(code === 0));
  });
}

export async function runSecurityPreflight(input: {
  deniedRoots: readonly string[];
  allowedRoots: readonly string[];
  expectedFrameworkIdentity?: string;
  expectedTargetIdentity?: string;
  allowedModelEndpoints?: readonly string[];
  allowFixtureIdentity?: boolean;
}): Promise<SecurityPreflightResult> {
  const checks: SecurityCheck[] = [];
  const observerIdentity = await currentIdentity();

  if (input.allowFixtureIdentity === true) {
    checks.push({
      name: "os-identity-separation",
      status: "FIXTURE_LIMITATION",
      detail: "Explicit test fixture uses the current identity and is not a production security pass",
    });
    return {
      status: "FIXTURE_ONLY",
      targetIdentity: observerIdentity,
      observerIdentity,
      judgeIdentity: observerIdentity,
      checks,
      isolationLevel: "PROCESS_FIXTURE",
      networkPolicyVerified: false,
      telemetryDisabled: false,
    };
  }

  let targetIdentity: OsIdentity | undefined;
  try {
    const expectedFrameworkIdentity = input.expectedFrameworkIdentity ?? "dsheval";
    if (observerIdentity.name !== expectedFrameworkIdentity) {
      throw new Error(
        `framework runs as ${observerIdentity.name}; expected ${expectedFrameworkIdentity}`,
      );
    }
    targetIdentity = await identityByName(input.expectedTargetIdentity ?? "dshagent");
    if (targetIdentity.uid === observerIdentity.uid) {
      throw new Error("framework and target resolve to the same uid");
    }
    checks.push({ name: "os-identity-separation", status: "PASS", detail: "distinct uids verified" });
  } catch (error) {
    checks.push({
      name: "os-identity-separation",
      status: "FAIL",
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  if (targetIdentity !== undefined) {
    const identityDrop = await verifyIdentityDrop(targetIdentity);
    checks.push({
      name: "target-privilege-drop",
      status: identityDrop.ok ? "PASS" : "FAIL",
      detail: identityDrop.detail,
    });
  } else {
    checks.push({
      name: "target-privilege-drop",
      status: "FAIL",
      detail: "target identity was unavailable for the controlled identity launcher",
    });
  }

  const deniedRoots = [...new Set([
    ...input.deniedRoots,
    os.homedir(),
    "/var/run/docker.sock",
    "/run/docker.sock",
    "/etc/sudoers",
  ])];
  for (const root of deniedRoots) {
    try {
      const resolved = await realpath(root);
      const denied =
        targetIdentity !== undefined &&
        !(await accessAs(targetIdentity, resolved, "read")) &&
        !(await accessAs(targetIdentity, resolved, "write"));
      checks.push({
        name: `target-denied:${path.basename(root)}`,
        status: denied ? "PASS" : "FAIL",
        detail: denied ? "target cannot read or write root" : "target access was not reliably denied",
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        checks.push({
          name: `target-denied:${path.basename(root)}`,
          status: "PASS",
          detail: "denied path is absent and therefore inaccessible",
        });
        continue;
      }
      checks.push({
        name: `target-denied:${path.basename(root)}`,
        status: "FAIL",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  for (const root of input.allowedRoots) {
    try {
      const resolved = await realpath(root);
      const metadata = await lstat(resolved);
      const usable =
        metadata.isDirectory() &&
        targetIdentity !== undefined &&
        (await accessAs(targetIdentity, resolved, "read")) &&
        (await accessAs(targetIdentity, resolved, "write"));
      checks.push({
        name: `target-allowed:${path.basename(root)}`,
        status: usable ? "PASS" : "FAIL",
        detail: usable ? "target can read and write allowed root" : "target cannot use allowed root",
      });
    } catch (error) {
      checks.push({
        name: `target-allowed:${path.basename(root)}`,
        status: "FAIL",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  let networkPolicyVerified = false;
  if (targetIdentity !== undefined) {
    const allowedEndpoints = (input.allowedModelEndpoints ?? []).map((endpoint) => new URL(endpoint));
    const allowedResults = await Promise.all(
      allowedEndpoints.map(async (endpoint) => ({
        endpoint,
        connected: await tcpConnectAs(
          targetIdentity!,
          endpoint.hostname,
          endpoint.port === "" ? 443 : Number(endpoint.port),
          1_500,
        ),
      })),
    );
    const allowedHosts = new Set(allowedEndpoints.map((endpoint) => endpoint.hostname));
    const denyCandidates = [
      { host: "1.1.1.1", port: 443 },
      { host: "8.8.8.8", port: 443 },
      { host: "example.com", port: 443 },
    ].filter((candidate) => !allowedHosts.has(candidate.host));
    const deniedResults = await Promise.all(
      denyCandidates.map(async (candidate) => ({
        ...candidate,
        connected: await tcpConnectAs(targetIdentity!, candidate.host, candidate.port, 1_500),
      })),
    );
    networkPolicyVerified =
      allowedResults.every((result) => result.connected) &&
      deniedResults.every((result) => !result.connected);
    checks.push({
      name: "network-default-deny",
      status: networkPolicyVerified ? "PASS" : "FAIL",
      detail: networkPolicyVerified
        ? "configured model endpoints were reachable and disallowed egress probes were blocked"
        : "allowed endpoint reachability or default-deny negative probes did not match the frozen policy",
    });
  } else {
    checks.push({
      name: "network-default-deny",
      status: "FAIL",
      detail: "target identity was unavailable for network policy probes",
    });
  }

  return {
    status: checks.every((check) => check.status === "PASS") ? "PASSED" : "FAILED",
    ...(targetIdentity === undefined ? {} : { targetIdentity }),
    observerIdentity,
    judgeIdentity: observerIdentity,
    checks,
    isolationLevel: "AGENT_SEPARATED",
    networkPolicyVerified,
    telemetryDisabled: true,
  };
}

export async function issueObserverBinding(input: {
  environmentInstanceId: string;
  resetGeneration: number;
  sourceRequirementId: string;
  resourceBinding: string;
  sensorImplementationId: string;
  sensorImplementationVersion: string;
  sensorCapabilityDigest: PreparedObserverBinding["sensorCapabilityDigest"];
  expiresAt: string;
  workspacePath: string;
}): Promise<PreparedObserverBindingRuntime> {
  if (!Number.isSafeInteger(input.resetGeneration) || input.resetGeneration < 0) {
    throw new Error("resetGeneration must be a non-negative safe integer");
  }
  if (
    input.resourceBinding.length === 0 ||
    input.sensorImplementationVersion.length === 0 ||
    input.resourceBinding.includes("\0") ||
    input.sensorImplementationVersion.includes("\0")
  ) {
    throw new Error("observer resource binding and sensor version must be non-empty and NUL-free");
  }
  validateContentDigest(input.sensorCapabilityDigest, "sensorCapabilityDigest");
  const expiresAt = validateIsoDateTime(input.expiresAt);
  if (Date.parse(expiresAt) <= Date.now()) throw new Error("observer binding expiration must be future");
  const workspaceInputMetadata = await lstat(input.workspacePath);
  if (!workspaceInputMetadata.isDirectory() || workspaceInputMetadata.isSymbolicLink()) {
    throw new Error("observer workspace must be a real directory");
  }
  const resolved = await realpath(input.workspacePath);
  await access(resolved, constants.R_OK);
  const token = randomBytes(32).toString("base64url");
  const grantMaterial = {
    bindingId: validateStableId<"PreparedObserverBindingId">(`binding-${randomUUID()}`),
    environmentInstanceId: validateStableId<"EnvironmentInstanceId">(
      input.environmentInstanceId,
    ),
    resetGeneration: input.resetGeneration,
    sourceRequirementId: validateVersionedAssetId<"SourceRequirementId">(
      input.sourceRequirementId,
      "sourceRequirementId",
    ),
    resourceBinding: input.resourceBinding,
    sensorImplementationId: validateStableId<"SensorImplementationId">(
      input.sensorImplementationId,
    ),
    sensorImplementationVersion: input.sensorImplementationVersion,
    sensorCapabilityDigest: input.sensorCapabilityDigest,
    allowedOperations: ["READ", "SNAPSHOT", "DRAIN"] as const,
    expiresAt,
  };
  const binding: PreparedObserverBinding = {
    ...grantMaterial,
    grantDigest: digestValue(grantMaterial),
    readCapabilityToken: token,
  };
  return {
    binding,
    workspacePath: resolved,
  };
}

export function assertSafeAgentTask(
  task: string,
  forbiddenValues: readonly string[],
): void {
  const lowered = task.toLowerCase();
  const reservedTerms = ["ground truth", "evidencecontract", "artifactroot", "reportroot"];
  if (reservedTerms.some((term) => lowered.includes(term))) {
    throw new Error("AgentTask contains a reserved management term");
  }
  for (const forbidden of forbiddenValues) {
    if (forbidden.length > 0 && task.includes(forbidden)) {
      throw new Error("AgentTask contains hidden or sensitive material");
    }
  }
}

export function findSecretLeaks(bytes: Uint8Array, canaries: readonly string[]): readonly string[] {
  const text = Buffer.from(bytes).toString("utf8");
  return canaries.filter((canary) => canary.length > 0 && text.includes(canary));
}
