/**
 * 把 observer-lab 中已安装的 macOS 组件适配器接入正式 Workflow。
 * 组件在 Agent 运行窗口内轮询，但只把真实状态变化写成触发事件。
 */
import { spawn, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  digestValue,
  refForImmutable,
  validateIsoDateTime,
  validateScope,
  validateStableId,
  withContentDigest,
  type ArtifactRef,
  type CollectionStatus,
  type JsonObject,
  type JsonValue,
  type RawObservation,
  type Ref,
  type ScopeRef,
  type SensorAdapterDescriptor,
  type SourceDescriptor,
  type SourceRequirement,
} from "../core/models.js";

export const LAB_COMPONENTS = Object.freeze([
  { component: "desktop", sourceType: "DESKTOP", implementationId: "dsheval.macos-desktop-sensor", capabilities: ["FRONTMOST_APPLICATION", "SCREENSHOT", "VISIBLE_APPLICATIONS", "WINDOW_TITLES"] },
  { component: "browser", sourceType: "BROWSER", implementationId: "dsheval.macos-browser-sensor", capabilities: ["ACTIVE_URL", "BROWSER_RUNNING", "TAB_TITLES", "TAB_URLS"] },
  { component: "database", sourceType: "DATABASE", implementationId: "dsheval.database-sensor", capabilities: ["DATABASE_AVAILABILITY", "QUERY_DIGEST", "SCHEMA_STATE", "SERVICE_STATE"] },
  { component: "network", sourceType: "NETWORK", implementationId: "dsheval.macos-network-sensor", capabilities: ["ESTABLISHED_CONNECTIONS", "LISTENING_PORTS", "TCP_ENDPOINTS", "UDP_ENDPOINTS"] },
  { component: "external-api", sourceType: "EXTERNAL_API", implementationId: "dsheval.external-api-sensor", capabilities: ["HTTP_STATUS", "MOCK_REQUEST_LOG", "RESPONSE_DIGEST", "STATE_ENDPOINT"] },
  { component: "clipboard", sourceType: "CLIPBOARD", implementationId: "dsheval.macos-clipboard-sensor", capabilities: ["BYTE_LENGTH", "CONTENT_DIGEST", "READ_ONLY"] },
  { component: "application", sourceType: "APPLICATION", implementationId: "dsheval.macos-application-sensor", capabilities: ["APPLICATION_PATHS", "INSTALLED_APPLICATIONS", "RUNNING_APPLICATIONS"] },
  { component: "system", sourceType: "SYSTEM", implementationId: "dsheval.macos-system-sensor", capabilities: ["BOOT_TIME", "BREW_SERVICES", "LOCALE", "OS_VERSION", "TIMEZONE"] },
].map((item) => Object.freeze({ ...item, capabilities: Object.freeze([...item.capabilities].sort()) })));

export const LAB_SENSOR_DESCRIPTORS: readonly SensorAdapterDescriptor[] = Object.freeze(
  LAB_COMPONENTS.map((item) => Object.freeze({
    implementationId: validateStableId<"SensorImplementationId">(item.implementationId),
    implementationVersion: "1.0.0",
    capabilityDigest: digestValue(item.capabilities),
    sourceType: item.sourceType,
    capabilities: item.capabilities,
  })),
);

export function createLabSourceDescriptor(input: {
  readonly requirement: SourceRequirement;
  readonly sourceId: string;
  readonly scope: ScopeRef;
  readonly createdAt: string;
  readonly producerVersion: string;
}): SourceDescriptor {
  const descriptor = LAB_SENSOR_DESCRIPTORS.find((item) =>
    item.sourceType === input.requirement.sourceType &&
    item.implementationId === input.requirement.sensorImplementationId);
  if (descriptor === undefined) throw new Error(`No observer-lab descriptor for ${input.requirement.sourceType}`);
  return withContentDigest({
    schema: "dsheval.mvp.source/v1" as const,
    sourceId: validateStableId<"SourceId">(input.sourceId),
    scope: validateScope(input.scope),
    sourceType: descriptor.sourceType,
    externalSchema: "dsheval.observer.event/v1",
    collectorName: descriptor.implementationId,
    collectorVersion: descriptor.implementationVersion,
    collectorCapabilityDigest: descriptor.capabilityDigest,
    trust: "INDEPENDENT" as const,
    resourceBinding: input.requirement.resourceBinding,
    sequenceMode: "CONTIGUOUS_FROM_ONE",
    watermarkDefinition: input.requirement.watermarkDefinition,
    contentMode: input.requirement.contentMode,
    knownBlindSpots: ["POLLING_INTERVAL_250MS", "EXTERNAL_OBSERVER_DOES_NOT_PROVE_AGENT_CAUSALITY"],
    createdAt: validateIsoDateTime(input.createdAt),
    producerVersion: input.producerVersion,
  });
}

interface WatchProcess {
  readonly component: string;
  readonly sourceType: string;
  readonly output: string;
  readonly openedAt: string;
  readonly child: ChildProcess;
}

export interface LabCapture {
  readonly component: string;
  readonly sourceType: string;
  readonly openedAt: string;
  readonly closedAt: string;
  readonly events: readonly JsonObject[];
  readonly complete: boolean;
  readonly reasonCode?: string;
}

function readEvents(text: string, component: string): readonly JsonObject[] {
  return Object.freeze(text.split(/\r?\n/u).filter((line) => line.trim().length > 0).map((line, index) => {
    const value = JSON.parse(line) as unknown;
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`${component} event ${index} is not an object`);
    }
    const event = value as JsonObject;
    if (event.schema !== "dsheval.observer.event/v1" || event.component !== component) {
      throw new Error(`${component} event ${index} has an invalid envelope`);
    }
    return Object.freeze(event);
  }));
}

async function stopChild(watcher: WatchProcess): Promise<LabCapture> {
  if (watcher.child.exitCode === null && watcher.child.signalCode === null) watcher.child.kill("SIGTERM");
  const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    if (watcher.child.exitCode !== null || watcher.child.signalCode !== null) {
      resolve({ code: watcher.child.exitCode, signal: watcher.child.signalCode });
    } else {
      watcher.child.once("exit", (code, signal) => resolve({ code, signal }));
    }
  });
  const closedAt = new Date().toISOString();
  try {
    const events = readEvents(await readFile(watcher.output, "utf8"), watcher.component);
    const complete = result.code === 0 || result.signal === "SIGTERM";
    return Object.freeze({
      component: watcher.component,
      sourceType: watcher.sourceType,
      openedAt: watcher.openedAt,
      closedAt,
      events,
      complete,
      ...(complete ? {} : { reasonCode: "OBSERVER_LAB_PROCESS_FAILED" }),
    });
  } catch {
    return Object.freeze({
      component: watcher.component,
      sourceType: watcher.sourceType,
      openedAt: watcher.openedAt,
      closedAt,
      events: Object.freeze([]),
      complete: false,
      reasonCode: "OBSERVER_LAB_OUTPUT_INVALID",
    });
  }
}

/** 启动全部外部环境 Observer；返回的 stop 必须在 Agent 结束后调用。 */
export async function startLabObservers(input: {
  readonly cwd: string;
  readonly outputDirectory: string;
  readonly caseId: string;
  readonly agentId: string;
  readonly requirements: readonly SourceRequirement[];
}): Promise<{ readonly stop: () => Promise<readonly LabCapture[]> }> {
  const script = path.join(input.cwd, "observer-lab", "bin", "observer-smoke.mjs");
  const config = path.join(input.cwd, "observer-lab", "config", "macos-worker.json");
  const starts = await Promise.all(input.requirements.map(async (requirement): Promise<
    { readonly watcher: WatchProcess } | { readonly failure: LabCapture } | undefined
  > => {
    const component = LAB_COMPONENTS.find((item) => item.sourceType === requirement.sourceType);
    if (component === undefined) return undefined;
    const output = path.join(input.outputDirectory, `${component.component}.jsonl`);
    const openedAt = new Date().toISOString();
    const child = spawn(process.execPath, [
      script,
      component.component,
      "watch",
      "--config", config,
      "--output", output,
      "--interval-ms", "250",
      "--case-id", input.caseId,
      "--agent-id", input.agentId,
    ], { cwd: input.cwd, stdio: ["ignore", "pipe", "ignore"] });
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${component.component} Observer did not become ready`)), 10_000);
        child.once("error", (error) => { clearTimeout(timer); reject(error); });
        child.stdout!.once("data", () => { clearTimeout(timer); child.stdout!.resume(); resolve(); });
        child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`${component.component} Observer exited before ready (${code ?? "signal"})`)); });
      });
      return { watcher: { component: component.component, sourceType: component.sourceType, output, openedAt, child } };
    } catch {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
      return { failure: Object.freeze({
        component: component.component,
        sourceType: component.sourceType,
        openedAt,
        closedAt: new Date().toISOString(),
        events: Object.freeze([]),
        complete: false,
        reasonCode: "OBSERVER_LAB_START_FAILED",
      }) };
    }
  }));
  const watchers = starts.flatMap((result) => result !== undefined && "watcher" in result ? [result.watcher] : [])
    .sort((left, right) => left.component.localeCompare(right.component, "en"));
  const startupFailures = starts.flatMap((result) => result !== undefined && "failure" in result ? [result.failure] : [])
    .sort((left, right) => left.component.localeCompare(right.component, "en"));
  let stopped: Promise<readonly LabCapture[]> | undefined;
  return Object.freeze({
    stop: () => stopped ??= Promise.all(watchers.map(stopChild)).then((captures) => Object.freeze([
      ...startupFailures,
      ...captures,
    ])),
  });
}

export function materializeLabObservations(input: {
  readonly capture: LabCapture;
  readonly source: SourceDescriptor;
  readonly scope: ScopeRef;
  readonly attemptId: string;
  readonly producerVersion: string;
  readonly rawArtifactRef: Ref<ArtifactRef>;
}): { readonly observations: readonly RawObservation[]; readonly status: CollectionStatus } {
  const scope = validateScope(input.scope);
  const sourceRef = refForImmutable(input.source, input.source.sourceId);
  const observations = input.capture.events.map((event, index) => withContentDigest({
    schema: "dsheval.mvp.raw-observation/v1" as const,
    observationId: validateStableId<"ObservationId">(`raw.${input.capture.component}.${input.attemptId}.${index + 1}`),
    scope,
    attemptId: validateStableId<"AttemptId">(input.attemptId),
    sourceRef,
    externalEventType: "environment/change",
    sourceTime: {
      observedAt: validateIsoDateTime(String(event.observedAt), "observer event observedAt"),
      sourceSeq: index + 1,
      clockDomain: `observer-lab-${input.capture.component}`,
    },
    payloadInline: event as JsonValue,
    captureMetadata: {
      component: input.capture.component,
      association: event.association ?? {},
      trigger: event.trigger ?? {},
      rawArtifactRef: {
        schema: input.rawArtifactRef.schema,
        id: input.rawArtifactRef.id,
        digest: {
          algorithm: input.rawArtifactRef.digest.algorithm,
          value: input.rawArtifactRef.digest.value,
          byteLength: input.rawArtifactRef.digest.byteLength,
        },
      } as JsonObject,
    },
    rawDigest: digestValue(event),
    createdAt: input.capture.closedAt,
    producerVersion: input.producerVersion,
  }));
  const status = withContentDigest({
    schema: "dsheval.mvp.collection-status/v1" as const,
    collectionStatusId: validateStableId<"CollectionStatusId">(`collection.${input.capture.component}.${input.attemptId}`),
    scope,
    sourceRef,
    openedAt: validateIsoDateTime(input.capture.openedAt),
    closedAt: validateIsoDateTime(input.capture.closedAt),
    recordCount: observations.length,
    ...(observations.length === 0 ? {} : { firstSourceSeq: 1, lastSourceSeq: observations.length }),
    finalWatermark: { eventCount: observations.length, mode: "STATE_CHANGE" },
    gaps: input.capture.complete ? [] : [{ kind: "OBSERVER_PROCESS", reasonCode: input.capture.reasonCode ?? "OBSERVER_LAB_INCOMPLETE" }],
    truncated: false,
    health: input.capture.complete ? "HEALTHY" as const : "DEGRADED" as const,
    completeness: input.capture.complete ? "COMPLETE" as const : "PARTIAL" as const,
    failureRefs: [],
    createdAt: input.capture.closedAt,
    producerVersion: input.producerVersion,
  });
  return Object.freeze({ observations: Object.freeze(observations), status });
}
