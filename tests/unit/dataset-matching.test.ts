/** 测试功能：统一 Planner 一次读取静态观测和 Dataset 描述，并确定性派生标签。 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  DATASET_TEST_POLICIES,
  OpenAiCompatibleDatasetMatcher,
  type DatasetCandidate,
} from "../../src/planning/planner.js";
import type { DshStaticInfo } from "../../src/planning/agent-static.js";
import { validateVersionedAssetId, type JsonObject, type LabelId } from "../../src/core/models.js";

const TOOL_CODE = validateVersionedAssetId<"LabelId">("label.tool-code/v1");
const MEMORY = validateVersionedAssetId<"LabelId">("label.memory/v1");
const STATIC_INFO: DshStaticInfo = {
  target_type: "FULL_AGENT",
  dsh_version: { version: "test" },
  profile: { name: "headless" },
  plugins: [{
    id: "example-agent-plugin",
    version: "1.2.3",
    description: "Adds repository-aware code review",
    role: "CUSTOM",
  }],
  tools: [{
    name: "repository-review",
    description: "Reviews a source repository",
    classification: "ADDED",
  }],
  tool_delta: {
    baseline: "@deepseek-ai/dsh-base",
    comparisonStatus: "KNOWN",
    added: [{ name: "repository-review" }],
    native: [],
    missingNativeImplementations: [],
    overridden: [],
    limitations: [],
  },
  permission_preset: "workspace-write",
  sandbox_mode: "workspace-write",
  probe: { configured: false },
  limitations: [],
};

function candidate(index: number, labels: readonly LabelId[] = [TOOL_CODE]): DatasetCandidate {
  return {
    datasetId: validateVersionedAssetId<"DatasetId">(`dataset.candidate-${index}/v1`),
    name: `Candidate ${index}`,
    description: `Dynamic Dataset description ${index}`,
    labelIds: labels,
    availableCaseCount: 30,
  };
}

function matcherReturning(
  selected: readonly { index: number; count: number }[],
  observe?: (body: JsonObject) => void,
): OpenAiCompatibleDatasetMatcher {
  return new OpenAiCompatibleDatasetMatcher({
    endpoint: "https://model.example/v1/chat/completions",
    apiKey: "test-key",
    model: "planner-model",
    promptRoot: "planning/prompts",
    ...(observe === undefined ? {} : { requestObserver: observe }),
    fetchImpl: async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            selected_datasets: selected.map(({ index, count }) => ({
              dataset_id: `dataset.candidate-${index}/v1`,
              case_count: count,
              reason: `candidate ${index} matches the static tools`,
            })),
          }),
        },
      }],
    })),
  });
}

test("统一 Planner 只调用一次，并动态注入静态观测和 Dataset 描述", async () => {
  let observed: JsonObject | undefined;
  const plan = await matcherReturning([{ index: 1, count: 2 }], (body) => { observed = body; }).select({
    agentStaticInfo: STATIC_INFO,
    availableDatasets: [candidate(1, [TOOL_CODE, MEMORY])],
    profile: "STANDARD",
  });

  assert.equal(plan.schema, "dsheval.mvp.unified-planner-result/v1");
  assert.equal(plan.selectedDatasets[0]?.datasetId, "dataset.candidate-1/v1");
  assert.deepEqual(plan.selectedDatasets[0]?.evaluationLabelIds, [MEMORY, TOOL_CODE]);
  assert.deepEqual(plan.evaluationLabelIds, [MEMORY, TOOL_CODE]);
  assert.equal(plan.totalCaseCount, 2);
  const messages = observed?.messages as readonly { role: string; content: string }[];
  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.role, "user");
  const prompt = messages[0]?.content ?? "";
  assert.equal((JSON.parse(prompt) as { schema: string }).schema, "dsheval.unified-planner-prompt/v2");
  assert.match(prompt, /"target_type": "FULL_AGENT"/u);
  assert.match(prompt, /Adds repository-aware code review/u);
  assert.match(prompt, /"classification": "ADDED"/u);
  assert.match(prompt, /"tool_delta"/u);
  assert.match(prompt, /Dynamic Dataset description 1/u);
  assert.doesNotMatch(prompt, /\{\{[A-Z0-9_]+\}\}/u);
});

test("MVP 只保留 STANDARD 测试规模", () => {
  assert.deepEqual(Object.keys(DATASET_TEST_POLICIES), ["STANDARD"]);
  assert.equal(DATASET_TEST_POLICIES.STANDARD.maxTotalCases, 60);
});

test("模型不能选择目录外 Dataset 或越过题量预算", async () => {
  await assert.rejects(
    matcherReturning([{ index: 2, count: 1 }]).select({
      agentStaticInfo: STATIC_INFO,
      availableDatasets: [candidate(1)],
      profile: "STANDARD",
    }),
    /not an available Dataset/u,
  );
  await assert.rejects(
    matcherReturning([{ index: 1, count: 11 }]).select({
      agentStaticInfo: STATIC_INFO,
      availableDatasets: [candidate(1)],
      profile: "STANDARD",
    }),
    /violates the Dataset or profile budget/u,
  );
});
