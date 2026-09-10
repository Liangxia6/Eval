/**
 * 把外部逐标签评分 JSON、Case 任务和已授权证据组装成一次 LLM Judge 请求。
 * 每个实例只代表一个 Label/Check；不重试、不修复响应。
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { JudgeDescriptor } from "../core/contracts.js";
import {
  digestValue,
  validateVersionedAssetId,
  type EvidenceRecord,
  type JsonObject,
  type LabelId,
} from "../core/models.js";
import type { JudgeDecision, JudgeImplementation } from "./judging.js";

const DEFAULT_ENDPOINT = "https://api.deepseek.com/chat/completions";
const DEFAULT_MODEL = "deepseek-chat";
const DEFAULT_TIMEOUT_MS = 30_000;
const JUDGE_VERSION = "1.0.0";

export interface LabelLlmJudgeFactoryOptions {
  readonly endpoint: string;
  readonly apiKey: string;
  readonly model: string;
  readonly scoringRoot: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
  readonly requestObserver?: (requestBody: JsonObject) => void;
}

function asObject(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function labelToken(labelId: LabelId): string {
  const slug = String(labelId).replace(/^label\./u, "").replace(/\/v1$/u, "");
  return slug === "retrieval-grounding" ? "retrieval" : slug.replaceAll("-", ".");
}

/** Label 配置使用的稳定 Judge ID；Planning 和执行阶段共享。 */
export function labelJudgeId(labelId: LabelId): JudgeDescriptor["judgeId"] {
  const slug = String(labelId).replace(/^label\./u, "").replace(/\/v1$/u, "");
  return validateVersionedAssetId<"JudgeId">(`judge.label.${slug}/v1`);
}

/** 构造 Planning 可校验的 LLM Judge 能力描述。 */
export function labelJudgeDescriptor(labelId: LabelId, checkType = "LLM_LABEL_SCORE"): JudgeDescriptor {
  const judgeId = labelJudgeId(labelId);
  return Object.freeze({
    judgeId,
    judgeVersion: JUDGE_VERSION,
    method: "LLM" as const,
    deterministic: false,
    checkType,
    capabilityDigest: digestValue({
      judgeId,
      judgeVersion: JUDGE_VERSION,
      method: "LLM",
      deterministic: false,
      checkType,
    }),
  });
}

/** 加载 Label 目录，为 Planning 注册能力；占位 evaluate 不会进入真实执行路径。 */
export async function loadLabelJudgeDeclarations(root: string): Promise<readonly JudgeImplementation[]> {
  const files = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, "en"));
  const implementations: JudgeImplementation[] = [];
  for (const file of files) {
    const asset = asObject(JSON.parse(await readFile(path.join(root, file), "utf8")), file);
    if (asset.schema !== "dsheval.label/v1") continue;
    const labelId = validateVersionedAssetId<"LabelId">(asset.labelId, `${file}.labelId`);
    const descriptor = labelJudgeDescriptor(labelId);
    implementations.push(Object.freeze({
      descriptor,
      checkType: descriptor.checkType,
      evaluate: async () => { throw new Error("Label Judge declaration cannot execute without a Case-bound factory"); },
    }));
  }
  return Object.freeze(implementations);
}

async function loadLabelAsset(root: string, labelId: LabelId): Promise<JsonObject> {
  const expected = labelToken(labelId);
  const files = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, "en"));
  for (const file of files) {
    const decoded = asObject(JSON.parse(await readFile(path.join(root, file), "utf8")), file);
    if (decoded.labelId !== labelId && decoded.label !== expected) continue;
    if (
      decoded.schema !== "dsheval.label/v1" ||
      typeof decoded.version !== "string" ||
      decoded.scoringStandard === undefined ||
      decoded.evidence === undefined ||
      decoded.judge === undefined
    ) {
      throw new Error(`Label asset ${file} has an invalid structure`);
    }
    return Object.freeze(decoded) as JsonObject;
  }
  throw new Error(`No scoring standard found for ${labelId}`);
}

function parseDecision(
  content: string,
  evidence: readonly EvidenceRecord[],
  passScore: number,
): JudgeDecision {
  const decoded = asObject(JSON.parse(content), "LLM Judge response");
  if (Object.keys(decoded).sort().join(",") !== "evidence_ids,reason,score") {
    throw new Error("LLM Judge response must contain exactly score, reason and evidence_ids");
  }
  if (!Number.isSafeInteger(decoded.score) || Number(decoded.score) < 0 || Number(decoded.score) > 4) {
    throw new Error("LLM Judge score must be an integer from 0 to 4");
  }
  if (typeof decoded.reason !== "string" || decoded.reason.trim().length === 0 || decoded.reason.length > 2000) {
    throw new Error("LLM Judge reason must be a non-empty string of at most 2000 characters");
  }
  if (!Array.isArray(decoded.evidence_ids) || decoded.evidence_ids.some((id) => typeof id !== "string")) {
    throw new Error("LLM Judge evidence_ids must be a string array");
  }
  const byId = new Map(evidence.map((record) => [String(record.evidenceId), record] as const));
  const cited = [...new Set(decoded.evidence_ids as string[])].map((id) => {
    const record = byId.get(id);
    if (record === undefined) throw new Error("LLM Judge cited evidence outside its authorization closure");
    return record;
  });
  const score = Number(decoded.score);
  return Object.freeze({
    outcome: score >= passScore ? "PASS" as const : "FAIL" as const,
    reasonCodes: Object.freeze([`LLM_LABEL_SCORE_${score}`]),
    findings: Object.freeze([Object.freeze({
      code: `LLM_LABEL_SCORE_${score}`,
      severity: score >= passScore ? "INFO" as const : score === passScore - 1 ? "WARNING" as const : "ERROR" as const,
      messageRedacted: `Score ${score}/4: ${decoded.reason.trim()}`,
      evidenceRefs: Object.freeze(cited.map((record) => ({
        schema: record.schema,
        id: record.evidenceId,
        digest: record.contentDigest,
      }))),
    })]),
  });
}

/** 复用一套 API 配置，为每个标签生成独立 Judge 实例。 */
export class OpenAiCompatibleLabelJudgeFactory {
  readonly #endpoint: string;
  readonly #apiKey: string;
  readonly #model: string;
  readonly #scoringRoot: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;
  readonly #signal: AbortSignal | undefined;
  readonly #requestObserver: ((requestBody: JsonObject) => void) | undefined;

  public constructor(options: LabelLlmJudgeFactoryOptions) {
    const endpoint = new URL(options.endpoint);
    if (endpoint.protocol !== "https:" || endpoint.username !== "" || endpoint.password !== "") {
      throw new Error("LLM Judge endpoint must be HTTPS without embedded credentials");
    }
    if (options.apiKey.trim().length === 0 || options.model.trim().length === 0) {
      throw new Error("LLM Judge API key and model are required");
    }
    this.#endpoint = endpoint.toString();
    this.#apiKey = options.apiKey;
    this.#model = options.model;
    this.#scoringRoot = path.resolve(options.scoringRoot);
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isSafeInteger(this.#timeoutMs) || this.#timeoutMs < 1) {
      throw new Error("LLM Judge timeout must be a positive integer");
    }
    this.#fetch = options.fetchImpl ?? fetch;
    this.#signal = options.signal;
    this.#requestObserver = options.requestObserver;
  }

  public forCheck(input: {
    readonly labelId: LabelId;
    readonly judgeId: JudgeDescriptor["judgeId"];
    readonly checkType: string;
    readonly caseTask: string;
  }): JudgeImplementation {
    const descriptor = labelJudgeDescriptor(input.labelId, input.checkType);
    if (descriptor.judgeId !== input.judgeId) throw new Error("Check Judge ID does not match its Label asset");
    return Object.freeze({
      descriptor,
      checkType: input.checkType,
      evaluate: async (evidence: readonly EvidenceRecord[], ruleParameters: JsonObject) => {
        const labelAsset = await loadLabelAsset(this.#scoringRoot, input.labelId);
        const judgeConfig = asObject(labelAsset.judge, `${input.labelId}.judge`);
        const passScore = Number(judgeConfig.passScore);
        if (!Number.isSafeInteger(passScore) || passScore < 0 || passScore > 4) {
          throw new Error(`${input.labelId}.judge.passScore must be an integer from 0 to 4`);
        }
        const prompt = Object.freeze({
          schema: "dsheval.label-judge-prompt/v1",
          role: judgeConfig.modelRole,
          instructions: judgeConfig.instructions,
          decision_rule: `score >= ${passScore} means PASS`,
          case_task: input.caseTask,
          label_id: input.labelId,
          label_scoring_standard: labelAsset.scoringStandard,
          check_parameters: ruleParameters,
          authorized_evidence: evidence,
          output_schema: judgeConfig.outputSchema,
        });
        const requestBody = Object.freeze({
          model: this.#model,
          messages: Object.freeze([Object.freeze({ role: "user", content: JSON.stringify(prompt) })]),
          temperature: 0,
          max_tokens: 1024,
          response_format: Object.freeze({ type: "json_object" }),
        });
        this.#requestObserver?.(requestBody);
        const timeoutSignal = AbortSignal.timeout(this.#timeoutMs);
        const signal = this.#signal === undefined ? timeoutSignal : AbortSignal.any([this.#signal, timeoutSignal]);
        const response = await this.#fetch(this.#endpoint, {
          method: "POST",
          headers: { authorization: `Bearer ${this.#apiKey}`, "content-type": "application/json" },
          body: JSON.stringify(requestBody),
          signal,
        });
        if (!response.ok) throw new Error(`LLM Judge request failed with HTTP ${response.status}`);
        const payload = asObject(await response.json(), "LLM Judge HTTP response");
        if (!Array.isArray(payload.choices) || payload.choices.length < 1) {
          throw new Error("LLM Judge HTTP response has no choices");
        }
        const choice = asObject(payload.choices[0], "LLM Judge choice");
        const message = asObject(choice.message, "LLM Judge message");
        if (typeof message.content !== "string") throw new Error("LLM Judge content must be a string");
        return parseDecision(message.content, evidence, passScore);
      },
    });
  }
}

/** 从环境变量创建真实 Judge；评分标准目录保持在代码外部。 */
export function createDefaultLabelJudgeFactory(
  environment: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
  signal?: AbortSignal,
): OpenAiCompatibleLabelJudgeFactory {
  const apiKey = environment.DSHEVAL_JUDGE_API_KEY ?? environment.DEEPSEEK_API_KEY;
  if (apiKey === undefined || apiKey.length === 0) {
    throw new Error("Set DSHEVAL_JUDGE_API_KEY or DEEPSEEK_API_KEY before a real evaluation Run");
  }
  const timeoutText = environment.DSHEVAL_JUDGE_TIMEOUT_MS;
  return new OpenAiCompatibleLabelJudgeFactory({
    endpoint: environment.DSHEVAL_JUDGE_MODEL_ENDPOINT ?? DEFAULT_ENDPOINT,
    apiKey,
    model: environment.DSHEVAL_JUDGE_MODEL ?? DEFAULT_MODEL,
    scoringRoot: environment.DSHEVAL_LABEL_ROOT ?? path.join(cwd, "labels"),
    timeoutMs: timeoutText === undefined ? DEFAULT_TIMEOUT_MS : Number(timeoutText),
    ...(signal === undefined ? {} : { signal }),
    ...(environment.DSHEVAL_DEBUG_JUDGE_PROMPT === "1" ? {
      requestObserver: (body: JsonObject) => {
        process.stderr.write(`[dsheval:judge-prompt] ${JSON.stringify(body, null, 2)}\n`);
      },
    } : {}),
  });
}
