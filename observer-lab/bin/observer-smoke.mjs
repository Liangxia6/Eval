#!/usr/bin/env node
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { adapters } from "../adapters/index.mjs";
import {
  appendJsonLine,
  changeEvent,
  diffSnapshots,
  prepareJsonl,
  readJson,
  writeJson,
} from "../lib/core.mjs";

function option(args, name) {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}

function usage() {
  return [
    "observer-smoke <component> describe",
    "observer-smoke <component> baseline|capture|reset-check [--config FILE] [--output FILE]",
    "observer-smoke <component> diff --before FILE --after FILE [--output FILE]",
    "observer-smoke <component> watch [--config FILE] [--output FILE] [--interval-ms N] [--duration-ms N] [--case-id ID] [--agent-id ID] [--agent-pid PID]",
    `components: ${Object.keys(adapters).join(", ")}`,
  ].join("\n");
}

function positiveInteger(args, name, fallback) {
  const raw = option(args, name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const args = process.argv.slice(2);
const component = args[0];
const action = args[1];
const adapter = adapters[component];
if (!adapter || !action) {
  console.error(usage());
  process.exitCode = 2;
} else {
  const configFile = option(args, "--config") ?? path.resolve("observer-lab/config/macos-worker.json");
  const fullConfig = await readJson(configFile);
  const componentConfig = fullConfig.components?.[component] ?? {};
  const stamp = new Date().toISOString().replaceAll(/[:.]/gu, "-");
  const extension = action === "watch" ? "jsonl" : "json";
  const output = path.resolve(option(args, "--output") ?? `/tmp/dsheval-observer-lab/${component}-${action}-${stamp}.${extension}`);
  if (action === "describe") {
    console.log(JSON.stringify({ component, capabilities: [...adapter.capabilities].sort(), config: componentConfig }, null, 2));
  } else if (action === "diff") {
    const beforeFile = option(args, "--before");
    const afterFile = option(args, "--after");
    if (!beforeFile || !afterFile) throw new Error("diff requires --before and --after");
    const result = diffSnapshots(await readJson(beforeFile), await readJson(afterFile));
    await writeJson(output, result);
    console.log(JSON.stringify({ status: "COMPLETED", component, action, output, changed: result.changed }));
  } else if (["baseline", "capture", "reset-check"].includes(action)) {
    await mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
    const phase = action === "baseline" ? "BEFORE" : action === "reset-check" ? "POST_RESET" : "AFTER";
    const result = await adapter.capture({ phase, config: componentConfig, outputDirectory: path.dirname(output) });
    await writeJson(output, result);
    console.log(JSON.stringify({ status: "COMPLETED", component, action, completeness: result.completeness, output }));
  } else if (action === "watch") {
    const intervalMs = positiveInteger(args, "--interval-ms", 250);
    const durationMs = positiveInteger(args, "--duration-ms", undefined);
    const agentPid = positiveInteger(args, "--agent-pid", undefined);
    const scope = {
      ...(option(args, "--case-id") ? { caseId: option(args, "--case-id") } : {}),
      ...(option(args, "--agent-id") ? { agentId: option(args, "--agent-id") } : {}),
      ...(agentPid ? { agentPid } : {}),
    };
    await prepareJsonl(output);
    let stopping = false;
    process.once("SIGINT", () => { stopping = true; });
    process.once("SIGTERM", () => { stopping = true; });
    const started = Date.now();
    let previous = await adapter.capture({ phase: "BEFORE", config: componentConfig, outputDirectory: path.dirname(output) });
    let eventCount = 0;
    console.log(JSON.stringify({ status: "WATCHING", component, output, intervalMs, ...(durationMs ? { durationMs } : {}), scope }));
    while (!stopping && (durationMs === undefined || Date.now() - started < durationMs)) {
      await delay(intervalMs);
      const current = await adapter.capture({ phase: "ACTIVE", config: componentConfig, outputDirectory: path.dirname(output) });
      const event = changeEvent({
        component,
        sequence: eventCount + 1,
        before: previous,
        after: current,
        intervalMs,
        scope,
      });
      previous = current;
      if (event === undefined) continue;
      eventCount += 1;
      await appendJsonLine(output, event);
      console.log(JSON.stringify({ status: "TRIGGERED", component, sequence: eventCount, changeCount: event.changes.length, output }));
    }
    console.log(JSON.stringify({ status: "COMPLETED", component, action, eventCount, output }));
  } else {
    throw new Error(usage());
  }
}
