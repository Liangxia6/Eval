#!/usr/bin/env node
/** 动态测评独立 CLI；保留原 MVP CLI，不修改既有静态测评命令。 */
import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { CommandProposer, CommandTrajectoryJudge, DshBridgeAdapter, validateBridge } from "./adapters.js";
import { DemoAdapter, DemoJudge, DemoProposer, demoCases, demoProfile, demoProfiles } from "./fixtures.js";
import { DEFAULT_POLICY } from "./types.js";
import type { RunRecord, SuiteContent } from "./types.js";
import { DirectoryRecorder, readJson } from "./storage.js";
import { constructSuite, evaluateSuite, verifySuite, validateEvaluation } from "./workflow.js";
import { RolloutRunner } from "./runner.js";
import { buildReport, renderHtml } from "./report.js";
import { digest, DynamicError, list, object, requireThat, validateCase, validatePolicy, validateProfile } from "./validation.js";

const DEMO_COMPONENTS: SuiteContent["components"] = { runner: "demo-runner/v1", proposer: "demo-proposer/v1", judge: "demo-structural-judge/v1" };
function parse(args: string[]): { command: string; options: Record<string, string> } {
  const command = args[0] ?? "help";
  const allowed: Record<string, string[]> = {
    demo: ["out"], construct: ["out", "cases", "reference", "policy", "bridge", "allow-dsh-execution"],
    evaluate: ["out", "suite", "profiles", "bridge", "allow-dsh-execution"], verify: ["suite"], report: ["out", "suite", "records"], help: [],
  };
  requireThat(command in allowed, "BAD_ARGUMENT", "Unknown command; run dynamic help");
  const options: Record<string, string> = {};
  for (let i = 1; i < args.length; i++) {
    const key = args[i]!.replace(/^--/, "");
    requireThat(args[i]!.startsWith("--") && allowed[command]!.includes(key) && !(key in options), "BAD_ARGUMENT", `Unknown/duplicate option: ${key}`);
    if (key === "allow-dsh-execution") options[key] = "true";
    else { const value = args[++i]; requireThat(value && !value.startsWith("--"), "BAD_ARGUMENT", `Missing value for ${key}`); options[key] = value; }
  }
  return { command, options };
}
function required(options: Record<string, string>, key: string): string {
  requireThat(options[key], "BAD_ARGUMENT", `Missing --${key}`); return options[key];
}
async function saveReport(root: string, suite: Parameters<typeof buildReport>[0], records: RunRecord[]): Promise<void> {
  const report = buildReport(suite, records);
  await writeFile(path.join(root, "report.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  await writeFile(path.join(root, "report.html"), renderHtml(report), { flag: "wx" });
}
export async function main(args: string[]): Promise<number> {
  try {
    const { command, options } = parse(args);
    if (command === "help") {
      console.log(`DSH dynamic safety evaluation
  demo      --out DIR                                模拟闭环（不调用模型/DSH）
  construct --cases JSON --reference JSON --bridge JSON --out DIR [--policy JSON] --allow-dsh-execution
  evaluate  --suite JSON --profiles JSON --bridge JSON --out DIR --allow-dsh-execution
  verify    --suite JSON                              复算冻结用例验收证据
  report    --suite JSON --records EVALUATION_DIR --out NEW_DIR
All output directories must be new. See docs/dynamic/README.md.`);
      return 0;
    }
    if (command === "demo") {
      const root = await DirectoryRecorder.create(required(options, "out"));
      const cases = demoCases(), profiles = demoProfiles(), reference = demoProfile("demo-reference", [1, 2, 3]);
      await root.write("inputs", "cases", cases); await root.write("inputs", "profiles", profiles); await root.write("inputs", "reference", reference);
      const construction = await DirectoryRecorder.create(path.join(root.root, "construction"));
      const suite = await constructSuite(cases, reference, DEFAULT_POLICY,
        new RolloutRunner("demo", new DemoAdapter(), new DemoJudge(), construction), new DemoProposer(), DEMO_COMPONENTS);
      const evaluation = await DirectoryRecorder.create(path.join(root.root, "evaluation"));
      const records = await evaluateSuite(suite, profiles, new RolloutRunner("demo", new DemoAdapter(), new DemoJudge(), evaluation), DEMO_COMPONENTS);
      await saveReport(evaluation.root, suite, records);
      console.log(`DEMO ONLY: ${suite.content.accepted.length} accepted fixture pairs; ${records.length} evaluation runs.\n${path.join(evaluation.root, "report.html")}`);
      return records.some(r => r.score.status === "INVALID") ? 3 : 0;
    }
    if (command === "verify") {
      const suite = verifySuite(await readJson(required(options, "suite")));
      console.log(`${suite.content.mode}: ${suite.content.accepted.length} verified pairs; ${suite.content.rejected.length} rejected; ${suite.digest}`);
      return suite.content.accepted.length === 15 ? 0 : 2;
    }
    if (command === "report") {
      const suite = verifySuite(await readJson(required(options, "suite")));
      const recordsRoot = path.join(path.resolve(required(options, "records")), "runs");
      const files = (await readdir(recordsRoot)).filter(f => f.endsWith(".json")).sort();
      const records = await Promise.all(files.map(file => readJson(path.join(recordsRoot, file)))) as RunRecord[];
      const completion = object(await readJson(path.join(path.resolve(required(options, "records")), "evaluation", "complete.json")));
      requireThat(completion.suiteDigest === suite.digest && digest(completion.runDigests)
        === digest(Object.fromEntries(records.map(r => [r.request.runId, digest(r)]))), "RECORDS_CHANGED", "Evaluation records differ from completion manifest");
      // Validate before creating output; malformed data must not generate a plausible-looking report.
      buildReport(suite, records);
      const output = await DirectoryRecorder.create(required(options, "out"));
      await saveReport(output.root, suite, records);
      console.log(path.join(output.root, "report.html")); return 0;
    }
    requireThat(options["allow-dsh-execution"] === "true", "EXECUTION_NOT_ENABLED", "Real bridges require --allow-dsh-execution and an isolated test environment");
    const bridge = validateBridge(await readJson(required(options, "bridge")));
    requireThat(!JSON.stringify(bridge).includes("REPLACE-") && !JSON.stringify(bridge).includes("/absolute/path/"), "TEMPLATE_CONFIG", "Replace bridge template values before real execution");
    const components = { runner: digest(bridge.runner), proposer: digest(bridge.proposer), judge: digest(bridge.judge) };
    const adapter = new DshBridgeAdapter(bridge.runner), judge = new CommandTrajectoryJudge(bridge.judge);
    if (command === "construct") {
      const cases = list(await readJson(required(options, "cases"))).map(validateCase);
      const reference = validateProfile(await readJson(required(options, "reference")));
      requireThat(!JSON.stringify(reference).includes("REPLACE-"), "TEMPLATE_CONFIG", "Replace reference profile template values");
      const policy = options.policy ? validatePolicy(await readJson(options.policy)) : DEFAULT_POLICY;
      requireThat(cases.length === 15 && cases.every(c => c.readiness === "reviewed"), "V1_COVERAGE_GAP", "Provide 15 reviewed DSH cases, not demo/templates");
      const output = await DirectoryRecorder.create(required(options, "out"));
      const suite = await constructSuite(cases, reference, policy, new RolloutRunner("dsh", adapter, judge, output), new CommandProposer(bridge.proposer), components);
      console.log(`${suite.content.accepted.length}/15 accepted; ${suite.content.rejected.length} rejected.\n${path.join(output.root, "suite", "frozen.json")}`);
      return suite.content.accepted.length === 15 ? 0 : 2;
    }
    const suite = verifySuite(await readJson(required(options, "suite")));
    requireThat(suite.content.mode === "dsh", "MODE_MISMATCH", "Demo suite cannot be used as DSH evaluation");
    const profiles = list(await readJson(required(options, "profiles"))).map(validateProfile);
    validateEvaluation(suite, profiles, components);
    const output = await DirectoryRecorder.create(required(options, "out"));
    const records = await evaluateSuite(suite, profiles, new RolloutRunner("dsh", adapter, judge, output), components);
    await saveReport(output.root, suite, records);
    console.log(path.join(output.root, "report.html"));
    return records.some(r => r.score.status === "INVALID") ? 3 : 0;
  } catch (error) {
    const code = error instanceof DynamicError ? error.code : "IO_OR_SYSTEM_ERROR";
    console.error(`${code}: ${error instanceof DynamicError ? error.message : "Operation failed; check paths, permissions and artifact integrity."}`);
    return 4;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = await main(process.argv.slice(2));
