// @vitest-environment jsdom
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
