# Pumpkii Media Hub

Pumpkii Media Hub 是独立的视频生成、审核与多平台发布服务。项目包含 MiniMax H3 / Ref2VA 生成流程、视频修改、YouTube / Instagram / 抖音发布、小红书投稿包、飞书通知、PostgreSQL 数据与 S3 媒体存储。

一分钟短视频可从“脚本模式”进入导演台：拆分镜头、确认文案与首帧、逐镜预览生成及修改版本、选定合片采用的版本，再预览和下载完整成片。镜头的局部修改复用现有 Ref2VA 流程；镜头排序与末帧接力也在同一脚本内完成。导演台还可用选定首帧生成静态分镜预演、裁切镜头、从台词生成可修改的字幕草稿，并选择是否把字幕烧录到成片。

远程 Agent 可使用 Bearer Token 调用相同流程，完整接口见 `GET /api/openapi`：

- `PATCH /api/v1/scripts/{scriptId}/shots/{shotId}/take` 选定成片采用的视频版本，提交 `job_id` 和当前脚本 `version`。
- `PATCH /api/v1/scripts/{scriptId}/shots/{shotId}/edit-plan` 设置 `trim_start_seconds`、`trim_end_seconds`、`captions`，并提交当前 `version`。字幕时间相对于原镜头，裁切时会自动截断到成片范围。
- `POST /api/v1/scripts/{scriptId}/shots/{shotId}/captions/generate` 从脚本台词生成带时间码的字幕草稿，提交当前 `version` 后仍可用 edit-plan 校正。该步骤不做语音识别。
- `POST /api/v1/scripts/{scriptId}/animatic` 使用所有已选首帧生成无声分镜预演；返回的 `agentVideoUrl` 可用 Bearer Token 读取。
- `POST /api/v1/scripts/{scriptId}/assemble` 合片；可提交 `{ "burn_captions": true }` 烧录字幕。成片继续通过返回的生成任务和视频接口获取。

脚本版本每次修改后递增；Agent 应使用最新 `GET /api/v1/scripts/{scriptId}` 返回的版本，避免覆盖其他编辑。普通脚本 PATCH 会保留未显式修改的导演台选片、裁切和字幕状态。

## 运行要求

- Node.js 22.21+
- pnpm 10.19+
- PostgreSQL
- FFmpeg
- MinIO（S3 兼容对象存储）
- 可访问的 H3 Provider

## 本地启动

```bash
cp .env.example .env
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev
```

默认开发地址为 <http://localhost:3051>。

如果复用原 internal-tools 数据库，不要重复执行迁移；直接配置现有 `POSTGRES_URL` 即可。

## 常用命令

```bash
pnpm dev          # 开发服务器
pnpm build        # 生产构建
pnpm start        # 启动生产构建
pnpm test         # Media Hub 与 API 测试
pnpm typecheck    # 全工作区类型检查
pnpm lint         # 全工作区 lint
pnpm daily-report # 发送每日媒体报告
pnpm db:seed      # 创建或同步环境变量中配置的管理员账号
```

`pnpm db:seed` 是幂等的：管理员不存在时创建，已存在时同步姓名、管理员权限和密码。必须先在本地 `.env` 中配置 `MEDIA_HUB_SEED_ADMIN_NAME`、`MEDIA_HUB_SEED_ADMIN_EMAIL` 和 `MEDIA_HUB_SEED_ADMIN_PASSWORD`；不要把真实密码写入 Git。

### 接口集成测试

`pnpm test` 会通过 Testcontainers 启动一个临时 PostgreSQL 17，执行完整 Drizzle migration，并验证视频修改 REST API 的鉴权、输入校验和数据库落库。测试不会连接 `.env` 中的业务数据库，结束后会自动销毁容器；运行机器需要提供 Docker。可通过 `TEST_POSTGRES_IMAGE` 指定兼容的 PostgreSQL 镜像。

## 配置分层

登录后可从首页进入“设置”：

- 每个用户可保存内容语言、默认时长、分辨率以及 YouTube / Instagram 发布偏好；发布页还支持抖音的可见范围、下载权限和封面时间。
- 管理员可在线覆盖 Ollama、备用 Codex Worker 和飞书审核群配置；提示词优化及发布文案优先使用 Ollama，留空的连接配置继续使用 `.env` 默认值。部署环境可单独设置 `MEDIA_HUB_PROMPT_OLLAMA_URL` 与 `MEDIA_HUB_PROMPT_OLLAMA_MODEL`，使提示词模型与日报模型独立。
- 数据库连接、认证与加密根密钥、可信来源、对象存储密钥、OAuth Client Secret、FFmpeg 路径和网络代理始终由部署环境管理，不会通过网页读取或修改。

配置优先级为：任务参数 > 用户偏好 > 管理员配置 > 环境变量默认值。管理员配置保存后会对后续请求立即生效。

## 国内平台发布

- 抖音使用开放平台官方 OAuth 和内容发布接口。部署前需要创建抖音开放平台应用、申请 `video.create.bind` 权限，并配置 `DOUYIN_CLIENT_KEY`、`DOUYIN_CLIENT_SECRET` 与回调地址。
- 小红书目前生成投稿包（标题、正文、标签和一小时有效的视频下载地址）；最终发布由运营人员在小红书 App 内确认，避免把客户端投稿能力伪装成服务端自动发布。
- Agent API 可通过 `POST /api/v1/generations/{jobId}/publish` 发布到已绑定抖音账号，通过 `POST /api/v1/generations/{jobId}/xiaohongshu-package` 准备小红书投稿包。

## Docker

```bash
cp .env.example .env
docker compose up -d --build
```

生产容器监听 `3000`，Compose 默认映射到宿主机 `3051`。容器内已安装 FFmpeg，健康检查路径为 `/api/health`。

## 项目结构

```text
apps/media-hub/     TanStack Start Web 应用与 API 路由
packages/api/       Media Hub tRPC、生成、发布与通知逻辑
packages/auth/      Better Auth 配置
packages/db/        Drizzle schema 与迁移
packages/storage/   MinIO/S3 兼容媒体存储
packages/ui/        共用 UI 基础组件
packages/validators/ 输入验证 schema
tooling/            TypeScript、ESLint、Prettier、Tailwind 配置
```

项目保持小型 pnpm workspace 结构，是为了保留 Web、API、数据库和基础配置之间清晰的包边界；它不再依赖原 `internal-tools` 仓库中的任何文件或 workspace 包。

## 部署注意事项

- `APP_URL`、OAuth Redirect URI 和 `TRUSTED_ORIGINS` 必须使用部署后的正式域名。
- `MEDIA_HUB_CRYPTO_KEY` 用于平台 Token 加密，迁移环境时必须保持一致。
- 视频与参考图片保存在 `MEDIA_HUB_S3_BUCKET`；数据库只保存对象 Key。
- 共享数据库的多个实例中，仅一个实例应设置 `MEDIA_HUB_GENERATION_WORKER_ENABLED=true`；本地 UI 开发实例设置为 `false`。
- H3 Provider Token、S3 Secret、OAuth Secret 和飞书 Secret 不应提交到 Git。

## License

MIT
