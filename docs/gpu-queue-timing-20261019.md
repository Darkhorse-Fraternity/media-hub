# GPU 内存与队列计时修复

2026-10-19 11:57（北京时间）已完成生产更新。Swarm 服务
`media-hub-swarm_media-hub` 使用 `pumpkii-media-hub:queue-timing-20261019`，
镜像 SHA-256 为 `61f91f7dd0c07830e22bbdfa8f878573a2a498261ab7c6bb6a2794283b9ade15`。

## 原因与资源处理

5090 的 `/tmp` 为 tmpfs。23 个 10 月 8–12 日遗留的
`ydc-cross-build-work-*` 目录占据约 23 GiB；加上 H3 约 33 GiB 的进程内存，
导致 8 GiB Swap 耗尽。ComfyUI 在 11:14 和 11:32 被系统 OOM Killer 杀掉，
对应两镜失败。15 秒、1280×704、362 帧、20 步的一镜实测约 17 分钟，
Provider 使用单线程串行执行。

清理前核对活跃容器挂载、进程工作目录及文件句柄，未发现旧目录引用。
通过精确路径清单和隔离容器中的 `systemd-tmpfiles --remove` 清理上述 23 个目录。
保留当天较新的目录及所有视频生成目录。清理后 `/tmp` 从约 24 GiB 降到 1.3 GiB，
Swap 从 8 GiB 降到约 2.9 GiB。

编译探测脚本的 source/work 临时目录改用 `/data/ydc-worker-tmp`，经 `findmnt`
确认位于磁盘。现场脚本为
`5090:/home/a/.local/share/ydc-execution-worker/current/apps/api/scripts/probe_embedded_cross_build_profile.py`。
修改直接作用于后续启动的探测子进程，不需要重启当前 Worker。

为 Worker 的后续启动保存了
`~/.config/systemd/user/ydc-execution-worker.service.d/30-disk-tmp.conf`，
设置 `TMPDIR` 和 `YDC_CROSS_BUILD_TMPDIR` 为上述磁盘目录。仅执行 daemon-reload，
未重启 Worker。现场原脚本备份位于
`5090:~/.local/share/media-hub-queue-fix-20261019/probe_embedded_cross_build_profile.before.py`。

## 应用行为

- `started_at` 继续保存本次执行入队时间与 Provider 幂等身份。
- 新增可空列 `generation_started_at`，从首个 Provider 任务的 `started_at` 同步。
- 队列与视频列表分别显示排队、生成时间；缺少实际开始时间的历史任务使用“总耗时”。
- 排队预算为 24 小时，实际生成预算为 1 小时，按 Provider 的实际开始时间计算。
  已完成结果即使在重新连接时超过原等待期限，也可正常接收。
- 应用重启后接续保存的 Provider 子任务，复用已完成分段；不再取消和重新提交 GPU 工作。
- 任务 `01cc9f44-e640-427f-ab2b-468f01814a82` 被旧版总超时误判失败，
  其 Provider 任务 `gmjob_acf91a181939f34ac12446e16dfdd688` 已于 11:49 成功。
  通过精确条件恢复该任务的接收流程，11:57 入库为 succeeded，没有重新推理。

数据库迁移 `0027_generation_queue_timing` 仅新增可空时间列，事务内设置 3 秒锁等待上限。
Drizzle 账本 ID 为 28、时间戳为 `1792381739462`，SQL SHA-256 为
`f964be9add736fd854f6e18f0f3bb6035a5d78298d11c9022c331452e871aa01`。

## 验证与回退材料

5 项轮询/超时测试、7 项显示计时测试、10 项 PostgreSQL/REST 集成测试通过。
集成测试覆盖应用重启后复用已有 GPU 任务、没有 POST 取消或重新提交，以及排队超过一小时仍可成功接收。
API 和应用类型检查、所改生产代码 lint、格式检查及生产构建通过。

生产更新采用单副本 stop-first。更新后公网 health/OpenAPI 返回正常，容器 healthy，
Swarm 更新 completed。四个现有任务保持原 Provider ID，实际执行中的任务已同步真实开始时间。
ComfyUI PID 始终为 `98624`，启动时间仍为 11:32:09；部署后未发现取消/重复提交请求或新增 OOM。

发布材料位于 `local-test:/root/media-hub-releases/queue-timing-20261019/`，
包含经 `pg_restore --list` 验证的数据库备份（权限 600）、迁移、结果接续 SQL 和镜像构建材料。
旧镜像 `pumpkii-media-hub:reference-previs-20261015` 保留。

回退旧应用会恢复旧版取消并重排活跃任务的启动行为，因此有活跃生成时不要直接回退。
新增可空列可以保留，无需恢复数据库或删除新列。编译脚本备份和 Worker drop-in
可独立回退，但 `/tmp` 为内存盘，恢复原临时目录会重新引入内存风险。
