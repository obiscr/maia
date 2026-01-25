# 模板：可导入的工作流模板

此目录中的每个 `.json` 文件都是**可直接导入**的工作流模板，用于 UI 导入功能。

## 包含模板

- `zh-cn/01-HelloWorld.json`: 最小可运行工作流（1 个步骤）。演示参数 + `outputsSpec` 映射。

- `zh-cn/02-RSS抓取器.json`: 获取 RSS/Atom/XML，解析/清理，去重，并限制最终输出。

- `zh-cn/03-HackerNews抓取器.json`: 获取 HackerNews 热门的前10条记录，解析并生成 TXT 输出（同时注册一个工件）。

- `zh-cn/04-链接可用性检测器.json`: 网络链接检查器（HEAD + GET 回退），生成 Markdown 报告工件，包含 DAG 分支 + 合并。

- `zh-cn/05-NPM依赖更新检查器.json`: 使用 `semver` 对 `package.json` 依赖进行 npm 注册表检查，生成 Markdown 过时报告工件。

- `zh-cn/06-GitHub仓库自检器.json`: GitHub 仓库检查器（仓库/发布/问题/文档/package.json + 文档链接检查），生成 Markdown + JSON 报告工件，包含多分支 DAG + 合并。

## 资源

`resources` 包含了运行模板需要的资源。