# DSHEval 工作台接口

更新：2026-09-12。所有实现新增在 VM 项目内的 `workbench/`，未修改原有评测源码、配置或根 package.json。

这是一层可供前端按钮调用的 HTTP 服务，实际操作由现有 DSHEval CLI 执行。没有另写评分逻辑，没有把 mock 响应作为正式接口结果。测试中的 CLI 替身只存在于 tests/。

## 启动

在 VMmac 中：

```sh
cd /Users/dsheval/Projects/dsheval/workbench
export PATH=/opt/homebrew/bin:$PATH
node server.mjs
```

不需要安装额外依赖，使用 Node.js 22+ 内置模块。默认监听 `127.0.0.1:18766`，不监听公网或整个公司网络。

前置条件：现有项目的 `dist/src/app/cli.js` 已构建。没有构建时启动任务返回 `CLI_NOT_BUILT`，接口服务不会自动修改 / 重建现有项目。

首次启动生成 `workbench/var/api-token`，权限 0600。前端请求使用 `Authorization: Bearer <token>`。也可通过服务端环境变量 `DSHEVAL_WORKBENCH_TOKEN` 提供至少 24 字符的 token。不要将 token 放进 URL、提交到仓库或嵌入公开网页。

本地浏览器访问 VM 服务时，可以使用：

```sh
ssh -N -L 18766:127.0.0.1:18766 dsheval-vm
```

然后前端访问 `http://127.0.0.1:18766`。SSH 使用现有动态 VM 代理配置，不写死 Tart IP。前端默认允许的开发 Origin 是 `http://127.0.0.1:5173` 和 `http://localhost:5173`。

## 接口列表

除 `/health` 外，所有接口需要 Bearer token。POST 使用 JSON。接口前缀 `/api/v1`。

| 方法 | 路径 | 按钮 / 页面用途 |
|---|---|---|
| GET | `/health` | 服务存活 |
| GET | `/capabilities` | 前端判断当前支持哪些操作 |
| GET | `/targets` | 被测目标、实际描述文件内容及警告 |
| GET | `/catalog` | 标签、题目目录及原始 Dataset catalog；不返回私有 grading 文件 |
| POST | `/jobs` | 静态观测、规划或执行测试 |
| GET | `/jobs?offset=0&limit=50` | 工作台任务历史 |
| GET | `/jobs/{id}` | 状态、CLI 最终摘要、退出码 |
| GET | `/jobs/{id}/result` | 观测插件 / 工具、执行计划记录及选题队列 |
| GET | `/jobs/{id}/events?after=0` | 增量日志、状态事件 |
| POST | `/jobs/{id}/cancel` | 请求取消，body 为 `{}` |
| GET | `/runs?offset=0&limit=50` | 已归档评测历史，同时读取 workbench 与 project 两个结果根 |
| GET | `/runs/{store}/{agent}/{run}` | Parent Run 原始摘要与 Case ID 列表 |
| GET | `/runs/{store}/{agent}/{run}/html` | Parent Run HTML |
| GET | `/runs/{store}/{agent}/{run}/cases/{case}` | 原始 report.json，包括当前 allTrace、评分及交付物引用 |
| GET | `/runs/{store}/{agent}/{run}/cases/{case}/html` | Case HTML |
| GET | `/runs/{store}/{agent}/{run}/cases/{case}/files/output/{path}` | 下载实际交付物 |
| GET | `/runs/{store}/{agent}/{run}/cases/{case}/files/attachments/{path}` | 下载归档证据附件 |

表内除 health 外省略了 `/api/v1` 前缀。列表 limit 最大 200。`store` 当前为 `workbench` 或 `project`。

当前正式 all trace 位于 Case report.json 的 `allTrace` 字段；同事修改格式后，适配结果读取和前端消费即可，接口层不重新生成另一份证据。

`GET /jobs/{id}/result` 对 inspect / plan 从可信配置的 records 根读取观测和执行计划。对于 run，返回 CLI 摘要及可获得的选题队列，完整证据 / 评分使用 runs 接口。缺失已清理的记录返回对应 null 和 warnings。

Dataset 目录的题目 ID 与 CLI 队列 ID 不一定相同。运行选定题目时，使用 plan 任务 `result.caseQueue[].caseId`，不要直接发送题目文件夹名称。

## 启动任务

静态观测：

```json
{"action":"inspect","targetId":"fixture"}
```

生成计划：

```json
{"action":"plan","targetId":"configured-headless"}
```

执行首题：

```json
{"action":"run","targetId":"configured-headless","maxCases":1}
```

执行 Planner 队列中的指定 Case：

```json
{
  "action":"run",
  "targetId":"configured-headless",
  "caseId":"agentbench-os.case-1"
}
```

最后一个 caseId 是格式示例，只有本次 Planner 真正选中它才能执行。

成功创建任务返回 HTTP 202。返回任务对象包括 `id`、`runId`、`state`、`warnings`、`summary` 和后续查询 links。API 自动生成运行 ID，避免重复覆盖结果。POST /jobs 每次都会启动一个新任务；前端提交期间应禁用按钮，网络结果不确定时先查询任务历史，不要自动重试创建。

允许的请求字段：

| 字段 | 约束 |
|---|---|
| action | inspect / plan / run |
| targetId | 服务端目标注册表中的 ID |
| caseId | 仅 run，CLI 的 Case 队列 ID |
| maxCases | 仅 run，1–10000 的整数 |
| stopAfterCase | 仅 run，布尔；true 表示最多首题 |
| fixtureBehavior | 仅 Fixture run：success / bad-output / insufficient-probe / reset-mismatch |

请求不接受 shell 命令、任意执行文件路径、API 密钥、任意环境变量或随意选择的配置文件路径。CLI 使用 spawn 参数数组调用，无 shell 拼接。

## 状态与进度

```text
STARTING → RUNNING → SUCCEEDED / FAILED
                 → CANCELLING → CANCELLED 或真实退出结果
服务重启时，未结束任务 → INTERRUPTED
```

- SUCCEEDED：CLI 退出码为 0，且返回 COMPLETED；这表示评测操作完成，不代表 Agent 每个维度表现优秀。
- FAILED：运行错误、CLI 返回失败或没有有效成功摘要。查看 summary.reasonCodes 和日志。
- CANCELLED：CLI 确认取消或以取消信号结束。发送取消请求时先返回 CANCELLING，不能立刻显示“清理完成”。
- INTERRUPTED：API 重启，上一进程结果未知。不会凭持久化 PID 杀进程，也不会自动重跑付费任务。
- 取消调用仅向当前服务持有的 CLI 子进程发送 SIGINT，由现有 CLI 做 Agent 取消和收尾。没有强杀接口；如果核心执行或清理挂住，工作台保持真实状态。
- 取消与自然完成竞态时，以 CLI 实际结果为准。

前端建议每 0.5–1 秒查询 job 与 events。`after` 使用上一次 `nextCursor`。每个任务最多保留最近 500 条事件，每条最多 8192 字符；发生滚动截断时 `gap=true`，前端提示“早期日志已截断”。

当前 CLI 主要提供批次开始 / 结束日志与最终摘要，接口不会伪造精确百分比或每个内部阶段的实时进度。单个超大 stdout 行超出 2 MiB 时标记 outputTruncated，不让内存无限增长；这可能导致无法取得最终摘要，按失败状态展示。

接口默认最多同时持有 4 个任务进程，超过返回 429。这是工作台资源上限，不是 VM 全局锁。单个 Parent Run 内的 Case 并发仍由原核心决定，目前为 1。

## 前端调用示例

可直接引入 `client.mjs`，TypeScript 声明在 `client.d.mts`。

```javascript
import { WorkbenchClient } from './client.mjs';

const api = new WorkbenchClient({
  baseUrl: 'http://127.0.0.1:18766',
  token: localToken,
});

const task = await api.start({ action: 'inspect', targetId: 'fixture' });
// 按页面轮询周期调用：
const status = await api.job(task.id);
const logs = await api.events(task.id, 0);

if (status.state === 'SUCCEEDED') {
  const result = await api.result(task.id);
  // result.inspection.pluginCatalog / toolSchemas / profile
}

// 停止按钮：await api.cancel(task.id)
```

客户端支持 targets、catalog、jobs、runs、Case report、日志、取消与文件下载。file() 使用 Authorization 获取 Blob URL；下载或展示完成后调用 URL.revokeObjectURL。显示 HTML 请使用 sandbox iframe，不要把原始报告或日志作为工作台可信脚本执行。

HTTP HTML 响应使用 sandbox CSP；旧 HTML 的脚本或相对文件链接未必能直接工作。新前端应优先读取 JSON 自行展示，产物链接使用明确的 files 接口。

## 目标配置与当前限制

默认注册两个目标：

- `configured-headless`：读取现有 `config/targets/real-dsh.json`。名称明确标识这是当前 Headless 副本，**不是 VM 中实际 Web DSH**。不会自动选它开始跑题。
- `fixture`：读取现有测试目标。Fixture 只是模拟 Agent，plan / run 仍可能调用已配置的真实 Planner / Judge。接口测试只对真实 CLI 执行 inspect，不调用模型。

前端应展示 targets[].warnings。实际 Web DSH 的观测 / 执行身份问题尚未修复，工作台接口不掩盖它。

目前 capabilities 如实声明：

- 不支持“执行上一份已经冻结的计划”：plan 和 run 是独立 CLI 操作，run 会重新规划。
- 不支持直接提交任意 Dataset / 标签列表；选题仍由 Planner 控制。
- caseId 是对本次 Planner 队列的筛选；之前计划选中的题，重新规划后可能不再选中。
- ReAct Judge 和 all trace 新格式由同事接手，本接口不抢先修改这些实现。
- 当前已有 history 是目录扫描，不额外建立另一套评分数据库。

后续连接实际 Web Target 时，主要修改新目录内注册配置及适配层；涉及真实会话与一次冻结语义的问题仍由核心提供能力。

可新建 `workbench/config.local.json` 覆盖 port、origins、targets；targets 使用绝对 descriptor / config 路径。这是本机配置文件，不接受浏览器任意改写。

## 文件结构与数据位置

```text
workbench/
├── server.mjs               # HTTP 路由、鉴权、目录与结果接口
├── lib/
│   ├── jobs.mjs             # CLI 子进程、日志、取消、任务持久化
│   ├── history.mjs          # 历史 Run、Case 结果读取
│   └── files.mjs            # 有界读取与路径约束
├── client.mjs               # 前端调用封装
├── client.d.mts             # TypeScript 请求 / 返回声明
├── openapi.json             # HTTP 接口契约，可导入 API 工具
├── README.md
├── package.json             # 独立启动与测试，不改根包
├── tests/
│   ├── cli-double.mjs       # 仅测试：控制成功、失败和取消
│   ├── api.test.mjs
│   └── real-cli.test.mjs    # HTTP → 现有真实 CLI → Fixture 观测记录
└── var/                     # token、任务、运行配置、结果及验证日志
```

API 默认写入新目录内 runtime-config.json，覆盖既有 CLI 支持的记录、结果、工作区、Home 等输出路径。**现有 batch.ts 仍硬编码使用项目 var/batch-runtime 临时目录**，真实批次执行可能写那里；这只是运行数据，不修改旧源码。这里没有为强行迁移该临时目录而改动核心代码。

已归档结果读取范围是注册结果根，拒绝越界路径与指向外部的符号链接，不提供任意磁盘文件读取。默认已配置项目原来的结果根，可在前端浏览旧报告。

## 验证

```sh
cd /Users/dsheval/Projects/dsheval/workbench
export PATH=/opt/homebrew/bin:$PATH
node --test tests/*.test.mjs
```

测试覆盖：鉴权、Origin、命令参数白名单、异步任务、跨数据块 JSON、错误返回、日志脱敏、取消、并发上限、历史 JSON / HTML / 文件、符号链接越界、重启恢复，以及真实 CLI 静态观测。

实际 Fixture inspect 返回了 profile `fixture-attention`、插件 `fixture.python-tool`、工具 `python`。这证明新接口能拿到真实 CLI 的结构化观测内容，不代表真实 Web DSH 验收通过。

测试日志与验证结果保存在 var/。核心完整测试未因本次独立新增接口而重新执行。已有文件摘要对照用于确认本次没有修改原有代码和配置。

本次最终验证：8 项测试全部通过；TypeScript 客户端声明检查通过。117 个既有文件摘要对照中，116 个未改变；根 package.json 在期间出现独立的 plugin-ui 命令新增，不由本次任务写入，已保留。去除这两项新增后，其内容摘要与基线一致。本次所有代码写入均位于 workbench/。验证概要：var/verification.json。

本次没有留下常驻 API 服务，使用上述启动命令即可启动。
