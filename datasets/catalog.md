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
    }
  ]
}
```
