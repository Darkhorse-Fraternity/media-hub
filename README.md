# Pumpkii Media Hub

Pumpkii Media Hub 是独立的视频生成、审核与多平台发布服务。项目包含 MiniMax H3 / Ref2VA 生成流程、视频修改、YouTube / Instagram 发布、飞书通知、PostgreSQL 数据与 S3 媒体存储。

## 运行要求

- Node.js 22.21+
- pnpm 10.19+
- PostgreSQL
- FFmpeg
- AWS S3 或兼容 S3 的对象存储
- 可访问的 H3 Provider

## 本地启动

```bash
cp .env.example .env
pnpm install
pnpm db:migrate
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
```

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
packages/storage/   S3 媒体存储
packages/ui/        共用 UI 基础组件
packages/validators/ 输入验证 schema
tooling/            TypeScript、ESLint、Prettier、Tailwind 配置
```

项目保持小型 pnpm workspace 结构，是为了保留 Web、API、数据库和基础配置之间清晰的包边界；它不再依赖原 `internal-tools` 仓库中的任何文件或 workspace 包。

## 部署注意事项

- `APP_URL`、OAuth Redirect URI 和 `TRUSTED_ORIGINS` 必须使用部署后的正式域名。
- `MEDIA_HUB_CRYPTO_KEY` 用于平台 Token 加密，迁移环境时必须保持一致。
- 视频与参考图片保存在 `MEDIA_HUB_S3_BUCKET`；数据库只保存对象 Key。
- H3 Provider Token、S3 Secret、OAuth Secret 和飞书 Secret 不应提交到 Git。

## License

MIT
