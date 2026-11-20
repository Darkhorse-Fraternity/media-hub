# Blender 白模参考生成部署记录

2026-10-15 已完成数据库、Media Hub API/worker 和 5090 Provider 的现场更新。单个镜头可选白模参考生成，其他镜头继续普通 H3 生成；通过脚本的有序任务 ID 合成为完整视频。真实 H3 参考生成成片尚未提交，空间与声音质量仍需在具体视频制作时验收。

## 已部署组件

| 组件          | 现场版本与位置                                                                                                   |
| ------------- | ---------------------------------------------------------------------------------------------------------------- |
| API / worker  | `local-test` 的 Swarm 服务 `media-hub-swarm_media-hub`，镜像 `pumpkii-media-hub:reference-previs-20261015`       |
| 镜像 SHA-256  | `13916654cc69173945934b573c799923992b835afd1ec6dc797daabbfedc64b6`                                               |
| Agent API     | `https://media-hub.test-xm.pumpkii.click:8880`，OpenAPI 1.9.0                                                    |
| 数据库        | `app_postgres` 的 `internal_tools`，迁移 `0026_h3_reference_generation`                                          |
| GPU Provider  | 5090 的 `ydc-generated-media-provider.service`；版本 `3.3-comfyui-h3-profile-registry+media-hub-refgen-20261015` |
| Ref2VA 工作流 | `platform-h3-ref2va-edit-v1`，`comfyui-h3-ref2va-pruned-int8-20step-v2`                                          |
| Blender       | 5090 的 `/home/a/.local/opt/blender-4.5.13-linux-x64`，入口 `/home/a/.local/bin/blender`                         |

数据库仅新增可空 JSONB 列 `media_generation_job.reference_video`。迁移前核对生产 0025 的 SQL 哈希，事务内执行新增列及 Drizzle 迁移记录写入；0026 的 SQL SHA-256 为 `0eea13086a5fd220d564272e198cff9163342041175a6d931b536d88c8c9c031`，账本时间戳为 `1792022400000`，现场记录 ID 为 27。旧任务和视频不改写。

API 的 `.output` 经生产构建后，替换在既有 Linux amd64 运行镜像中，保留原来的 FFmpeg、字体和运行依赖。构建上下文只有 Dockerfile 与构建产物，数据库备份不进入镜像。服务保留原有环境和网络，新增 `MEDIA_HUB_AGENT_PUBLIC_URL=https://media-hub.test-xm.pumpkii.click:8880`，修正反向代理后 OpenAPI 丢失公网端口的问题。Swarm 保持单副本、先停止旧任务再启动新任务，避免重复工作程序；更新失败自动回滚，稳定监测 30 秒。

Provider 基于现场源文件合并更新，保留 GPU Broker 接入、租约与显存释放屏障。除参考生成的参数、能力声明和执行路径外，补齐官方 I2V 在存在原生 AV 上下文时的首帧条件判断，使后镜首帧只锚定在上下文之后。ComfyUI 与 ASR 服务未替换。后续从仓库基线部署 Provider 时仍需保留现场 Broker 改动，不能直接覆盖整份现场文件。

## 使用入口

以下是需要保留指定动作或运镜的历史部署流程。只需参考白模构图或姿态时，按 [Media Hub 视频指引](../.Codex/skills/media-hub-video/SKILL.md#generate-from-white-modelprevis) 使用首帧。当前运动参考的帧数上限和成片时长见 [Agent API 说明](../.Codex/skills/media-hub-video/references/api.md#whole-video-reference-generation)。

1. 用 `.Codex/skills/blender-previs/scripts/previs.py render-remote SCENE.json OUTPUT_DIR` 在 5090 渲染，检查动画及采样帧。
2. 选取所需的短运镜片段，用项目 `media-hub-video` Skill 上传。用 `h3-prompt-writing` 的六字段参考提示词绑定代理物体与最终外观。
3. 向 `POST /api/v1/generations` 提交 `generation_mode: reference` 和 `reference_video`，并单独指定 5–15 秒的成片时长。
4. 混合分镜时，普通镜头通过 `shot_ids` 子集并显式使用 `continuity_mode: independent`；白模镜头独立生成，通过脚本 assemble 接口按顺序绑定成功任务并合成。

白模视频通过 Ref2VA 的整段视频输入提供运动、镜头与遮挡条件，代理音轨不保留。参考模式当前不继承上一镜的原生 AV 上下文。生成模型不能保证逐帧几何一致，仍需对照白模复核结果。

5090 的预演助手会拒绝预检时忙碌的 GPU，但尚未接入 GPU Broker 租约。应先完成所需 Blender 渲染，再提交 H3 任务；不能把预检当成跨服务的调度隔离。

## 已完成验证

- 本地 API、应用与存储相关测试及 Provider 图构建测试通过；包含整段视频参考、校验和变化、所有权、混合分镜合成、原生 AV 首帧锚定回归。类型检查、生产构建及所改生产 TypeScript 的 lint 通过。
- 合并后的现场 Provider 使用 5090 的真实服务虚拟环境运行全部 21 项单元测试通过。结构比较确认其余方法（含 Broker 执行封装及释放屏障）未改动。
- 5090 Blender 实际渲染成功：1344×768、24 FPS、124 帧、约 5.1667 秒、无音轨 H.264。下载校验和与 manifest 一致，并已检查动作与遮挡采样帧。样片 SHA-256：`d956b5e173b366b744a066035417692cf7fc34d3a550b34fd57326bcd0c09ca8`。
- 生产容器健康检查通过，Swarm 更新完成；公开 `/api/health` 和 `/api/openapi` 返回 200，API 1.9.0，server URL 包含 `:8880`。
- 一次性 member 身份通过公开 Bearer API 验证：`generation-profiles` 返回 healthy，Ref2VA 报告 `supportsReferenceVideo: true`，默认官方 I2V 仍报告 `supportsNativeAVContinuation: true`；任务列表返回 200。
- 缺少参考视频的参考生成请求返回 400，未创建任何生成任务。一次性身份与凭证已删除，现有用户的 API Token 未重置。日常制作统一使用 `server@growup.com` 专用凭证（`MEDIA_HUB_SERVER_AGENT_TOKEN` 或当前系统用户的 Keychain 服务 `media-hub-agent-token-server-growup`）；旧 Keychain 服务名的查询结果不能说明该凭证缺失。
- 本次部署没有提交真实 H3 生成任务。Blender 的成功渲染和接口验证不代表 H3 成片质量已验收。

同日补齐本机全局 Skill `~/.codex/skills/media-hub-video`，包含 API 调用助手、Blender 预演脚本与场景模板、六字段提示词和混合分镜合片说明。全局版与项目版的调用助手统一使用上述 server 专用认证，已通过其现有凭证实际查询线上能力；两处 Skill 格式校验、资源一致性及模板规划检查通过。

## 备份与回滚

部署前数据库自定义格式备份已经 `pg_restore --list` 校验，保存在 `local-test:/root/media-hub-releases/reference-20261015/before-reference.dump`，目录 700、备份 600。发布目录还保留迁移 SQL、镜像构建产物和可重复执行并自行清理身份的接口验证脚本。

5090 的 Provider 更新前快照：

- `/home/a/.local/share/media-hub-reference-20261015/provider-backup.py`
- `/home/a/.local/share/media-hub-reference-20261015/provider-config-backup.json`

旧 API 镜像 `pumpkii-media-hub:director-segment-edit-20261004` 保留。需要回滚时，先确认没有执行中的任务；若仍是本次服务更新的直接前一版本，可执行 `docker service rollback media-hub-swarm_media-hub`。若此后已有其他更新，应显式指定所需版本并检查环境差异，不能盲目回滚到未知历史。回滚应用时可保留新增可空列和迁移账本，不删除已产生的参考元数据，也不自动恢复整库备份。

Provider 回滚时只停止 `ydc-generated-media-provider.service`，将上述两份备份分别复制回 `/home/a/.local/share/ydc-h3-provider/apps/api/scripts/generated_media_comfyui_provider.py` 和 `/home/a/.config/ydc-provider/provider-h3.json`，再启动并检查健康。无需回滚 Blender 或重启 ComfyUI。
