// @vitest-environment jsdom
import type { ComponentProps } from "react";
import { useState } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MediaVideoScriptShot } from "@acme/validators";

import { DirectorStage } from "../components/director-stage";

vi.mock("../components/video-edit-workspace", () => ({
  VideoEditWorkspace: (props: {
    sourceJobId: string;
    durationSeconds: number;
    sourceVideoUrl?: string;
  }) => (
    <div
      data-testid="segment-editor"
      data-source={props.sourceJobId}
      data-duration={props.durationSeconds}
      data-video={props.sourceVideoUrl}
    />
  ),
}));
afterEach(cleanup);

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
}: {
  onAssemble?: (shots: MediaVideoScriptShot[], burnCaptions: boolean) => void;
  busy?: boolean;
  assembledJob?: ComponentProps<typeof DirectorStage>["assembledJob"];
  cutEditJobs?: ComponentProps<typeof DirectorStage>["cutEditJobs"];
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
          status: "succeeded",
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
      jobsByShot={jobs}
      assembledJob={assembledJob}
      cutEditJobs={cutEditJobs}
      language="zh"
      busy={busy}
      canAssemble
      onSelectTake={async () => {}}
      onGenerateShot={async () => {}}
      onEditCreated={async () => {}}
      onSaveShotEdit={async () => {}}
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
    await user.click(screen.getByRole("tab", { name: /完整成片/ }));
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
    await user.click(screen.getByRole("tab", { name: /完整成片/ }));
    await user.click(screen.getByRole("button", { name: "预览修改版" }));
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
    await user.click(screen.getByRole("tab", { name: /2\. B/ }));
    await user.click(screen.getByRole("tab", { name: /1\. A/ }));
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

  it("moves focus and selection with the arrow keys", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    act(() => screen.getByRole("tab", { name: /1\. A/ }).focus());
    await user.keyboard("{ArrowRight}");
    const second = screen.getByRole("tab", { name: /2\. B/ });
    expect(document.activeElement).toBe(second);
    expect(second.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel")).toBeTruthy();
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
