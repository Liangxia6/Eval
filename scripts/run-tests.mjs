// 跨平台枚举编译后的测试，避免 Windows shell 把带单引号的 glob 当成文件名而执行 0 个测试。
import { readdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";

const filter = process.argv[2];
if (filter !== undefined && filter !== "dynamic") throw new Error("Only the optional 'dynamic' filter is supported");
const root = path.resolve("dist/tests", filter ?? "");
const files = readdirSync(root, { recursive: true, withFileTypes: true })
  .filter(entry => entry.isFile() && entry.name.endsWith(".test.js"))
  .map(entry => path.join(entry.parentPath, entry.name)).sort();
if (!files.length) throw new Error(`No compiled tests found under ${root}`);
const result = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit", shell: false });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
