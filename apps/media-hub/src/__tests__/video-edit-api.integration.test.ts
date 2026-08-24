import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { db as applicationDb } from "@acme/db/client";
import { and, count, eq } from "@acme/db";
import { mediaApiToken, mediaGenerationJob, user } from "@acme/db/schema";

const migrationsFolder = fileURLToPath(
  new URL("../../../../packages/db/drizzle", import.meta.url),
);
const ownerId = "integration-video-owner";
const sourceJobId = "integration-source-video";
const agentToken = "mh_agent_integration_video_edit_token";
const postgresImage = process.env.TEST_POSTGRES_IMAGE ?? "postgres:17";

type Database = typeof applicationDb;
type HandlePost = (request: Request, sourceJobId: string) => Promise<Response>;

let container: StartedPostgreSqlContainer;
let database: Database;
let handlePost: HandlePost;
let createdEditJobId: string | null = null;

function configureDockerHostFromCurrentContext(): void {
  if (process.env.DOCKER_HOST || process.platform !== "darwin") return;
  const dockerHost = execFileSync(
    "docker",
    ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"],
    { encoding: "utf8" },
  ).trim();
  if (dockerHost) process.env.DOCKER_HOST = dockerHost;
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

describe("POST /api/v1/generations/:jobId/edits", () => {
  beforeAll(async () => {
    configureDockerHostFromCurrentContext();
    container = await new PostgreSqlContainer(postgresImage)
      .withDatabase("media_hub_test")
      .withUsername("media_hub_test")
      .withPassword("media_hub_test")
      .start();

    process.env.POSTGRES_URL = container.getConnectionUri();
    process.env.NODE_ENV = "development";
    process.env.APP_URL = "http://media-hub.test";
    process.env.AUTH_SECRET = "media-hub-integration-test-secret";
    process.env.AUTH_USE_SECURE_COOKIES = "false";
    process.env.MEDIA_HUB_CRYPTO_KEY = Buffer.alloc(32, 7).toString("base64");

    const clientModule = await import("@acme/db/client");
    database = clientModule.db;
    await migrate(database, { migrationsFolder });

    const routeModule =
      await import("../routes/api/v1/generations/$jobId/edits");
    handlePost = routeModule.handlePost;

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
    await database.insert(mediaGenerationJob).values({
      id: sourceJobId,
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
    if (createdEditJobId) {
      const { cancelMediaGenerationJob } = await import("@acme/api");
      await cancelMediaGenerationJob(createdEditJobId);
    }
    await container?.stop();
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
    const result = (await response.json()) as { id: string; status: string };
    createdEditJobId = result.id;

    expect(response.status).toBe(201);
    expect(result.status).toBe("scheduled");

    const savedJob = await database.query.mediaGenerationJob.findFirst({
      where: eq(mediaGenerationJob.id, result.id),
    });
    expect(savedJob).toMatchObject({
      id: result.id,
      kind: "edit",
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
});
