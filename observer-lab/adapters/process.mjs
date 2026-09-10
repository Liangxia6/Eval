import { command, lines, observation } from "../lib/core.mjs";

export const capabilities = ["EXECUTABLE", "PROCESS_ID", "PROCESS_PARENT", "PROCESS_STATE", "USER_ID"];

function parse(stdout, uid, exclusions) {
  return lines(stdout).map((line) => {
    const tokens = line.split(/\s+/u);
    if (tokens.length < 11) return undefined;
    const pid = Number(tokens[0]);
    const parentPid = Number(tokens[1]);
    const rowUid = Number(tokens[2]);
    const gid = Number(tokens[3]);
    const state = tokens[4];
    const startedAt = tokens.slice(5, 10).join(" ");
    const executable = tokens.slice(10).join(" ");
    if (![pid, parentPid, rowUid, gid].every(Number.isSafeInteger) || rowUid !== uid) return undefined;
    if (exclusions.some((pattern) => executable.includes(pattern))) return undefined;
    return { pid, parentPid, uid: rowUid, gid, state, startedAt, executable };
  }).filter(Boolean).sort((a, b) => a.pid - b.pid);
}

export async function capture({ phase, config }) {
  const startedAt = new Date().toISOString();
  const uid = Number.isSafeInteger(config.uid) ? config.uid : process.getuid();
  const result = await command("/bin/ps", ["-axo", "pid=,ppid=,uid=,gid=,state=,lstart=,comm="]);
  const errors = result.ok ? [] : ["PROCESS_LIST_READ_FAILED"];
  const entries = result.ok ? parse(result.stdout, uid, config.excludeExecutableContains ?? ["dsh", "dsheval"]) : [];
  return observation("process", phase, { observedUid: uid, entries }, errors, startedAt, new Date().toISOString(), capabilities);
}
