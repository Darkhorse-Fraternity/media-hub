import type { inferRouterOutputs } from "@trpc/server";
import { useLayoutEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import type { MediaHubAppRouter } from "@acme/api";

import { useTRPC } from "~/lib/trpc";

type Outputs = inferRouterOutputs<MediaHubAppRouter>["mediaHub"]["previs"];
type Groups = Outputs["groups"]["items"];
const field =
  "w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-sky-300 focus:outline-none";
const button =
  "rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:border-sky-300 disabled:opacity-40";

export function PrevisGroupControls({
  groups,
  value,
  onChange,
  onMessage,
}: {
  groups: Groups;
  value: string;
  onChange: (id: string) => void;
  onMessage: (message: string) => void;
}) {
  const trpc = useTRPC(),
    queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [rename, setRename] = useState("");
  const selected = groups.find((group) => group.id === value);
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: trpc.mediaHub.previs.pathKey() });
  const create = useMutation(
    trpc.mediaHub.previs.createGroup.mutationOptions({
      onSuccess: async ({ group }) => {
        setName("");
        onChange(group.id);
        onMessage("分组已创建");
        await refresh();
      },
      onError: (error) => onMessage(error.message),
    }),
  );
  const update = useMutation(
    trpc.mediaHub.previs.updateGroup.mutationOptions({
      onSuccess: async () => {
        setRename("");
        onMessage("分组已重命名");
        await refresh();
      },
      onError: (error) => onMessage(error.message),
    }),
  );
  const remove = useMutation(
    trpc.mediaHub.previs.deleteGroup.mutationOptions({
      onSuccess: async () => {
        onChange("ungrouped");
        onMessage("分组已删除，场景已移至未分组");
        await refresh();
      },
      onError: (error) => onMessage(error.message),
    }),
  );
  return (
    <div className="mt-5 grid gap-2 border-t border-slate-800 pt-4">
      <label className="grid gap-2 text-xs text-slate-400">
        按分组浏览
        <select
          aria-label="分组筛选"
          className={field}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
            setRename("");
          }}
        >
          <option value="all">全部分组</option>
          <option value="ungrouped">未分组</option>
          {groups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name} · {group.sceneCount}
            </option>
          ))}
        </select>
      </label>
      <details className="rounded-lg border border-slate-800 p-3 text-xs text-slate-400">
        <summary className="cursor-pointer">管理分组</summary>
        <form
          className="mt-3 grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate({ name });
          }}
        >
          <input
            aria-label="新分组名称"
            className={field}
            placeholder="例如：客厅、产品展示"
            required
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <button
            className={button}
            disabled={create.isPending || !name.trim()}
          >
            新建分组
          </button>
        </form>
        {selected && (
          <form
            className="mt-4 grid gap-2 border-t border-slate-800 pt-3"
            onSubmit={(event) => {
              event.preventDefault();
              update.mutate({
                id: selected.id,
                version: selected.version,
                name: rename,
              });
            }}
          >
            <input
              aria-label="分组新名称"
              className={field}
              placeholder={selected.name}
              required
              maxLength={80}
              value={rename}
              onChange={(event) => setRename(event.target.value)}
            />
            <button
              className={button}
              disabled={update.isPending || !rename.trim()}
            >
              重命名分组
            </button>
            <button
              type="button"
              className={button}
              disabled={remove.isPending}
              onClick={() =>
                remove.mutate({ id: selected.id, version: selected.version })
              }
            >
              删除分组，保留场景
            </button>
          </form>
        )}
      </details>
    </div>
  );
}

export function PrevisSceneMetadata({
  scene,
  groups,
  metadataDirtyRef,
  pending,
  onSave,
  onMessage,
}: {
  scene: Outputs["get"]["scene"];
  groups: Groups;
  metadataDirtyRef: { current: boolean };
  pending: boolean;
  onSave: (changes: {
    description?: string;
    groupId?: string | null;
    thumbnailArtifactId?: string | null;
  }) => Promise<boolean>;
  onMessage: (message: string) => void;
}) {
  const [descriptionDraft, setDescriptionDraft] = useState<string>();
  const [groupDraft, setGroupDraft] = useState<string>();
  const description = descriptionDraft ?? scene.description;
  const groupId = groupDraft ?? scene.groupId ?? "";
  const descriptionChanged = description !== scene.description;
  const groupChanged = groupId !== (scene.groupId ?? "");
  const dirty = descriptionChanged || groupChanged;
  useLayoutEffect(() => {
    metadataDirtyRef.current = dirty;
    return () => {
      metadataDirtyRef.current = false;
    };
  }, [dirty, metadataDirtyRef]);
  const trpc = useTRPC(),
    queryClient = useQueryClient();
  const thumbnail = useMutation(
    trpc.mediaHub.previs.thumbnail.mutationOptions({
      onSuccess: async () => {
        onMessage("缩略图任务已提交，完成后自动显示");
        await queryClient.invalidateQueries({
          queryKey: trpc.mediaHub.previs.pathKey(),
        });
      },
      onError: (error) => onMessage(error.message),
    }),
  );
  return (
    <section
      aria-label="场景复用信息"
      className="mb-5 grid gap-4 rounded-xl border border-slate-800 bg-slate-900/40 p-4 md:grid-cols-[200px_minmax(0,1fr)]"
    >
      <div>
        {scene.thumbnailArtifactId ? (
          <img
            className="aspect-video w-full rounded-lg bg-slate-800 object-contain"
            src={`/api/media-hub/previs-artifacts/${scene.thumbnailArtifactId}`}
            alt={`${scene.title}的场景缩略图`}
            width={320}
            height={180}
          />
        ) : (
          <div className="grid aspect-video place-items-center rounded-lg border border-dashed border-slate-700 text-xs text-slate-500">
            等待生成缩略图
          </div>
        )}
        <p className="mt-2 text-xs text-slate-500">
          {scene.thumbnailMode === "manual"
            ? "已选用自定义封面"
            : scene.thumbnailRevisionId === scene.headRevisionId
              ? "当前版本 · 自动缩略图"
              : "自动缩略图待更新"}
        </p>
        {scene.thumbnailMode === "manual" ? (
          <button
            className={`${button} mt-2 w-full text-xs`}
            disabled={pending}
            onClick={() => void onSave({ thumbnailArtifactId: null })}
          >
            使用自动缩略图
          </button>
        ) : (
          <button
            className={`${button} mt-2 w-full text-xs`}
            disabled={thumbnail.isPending || !!scene.archivedAt}
            onClick={() => thumbnail.mutate({ id: scene.id })}
          >
            生成或重试缩略图
          </button>
        )}
      </div>
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!dirty) return;
          void onSave({
            description: descriptionChanged ? description : undefined,
            groupId: groupChanged ? groupId || null : undefined,
          }).then((saved) => {
            if (!saved) return;
            setDescriptionDraft((current) =>
              current === descriptionDraft ? undefined : current,
            );
            setGroupDraft((current) =>
              current === groupDraft ? undefined : current,
            );
          });
        }}
      >
        <label className="grid gap-2 text-xs text-slate-400">
          场景简介
          <textarea
            aria-label="场景简介"
            className={`${field} min-h-24 resize-y`}
            placeholder="说明场景用途、适用镜头和复用方式"
            maxLength={2000}
            value={description}
            onChange={(event) => setDescriptionDraft(event.target.value)}
          />
        </label>
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid min-w-40 flex-1 gap-2 text-xs text-slate-400">
            所属分组
            <select
              aria-label="场景所属分组"
              className={field}
              value={groupId}
              onChange={(event) => setGroupDraft(event.target.value)}
            >
              <option value="">未分组</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </label>
          <button className={button} disabled={pending || !dirty}>
            保存简介与分组
          </button>
        </div>
      </form>
    </section>
  );
}
