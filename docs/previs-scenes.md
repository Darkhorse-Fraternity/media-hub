# 轻量白模：场景和版本 API

Issue #12：场景创建与修正、版本、归档、复制、浏览器预览、异步批量 PNG/MP4、素材入库和视频引用。工作台入口为 `/previs`。固定使用 Crucible `0.20.0`；场景校验使用 CPU authoring API，服务端渲染通过受控 Chromium 软件渲染，不占用共享 GPU。

## 启用

部署应用前执行数据库迁移 `pnpm db:migrate`，包括 `0028_previs_scene_versions.sql` 和 `0029_previs_render_workbench.sql`。REST 请求沿用现有 Agent Bearer Token，场景、版本、批次、产物和素材按用户隔离。

完整接口描述由 `GET /api/openapi` 提供，版本为 `1.12.0`。同时提供 `mediaHub.previs` tRPC 路由，页面与 REST 共用业务服务。场景库分组和缩略图需额外应用 `0030_previs_scene_library.sql`。

服务端配置：

- `MEDIA_HUB_PREVIS_ENABLED=true`：默认开启；设为 `false` 暂停新入口及领取，不删除历史文件或引用。
- `MEDIA_HUB_PREVIS_WORKER_ENABLED=true`：在渲染实例开启；未设置时沿用通用生成 worker 开关。网页实例可以设为 `false`，共享同一数据库和 S3。
- `MEDIA_HUB_PREVIS_BROWSER`：可选 Chromium 可执行文件绝对路径。已验证本机 Chromium 159；Chromium 140/SwiftShader 存在 shader 兼容问题，部署需固定并验收浏览器版本。
- `MEDIA_HUB_PREVIS_CRUCIBLE_CLI`：可选固定包的 CLI 绝对路径，默认从安装包解析。生产构建包含 CLI、浏览器模块和资源。
- 沿用 `MEDIA_HUB_S3_*`、`FFMPEG_PATH`、`FFPROBE_PATH`。worker 需要 Chromium、FFmpeg/ffprobe，非 root 账户要能启动浏览器和写入私有临时目录。

Docker 默认镜像仅运行网页；可用 `--target previs-cpu` 构建独立 CPU 渲染实例，或在具备上述依赖的主机启动同一生产包。该镜像的实际 Chromium 版本也需在目标环境验收。当前没有生产 GPU 执行入口；开放 GPU 前需实现并验收 Broker 租约路径，不能直接改后端参数绕过调度。

## 接口

| 方法           | 路径                                             | 用途                                              |
| -------------- | ------------------------------------------------ | ------------------------------------------------- |
| GET / POST     | `/api/v1/previs`                                 | 列表 / 创建场景及初始版本                         |
| GET / POST     | `/api/v1/previs-groups`                          | 读取 / 创建白模分组                               |
| PATCH / DELETE | `/api/v1/previs-groups/{groupId}`                | 重命名 / 删除分组并保留场景                       |
| GET / PATCH    | `/api/v1/previs/{sceneId}`                       | 读取当前版本 / 修改名称、说明、归档状态或选中版本 |
| POST           | `/api/v1/previs/{sceneId}/thumbnail`             | 请求或重试当前版本的自动缩略图                    |
| GET / POST     | `/api/v1/previs/{sceneId}/revisions`             | 历史列表 / 创建新版本                             |
| POST           | `/api/v1/previs/{sceneId}/fork`                  | 从指定版本复制独立场景                            |
| GET            | `/api/v1/previs-revisions/{revisionId}`          | 读取指定版本                                      |
| GET            | `/api/v1/previs-revisions/{revisionId}/source`   | 下载包含 recipe、views、引擎版本和校验和的 JSON   |
| GET / POST     | `/api/v1/previs/{sceneId}/renders`               | 历史批次 / 创建异步渲染（202）                    |
| GET            | `/api/v1/previs-renders/{renderId}`              | 批次状态、计数和完成进度                          |
| GET            | `/api/v1/previs-renders/{renderId}/items`        | 有序条目、全部 attempt、错误和产物                |
| POST           | `/api/v1/previs-renders/{renderId}/cancel`       | 取消全部或指定未完成项                            |
| POST           | `/api/v1/previs-renders/{renderId}/retry`        | 重试失败、中断或取消项                            |
| POST           | `/api/v1/previs-renders/{renderId}/image-assets` | PNG 幂等加入现有素材库                            |
| GET            | `/api/v1/previs-artifacts/{artifactId}/download` | 鉴权下载，支持 MP4 Range                          |

列表支持 `page`、`page_size`；场景列表另支持 `search` 和 `status=active|archived|all`，默认仅列出未归档场景。

REST 请求的版本控制字段使用 `snake_case`，返回字段使用 `camelCase`。`recipe`、`operations` 和 `views` 内的字段保留 Crucible 原生拼写。创建、修改和复制返回 `{ scene, revision }`。

## 分组、简介和缩略图

每个场景可以归入一个具名分组，省略或设为 `null` 表示未分组。分组独立于场景版本；修改分组或简介不生成新的 recipe 版本。场景列表展示缩略图、名称、简介、分组和版本数，搜索同时匹配名称与简介。

- `GET / POST /api/v1/previs-groups`：读取分组及包含归档场景的 `sceneCount`，或提交 `{ "name": "客厅" }` 创建分组。同一用户的分组名称不能重复。
- `PATCH /api/v1/previs-groups/{groupId}`：提交 `{ "version": 1, "name": "室内客厅" }` 重命名。
- `DELETE /api/v1/previs-groups/{groupId}`：提交 `{ "version": 1 }` 删除分组。场景移至未分组，保留简介、缩略图、全部版本和文件；受影响的场景 `version` 会递增。
- 创建场景可以同时提交 `description` 和 `group_id`。已有场景通过 `PATCH /api/v1/previs/{sceneId}` 提交最新 `version`、`description` 和 `group_id`。列表可用 `group_id=分组UUID` 筛选，`group_id=ungrouped` 仅列出未分组场景，省略则列出全部分组。复制场景继承简介和分组，副本拥有独立的版本和自动缩略图。
- 自动缩略图为当前版本场景相机在初始时刻的 320×180 PNG。CPU worker 空闲时为新场景、新选定版本及旧场景补齐；同一版本只创建一个缩略图批次，沿用现有配额、心跳和取消/重试约束，普通批次列表不混入缩略图任务。worker 未启用时保留占位图。
- `POST /api/v1/previs/{sceneId}/thumbnail`：手动请求或重试当前版本的自动缩略图，返回 `202` 和可轮询批次。失败不会改变源版本，可显式重试。
- 从已渲染 PNG 选择封面：更新场景时提交 `thumbnail_artifact_id`，产物必须属于该用户的同一场景。返回 `thumbnailMode=manual`，后续保存或回退不会覆盖手选封面；设为 `null` 则恢复自动模式。
- 返回的 `thumbnailArtifactId` 可通过现有鉴权产物下载接口读取；`thumbnailRevisionId` 表示封面来源版本。自动缩略图完成只更新派生封面字段，不推进作者编辑使用的 `scene.version`，也不会覆盖手选封面。

## 创建并修改

创建：`POST /api/v1/previs`。可以省略 `recipe`，得到没有时长要求的空静态场景。

```json
{
  "title": "客厅机位",
  "recipe": {
    "format": "crucible.scene",
    "schemaVersion": 1,
    "geometries": [{ "id": "box", "type": "box", "bevel": 0 }],
    "materials": [{ "id": "grey", "color": [0.7, 0.7, 0.7] }],
    "nodes": [
      {
        "id": "sofa",
        "geometry": "box",
        "material": "grey",
        "translation": [0, 0.5, 0],
        "scale": [2, 1, 0.8]
      }
    ],
    "camera": { "eye": [4, 3, 5], "target": [0, 0.5, 0] }
  }
}
```

保存返回的 `scene.id` 和 `revision.id`。随后请求 `POST /api/v1/previs/{sceneId}/revisions`：

```json
{
  "parent_revision_id": "上一步的 revision.id",
  "operations": [
    { "type": "set-node", "id": "sofa", "translation": [1, 0.5, 0] }
  ],
  "message": "沙发向右移动一米",
  "set_current": true,
  "expected_head_revision_id": "上一步的 scene.headRevisionId"
}
```

ID 字段必须替换为实际 UUID。每次保存都新增不可变版本；`recipe` 全量替换与 `operations` 原子修改必须二选一。可修改对象、相机、基础材质和简单运动，也可增删对象、几何体和材质。一组操作全部成功才保存，失败不改变场景或历史。

不传 `set_current` 时仅创建分支版本。`set_current=true` 使用预期当前版本 ID 做并发比较，冲突返回 `409`，重新读取场景后再决定如何处理。

`views` 保存最多 8 个具有稳定 ID 的相机视图。新版本省略 `views` 会继承父版本，传 `[]` 清空。

具名视图使用固定相机，并覆盖场景的相机运动轨道；物体动作仍按时间采样。选择“场景相机”则保留原运镜。浏览器预览与服务端渲染遵守同一规则。

## 回退与复用

读取场景取得最新 `scene.version` 和 `scene.headRevisionId`，再请求 `PATCH /api/v1/previs/{sceneId}`：

```json
{
  "version": 2,
  "head_revision_id": "要选中的历史 revision.id",
  "expected_head_revision_id": "刚读取的 scene.headRevisionId"
}
```

回退只切换当前版本指针，保留全部历史。所有场景修改都推进 `scene.version`，包括新增分支；修改名称、归档和恢复同样必须提交最新 `version`。

从任意历史版本继续修正：将其 ID 用作新版本的 `parent_revision_id`。复制为独立场景：请求 `POST /api/v1/previs/{sceneId}/fork`，提交 `{ "revision_id": "实际 UUID", "title": "新场景名称" }`。副本有独立历史，并记录来源版本。

源码下载返回 `{ engineVersion, schemaVersion, recipe, views, checksum }`。重新导入时，把其中的 `recipe` 和 `views` 放入创建场景或新版本的请求体，其他字段用于核对来源。归档不会删除源码或版本；创建新版本前需恢复场景。

## 约束与重试

- 基础几何体支持 box、sphere、cylinder；最多 64 个节点、32 个几何体、32 个材质、64 条编辑操作；规范化文档不超过 256 KiB。
- 坐标单位为米，Y 轴向上，旋转使用 XYZW 四元数；可选运动最长 30 秒。对象引用、相机和运动由实际引擎校验。
- 创建场景、新版本和副本支持可选 `Idempotency-Key` 请求头。同一用户的键在这些操作间共享；相同键和请求返回原有版本及当前场景元数据，不同请求复用键返回 `409`。
- 版本选择必须属于同一场景。不存在或无权访问的资源返回 `404`；归档后新增版本返回 `412`；非法场景或请求返回 `400`。

## 批量渲染与产物

`POST /api/v1/previs/{sceneId}/renders`，返回 `202` 和批次 ID：

```json
{
  "revision_id": "实际版本 UUID",
  "output_type": "image",
  "profile": "standard",
  "view_ids": ["front", "side"],
  "frames": [1, 25, 49, 73, 97],
  "timeline_fps": 24,
  "width": 896,
  "height": 512
}
```

按照请求中视图顺序，再按采样帧顺序展开为 10 项。每项交给一个独立引擎任务，因此不受 Crucible 单次最多 8 张 stills 的限制。空 `view_ids` 使用场景相机，省略 `frames` 采样初始状态。场景修改不会改变批次固定的 revision 和规格。

视频使用 `output_type=video`、`fps`、`start_seconds`、`duration_seconds`。`profile=preview` 用于低像素预算预览；普通视频不套用 H3 帧网格。`profile=h3_reference` 仅支持 24 FPS、5–15 整数名义秒，5 秒直接渲染 124 帧，实际时长约 5.166667 秒。若帧网格超过非循环动作的结尾，执行器显式延长动作时长并保持最后姿态，记录 `motionPaddingSeconds`，不修改源版本。实际 MP4 通过 ffprobe 验证编码、尺寸、帧率、帧数和时长；产物还包含引擎版本、实际参数、checksum 和来源 attempt。

轮询批次和 `/items`。条目状态为 `queued|running|succeeded|failed|canceled|interrupted`；批次有成功项和失败项时为 `partial`。`completed` 表示终态数，具体成功数见 `counts.succeeded`。

取消或重试请求可以提交 `{ "item_ids": ["条目 UUID"] }`，省略表示全部符合条件的项。取消执行中的任务需等待引擎停止后变为终态；成功项保留且不会被重试。每次执行保留独立 attempt。进程心跳超时会标记为 interrupted，本地 stdio 引擎不可续跑，需要显式重试；旧 fencing token 不能上传后发布成有效产物。取消和失败会清理自有进程及临时文件，未发布的 S3 对象会清理。

配额：每批最多 64 项，每用户最多 128 个待处理项，每帧最多 2073600 像素，单产物最多 50 MB，累计产物与待处理项预留预算最多 8 GB，每项最多 10 次执行。CPU worker 每实例串行领取，数据库行锁防止多个实例重复领取。

加入素材库请求为 `{ "artifact_ids": ["PNG 产物 UUID"] }`。重复请求复用同一素材 ID；从素材库隐藏后再次加入会恢复原素材。素材包含白模来源关系，后续 AI 图片任务继续由图片模块创建。

## 视频与分镜引用

`POST /api/v1/generations` 支持 `generation_mode=reference` 和 `reference_artifact_id`，与原 `reference_video` 二选一；仍使用原六字段参考提示词和实际媒体校验。已创建任务保存文件校验和及 artifact/revision 来源。

分镜的 `reference_artifact_id` 与 `first_frame_asset_id` 二选一。引用白模视频的脚本使用 `continuity_mode=independent`，可混合普通镜头；服务端按镜头选择基础/参考工作流并编译对应提示词。生成完成后沿用原合成接口。导演台提供产物 ID 输入框，白模工作台可复制 ID。

所有白模产物采用独立 attempt 路径，没有删除产物接口。场景归档、回退或后续修改不删除已有文件，图片和视频历史输入继续有效。素材库隐藏仅设置 deletedAt，不物理删除共享产物。

## 自测

`pnpm test` 包含真实 PostgreSQL 的场景/批次集成测试，以及并发、幂等、失败重试、取消、过期执行隔离和素材引用测试。

完整闭环自测先执行 `pnpm build`，再设置实际 Chromium 路径执行：

```sh
MEDIA_HUB_PREVIS_BROWSER=/absolute/path/to/chromium pnpm test:previs-smoke
```

设置 `PREVIS_SMOKE_DEMO=living-room` 可验证 23 个节点的客厅白模，包含沙发、茶几、墙面、移动主体和相机运动，实际输出 896×512 图片及视频。该样例沿用相同的接口、素材入库和分镜引用检查。输出目录还会保存可重新导入的 `scene-source.json` 和产物元数据 `render-artifacts.json`。

需要本机 Docker。脚本启动并清理临时 PostgreSQL 17、MinIO、生产 HTTP 服务、Provider 能力桩和浏览器上下文，真实渲染 10 张 PNG、124 帧 H3 MP4，核验 checksum/下载/重复入库，验证视频与分镜固定引用，并用浏览器修改场景、保存新版本和生成桌面/手机截图。不会提交 H3 或 AI 图片推理。报告和实际媒体默认保存在 `/private/tmp/media-hub-previs-smoke-*`，可通过 `PREVIS_SMOKE_OUTPUT` 指定目录。
