# 生成任务断线重连与手动重试修复

2026-11-04 18:05（北京时间），已更新 `local-test` 的
`media-hub-swarm_media-hub`，镜像为
`pumpkii-media-hub:retry-reconnect-20261104`，SHA-256 为
`6c56c016cf583584dfe67fe61442bd6e9aa73e0be7cbdcf87516a0cf0131a9d7`。

## 现场证据

12 个任务在 17:04 手动重试后均关联到新 Provider 任务，并持续等待 GPU。
旧 Provider 任务没有随之停止，其中多个实际已经生成成功。例如：

- Media Hub：`386e26e9-910a-4bf7-95e1-cec0507efd52`。
- 原 Provider：`gmjob_123a6e50e1ade027bc7a6210501bda8c`，17:09 成功。
- 重复 Provider：`gmjob_45b419dba1389bd813478f9e62494f89`，仍在排队。

逐项比较这批任务的完整 Provider 请求，除 `orchestration_run_id` 外参数完全一致。
9 个原任务仍可用，另外 3 个原任务明确以 `gpu_unavailable` 失败。
此前 Provider 日志也存在 GPU 清理失败和租约等待超时；本次确认并修复的是
Media Hub 在链路错误后丢弃原任务关联、重复提交及遗失已完成结果的问题。

## 修复行为

- 重试前查询原 Provider 任务。排队、运行或成功任务保留关联；无法确认状态时
  拒绝清空关联。仅对明确失败、取消或不存在的任务开启新执行。
- 多段视频保留已完成分段；保存当前分段时保留后续已知 Provider ID，避免再次
  重启时丢失关联。实际内容验收失败仍允许重新生成。
- 提交响应丢失时保留原执行时间，以相同幂等身份重放。手动接续后，Worker
  领取任务也保留该身份。编辑任务的新执行使用与生成任务一致的执行身份规则。
- 可重试的轮询链路错误允许最多约 5 分钟持续重连，之后仍保留原关联供重试。
  永久错误不进入重连循环；排队与推理预算继续分别计算。

## 任务恢复与上线

用户明确授权上传、部署、接回 9 个任务及取消对应重复任务后执行。
先验证 9 个原任务可用、对应新任务均仍排队，并备份数据库关联字段。
短暂停止 Media Hub 单个副本，取消精确清单中的 9 个重复排队任务，使用事务
恢复原 Provider ID 及执行时间，然后恢复单副本运行。事务要求 9 行全部匹配
原排队状态、当前 Provider ID、单元素 ID 列表和空输出，否则整体回滚。
3 个原任务已失败的任务保留现有新任务继续执行。

恢复后 7 个原视频已通过现有入库流程成为 `succeeded` 并保存视频；剩余
1 个任务生成中、4 个等待 GPU。公网 `/api/health` 正常，容器持续 healthy。
5090 Provider PID 仍为 `3015541`，没有重启 Provider 或 ComfyUI。

发布目录为 `local-test:/root/media-hub-releases/retry-reconnect-20261104/`，
包含镜像构建材料、`recover.sql`、`before-associations.json` 及
`recovery-plan.json`。本次没有数据库结构迁移。
旧镜像 `pumpkii-media-hub:queue-timing-20261019` 保留；若回退应用，保留已恢复的
原任务关联，不能把任务改回已取消的重复 Provider ID。

## 验证

141 项 API 测试、11 项隔离 PostgreSQL/REST 集成测试通过。
集成回归确认：链路失败后手动重试可接收原 GPU 结果，保留原 Provider ID
和执行时间，且没有 POST 新建或取消 Provider 任务。
API 与应用类型检查、相关生产代码 lint、格式检查及生产构建通过。
新 Linux 镜像中的业务 bundle 通过 Node 语法检查。

## 独立提交范围验证

提交仅包含任务重试、断线重连、分段关联保留及对应测试与本文记录。
参考视频功能、`generation_started_at` 数据库字段、界面计时和 Provider 配置等
既有未提交改动保留在原工作区。本次重试策略兼容没有独立生成计时字段的仓库基线。
在该基线的独立检出中，137 项 API 测试、8 项 PostgreSQL/REST 集成测试、
API 与应用类型检查、相关生产代码 lint 及生产构建通过。
