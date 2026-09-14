# Agent 记忆、Deep Research 与搜索数据集

公开数据集目录，整理时间：2026-09-03。

> 本文仅是候选 Benchmark 调研资料，不是 DSHEval 的运行时 Dataset Catalog，也不定义题目、标签或 Judge 格式。真正可执行的数据必须先转换到 `datasets/` 约定结构，并在 `datasets/catalog.md` 中声明描述、Label、题量和运行条件；只有 Loader、Environment Adapter、Observer 和 Judge 均满足时才能进入 Planner 的可选集合。

共 36 个数据集：记忆 11 个、Deep Research 13 个、搜索 12 个。

## 记忆

| 数据集 | 规模 | 官方数据 | 代码 | 论文 |
|---|---:|---|---|---|
| LoCoMo | 10 conversations / about 2,000 QA | [Data](https://github.com/snap-research/locomo/tree/main/data) | [Code](https://github.com/snap-research/locomo) | [Paper](https://arxiv.org/abs/2402.17753) |
| LongMemEval | 500 questions | [Data](https://github.com/xiaowu0162/LongMemEval#data) | [Code](https://github.com/xiaowu0162/LongMemEval) | [Paper](https://arxiv.org/abs/2410.10813) |
| LongMemEval-V2 | 451 questions / up to 500 trajectories per haystack | [Data](https://huggingface.co/datasets/xiaowu0162/longmemeval-v2) | [Code](https://github.com/xiaowu0162/LongMemEval-V2) | [Paper](https://arxiv.org/abs/2605.12493) |
| MemoryAgentBench | less than 1,000 rows / 76.6 MB | [Data](https://huggingface.co/datasets/ai-hyz/MemoryAgentBench) | [Code](https://github.com/HUST-AI-HYZ/MemoryAgentBench) | [Paper](https://arxiv.org/abs/2507.05257) |
| MemBench | 5 scenario groups | [Data](https://github.com/import-myself/Membench/tree/main/MemData) | [Code](https://github.com/import-myself/Membench) | [Paper](https://arxiv.org/abs/2506.21605) |
| PersonaMem | 32K / 128K / 1M-token variants | [Data](https://huggingface.co/datasets/bowen-upenn/PersonaMem) | [Code](https://github.com/bowen-upenn/PersonaMem) | [Paper](https://arxiv.org/abs/2504.14225) |
| PersonaMem-v2 | 1,000 implicit preferences / 18,549 training queries | [Data](https://huggingface.co/datasets/bowen-upenn/PersonaMem-v2) | [Code](https://github.com/bowen-upenn/PersonaMem) | [Paper](https://arxiv.org/abs/2512.06688) |
| BEAM | 100 conversations / 2,000 questions | [Data](https://huggingface.co/datasets/Mohammadta/BEAM) | [Code](https://github.com/mohammadtavakoli78/BEAM) | [Paper](https://openreview.net/forum?id=DT7JyQC3MR) |
| REALTALK | 21-day real-world conversations | [Data](https://github.com/danny911kr/REALTALK/tree/main/data) | [Code](https://github.com/danny911kr/REALTALK) | [Paper](https://arxiv.org/abs/2502.13270) |
| LifeBench | long-horizon multi-source simulations | [Data](https://github.com/1754955896/LifeBench/tree/main/data) | [Code](https://github.com/1754955896/LifeBench) | [Paper](https://arxiv.org/abs/2603.03781) |
| RHELM | 7 query types / 27 memory characteristics | [Data](https://microsoft.github.io/RHELM/) | [Code](https://github.com/microsoft/RHELM) | [Paper](https://arxiv.org/abs/2605.31086) |

## Deep Research

| 数据集 | 规模 | 官方数据 | 代码 | 论文 |
|---|---:|---|---|---|
| DeepResearch Bench | 100 tasks / 22 domains | [Data](https://github.com/Ayanami0730/deep_research_bench/tree/main/data) | [Code](https://github.com/Ayanami0730/deep_research_bench) | [Paper](https://arxiv.org/abs/2506.11763) |
| DeepResearch Bench II | 132 tasks / 9,430 rubrics | [Data](https://github.com/imlrz/DeepResearch-Bench-II/blob/main/tasks_and_rubrics.jsonl) | [Code](https://github.com/imlrz/DeepResearch-Bench-II) | [Paper](https://arxiv.org/abs/2601.08536) |
| LiveResearchBench | 100 tasks | [Data](https://huggingface.co/datasets/Salesforce/LiveResearchBench) | [Code](https://github.com/SalesforceAIResearch/LiveResearchBench) | [Paper](https://arxiv.org/abs/2510.14240) |
| DEEPWEB-BENCH | 100 tasks / 6,400 rubric cells | [Data](https://huggingface.co/datasets/xiesixiong/deepresearch-benchmark-2) | [Code](https://github.com/sixiongxie1001-dot/deep-research-benchmark2.0) | [Paper](https://openreview.net/forum?id=6d50adf163ae6cad2247f24e895f07f5ddd1a72c) |
| DeepResearch-9K | about 9,000 tasks | [Data](https://huggingface.co/datasets/artillerywu/DeepResearch-9K) | [Code](https://github.com/Applied-Machine-Learning-Lab/DeepResearch-R1) | [Paper](https://arxiv.org/abs/2603.01152) |
| DeepSearchQA | 900 prompts / 17 fields | [Data](https://huggingface.co/datasets/google/deepsearchqa) | [Code](https://huggingface.co/datasets/google/deepsearchqa) | [Paper](https://arxiv.org/abs/2601.20975) |
| BrowseComp | 1,266 questions | [Data](https://github.com/openai/simple-evals) | [Code](https://github.com/openai/simple-evals) | [Paper](https://arxiv.org/abs/2504.12516) |
| BrowseComp-ZH | 289 questions | [Data](https://github.com/PALIN2018/BrowseComp-ZH) | [Code](https://github.com/PALIN2018/BrowseComp-ZH) | [Paper](https://arxiv.org/abs/2504.19314) |
| xbench-DeepSearch | 100 questions in DeepSearch-2510 | [Data](https://huggingface.co/datasets/xbench/DeepSearch) | [Code](https://github.com/xbench-ai/xbench-evals) | [Paper](https://xbench.org/files/Eval%20Card%20xbench-DeepSearch.pdf) |
| SealQA | 3 subsets / Seal-0 has 111 questions | [Data](https://huggingface.co/datasets/vtllms/sealqa) | [Code](https://huggingface.co/datasets/vtllms/sealqa) | [Paper](https://arxiv.org/abs/2506.01062) |
| GAIA | more than 450 tasks | [Data](https://huggingface.co/datasets/gaia-benchmark/GAIA) | [Code](https://huggingface.co/gaia-benchmark) | [Paper](https://arxiv.org/abs/2311.12983) |
| Humanity's Last Exam | 2,500 questions | [Data](https://huggingface.co/datasets/cais/hle) | [Code](https://lastexam.ai/) | [Paper](https://arxiv.org/abs/2501.14249) |
| WebWalkerQA | 680 verified / 15,000 silver | [Data](https://huggingface.co/datasets/callanwu/WebWalkerQA) | [Code](https://github.com/Alibaba-NLP/WebAgent) | [Paper](https://arxiv.org/abs/2501.07572) |

## 搜索

| 数据集 | 规模 | 官方数据 | 代码 | 论文 |
|---|---:|---|---|---|
| SimpleQA | 4,326 questions | [Data](https://github.com/openai/simple-evals/blob/main/simpleqa_eval.py) | [Code](https://github.com/openai/simple-evals) | [Paper](https://arxiv.org/abs/2411.04368) |
| Search Arena 24K | 24,069 conversations / about 12,000 votes | [Data](https://huggingface.co/datasets/lmarena-ai/search-arena-24k) | [Code](https://github.com/lmarena/search-arena) | [Paper](https://arxiv.org/abs/2506.05334) |
| FRAMES | 824 questions | [Data](https://huggingface.co/datasets/google/frames-benchmark) | [Code](https://huggingface.co/datasets/google/frames-benchmark) | [Paper](https://arxiv.org/abs/2409.12941) |
| AssistantBench | 214 tasks / 258 websites | [Data](https://huggingface.co/datasets/AssistantBench/AssistantBench) | [Code](https://assistantbench.github.io/) | [Paper](https://arxiv.org/abs/2407.15711) |
| WebArena | 812 tasks | [Data](https://github.com/web-arena-x/webarena/tree/main/config_files) | [Code](https://github.com/web-arena-x/webarena) | [Paper](https://arxiv.org/abs/2307.13854) |
| VisualWebArena | 910 tasks | [Data](https://github.com/web-arena-x/visualwebarena/tree/main/config_files) | [Code](https://github.com/web-arena-x/visualwebarena) | [Paper](https://arxiv.org/abs/2401.13649) |
| WebBench | 5,750 total tasks / about 2,650 public rows | [Data](https://huggingface.co/datasets/Halluminate/WebBench) | [Code](https://github.com/Halluminate/WebBench) | [Paper](https://webbench.ai/) |
| HotpotQA | about 113,000 QA pairs | [Data](https://hotpotqa.github.io/) | [Code](https://github.com/hotpotqa/hotpot) | [Paper](https://arxiv.org/abs/1809.09600) |
| 2WikiMultiHopQA | about 192,000 questions | [Data](https://github.com/Alab-NII/2wikimultihop) | [Code](https://github.com/Alab-NII/2wikimultihop) | [Paper](https://arxiv.org/abs/2011.01060) |
| MuSiQue | 25,000 answerable / about 50,000 full | [Data](https://github.com/StonyBrookNLP/musique/tree/main/data) | [Code](https://github.com/StonyBrookNLP/musique) | [Paper](https://arxiv.org/abs/2108.00573) |
| KILT | 11 datasets / 5 task types | [Data](https://github.com/facebookresearch/KILT#kilt-tasks) | [Code](https://github.com/facebookresearch/KILT) | [Paper](https://arxiv.org/abs/2009.02252) |
| FreshQA | weekly-updated question set | [Data](https://github.com/freshllms/freshqa/tree/main/data) | [Code](https://github.com/freshllms/freshqa) | [Paper](https://arxiv.org/abs/2310.03214) |
