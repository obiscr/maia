// ---------------------------------------------------------------------------
// Agent example prompts – split into two categories:
//   1. Workflow Templates: shown in the top section for creating workflows
//   2. Module Actions:    shown in the module grid for common CRUD operations
// ---------------------------------------------------------------------------

// ---- Shared types --------------------------------------------------------

export type AgentModule = "workflow" | "run" | "job" | "schedule" | "batch" | "operation"

type SupportedLocale = "en" | "zh-cn"

function normalizeLocale(locale: string | undefined | null): SupportedLocale {
  const l = String(locale ?? "").toLowerCase()
  if (l.startsWith("zh")) return "zh-cn"
  return "en"
}

// ---- Workflow Templates ---------------------------------------------------

export type WorkflowTemplateId =
  | "web_summary"
  | "csv_stats"
  | "json_validate"
  | "rss_digest"
  | "image_ocr"
  | "video_takeaways"
  | "markdown_outline"
  | "log_errors"
  | "review_sentiment"
  | "invoice_parse"
  | "issue_triage"
  | "data_schema"
  | "news_merge"
  | "ab_analysis"
  | "ticket_routing"
  | "doc_summary"
  | "etl_pipeline"
  | "site_monitor"
  | "knowledge_base"
  | "branching_workflow"

export type WorkflowTemplateDifficulty = "simple" | "medium" | "hard"

export interface WorkflowTemplateDef {
  id: WorkflowTemplateId
  difficulty: WorkflowTemplateDifficulty
}

export const WORKFLOW_TEMPLATES: WorkflowTemplateDef[] = [
  { id: "web_summary", difficulty: "simple" },
  { id: "csv_stats", difficulty: "simple" },
  { id: "json_validate", difficulty: "simple" },
  { id: "rss_digest", difficulty: "simple" },
  { id: "image_ocr", difficulty: "simple" },
  { id: "video_takeaways", difficulty: "simple" },
  { id: "markdown_outline", difficulty: "simple" },
  { id: "log_errors", difficulty: "simple" },
  { id: "review_sentiment", difficulty: "medium" },
  { id: "invoice_parse", difficulty: "medium" },
  { id: "issue_triage", difficulty: "medium" },
  { id: "data_schema", difficulty: "medium" },
  { id: "news_merge", difficulty: "medium" },
  { id: "ab_analysis", difficulty: "medium" },
  { id: "ticket_routing", difficulty: "medium" },
  { id: "doc_summary", difficulty: "hard" },
  { id: "etl_pipeline", difficulty: "hard" },
  { id: "site_monitor", difficulty: "hard" },
  { id: "knowledge_base", difficulty: "hard" },
  { id: "branching_workflow", difficulty: "hard" },
]

const ZH_WORKFLOW_TEMPLATES: Record<WorkflowTemplateId, string> = {
  web_summary: `帮我创建一个工作流：我给你一个网页链接，你帮我把网页标题、简介（有就取，没有就空）、再写一段短摘要，最后输出成一个 JSON。

输入里就放一个 url 参数（params.url）就够了。
输出希望长这样：{ url, title, metaDescription, summary, fetchedAt }。

抓网页的时候别太脆：遇到跳转、超时、乱码、HTML 不规范都要尽量处理；失败的话也要把错误原因写进 errors 数组里（不要直接崩）。

另外请在工作流 draft 里把 inputSpec 也一起写好（required 尽量少，至少给 2 个 examples）。步骤脚本用系统要求的 export default async main(...) 结构。

最后：先给一个清晰 plan，再逐步 draft_step，最后 finalize_draft。`,

  csv_stats: `我有一个 CSV 文件，想让你帮我创建一个"自动统计小助手"的工作流：读入 CSV → 识别每列是什么类型 → 统计一下（数值列算均值/最大最小/中位数等，文本列看 Top 值）→ 顺便做点数据质量提示（缺失、空值、异常）。

输入：一个 CSV 文件（filesInput.csv），分隔符可以不传，让你自己识别；必要的话也可以给个可选 params.delimiter。
输出：一个 report JSON（每列的类型+统计+质量提示，外加一个总览）。

大文件别一次性全读爆内存：你可以采样/分块，但要在输出里说明清楚你怎么做的；失败也要写 errors，并给降级方案。

把 inputSpec 写好（required 少一点，给 2 个 examples）。

最后：先 plan，再逐步 draft_step，最后 finalize_draft。`,

  json_validate: `我这边会传一段 JSON（params.payload），但数据可能不太干净。你帮我创建一个工作流：先检查一下格式/字段对不对 → 再把字段规范化（比如补默认值、改字段名、类型转换）→ 最后输出一个"干净版"的 JSON（outputs.result），最好还带点校验信息。

如果校验失败，不要只给一句话：请输出结构化 errors（字段路径、原因、怎么修）。
inputSpec 也一起生成，required 尽量少，给 examples。

最后：先 plan → draft_step → finalize_draft。`,

  rss_digest: `给你一个 RSS/Atom 链接（params.feedUrl），帮我创建一个工作流：抓取 feed → 把条目整理干净（标题、链接、时间、来源）→ 去重一下 → 输出一个 items 列表（默认拿一小部分就行，maxItems 作为可选参数）。

抓取要考虑失败/超时/无效 feed；把 errors 和你采取的降级策略写在 meta 里。
inputSpec 也一起写好。`,

  image_ocr: `我会给你一张图片（filesInput.image），你帮我创建一个工作流来识别图片里的文字（OCR），然后把文本清理一下（去多余空白、排版弄整齐），最后输出：text + 一些 meta（比如猜的语言、置信度、错误原因）。

如果 OCR 效果不佳也别崩：至少把"原始 OCR 文本"输出出来作为降级。
顺便把 inputSpec 写好。`,

  video_takeaways: `我想把一段视频/会议的字幕整理成"要点 + 待办"。你帮我创建一个工作流：
- 如果能拿到视频链接（params.videoUrl）就去试着拿字幕；拿不到也没关系，我可以直接把 transcript 文本粘贴给你（params.transcript）。
- 你把内容分段，然后提炼成 takeaways（要点）和 actionItems（行动项），如果能给时间点就更好（timestamps 可选）。

inputSpec 要支持"只有 transcript 也能跑"；失败要有降级。`,

  markdown_outline: `我有一份 Markdown 文档，想把它整理成结构化信息。请创建一个工作流：解析 Markdown → 生成大纲树（outline）→ 把代码块（含语言）和链接都抽出来 → 输出成 JSON。

输入支持文件（filesInput.markdown）或者直接传文本（params.markdownText）都行；保持原始顺序。`,

  log_errors: `我有一堆日志（filesInput.log），想快速知道最常见的报错是啥。请创建一个工作流：读日志 → 把错误按"同一类"聚起来 → 统计次数/首次出现/最后出现/给几行样例 → 输出一个报告 JSON（summary + groups）。topK 可以做成可选参数。

日志可能很大，别一次性全塞进内存：用采样/分块都行，但要说明，并把失败项写进 errors。`,

  review_sentiment: `我有一批商品/应用评论（text + rating），想看整体口碑、大家都在吐槽什么。请创建一个工作流：清洗评论 → 识别语言 → 判情绪倾向 → 找出常见主题 → 汇总成一个 dashboard JSON（按主题/情绪分布，顺便挑几条代表性评论）。

输入可以是 CSV 文件（filesInput.reviewsCsv）或直接传 JSON（params.reviewsJson）。请做重复/超短评论的质量检查，并在 diagnostics 里给出统计和 errors。`,

  invoice_parse: `我有一张发票 PDF（filesInput.invoicePdf），想把它变成结构化数据。请创建一个工作流：先把文字提取出来（必要时 OCR）→ 识别供应商/发票号/日期/总金额 → 把行项目抽出来 → 做个校验（比如行项目加起来跟总计对不对）→ 输出 invoice JSON + validation（告警要解释原因）。

inputSpec 也写好，最后一个最终输出步骤。`,

  issue_triage: `我想做一个"Issue 分诊小帮手"。输入就是标题（params.title）、正文（params.body），评论（params.comments）可选。请创建一个工作流并输出一个 triage 结果：建议的 labels、优先级（带理由）、复现步骤提取、以及一段可以直接粘贴回去的建议回复。

尽量像真实团队在做分诊那样写，不要太学术；inputSpec + examples；最后一步输出。`,

  data_schema: `我手上只有一份"样本数据"（CSV 或 JSON，filesInput.sample），但我想快速知道这份数据大概长什么样、有哪些字段、应该怎么校验。请创建一个工作流：解析样本 → 推断 schema → 给约束建议（必填/范围/枚举）→ 顺便提示哪些列可能是 PII → 输出 JSON Schema + recommendations（把你的假设也写出来）。

inputSpec required 少一点，最后一步输出。`,

  news_merge: `我有好几个信息源（params.sources，一堆 URL，可能是 RSS 也可能是网页），想把它们合成一个"去重后的摘要"。请创建一个工作流：抓取 → 去重 → 按主题分组/聚类 → 输出 clusters + digest。

抓取要考虑限速、重试、降级（比如某个源挂了就跳过但记录下来），diagnostics 里要看得出来发生了什么。最后一步输出。`,

  ab_analysis: `我想把一次 A/B 实验的结果做成一份"能看懂的分析报告"。输入是对照组/实验组的指标和样本量（CSV 或 JSON 都行）。你创建一个工作流：算提升幅度、给置信区间/显著性，并用人话解释结论和注意事项；同时做一些基本检查（比如 SRM、缺失数据）。

输出 report + checks 两块 JSON；inputSpec + examples；最后一步输出。`,

  ticket_routing: `我有一堆客服工单（CSV 或 JSON），想让你帮我做个"自动分流 + 风险提示"的工作流：先把工单大概分个类 → 建议分给哪个团队 → 估一下 SLA 风险（高/中/低 + 理由）→ 抽取里面的关键信息（订单号等），但输出里要把邮箱/手机号这类 PII 脱敏。

最后输出一个 queuePlan（每条工单的路由/优先级/风险/摘要）和 redaction（脱敏命中统计）。inputSpec 写好，最后一步输出。`,

  doc_summary: `我要你为 Maia 设计一个"长文档处理 → 分块 → 可检索索引 → 分层摘要 → 术语/实体抽取 → 交叉引用 → 可搜索 bundle 输出"的复杂工作流，并输出可执行 workflow draft。

输入：
- filesInput.document：PDF 或纯文本
- params.lang（可选）：zh/en

输出：
- outputs.bundle：可搜索 JSON（chunks/index/summaries/glossary/entities/citations）
- outputs.diagnostics：阶段统计、错误与降级

你可以写得专业一点，但别像写标准那样死板。需要确保：
- inputSpec（含 examples）要给出来；
- 允许并行处理，但最后一定要汇聚；
- 分块 ID 可复现，抓取/解析失败要有重试与降级，并在 diagnostics 里能看出来；
- step 脚本结构与 ctx 读取规则严格遵守系统提示。

最后：先给 plan，再逐步 draft_step，最后 finalize_draft。`,

  etl_pipeline: `我要你为 Maia 设计一个"端到端 ETL：原始数据 → 清洗归一 → 质量闸门 → 隔离错误 → 产出 curated dataset → 报告"的复杂工作流，并输出可执行 workflow draft。

输入：
- filesInput.rawCsv：原始 CSV
- params.config：ETL 配置 JSON（规则/阈值/输出字段映射等）

输出：
- outputs.dataset：规范化后的数据（JSON 或 CSV 形式由你决定）
- outputs.report：数据质量报告（错误/异常/修复/降级）
- outputs.quarantine：隔离的坏数据与原因

要求：把 inputSpec 写好；要有可重试/可降级；依赖清晰。`,

  site_monitor: `我有一堆网站链接（params.urls），想做个"站点变更监控"的工作流：定期抓一下页面，看看内容有没有变化；如果变化比较大就出告警，变化不大就做个汇总。

语言跟随 params.lang（zh/en，可选）。敏感度/阈值你可以设计成一个可选参数（params.threshold），别让用户被迫填一堆东西。

输出我希望有三块：
- alerts：需要提醒的条目（包含变化点、变化类型、简短说明）
- summary：本次整体概览
- diagnostics：你做了哪些缓存/限速/重试（以及失败项）

重点：抓取要考虑限速、缓存、按域名退避（别把别人网站打挂）。inputSpec + examples。`,

  knowledge_base: `我要你为 Maia 设计一个"混合来源知识库构建：采集 → 规范化 → 去重 → 引用/出处抽取 → 索引构建 → QA 生成 → 一致性审计"的复杂工作流，并输出可执行 workflow draft。

输入：
- params.urls（可选）
- filesInput.pdfs（可选，多文件）
- filesInput.markdowns（可选，多文件）
- params.lang（可选）：zh/en

输出：
- outputs.kb：知识库 JSON（每条事实必须带 provenance）
- outputs.audit：一致性与 schema 校验结果

要求：inputSpec 要有；每条事实必须带 provenance（能追溯来源）。`,

  branching_workflow: `我要你为 Maia 设计一个"多源情报采集 → 清洗归一 → 实体抽取 → 去重聚合 → 风险评分 → 报告生成 → 通知分发"的超复杂工作流，并输出可执行的 workflow draft（name/description/dependencies/envJson/inputSpec/steps）。

业务目标：
- 输入：topic、days、lang(zh/en)、maxItems（默认50）、riskThreshold（0-100，默认70），以及可选文件输入：
  - filesInput.sourcesCsv：CSV，列：sourceType(rss/web/api)、url、weight(0-1)、enabled(true/false)
  - filesInput.blocklistTxt：文本，每行一个需要过滤的域名或关键词
- 输出：最终 JSON 报告，包含：
  - meta（总条数、去重后条数、命中黑名单条数、按来源分布）
  - topRisks（高风险条目：title/url/source/riskScore/reasons/summary）
  - entities（聚合实体：人名/组织/地点/产品/漏洞编号等，带出现次数与关联条目）
  - timeline（按时间排序的事件线）
  - diagnostics（各阶段耗时/失败数/重试数/降级情况）

强约束：
1) 必须提供 inputSpec（JSON 字符串），包含 paramsSchema、filesInput、examples（至少 2 个），required 尽量少。
2) deps 清晰：允许多分支并行，但必须有"最终汇聚 + 最终输出"两个明确步骤。
3) 步骤需要覆盖这些子系统：输入校验、sources 解析与过滤、RSS/Web/API 并行抓取与规范化、清洗与（可选）翻译、摘要与实体抽取、风险评分、聚合、报告生成（JSON + Markdown）、通知生成。
4) 每个 step 的脚本必须遵循系统提示结构；只能从 ctx.params 与 ctx.upstream 读取。
5) 依赖包尽量少：HTML 可用 cheerio；RSS 如需可用 rss-parser；其余尽量用 Node 内置。
6) 抓取类 step 必须考虑失败与重试：输出 errors 数组 + 降级策略（跳过/重试次数记录）。
7) stepKey 命名 snake_case，不要引用不存在的 deps。
8) 输出步骤 name/description 语言跟随 lang（zh/en）。

最后：请先给清晰 plan，再按计划逐步 draft_step（每步一次 tool call），最后 finalize_draft 输出完整 draft。`,
}

const EN_WORKFLOW_TEMPLATES: Record<WorkflowTemplateId, string> = {
  web_summary: `Help me build a workflow: I'll give you a web URL, and I want a clean JSON output with the page title, a short description (if available), and a short summary.

Input can be as simple as params.url.
Output should look like: { url, title, metaDescription, summary, fetchedAt }.

Please make it resilient: redirects, timeouts, weird encodings, broken HTML — don't crash. If something fails, record it in an errors[] list and still produce the best possible output.

Also generate inputSpec (keep required fields minimal, include at least 2 examples). Each step script must follow the system's export default async main(...) format.

Finally: give a clear plan first, then draft_step step-by-step, then finalize_draft with the full draft.`,

  csv_stats: `I have a CSV and I want a "quick stats + quality" workflow: read the CSV, guess column types, compute basic stats for numeric columns, show top values for categorical columns, and output a report JSON.

Input: filesInput.csv (delimiter can be optional; auto-detect when missing).
Output: outputs.report with per-column summaries + a short overall note about data quality (missing values, weird outliers, etc.).

Please don't blow up on large files — sampling/chunking is fine, just explain what you did and record errors when needed. Generate inputSpec (minimal required fields + 2 examples).`,

  json_validate: `I'll send you a JSON payload (params.payload) but it can be messy. Please build a workflow that validates it, normalizes fields (defaults, renames, type coercion), derives a few useful fields, and outputs a "clean" JSON result.

If validation fails, don't just say "invalid" — return structured errors (path, reason, suggested fix). Also provide inputSpec with minimal required fields + examples.`,

  rss_digest: `Build me a workflow that takes an RSS/Atom URL (params.feedUrl), fetches it, cleans up items (title/link/date/source), dedupes them, and outputs a small digest list (maxItems can be an optional parameter).

It should handle bad feeds/timeouts gracefully (errors + fallback behavior). Also generate inputSpec with examples.`,

  image_ocr: `I'll upload an image (filesInput.image). Please build a workflow that runs OCR, cleans the text (whitespace, obvious noise), and outputs { text, meta } where meta includes language guess, confidence, and errors.

If OCR quality is poor, still output the raw OCR text as a fallback. Provide inputSpec + examples.`,

  video_takeaways: `I want to turn a meeting/video transcript into "key takeaways + action items". Build a workflow where I can either provide a video URL (params.videoUrl) or just paste the transcript (params.transcript).

Output takeaways, actionItems, and optionally timestamps if you can infer them. Make transcript-only input work. Provide inputSpec + examples, handle failures gracefully.`,

  markdown_outline: `I have a Markdown doc and I want structured output: outline tree, code blocks (with language), and links. Build a workflow that accepts either a file (filesInput.markdown) or raw text (params.markdownText), preserves ordering, and outputs a single JSON result.

Provide inputSpec + examples and finish with one final output step.`,

  log_errors: `I have a big log file (filesInput.log) and I want to quickly know "what errors happen most". Build a workflow that groups similar errors, counts them, shows first/last seen, and includes a few sample lines. topK can be optional.

For huge logs, use sampling/chunking to avoid memory issues (but explain it), record errors, generate inputSpec.`,

  review_sentiment: `I have a bunch of product/app reviews (text + rating) and I want a dashboard: overall sentiment, common themes, and a few representative examples. Build a workflow that cleans data, detects language, does sentiment + topic extraction, aggregates the results, and outputs a dashboard JSON.

Input can be CSV (filesInput.reviewsCsv) or JSON (params.reviewsJson). Include basic quality checks (duplicates, very short entries) and put stats/errors into diagnostics.`,

  invoice_parse: `I have an invoice PDF (filesInput.invoicePdf) and I want structured data out of it. Build a workflow that extracts text (OCR fallback), finds key fields (vendor/invoice number/dates/totals), extracts line items, validates totals, and outputs a normalized invoice JSON plus validation warnings with explanations.

Provide inputSpec + examples, handle extraction failures gracefully.`,

  issue_triage: `Build me an "issue triage helper". Input is title/body (comments optional). Output should include suggested labels, a priority (with rationale), extracted repro steps, and a short reply message I can paste back.

Keep it practical (like a real support/engineering team would do). Provide inputSpec + examples.`,

  data_schema: `I only have sample data (CSV/JSON). Build a workflow that infers a schema, proposes constraints (required/ranges/enums), flags possible PII columns, and outputs JSON Schema plus recommendations/assumptions.

Keep required fields minimal in inputSpec, include examples.`,

  news_merge: `I have multiple sources (a list of URLs, can be RSS or web pages) and I want a merged digest: fetch, dedupe, cluster by topic, and output clusters + a clean digest.

Please be explicit about rate limits, retries, and fallback behavior, and put diagnostics in the output. Provide inputSpec + examples.`,

  ab_analysis: `Turn my A/B experiment metrics into an analysis report people can understand. Input is control vs treatment metrics and sample sizes (CSV or JSON). Compute lift, confidence intervals/significance, and write a plain-language interpretation + caveats. Also run basic sanity checks (SRM, missing data).

Output report + checks JSON, provide inputSpec + examples.`,

  ticket_routing: `I have support tickets and I want a workflow that helps triage them: classify intent, suggest routing to a team, estimate SLA risk (high/med/low + why), extract useful entities (order id, etc.), and redact PII in outputs.

Output a queuePlan plus redaction stats, generate inputSpec + examples, and ensure we don't leak PII.`,

  doc_summary: `Design a complex Maia workflow for "long document processing → chunking → searchable index → hierarchical summaries → entity/glossary extraction → cross-references → searchable bundle output", and output an executable workflow draft.

Inputs:
- filesInput.document (PDF/text)
- params.lang (optional: zh/en)

Outputs:
- outputs.bundle (chunks/index/summaries/glossary/entities/citations)
- outputs.diagnostics

Constraints: reproducible chunk IDs; retries/timeouts/degradation; parallel branches allowed but must converge.`,

  etl_pipeline: `Design a complex Maia workflow for end-to-end ETL: "raw data → normalization → quality gates → quarantine → curated dataset → report", and output an executable workflow draft.

Inputs:
- filesInput.rawCsv
- params.config (ETL config JSON)

Outputs:
- outputs.dataset
- outputs.report
- outputs.quarantine

Constraints: inputSpec; clear deps; retries + degradation.`,

  site_monitor: `Design a complex Maia workflow for "multi-lingual site monitoring: fetch → change detection → change classification → optional translation → alert generation → notification", and output an executable workflow draft.

Inputs:
- params.urls
- params.lang (optional: zh/en)
- params.threshold (optional)

Outputs:
- outputs.alerts
- outputs.summary
- outputs.diagnostics (cache/rate-limit/retry)

Constraints: must handle caching, rate limits, and per-domain backoff; inputSpec.`,

  knowledge_base: `Design a complex Maia workflow for "knowledge base building from mixed sources: ingest → normalize → dedupe → provenance extraction → indexing → QA generation → consistency audit", and output an executable workflow draft.

Inputs:
- params.urls (optional)
- filesInput.pdfs (optional, multi)
- filesInput.markdowns (optional, multi)
- params.lang (optional: zh/en)

Outputs:
- outputs.kb (every fact with provenance)
- outputs.audit (schema + consistency checks)

Constraints: strict provenance; inputSpec.`,

  branching_workflow: `Design an ultra-complex Maia workflow for "multi-source intel collection → normalization → entity extraction → dedupe/aggregation → risk scoring → report generation → notification", and output an executable workflow draft (name/description/dependencies/envJson/inputSpec/steps).

Business goal:
- Inputs: topic, days, lang(zh/en), maxItems(default 50), riskThreshold(0-100, default 70), plus optional files:
  - filesInput.sourcesCsv: CSV columns sourceType(rss/web/api), url, weight(0-1), enabled(true/false)
  - filesInput.blocklistTxt: lines of blocked domains/keywords
- Output: final JSON report with meta/topRisks/entities/timeline/diagnostics, plus a Markdown report field.

Hard constraints:
1) Provide inputSpec (JSON string) with paramsSchema/filesInput/examples (at least 2 examples) and minimal required fields.
2) Parallel branches are allowed but must converge.
3) Cover subsystems: input validation, sources parsing/filtering, RSS/Web/API fetching & normalization, cleaning + optional translation (degradable), summarization + entity extraction (degradable), risk scoring with reasons, aggregation, report generation (JSON+Markdown), notification message generation.
4) Step scripts follow the system's export default async main structure and read only ctx.params / ctx.upstream.
5) Keep deps minimal (cheerio OK; rss-parser OK; otherwise Node built-ins).
6) Fetch steps must include retries/errors[] and degradation policy.
7) snake_case stepKey, no invalid deps.
8) Step name/description should follow lang (zh/en).

Finally: provide a clear plan first, then draft_step step-by-step, then finalize_draft with the full draft.`,
}

export function getWorkflowTemplatePrompt(locale: string | undefined | null, id: WorkflowTemplateId): string {
  const l = normalizeLocale(locale)
  return (l === "zh-cn" ? ZH_WORKFLOW_TEMPLATES : EN_WORKFLOW_TEMPLATES)[id]
}

// ---- Module Actions -------------------------------------------------------

export type ModuleActionId =
  | "workflow_list"
  | "workflow_versions"
  | "run_failures"
  | "run_results"
  | "job_run"
  | "job_status"
  | "schedule_create"
  | "schedule_overview"
  | "batch_create"
  | "batch_progress"
  | "operation_log"
  | "operation_overview"

export interface ModuleActionDef {
  id: ModuleActionId
  module: AgentModule
}

export const MODULE_ACTIONS_BY_MODULE: Record<AgentModule, [ModuleActionDef, ModuleActionDef]> = {
  workflow: [
    { id: "workflow_list", module: "workflow" },
    { id: "workflow_versions", module: "workflow" },
  ],
  run: [
    { id: "run_failures", module: "run" },
    { id: "run_results", module: "run" },
  ],
  job: [
    { id: "job_run", module: "job" },
    { id: "job_status", module: "job" },
  ],
  schedule: [
    { id: "schedule_create", module: "schedule" },
    { id: "schedule_overview", module: "schedule" },
  ],
  batch: [
    { id: "batch_create", module: "batch" },
    { id: "batch_progress", module: "batch" },
  ],
  operation: [
    { id: "operation_log", module: "operation" },
    { id: "operation_overview", module: "operation" },
  ],
}

const ZH_MODULE_ACTIONS: Record<ModuleActionId, string> = {
  workflow_list: `帮我列出所有工作流，按最近更新时间排序，并简要说明每个工作流的用途和状态（依赖是否就绪、是否配置了输入规范等）。`,
  workflow_versions: `帮我查看工作流的版本历史，列出各版本的创建时间、步骤数、是否配置了输入/输出规范，找出最近的变更。`,
  run_failures: `查询近一周失败的运行，获取每个失败运行的错误信息和失败步骤，帮我分析可能的原因并给出修复建议。`,
  run_results: `获取最近一次成功运行的输出结果，帮我解读输出内容。`,
  job_run: `我想运行一个工作流，请先帮我查看它的输入规范，然后根据规范创建一个任务并启动。`,
  job_status: `列出当前所有正在运行和排队中的任务，告诉我整体执行情况和预计进度。`,
  schedule_create: `我需要创建一个调度计划，让某个工作流每天早上 8 点自动运行。请帮我设置。`,
  schedule_overview: `列出所有调度计划，包括启用状态和下次执行时间，告诉我是否有异常。`,
  batch_create: `我需要用一个工作流批量处理一组数据，请帮我创建批次，配置好并发限制。`,
  batch_progress: `查看当前批次的执行进度，包括成功、失败和排队中的任务数量，是否需要干预。`,
  operation_log: `列出最近的操作记录，看看系统中发生了哪些变更，是否有异常操作。`,
  operation_overview: `给我一个系统状态总览：工作流数量、最近运行成功/失败情况、当前任务队列、调度状态，以及是否需要关注的问题。`,
}

const EN_MODULE_ACTIONS: Record<ModuleActionId, string> = {
  workflow_list: `List all my workflows sorted by last updated, and briefly describe each one's purpose and status (dependencies ready, input spec configured, etc.).`,
  workflow_versions: `Show me the version history of a workflow, list each version's creation time, step count, and input/output spec status. Highlight recent changes.`,
  run_failures: `Find all failed runs from the past week, get the error info and failed steps for each, analyze the likely causes and suggest fixes.`,
  run_results: `Get the output of the most recent successful run and help me interpret the results.`,
  job_run: `I want to run a workflow. First check its input spec, then create and start a job with the right parameters.`,
  job_status: `List all currently running and queued jobs, tell me the overall execution status and expected progress.`,
  schedule_create: `I need to create a schedule to automatically run a workflow every day at 8am. Please set it up.`,
  schedule_overview: `List all schedules with their enabled status and next execution time, flag any issues.`,
  batch_create: `I need to batch-process a set of data with a workflow. Create a batch and configure concurrency limits.`,
  batch_progress: `Check current batch execution progress including success/failure/queued counts, and whether intervention is needed.`,
  operation_log: `List recent operations to see what changes were made in the system and flag any anomalies.`,
  operation_overview: `Give me a system status overview: workflow count, recent run success/failure rates, current job queue, schedule status, and any issues that need attention.`,
}

export function getModuleActionPrompt(locale: string | undefined | null, id: ModuleActionId): string {
  const l = normalizeLocale(locale)
  return (l === "zh-cn" ? ZH_MODULE_ACTIONS : EN_MODULE_ACTIONS)[id]
}
