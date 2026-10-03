# 一分钟短视频导演台：修改提案与交接

## 决策

将现有脚本、首帧、逐镜生成、Ref2VA 局部修改和合片流程收进同一个导演台。目标是让 15–60 秒短视频能在一个脚本中完成镜头确认、选片和轻剪辑；不引入多轨时间线或新的重排模型。原有视频修改能力继续负责画面内容变更，裁切只负责成片的起止时间，两者用途不同。

代码位于 `feat/short-video-director-workspace` 分支。主要提交：

- `2c3a547`：导演台与已有镜头流程整合。
- `c641f9a`：分镜预演、裁切、字幕、合片及 Agent 接口，并清理重复逻辑。
- `3821f62`：Agent REST 处理器的鉴权、版本锁与数据库集成测试。

## 已实现

1. 导演台按脚本镜头展示生成和 Ref2VA 修改版本，可预览并锁定合片采用的 take；镜头顺序与末帧接力沿用脚本流程。
2. 所有镜头选定首帧后，可用 FFmpeg 生成无声的静态分镜预演，不调用 H3。预演按脚本版本校验访问，删除脚本时清理对象。
3. 每镜可设置起止裁切和可修改的字幕时间码；从脚本台词可生成字幕草稿。字幕生成不做 ASR，也不保证和实际语音自动对齐。
4. 合片使用已选 take，应用裁切，并可选择烧录字幕。裁切和字幕进入合片任务指纹，修改后不会误用旧成片；原视频文件不变。
5. 脚本镜头的版本锁更新共用一处逻辑。普通脚本 PATCH 保留未显式改变的选片、裁切和字幕，避免远程 Agent 覆盖导演台状态。镜头编辑字段存于现有 JSON 列，无数据库迁移。

主要代码：`apps/media-hub/src/components/director-stage.tsx`、`apps/media-hub/src/routes/scripts.tsx`、`packages/api/src/router/media-hub/video-script.ts`、`video-script-assembly.ts`、`video-script-edit-plan.ts` 和 `video-script-render.ts`。

## 远程 Agent 接口

Bearer Token 鉴权；脚本更新使用最新 `GET /api/v1/scripts/{scriptId}` 返回的 `version`。完整请求结构见 `GET /api/openapi`。

| 操作       | 接口                                                               | 要点                                                                   |
| ---------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| 选定 take  | `PATCH /api/v1/scripts/{scriptId}/shots/{shotId}/take`             | `job_id`、`version`；只能选本人该镜已成功的任务                        |
| 裁切与字幕 | `PATCH /api/v1/scripts/{scriptId}/shots/{shotId}/edit-plan`        | `version`、可选的 `trim_start_seconds`、`trim_end_seconds`、`captions` |
| 字幕草稿   | `POST /api/v1/scripts/{scriptId}/shots/{shotId}/captions/generate` | `version`；用脚本台词覆盖该镜字幕草稿                                  |
| 分镜预演   | `POST /api/v1/scripts/{scriptId}/animatic`                         | 返回脚本版本及带鉴权的视频地址                                         |
| 合片       | `POST /api/v1/scripts/{scriptId}/assemble`                         | 可选 `{ "burn_captions": true }`；返回成片任务                         |

预演视频由 `GET /api/v1/scripts/{scriptId}/animatic/{version}/video` 读取；成片视频沿用 `GET /api/v1/generations/{jobId}/video`。

## 已验证与未验证

- `pnpm --filter @acme/api test`：26 个文件、105 项通过。
- `pnpm --filter @acme/media-hub test`：补测后 13 个文件、46 项通过；其中真实 REST 处理器验证了 Agent Token、版本冲突、字幕和选片落库。
- `pnpm build`、Media Hub 类型检查与 lint 通过；裁切、烧录字幕和静态预演经过实际 FFmpeg/ffprobe 测试。
- Chrome 自动化连接超时，未能在已登录页面逐项操作导演台。应用内浏览器确认 `/scripts` 可加载，但其独立会话停在登录页。因此 UI 实测仍是交接验收项，不能据上述测试推断没有浏览器问题。
- API 全量 lint 有 8 处此前存在、与本分支修改文件无关的报错；本次改动的 API 文件定向 lint 通过。

## 同事接手的验收步骤

1. 在已登录的 Chrome 打开本地或测试环境 `/scripts`；以 15 秒、30 秒和 60 秒脚本分别检查布局、镜头切换、错误提示和按钮禁用状态，并查看控制台及失败请求。
2. 选定每镜首帧后生成预演，核对顺序、比例和时长；修改脚本后确认旧版本预演不可继续播放。
3. 对一个已成功镜头制作 Ref2VA 修改版，预览原版与修改版，锁定其中一版；验证成片只采用锁定版本。
4. 设置裁切、从台词生成字幕并手动校正时间与文字，分别合成无字幕和烧录字幕版；核对音轨、字幕画面、成片时长及下载。
5. 用远程 Agent Token 按上表操作，验证过期 `version` 返回冲突、跨账号素材或 take 被拒绝。部署镜像中确认 `ffmpeg -filters` 包含 `subtitles`（libass）。

验收发现的问题应先修复再合并。当前分支尚未部署，也未因这份提案创建新的生产数据。
