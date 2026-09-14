# DSHEval CLI 与插件输入说明

## Mac mini CLI 运行

进入 Mac mini 项目目录：

```bash
cd /Users/dsheval/Projects/dsheval
export PATH=/opt/homebrew/opt/node@22/bin:$PATH
pnpm install
pnpm build
pnpm --silent cli -- run \
  --target config/targets/real-dsh.json \
  --plugin "dsh-plugin-shop,dsh-market" \
  --datasets datasets \
  --labels labels \
  --trace trace/dsh-runtime.json \
  --environment environments/macos.json \
  --test-profile STANDARD \
  --config config/macos-vm.json
```

<pre><strong>  --plugin "dsh-plugin-shop,dsh-market" \</strong></pre>

`--plugin` 接收一个或多个插件名称，使用英文逗号分隔：

```text
--plugin "插件A,插件B,插件C"
```

不填写 `--plugin` 时，不添加额外插件。

## 指定特定 Case

`run` 支持用 `--case` 在 CLI 中直接指定一题。指定后 DSHEval 会从 Dataset Catalog 和
`datasets/` 下真实存在的 `question.json` 中解析该题，跳过 Planner 的自动选题，但仍然执行
Target 检查、证据计划、Agent 运行、Probe 采集和 Judge。指定 Case 时只运行这一题，不需要
再传 `--max-cases 1`。

推荐使用题目目录名：

```bash
pnpm --silent cli -- run \
  --run-id "case-os-$(date +%Y%m%d-%H%M%S)" \
  --target config/targets/real-dsh.json \
  --plugin "liustack/modlens" \
  --datasets datasets \
  --labels labels \
  --trace trace/dsh-runtime.json \
  --environment environments/macos.json \
  --test-profile STANDARD \
  --config config/macos-vm.json \
  --case agentbench-os/agentbench-os-count-files
```

`--case` 也接受以下形式：

```text
--case agentbench-os.case-2
--case agentbench-os-count-files
--case datasets/agentbench-os/agentbench-os-count-files/question.json
--case /Users/dsheval/Projects/dsheval/datasets/agentbench-os/agentbench-os-count-files
```

`dataset.case-N` 中的 `N` 是该 Dataset 的题目目录按英文排序后的编号；目录名是更稳定的写法。
不存在、越界或重名时命令会直接失败，不会静默切换到其他 Case。每次重跑应使用新的 `--run-id`，
否则可能触发不可变记录冲突。`--case` 只选择题目，不负责安装 Probe；Probe 是否采集成功以
运行产生的 `trace/status.json` 和原始 Trace 为准。

## 插件选择规则

CLI 根据名称查询 [dsheval.ai](https://www.dsheval.ai/)：

- CLI 只接受插件规范名称的精确匹配；可视化界面负责模糊搜索并回填规范名称。
- 候选按名称相关度排序，同等相关度按网站排名排序。
- 只接受网站已识别安装源的插件。
- 插件不存在或安装源不可识别时，命令直接失败。

插件会安装到 Target 的隔离副本中，原始 Target 不会被永久修改。

运行前可先检查：

```bash
pnpm --silent cli -- inspect \
  --target config/targets/real-dsh.json \
  --plugin "dsh-plugin-shop,dsh-market"
```

## 可视化界面

```bash
cd /Users/dsheval/Projects/dsheval
export PATH=/opt/homebrew/opt/node@22/bin:$PATH
pnpm run plugin-ui
```

打开 `http://127.0.0.1:4174`，输入关键词搜索插件，点击候选项加入列表，可悬停点击 `×` 删除，最后可选择“开始评测”。

页面中的 Datasets、Labels、Trace、Environment、Test profile 和 Config 使用默认配置，不在界面中展示。
