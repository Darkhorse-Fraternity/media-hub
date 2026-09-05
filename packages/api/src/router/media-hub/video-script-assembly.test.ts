import { describe, expect, it } from "vitest";

import type { ScriptShotAssemblyJob } from "./video-script-assembly-core";
import { selectLatestScriptShotJobs } from "./video-script-assembly-core";

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
});
