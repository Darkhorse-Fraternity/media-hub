// @vitest-environment jsdom
import type { ComponentProps } from "react";
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MediaVideoScriptShot } from "@acme/validators";

import { cutCaptionCues } from "../../../../packages/api/src/router/media-hub/video-script-edit-plan";
import { ShotEditControls } from "../components/shot-edit-controls";
import { CompositionTimeline } from "../components/shot-timeline";
import {
  captionTimelineLanes,
  compositionCaptions,
  compositionClips,
  compositionPosition,
  dragTimelineRange,
  previewCaptions,
} from "../lib/shot-timeline";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const initial: MediaVideoScriptShot = {
  id: "a",
  title: "测试",
  durationSeconds: 10,
  visualDescription: "",
  cameraDirection: "",
  continuity: "",
  soundscape: "",
  music: "",
  dialogues: [],
  captions: [{ id: "cue", startSeconds: 2, endSeconds: 4, text: "字幕" }],
};

function Harness({
  busy = false,
  initialShot = initial,
  onSave = async () => {},
}: {
  busy?: boolean;
  initialShot?: MediaVideoScriptShot;
  onSave?: ComponentProps<typeof ShotEditControls>["onSave"];
}) {
  const [shot, setShot] = useState(initialShot);
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <>
      <CompositionTimeline
        shots={[shot]}
        busy={busy}
        currentTime={0}
        selectedShotId={shot.id}
        selectedCaption={selected ? { shotId: shot.id, cueId: selected } : null}
        onSeek={() => {}}
        onSelectShot={() => {}}
        onSelectCaption={(_id, cueId) => setSelected(cueId)}
        onChange={(_id, patch) => setShot((value) => ({ ...value, ...patch }))}
      />
      <ShotEditControls
        shot={shot}
        busy={busy}
        onChange={(_id, patch) => setShot((value) => ({ ...value, ...patch }))}
        onSave={onSave}
        onGenerateCaptions={async () => {}}
        currentTime={0}
        compositionOffset={0}
        activeCaptionId={selected}
        onSelectCaption={setSelected}
        onSeek={() => {}}
      />
    </>
  );
}

function dragButton(name: string, delta: number, cancel = false) {
  const button = screen.getByRole("button", { name });
  fireEvent.pointerDown(button, { pointerId: 1, button: 0, clientX: 100 });
  fireEvent.pointerMove(button, { pointerId: 1, clientX: 100 + delta });
  if (cancel) fireEvent.pointerCancel(button, { pointerId: 1 });
  else fireEvent.pointerUp(button, { pointerId: 1 });
}

function enablePointers() {
  class TestPointerEvent extends MouseEvent {
    pointerId: number;
    constructor(type: string, options: PointerEventInit) {
      super(type, options);
      this.pointerId = options.pointerId ?? 0;
    }
  }
  vi.stubGlobal("PointerEvent", TestPointerEvent);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: 1000,
  } as DOMRect);
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
    value: vi.fn(),
    configurable: true,
  });
}

describe("shot timeline", () => {
  it("restores the original untrimmed subtitle data when a clipped cue drag is canceled", () => {
    enablePointers();
    const save = vi.fn().mockResolvedValue(undefined);
    render(
      <Harness
        initialShot={{ ...initial, trimStartSeconds: 3, trimEndSeconds: 7 }}
        onSave={save}
      />,
    );
    dragButton("字幕：字幕", 300, true);
    fireEvent.click(screen.getByRole("button", { name: "保存剪辑与字幕" }));
    expect(save).toHaveBeenCalledWith("a", 3, 7, initial.captions);
  });
  it("ripples downstream clips after trimming and reorders only on pointer release", () => {
    enablePointers();
    const reorder = vi.fn();
    function CompositionHarness() {
      const [shots, setShots] = useState([
        { ...initial, durationSeconds: 5 },
        { ...initial, id: "b", title: "第二镜", durationSeconds: 5 },
      ]);
      return (
        <CompositionTimeline
          shots={shots}
          busy={false}
          currentTime={0}
          selectedShotId="a"
          selectedCaption={null}
          onSeek={() => {}}
          onSelectShot={() => {}}
          onSelectCaption={() => {}}
          onReorder={reorder}
          onChange={(id, patch) =>
            setShots((items) =>
              items.map((shot) =>
                shot.id === id ? { ...shot, ...patch } : shot,
              ),
            )
          }
        />
      );
    }
    render(<CompositionHarness />);
    dragButton("镜头 1：测试结束边界", -100);
    const second = screen.getByRole("button", { name: "镜头 2：第二镜" });
    expect(
      Number.parseFloat(second.parentElement?.style.left ?? "0"),
    ).toBeCloseTo(44.44, 1);
    const first = screen.getByRole("button", { name: "镜头 1：测试" });
    fireEvent.pointerDown(first, { pointerId: 1, button: 0, clientX: 100 });
    fireEvent.pointerMove(first, { pointerId: 1, clientX: 900 });
    expect(reorder).not.toHaveBeenCalled();
    fireEvent.pointerUp(first, { pointerId: 1 });
    expect(reorder).toHaveBeenCalledWith(0, 1);
    reorder.mockClear();
    dragButton("镜头 1：测试", 800, true);
    expect(reorder).not.toHaveBeenCalled();
  });
  it("packs sequential subtitles together and separates overlapping cues", () => {
    expect(
      captionTimelineLanes([
        { id: "c", startSeconds: 4, endSeconds: 6, text: "第三句" },
        { id: "a", startSeconds: 0, endSeconds: 2, text: "第一句" },
        { id: "overlap", startSeconds: 1, endSeconds: 3, text: "重叠" },
        { id: "b", startSeconds: 2, endSeconds: 4, text: "第二句" },
      ]),
    ).toEqual([["a", "b", "c"], ["overlap"]]);
  });

  it("keeps a dragged cue mounted until release when it overlaps another cue", () => {
    enablePointers();
    render(
      <Harness
        initialShot={{
          ...initial,
          captions: [
            ...(initial.captions ?? []),
            { id: "second", startSeconds: 5, endSeconds: 7, text: "第二句" },
          ],
        }}
      />,
    );
    const button = screen.getByRole("button", { name: "字幕：字幕" });
    fireEvent.pointerDown(button, { pointerId: 1, button: 0, clientX: 100 });
    fireEvent.pointerMove(button, { pointerId: 1, clientX: 450 });
    expect(screen.getAllByLabelText("字幕轨道")).toHaveLength(1);
    fireEvent.pointerMove(button, { pointerId: 1, clientX: 500 });
    expect(
      (screen.getByLabelText("字幕开始秒数") as HTMLInputElement).value,
    ).toBe("6");
    fireEvent.pointerUp(button, { pointerId: 1 });
    expect(screen.getAllByLabelText("字幕轨道")).toHaveLength(2);
  });

  it("edits only the selected subtitle and retains the other cues", () => {
    render(
      <Harness
        initialShot={{
          ...initial,
          captions: [
            ...(initial.captions ?? []),
            { id: "second", startSeconds: 5, endSeconds: 7, text: "第二句" },
          ],
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "字幕：第二句" }));
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect((screen.getByLabelText("字幕文字") as HTMLInputElement).value).toBe(
      "第二句",
    );
    fireEvent.change(screen.getByLabelText("字幕文字"), {
      target: { value: "改好的第二句" },
    });
    fireEvent.change(screen.getByLabelText("选择字幕"), {
      target: { value: "cue" },
    });
    expect((screen.getByLabelText("字幕文字") as HTMLInputElement).value).toBe(
      "字幕",
    );
    fireEvent.change(screen.getByLabelText("选择字幕"), {
      target: { value: "second" },
    });
    expect((screen.getByLabelText("字幕文字") as HTMLInputElement).value).toBe(
      "改好的第二句",
    );
  });
  it("drags trim handles with a one-second minimum and updates the numeric controls", () => {
    enablePointers();
    render(<Harness />);
    dragButton("镜头 1：测试开始边界", 200);
    expect(
      (screen.getByLabelText("从第几秒开始") as HTMLInputElement).value,
    ).toBe("2");
    dragButton("镜头 1：测试结束边界", -1000);
    expect(
      (screen.getByLabelText("到第几秒结束") as HTMLInputElement).value,
    ).toBe("3");
  });

  it("moves captions without changing their duration, resizes them, and rolls back cancellation", () => {
    enablePointers();
    render(<Harness />);
    dragButton("字幕：字幕", 300);
    expect(
      (screen.getByLabelText("字幕开始秒数") as HTMLInputElement).value,
    ).toBe("5");
    expect(
      (screen.getByLabelText("字幕结束秒数") as HTMLInputElement).value,
    ).toBe("7");
    dragButton("字幕：字幕结束边界", 200);
    expect(
      (screen.getByLabelText("字幕结束秒数") as HTMLInputElement).value,
    ).toBe("9");
    dragButton("字幕：字幕开始边界", 100, true);
    expect(
      (screen.getByLabelText("字幕开始秒数") as HTMLInputElement).value,
    ).toBe("5");
  });

  it("blocks pointer edits while saving", () => {
    enablePointers();
    render(<Harness busy />);
    dragButton("镜头 1：测试开始边界", 200);
    expect(
      (screen.getByLabelText("从第几秒开始") as HTMLInputElement).value,
    ).toBe("0");
  });

  it("keeps dragged captions inside the source and snaps to tenths", () => {
    expect(
      dragTimelineRange({ start: 2, end: 4 }, 20, "move", 10, 0.1),
    ).toEqual({ start: 8, end: 10 });
    expect(
      dragTimelineRange({ start: 2, end: 4 }, -20, "move", 10, 0.1),
    ).toEqual({ start: 0, end: 2 });
    expect(
      dragTimelineRange({ start: 2, end: 4 }, 0.16, "start", 10, 0.1).start,
    ).toBe(2.2);
  });

  it("uses the same clipped cue intervals as FFmpeg export, including overlaps and discarded short cues", () => {
    const shot = {
      ...initial,
      trimStartSeconds: 3,
      trimEndSeconds: 7,
      captions: [
        { id: "left", startSeconds: 1, endSeconds: 4, text: "左侧" },
        { id: "overlap", startSeconds: 3.5, endSeconds: 8, text: "重叠" },
        { id: "short", startSeconds: 6.95, endSeconds: 9, text: "太短" },
        { id: "outside", startSeconds: 8, endSeconds: 9, text: "范围外" },
      ],
    };
    const exported = cutCaptionCues([shot]);
    for (const time of [3, 3.5, 4, 6.95, 7]) {
      expect(previewCaptions(shot, time).map((cue) => cue.text)).toEqual(
        exported
          .filter(
            (cue) => time - 3 >= cue.startSeconds && time - 3 < cue.endSeconds,
          )
          .map((cue) => cue.text),
      );
    }
  });
  it("maps all trimmed clips and subtitles to the same global offsets as export", () => {
    const first = { ...initial, trimStartSeconds: 3, trimEndSeconds: 7 };
    const second = {
      ...initial,
      id: "b",
      trimStartSeconds: 1,
      trimEndSeconds: 6,
    };
    const clips = compositionClips([first, second]);
    expect(clips.map(({ start, end }) => [start, end])).toEqual([
      [0, 4],
      [4, 9],
    ]);
    expect(compositionPosition(clips, 4)?.sourceTime).toBe(1);
    expect(compositionPosition(clips, 4)?.clip.shot.id).toBe("b");
    expect(compositionPosition(clips, 9)?.sourceTime).toBe(6);
    const cues = compositionCaptions(clips);
    expect(new Set(cues.map((cue) => cue.id)).size).toBe(2);
    expect(
      cues.map(({ startSeconds, endSeconds, text }) => ({
        startSeconds,
        endSeconds,
        text,
      })),
    ).toEqual(cutCaptionCues([first, second]));
    expect(compositionPosition([], 0)).toBeNull();
  });
});
