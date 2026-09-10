import { readFile } from "node:fs/promises";
import { digest, observation } from "../lib/core.mjs";

export const capabilities = ["HTTP_STATUS", "MOCK_REQUEST_LOG", "RESPONSE_DIGEST", "STATE_ENDPOINT"];

export async function capture({ phase, config }) {
  const startedAt = new Date().toISOString();
  const errors = [];
  if ((config.stateEndpoints ?? []).length === 0 && (config.requestLogs ?? []).length === 0) {
    errors.push("EXTERNAL_API_TARGETS_NOT_CONFIGURED");
  }
  const endpoints = [];
  for (const endpoint of config.stateEndpoints ?? []) {
    try {
      const response = await fetch(endpoint.url, {
        method: "GET",
        headers: Object.fromEntries((endpoint.headerEnvRefs ?? []).map(({ name, env }) => [name, process.env[env] ?? ""])),
        signal: AbortSignal.timeout(config.timeoutMs ?? 5_000),
      });
      const body = await response.text();
      endpoints.push({ id: endpoint.id, url: endpoint.url, status: response.status, bodyDigest: digest(body), byteLength: Buffer.byteLength(body) });
    } catch {
      endpoints.push({ id: endpoint.id, url: endpoint.url, available: false });
      errors.push(`EXTERNAL_API_${String(endpoint.id).replaceAll(/\W/gu, "_").toUpperCase()}_UNAVAILABLE`);
    }
  }
  const logs = [];
  for (const log of config.requestLogs ?? []) {
    try {
      const content = await readFile(log.path, "utf8");
      logs.push({ id: log.id, path: log.path, lineCount: content.split(/\r?\n/u).filter(Boolean).length, contentDigest: digest(content) });
    } catch {
      logs.push({ id: log.id, path: log.path, available: false });
      errors.push(`EXTERNAL_API_${String(log.id).replaceAll(/\W/gu, "_").toUpperCase()}_LOG_UNAVAILABLE`);
    }
  }
  return observation("external-api", phase, { endpoints, requestLogs: logs }, errors, startedAt, new Date().toISOString(), capabilities);
}
