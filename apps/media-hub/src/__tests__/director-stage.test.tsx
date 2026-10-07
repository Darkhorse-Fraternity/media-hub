// @vitest-environment jsdom
import type { ComponentProps } from "react";
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MediaVideoScriptShot } from "@acme/validators";

import { DirectorStage } from "../components/director-stage";

vi.mock("../components/video-edit-workspace", () => ({
  VideoEditWorkspace: (props: {
    sourceJobId: string;
    durationSeconds: number;
    sourceVideoUrl?: string;
    timelineSelection?: {
      startSeconds: number;
      endSeconds: number;
      timeOffset: number;
      onChange: (range: { start: number; end: number }) => void;
    };
    onBeforeCreate?: () => Promise<void>;
    onPendingChange?: (pending: boolean) => void;
  }) => (
    <div
      data-testid="segment-editor"
      data-source={props.sourceJobId}
      data-duration={props.durationSeconds}
      data-video={props.sourceVideoUrl}
      data-start={props.timelineSelection?.startSeconds}
      data-end={props.timelineSelection?.endSeconds}
      data-offset={props.timelineSelection?.timeOffset}
    >
      <button
        type="button"
        onClick={() => props.timelineSelection?.onChange({ start: 1, end: 4 })}
      >
        调整测试修改范围
      </button>
      <button type="button" onClick={() => props.onPendingChange?.(true)}>
        模拟开始提交
      </button>
      <button type="button" onClick={() => props.onPendingChange?.(false)}>
        模拟结束提交
      </button>
    </div>
  ),
}));
beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const initialShots: MediaVideoScriptShot[] = ["a", "b"].map((id) => ({
  id,
  title: id.toUpperCase(),
  durationSeconds: 5,
  visualDescription: "A shot",
  cameraDirection: "",
  continuity: "",
  soundscape: "",
  music: "N/A",
  dialogues: [],
  firstFrameAssetId: `frame-${id}`,
  captions: [
    { id: `cue-${id}`, startSeconds: 0, endSeconds: 2, text: `字幕${id}` },
  ],
}));

function Harness({
  onAssemble = vi.fn(),
  busy = false,
  assembledJob = null,
  cutEditJobs = [],
  onSave = vi.fn(),
  missingShotId,
}: {
  onAssemble?: (shots: MediaVideoScriptShot[], burnCaptions: boolean) => void;
  busy?: boolean;
  assembledJob?: ComponentProps<typeof DirectorStage>["assembledJob"];
  cutEditJobs?: ComponentProps<typeof DirectorStage>["cutEditJobs"];
  onSave?: ComponentProps<typeof DirectorStage>["onSaveShotEdit"];
  missingShotId?: string;
}) {
  const [shots, setShots] = useState(initialShots);
  const jobs = new Map(
    shots.map((shot) => [
      shot.id,
      [
        {
          id: `take-${shot.id}`,
          scriptShotId: shot.id,
          kind: "generate",
          status: shot.id === missingShotId ? "running" : "succeeded",
          title: shot.title,
          durationSeconds: 5,
          createdAt: new Date(),
          videoUrl: `/${shot.id}.mp4`,
          errorMessage: null,
          outputStorageKey: `${shot.id}.mp4`,
        },
      ],
    ]),
  );
  return (
    <DirectorStage
      shots={shots}
      onReorder={(from, to) =>
        setShots((items) => {
          const reordered = [...items];
          const [item] = reordered.splice(from, 1);
          if (item) reordered.splice(to, 0, item);
          return reordered;
        })
      }
      jobsByShot={jobs}
      assembledJob={assembledJob}
      cutEditJobs={cutEditJobs}
      language="zh"
      busy={busy}
      canAssemble
      onSelectTake={async () => {}}
      onGenerateShot={async () => {}}
      onEditCreated={async () => {}}
      onSaveShotEdit={onSave}
      onGenerateCaptions={async () => {}}
      onCreateAnimatic={async () => {}}
      animaticVideoUrl={null}
      onAssemble={async (burnCaptions) => {
        onAssemble(shots, burnCaptions);
      }}
      onChangeShotEdit={(id, patch) =>
        setShots((items) =>
          items.map((shot) => (shot.id === id ? { ...shot, ...patch } : shot)),
        )
      }
    />
  );
}

describe("director stage drafts and keyboard interaction", () => {
  it("holds the selected clip and edit range while submitting", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "修改选中片段" }));
    await user.click(screen.getByRole("button", { name: "模拟开始提交" }));
    for (const name of [
      "收起",
      "修改选中片段",
      "合成完整成片",
      "画面修改范围开始边界",
      "镜头 2：B",
    ]) {
      expect(
        (screen.getByRole("button", { name }) as HTMLButtonElement).disabled,
      ).toBe(true);
    }
    await user.click(screen.getByRole("button", { name: "模拟结束提交" }));
    expect(
      (screen.getByRole("button", { name: "收起" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });
  it("opens a selected clip edit directly and maps its range onto the global timeline", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "镜头 2：B" }));
    await user.click(screen.getByRole("button", { name: "修改选中片段" }));
    const editor = screen.getByTestId("segment-editor");
    expect(editor.getAttribute("data-source")).toBe("take-b");
    expect(editor.getAttribute("data-offset")).toBe("5");
    expect(editor.getAttribute("data-start")).toBe("0");
    expect(editor.getAttribute("data-end")).toBe("5");
    expect(screen.getByLabelText("修改范围轨道")).toBeTruthy();
    expect(screen.queryByLabelText("从第几秒开始")).toBeNull();
    await user.click(screen.getByRole("button", { name: "调整测试修改范围" }));
    expect(editor.getAttribute("data-start")).toBe("1");
    const range = screen.getByRole("button", {
      name: "画面修改范围",
    }).parentElement;
    expect(range?.style.left).toBe("60%");
    expect(range?.style.width).toBe("30%");
    await user.click(screen.getByRole("button", { name: "收起" }));
    expect(screen.queryByLabelText("修改范围轨道")).toBeNull();
    expect(screen.getByLabelText("从第几秒开始")).toBeTruthy();
  });

  it("disables direct editing until the selected clip has a completed source", () => {
    render(<Harness missingShotId="a" />);
    expect(
      (
        screen.getByRole("button", {
          name: "修改选中片段",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
  const cut = {
    id: "assembly-example",
    title: "完整成片",
    durationSeconds: 30,
    status: "succeeded",
    videoUrl: "/complete.mp4",
    isCurrent: true,
    captioned: false,
    errorMessage: null,
  };

  it("opens a segment editor for the full assembly with its actual duration", async () => {
    const user = userEvent.setup();
    render(<Harness assembledJob={cut} />);
    await user.selectOptions(screen.getByLabelText("预览版本"), cut.id);
    await user.click(screen.getByRole("button", { name: "按片段修改成片" }));
    const editor = screen.getByTestId("segment-editor");
    expect(editor.getAttribute("data-source")).toBe(cut.id);
    expect(editor.getAttribute("data-duration")).toBe("30");
    expect(editor.getAttribute("data-video")).toBe(cut.videoUrl);
  });

  it("previews and edits a completed cut revision without replacing its source assembly", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        assembledJob={cut}
        cutEditJobs={[
          {
            id: "edited-cut",
            scriptShotId: null,
            kind: "edit",
            status: "succeeded",
            title: "只改 12–16 秒",
            durationSeconds: 30,
            createdAt: new Date(),
            videoUrl: "/edited.mp4",
            errorMessage: null,
            outputStorageKey: "edited.mp4",
          },
        ]}
      />,
    );
    await user.selectOptions(screen.getByLabelText("预览版本"), cut.id);
    await user.selectOptions(screen.getByLabelText("预览版本"), "edited-cut");
    await user.click(screen.getByRole("button", { name: "按片段修改成片" }));
    expect(
      screen.getByTestId("segment-editor").getAttribute("data-source"),
    ).toBe("edited-cut");
    await user.click(screen.getByRole("button", { name: "对比原成片" }));
    expect(screen.queryByTestId("segment-editor")).toBeNull();
    await user.click(screen.getByRole("button", { name: "按片段修改成片" }));
    expect(
      screen.getByTestId("segment-editor").getAttribute("data-source"),
    ).toBe(cut.id);
  });

  it("keeps caption and trim edits across shot switches and passes them to assembly", async () => {
    const user = userEvent.setup();
    const assemble = vi.fn();
    render(<Harness onAssemble={assemble} />);
    await user.clear(screen.getByLabelText("字幕文字"));
    await user.type(screen.getByLabelText("字幕文字"), "修改后的字幕");
    await user.clear(screen.getByLabelText("从第几秒开始"));
    await user.type(screen.getByLabelText("从第几秒开始"), "1");
    await user.click(screen.getByRole("button", { name: "镜头 2：B" }));
    await user.click(screen.getByRole("button", { name: "镜头 1：A" }));
    expect((screen.getByLabelText("字幕文字") as HTMLInputElement).value).toBe(
      "修改后的字幕",
    );
    expect(
      (screen.getByLabelText("从第几秒开始") as HTMLInputElement).value,
    ).toBe("1");
    await user.click(screen.getByRole("button", { name: "合成完整成片" }));
    expect(assemble).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          id: "a",
          trimStartSeconds: 1,
          captions: [expect.objectContaining({ text: "修改后的字幕" })],
        }),
      ]),
      false,
    );
  });

  it("shows all clips in one timeline and supports keyboard selection", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.getAllByLabelText("视频轨道")).toHaveLength(1);
    expect(screen.getAllByLabelText("整片剪辑预览")).toHaveLength(1);
    const second = screen.getByRole("button", { name: "镜头 2：B" });
    second.focus();
    await user.keyboard("{Enter}");
    expect(second.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("heading", { name: "片段配置 · B" })).toBeTruthy();
    expect(
      (screen.getByLabelText("字幕开始秒数") as HTMLInputElement).value,
    ).toBe("5");
  });

  it("maps global seeks to trimmed sources and advances to the next clip", () => {
    render(<Harness />);
    let video = screen.getByLabelText("整片剪辑预览") as HTMLVideoElement;
    Object.defineProperty(video, "readyState", { value: 2 });
    fireEvent.change(screen.getByLabelText("从第几秒开始"), {
      target: { value: "1" },
    });
    fireEvent.change(screen.getByLabelText("到第几秒结束"), {
      target: { value: "3" },
    });
    fireEvent.loadedMetadata(video);
    expect(video.currentTime).toBe(1);
    fireEvent.change(screen.getByLabelText("时间轴播放位置"), {
      target: { value: "1.5" },
    });
    expect(video.currentTime).toBe(2.5);
    expect(screen.queryByLabelText("字幕预览")).toBeNull();
    video.currentTime = 3.1;
    fireEvent.timeUpdate(video);
    video = screen.getByLabelText("整片剪辑预览") as HTMLVideoElement;
    expect(video.getAttribute("src")).toBe("/b.mp4");
    fireEvent.loadedMetadata(video);
    expect(video.currentTime).toBe(0);
    fireEvent.change(screen.getByLabelText("时间轴播放位置"), {
      target: { value: "3.5" },
    });
    fireEvent.loadedMetadata(video);
    expect(video.currentTime).toBe(1.5);
    expect(screen.getByLabelText("字幕预览").textContent).toBe("字幕b");
  });

  it("reorders clips with their settings and exports the new composition", async () => {
    const user = userEvent.setup();
    const assemble = vi.fn();
    render(<Harness onAssemble={assemble} />);
    await user.click(screen.getByRole("button", { name: "后移片段" }));
    expect(screen.getByRole("button", { name: "镜头 1：B" })).toBeTruthy();
    expect(
      (screen.getByLabelText("字幕开始秒数") as HTMLInputElement).value,
    ).toBe("5");
    fireEvent.change(screen.getByLabelText("字幕开始秒数"), {
      target: { value: "6" },
    });
    await user.click(screen.getByRole("button", { name: "合成完整成片" }));
    expect(
      assemble.mock.calls[0]?.[0].map((shot: MediaVideoScriptShot) => shot.id),
    ).toEqual(["b", "a"]);
    expect(assemble.mock.calls[0]?.[0][1].captions[0].startSeconds).toBe(1);
  });

  it("continues playing across clip boundaries, stops at the end, and restarts the composition", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "播放整片" }));
    let video = screen.getByLabelText("整片剪辑预览") as HTMLVideoElement;
    video.currentTime = 5;
    fireEvent.timeUpdate(video);
    video = screen.getByLabelText("整片剪辑预览") as HTMLVideoElement;
    expect(video.getAttribute("src")).toBe("/b.mp4");
    fireEvent.loadedMetadata(video);
    expect(screen.getByRole("button", { name: "暂停整片" })).toBeTruthy();
    video.currentTime = 5;
    fireEvent.timeUpdate(video);
    expect(
      (screen.getByLabelText("时间轴播放位置") as HTMLInputElement).value,
    ).toBe("10");
    await user.click(screen.getByRole("button", { name: "播放整片" }));
    video = screen.getByLabelText("整片剪辑预览") as HTMLVideoElement;
    fireEvent.loadedMetadata(video);
    expect(video.getAttribute("src")).toBe("/a.mp4");
    expect(video.currentTime).toBe(0);
    await user.click(screen.getByRole("button", { name: "暂停整片" }));
  });

  it("keeps unfinished clips on the global timeline and explains why playback is unavailable", () => {
    render(<Harness missingShotId="b" />);
    fireEvent.change(screen.getByLabelText("时间轴播放位置"), {
      target: { value: "6" },
    });
    expect(screen.getByText("「B」尚未选定可播放的视频")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "播放整片" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.getByRole("button", { name: "镜头 2：B" })).toBeTruthy();
  });

  it("selects a subtitle for text editing and saves the timeline draft", async () => {
    const user = userEvent.setup();
    const save = vi.fn();
    render(<Harness onSave={save} />);
    await user.click(screen.getByRole("button", { name: "字幕：字幕a" }));
    expect(document.activeElement).toBe(screen.getByLabelText("字幕文字"));
    fireEvent.change(screen.getByLabelText("字幕开始秒数"), {
      target: { value: "1" },
    });
    fireEvent.change(screen.getByLabelText("字幕结束秒数"), {
      target: { value: "4" },
    });
    await user.click(screen.getByRole("button", { name: "保存剪辑与字幕" }));
    expect(save).toHaveBeenCalledWith("a", 0, 5, [
      expect.objectContaining({ startSeconds: 1, endSeconds: 4 }),
    ]);
  });

  it("blocks draft changes while a save or assembly is pending", async () => {
    const user = userEvent.setup();
    render(<Harness busy />);
    await user.type(screen.getByLabelText("字幕文字"), "不应写入");
    expect((screen.getByLabelText("字幕文字") as HTMLInputElement).value).toBe(
      "字幕a",
    );
    expect(
      (
        screen.getByRole("button", {
          name: "合成完整成片",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});
