import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  validateScope,
  validateStableId,
  validateVersionedAssetId,
  withContentDigest,
  type EvidenceRecord,
  type JsonObject,
} from "../../src/core/models.js";
import { OpenAiCompatibleLabelJudgeFactory } from "../../src/evaluation/llm-label-judge.js";

test("每个标签 Judge 注入评分 JSON 和授权证据且只调用一次 API", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dsheval-label-judge-"));
  let calls = 0;
  let requestBody: JsonObject | undefined;
  try {
    await writeFile(path.join(root, "05_tool.code.json"), JSON.stringify({
      schema: "dsheval.label/v1",
      version: "1.0.0",
      labelId: "label.tool-code/v1",
      evidence: { requiredFactTypes: ["PROTOCOL_LIFECYCLE"] },
      judge: {
        modelRole: "逐标签 Judge",
        instructions: ["只使用授权证据"],
        outputSchema: { score: "integer", reason: "string", evidence_ids: "string[]" },
        passScore: 3,
      },
      scoringStandard: { label: "tool.code", scoring_scale: { min: 0, max: 4 } },
    }), "utf8");
    const evidence = withContentDigest({
      schema: "dsheval.mvp.evidence/v1" as const,
      evidenceId: validateStableId<"EvidenceId">("evidence.tool-trace"),
      scope: validateScope({
        targetId: "target.fixture",
        targetSnapshotId: "snapshot.fixture",
        runId: "run.fixture",
        caseId: "case.fixture",
        attemptId: "attempt.fixture",
      }),
      attemptId: validateStableId<"AttemptId">("attempt.fixture"),
      factType: "PROTOCOL_LIFECYCLE",
      factValue: { events: [] },
      sourceRefs: [], observationRefs: [], artifactRefs: [],
      authority: "COMMITTED" as const,
      timeRange: {}, completeness: "COMPLETE" as const, validity: "VALID" as const,
      trust: "COOPERATIVE" as const,
      createdAt: "2026-09-05T00:00:00.000Z",
      producerVersion: "0.1.0",
    }) satisfies EvidenceRecord;
    const factory = new OpenAiCompatibleLabelJudgeFactory({
      endpoint: "https://judge.example/v1/chat/completions",
      apiKey: "test-key",
      model: "test-model",
      scoringRoot: root,
      requestObserver: (body) => { requestBody = body; },
      fetchImpl: async () => {
        calls += 1;
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
          score: 4,
          reason: "代码执行和验证证据完整",
          evidence_ids: ["evidence.tool-trace"],
        }) } }] }), { status: 200, headers: { "content-type": "application/json" } });
      },
    });
    const judge = factory.forCheck({
      labelId: validateVersionedAssetId<"LabelId">("label.tool-code/v1"),
      judgeId: validateVersionedAssetId<"JudgeId">("judge.label.tool-code/v1"),
      checkType: "TOOL_COMPLETED",
      caseTask: "运行并验证代码",
    });
    const result = await judge.evaluate([evidence], { toolNamePatterns: ["python"] });
    assert.equal(calls, 1);
    assert.equal(result.outcome, "PASS");
    assert.deepEqual(result.reasonCodes, ["LLM_LABEL_SCORE_4"]);
    const messages = requestBody?.messages as readonly { readonly content: string }[];
    const prompt = JSON.parse(messages[0]!.content) as Record<string, unknown>;
    assert.equal(prompt.label_id, "label.tool-code/v1");
    assert.equal((prompt.label_scoring_standard as Record<string, unknown>).label, "tool.code");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
