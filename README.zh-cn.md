<p align="center">
  <img src="./public/maia.svg" alt="Maia" width="96" />
</p>

<p align="center">
  <a href="./README.md">English</a> | <a href="./README.zh-cn.md"><b>中文</b></a>
</p>

<p align="center">
  <a href="https://hub.docker.com/r/obiscr/maia">
    <img src="https://img.shields.io/docker/pulls/obiscr/maia" alt="Docker Pulls" />
  </a>
  
  <a href="https://hub.docker.com/r/obiscr/maia">
    <img src="https://img.shields.io/docker/v/obiscr/maia" alt="Docker Image Version" />
  </a>
</p>

# Maia

Maia 是一个自托管的 DAG 工作流编排与执行服务，用于长时间自动化任务：可观测、可调试、可回放。

- **持久化**：使用 SQLite 持久化状态与输出（可保留、可追溯）
- **可观测**：实时日志/事件流（SSE），并支持回放
- **隔离执行**：可选 Runner + Sandbox 容器隔离（生产推荐）
- **可组合**：每个步骤都有明确输入/输出，并可产出产物
- **可选 Agent**：辅助生成/完善工作流（可选启用）

![Runs preview](.github/assets/runs-preview-1.png)


> [!TIP]
> 这篇文章包含了更多的演示案例
> [Maia - Self-hosted DAG workflow orchestration and execution service](https://obiscr.com/blog/maia)

## 快速开始

### Docker 自托管

前置要求：Docker + Docker Compose v2。

1) 下载 `docker-compose.release.yml` 和 `.env.production`

```bash
curl -fsSL -o docker-compose.release.yml https://raw.githubusercontent.com/obiscr/maia/main/docker-compose.release.yml
curl -fsSL -o .env.production https://raw.githubusercontent.com/obiscr/maia/main/env.example
```

2) 编辑 `.env.production 文件`，设置 `RUNNER_TOKEN`

```dotenv
RUNNER_TOKEN=your-token
```

3) 启动容器

```bash
docker compose -f docker-compose.release.yml --env-file .env.production up -d
```

打开 `http://localhost:3690` 进行初始化设置。

### 本地 Dev 运行

参考文档 [本地 Dev 运行](https://maia.obiscr.com/zh-cn/quick-start/build-from-source-dev/)

### 本地 Docker 运行

参考文档 [本地 Docker 运行](https://maia.obiscr.com/zh-cn/quick-start/build-from-source-docker/)

## 版本发布

- 更新日志：`CHANGELOG.md`

## 链接

- 文档站：[maia.obiscr.com](https://maia.obiscr.com/)
- 贡献指南：`CONTRIBUTING.md`
- 安全：`SECURITY.md`
- 更新日志：`CHANGELOG.md`
- 许可证：`LICENSE`

## 致谢

- 调色板灵感和部分 CSS 参考：**Starlight**（MIT）：`https://github.com/withastro/starlight`
- UI 组件设计（部分）灵感：**GitHub Actions**：`https://github.com/features/actions`
- 第三方声明：`THIRD_PARTY_NOTICES.md`

## 许可证

MIT（见 `LICENSE`）。