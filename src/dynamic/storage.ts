/** 每次实验写入新目录；原始请求、证据、判据结果和搜索记录以独立 JSON 保存。 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { requireThat } from "./validation.js";

export interface Recorder { write(kind: string, id: string, value: unknown): Promise<void>; }
export class MemoryRecorder implements Recorder {
  readonly records: { kind: string; id: string; value: unknown }[] = [];
  async write(kind: string, id: string, value: unknown): Promise<void> { this.records.push({ kind, id, value: structuredClone(value) }); }
}
export class DirectoryRecorder implements Recorder {
  private constructor(readonly root: string) {}
  static async create(root: string): Promise<DirectoryRecorder> {
    const resolved = path.resolve(root);
    await mkdir(path.dirname(resolved), { recursive: true });
    await mkdir(resolved); // EEXIST is intentional: never mix two experiments or overwrite evidence.
    return new DirectoryRecorder(resolved);
  }
  async write(kind: string, id: string, value: unknown): Promise<void> {
    for (const part of [kind, id]) requireThat(/^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/.test(part), "BAD_PATH", "Artifact name must be a stable ID");
    await mkdir(path.join(this.root, kind), { recursive: true });
    await writeFile(path.join(this.root, kind, `${id}.json`), JSON.stringify(value, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
  }
}
export async function readJson(file: string): Promise<unknown> { return JSON.parse(await readFile(file, "utf8")) as unknown; }
