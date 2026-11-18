import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { Server } from "node:http";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { db as applicationDb } from "@acme/db/client";
import { and, count, eq } from "@acme/db";
import { migrate } from "@acme/db/migrate";
import {
  mediaApiToken,
  mediaGenerationJob,
  mediaVideoScript,
  user,
} from "@acme/db/schema";

import { closeTestServer, configureTestDockerHost } from "./helpers/postgres";

const storage = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
  presign: vi.fn().mockResolvedValue("https://storage.test/upload"),
}));
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
  () => ({
    deliverGenerationResultNotification: vi.fn().mockResolvedValue(undefined),
    startMediaGenerationNotificationScheduler: vi.fn(),
  }),
);
vi.mock("@acme/storage", async (original) => ({
  ...(await original<typeof import("@acme/storage")>()),
  getMediaHubObject: storage.get,
  putMediaHubObject: storage.put,
  getMediaHubPresignedUploadUrl: storage.presign,
}));

const migrationsFolder = fileURLToPath(
  new URL("../../../../packages/db/drizzle", import.meta.url),
);
const ownerId = "integration-video-owner";
const scriptId = "integration-video-script";
const scriptShotId = "integration-video-shot";
const sourceJobId = "integration-source-video";
const agentToken = "mh_agent_integration_video_edit_token";
const postgresImage = process.env.TEST_POSTGRES_IMAGE ?? "postgres:17";

type Database = typeof applicationDb;
type HandlePost = (request: Request, sourceJobId: string) => Promise<Response>;
type HandleShotRequest = (
  request: Request,
  scriptId: string,
  shotId: string,
) => Promise<Response>;

let container: StartedPostgreSqlContainer;
let database: Database;
let handlePost: HandlePost;
let handleEditPlan: HandleShotRequest;
let handleTake: HandleShotRequest;
let handleCaptions: HandleShotRequest;
let providerServer: Server;
let createdEditJobId: string | null = null;
let handleGenerate: (request: Request) => Promise<Response>;
let handleRetry: (request: Request, jobId: string) => Promise<Response>;
let handleUpload: (request: Request) => Promise<Response>;
let createdReferenceJobId: string | null = null;
const recoveryRequests: string[] = [];
let recoveryPolls = 0;

function referenceRequest(overrides: Record<string, unknown> = {}) {
  return new Request("http://media-hub.test/api/v1/generations", {
    method: "POST",
    headers: {
      authorization: `Bearer ${agentToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      generation_mode: "reference",
      duration_seconds: 5,
      width: 96,
      height: 64,
      scheduled_at: new Date(Date.now() + 3_600_000).toISOString(),
      reference_video: {
        storage_key: `media-hub/video/${ownerId}/previs.mp4`,
        name: "previs.mp4",
        content_type: "video/mp4",
      },
      prompt:
        "subject_definitions: <Subject 1> is the red proxy in <Video 1>.\nsummary: [reference generation] Retain <Video 1> motion and camera.\nretention_analysis: Retain blocking and occlusion, replace proxy appearance.\ndetailed_description: [Shot 1] A character crosses left to right.\noverall_soundscape: No dialogue. Footsteps.\nnon_diegetic_music: N/A",
      ...overrides,
    }),
  });
}

function createEditRequest(
  body: Record<string, unknown>,
  authorization = `Bearer ${agentToken}`,
): Request {
  return new Request(
    `http://media-hub.test/api/v1/generations/${sourceJobId}/edits`,
    {
      method: "POST",
      headers: {
        authorization,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
}

function createShotRequest(
  action: "edit-plan" | "take" | "captions/generate",
  method: "PATCH" | "POST",
  body: Record<string, unknown>,
  authorization = `Bearer ${agentToken}`,
): Request {
  return new Request(
    `http://media-hub.test/api/v1/scripts/${scriptId}/shots/${scriptShotId}/${action}`,
    {
      method,
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

function validEditBody(overrides: Record<string, unknown> = {}) {
  return {
    title: "修改：接口集成测试",
    language: "zh",
    scheduled_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    segments: [
      {
        id: "later-segment",
        start_seconds: 8,
        end_seconds: 12,
        prompt: "把背景改成柔和的室内灯光",
        reference_images: [],
      },
      {
        id: "opening-segment",
        start_seconds: 1,
        end_seconds: 4,
        prompt: "让机器人缓慢转向镜头",
        reference_images: [],
      },
    ],
    ...overrides,
  };
}

describe("Agent video edit and director REST API", () => {
  beforeAll(async () => {
    configureTestDockerHost();
    container = await new PostgreSqlContainer(postgresImage)
      .withDatabase("media_hub_test")
      .withUsername("media_hub_test")
      .withPassword("media_hub_test")
      .start();

    process.env.POSTGRES_URL = container.getConnectionUri();
    process.env.NODE_ENV = "development";
    process.env.MEDIA_HUB_GENERATION_WORKER_ENABLED = "false";
    process.env.APP_URL = "http://media-hub.test";
    process.env.AUTH_SECRET = "media-hub-integration-test-secret";
    process.env.AUTH_USE_SECURE_COOKIES = "false";
    process.env.MEDIA_HUB_CRYPTO_KEY = Buffer.alloc(32, 7).toString("base64");
    providerServer = createServer((request, response) => {
      recoveryRequests.push(`${request.method} ${request.url}`);
      if (
        request.url === "/v1/generated-media/jobs/existing-recovery-job" &&
        request.method === "GET"
      ) {
        recoveryPolls += 1;
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            job_id: "existing-recovery-job",
            status: recoveryPolls === 1 ? "running" : "succeeded",
            started_at: new Date(Date.now() - 60_000).toISOString(),
            samples: [
              {
                content_base64: Buffer.from("existing GPU output").toString(
                  "base64",
                ),
              },
            ],
          }),
        );
        return;
      }
      if (request.url !== "/healthz") {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          status: "healthy",
          contract: "ydc_generated_media_provider_request.v1",
          profiles: ["platform-h3-ref2va-edit-v1", "recovery-i2v"],
          profile_details: [
            { id: "recovery-i2v", kind: "generate", minimum_steps: 20 },
            {
              id: "platform-h3-ref2va-edit-v1",
              kind: "edit",
              minimum_steps: 20,
              max_reference_images: 4,
              supports_reference_video: true,
            },
          ],
          provider_version: "integration-test",
        }),
      );
    });
    await new Promise<void>((resolve, reject) => {
      providerServer.once("error", reject);
      providerServer.listen(0, "127.0.0.1", resolve);
    });
    const providerAddress = providerServer.address();
    if (!providerAddress || typeof providerAddress === "string") {
      throw new Error("Integration provider did not expose a TCP port");
    }
    process.env.MEDIA_HUB_GENERATION_PROVIDER_URL = `http://127.0.0.1:${providerAddress.port}`;
    process.env.MEDIA_HUB_GENERATION_PROVIDER_TOKEN = "integration-token";

    const clientModule = await import("@acme/db/client");
    database = clientModule.db;
    await migrate(database, { migrationsFolder });

    const routeModule =
      await import("../routes/api/v1/generations/$jobId/edits");
    handlePost = routeModule.handlePost;
    handleGenerate = (await import("../routes/api/v1/generations")).handlePost;
    handleRetry = (await import("../routes/api/v1/generations/$jobId/retry"))
      .handlePost;
    handleUpload = (await import("../routes/api/v1/uploads/presign"))
      .handlePost;
    const { stdout: previs } = await promisify(execFile)(
      process.env.FFMPEG_PATH ?? "ffmpeg",
      [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=gray:s=96x64:r=24",
        "-frames:v",
        "124",
        "-an",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "frag_keyframe+empty_moov",
        "-f",
        "mp4",
        "pipe:1",
      ],
      { encoding: "buffer" },
    );
    storage.get.mockResolvedValue(previs);
    handleEditPlan = (
      await import("../routes/api/v1/scripts/$scriptId/shots/$shotId/edit-plan")
    ).handlePatch;
    handleTake = (
      await import("../routes/api/v1/scripts/$scriptId/shots/$shotId/take")
    ).handlePatch;
    handleCaptions = (
      await import("../routes/api/v1/scripts/$scriptId/shots/$shotId/captions/generate")
    ).handlePost;

    const now = new Date();
    await database.insert(user).values({
      id: ownerId,
      name: "Integration Video Owner",
      email: "video-edit-integration@media-hub.test",
      emailVerified: true,
      role: "member",
      banned: false,
      createdAt: now,
      updatedAt: now,
    });
    await database.insert(mediaApiToken).values({
      id: "integration-video-api-token",
      label: "Video edit integration test",
      tokenHash: createHash("sha256").update(agentToken).digest("hex"),
      tokenEnc: "integration-test-does-not-decrypt-this-value",
      createdBy: ownerId,
      createdAt: now,
      updatedAt: now,
    });
    await database.insert(mediaVideoScript).values({
      id: scriptId,
      title: "Integration video script",
      brief: "Verify that Ref2VA versions stay attached to their source shot",
      shots: [
        {
          id: scriptShotId,
          title: "Opening shot",
          durationSeconds: 15,
          visualDescription: "A robot turns toward the camera",
          cameraDirection: "Static",
          continuity: "",
          soundscape: "",
          music: "N/A",
          dialogues: [
            {
              id: "dialogue-1",
              atSeconds: 2,
              speakerId: "S1",
              language: "zh",
              text: "你好",
            },
          ],
        },
      ],
      createdBy: ownerId,
      createdAt: now,
      updatedAt: now,
    });
    await database.insert(mediaGenerationJob).values({
      id: sourceJobId,
      scriptId,
      scriptShotId,
      prompt: "A completed source video used only inside integration tests",
      title: "Integration source video",
      language: "en",
      durationSeconds: 15,
      fps: 24,
      width: 960,
      height: 544,
      status: "succeeded",
      outputStorageKey: "integration-tests/source-video.mp4",
      createdBy: ownerId,
      createdAt: now,
      updatedAt: now,
    });
  }, 120_000);

  afterAll(async () => {
    if (createdReferenceJobId) {
      const { cancelMediaGenerationJob } = await import("@acme/api");
      await cancelMediaGenerationJob(createdReferenceJobId);
    }
    if (createdEditJobId) {
      const { cancelMediaGenerationJob } = await import("@acme/api");
      await cancelMediaGenerationJob(createdEditJobId);
    }
    try {
      await closeTestServer(providerServer);
      await database?.$client.end({ timeout: 5 });
    } finally {
      await container?.stop();
    }
  }, 30_000);

  it("rejects requests without a valid Agent API token", async () => {
    const response = await handlePost(
      createEditRequest(validEditBody(), "Bearer invalid-token"),
      sourceJobId,
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "unauthorized" },
    });
  });

  it("creates a scheduled edit job through the real REST handler", async () => {
    const response = await handlePost(
      createEditRequest(validEditBody()),
      sourceJobId,
    );
    const result = (await response.json()) as {
      id: string;
      status: string;
      source_generation_job_id: string;
      script_id: string | null;
      script_shot_id: string | null;
    };
    createdEditJobId = result.id;

    expect(response.status).toBe(201);
    expect(result.status).toBe("scheduled");
    expect(result).toMatchObject({
      source_generation_job_id: sourceJobId,
      script_id: scriptId,
      script_shot_id: scriptShotId,
    });

    const savedJob = await database.query.mediaGenerationJob.findFirst({
      where: eq(mediaGenerationJob.id, result.id),
    });
    expect(savedJob).toMatchObject({
      id: result.id,
      kind: "edit",
      scriptId,
      scriptShotId,
      sourceGenerationJobId: sourceJobId,
      title: "修改：接口集成测试",
      language: "zh",
      status: "scheduled",
      preserveSourceAudio: true,
      durationSeconds: 15,
      fps: 24,
      width: 960,
      height: 544,
    });
    expect(savedJob?.editSegments.map((segment) => segment.id)).toEqual([
      "opening-segment",
      "later-segment",
    ]);
    expect(
      savedJob?.editSegments.every((segment) => segment.preserveSourceAudio),
    ).toBe(true);
  });

  it("returns a validation error instead of leaking the Zod payload", async () => {
    const response = await handlePost(
      createEditRequest(validEditBody({ title: "x".repeat(201) })),
      sourceJobId,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "validation_error",
        message: "Request validation failed",
      },
    });
  });

  it("creates a reference generation from an uploaded MP4 without a source job", async () => {
    const response = await handleGenerate(referenceRequest());
    const result = (await response.json()) as { id: string };
    expect(response.status).toBe(201);
    createdReferenceJobId = result.id;
    const saved = await database.query.mediaGenerationJob.findFirst({
      where: eq(mediaGenerationJob.id, result.id),
    });
    expect(saved).toMatchObject({
      kind: "generate",
      sourceGenerationJobId: null,
      profile: "platform-h3-ref2va-edit-v1",
      steps: 20,
      preserveSourceAudio: false,
      referenceVideo: {
        frameCount: 124,
        fps: 24,
        width: 96,
        height: 64,
        contentType: "video/mp4",
      },
    });
    expect(saved?.referenceVideo?.checksum).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("rejects temporal-reference misuse before creating a GPU job", async () => {
    for (const patch of [
      { duration_seconds: 30 },
      { generation_mode: "base" },
      { reference_video: undefined },
    ]) {
      expect((await handleGenerate(referenceRequest(patch))).status).toBe(400);
    }
    expect(
      (
        await handleGenerate(
          referenceRequest({
            reference_video: {
              storage_key: "media-hub/video/other/previs.mp4",
              name: "previs.mp4",
              content_type: "video/mp4",
            },
          }),
        )
      ).status,
    ).toBe(403);
  });

  it("uploads MP4 server-side while retaining image size and base64 validation", async () => {
    const upload = (patch: Record<string, unknown>) =>
      handleUpload(
        new Request("http://media-hub.test/api/v1/uploads/presign", {
          method: "POST",
          headers: {
            authorization: `Bearer ${agentToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            filename: "previs.mp4",
            content_type: "video/mp4",
            size_bytes: 3,
            content_base64: "YWJj",
            ...patch,
          }),
        }),
      );
    const response = await upload({});
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      uploaded: true,
      content_type: "video/mp4",
      upload_url: null,
    });
    expect(storage.put).toHaveBeenCalledWith(
      expect.stringContaining(`media-hub/video/${ownerId}/`),
      Buffer.from("abc"),
      "video/mp4",
    );
    expect((await upload({ content_base64: "YW Jj" })).status).toBe(400);
    expect(
      (await upload({ content_type: "image/png", size_bytes: 5_000_001 }))
        .status,
    ).toBe(400);
  });

  it("rejects edit segments outside the source video duration", async () => {
    const response = await handlePost(
      createEditRequest(
        validEditBody({
          segments: [
            {
              id: "outside-source",
              start_seconds: 13,
              end_seconds: 16,
              prompt: "This range extends beyond the 15 second source",
              reference_images: [],
            },
          ],
        }),
      ),
      sourceJobId,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "bad_request",
        message: "修改片段不能超出源视频时长",
      },
    });

    const editCounts = await database
      .select({ value: count() })
      .from(mediaGenerationJob)
      .where(
        and(
          eq(mediaGenerationJob.kind, "edit"),
          eq(mediaGenerationJob.sourceGenerationJobId, sourceJobId),
        ),
      );
    expect(editCounts[0]?.value).toBe(1);
  });

  it("protects the shot edit plan with the Agent token", async () => {
    const response = await handleEditPlan(
      createShotRequest(
        "edit-plan",
        "PATCH",
        { version: 1 },
        "Bearer invalid-token",
      ),
      scriptId,
      scriptShotId,
    );
    expect(response.status).toBe(401);
  });

  it("persists trims, captions, generated dialogue cues, and selected take with version locks", async () => {
    const edited = await handleEditPlan(
      createShotRequest("edit-plan", "PATCH", {
        version: 1,
        trim_start_seconds: 1,
        trim_end_seconds: 12,
        captions: [{ start_seconds: 2, end_seconds: 4, text: "校正字幕" }],
      }),
      scriptId,
      scriptShotId,
    );
    expect(edited.status).toBe(200);
    await expect(edited.json()).resolves.toMatchObject({
      version: 2,
      shots: [
        {
          trimStartSeconds: 1,
          trimEndSeconds: 12,
          captions: [{ text: "校正字幕" }],
        },
      ],
    });

    const stale = await handleEditPlan(
      createShotRequest("edit-plan", "PATCH", {
        version: 1,
        trim_start_seconds: 2,
      }),
      scriptId,
      scriptShotId,
    );
    expect(stale.status).toBe(409);

    const generated = await handleCaptions(
      createShotRequest("captions/generate", "POST", { version: 2 }),
      scriptId,
      scriptShotId,
    );
    expect(generated.status).toBe(200);
    await expect(generated.json()).resolves.toMatchObject({
      version: 3,
      shots: [{ captions: [{ startSeconds: 2, text: "你好" }] }],
    });

    const selected = await handleTake(
      createShotRequest("take", "PATCH", { version: 3, job_id: sourceJobId }),
      scriptId,
      scriptShotId,
    );
    expect(selected.status).toBe(200);
    await expect(selected.json()).resolves.toMatchObject({
      version: 4,
      shots: [{ selectedGenerationJobId: sourceJobId }],
    });
    const saved = await database.query.mediaVideoScript.findFirst({
      where: eq(mediaVideoScript.id, scriptId),
    });
    expect(saved?.shots[0]).toMatchObject({
      trimStartSeconds: 1,
      trimEndSeconds: 12,
      captions: [{ text: "你好" }],
      selectedGenerationJobId: sourceJobId,
    });
  });

  it("reattaches after worker restart without canceling or resubmitting GPU work", async () => {
    // Keep the earlier API-only test jobs scheduled while recovery starts.
    await database
      .update(mediaGenerationJob)
      .set({
        status: "succeeded",
      })
      .where(eq(mediaGenerationJob.status, "scheduled"));
    const id = "integration-resumed-generation";
    const enqueuedAt = new Date(Date.now() - 2 * 60 * 60_000);
    await database.insert(mediaGenerationJob).values({
      id,
      prompt: "A quiet landscape. No dialogue.",
      title: "Resumed shot",
      durationSeconds: 5,
      width: 96,
      height: 64,
      steps: 20,
      profile: "recovery-i2v",
      status: "running",
      startedAt: enqueuedAt,
      providerJobId: "existing-recovery-job",
      providerJobIds: ["existing-recovery-job"],
      createdBy: ownerId,
    });
    recoveryRequests.length = 0;
    const { startMediaGenerationScheduler } =
      await import("../../../../packages/api/src/router/media-hub/generation");
    process.env.MEDIA_HUB_GENERATION_WORKER_ENABLED = "true";
    startMediaGenerationScheduler();
    await vi.waitFor(
      async () => {
        const job = await database.query.mediaGenerationJob.findFirst({
          where: eq(mediaGenerationJob.id, id),
        });
        expect(job?.errorMessage).toBeNull();
        expect(job?.status).toBe("succeeded");
        expect(job?.providerJobIds).toEqual(["existing-recovery-job"]);
        expect(job?.startedAt).toEqual(enqueuedAt);
      },
      { timeout: 10_000 },
    );
    expect(
      recoveryRequests.filter((request) => request.startsWith("POST")),
    ).toEqual([]);
    expect(recoveryPolls).toBeGreaterThanOrEqual(2);
  }, 20_000);

  it("receives the original completed GPU result after a transport failure and manual retry", async () => {
    const id = "integration-retry-completed-generation";
    const startedAt = new Date(Date.now() - 2 * 60 * 60_000);
    await database.insert(mediaGenerationJob).values({
      id,
      prompt: "A quiet landscape. No dialogue.",
      durationSeconds: 5,
      width: 96,
      height: 64,
      steps: 20,
      profile: "recovery-i2v",
      status: "failed",
      failureStage: "provider_transport",
      errorCode: "provider_transport_failed",
      startedAt,
      providerJobId: "existing-recovery-job",
      providerJobIds: ["existing-recovery-job"],
      createdBy: ownerId,
    });
    recoveryRequests.length = 0;
    const response = await handleRetry(
      new Request(`http://media-hub.test/api/v1/generations/${id}/retry`, {
        method: "POST",
        headers: { authorization: `Bearer ${agentToken}` },
      }),
      id,
    );
    expect(response.status).toBe(202);
    await vi.waitFor(
      async () => {
        const saved = await database.query.mediaGenerationJob.findFirst({
          where: eq(mediaGenerationJob.id, id),
        });
        expect(saved?.errorMessage).toBeNull();
        expect(saved?.status).toBe("succeeded");
        expect(saved?.providerJobIds).toEqual(["existing-recovery-job"]);
        expect(saved?.startedAt).toEqual(startedAt);
        expect(saved?.outputStorageKey).toBeTruthy();
      },
      { timeout: 10_000 },
    );
    expect(
      recoveryRequests.filter((request) => request.startsWith("POST")),
    ).toEqual([]);
  }, 20_000);
});
