import { describe, expect, it } from "vitest";

import type { MediaVideoScriptShot } from "@acme/db/schema";

import type { ScriptShotAssemblyJob } from "./video-script-assembly-core";
import {
  scriptAssemblyJobId,
  selectLatestScriptShotJobs,
} from "./video-script-assembly-core";

function job(
  id: string,
  shotId: string | null,
  status: string,
  kind = "generate",
): ScriptShotAssemblyJob {
  return {
    id,
    scriptShotId: shotId,
    status,
    kind,
    outputStorageKey: status === "succeeded" ? `${id}.mp4` : null,
  };
}

describe("video script assembly", () => {
  it("selects the latest successful shot in script order", () => {
    const selected = selectLatestScriptShotJobs(
      ["shot-a", "shot-b"],
      [
        job("new-b", "shot-b", "succeeded"),
        job("assembly", null, "succeeded", "assemble"),
        job("new-a", "shot-a", "succeeded"),
        job("old-a", "shot-a", "succeeded"),
      ],
    );
    expect(selected?.map((item) => item.id)).toEqual(["new-a", "new-b"]);
  });

  it("does not fall back to an older shot after the latest attempt failed", () => {
    expect(
      selectLatestScriptShotJobs(
        ["shot-a"],
        [
          job("failed-a", "shot-a", "failed"),
          job("old-a", "shot-a", "succeeded"),
        ],
      ),
    ).toBeNull();
  });

  it("uses the director's selected successful take even after a newer attempt fails", () => {
    const selected = selectLatestScriptShotJobs(
      ["shot-a"],
      [
        job("failed-a", "shot-a", "failed"),
        job("approved-a", "shot-a", "succeeded"),
      ],
      { "shot-a": "approved-a" },
    );
    expect(selected?.map((item) => item.id)).toEqual(["approved-a"]);
  });

  it("rejects a selected take from another shot", () => {
    expect(
      selectLatestScriptShotJobs(
        ["shot-a"],
        [job("other", "shot-b", "succeeded")],
        { "shot-a": "other" },
      ),
    ).toBeNull();
  });

  it("invalidates the cut for trim and caption changes without changing the source take", () => {
    const shot: MediaVideoScriptShot = {
      id: "shot-a",
      title: "开场",
      durationSeconds: 10,
      visualDescription: "A steady shot",
      cameraDirection: "",
      continuity: "",
      soundscape: "",
      music: "N/A",
      dialogues: [],
    };
    const plain = scriptAssemblyJobId("script", ["take-a"], [shot], false);
    const trimmed = { ...shot, trimStartSeconds: 1 };
    const trimmedId = scriptAssemblyJobId(
      "script",
      ["take-a"],
      [trimmed],
      false,
    );
    const captioned = {
      ...trimmed,
      captions: [{ id: "cue", startSeconds: 2, endSeconds: 4, text: "你好" }],
    };
    expect(trimmedId).not.toBe(plain);
    expect(scriptAssemblyJobId("script", ["take-a"], [captioned], false)).toBe(
      trimmedId,
    );
    expect(
      scriptAssemblyJobId("script", ["take-a"], [captioned], true),
    ).not.toBe(trimmedId);
    expect(
      scriptAssemblyJobId("script", ["take-b"], [captioned], true),
    ).not.toBe(scriptAssemblyJobId("script", ["take-a"], [captioned], true));
  });
});
