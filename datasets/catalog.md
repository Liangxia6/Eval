# Dataset Catalog

本文件是 Planning 唯一读取的数据集描述入口；`availableCaseCount` 表示当前假定已取得、可供 Planner 选择的题量，不表示运行环境或 Judge 已完成适配。题目正文位于各 Dataset 子目录或已取得的上游数据集中。

```json dsheval-dataset-catalog
{
  "schema": "dsheval.dataset-planner-catalog/v1",
  "version": "1.0",
  "datasets": [
    {
      "datasetId": "dataset.harbor-arcagi2/v2",
      "name": "Harbor ARC-AGI-2 网格变换",
      "description": "从训练网格推断变换规则，对测试网格生成 JSON 二维数组结果。测抽象推理与结构化产物交付，不要求固定工具路线。",
      "labelIds": [
        "label.reasoning-planning/v1",
        "label.artifact-delivery/v1"
      ],
      "availableCaseCount": 5
    },
    {
      "datasetId": "dataset.harbor-gpqadiamond/v2",
      "name": "Harbor GPQA Diamond 化学",
      "description": "根据有机化学 Cope 重排题面做四选一判断，交付一个选项字母。测知识推理与答案准确性。",
      "labelIds": [
        "label.reasoning-planning/v1",
        "label.artifact-delivery/v1"
      ],
      "availableCaseCount": 1
    },
    {
      "datasetId": "dataset.harbor-hle/v2",
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
      "datasetId": "dataset.harbor-labbench/v2",
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
      "datasetId": "dataset.harbor-omnimath/v2",
      "name": "Harbor OmniMath",
      "description": "数学推理题，严谨推导后给出答案。测数学推理严谨性。",
      "labelIds": [
        "label.reasoning-planning/v1",
        "label.artifact-delivery/v1"
      ],
      "availableCaseCount": 2
    },
    {
      "datasetId": "dataset.harbor-algotune/v2",
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
      "datasetId": "dataset.harbor-bix/v2",
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
      "datasetId": "dataset.harbor-featurebench/v2",
      "name": "Harbor FeatureBench",
      "description": "来自 Harbor Index 固定 commit 5399ea1026fb。固定 xarray、PyTorch Lightning 和 MLflow 基线的功能实现，测仓库理解、补丁交付与回归控制。\n\n当前题数：4。正式运行需 Seed 固定 Lightning、MLflow 或 xarray 的已掩码仓库和依赖环境，并接通 F2P/P2P Judge。",
      "labelIds": [
        "label.artifact-delivery/v1",
        "label.loop/v1",
        "label.reasoning-planning/v1",
        "label.tool-code/v1",
        "label.tool-data/v1"
      ],
      "availableCaseCount": 4
    },
    {
      "datasetId": "dataset.harbor-gaia2/v2",
      "name": "Harbor GAIA2",
      "description": "来自 Harbor Index 固定 commit 5399ea1026fb。模拟应用中的歧义澄清、回复驱动变更和定时任务，测外部工具编排、动态适应及时间约束。\n\n当前题数：5。完整 scenario/oracle 已私有保存，但正式运行需 ARE MCP sidecar；缺失时为 UNEVALUABLE。",
      "labelIds": [
        "label.artifact-delivery/v1",
        "label.collaboration/v1",
        "label.efficiency-reliability/v1",
        "label.loop/v1",
        "label.reasoning-planning/v1",
        "label.safety-boundary/v1",
        "label.tool-data/v1",
        "label.tool-external/v1"
      ],
      "availableCaseCount": 5
    },
    {
      "datasetId": "dataset.harbor-replicationbench/v2",
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
      "datasetId": "dataset.harbor-skillsbench/v2",
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
      "datasetId": "dataset.harbor-usaco/v2",
      "name": "Harbor USACO Sleeping Cows",
      "description": "来自 Harbor Index 固定 commit 5399ea1026fb。实现 USACO Sleeping Cows 的 Python 解法，并通过隐藏输入输出测试。测组合推理、动态规划、代码实现与回归可靠性。\n\n当前题数：1。正式运行需接通私有输入输出 Judge。",
      "labelIds": [
        "label.artifact-delivery/v1",
        "label.efficiency-reliability/v1",
        "label.loop/v1",
        "label.reasoning-planning/v1",
        "label.tool-code/v1",
        "label.tool-data/v1"
      ],
      "availableCaseCount": 1
    },
    {
      "datasetId": "dataset.harbor-widesearch/v2",
      "name": "Harbor WideSearch",
      "description": "来自 Harbor Index 固定 commit 5399ea1026fb。全量检索并整理 2025 年 1–5 月竣工的一带一路中企海外项目，交付单一中文 Markdown 表格。测广域网页检索、证据整合与结构化交付。\n\n当前题数：1。网页内容会漂移，判分以私有固定参考与来源证据为准。",
      "labelIds": [
        "label.artifact-delivery/v1",
        "label.efficiency-reliability/v1",
        "label.loop/v1",
        "label.reasoning-planning/v1",
        "label.retrieval-grounding/v1",
        "label.tool-data/v1",
        "label.tool-web/v1"
      ],
      "availableCaseCount": 1
    },
    {
      "datasetId": "dataset.harbor-build-word2vec/v2",
      "name": "Harbor Build Word2Vec",
      "description": "来自 Harbor Index 固定 commit 5399ea1026fb。实现 Word2Vec 预处理流水线，将原始文本语料处理为可训练的词向量数据。测代码实现、数据处理与产物交付。\n\n当前题数：1。",
      "labelIds": [
        "label.artifact-delivery/v1",
        "label.reasoning-planning/v1",
        "label.tool-code/v1",
        "label.tool-data/v1"
      ],
      "availableCaseCount": 1
    },
    {
      "datasetId": "dataset.harbor-codepde/v2",
      "name": "Harbor CodePDE",
      "description": "来自 Harbor Index 固定 commit 5399ea1026fb。实现一维可压缩 Navier-Stokes 方程的数值求解器，校验输出形状、初始帧与状态守恒。测数值建模、代码实现与产物交付。\n\n当前题数：1。",
      "labelIds": [
        "label.artifact-delivery/v1",
        "label.reasoning-planning/v1",
        "label.tool-code/v1"
      ],
      "availableCaseCount": 1
    },
    {
      "datasetId": "dataset.harbor-cybergym/v2",
      "name": "Harbor CyberGym",
      "description": "来自 Harbor Index 固定 commit 5399ea1026fb。修复离线长度/偏移范围解析器中的缺陷，通过确定性检查。测代码修复、推理与安全边界。\n\n当前题数：2。",
      "labelIds": [
        "label.artifact-delivery/v1",
        "label.loop/v1",
        "label.reasoning-planning/v1",
        "label.safety-boundary/v1",
        "label.tool-code/v1",
        "label.tool-data/v1"
      ],
      "availableCaseCount": 2
    },
    {
      "datasetId": "dataset.harbor-dacode/v2",
      "name": "Harbor DACode",
      "description": "来自 Harbor Index 固定 commit 5399ea1026fb。对原文作文文本做小规模自动评分并交付预测结果。测数据处理、建模与产物交付。\n\n当前题数：1。",
      "labelIds": [
        "label.artifact-delivery/v1",
        "label.reasoning-planning/v1",
        "label.tool-code/v1",
        "label.tool-data/v1"
      ],
      "availableCaseCount": 1
    },
    {
      "datasetId": "dataset.harbor-gaia/v2",
      "name": "Harbor GAIA",
      "description": "来自 Harbor Index 固定 commit 5399ea1026fb。多步检索与推理任务（冻结目录样本标准差比较、棋盘获胜着法、墓园资料定位）。测检索依据、网页工具与结构化交付。\n\n当前题数：3。",
      "labelIds": [
        "label.artifact-delivery/v1",
        "label.reasoning-planning/v1",
        "label.retrieval-grounding/v1",
        "label.tool-data/v1",
        "label.tool-web/v1"
      ],
      "availableCaseCount": 3
    },
    {
      "datasetId": "dataset.harbor-gso/v2",
      "name": "Harbor GSO",
      "description": "来自 Harbor Index 固定 commit 5399ea1026fb。在保持语义等价的前提下加速 pandas/numpy/pillow/pydantic 等库函数。测代码优化、数值正确性与效率稳定性。\n\n当前题数：7。",
      "labelIds": [
        "label.artifact-delivery/v1",
        "label.efficiency-reliability/v1",
        "label.loop/v1",
        "label.reasoning-planning/v1",
        "label.tool-code/v1",
        "label.tool-data/v1"
      ],
      "availableCaseCount": 7
    },
    {
      "datasetId": "dataset.harbor-qcircuitbench/v2",
      "name": "Harbor QCircuitBench",
      "description": "来自 Harbor Index 固定 commit 5399ea1026fb。设计三元 Simon 电路的测量后处理逻辑。测量子电路推理、代码实现与产物交付。\n\n当前题数：1。",
      "labelIds": [
        "label.artifact-delivery/v1",
        "label.reasoning-planning/v1",
        "label.tool-code/v1",
        "label.tool-data/v1"
      ],
      "availableCaseCount": 1
    },
    {
      "datasetId": "dataset.harbor-scicode/v2",
      "name": "Harbor SciCode",
      "description": "来自 Harbor Index 固定 commit 5399ea1026fb。科学计算实现（PWM DNA 位点扫描、高斯束 ABCD 传播、四面体 DOS 积分）。测数值计算、代码实现与产物交付。\n\n当前题数：3。",
      "labelIds": [
        "label.artifact-delivery/v1",
        "label.reasoning-planning/v1",
        "label.tool-code/v1",
        "label.tool-data/v1"
      ],
      "availableCaseCount": 3
    },
    {
      "datasetId": "dataset.harbor-sldbench/v2",
      "name": "Harbor SLDBench",
      "description": "来自 Harbor Index 固定 commit 5399ea1026fb。拟合词表规模与数据量的缩放定律交互关系。测数据处理、建模与产物交付。\n\n当前题数：1。",
      "labelIds": [
        "label.artifact-delivery/v1",
        "label.reasoning-planning/v1",
        "label.tool-code/v1",
        "label.tool-data/v1"
      ],
      "availableCaseCount": 1
    },
    {
      "datasetId": "dataset.harbor-spider2/v2",
      "name": "Harbor Spider2",
      "description": "来自 Harbor Index 固定 commit 5399ea1026fb。DBT 数据工程任务（机场到达汇总与球面距离、Twilio 消息分层聚合）。测数据库处理、SQL/代码与产物交付。\n\n当前题数：2。",
      "labelIds": [
        "label.artifact-delivery/v1",
        "label.reasoning-planning/v1",
        "label.tool-code/v1",
        "label.tool-data/v1"
      ],
      "availableCaseCount": 2
    },
    {
      "datasetId": "dataset.harbor-swebenchpro/v2",
      "name": "Harbor SWE-bench Pro",
      "description": "来自 Harbor Index 固定 commit 5399ea1026fb。真实仓库缺陷修复（文件后缀选择、K8s 会话路由、mTLS CA 限制、进程信号消息）。测代码修复、回归迭代与产物交付。\n\n当前题数：4。",
      "labelIds": [
        "label.artifact-delivery/v1",
        "label.loop/v1",
        "label.reasoning-planning/v1",
        "label.tool-code/v1",
        "label.tool-data/v1"
      ],
      "availableCaseCount": 4
    },
    {
      "datasetId": "dataset.harbor-swebenchverified/v2",
      "name": "Harbor SWE-bench Verified",
      "description": "来自 Harbor Index 固定 commit 5399ea1026fb。真实仓库缺陷修复（matplotlib 标注、Django 多表继承与 UNION 查询、Sphinx literal）。测代码修复、回归迭代与产物交付。\n\n当前题数：5。",
      "labelIds": [
        "label.artifact-delivery/v1",
        "label.loop/v1",
        "label.reasoning-planning/v1",
        "label.tool-code/v1",
        "label.tool-data/v1"
      ],
      "availableCaseCount": 5
    },
    {
      "datasetId": "dataset.harbor-swesmith/v2",
      "name": "Harbor SWE-Smith",
      "description": "来自 Harbor Index 固定 commit 5399ea1026fb。修复 OAuth1 头参数编码与 URI 保留缺陷。测代码修复、回归迭代与产物交付。\n\n当前题数：1。",
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
      "datasetId": "dataset.harbor-swtbenchverified/v2",
      "name": "Harbor SWT-bench Verified",
      "description": "来自 Harbor Index 固定 commit 5399ea1026fb。编写能杀死零地址缺陷的测试用例。测测试设计、代码迭代与产物交付。\n\n当前题数：1。",
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
      "datasetId": "dataset.harbor-tb/v2",
      "name": "Harbor Terminal-Bench",
      "description": "来自 Harbor Index 固定 commit 5399ea1026fb。终端/系统任务（合成非编码序列引物设计、MIPS 指令编码、Yelp 文本分类训练）。测代码实现、数据处理与产物交付。\n\n当前题数：3。",
      "labelIds": [
        "label.artifact-delivery/v1",
        "label.reasoning-planning/v1",
        "label.tool-code/v1",
        "label.tool-data/v1"
      ],
      "availableCaseCount": 3
    },
    {
      "datasetId": "dataset.agentbench-db/v1",
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
    },
    {
      "datasetId": "dataset.swe-bench-pro/v1",
      "name": "SWE-bench Pro",
      "description": "数据集: SWE-bench Pro\n最突出的测试对象: 真实代码仓库修复、测试驱动迭代与补丁交付\n当前输入形态: 5 个公开 test split 题包，含原题、requirements/interface、私有参考补丁及测试资源\n输出与评分: 代码补丁与真实执行记录；使用原生 F2P/P2P 回归测试判定修复是否成功\n最适合的 Agent: 代码 Agent、仓库维护 Agent、终端开发 Agent\n数据可用状态: AVAILABLE；本地已保存 5 道题包，运行环境和原生评分器仍待适配\n\n1. 基本定位\n在真实仓库中理解需求、定位缺陷、修改代码并验证行为；选取 qutebrowser、Flipt、Navidrome、OpenLibrary、Element 各一题，不以解释修复思路代替代码变更。\n\n2. 评测层级设计\n第一层检查补丁能否应用及目标行为；第二层检查代码检索、编辑、测试和纠错轨迹；第三层由固定版本原生测试判定 resolved。任务结果与 DSHEval 逐标签分数分别记录。\n\n3. 输入和环境\n数据 revision 7ab5114912ba，评分代码 ca10a60a5fca。题包保留基准提交、初始化配置、Dockerfile、测试脚本与解析器；完整仓库及镜像仍须部署，并锁定镜像摘要。每题使用独立容器，初始化不得在宿主执行。\n\n4. 输出与评分\n交付 output/solution.patch 与 output/response.txt。可信评分端应用私有测试补丁，核验全部 fail_to_pass 和 pass_to_pass；不要求补丁与参考实现文字相同，不允许篡改测试。\n\n5. 适配能力\n适配 tool-code、reasoning-planning、loop 和 artifact-delivery；代码执行及测试反馈可直接支持过程标签判分。\n\n6. 不适配情况\n不适合只有文本输出、不能编辑仓库或运行测试的模型；不适合没有隔离环境的真实生产仓库操作。\n\n7. 匹配关键词\nSWE-bench Pro, repository repair, regression tests, coding agent, tool-code, loop, patch\n\n8. 当前局限\n仅为 5 题导入样本，题量有限，不构成完整榜单成绩；上游曾修订测试并提示榜单问题。所附 MIT 许可证仅对应评测框架，原仓库补丁及数据条款仍须核实。未运行 Agent 或官方评测；缺环境或评分器判 UNEVALUABLE。",
      "labelIds": [
        "label.artifact-delivery/v1",
        "label.loop/v1",
        "label.reasoning-planning/v1",
        "label.tool-code/v1"
      ],
      "availableCaseCount": 5
    },
    {
      "datasetId": "dataset.dsbench/v1",
      "name": "DSBench",
      "description": "数据集: DSBench\n最突出的测试对象: 真实数据预处理、建模实验、测试集推断与可重跑产物交付\n当前输入形态: 5 个 Data Modeling 完整官方 resplit，公开 train/test CSV，测试答案和评分器私有\n输出与评分: 预测 CSV、训练推断代码和验证摘要；按任务使用 accuracy、RMSLE、ROC AUC、quadratic weighted kappa 或 F1\n最适合的 Agent: 数据科学 Agent、机器学习建模 Agent、代码执行 Agent\n数据可用状态: AVAILABLE；本地已保存 5 道题包，运行环境和原生评分器仍待适配\n\n1. 基本定位\n选择 Titanic、Bike Sharing Demand、Playground S3E12、Playground S3E5、NLP Getting Started 的真实建模任务；要求读取文件、训练模型并生成预测，不纳入纯分析问答。\n\n2. 评测层级设计\n第一层核验提交文件与数据 ID；第二层观察数据检查、训练、内部验证和推断过程；第三层使用隐藏答案运行原生指标。连续指标与 DSHEval 标签分分别记录，不自行设定官方通过阈值。\n\n3. 输入和环境\n数据 revision 1196d6553ec2，代码 ba786096137a。全部训练、测试行及隐藏标签均已保存，未裁剪或重新切分；需隔离 Python 环境及 numpy、pandas、scikit-learn。原 Kaggle 示例提交与本地 resplit 不匹配，故不作为输入。\n\n4. 输出与评分\n交付 output/submission.csv、output/train.py 和 output/response.txt。先核验预测列、ID、行数、行序及有限值，再用 private/evaluate.py 评分；要求保持 test.csv 行序以规避上游部分排序调用未赋值的问题，不修改原生指标。\n\n5. 适配能力\n适配 tool-data、tool-code 和 artifact-delivery；重点检查真实训练执行、数据处理质量及可复跑性。\n\n6. 不适配情况\n不适合仅凭题面给出建模建议的文本模型；不得访问外部竞赛标签、参考解或提交真实竞赛。未获授权的商业数据使用不在许可范围内。\n\n7. 匹配关键词\nDSBench, data modeling, tabular prediction, NLP classification, machine learning, tool-data, tool-code\n\n8. 当前局限\n仅覆盖 5 个建模任务，不代表完整 DSBench；数据限教育研究和非商业用途，商业用途须授权并遵循原竞赛条款。原生连续指标不直接等于 Agent 整体能力。题包已校验但尚未执行建模或接通评分入口；缺依赖判 UNEVALUABLE。",
      "labelIds": [
        "label.artifact-delivery/v1",
        "label.tool-code/v1",
        "label.tool-data/v1"
      ],
      "availableCaseCount": 5
    },
    {
      "datasetId": "dataset.memoryarena/v1",
      "name": "MemoryArena",
      "description": "数据集: MemoryArena\n最突出的测试对象: 跨阶段记忆保持、前序信息利用与依赖约束下的多步工具行动\n当前输入形态: 5 条电子设备 bundled_shopping 完整任务链，每链 6 阶段；仅公开当前阶段，后续阶段及答案私有\n输出与评分: 模拟商城交互轨迹、阶段结果及完成摘要；原生 reward 与记忆/约束检查分别记录\n最适合的 Agent: 带持久记忆的 Agent、多会话执行 Agent、模拟网页操作 Agent\n数据可用状态: AVAILABLE；本地已保存 5 道题包，运行环境和原生评分器仍待适配\n\n1. 基本定位\n在模拟商城中逐阶段选择兼容配套商品，后续行动依赖前序商品信息；5 条完整链合计 30 阶段，但 catalog 仅计 5 题，不将阶段拆成互不依赖的问答。\n\n2. 评测层级设计\n第一层核验六阶段任务结果；第二层观察真实搜索、点击、反馈与纠错；第三层用跨阶段 MEMORY_PROBE 检查记忆保存及利用。不能从最终商品编号或原生 reward 倒推记忆能力。\n\n3. 输入和环境\n任务数据 revision da1a37c8b192，运行代码 6cd9de14b719，商品库 revision 46120a5c931d。完整商品库和搜索索引仍须部署，不缩小候选池。控制器按原生 split-step 协议逐阶段释放任务；跨题清空记忆，题内保留允许的记忆。\n\n4. 输出与评分\n保存各阶段真实模拟交互并交付 output/response.txt；使用原生商品/属性 reward，同时单独记录附加约束检查。固定 LLM 属性 Judge 配置；不得将无 Judge 模式与标准模式混报，缺 MEMORY_PROBE 时 memory 标签不可评。\n\n5. 适配能力\n适配 memory、loop、reasoning-planning 和 tool-web；要求后续行动实际使用前序信息，并有独立轨迹支持标签评分。\n\n6. 不适配情况\n不适合一次性公开全部阶段的纯问答，也不适合每阶段清空全部记忆的实验配置；不得连接真实购物账户或发生真实购买。\n\n7. 匹配关键词\nMemoryArena, bundled shopping, cross-session memory, dependent tasks, memory, loop, tool-web\n\n8. 当前局限\n仅覆盖电子设备子集；代码为 Preview，未发现所选版本的根项目或数据许可证声明，公开再分发须核实。原生历史可能提供正确商品反馈，必须报告此配置；HF 重建器未结构化恢复预算/价格限制，原生 reward 不完整验证题面全部约束。尚未运行原生环境，缺环境或评分器判 UNEVALUABLE。",
      "labelIds": [
        "label.loop/v1",
        "label.memory/v1",
        "label.reasoning-planning/v1",
        "label.tool-web/v1"
      ],
      "availableCaseCount": 5
    },
    {
      "datasetId": "dataset.deepresearch-bench-ii/v1",
      "name": "DeepResearch Bench II",
      "description": "数据集: DeepResearch Bench II\n最突出的测试对象: 多来源检索、事实核验、证据综合与带引文研究报告交付\n当前输入形态: 5 个完整研究报告任务，中文 2 题、英文 3 题；全部 443 条三维评分项私有保存\n输出与评分: Markdown 研究报告与检索轨迹；原生 Judge 逐项评信息召回、分析及表达，并检查禁用来源\n最适合的 Agent: 深度研究 Agent、文档检索 Agent、报告生成 Agent\n数据可用状态: AVAILABLE；本地已保存 5 道题包，运行环境和原生评分器仍待适配\n\n1. 基本定位\n从固定提交 087c1b8d4a0e 选取无人机控制、温室控制、Kubernetes 调度、云扩缩容、开放科研数据任务。要求实际检索允许来源并综合报告，不以闭卷知识问答替代研究执行。\n\n2. 评测层级设计\n第一层检查报告与引用完整性；第二层用真实轨迹观察检索、证据定位和交叉核验；第三层按专家报告派生的三维 rubric 逐条评分。报告质量分不等于浏览或工具过程分。\n\n3. 输入和环境\n完整保留原始 prompt、语言、时间范围及禁用参考文章规则，参考文章不作为公开附件。需网页搜索及页面/文档访问工具，每题使用空白研究工作区与独立历史；只允许检索未被禁止的来源。\n\n4. 输出与评分\n交付 output/report.md，保留全部 443 条评分项，不用笼统整体印象替代。沿用固定版本原生评分器，当前默认 Judge 为 gpt-5.5；运行前须固定模型和参数，记录满足、未提及及禁用来源扣分，不捏造官方通过阈值。\n\n5. 适配能力\n适配 retrieval-grounding、tool-web、tool-document 和 artifact-delivery；检索与工具标签须有真实过程证据，不能只凭文笔推断。\n\n6. 不适配情况\n不适合没有搜索/文档工具的闭卷模型，也不适合允许直接读取参考报告或私有 rubric 的配置。不能当作完全确定性、无需 Judge API 的自动测试。\n\n7. 匹配关键词\nDeepResearch Bench II, deep research, evidence synthesis, citation, report, retrieval-grounding, tool-document\n\n8. 当前局限\n仅为 5 题导入样本，不代表完整榜单；全部所选题标注 CC BY 4.0，已保留来源归属和许可。尚未运行研究 Agent 或调用 Judge；评分有模型与分块设置依赖，网络来源也可能变化。缺研究环境或原生评分器判 UNEVALUABLE。",
      "labelIds": [
        "label.artifact-delivery/v1",
        "label.retrieval-grounding/v1",
        "label.tool-document/v1",
        "label.tool-web/v1"
      ],
      "availableCaseCount": 5
    },
    {
      "datasetId": "dataset.agentbench-os/v1",
      "name": "AgentBench OS",
      "description": "数据集: AgentBench OS\n最突出的测试对象: Linux 终端操作、命令实现、文件权限修改与执行结果核验\n当前输入形态: 5 个逐题 Question Bundle，包含计算、文件计数、日期格式化命令实现和两道权限修改任务\n输出与评分: 终端执行轨迹、文件及权限状态；使用原始 shell 检查器判定任务成功\n最适合的 Agent: 终端 Agent、代码执行 Agent、系统操作 Agent\n数据可用状态: AVAILABLE；本地已保存 5 道题包，运行环境和原生评分器仍待适配\n\n1. 基本定位\n在隔离 Linux 环境中理解目标、执行命令并检查实际结果，重点观察工具使用与执行闭环，不以口头给出命令作为完成。\n\n2. 评测层级设计\n第一层检查目标结果；第二层检查命令调用、报错处理和结果复核；第三层由原始检查器验证文件、权限及程序行为。\n\n3. 输入和环境\n使用原题干、初始化配置和私有 shell 检查，OS 交互上限为 8 轮。需要隔离 Linux/Docker 环境，每题重置；初始化不得在 macOS 宿主执行。\n\n4. 输出与评分\n交付 output/response.txt 并保留工具结果，以原始检查器的执行结果为任务成功依据。标签评分观察终端操作、步骤规划、纠错及产物交付，文本评分不能替代执行检查。\n\n5. 适配能力\n适配代码与终端工具、推理与规划、执行闭环和产物交付；可直接观察命令效果及失败后的调整。\n\n6. 不适配情况\n不适合没有终端工具的纯文本模型，也不适合无法隔离或重置操作系统状态的评测配置。\n\n7. 匹配关键词\nAgentBench OS, Linux, shell, command execution, file permissions, tool-code, loop\n\n8. 当前局限\n仅覆盖 AgentBench v0.2 的 5 道 OS 任务，与既有 DBBench 16 题独立；不是完整 AgentBench 成绩。固定版本与来源见 question.source，缺少原生环境或检查器时应判 UNEVALUABLE。",
      "labelIds": [
        "label.artifact-delivery/v1",
        "label.loop/v1",
        "label.reasoning-planning/v1",
        "label.tool-code/v1"
      ],
      "availableCaseCount": 5
    },
    {
      "datasetId": "dataset.tau-bench/v1",
      "name": "τ-bench",
      "description": "数据集: τ-bench\n最突出的测试对象: 多轮需求澄清、业务政策遵循、API 操作和数据库状态核验\n当前输入形态: 5 个逐题 Question Bundle，包含 retail 3 题、airline 2 题\n输出与评分: 用户对话、工具调用和最终业务状态；使用原始参考动作及沟通条件评价\n最适合的 Agent: 客服 Agent、业务 API Agent、多轮任务助理\n数据可用状态: AVAILABLE；本地已保存 5 道题包，运行环境和原生评分器仍待适配\n\n1. 基本定位\nAgent 通过对话逐步获取需求，在业务政策约束下调用工具完成零售或航空任务，重点观察沟通与真实业务操作的结合。\n\n2. 评测层级设计\n第一层检查用户目标和必要沟通是否满足；第二层检查信息澄清、政策执行及工具反馈处理；第三层检查数据库最终状态。\n\n3. 输入和环境\n公开业务政策与工具接口，私有用户指令仅交给用户模拟器。需要同版本官方数据库、用户模拟器及可重置的业务环境，数据库按题内来源哈希初始化。\n\n4. 输出与评分\n保存完整对话、工具返回及 output/response.txt，使用私有参考动作和沟通条件接入原生状态 Judge。标签评分关注 API 使用、规划、闭环及政策边界，不能只匹配最终回复。\n\n5. 适配能力\n适配 API 与业务系统工具、推理与规划、执行闭环、安全与权限边界，以及与模拟用户的信息协作；可观察是否取得必要信息并在允许范围内修改状态。\n\n6. 不适配情况\n不适合单轮静态问答配置；不能将模拟用户的完整背景预先公开给 Agent，也不能在真实业务账号上执行测试操作。\n\n7. 匹配关键词\nτ-bench, retail, airline, user simulator, policy compliance, API, database state\n\n8. 当前局限\n本组是原版 τ-bench 的 5 题历史对照子集，不与 τ²/τ³ 修订任务混报成绩。固定版本见 question.source；缺少用户模拟器、数据库或原生评分器时应判 UNEVALUABLE。",
      "labelIds": [
        "label.collaboration/v1",
        "label.loop/v1",
        "label.reasoning-planning/v1",
        "label.safety-boundary/v1",
        "label.tool-external/v1"
      ],
      "availableCaseCount": 5
    },
    {
      "datasetId": "dataset.tau2-bench/v1",
      "name": "τ²-bench",
      "description": "数据集: τ²-bench\n最突出的测试对象: 多轮协作、用户与 Agent 双向工具操作、业务政策和环境状态推理\n当前输入形态: 5 个逐题 Question Bundle，取自 tau2-bench 仓库的 τ³ 修订任务，包含 retail 2 题、telecom 3 题\n输出与评分: 双端对话与工具轨迹、业务状态及设备状态；按原生动作和环境断言评价\n最适合的 Agent: 交互式客服 Agent、电信故障处理 Agent、业务 API Agent\n数据可用状态: AVAILABLE；本地已保存 5 道题包，运行环境和原生评分器仍待适配\n\n1. 基本定位\n在用户与 Agent 共同影响环境的任务中澄清问题、遵循政策并协调操作，重点观察多轮决策和状态变化后的策略调整。\n\n2. 评测层级设计\n第一层检查业务目标是否完成；第二层检查双方沟通、工具调用与信息依赖；第三层检查业务数据库及电信设备状态断言。\n\n3. 输入和环境\n公开政策和技术手册，用户背景及初始状态保存在私有资源中。需要同版本官方数据库、用户模拟器和双端工具环境，固定双方模型与随机种子，每题重置。\n\n4. 输出与评分\n保存双端交互记录及 output/response.txt，依据原始参考动作、设备初始化和环境断言接入原生 Judge。应验证真实状态改变，不能将参考动作名称匹配或自然语言总结当作成功。\n\n5. 适配能力\n适配 API 与业务系统工具、推理与规划、执行闭环、安全与权限边界，以及可观察的双方协作。\n\n6. 不适配情况\n不适合只提供 Agent 单侧工具反馈的配置；不应一次性公开用户背景，也不能省略电信任务的用户设备环境。\n\n7. 匹配关键词\nτ²-bench, τ³-bench, telecom, retail, dual-control, user simulator, environment assertions\n\n8. 当前局限\n名称沿用清单中的 τ²-bench，但所选固定提交实际是 τ³ 修订任务，不代表原 τ² 论文快照或全量成绩。版本见 question.source；缺少双端环境或原生评分器时应判 UNEVALUABLE。",
      "labelIds": [
        "label.collaboration/v1",
        "label.loop/v1",
        "label.reasoning-planning/v1",
        "label.safety-boundary/v1",
        "label.tool-external/v1"
      ],
      "availableCaseCount": 5
    },
    {
      "datasetId": "dataset.appworld/v1",
      "name": "AppWorld",
      "description": "数据集: AppWorld\n最突出的测试对象: 多应用 API 编排、数据处理、跨应用任务完成与副作用控制\n当前输入形态: 5 个逐题 Question Bundle，包含 test_normal 3 题、test_challenge 2 题\n输出与评分: 应用数据库最终状态及执行记录；使用逐题原始 evaluation.py 检查目标和无关副作用\n最适合的 Agent: 个人助理 Agent、代码驱动 API Agent、多应用工作流 Agent\n数据可用状态: AVAILABLE；本地已保存 5 道题包，运行环境和原生评分器仍待适配\n\n1. 基本定位\n通过应用 API 完成联系人同步、Spotify 播放列表整理、笔记迁移及购物车条件转移，重点观察跨应用数据依赖和实际执行能力。\n\n2. 评测层级设计\n第一层检查用户目标；第二层检查 API 选择、数据处理与调用顺序；第三层由原始测试验证目标状态，并检查不应改变的其他应用数据。\n\n3. 输入和环境\n使用官方 data-0.2.0 数据和对应代码版本，题包保留数据库差异及私有评测代码。需要同版本基库、apps 运行时和隔离执行环境，每次试验重新初始化。\n\n4. 输出与评分\n交付 output/response.txt 并保存代码和 API 执行结果，以私有 evaluation.py 及其完整参数检查数据库变化。标签评分观察 API 与代码工具、规划、闭环和副作用边界，不以回复声称完成为依据。\n\n5. 适配能力\n适配 API 与业务系统工具、代码与终端工具、推理与规划、执行闭环及安全与权限边界，检查目标外的数据是否保持不变。\n\n6. 不适配情况\n不适合没有应用运行时或无法执行 API 的系统；不能只提供最终答案，也不能省略无关数据库的副作用检查。\n\n7. 匹配关键词\nAppWorld, application APIs, cross-app workflow, database diffs, code execution, side effects\n\n8. 当前局限\n5 题仅覆盖有限应用流程，不代表全量成绩；缺少基库、运行时或原生评分器时应判 UNEVALUABLE。解包内容仅限本地或私有使用，公开再分发及衍生内容须遵守随目录保留的加密分发许可要求。",
      "labelIds": [
        "label.loop/v1",
        "label.reasoning-planning/v1",
        "label.safety-boundary/v1",
        "label.tool-code/v1",
        "label.tool-external/v1"
      ],
      "availableCaseCount": 5
    },
    {
      "datasetId": "dataset.bfcl-multiturn/v1",
      "name": "BFCL V4 Multi-Turn",
      "description": "数据集: BFCL V4 Multi-Turn\n最突出的测试对象: 有状态多轮函数调用、参数澄清、工具缺失处理和上下文保持\n当前输入形态: 5 个逐题 Question Bundle，包含 base 2 题及 miss_param、miss_func、long_context 各 1 题\n输出与评分: 各轮工具执行、状态和调用路径；使用原生多轮评测器评价\n最适合的 Agent: 函数调用 Agent、API 助理、多轮工具使用 Agent\n数据可用状态: AVAILABLE；本地已保存 5 道题包，运行环境和原生评分器仍待适配\n\n1. 基本定位\n在连续对话中选择工具、补齐参数、处理工具不可用情形，并延续前序操作产生的状态。仅选择有状态多轮任务，不包含单轮 AST 匹配题。\n\n2. 评测层级设计\n第一层检查每轮目标；第二层检查参数澄清、工具可用性判断和跨轮信息使用；第三层检查执行后的状态及原生评测器要求的调用路径。\n\n3. 输入和环境\n私有 scenario 保存完整轮次、初始配置及工具增删规则，由控制器逐轮释放。需要原生工具类、可重置状态和多轮驱动，不能提前公开后续对话。\n\n4. 输出与评分\n保存每轮工具返回和最终 output/response.txt，依据私有 ground truth 接入原生多轮状态与路径评测。不能仅匹配函数名称，也不能把多轮任务扁平化后做单次文本评分。\n\n5. 适配能力\n适配 API 与业务系统工具、推理与规划、执行闭环，以及与对话方的参数澄清和信息协作；不等同于子 Agent 委派或跨会话长期记忆测试。\n\n6. 不适配情况\n不适合只能输出静态函数调用而不能接收执行反馈的系统，也不适合缺少逐轮控制器的单轮评测配置。\n\n7. 匹配关键词\nBFCL V4, multi-turn, function calling, missing parameter, missing function, long context, stateful tools\n\n8. 当前局限\n5 题是四类多轮任务的接入子集，不代表 BFCL 全量或单轮能力。固定版本见 question.source；缺少工具运行时、多轮控制器或原生评分器时应判 UNEVALUABLE。",
      "labelIds": [
        "label.collaboration/v1",
        "label.loop/v1",
        "label.reasoning-planning/v1",
        "label.tool-external/v1"
      ],
      "availableCaseCount": 5
    },
    {
      "datasetId": "dataset.webarena/v1",
      "name": "WebArena",
      "description": "数据集: WebArena\n最突出的测试对象: 多步网页导航、信息比较、表单操作和网站状态变更\n当前输入形态: 5 个逐题 Question Bundle，包含评论、跨页比较后加购、新建仓库、修改 CMS 标题和创建 issue\n输出与评分: 浏览器轨迹与网站最终状态；使用私有 program_html 断言和原生 URL/DOM 评测器\n最适合的 Agent: 浏览器 Agent、网页工作流 Agent、网站操作助理\n数据可用状态: AVAILABLE；本地已保存 5 道题包，运行环境和原生评分器仍待适配\n\n1. 基本定位\nAgent 在受控网站中完成真实页面操作，任务结果体现为评论、购物车、仓库、内容或工单状态的改变，不是只从网页查找答案。\n\n2. 评测层级设计\n第一层检查任务目标；第二层检查导航、跨页比较、字段填写和提交后的确认；第三层检查网站中的目标对象及其属性。\n\n3. 输入和环境\n公开起始站点配置，完整 eval 仅供私有评测。需要官方自托管网站、隔离账号、浏览器和原生评测器，每题恢复网站状态与登录态。\n\n4. 输出与评分\n交付 output/response.txt 并保留浏览器轨迹，以 program_html 等原始状态断言判定成功。应核对评论、购物车商品和 issue 指派及到期日等真实结果，不能仅凭自然语言总结评分。\n\n5. 适配能力\n适配浏览器与网络工具、推理与规划、执行闭环和产物交付，可观察多步操作及提交后的结果核验。\n\n6. 不适配情况\n不适合只读网页检索系统或没有网站重置能力的配置；不能用真实业务网站替代隔离基准实例。\n\n7. 匹配关键词\nWebArena, browser automation, navigation, form filling, program_html, DOM, website state\n\n8. 当前局限\n仅选取原版 WebArena 的 5 道状态变更题，不是 WebArena-Verified，也不代表全量难度。固定版本见 question.source；缺少网站快照、浏览器或原生评分器时应判 UNEVALUABLE。",
      "labelIds": [
        "label.artifact-delivery/v1",
        "label.loop/v1",
        "label.reasoning-planning/v1",
        "label.tool-web/v1"
      ],
      "availableCaseCount": 5
    },
    {
      "datasetId": "dataset.visualwebarena/v1",
      "name": "VisualWebArena",
      "description": "数据集: VisualWebArena\n最突出的测试对象: 网页视觉理解、图文目标定位、多步浏览器操作和状态核验\n当前输入形态: 5 个逐题 Question Bundle，包含 Classifieds 3 题、Shopping 2 题，视觉素材来自站点页面\n输出与评分: 视觉与浏览器操作轨迹、评论或购物状态；使用原始 program_html 状态检查\n最适合的 Agent: 多模态浏览器 Agent、视觉网页操作 Agent\n数据可用状态: AVAILABLE；本地已保存 5 道题包，运行环境和原生评分器仍待适配\n\n1. 基本定位\n根据页面图片识别商品或对象，再执行评论、加入愿望单或购物车等操作，重点观察视觉识别能否支撑真实网页任务完成。\n\n2. 评测层级设计\n第一层检查图文目标是否识别正确；第二层检查视觉定位、页面导航及操作反馈；第三层检查评论、愿望单或购物车的最终状态。\n\n3. 输入和环境\n需要官方站点快照、完整页面图片、浏览器视觉输入、固定视口和登录态，每题重置。所选题没有独立题面图片，不能因此省略网页中的视觉素材。\n\n4. 输出与评分\n保存页面观察、浏览器轨迹和 output/response.txt，以私有 program_html 断言验证最终状态。多模态标签核对视觉事实与操作对象，文本描述或单次图像问答不能替代网站执行评分。\n\n5. 适配能力\n适配多模态理解、浏览器与网络工具、推理与规划、执行闭环及产物交付。\n\n6. 不适配情况\n不适合只接收纯文本网页的系统，也不适合无法加载图片、固定视口或重置网站的评测环境。\n\n7. 匹配关键词\nVisualWebArena, visual grounding, multimodal browser, classifieds, shopping, program_html\n\n8. 当前局限\n5 题只覆盖两个站点和有限操作类型，不代表完整视觉网页能力。固定版本见 question.source；缺少必要图片、站点环境或原生评分器时应判 UNEVALUABLE。",
      "labelIds": [
        "label.artifact-delivery/v1",
        "label.loop/v1",
        "label.multimodal/v1",
        "label.reasoning-planning/v1",
        "label.tool-web/v1"
      ],
      "availableCaseCount": 5
    },
    {
      "datasetId": "dataset.osworld/v1",
      "name": "OSWorld",
      "description": "数据集: OSWorld\n最突出的测试对象: 桌面视觉操作、应用设置修改、交互反馈处理和应用状态核验\n当前输入形态: 5 个逐题 Question Bundle，包含 Chrome、GIMP、LibreOffice Impress、VS Code、VLC 各 1 题\n输出与评分: 桌面操作轨迹和应用最终状态；使用题内原始 evaluator 检查\n最适合的 Agent: 桌面 GUI Agent、计算机操作 Agent、多模态应用助理\n数据可用状态: AVAILABLE；本地已保存 5 道题包，运行环境和原生评分器仍待适配\n\n1. 基本定位\n在隔离桌面环境中完成应用设置变更，通过界面观察、操作和复核达成目标，重点观察计算机使用能力及实际状态改变。\n\n2. 评测层级设计\n第一层检查任务目标；第二层检查界面观察、动作反馈和错误恢复；第三层由原始 evaluator 检查应用配置或文件状态。\n\n3. 输入和环境\n题包保留完整虚拟机初始化和私有 evaluator。需要固定 Linux VM 快照、应用版本与动作接口，每题重置；guest 路径及应用设置操作不得迁移到宿主机。\n\n4. 输出与评分\n保存桌面观察、动作结果及 output/response.txt，以原始 evaluator 的 result 与 expected 配置判定成功。标签评分观察多模态输入、应用工具操作、闭环和交付，不能只比较最终文字。\n\n5. 适配能力\n适配多模态理解、外部应用工具操作、执行闭环及产物交付，适用于具有桌面动作接口的 Agent。\n\n6. 不适配情况\n不适合没有截图输入或桌面操作接口的系统；只有静态屏幕定位答案不能构成本组任务完成。\n\n7. 匹配关键词\nOSWorld, desktop GUI, computer use, application settings, virtual machine, visual interaction\n\n8. 当前局限\n本组来自原始/Verified 主基准，是无需额外任务文件下载的 5 道设置变更题，不是 OSWorld-V2，也不代表复杂文档任务难度。固定版本见 question.source；缺少 VM、应用或原生评分器时应判 UNEVALUABLE。",
      "labelIds": [
        "label.artifact-delivery/v1",
        "label.loop/v1",
        "label.multimodal/v1",
        "label.tool-external/v1"
      ],
      "availableCaseCount": 5
    },
    {
      "datasetId": "dataset.workarena/v1",
      "name": "WorkArena",
      "description": "数据集: WorkArena\n最突出的测试对象: 企业网页列表操作、服务目录配置、订单提交和业务状态核验\n当前输入形态: 5 个逐题 Question Bundle，包含 WorkArena-L1 的 3 道多字段排序和 2 道指定配置订购任务\n输出与评分: 浏览器操作轨迹和 ServiceNow 测试实例状态；使用官方任务类的 validate 方法评价\n最适合的 Agent: 企业浏览器 Agent、ServiceNow 助理、业务流程自动化 Agent\n数据可用状态: AVAILABLE；本地已保存 5 道题包，运行环境和原生评分器仍待适配\n\n1. 基本定位\n在隔离 ServiceNow 实例中完成 incidents、hardware、users 列表排序，或按指定配置订购开发笔记本和 iPad mini，重点观察企业页面操作与结果核验。\n\n2. 评测层级设计\n第一层检查排序或订购目标；第二层检查字段选择、配置填写及提交后的确认；第三层检查列表状态或实际创建的请求。\n\n3. 输入和环境\n使用官方 fixed_config、任务类和 setup/teardown，固定 seed=42。需要已获授权的 WorkArena ServiceNow 测试实例与浏览器，每题初始化并清理。\n\n4. 输出与评分\n保存浏览器轨迹和 output/response.txt，以对应任务类 validate 返回的 reward=1 作为任务成功条件。核对多字段排序和完整订单配置，不能把进入正确页面或口头描述步骤当作完成。\n\n5. 适配能力\n适配浏览器与网络工具、推理与规划、执行闭环及产物交付，可观察企业页面操作和业务结果确认。\n\n6. 不适配情况\n不适合没有授权测试实例或浏览器操作能力的系统；不得在真实企业实例执行评测订购和记录修改。\n\n7. 匹配关键词\nWorkArena, ServiceNow, enterprise workflow, list sorting, service catalog, fixed_config, validate\n\n8. 当前局限\n本组仅覆盖 WorkArena-L1 的 5 道任务，不代表 WorkArena++ 的长流程难度。固定版本见 question.source；缺少授权实例、官方任务环境或原生评分器时应判 UNEVALUABLE。",
      "labelIds": [
        "label.artifact-delivery/v1",
        "label.loop/v1",
        "label.reasoning-planning/v1",
        "label.tool-web/v1"
      ],
      "availableCaseCount": 5
    },
    {
      "datasetId": "dataset.memory-accurate-recall/v1",
      "name": "Memory Accurate Recall",
      "description": "轻量记忆检索专题：从短上下文中定位单一事实并给出证据。适配 MemoryAgentBench Accurate Retrieval，Python 标准库即可运行。",
      "labelIds": [
        "label.memory/v1",
        "label.reasoning-planning/v1"
      ],
      "availableCaseCount": 3
    },
    {
      "datasetId": "dataset.memory-conflict-update/v1",
      "name": "Memory Conflict Update",
      "description": "轻量记忆更新专题：区分旧记录与后续事实，按时间顺序回答当前有效值。适配 MemoryAgentBench Conflict Resolution 与 LongMemEval knowledge-update。",
      "labelIds": [
        "label.memory/v1",
        "label.reasoning-planning/v1"
      ],
      "availableCaseCount": 3
    },
    {
      "datasetId": "dataset.memory-temporal-reasoning/v1",
      "name": "Memory Temporal Reasoning",
      "description": "轻量时间记忆专题：根据事件日期和有效区间判断指定时点的状态。适配 LongMemEval temporal-reasoning，依赖仅为 Python 标准库。",
      "labelIds": [
        "label.memory/v1",
        "label.reasoning-planning/v1"
      ],
      "availableCaseCount": 2
    },
    {
      "datasetId": "dataset.memory-preference/v1",
      "name": "Memory Preference",
      "description": "轻量偏好记忆专题：从用户长期偏好中选择满足约束的推荐或计划。适配 PersonaMem 的偏好回忆形式，不需要联网。",
      "labelIds": [
        "label.memory/v1",
        "label.reasoning-planning/v1"
      ],
      "availableCaseCount": 2
    },
    {
      "datasetId": "dataset.retrieval-hotpot-evidence/v1",
      "name": "Retrieval Hotpot Evidence",
      "description": "轻量多跳检索专题：在随题提供的候选段落中完成 bridge/comparison 推理，并返回支持证据。适配 HotpotQA，标准库即可运行。",
      "labelIds": [
        "label.reasoning-planning/v1",
        "label.retrieval-grounding/v1"
      ],
      "availableCaseCount": 3
    },
    {
      "datasetId": "dataset.collaboration-aws-travel/v1",
      "name": "Collaboration AWS Travel",
      "description": "轻量协作规划专题：拆分航班、住宿和改签取消任务，按依赖、预算和确认边界合并结果。改编 AWS multi-agent collaboration scenarios，使用本地模拟工具。",
      "labelIds": [
        "label.collaboration/v1",
        "label.reasoning-planning/v1",
        "label.tool-external/v1"
      ],
      "availableCaseCount": 3
    },
    {
      "datasetId": "dataset.ops-agentops-reliability/v1",
      "name": "Ops AgentOps Reliability",
      "description": "轻量运维可靠性专题：处理超时、畸形响应、限流退避和提示注入边界，要求记录重试与停止条件。适配 AgentOps-Bench 风格，依赖仅为标准库。",
      "labelIds": [
        "label.efficiency-reliability/v1",
        "label.reasoning-planning/v1",
        "label.safety-boundary/v1",
        "label.tool-external/v1"
      ],
      "availableCaseCount": 4
    }
  ]
}
```
