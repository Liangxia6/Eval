# Dataset Catalog

本文件是 Planning 唯一读取的数据集描述入口；`availableCaseCount` 表示当前假定已取得、可供 Planner 选择的题量，不表示运行环境或 Judge 已完成适配。题目正文位于各 Dataset 子目录或已取得的上游数据集中。

```json dsheval-dataset-catalog
{
  "schema": "dsheval.dataset-planner-catalog/v1",
  "version": "1.0",
  "datasets": [
    {
      "datasetId": "dataset.harbor-arcagi2/v1",
      "name": "Harbor ARC-AGI-2 网格变换",
      "description": "从训练网格推断变换规则，对测试网格生成 JSON 二维数组结果。测抽象推理与结构化产物交付，不要求固定工具路线。",
      "labelIds": [
        "label.reasoning-planning/v1",
        "label.artifact-delivery/v1"
      ],
      "availableCaseCount": 5
    },
    {
      "datasetId": "dataset.harbor-gpqadiamond/v1",
      "name": "Harbor GPQA Diamond 化学",
      "description": "根据有机化学 Cope 重排题面做四选一判断，交付一个选项字母。测知识推理与答案准确性。",
      "labelIds": [
        "label.reasoning-planning/v1",
        "label.artifact-delivery/v1"
      ],
      "availableCaseCount": 1
    },
    {
      "datasetId": "dataset.harbor-hle/v1",
      "name": "Harbor Humanity's Last Exam",
      "description": "高难度开放问题（读图物理、数学、化学结构识别、语言学等），需读图或严谨推理后给出答案。测多模态理解与推理。",
      "labelIds": [
        "label.multimodal/v1",
        "label.reasoning-planning/v1",
        "label.artifact-delivery/v1"
      ],
      "availableCaseCount": 8
    },
    {
      "datasetId": "dataset.harbor-labbench/v1",
      "name": "Harbor LabBench",
      "description": "阅读生物学实验图回答选择题，需从图中提取信息并推理。测多模态理解与推理。",
      "labelIds": [
        "label.multimodal/v1",
        "label.reasoning-planning/v1",
        "label.artifact-delivery/v1"
      ],
      "availableCaseCount": 4
    },
    {
      "datasetId": "dataset.harbor-omnimath/v1",
      "name": "Harbor OmniMath",
      "description": "数学推理题，严谨推导后给出答案。测数学推理严谨性。",
      "labelIds": [
        "label.reasoning-planning/v1",
        "label.artifact-delivery/v1"
      ],
      "availableCaseCount": 2
    },
    {
      "datasetId": "dataset.harbor-algotune/v1",
      "name": "Harbor AlgoTune",
      "description": "来自 Harbor Index 固定 commit 5399ea1026fb。矩阵平方根、LTI 模拟、SEIRS ODE、向量外积和单纯形投影优化，测数值正确性、代码迭代与运行效率。\n\n当前题数：5。正式性能分需固定 CPU 并接通相对 oracle 计时。",
      "labelIds": [
        "label.artifact-delivery/v1",
        "label.efficiency-reliability/v1",
        "label.loop/v1",
        "label.reasoning-planning/v1",
        "label.tool-code/v1"
      ],
      "availableCaseCount": 5
    },
    {
      "datasetId": "dataset.harbor-bix/v1",
      "name": "Harbor BixBench",
      "description": "来自 Harbor Index 固定 commit 5399ea1026fb。miRNA 差异表达、CpG 密度、CHIP 变异过滤、免疫通路富集和有序回归，测统计推理与数据分析。\n\n当前题数：5。正式运行需按 capsule UUID Seed 私有数据。",
      "labelIds": [
        "label.artifact-delivery/v1",
        "label.reasoning-planning/v1",
        "label.tool-code/v1",
        "label.tool-data/v1"
      ],
      "availableCaseCount": 5
    },
    {
      "datasetId": "dataset.harbor-featurebench/v1",
      "name": "Harbor FeatureBench",
      "description": "来自 Harbor Index 固定 commit 5399ea1026fb。固定 xarray、PyTorch Lightning 和 MLflow 基线的功能实现，测仓库理解、补丁交付与回归控制。\n\n当前题数：4。正式运行需 Seed 固定 Lightning、MLflow 或 xarray 的已掩码仓库和依赖环境，并接通 F2P/P2P Judge。",
      "labelIds": [
        "label.artifact-delivery/v1",
        "label.loop/v1",
        "label.reasoning-planning/v1",
        "label.tool-code/v1"
      ],
      "availableCaseCount": 4
    },
    {
      "datasetId": "dataset.harbor-gaia2/v1",
      "name": "Harbor GAIA2",
      "description": "来自 Harbor Index 固定 commit 5399ea1026fb。模拟应用中的歧义澄清、回复驱动变更和定时任务，测外部工具编排、动态适应及时间约束。\n\n当前题数：5。完整 scenario/oracle 已私有保存，但正式运行需 ARE MCP sidecar；缺失时为 UNEVALUABLE。",
      "labelIds": [
        "label.artifact-delivery/v1",
        "label.collaboration/v1",
        "label.efficiency-reliability/v1",
        "label.loop/v1",
        "label.reasoning-planning/v1",
        "label.safety-boundary/v1",
        "label.tool-external/v1"
      ],
      "availableCaseCount": 5
    },
    {
      "datasetId": "dataset.harbor-replicationbench/v1",
      "name": "Harbor ReplicationBench",
      "description": "来自 Harbor Index 固定 commit 5399ea1026fb。复现实证天文学分析，定位 Gaia DR2 样本垂直速度峰值的两个银河中心半径。测科研数据分析、代码工具与数值复现。\n\n当前题数：1。正式运行需 Seed 固定 revision 的 Gaia DR2 FITS 文件。",
      "labelIds": [
        "label.artifact-delivery/v1",
        "label.loop/v1",
        "label.reasoning-planning/v1",
        "label.tool-code/v1",
        "label.tool-data/v1"
      ],
      "availableCaseCount": 1
    },
    {
      "datasetId": "dataset.harbor-skillsbench/v1",
      "name": "Harbor SkillsBench",
      "description": "来自 Harbor Index 固定 commit 5399ea1026fb。票据 OCR 转 Excel 和投资冲击 GDP 建模，测图像读取、数据检索、公式建模及工作簿交付。\n\n当前题数：2。保留 OCR 图片、GDP 模板及必要私有判分信息；GDP 需获取指定版本的外部数据并接通重算 Judge。labels 为两题并集，并非每题均测多模态。",
      "labelIds": [
        "label.artifact-delivery/v1",
        "label.loop/v1",
        "label.multimodal/v1",
        "label.reasoning-planning/v1",
        "label.retrieval-grounding/v1",
        "label.tool-data/v1",
        "label.tool-document/v1",
        "label.tool-web/v1"
      ],
      "availableCaseCount": 2
    },
    {
      "datasetId": "dataset.harbor-usaco/v1",
      "name": "Harbor USACO Sleeping Cows",
      "description": "来自 Harbor Index 固定 commit 5399ea1026fb。实现 USACO Sleeping Cows 的 Python 解法，并通过隐藏输入输出测试。测组合推理、动态规划、代码实现与回归可靠性。\n\n当前题数：1。正式运行需接通私有输入输出 Judge。",
      "labelIds": [
        "label.artifact-delivery/v1",
        "label.efficiency-reliability/v1",
        "label.loop/v1",
        "label.reasoning-planning/v1",
        "label.tool-code/v1"
      ],
      "availableCaseCount": 1
    },
    {
      "datasetId": "dataset.harbor-widesearch/v1",
      "name": "Harbor WideSearch",
      "description": "来自 Harbor Index 固定 commit 5399ea1026fb。全量检索并整理 2025 年 1–5 月竣工的一带一路中企海外项目，交付单一中文 Markdown 表格。测广域网页检索、证据整合与结构化交付。\n\n当前题数：1。网页内容会漂移，判分以私有固定参考与来源证据为准。",
      "labelIds": [
        "label.artifact-delivery/v1",
        "label.efficiency-reliability/v1",
        "label.loop/v1",
        "label.reasoning-planning/v1",
        "label.retrieval-grounding/v1",
        "label.tool-web/v1"
      ],
      "availableCaseCount": 1
    },
        {
      "datasetId": "dataset.agentbench/v1",
      "name": "AgentBench DBBench",
      "description": "来自 AgentBench v0.2 固定提交 ed013ff9887b，16 道已核验的 DBBench SELECT 题。读取完整表格，使用 Python 标准库 SQLite 工具实际执行查询，交付答案、SQL 和工具结果；覆盖查找、计数、比较、排序和聚合。每题保留 question.json、必要 assets 和 private/final.json；原始数据文件哈希及行号见 question.source。MySQL/Docker 改为只读 SQLite，使用 LLM 语义评分；非完整 AgentBench 环境或官方成绩，主运行器仍需接通 Question Bundle。",
      "labelIds": [
        "label.tool-data/v1",
        "label.reasoning-planning/v1",
        "label.artifact-delivery/v1"
      ],
      "availableCaseCount": 16
    },
    {
      "datasetId": "dataset.spreadsheetbench/v1",
      "name": "SpreadsheetBench Verified",
      "description": "来自 SpreadsheetBench Verified 400 固定提交 49b73a94775fb，12 题包含工作表与单元格操作各 6 题。读取原始 XLSX，完成筛选、清理、汇总、跨表匹配或公式操作，交付 output/result.xlsx。每题仅保留 question.json、assets/workbook.xlsx、private/final.json 和 private/reference.xlsx；全部 276 个目标单元格值直接保存在 final.answer.regions，输入与参考工作簿字节不变，来源与哈希见 question.source。数据及改编遵循 CC BY-SA 4.0。评分需读取实际工作簿、必要时重算公式，并保留无关区域及格式；主运行器仍需接通 Question Bundle，不等同官方成绩。",
      "labelIds": [
        "label.tool-data/v1",
        "label.tool-document/v1",
        "label.reasoning-planning/v1",
        "label.artifact-delivery/v1"
      ],
      "availableCaseCount": 12
    }
  ]
}
```
