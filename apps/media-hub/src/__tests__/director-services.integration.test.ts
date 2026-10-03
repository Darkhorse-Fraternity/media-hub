import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { db as applicationDb } from "@acme/db/client";
import type { MediaVideoScriptShot } from "@acme/validators";
import { and, eq } from "@acme/db";
import {
  mediaApiToken,
  mediaGenerationJob,
  mediaImageAsset,
  mediaTask,
  mediaVideoScript,
  user,
} from "@acme/db/schema";

import { configureTestDockerHost } from "./helpers/postgres";

const mocks = vi.hoisted(() => ({
  cut: vi.fn(),
  preview: vi.fn(),
  get: vi.fn(),
  put: vi.fn(),
  remove: vi.fn(),
  removePrefix: vi.fn(),
  notify: vi.fn(),
}));
vi.mock("@acme/storage", async (original) => ({
  ...(await original<typeof import("@acme/storage")>()),
  getMediaHubObject: mocks.get,
  putMediaHubObject: mocks.put,
  deleteMediaHubObject: mocks.remove,
  deleteMediaHubObjectsByPrefix: mocks.removePrefix,
}));
vi.mock(
  "../../../../packages/api/src/router/media-hub/video-script-render",
  () => ({ renderScriptCut: mocks.cut, renderScriptAnimatic: mocks.preview }),
);
vi.mock(
  "../../../../packages/api/src/router/media-hub/generation-output-validation",
  async (original) => ({
    ...(await original<
      typeof import("../../../../packages/api/src/router/media-hub/generation-output-validation")
    >()),
    validateGeneratedVideoOutput: vi.fn(),
  }),
);
vi.mock(
  "../../../../packages/api/src/router/media-hub/generation-notification",
  async (original) => ({
    ...(await original<
      typeof import("../../../../packages/api/src/router/media-hub/generation-notification")
    >()),
    deliverGenerationResultNotification: mocks.notify,
  }),
);

const ownerId = "director-service-owner";
const otherId = "director-service-other";
const agentToken = "mh_agent_director_service_test_token";
let database: typeof applicationDb;
let container: StartedPostgreSqlContainer | undefined;
let assemble: (typeof import("../../../../packages/api/src/router/media-hub/video-script-assembly"))["assembleCompletedVideoScript"];
let createAnimatic: (typeof import("../../../../packages/api/src/router/media-hub/video-script-animatic"))["createScriptAnimatic"];
let caller: Awaited<
  ReturnType<(typeof import("../lib/agent-api"))["createAgentApiCaller"]>
>["caller"];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function fixture(takeOwner = ownerId) {
  const id = crypto.randomUUID();
  const takeId = crypto.randomUUID();
  const frameId = `${id}-frame`;
  const shot: MediaVideoScriptShot = {
    id: "one",
    title: "Opening",
    durationSeconds: 5,
    visualDescription: "Blue frame",
    cameraDirection: "",
    continuity: "",
    soundscape: "",
    music: "N/A",
    dialogues: [],
    firstFrameAssetId: frameId,
    selectedGenerationJobId: takeId,
    trimStartSeconds: 1,
    trimEndSeconds: 4,
    captions: [{ id: "cue", startSeconds: 1, endSeconds: 3, text: "你好" }],
  };
  await database.insert(mediaImageAsset).values({
    id: frameId,
    storageKey: `${frameId}.png`,
    filename: "frame.png",
    contentType: "image/png",
    sizeBytes: 10,
    checksum: id,
    origin: "upload",
    ownerUserId: ownerId,
  });
  await database.insert(mediaVideoScript).values({
    id,
    title: "Director service test",
    brief: "A test",
    shots: [shot],
    width: 160,
    height: 96,
    createdBy: ownerId,
  });
  await database.insert(mediaGenerationJob).values({
    id: takeId,
    scriptId: id,
    scriptShotId: shot.id,
    prompt: "A test",
    durationSeconds: 5,
    width: 160,
    height: 96,
    status: "succeeded",
    outputStorageKey: `${takeId}.mp4`,
    createdBy: takeOwner,
  });
  return { id, takeId, frameId, shot };
}

async function jobsFor(id: string) {
  return database.query.mediaGenerationJob.findMany({
    where: and(
      eq(mediaGenerationJob.scriptId, id),
      eq(mediaGenerationJob.kind, "assemble"),
    ),
  });
}

describe("director services with real PostgreSQL", () => {
  beforeAll(async () => {
    configureTestDockerHost();
    container = await new PostgreSqlContainer(
      process.env.TEST_POSTGRES_IMAGE ?? "postgres:17",
    ).start();
    process.env.POSTGRES_URL = container.getConnectionUri();
    process.env.NODE_ENV = "development";
    process.env.APP_URL = "http://director.test";
    process.env.AUTH_SECRET = "director-integration-test-secret";
    process.env.MEDIA_HUB_CRYPTO_KEY = Buffer.alloc(32, 7).toString("base64");
    database = (await import("@acme/db/client")).db;
    await migrate(database, {
      migrationsFolder: fileURLToPath(
        new URL("../../../../packages/db/drizzle", import.meta.url),
      ),
    });
    await database.insert(user).values(
      [ownerId, otherId].map((id) => ({
        id,
        name: id,
        email: `${id}@test.invalid`,
        emailVerified: true,
        role: "member",
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    );
    await database.insert(mediaApiToken).values({
      id: "director-test-token",
      label: "Test",
      tokenHash: createHash("sha256").update(agentToken).digest("hex"),
      tokenEnc: "not-used",
      createdBy: ownerId,
    });
    assemble = (
      await import("../../../../packages/api/src/router/media-hub/video-script-assembly")
    ).assembleCompletedVideoScript;
    createAnimatic = (
      await import("../../../../packages/api/src/router/media-hub/video-script-animatic")
    ).createScriptAnimatic;
    caller = (
      await (
        await import("../lib/agent-api")
      ).createAgentApiCaller(
        new Request("http://director.test", {
          headers: { authorization: `Bearer ${agentToken}` },
        }),
      )
    ).caller;
  }, 120_000);

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.get.mockResolvedValue(Buffer.from("source"));
    mocks.cut.mockResolvedValue(Buffer.from("cut"));
    mocks.preview.mockResolvedValue(Buffer.from("preview"));
    mocks.put.mockResolvedValue(undefined);
    mocks.remove.mockResolvedValue(undefined);
    mocks.removePrefix.mockResolvedValue(undefined);
    mocks.notify.mockResolvedValue(undefined);
  });

  afterAll(async () => {
    try {
      await database?.$client.end({ timeout: 5 });
    } finally {
      await container?.stop();
    }
  });

  it("retries cleanup after soft deletion and rejects another owner's script", async () => {
    const f = await fixture();
    mocks.removePrefix.mockRejectedValueOnce(new Error("storage offline"));
    await expect(caller.mediaHub.script.delete({ id: f.id })).rejects.toThrow(
      "storage offline",
    );
    expect(
      (
        await database.query.mediaVideoScript.findFirst({
          where: eq(mediaVideoScript.id, f.id),
        })
      )?.deletedAt,
    ).toBeTruthy();
    await expect(caller.mediaHub.script.delete({ id: f.id })).resolves.toEqual({
      ok: true,
    });
    expect(mocks.removePrefix).toHaveBeenCalledWith(
      `media-hub/animatics/${ownerId}/${f.id}/`,
    );
    await database
      .update(mediaVideoScript)
      .set({ createdBy: otherId })
      .where(eq(mediaVideoScript.id, f.id));
    await expect(
      caller.mediaHub.script.delete({ id: f.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.removePrefix).toHaveBeenCalledTimes(2);
  });

  it("keeps a newer retry intact while an old canceled attempt finishes", async () => {
    const f = await fixture();
    const entered = deferred<void>();
    const release = deferred<Buffer>();
    mocks.cut.mockImplementationOnce(() => {
      entered.resolve();
      return release.promise;
    });
    const first = assemble({ scriptId: f.id, userId: ownerId }, database);
    await entered.promise;
    const job = (await jobsFor(f.id))[0]!;
    await database
      .update(mediaGenerationJob)
      .set({ status: "canceled" })
      .where(eq(mediaGenerationJob.id, job.id));
    const retry = assemble({ scriptId: f.id, userId: ownerId }, database);
    for (let count = 0; count < 100; count++) {
      const current = (await jobsFor(f.id))[0]!;
      if (
        current.status === "running" &&
        current.startedAt!.getTime() !== job.startedAt!.getTime()
      )
        break;
      await new Promise((done) => setTimeout(done, 5));
    }
    release.resolve(Buffer.from("old attempt"));
    expect((await first)?.status).toBe("canceled");
    const result = await retry;
    expect(result?.status).toBe("succeeded");
    expect((await jobsFor(f.id))[0]?.mediaTaskId).toBe(result?.mediaTaskId);
    expect(mocks.put).toHaveBeenCalledOnce();
    expect(
      (
        await database.query.mediaVideoScript.findFirst({
          where: eq(mediaVideoScript.id, f.id),
        })
      )?.status,
    ).toBe("completed");
  });

  it("claims one render for concurrent requests and publishes one draft", async () => {
    const f = await fixture();
    const entered = deferred<void>();
    const release = deferred<Buffer>();
    mocks.cut.mockImplementationOnce(() => {
      entered.resolve();
      return release.promise;
    });
    const first = assemble(
      { scriptId: f.id, userId: ownerId, requireReady: true },
      database,
    );
    await entered.promise;
    expect(
      (await assemble({ scriptId: f.id, userId: ownerId }, database))?.status,
    ).toBe("running");
    release.resolve(Buffer.from("cut"));
    const completed = await first;
    expect(completed?.status).toBe("succeeded");
    expect(mocks.cut).toHaveBeenCalledTimes(1);
    expect(
      await database.query.mediaTask.findMany({
        where: eq(mediaTask.id, completed!.mediaTaskId!),
      }),
    ).toHaveLength(1);
  });

  it("does not revive a canceled job or create a publish draft", async () => {
    const f = await fixture();
    const entered = deferred<void>();
    const release = deferred<Buffer>();
    mocks.cut.mockImplementationOnce(() => {
      entered.resolve();
      return release.promise;
    });
    const pending = assemble({ scriptId: f.id, userId: ownerId }, database);
    await entered.promise;
    const [job] = await jobsFor(f.id);
    await database
      .update(mediaGenerationJob)
      .set({ status: "canceled" })
      .where(eq(mediaGenerationJob.id, job!.id));
    release.resolve(Buffer.from("cut"));
    expect((await pending)?.status).toBe("canceled");
    expect((await jobsFor(f.id))[0]?.status).toBe("canceled");
    expect((await jobsFor(f.id))[0]?.mediaTaskId).toBeNull();
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it("keeps an edited script ready instead of marking it completed", async () => {
    const f = await fixture();
    mocks.cut.mockImplementationOnce(async () => {
      await database
        .update(mediaVideoScript)
        .set({ version: 2, status: "ready" })
        .where(eq(mediaVideoScript.id, f.id));
      return Buffer.from("old cut");
    });
    expect(
      (await assemble({ scriptId: f.id, userId: ownerId }, database))?.status,
    ).toBe("canceled");
    expect(
      await database.query.mediaVideoScript.findFirst({
        where: eq(mediaVideoScript.id, f.id),
      }),
    ).toMatchObject({ version: 2, status: "ready" });
    expect((await jobsFor(f.id))[0]?.mediaTaskId).toBeNull();
  });

  it("rolls back publication and removes the output when the script changes during upload", async () => {
    const f = await fixture();
    mocks.put.mockImplementationOnce(async () => {
      await database
        .update(mediaVideoScript)
        .set({ version: 2, status: "ready" })
        .where(eq(mediaVideoScript.id, f.id));
    });
    expect(
      (await assemble({ scriptId: f.id, userId: ownerId }, database))?.status,
    ).toBe("canceled");
    expect(mocks.remove).toHaveBeenCalledWith(mocks.put.mock.calls[0]![0]);
    expect((await jobsFor(f.id))[0]?.mediaTaskId).toBeNull();
  });

  it("retries failures and reuses completed cuts without duplicating drafts", async () => {
    const f = await fixture();
    mocks.cut.mockRejectedValueOnce(new Error("renderer failed"));
    await expect(
      assemble({ scriptId: f.id, userId: ownerId }, database),
    ).rejects.toThrow("renderer failed");
    expect((await jobsFor(f.id))[0]?.status).toBe("failed");
    const completed = await assemble(
      { scriptId: f.id, userId: ownerId },
      database,
    );
    const reused = await assemble(
      { scriptId: f.id, userId: ownerId },
      database,
    );
    expect(reused?.mediaTaskId).toBe(completed?.mediaTaskId);
    expect(mocks.cut).toHaveBeenCalledTimes(2);
    expect(await jobsFor(f.id)).toHaveLength(1);
  });

  it("reclaims an abandoned running attempt", async () => {
    const f = await fixture();
    const completed = await assemble(
      { scriptId: f.id, userId: ownerId },
      database,
    );
    await database
      .update(mediaGenerationJob)
      .set({ status: "running", startedAt: new Date(Date.now() - 11 * 60_000) })
      .where(eq(mediaGenerationJob.id, completed!.jobId));
    expect(
      (await assemble({ scriptId: f.id, userId: ownerId }, database))?.status,
    ).toBe("succeeded");
    expect(mocks.cut).toHaveBeenCalledTimes(2);
  });

  it("rebuilds the same draft and keeps the previous video if rebuilding fails", async () => {
    const f = await fixture();
    const first = await assemble({ scriptId: f.id, userId: ownerId }, database);
    const original = (await jobsFor(f.id))[0]!;
    const rebuilt = await assemble(
      {
        scriptId: f.id,
        userId: ownerId,
        rebuild: true,
        transition: "fade_white",
      },
      database,
    );
    expect(rebuilt?.jobId).toBe(first?.jobId);
    expect(rebuilt?.mediaTaskId).toBe(first?.mediaTaskId);
    const current = (await jobsFor(f.id))[0]!;
    expect(current.outputStorageKey).not.toBe(original.outputStorageKey);
    expect(mocks.remove).toHaveBeenCalledWith(original.outputStorageKey);
    expect(
      await database.query.mediaTask.findFirst({
        where: eq(mediaTask.id, first!.mediaTaskId!),
      }),
    ).toMatchObject({
      videoStorageKey: current.outputStorageKey,
      aiPrompts: { transition: "fade_white" },
    });
    mocks.cut.mockRejectedValueOnce(new Error("rebuild renderer failed"));
    await expect(
      assemble(
        {
          scriptId: f.id,
          userId: ownerId,
          rebuild: true,
          transition: "fade_black",
        },
        database,
      ),
    ).rejects.toThrow("rebuild renderer failed");
    expect((await jobsFor(f.id))[0]).toMatchObject({
      status: "succeeded",
      outputStorageKey: current.outputStorageKey,
      workflowVersion: current.workflowVersion,
      mediaTaskId: first?.mediaTaskId,
    });
    expect(
      await database.query.mediaTask.findFirst({
        where: eq(mediaTask.id, first!.mediaTaskId!),
      }),
    ).toMatchObject({ videoStorageKey: current.outputStorageKey });
  });

  it("refuses to rebuild a draft that has entered review", async () => {
    const f = await fixture();
    const completed = await assemble(
      { scriptId: f.id, userId: ownerId },
      database,
    );
    await database
      .update(mediaTask)
      .set({ status: "pending_review" })
      .where(eq(mediaTask.id, completed!.mediaTaskId!));
    await expect(
      assemble({ scriptId: f.id, userId: ownerId, rebuild: true }, database),
    ).rejects.toThrow("发布流程");
    expect(mocks.cut).toHaveBeenCalledTimes(1);
    expect((await jobsFor(f.id))[0]?.status).toBe("succeeded");
  });

  it("rolls back a rebuild when review starts during upload", async () => {
    const f = await fixture();
    const completed = await assemble(
      { scriptId: f.id, userId: ownerId },
      database,
    );
    const original = (await jobsFor(f.id))[0]!;
    mocks.put.mockImplementationOnce(async () => {
      await database
        .update(mediaTask)
        .set({ status: "pending_review" })
        .where(eq(mediaTask.id, completed!.mediaTaskId!));
    });
    await expect(
      assemble({ scriptId: f.id, userId: ownerId, rebuild: true }, database),
    ).rejects.toThrow("发布流程");
    expect((await jobsFor(f.id))[0]).toMatchObject({
      status: "succeeded",
      outputStorageKey: original.outputStorageKey,
    });
    expect(mocks.remove).toHaveBeenCalledWith(mocks.put.mock.calls[1]![0]);
    expect(
      await database.query.mediaTask.findFirst({
        where: eq(mediaTask.id, completed!.mediaTaskId!),
      }),
    ).toMatchObject({
      status: "pending_review",
      videoStorageKey: original.outputStorageKey,
    });
  });

  it("attaches standalone sources in order and rejects another owner's source", async () => {
    const f = await fixture();
    const secondId = crypto.randomUUID();
    await database
      .update(mediaGenerationJob)
      .set({ scriptId: null, scriptShotId: null })
      .where(eq(mediaGenerationJob.id, f.takeId));
    await database.insert(mediaGenerationJob).values({
      id: secondId,
      prompt: "Second standalone shot",
      durationSeconds: 5,
      width: 160,
      height: 96,
      status: "succeeded",
      outputStorageKey: `${secondId}.mp4`,
      createdBy: otherId,
    });
    await database
      .update(mediaVideoScript)
      .set({
        shots: [
          f.shot,
          { ...f.shot, id: "two", selectedGenerationJobId: secondId },
        ],
      })
      .where(eq(mediaVideoScript.id, f.id));
    const input = {
      scriptId: f.id,
      userId: ownerId,
      sourceJobIds: [f.takeId, secondId],
      transition: "fade_black" as const,
      burnCaptions: true,
    };
    await expect(assemble(input, database)).rejects.toThrow("归属");
    expect(mocks.cut).not.toHaveBeenCalled();
    await database
      .update(mediaGenerationJob)
      .set({ createdBy: ownerId })
      .where(eq(mediaGenerationJob.id, secondId));
    const result = await assemble(input, database);
    expect(result?.status).toBe("succeeded");
    expect((await jobsFor(f.id))[0]?.durationSeconds).toBe(6);
    for (const [index, id] of input.sourceJobIds.entries()) {
      expect(
        await database.query.mediaGenerationJob.findFirst({
          where: eq(mediaGenerationJob.id, id),
        }),
      ).toMatchObject({
        scriptId: f.id,
        scriptShotId: index === 0 ? "one" : "two",
      });
    }
  });

  it("does not assemble a take owned by another account", async () => {
    const f = await fixture(otherId);
    await expect(
      assemble(
        { scriptId: f.id, userId: ownerId, requireReady: true },
        database,
      ),
    ).rejects.toThrow("成功视频");
    await expect(createAnimatic(database, otherId, f.id)).rejects.toMatchObject(
      { code: "NOT_FOUND" },
    );
    expect(mocks.cut).not.toHaveBeenCalled();
    expect(mocks.preview).not.toHaveBeenCalled();
  });

  it("returns a current reused cut ahead of a newer obsolete cut", async () => {
    const f = await fixture();
    const plain = await assemble({ scriptId: f.id, userId: ownerId }, database);
    await assemble(
      { scriptId: f.id, userId: ownerId, burnCaptions: true },
      database,
    );
    await database
      .update(mediaVideoScript)
      .set({
        version: 2,
        shots: [
          {
            ...f.shot,
            captions: [
              { id: "cue", startSeconds: 1, endSeconds: 3, text: "新字幕" },
            ],
          },
        ],
      })
      .where(eq(mediaVideoScript.id, f.id));
    const result = await caller.mediaHub.script.get({ id: f.id });
    expect(result.assembledJob).toMatchObject({
      id: plain!.jobId,
      isCurrent: true,
      captioned: false,
    });
  });

  it("retains the captioned label on an obsolete captioned cut", async () => {
    const f = await fixture();
    await assemble(
      { scriptId: f.id, userId: ownerId, burnCaptions: true },
      database,
    );
    await database
      .update(mediaVideoScript)
      .set({ version: 2, shots: [{ ...f.shot, trimStartSeconds: 2 }] })
      .where(eq(mediaVideoScript.id, f.id));
    expect(
      (await caller.mediaHub.script.get({ id: f.id })).assembledJob,
    ).toMatchObject({ isCurrent: false, captioned: true });
  });

  it("writes a version-specific preview and removes it if upload races with an edit", async () => {
    const f = await fixture();
    expect(await createAnimatic(database, ownerId, f.id)).toMatchObject({
      version: 1,
    });
    expect(mocks.put).toHaveBeenCalledWith(
      `media-hub/animatics/${ownerId}/${f.id}/preview-1.mp4`,
      expect.any(Buffer),
      "video/mp4",
      expect.any(AbortSignal),
    );
    mocks.put.mockImplementationOnce(async () => {
      await database
        .update(mediaVideoScript)
        .set({ version: 2 })
        .where(eq(mediaVideoScript.id, f.id));
    });
    await expect(createAnimatic(database, ownerId, f.id)).rejects.toMatchObject(
      { code: "CONFLICT" },
    );
    expect(mocks.remove).toHaveBeenCalledWith(
      `media-hub/animatics/${ownerId}/${f.id}/preview-1.mp4`,
    );
  });

  it("rejects missing or cross-account first frames before rendering", async () => {
    const f = await fixture();
    await database
      .update(mediaImageAsset)
      .set({ ownerUserId: otherId })
      .where(eq(mediaImageAsset.id, f.frameId));
    await expect(createAnimatic(database, ownerId, f.id)).rejects.toMatchObject(
      { code: "PRECONDITION_FAILED" },
    );
    expect(mocks.preview).not.toHaveBeenCalled();
  });

  it("does not upload a preview after script deletion during rendering", async () => {
    const f = await fixture();
    mocks.preview.mockImplementationOnce(async () => {
      await database
        .update(mediaVideoScript)
        .set({ deletedAt: new Date() })
        .where(eq(mediaVideoScript.id, f.id));
      return Buffer.from("preview");
    });
    await expect(createAnimatic(database, ownerId, f.id)).rejects.toMatchObject(
      { code: "NOT_FOUND" },
    );
    expect(mocks.put).not.toHaveBeenCalled();
  });
});
