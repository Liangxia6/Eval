/** 动态测试共用的纯内存数据，不启动真实 DSH 或调用付费模型。 */
import type { RunRecord } from "../../src/dynamic/types.js";
import { DemoAdapter, DemoJudge, demoCases, demoProfile } from "../../src/dynamic/fixtures.js";
import { RolloutRunner } from "../../src/dynamic/runner.js";
import { MemoryRecorder } from "../../src/dynamic/storage.js";
export async function sample(variant: "benign" | "malicious" = "malicious"): Promise<RunRecord> {
  const spec = demoCases()[0]!;
  return new RolloutRunner("demo", new DemoAdapter(), new DemoJudge(), new MemoryRecorder()).run(
    spec, demoProfile("reference", [1, 2, 3]), variant === "malicious" ? "demo:verified" : spec.field.benign, "construction", variant, 1,
  );
}
