// @vitest-environment jsdom
import { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { VideoEditWorkspace } from "../components/video-edit-workspace";

const { createEdit } = vi.hoisted(() => ({ createEdit: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({
  useMutation: () => ({ isPending: false, mutateAsync: createEdit }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("../lib/trpc", () => ({
  useTRPC: () => ({
    mediaHub: {
      generation: {
        createEdit: { mutationOptions: () => ({}) },
        list: { queryKey: () => [] },
      },
      ai: { optimizePrompt: { mutationOptions: () => ({}) } },
    },
  }),
}));
afterEach(cleanup);
beforeEach(() => createEdit.mockReset());

function openEditor() {
  render(
    <VideoEditWorkspace
      sourceJobId="assembly-source"
      sourceTitle="30秒成片"
      durationSeconds={30}
      sourceVideoUrl="/source.mp4"
      initialLanguage="zh"
      onCreated={vi.fn()}
    />,
  );
  return screen.getByLabelText("片段修改源视频") as HTMLVideoElement;
}

describe("director segment selection", () => {
  function TimelineEditor({
    beforeCreate = async () => {},
  }: {
    beforeCreate?: () => Promise<void>;
  }) {
    const [range, setRange] = useState({ start: 2, end: 8 });
    return (
      <VideoEditWorkspace
        sourceJobId="take-b"
        sourceTitle="镜头 B"
        durationSeconds={10}
        sourceVideoUrl="/b.mp4"
        initialLanguage="zh"
        onCreated={vi.fn()}
        onBeforeCreate={beforeCreate}
        timelineSelection={{
          startSeconds: range.start,
          endSeconds: range.end,
          minSeconds: 2,
          maxSeconds: 8,
          timeOffset: 10,
          currentTime: 13,
          onChange: setRange,
          onSeek: vi.fn(),
        }}
      />
    );
  }

  it("uses the shared timeline, submits source seconds, and preserves audio after locking the source", async () => {
    const user = userEvent.setup();
    const beforeCreate = vi.fn().mockResolvedValue(undefined);
    render(<TimelineEditor beforeCreate={beforeCreate} />);
    expect(screen.queryByLabelText("片段修改源视频")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /添加另一个时间片段/ }),
    ).toBeNull();
    await user.type(
      screen.getByLabelText("该片段修改描述"),
      "把红色杯子改成玻璃杯",
    );
    fireEvent.change(screen.getByLabelText("开始时间（整片秒）"), {
      target: { value: "13" },
    });
    fireEvent.change(screen.getByLabelText("结束时间（整片秒）"), {
      target: { value: "16" },
    });
    await user.click(screen.getByRole("button", { name: "提交修改任务" }));
    expect(beforeCreate).toHaveBeenCalledOnce();
    expect(beforeCreate.mock.invocationCallOrder[0]).toBeLessThan(
      createEdit.mock.invocationCallOrder[0]!,
    );
    expect(createEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceGenerationJobId: "take-b",
        segments: [
          expect.objectContaining({
            startSeconds: 3,
            endSeconds: 6,
            prompt: "把红色杯子改成玻璃杯",
            preserveSourceAudio: true,
          }),
        ],
      }),
    );
  });

  it("rejects ranges outside the selected clip before submitting a job", async () => {
    const user = userEvent.setup();
    render(<TimelineEditor />);
    await user.type(screen.getByLabelText("该片段修改描述"), "修改杯子");
    fireEvent.change(screen.getByLabelText("开始时间（整片秒）"), {
      target: { value: "10" },
    });
    await user.click(screen.getByRole("button", { name: "提交修改任务" }));
    expect(createEdit).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain("选中镜头范围内");
  });

  it("keeps the edit draft and does not create a job when the source lock fails", async () => {
    const user = userEvent.setup();
    render(
      <TimelineEditor
        beforeCreate={async () => {
          throw new Error("版本已更新，请重试");
        }}
      />,
    );
    await user.type(screen.getByLabelText("该片段修改描述"), "修改杯子");
    await user.click(screen.getByRole("button", { name: "提交修改任务" }));
    expect(createEdit).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe("版本已更新，请重试");
    expect(
      (screen.getByLabelText("该片段修改描述") as HTMLTextAreaElement).value,
    ).toBe("修改杯子");
  });
  it("uses playback positions to submit only the selected range with original audio", async () => {
    const user = userEvent.setup();
    const video = openEditor();
    video.currentTime = 12;
    fireEvent.timeUpdate(video);
    await user.click(screen.getByRole("button", { name: "当前帧设为开始" }));
    video.currentTime = 16;
    fireEvent.timeUpdate(video);
    await user.click(screen.getByRole("button", { name: "当前帧设为结束" }));
    await user.type(screen.getByLabelText("该片段修改描述"), "只把包改成蓝色");
    await user.click(screen.getByRole("button", { name: "提交修改任务" }));
    expect(createEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceGenerationJobId: "assembly-source",
        segments: [
          expect.objectContaining({
            startSeconds: 12,
            endSeconds: 16,
            prompt: "只把包改成蓝色",
            preserveSourceAudio: true,
            referenceImages: [],
          }),
        ],
      }),
    );
  });

  it("plays and stops at the selected segment boundary", async () => {
    const user = userEvent.setup();
    const video = openEditor();
    video.play = vi.fn().mockResolvedValue(undefined);
    video.pause = vi.fn();
    await user.click(screen.getByRole("button", { name: "播放选中片段" }));
    expect(video.currentTime).toBe(0);
    expect(video.play).toHaveBeenCalledOnce();
    video.currentTime = 5;
    act(() => fireEvent.timeUpdate(video));
    expect(video.pause).toHaveBeenCalledOnce();
  });
});
