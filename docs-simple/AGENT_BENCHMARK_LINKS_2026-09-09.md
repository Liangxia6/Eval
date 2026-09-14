# Agent 评测论文与配套数据链接

核验日期：2026-09-09。共 27 条基准记录，覆盖 LLM 软件 agent 的通用、工具、网页/桌面/移动端、软件工程、数据分析、搜索研究、记忆和安全能力。

论文、数据与代码入口来自官方论文页面、作者仓库和官方数据卡。部分条目是任务代码或数据下载说明；数据公开不代表运行环境已就绪。原链接核验不代表数据已下载。后续已从其中三项下载固定版本并导入 42 道题：AgentBench DBBench 16、LongMemEval 14、SpreadsheetBench Verified 12；详见 [本批导入说明](AGENT_BENCHMARK_IMPORT_2026-09-09.md)。尚未部署完整官方环境或进行模型评测。

表中年份区分原始论文与后续数据版本。新实验需固定数据版本、评测器和运行配置；下面的选择建议属于基于任务形态的判断。

**链接总表**

| # | 基准 | 论文/版本年份 | 评测方向 | 论文 | 配套数据/任务 | 官方代码 |
|---|---|---|---|---|---|---|
| 1 | AgentBench | 2023（ICLR 2024） | 通用／多环境交互 | [论文](https://arxiv.org/abs/2308.03688) | [数据/任务](https://github.com/THUDM/AgentBench/tree/v0.2/data) | [代码](https://github.com/THUDM/AgentBench) |
| 2 | GAIA | 2023（ICLR 2024） | 通用助理／检索与多模态 | [论文](https://arxiv.org/abs/2311.12983) | [数据/任务](https://huggingface.co/datasets/gaia-benchmark/GAIA) | [代码](https://huggingface.co/spaces/gaia-benchmark/leaderboard/tree/main) |
| 3 | τ-bench | 2024（ICLR 2025） | 客服／工具—agent—用户交互 | [论文](https://arxiv.org/abs/2406.12045) | [数据/任务](https://github.com/sierra-research/tau-bench/tree/main/tau_bench/envs) | [代码](https://github.com/sierra-research/tau-bench) |
| 4 | τ²-bench | 2025 | 协作客服／双向环境控制 | [论文](https://arxiv.org/abs/2506.07982) | [数据/任务](https://github.com/sierra-research/tau2-bench/tree/main/data/tau2/domains) | [代码](https://github.com/sierra-research/tau2-bench) |
| 5 | AppWorld | 2024（ACL） | 跨应用／交互编码与状态评测 | [论文](https://aclanthology.org/2024.acl-long.850/) | [下载说明](https://github.com/StonyBrookNLP/appworld#-installation) | [代码](https://github.com/StonyBrookNLP/appworld) |
| 6 | BFCL V4 | 2025（ICML 论文；V4 于 2025-07 发布） | 工具调用诊断／多轮与记忆 | [论文](https://proceedings.mlr.press/v267/patil25a.html) | [数据/任务](https://github.com/ShishirPatil/gorilla/tree/main/berkeley-function-call-leaderboard/bfcl_eval/data) | [代码](https://github.com/ShishirPatil/gorilla/tree/main/berkeley-function-call-leaderboard) |
| 7 | WebArena | 2023 预印本；2024 ICLR 版本 | 网页操作 | [论文](https://arxiv.org/abs/2307.13854) | [数据/任务](https://github.com/web-arena-x/webarena/blob/main/config_files/test.raw.json) | [代码](https://github.com/web-arena-x/webarena) |
| 8 | VisualWebArena | 2024 | 视觉网页操作 | [论文](https://aclanthology.org/2024.acl-long.50/) | [数据/任务](https://github.com/web-arena-x/visualwebarena/tree/main/config_files/vwa) | [代码](https://github.com/web-arena-x/visualwebarena) |
| 9 | OSWorld / Verified | 2024 原始论文；2025 Verified 修订 | 桌面与跨应用操作 | [论文](https://arxiv.org/abs/2404.07972) | [数据/任务](https://github.com/xlang-ai/OSWorld/tree/main/evaluation_examples) | [代码](https://github.com/xlang-ai/OSWorld) |
| 10 | WorkArena / WorkArena++ | 2024；BrowserGym 生态论文预印本 2024、TMLR 2025 | 企业软件网页操作 | [论文](https://proceedings.mlr.press/v235/drouin24a.html) | [数据/任务](https://github.com/ServiceNow/WorkArena/tree/main/src/browsergym/workarena/tasks) | [代码](https://github.com/ServiceNow/WorkArena) |
| 11 | AndroidWorld | 2024 原始预印本；2025 v5 修订 | 移动端应用操作 | [论文](https://arxiv.org/abs/2405.14573) | [数据/任务](https://github.com/google-research/android_world/tree/main/android_world/task_evals) | [代码](https://github.com/google-research/android_world) |
| 12 | WebArena-Verified | 2025 论文；2026 工具/环境发布更新 | 网页操作与可靠评分（近期版本） | [论文](https://openreview.net/forum?id=94tlGxmqkN) | [数据/任务](https://huggingface.co/datasets/AmineHA/WebArena-Verified) | [代码](https://github.com/ServiceNow/webarena-verified) |
| 13 | SWE-bench Verified / Multilingual | 2023（ICLR 2024）；Verified 2024；Multilingual 2025 | 软件工程与仓库级修复 | [论文](https://arxiv.org/abs/2310.06770) | [数据/任务](https://huggingface.co/datasets/SWE-bench/SWE-bench_Verified) | [代码](https://github.com/SWE-bench/SWE-bench) |
| 14 | SWE-bench Pro | 2025 | 复杂与长流程软件工程 | [论文](https://arxiv.org/abs/2509.16941) | [数据/任务](https://huggingface.co/datasets/ScaleAI/SWE-bench_Pro) | [代码](https://github.com/scaleapi/SWE-bench_Pro-os) |
| 15 | Terminal-Bench 2.0 | 2026（论文） | 终端操作与通用技术任务 | [论文](https://arxiv.org/abs/2601.11868) | [数据/任务](https://github.com/harbor-framework/terminal-bench-2) | [代码](https://github.com/harbor-framework/harbor) |
| 16 | DSBench | 2024（ICLR 2025） | 数据分析与机器学习建模 | [论文](https://arxiv.org/abs/2409.07703) | [数据/任务](https://huggingface.co/datasets/liqiang888/DSBench/tree/main) | [代码](https://github.com/LiqiangJing/DSBench) |
| 17 | Spider 2.0 | 2024（ICLR 2025） | 企业 SQL 与数据工程工作流 | [论文](https://arxiv.org/abs/2411.07763) | [数据/任务](https://github.com/xlang-ai/Spider2/tree/main/spider2-dbt) | [代码](https://github.com/xlang-ai/Spider2) |
| 18 | SpreadsheetBench | 2024（NeurIPS 2024）；完整数据 2025；Verified 2025 | 表格操作与 Excel 产物 | [论文](https://arxiv.org/abs/2406.14991) | [数据/任务](https://github.com/RUCKBReasoning/SpreadsheetBench/tree/main/data) | [代码](https://github.com/RUCKBReasoning/SpreadsheetBench) |
| 19 | BrowseComp | 2025 | 搜索与研究 | [论文](https://arxiv.org/abs/2504.12516) | [数据/任务](https://openaipublic.blob.core.windows.net/simple-evals/browse_comp_test_set.csv) | [代码](https://github.com/openai/simple-evals/blob/main/browsecomp_eval.py) |
| 20 | BrowseComp-ZH | 2025 | 搜索与研究 | [论文](https://arxiv.org/abs/2504.19314) | [数据/任务](https://github.com/PALIN2018/BrowseComp-ZH/tree/main/data) | [代码](https://github.com/PALIN2018/BrowseComp-ZH) |
| 21 | DeepResearch Bench II | 2026 | 搜索与研究 | [论文](https://arxiv.org/abs/2601.08536) | [数据/任务](https://github.com/imlrz/DeepResearch-Bench-II/blob/main/tasks_and_rubrics.jsonl) | [代码](https://github.com/imlrz/DeepResearch-Bench-II) |
| 22 | LongMemEval | 2024（ICLR 2025） | 记忆 | [论文](https://arxiv.org/abs/2410.10813) | [数据/任务](https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned) | [代码](https://github.com/xiaowu0162/LongMemEval) |
| 23 | LongMemEval-V2 | 2026 | 记忆 | [论文](https://arxiv.org/abs/2605.12493) | [数据/任务](https://huggingface.co/datasets/xiaowu0162/longmemeval-v2) | [代码](https://github.com/xiaowu0162/LongMemEval-V2) |
| 24 | MemoryAgentBench | 2025（ICLR 2026） | 记忆 | [论文](https://arxiv.org/abs/2507.05257) | [数据/任务](https://huggingface.co/datasets/ai-hyz/MemoryAgentBench) | [代码](https://github.com/HUST-AI-HYZ/MemoryAgentBench) |
| 25 | MemoryArena | 2026 | 记忆 | [论文](https://arxiv.org/abs/2602.16313) | [数据/任务](https://huggingface.co/datasets/ZexueHe/memoryarena) | [代码](https://github.com/ZexueHe/MemoryArena) |
| 26 | AgentDojo | 2024 | 安全与鲁棒性 | [论文](https://arxiv.org/abs/2406.13352) | [数据/任务](https://github.com/ethz-spylab/agentdojo/tree/main/src/agentdojo/default_suites) | [代码](https://github.com/ethz-spylab/agentdojo) |
| 27 | AgentHarm | 2024（ICLR 2025） | 安全与鲁棒性 | [论文](https://arxiv.org/abs/2410.09024) | [数据/任务](https://huggingface.co/datasets/ai-safety-institute/AgentHarm) | [代码](https://github.com/UKGovernmentBEIS/inspect_evals/tree/main/src/inspect_evals/agentharm) |

**选择建议**

面向当前 DSHEval 的端到端评测，建议按能力组合选取：通用助理用 GAIA；工具与状态变更用 AppWorld 或 τ 系列；桌面任务用 OSWorld；网页用 WebArena-Verified 或 VisualWebArena；代码与终端用 SWE-bench Verified、Terminal-Bench 2.0；Excel 产物用 SpreadsheetBench；中文搜索用 BrowseComp-ZH；研究报告用 DeepResearch Bench II；长期经验记忆用 MemoryArena，并用 LongMemEval-V2 辅助诊断；提示注入防御用 AgentDojo。对应论文、数据和代码见总表。

BFCL 的单轮函数调用部分、LongMemEval 的记忆问答部分可用于组件诊断；端到端成功率还需要真实或模拟环境中的执行验证。BrowserGym 是统一运行框架，实际实验需注明采用了哪个具体基准。

**逐项说明与附加链接**

**1. AgentBench**

论文：[《AgentBench: Evaluating LLMs as Agents》](https://arxiv.org/abs/2308.03688)。

- 规模：原论文覆盖 8 个环境：OS、DB、KG、数字卡牌、海龟汤、ALFWorld、WebShop、Mind2Web。
- 适合评测：多轮规划、环境反馈、决策与工具执行；适合通用能力覆盖。
- 评分：各环境独立指标：OS/DB/ALFWorld 用成功率；KG 用 F1；卡牌和 WebShop 用 reward；海龟汤用游戏进度；Mind2Web 用步骤成功率。不能把所有子项都解释为端到端任务成功率。
- 数据与运行要求：需安装各环境依赖；当前 FC 版提供 Docker Compose。WebShop 启动约需 16GB RAM，KG 需另下载 Freebase 数据。
- 版本及适用范围：2025-10 主分支切换至 AgentBench FC/AgentRL，当前容器化任务为 5 类。复现原论文应使用 v0.2，并固定 commit、任务版本与指标。
- 补充入口：[paper_metrics](https://arxiv.org/html/2308.03688v2)；[original_code](https://github.com/THUDM/AgentBench/tree/v0.2)；[current_data](https://github.com/THUDM/AgentBench/tree/main/data)。

**2. GAIA**

论文：[《GAIA: a benchmark for General AI Assistants》](https://arxiv.org/abs/2311.12983)。

- 规模：原版 466 题、3 个难度等级；300 道测试题答案隐藏，其余 166 道验证题提供答案。
- 适合评测：复杂信息检索、网页浏览、文件和多模态理解、多步推理及综合工具使用。
- 评分：对最终答案做确定性归一化匹配：数值、列表和字符串分别处理，再汇总正确率。评估完整助理的任务结果，但不直接检查工具轨迹或环境状态变更。
- 数据与运行要求：Hugging Face gated dataset：登录并接受条件后获取；问题附件随数据提供；测试答案保留在官方评分端。执行 agent 需自行接入工具与搜索。
- 版本及适用范围：官方要求不得将数据转发到可抓取的公开位置；code_url 是官方榜单与评分代码，非完整 agent 执行框架。
- 补充入口：[data_files](https://huggingface.co/datasets/gaia-benchmark/GAIA/tree/main)；[scorer](https://huggingface.co/spaces/gaia-benchmark/leaderboard/blob/main/scorer.py)；[leaderboard](https://huggingface.co/spaces/gaia-benchmark/leaderboard)。

**3. τ-bench**

论文：[《τ-bench: A Benchmark for Tool-Agent-User Interaction in Real-World Domains》](https://arxiv.org/abs/2406.12045)。

- 规模：原论文 165 个任务：retail 115、airline 50。
- 适合评测：多轮用户交互、领域政策遵循、API 组合、客服任务完成与重复运行可靠性；是真正交互式端到端 agent 评测。
- 评分：比较会话结束数据库状态与目标状态，并检查必要的用户沟通信息；报告 pass^k，即多次尝试均成功的可靠性，而非至少一次成功的 pass@k。
- 数据与运行要求：需要执行环境和 LLM 用户模拟器；agent 与 user simulator 的模型、版本、温度及重复次数均需固定，存在双端推理成本。
- 版本及适用范围：官方老仓库已明确警告任务过时且不再更新，推荐新实验采用 tau2-bench 仓库当前 τ³-bench 修复任务；原仓库用于历史复现。
- 补充入口：[paper_details](https://arxiv.org/html/2406.12045v1)；[retail_tasks](https://github.com/sierra-research/tau-bench/tree/main/tau_bench/envs/retail)；[latest_fixed_tasks](https://github.com/sierra-research/tau2-bench/tree/main/data/tau2/domains)；[trajectories](https://github.com/sierra-research/tau-bench/tree/main/historical_trajectories)。

**4. τ²-bench**

论文：[《τ²-Bench: Evaluating Conversational Agents in a Dual-Control Environment》](https://arxiv.org/abs/2506.07982)。

- 规模：原论文：retail 115、airline 50、telecom 114；telecom 从 2,285 个组合任务中抽取 114 个用于评测。
- 适合评测：agent 和用户都能使用工具改变同一环境，重点测技术支持中的沟通、用户指导、协调与任务完成；是真正端到端交互评测。
- 评分：按任务配置检查最终数据库/世界状态、沟通信息或必要动作等；原论文 telecom 只用状态断言函数判断成功，使用 pass^k 可靠性指标。
- 数据与运行要求：需 LLM agent 与用户模拟器。当前主分支 τ³-bench 使用 uv，Python >=3.12,<3.14；评估完整任务使用 base split。
- 版本及适用范围：该仓库主分支现为 τ³-bench，新增知识/语音并修复 75+ 任务；原论文规模不等同当前主分支规模。2026-07 v1.0.1 调整 banking_knowledge 评分，该域升级前后不可直接比较。复现实验必须锁版本。
- 补充入口：[paper_details](https://arxiv.org/html/2506.07982v1)；[telecom_tasks](https://github.com/sierra-research/tau2-bench/tree/main/data/tau2/domains/telecom)；[changelog](https://github.com/sierra-research/tau2-bench/blob/main/CHANGELOG.md)。

**5. AppWorld**

论文：[《AppWorld: A Controllable World of Apps and People for Benchmarking Interactive Coding Agents》](https://aclanthology.org/2024.acl-long.850/)。

- 规模：原论文 750 个任务、9 个应用、457 个 API，模拟约 100 名用户。
- 适合评测：跨应用长流程、交互式代码生成、工具调用、读写状态和避免意外副作用；是真正端到端执行评测。
- 评分：运行任务专属、基于最终状态的单元测试，允许不同解决路径，并检查无关状态是否被误改。
- 数据与运行要求：官方以 appworld download data 下载和解包数据；当前说明要求 Python 3.11+。数据和部分实现以加密 .bundle 发布，需 appworld install；源码克隆需要 Git LFS。
- 版本及适用范围：data_url 是官方数据下载入口（提供 CLI），并非可直接浏览的 JSON 数据集。train/dev 提供完整生成、解答、评估材料；test_normal/test_challenge 只发布评估程序等可运行材料，隐藏参考解答和生成程序。官方要求不要公开转贴 bundle 解包内容。
- 补充入口：[arxiv](https://arxiv.org/abs/2407.18901)；[download_implementation](https://github.com/StonyBrookNLP/appworld/blob/main/src/appworld/download.py)；[data_version](https://github.com/StonyBrookNLP/appworld/blob/main/src/appworld/common/constants.py)；[project](https://appworld.dev/)。

**6. BFCL V4**

论文：[《The Berkeley Function Calling Leaderboard (BFCL): From Tool Use to Agentic Evaluation of Large Language Models》](https://proceedings.mlr.press/v267/patil25a.html)。

- 规模：V4 Agentic 子集 665 个测试项：Web Search 200、Memory 465；此外包含单轮、多轮、拒绝不适用工具及格式敏感性测试。665 不是 BFCL 总量。
- 适合评测：函数选择和参数、串行/并行调用、跨轮状态跟踪、搜索与持久记忆；单轮部分是模型工具调用能力诊断，不能单独代表完整 agent 能力。
- 评分：单轮主要使用 AST 匹配/相关性判断；多轮每轮同时检查环境状态与必要执行路径，全部轮次通过才成功；Memory 对保存和检索后的答案与 ground truth 比较。
- 数据与运行要求：开放 JSONL 风格任务文件和评测框架，Apache-2.0；可用 bfcl-eval。V4 Web Search 默认依赖 SerpAPI key（或自行替换搜索实现），模型推理也需对应运行资源。
- 版本及适用范围：关联的是 ICML 2025 系列方法论文；V4 搜索/记忆扩展的具体配置以官方 V4 文档为准。建议分别报告单轮、多轮、Agentic 分数，不只报告混合总分；固定任务与代码 commit。
- 补充入口：[dataset_readme](https://github.com/ShishirPatil/gorilla/blob/main/berkeley-function-call-leaderboard/bfcl_eval/data/README.md)；[multiturn_metrics](https://gorilla.cs.berkeley.edu/blogs/13_bfcl_v3_multi_turn.html)；[v4_web](https://gorilla.cs.berkeley.edu/blogs/15_bfcl_v4_web_search.html)；[v4_memory](https://gorilla.cs.berkeley.edu/blogs/16_bfcl_v4_memory.html)；[leaderboard](https://gorilla.cs.berkeley.edu/leaderboard.html)。

**7. WebArena**

论文：[《WebArena: A Realistic Web Environment for Building Autonomous Agents》](https://arxiv.org/abs/2307.13854)。

- 规模：812 个任务实例，源于 241 个模板
- 适合评测：真实网站中的多步信息检索、跨页面导航、内容与配置修改，覆盖电商、论坛、代码协作与内容管理。
- 评分：端到端任务成功率；信息回答采用 exact_match、must_include 或 LLM fuzzy_match；导航及修改任务检查 URL、网页内容、数据库或 API 返回状态。
- 数据与运行要求：需自建官方网站环境（Docker/AMI）、安装浏览器依赖并配置站点 URL；官方演示站不能用于可复现实验；完整运行后需重置环境。
- 版本及适用范围：预印本首次提交于 2023-07-25，v4 修订于 2024-04-16；原始仓库 v0.2.0 数据修订发生在 2023 年。官方仓库推荐通过 AgentLab/BrowserGym 做新实验。原始 WebArena 与 WebArena-Verified 的评估器和任务修订不同，应分别报告。
- 补充入口：[paper_evaluation_details](https://arxiv.org/html/2307.13854v4)；[task_directory](https://github.com/web-arena-x/webarena/tree/main/config_files)；[human_and_agent_trajectories](https://github.com/web-arena-x/webarena/blob/main/resources/README.md)。

**8. VisualWebArena**

论文：[《VisualWebArena: Evaluating Multimodal Agents on Realistic Visual Web Tasks》](https://aclanthology.org/2024.acl-long.50/)。

- 规模：910 个任务；Classifieds、Shopping、Reddit 三类网站
- 适合评测：图文理解、视觉定位，以及依赖视觉信息的多步网页任务执行。
- 评分：沿用 WebArena 的执行结果评估框架，统计任务完成成功率。
- 数据与运行要求：需部署官方站点环境，配置 URL，生成任务 JSON 与自动登录 cookie；原始仓库要求 Python 3.10 或 3.11，明确提示不使用 3.12。
- 版本及适用范围：2024-01-25 发布任务与环境脚本，ACL 2024 论文。数据以三个 *.raw.json 文件提供，运行脚本生成各任务配置；数据目录是任务定义，不是单纯的静态问答测试集。
- 补充入口：[arxiv](https://arxiv.org/abs/2401.13649)；[paper_pdf](https://aclanthology.org/2024.acl-long.50.pdf)；[environment_setup](https://github.com/web-arena-x/visualwebarena/tree/main/environment_docker)。

**9. OSWorld / Verified**

论文：[《OSWorld: Benchmarking Multimodal Agents for Open-Ended Tasks in Real Computer Environments》](https://arxiv.org/abs/2404.07972)。

- 规模：369 个主评测任务；当前官方允许排除 8 个依赖 Google Drive 配置的任务，运行 361 个任务
- 适合评测：真实桌面应用、浏览器、文件操作和跨应用工作流中的 GUI 定位、操作知识及任务执行。
- 评分：每个任务带初始状态配置及定制执行结果评估脚本，以任务成功率衡量结果。
- 数据与运行要求：需虚拟机环境（VMware/VirtualBox，或 Docker/KVM/云环境）；macOS 无 KVM，官方建议 VMware；部分 Google Drive 任务可能需要手动配置或排除，需注明 369/361 口径。
- 版本及适用范围：原始论文与基准发布于 2024-04-11；OSWorld-Verified 在 2025-07-28 修复任务并更新评测结果。应固定数据版本，不能把旧版结果与 Verified 结果直接混报。官网在 2026-06-26 另行宣布 OSWorld 2.0；此行规模仅对应原始/Verified 主基准。
- 补充入口：[official_site_and_version_notice](https://os-world.github.io/)；[task_json_directory](https://github.com/xlang-ai/OSWorld/tree/main/evaluation_examples/examples)；[osworld_2_paper](https://arxiv.org/abs/2606.29537)；[osworld_2_code](https://github.com/xlang-ai/OSWorld-V2)。

**10. WorkArena / WorkArena++**

论文：[《WorkArena: How Capable are Web Agents at Solving Common Knowledge Work Tasks?》](https://proceedings.mlr.press/v235/drouin24a.html)。

- 规模：WorkArena-L1：33 类原子任务、19,912 个实例；当前仓库报告 WorkArena++ 有 682 个组合任务，可采样多种配置
- 适合评测：ServiceNow 企业工作中的知识库检索、填表、目录订购、列表筛选和图表读取；WorkArena++ 增加组合规划、推理与记忆。
- 评分：由各任务 validate 函数检查网页/任务状态及回答，返回 reward；以成功任务比例衡量。
- 数据与运行要求：任务代码公开，但当前官方托管 ServiceNow 实例需在 Hugging Face 的 WorkArena-Instances 仓库提交申请、接受条款并等待批准；需浏览器与 Playwright 环境。
- 版本及适用范围：BrowserGym 是统一浏览器评测框架，不是一个拥有独立固定测试集的 benchmark；应明确实际评测的是 WorkArena-L1、L2/L3（WorkArena++）或其他接入基准。
- 补充入口：[instances_access](https://huggingface.co/datasets/ServiceNow/WorkArena-Instances)；[workarena_plus_paper](https://arxiv.org/abs/2407.05291)；[browsergym_paper](https://arxiv.org/abs/2412.05467)；[browsergym_code](https://github.com/ServiceNow/BrowserGym)。

**11. AndroidWorld**

论文：[《AndroidWorld: A Dynamic Benchmarking Environment for Autonomous Agents》](https://arxiv.org/abs/2405.14573)。

- 规模：116 个手工任务模板，覆盖 20 个应用；通过随机参数生成大量任务变体
- 适合评测：Android GUI 操作、应用内任务执行以及参数变化下的泛化与稳健性。
- 评分：程序化初始化、成功检测和清理；读取设备系统状态、SQLite 数据或文件验证任务完成，统计成功率。
- 数据与运行要求：需 Android 模拟器；官方配置为 Pixel 6、Android Tiramisu/API 33，并通过命令行启用 gRPC 8554；Python >=3.11；Docker 支持在官方仓库仍标为实验性。
- 版本及适用范围：116 是任务模板数量，不是穷尽所有随机实例的静态数据集。预印本首次提交于 2024-05-23，v5 修订于 2025-04-06；比较实验应固定任务集合与随机参数/种子。
- 补充入口：[task_list](https://google-research.github.io/android_world/task_list.html)；[official_site](https://google-research.github.io/android_world/)；[evaluation_details](https://arxiv.org/html/2405.14573v1)。

**12. WebArena-Verified**

论文：[《WebArena Verified: Reliable Evaluation for Web Agents》](https://openreview.net/forum?id=94tlGxmqkN)。

- 规模：当前公开数据：full 812 个任务，hard 258 个任务；2025 论文摘要中的 Hard 为 137 个任务
- 适合评测：WebArena 同类多步网页能力，重点改进指令明确性、评估器可靠性和可复现性。
- 评分：结构化 JSON 回答及网络 HAR 轨迹，采用类型归一化与结构比较进行确定性评分；可离线重新评分已有轨迹；论文报告模板级宏平均、置信区间与错误分类。
- 数据与运行要求：执行新任务仍需可运行的网站环境；离线能力针对已有执行轨迹重新评分。接入时需输出要求的 JSON 回答及 HAR 网络记录，并固定数据/评估器版本。
- 版本及适用范围：论文收录于 NeurIPS 2025 SEA Workshop。OpenReview 页面本次访问触发浏览器验证，但官方作者仓库的引用和 NeurIPS 官方会议页均核实了论文标题与链接。务必区分论文 Hard 137 与当前仓库/HF Hard 258，不能把二者混写。
- 补充入口：[direct_task_json](https://github.com/ServiceNow/webarena-verified/blob/main/assets/dataset/webarena-verified.json)；[official_conference_page](https://nips.cc/virtual/2025/loc/san-diego/124576)；[official_docs](https://servicenow.github.io/webarena-verified/latest/)。

**13. SWE-bench Verified / Multilingual**

论文：[《SWE-bench: Can Language Models Resolve Real-World GitHub Issues?》](https://arxiv.org/abs/2310.06770)。

- 规模：原始 SWE-bench 2,294 题；Verified 500 题；Multilingual 300 题、42 仓库、9 种编程语言
- 适合评测：理解 GitHub issue 与完整代码仓库，多文件编辑、调试和修复；Multilingual 检查跨编程语言能力。
- 评分：容器中应用候选补丁，运行 FAIL_TO_PASS 与 PASS_TO_PASS 测试，以解决率衡量修复是否成功。
- 数据与运行要求：数据与评测代码公开；Docker。官方建议 x86_64、至少 120 GB 空闲磁盘、16 GB RAM、8 核 CPU，ARM 支持仍标为实验性。
- 版本及适用范围：Verified 是人工确认可解的子集；Multilingual 的官方页面要求引用 SWE-smith: Scaling Data for Software Engineering Agents，不应杜撰独立的 Multilingual 论文。基准及容器工具在更新，应记录数据与 harness 版本。
- 补充入口：[multilingual_data](https://huggingface.co/datasets/SWE-bench/SWE-bench_Multilingual)；[full_data](https://huggingface.co/datasets/SWE-bench/SWE-bench)；[verified_release](https://openai.com/index/introducing-swe-bench-verified/)；[multilingual_official](https://www.swebench.com/multilingual.html)；[multilingual_requested_citation](https://arxiv.org/abs/2504.21798)；[dataset_guide](https://www.swebench.com/SWE-bench/guides/datasets/)。

**14. SWE-bench Pro**

论文：[《SWE-Bench Pro: Can AI Agents Solve Long-Horizon Software Engineering Tasks?》](https://arxiv.org/abs/2509.16941)。

- 规模：论文总计 1,865 题、41 仓库；可公开下载的 test split 为 731 题、11 仓库
- 适合评测：企业代码库上的长流程修复、理解补充 requirements/interface、跨文件修改。
- 评分：运行 fail2pass 与 pass2pass 测试，论文报告 Pass@1 / resolve rate。
- 数据与运行要求：公开集可以本地评测；Docker；官方推荐 Modal，也提供标为 Beta 的 local Docker 路径。held-out 与 commercial 集问题和代码不公开。
- 版本及适用范围：不能把总量 1,865 误写成开放数据量。官方仓库目前保留 05/18 公告称发现 leaderboard 问题并正在处理；2/9 曾移除过时或误收录的测试，因此需锁定版本。
- 补充入口：[paper_evaluation_and_limits](https://arxiv.org/html/2509.16941v2)；[public_leaderboard](https://labs.scale.com/leaderboard/swe_bench_pro_public)。

**15. Terminal-Bench 2.0**

论文：[《Terminal-Bench: Benchmarking Agents on Hard, Realistic Tasks in Command Line Interfaces》](https://arxiv.org/abs/2601.11868)。

- 规模：89 个任务；每题有独立环境、人工 oracle 解法和验证测试
- 适合评测：终端中的复杂软件工程、系统配置、机器学习、科学计算、数据处理与产物生成。
- 评分：检查任务完成后容器状态是否通过完整测试，汇总任务成功率；论文每个支持的模型与 agent 组合运行至少 5 次。
- 数据与运行要求：任务和 Harbor harness 公开；本地需 Docker，亦支持云端 sandbox。先运行 oracle 校验环境可复现性。
- 版本及适用范围：2.0 对应 89 题，不应与持续更新的 terminal-bench 主仓库 latest 混为一谈。官方论文承认硬件差异、外部 API 和基础设施可靠性可能带来非确定性；必须记录资源、时间限制和版本。
- 补充入口：[task_repository](https://github.com/harbor-framework/terminal-bench-2)；[official_running_guide](https://www.harborframework.com/docs/tutorials/running-terminal-bench)；[paper_fulltext](https://arxiv.org/html/2601.11868v1)；[harbor_dataset_page](https://hub.harborframework.com/datasets/terminal-bench/terminal-bench-2/latest)。

**16. DSBench**

论文：[《DSBench: How Far Are Data Science Agents from Becoming Data Science Experts?》](https://arxiv.org/abs/2409.07703)。

- 规模：466 个数据分析题 + 74 个数据建模任务，共 540 题
- 适合评测：长上下文、多模态任务说明、大文件和多表分析，以及端到端训练模型并输出预测文件。
- 评分：分析任务用 LLM 比较答案语义，报告 task-level / competition-level accuracy；建模任务检查生成提交文件是否成功，再按对应比赛指标计算性能并报告 Relative Performance Gap（RPG）。
- 数据与运行要求：提供处理后的下载数据和 Python 评测；分析部分的官方评分脚本使用 LLM API。官方仓库明确限制为教育研究与非商业用途，商业使用需数据提供者书面许可。原始数据还需遵循 ModelOff / Kaggle 来源条件。
- 版本及适用范围：最新论文正式标题使用 from；旧 arXiv 元数据与仓库 BibTeX 曾使用 to。数据分析判分并非完全确定性的单元测试。压缩包链接来自作者 README，本轮核验了数据根目录但未下载大文件。
- 补充入口：[latest_paper_title_and_metrics](https://arxiv.org/html/2409.07703v3)；[analysis_data_archive](https://huggingface.co/datasets/liqiang888/DSBench/blob/main/data_analysis/data.zip)；[modeling_data_archive](https://huggingface.co/datasets/liqiang888/DSBench/blob/main/data_modeling/data.zip)；[analysis_data_and_run_instructions](https://github.com/LiqiangJing/DSBench/blob/main/data_analysis/readme.md)；[modeling_data_and_run_instructions](https://github.com/LiqiangJing/DSBench/blob/main/data_modeling/readme.md)。

**17. Spider 2.0**

论文：[《Spider 2.0: Evaluating Language Models on Real-World Enterprise Text-to-SQL Workflows》](https://arxiv.org/abs/2411.07763)。

- 规模：论文原始设置 632 题；当前官网列 Snow 547、Lite 547、DBT 68。DBT 目录 README 写 69，与官网及主 README 的 68 不一致。
- 适合评测：检索大规模数据库元信息、读取 SQL 方言文档与项目代码、跨步骤查询和数据转换；DBT 版更贴近代码 agent 工作流。
- 评分：官方执行评测套件比较 SQL / CSV 执行结果；DBT 还按任务使用数值、字符串、表格和 DuckDB 内容匹配。
- 数据与运行要求：任务、元数据与评测代码公开；Lite 部分依赖 BigQuery/Snowflake 账户和云数据库费用；DBT 提供 DuckDB 数据下载与 Docker 设置。
- 版本及适用范围：2025-05-22 官方用 Spider2-DBT 替代原始 Spider2 设置。2026-08-12 官方主仓库公告 Snowflake 评测账号发生暂停，访问正在恢复；不能承诺当前完整 Snow 评测可直接运行。引用 oracle tables 设置时必须注明。
- 补充入口：[current_variants_and_counts](https://spider2-sql.github.io/)；[lite_tasks](https://github.com/xlang-ai/Spider2/tree/main/spider2-lite)；[snow_tasks](https://github.com/xlang-ai/Spider2/tree/main/spider2-snow)；[dbt_database_download_1](https://drive.google.com/uc?id=1N3f7BSWC4foj-V-1C9n8M2XmgV7FOcqL)；[dbt_database_download_2](https://drive.google.com/uc?id=1s0USV_iQLo4oe05QqAMnhGGp5jeejCzp)；[dbt_evaluation](https://github.com/xlang-ai/Spider2/tree/main/spider2-dbt/evaluation_suite)；[lite_evaluation](https://github.com/xlang-ai/Spider2/tree/main/spider2-lite/evaluation_suite)。

**18. SpreadsheetBench**

论文：[《SpreadsheetBench: Towards Challenging Real World Spreadsheet Manipulation》](https://arxiv.org/abs/2406.14991)。

- 规模：完整集 912 条真实用户指令、2,729 个测试案例；专家标注 Verified 子集 400 题
- 适合评测：基于真实 Excel 论坛请求操作复杂工作簿，涉及多工作表、非规则表、查找提取、聚合、改写与格式操作，提交结果 xlsx。
- 评分：类似 Online Judge：同一指令在多个输入工作簿测试，比较生成表格的目标结果；需重算公式以读取缓存数值。
- 数据与运行要求：完整指令和表格已公开；项目声明 CC BY-SA 4.0。评测可在 Linux/macOS/Windows 运行，需 LibreOffice 7.5+，或 Windows Microsoft Excel + pywin32 完成公式重算；官方推理流程使用 Docker 执行代码。
- 版本及适用范围：旧材料只提供 200 条 sample；2025-04 已开放完整 912 条。2025-12 发布 Verified 400。完整压缩包链接由官方 README 明确给出，本轮未下载压缩包。
- 补充入口：[complete_archive](https://github.com/RUCKBReasoning/SpreadsheetBench/blob/main/data/all_data_912.tar.gz)；[verified_archive](https://huggingface.co/datasets/KAKA22/SpreadsheetBench/blob/main/spreadsheetbench_verified_400.tar.gz)；[evaluation_code](https://github.com/RUCKBReasoning/SpreadsheetBench/tree/main/evaluation)。

**19. BrowseComp**

论文：[《BrowseComp: A Simple Yet Challenging Benchmark for Browsing Agents》](https://arxiv.org/abs/2504.12516)。

- 规模：1,266 题
- 适合评测：持续网页检索、多跳事实查找与短答案生成
- 评分：对参考答案进行等价性判断，汇总准确率；官方实现使用模型判分。
- 数据与运行要求：需搜索/浏览工具；数据为加密 CSV，由官方脚本解密。
- 版本及适用范围：衡量困难事实查找，不能单独代表长报告质量；题库链接来自官方加载代码，本次未下载题库。
- 补充入口：[官方发布说明](https://openai.com/index/browsecomp/)。

**20. BrowseComp-ZH**

论文：[《BrowseComp-ZH: Benchmarking Web Browsing Ability of Large Language Models in Chinese》](https://arxiv.org/abs/2504.19314)。

- 规模：289 题
- 适合评测：中文互联网检索与多跳推理
- 评分：答案准确率及置信度校准。
- 数据与运行要求：需中文网页检索/浏览能力；数据为加密 XLSX，按官方说明运行解密与评测脚本。
- 版本及适用范围：原生中文构造；适合中文搜索 agent。

**21. DeepResearch Bench II**

论文：[《DeepResearch Bench II: Diagnosing Deep Research Agents via Rubrics from Expert Report》](https://arxiv.org/abs/2601.08536)。

- 规模：132 个任务，22 个领域，9,430 条细粒度评分项
- 适合评测：研究报告的信息召回、证据分析和表达质量
- 评分：根据专家文章派生的细粒度评分项进行 LLM-as-judge。
- 数据与运行要求：生成研究报告并配置 Judge；固定评测代码和模型版本。
- 版本及适用范围：任务和评分项在 JSONL；HF 数据页另含部分模型生成的报告，不应混同于核心题库。仓库 2026-08 更换默认 Judge，复现论文应区分版本。

**22. LongMemEval**

论文：[《LongMemEval: Benchmarking Chat Assistants on Long-Term Interactive Memory》](https://arxiv.org/abs/2410.10813)。

- 规模：500 题
- 适合评测：跨会话记忆、时间推理、知识更新与拒答
- 评分：官方 QA evaluator 使用 LLM Judge；检索指标可单独计算。
- 数据与运行要求：长对话历史或记忆检索系统；选择固定的 S/M/oracle 数据配置。
- 版本及适用范围：偏记忆问答组件评测；其高分不直接证明跨会话任务执行能力。
- 补充入口：[S 版 JSON 直链](https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/longmemeval_s_cleaned.json)。

**23. LongMemEval-V2**

论文：[《LongMemEval-V2: Evaluating Long-Term Agent Memory Toward Experienced Colleagues》](https://arxiv.org/abs/2605.12493)。

- 规模：451 题，1,870 条任务轨迹
- 适合评测：网页与企业环境中的状态记忆、工作流知识及环境经验
- 评分：对历史轨迹形成的记忆进行查询评测；按官方 Small/Medium 配置运行。
- 数据与运行要求：准备 questions/trajectories、haystack 映射及题目/轨迹截图；有多模态与存储开销。
- 版本及适用范围：不是旧 LongMemEval 的加长版本；HF 自动预览的 29 行是图片视图，不能当作题目总数。

**24. MemoryAgentBench**

论文：[《Evaluating Memory in LLM Agents via Incremental Multi-Turn Interactions》](https://arxiv.org/abs/2507.05257)。

- 规模：4 类核心能力，多种子任务
- 适合评测：准确检索、冲突解决、长程理解、测试时学习
- 评分：按子任务采用 exact match、substring match、Recall@5 或 LLM Judge。
- 数据与运行要求：将上下文分块增量注入，保留记忆后执行多次查询。
- 版本及适用范围：不能把文件行数当独立问题总数；应报告各子集及上下文规模。

**25. MemoryArena**

论文：[《MemoryArena: Benchmarking Agent Memory in Interdependent Multi-Session Agentic Tasks》](https://arxiv.org/abs/2602.16313)。

- 规模：5 个公开配置：购物、渐进搜索、群体旅行规划、数学、物理
- 适合评测：利用前序交互经验完成后续依赖任务
- 评分：环境返回 observation/reward；按照具体任务的验证方式衡量跨会话完成情况。
- 数据与运行要求：按购物、搜索、旅行或形式推理子环境配置；需保留跨会话记忆。
- 版本及适用范围：适合评估记忆是否改善实际行动；官方代码目前标注为 preview version。
- 补充入口：[项目说明](https://memoryarena.github.io/)。

**26. AgentDojo**

论文：[《AgentDojo: A Dynamic Environment to Evaluate Prompt Injection Attacks and Defenses for LLM Agents》](https://arxiv.org/abs/2406.13352)。

- 规模：论文版本：97 个正常任务、629 个安全测试场景
- 适合评测：工具返回内容中的提示注入防御与正常任务完成能力
- 评分：分别计算正常任务效用与攻击成功情况。
- 数据与运行要求：使用官方模拟工具环境和任务套件；锁定版本。
- 版本及适用范围：数据以 Python 任务定义及环境数据形式发布；是动态评测环境，当前规模可随版本变化。
- 补充入口：[环境数据](https://github.com/ethz-spylab/agentdojo/tree/main/src/agentdojo/data)。

**27. AgentHarm**

论文：[《AgentHarm: A Benchmark for Measuring Harmfulness of LLM Agents》](https://arxiv.org/abs/2410.09024)。

- 规模：论文：110 个基础任务；数据卡公开测试 44 个、验证 8 个基础行为，含增强版本
- 适合评测：有害请求拒绝、越狱后多步工具行为及正常任务对照
- 评分：任务专用评分，部分使用语义 Judge；同时查看有害和良性任务结果。
- 数据与运行要求：通过 Inspect Evals 的模拟工具和评测流程运行。
- 版本及适用范围：论文总量与公开可下载子集不同；数据卡将用途限定为提升 AI 安全，不能将单一分数解释为整体安全水平。

