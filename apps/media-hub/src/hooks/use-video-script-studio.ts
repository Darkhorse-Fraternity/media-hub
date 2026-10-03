import type { FormEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import type {
  MediaVideoScriptContinuityBible,
  MediaVideoScriptShot,
} from "@acme/validators";
import {
  analyzeMediaVideoScriptShots,
  mediaVideoScriptShotSchema,
  selectMediaVideoScriptTake,
} from "@acme/validators";

import type {
  CopyStatus,
  QualityPreset,
  ScriptLanguage,
  ScriptTargetDuration,
} from "~/lib/video-script-studio-state";
import { useTRPC } from "~/lib/trpc";
import { EMPTY_CONTINUITY_BIBLE } from "~/lib/video-script-studio-state";
import { useScriptWorkflow } from "./use-script-workflow";

export function useVideoScriptStudio(initialScriptId?: string) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [selectedScriptId, setSelectedScriptId] = useState<string | null>(
    initialScriptId ?? null,
  );
  const hydratedScriptIdRef = useRef<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newBrief, setNewBrief] = useState("");
  const [targetDuration, setTargetDuration] =
    useState<ScriptTargetDuration>(30);
  const [language, setLanguage] = useState<ScriptLanguage>("zh");
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [copy, setCopy] = useState("");
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("draft");
  const [width, setWidth] = useState(1344);
  const [height, setHeight] = useState(768);
  const [defaultProfile, setDefaultProfile] = useState("");
  const [continuityBible, setContinuityBible] =
    useState<MediaVideoScriptContinuityBible>(EMPTY_CONTINUITY_BIBLE);
  const [shots, setShots] = useState<MediaVideoScriptShot[]>([]);
  const [version, setVersion] = useState(1);
  const [dirty, setDirty] = useState(false);
  const [selectedShotIds, setSelectedShotIds] = useState<string[]>([]);
  const [qualityPreset, setQualityPreset] = useState<QualityPreset>("balanced");
  const [message, setMessage] = useState<string | null>(null);
  const { run: runWorkflow, pending: workflowPending } =
    useScriptWorkflow(setMessage);
  const [animaticVideoUrl, setAnimaticVideoUrl] = useState<string | null>(null);

  const scriptQuery = useQuery({
    ...trpc.mediaHub.script.get.queryOptions({
      id: selectedScriptId ?? "none",
    }),
    enabled: Boolean(selectedScriptId),
    refetchInterval: (query) =>
      query.state.data?.shotJobs.some((job) =>
        ["scheduled", "queued", "waiting_for_gpu", "running"].includes(
          job.status,
        ),
      ) ||
      query.state.data?.assembledJob?.status === "running" ||
      query.state.data?.shotFrameCandidates.jobs.some((job) =>
        ["queued", "running"].includes(job.status),
      )
        ? 5_000
        : false,
  });
  const healthQuery = useQuery(
    trpc.mediaHub.generation.providerHealth.queryOptions(undefined, {
      retry: false,
    }),
  );
  const imageQuery = useQuery(
    trpc.mediaHub.image.list.queryOptions({ limit: 100 }),
  );

  const applyScript = useCallback(
    (script: {
      title: string;
      brief: string;
      copy: string;
      copyStatus: string;
      language: string;
      width: number;
      height: number;
      defaultProfile: string | null;
      continuityBible: MediaVideoScriptContinuityBible;
      shots: MediaVideoScriptShot[];
      version: number;
    }) => {
      setTitle(script.title);
      setBrief(script.brief);
      setCopy(script.copy);
      setCopyStatus(script.copyStatus === "approved" ? "approved" : "draft");
      setLanguage(script.language === "en" ? "en" : "zh");
      setWidth(script.width);
      setHeight(script.height);
      setDefaultProfile(script.defaultProfile ?? "");
      setContinuityBible(script.continuityBible);
      setShots(script.shots);
      setVersion(script.version);
      setDirty(false);
      setSelectedShotIds([]);
      setAnimaticVideoUrl(null);
    },
    [],
  );

  useEffect(() => {
    if (!initialScriptId || hydratedScriptIdRef.current === initialScriptId) {
      return;
    }
    let canceled = false;
    void queryClient
      .fetchQuery(
        trpc.mediaHub.script.get.queryOptions({ id: initialScriptId }),
      )
      .then((script) => {
        if (canceled) return;
        applyScript(script);
        hydratedScriptIdRef.current = script.id;
      })
      .catch((error: unknown) => {
        if (canceled) return;
        setMessage(error instanceof Error ? error.message : "读取脚本失败");
      });
    return () => {
      canceled = true;
    };
  }, [applyScript, initialScriptId, queryClient, trpc]);

  const refreshScripts = async (id?: string) => {
    await queryClient.invalidateQueries({
      queryKey: trpc.mediaHub.script.list.queryKey(),
    });
    if (id) {
      await queryClient.invalidateQueries({
        queryKey: trpc.mediaHub.script.get.queryKey({ id }),
      });
    }
  };

  const createMutation = useMutation(
    trpc.mediaHub.script.create.mutationOptions(),
  );
  const draftMutation = useMutation(
    trpc.mediaHub.script.draft.mutationOptions(),
  );
  const updateMutation = useMutation(
    trpc.mediaHub.script.update.mutationOptions(),
  );
  const deleteMutation = useMutation(
    trpc.mediaHub.script.delete.mutationOptions(),
  );
  const generateMutation = useMutation(
    trpc.mediaHub.script.generate.mutationOptions(),
  );
  const assembleMutation = useMutation(
    trpc.mediaHub.script.assemble.mutationOptions(),
  );
  const bridgeMutation = useMutation(
    trpc.mediaHub.script.bridgeLastFrame.mutationOptions(),
  );
  const createFrameCandidatesMutation = useMutation(
    trpc.mediaHub.script.createFrameCandidates.mutationOptions(),
  );
  const selectFrameCandidateMutation = useMutation(
    trpc.mediaHub.script.selectFrameCandidate.mutationOptions(),
  );
  const selectTakeMutation = useMutation(
    trpc.mediaHub.script.selectTake.mutationOptions(),
  );
  const generateCaptionsMutation = useMutation(
    trpc.mediaHub.script.generateCaptions.mutationOptions(),
  );
  const createAnimaticMutation = useMutation(
    trpc.mediaHub.script.createAnimatic.mutationOptions(),
  );

  const generating =
    workflowPending ||
    draftMutation.isPending ||
    createMutation.isPending ||
    updateMutation.isPending ||
    generateMutation.isPending ||
    assembleMutation.isPending ||
    bridgeMutation.isPending ||
    createFrameCandidatesMutation.isPending ||
    selectFrameCandidateMutation.isPending ||
    selectTakeMutation.isPending ||
    generateCaptionsMutation.isPending ||
    createAnimaticMutation.isPending;
  const generationProfiles = (healthQuery.data?.profiles ?? []).filter(
    (profile) => profile.kind === "generate",
  );
  const assets = imageQuery.data?.assets ?? [];
  const totalDuration = shots.reduce(
    (total, shot) => total + shot.durationSeconds,
    0,
  );
  const scriptIssues = analyzeMediaVideoScriptShots(shots);
  const jobsByShot = new Map<
    string,
    NonNullable<typeof scriptQuery.data>["shotJobs"]
  >();
  for (const job of scriptQuery.data?.shotJobs ?? []) {
    if (!job.scriptShotId) continue;
    const list = jobsByShot.get(job.scriptShotId) ?? [];
    list.push(job);
    jobsByShot.set(job.scriptShotId, list);
  }
  const allShotsSucceeded =
    shots.length > 0 &&
    shots.every((shot) => {
      const jobs = jobsByShot.get(shot.id) ?? [];
      return (
        Boolean(selectMediaVideoScriptTake(shot, jobs)) &&
        mediaVideoScriptShotSchema.safeParse(shot).success
      );
    });

  const markDirty = () => {
    setDirty(true);
    setAnimaticVideoUrl(null);
  };
  const updateShot = (id: string, patch: Partial<MediaVideoScriptShot>) => {
    setShots((current) =>
      current.map((shot) => (shot.id === id ? { ...shot, ...patch } : shot)),
    );
    markDirty();
  };
  const moveShot = (index: number, offset: -1 | 1) => {
    const target = index + offset;
    if (target < 0 || target >= shots.length) return;
    setShots((current) => {
      const next = [...current];
      const [shot] = next.splice(index, 1);
      if (shot) next.splice(target, 0, shot);
      return next;
    });
    markDirty();
  };
  const removeShot = (id: string) => {
    setShots((current) => current.filter((shot) => shot.id !== id));
    setSelectedShotIds((current) => current.filter((value) => value !== id));
    markDirty();
  };
  const addDialogue = (shot: MediaVideoScriptShot) => {
    updateShot(shot.id, {
      dialogues: [
        ...shot.dialogues,
        {
          id: crypto.randomUUID(),
          atSeconds: Math.min(2, shot.durationSeconds - 0.5),
          speakerId: "S1",
          language,
          text: "",
        },
      ],
    });
  };

  const createBlank = async () => {
    return runWorkflow(async () => {
      if (!newTitle.trim() || !newBrief.trim()) {
        setMessage("先填写标题和创作简报。");
        return;
      }

      const script = await createMutation.mutateAsync({
        title: newTitle.trim(),
        brief: newBrief.trim(),
        copy: "",
        copyStatus: "draft",
        language,
        continuityBible: EMPTY_CONTINUITY_BIBLE,
        shots: [],
      });
      setNewTitle("");
      setNewBrief("");
      await refreshScripts(script.id);
      await navigate({
        to: "/scripts/$scriptId",
        params: { scriptId: script.id },
      });
    }, "创建脚本失败");
  };

  const createFromBrief = async () => {
    return runWorkflow(async () => {
      if (!newBrief.trim()) {
        setMessage("先填写创作简报。");
        return;
      }
      setMessage("正在把简报拆成可生成的 H3 镜头…");

      const draft = await draftMutation.mutateAsync({
        title: newTitle.trim() || undefined,
        brief: newBrief.trim(),
        language,
        targetDurationSeconds: targetDuration,
      });
      const script = await createMutation.mutateAsync({
        title: newTitle.trim() || draft.title,
        brief: newBrief.trim(),
        copy: draft.copy,
        copyStatus: "draft",
        language,
        continuityBible: draft.continuityBible,
        shots: draft.shots,
      });
      setNewTitle("");
      setNewBrief("");
      await refreshScripts(script.id);
      await navigate({
        to: "/scripts/$scriptId",
        params: { scriptId: script.id },
      });
    }, "AI 拆镜失败");
  };

  const persistScript = async (
    requestedCopyStatus: CopyStatus = copyStatus,
    expectedVersion = version,
  ) => {
    if (!selectedScriptId) throw new Error("请先选择脚本");
    const updated = await updateMutation.mutateAsync({
      id: selectedScriptId,
      version: expectedVersion,
      title,
      brief,
      copy,
      copyStatus: requestedCopyStatus,
      language,
      width,
      height,
      defaultProfile: defaultProfile || undefined,
      continuityBible,
      shots,
    });
    setVersion(updated.version);
    setCopyStatus(updated.copyStatus === "approved" ? "approved" : "draft");
    setDirty(false);
    await refreshScripts(selectedScriptId);
    return updated;
  };

  const approveCopy = async () => {
    return runWorkflow(async () => {
      if (!copy.trim()) {
        setMessage("请先填写文案，再确认进入首帧制作。");
        return;
      }

      const saved = dirty ? await persistScript("draft") : null;
      const approved = await persistScript(
        "approved",
        saved?.version ?? version,
      );
      setCopyStatus("approved");
      setVersion(approved.version);
      await refreshScripts(selectedScriptId ?? undefined);
      setMessage("文案已确认，可以逐镜生成首帧候选。");
    }, "确认文案失败");
  };

  const createFrameCandidates = async (shotId: string) => {
    return runWorkflow(async () => {
      if (!selectedScriptId) return;

      if (dirty) await persistScript();
      await createFrameCandidatesMutation.mutateAsync({
        id: selectedScriptId,
        shotId,
        outputCount: 4,
      });
      await refreshScripts(selectedScriptId);
      setMessage("4 张首帧候选已进入 HiDream 队列。");
    }, "首帧生成失败");
  };

  const selectFrameCandidate = async (shotId: string, assetId: string) => {
    return runWorkflow(async () => {
      if (!selectedScriptId) return;

      const saved = dirty ? await persistScript() : null;
      const updated = await selectFrameCandidateMutation.mutateAsync({
        id: selectedScriptId,
        shotId,
        assetId,
        version: saved?.version ?? version,
      });
      applyScript(updated);
      await refreshScripts(selectedScriptId);
      await queryClient.invalidateQueries({
        queryKey: trpc.mediaHub.image.list.queryKey(),
      });
      setMessage("已选定这个镜头的首帧。");
    }, "选择首帧失败");
  };

  const saveScript = async (event?: FormEvent) => {
    event?.preventDefault();
    return runWorkflow(async () => {
      await persistScript();
      setMessage("脚本已保存。");
    }, "保存脚本失败");
  };

  const generateShots = async (shotId?: string) => {
    return runWorkflow(async () => {
      if (!selectedScriptId || shots.length === 0) return;

      if (dirty) await persistScript();
      const result = await generateMutation.mutateAsync({
        id: selectedScriptId,
        shotIds: shotId ? [shotId] : selectedShotIds,
        qualityPreset,
        h3Profile: defaultProfile || undefined,
      });
      setSelectedShotIds([]);
      await refreshScripts(selectedScriptId);
      await queryClient.invalidateQueries({
        queryKey: trpc.mediaHub.generation.list.queryKey(),
      });
      setMessage(`${result.jobs.length} 个镜头已进入 GPU 队列。`);
    }, "镜头生成失败");
  };

  const selectTake = async (shotId: string, jobId: string) => {
    return runWorkflow(async () => {
      if (!selectedScriptId) return;

      const saved = dirty ? await persistScript() : null;
      const updated = await selectTakeMutation.mutateAsync({
        id: selectedScriptId,
        shotId,
        jobId,
        version: saved?.version ?? version,
      });
      applyScript(updated);
      await refreshScripts(selectedScriptId);
      setMessage("已选定合片采用的镜头版本。");
    }, "选择镜头版本失败");
  };

  const saveShotEdit = async () => {
    return runWorkflow(async () => {
      await persistScript();
      setMessage("镜头裁切与字幕已保存，成片需要重新合成。");
    }, "保存镜头编辑失败");
  };

  const generateShotCaptions = async (shotId: string) => {
    return runWorkflow(async () => {
      if (!selectedScriptId) return;

      const saved = dirty ? await persistScript() : null;
      const updated = await generateCaptionsMutation.mutateAsync({
        id: selectedScriptId,
        shotId,
        version: saved?.version ?? version,
      });
      applyScript(updated);
      await refreshScripts(selectedScriptId);
      setMessage("已根据逐字台词生成字幕，请校对时间和文字。");
    }, "生成字幕失败");
  };

  const createAnimatic = async () => {
    return runWorkflow(async () => {
      if (!selectedScriptId) return;

      if (dirty) await persistScript();
      const preview = await createAnimaticMutation.mutateAsync({
        id: selectedScriptId,
      });
      setAnimaticVideoUrl(preview.videoUrl);
      setMessage("分镜预演已生成，可在导演台播放。");
    }, "生成分镜预演失败");
  };

  const assembleVideo = async (burnCaptions = false) => {
    return runWorkflow(async () => {
      if (!selectedScriptId) return;

      if (dirty) await persistScript();
      const result = await assembleMutation.mutateAsync({
        id: selectedScriptId,
        burnCaptions,
      });
      await refreshScripts(selectedScriptId);
      await queryClient.invalidateQueries({
        queryKey: trpc.mediaHub.generation.list.queryKey(),
      });
      setMessage(
        result.status === "succeeded"
          ? "完整成片已合成，并已创建可发布草稿。"
          : result.status === "canceled"
            ? "合片已取消或脚本已更新，请重新合成。"
            : "完整成片正在合成。",
      );
    }, "完整成片合成失败");
  };

  const deleteScript = async () => {
    return runWorkflow(async () => {
      if (!selectedScriptId) {
        return;
      }

      await deleteMutation.mutateAsync({ id: selectedScriptId });
      setSelectedScriptId(null);
      hydratedScriptIdRef.current = null;
      setDirty(false);
      await refreshScripts();
      await navigate({ to: "/scripts/history" });
    }, "删除脚本失败");
  };

  const bridgeLastFrame = async (sourceShotId: string) => {
    return runWorkflow(async () => {
      if (!selectedScriptId) return;

      const saved = dirty ? await persistScript() : null;
      const result = await bridgeMutation.mutateAsync({
        id: selectedScriptId,
        sourceShotId,
        version: saved?.version ?? version,
      });
      applyScript(result);
      await refreshScripts(selectedScriptId);
      await queryClient.invalidateQueries({
        queryKey: trpc.mediaHub.image.list.queryKey(),
      });
      setMessage("已把末帧存入图片素材，并设为下一镜首帧。");
    }, "末帧接力失败");
  };

  return {
    selectedScriptId,
    newTitle,
    setNewTitle,
    newBrief,
    setNewBrief,
    targetDuration,
    setTargetDuration,
    language,
    setLanguage,
    title,
    setTitle,
    brief,
    setBrief,
    copy,
    setCopy,
    copyStatus,
    setCopyStatus,
    width,
    setWidth,
    height,
    setHeight,
    defaultProfile,
    setDefaultProfile,
    continuityBible,
    setContinuityBible,
    shots,
    setShots,
    dirty,
    selectedShotIds,
    setSelectedShotIds,
    qualityPreset,
    setQualityPreset,
    message,
    setMessage,
    animaticVideoUrl,
    scriptQuery,
    healthQuery,
    refreshScripts,
    deleteMutation,
    bridgeMutation,
    generating,
    generationProfiles,
    assets,
    totalDuration,
    scriptIssues,
    jobsByShot,
    allShotsSucceeded,
    markDirty,
    updateShot,
    moveShot,
    removeShot,
    addDialogue,
    createBlank,
    createFromBrief,
    approveCopy,
    createFrameCandidates,
    selectFrameCandidate,
    saveScript,
    generateShots,
    selectTake,
    saveShotEdit,
    generateShotCaptions,
    createAnimatic,
    assembleVideo,
    deleteScript,
    bridgeLastFrame,
  };
}
