import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { db as applicationDb } from "@acme/db/client";
import { mediaImageAsset, user } from "@acme/db/schema";

const migrationsFolder = fileURLToPath(
  new URL("../../../../packages/db/drizzle", import.meta.url),
);
const postgresImage = process.env.TEST_POSTGRES_IMAGE ?? "postgres:17";
type Database = typeof applicationDb;

let container: StartedPostgreSqlContainer;
let database: Database;
let router: (typeof import("@acme/api"))["mediaHubAppRouter"];
let createTRPCContext: (typeof import("@acme/api"))["createTRPCContext"];

function configureDockerHostFromCurrentContext(): void {
  if (process.env.DOCKER_HOST || process.platform !== "darwin") return;
  const dockerHost = execFileSync(
    "docker",
    ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"],
    { encoding: "utf8" },
  ).trim();
  if (dockerHost) process.env.DOCKER_HOST = dockerHost;
}

function callerFor(userId: string, role: "member" | "admin" = "member") {
  const context = {
    db: database,
    authApi: {},
    session: {
      user: {
        id: userId,
        name: userId,
        email: `${userId}@media-hub.test`,
        emailVerified: true,
        role,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      session: {
        id: `session-${userId}`,
        userId,
        token: `token-${userId}`,
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    },
  } as unknown as Awaited<ReturnType<typeof createTRPCContext>>;
  return router.createCaller(context);
}

describe("user-bound image library", () => {
  beforeAll(async () => {
    configureDockerHostFromCurrentContext();
    container = await new PostgreSqlContainer(postgresImage)
      .withDatabase("media_image_access_test")
      .withUsername("media_image_access_test")
      .withPassword("media_image_access_test")
      .start();
    process.env.POSTGRES_URL = container.getConnectionUri();
    process.env.NODE_ENV = "production";
    process.env.AUTH_SECRET = "media-image-access-integration-secret";

    const clientModule = await import("@acme/db/client");
    database = clientModule.db;
    await migrate(database, { migrationsFolder });
    const api = await import("@acme/api");
    router = api.mediaHubAppRouter;
    createTRPCContext = api.createTRPCContext;

    const now = new Date();
    await database.insert(user).values([
      {
        id: "image-owner-a",
        name: "Owner A",
        email: "image-owner-a@media-hub.test",
        emailVerified: true,
        role: "member",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "image-owner-b",
        name: "Owner B",
        email: "image-owner-b@media-hub.test",
        emailVerified: true,
        role: "member",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "image-admin",
        name: "Image Admin",
        email: "image-admin@media-hub.test",
        emailVerified: true,
        role: "admin",
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await database.insert(mediaImageAsset).values([
      {
        id: "asset-owner-a",
        storageKey: "media-hub/image/image-owner-a/asset-a.png",
        filename: "asset-a.png",
        contentType: "image/png",
        sizeBytes: 100,
        checksum: "sha256:asset-a",
        origin: "upload",
        ownerUserId: "image-owner-a",
        createdAt: now,
      },
      {
        id: "asset-owner-b",
        storageKey: "media-hub/image/image-owner-b/asset-b.png",
        filename: "asset-b.png",
        contentType: "image/png",
        sizeBytes: 100,
        checksum: "sha256:asset-b",
        origin: "upload",
        ownerUserId: "image-owner-b",
        createdAt: now,
      },
    ]);
  }, 120_000);

  afterAll(async () => {
    await container?.stop();
  }, 30_000);

  it("lists only the current user's assets", async () => {
    const result = await callerFor("image-owner-a").mediaHub.image.list({
      limit: 20,
    });
    expect(result.assets.map((asset) => asset.id)).toEqual(["asset-owner-a"]);
  });

  it("rejects another user's asset during video handoff", async () => {
    await expect(
      callerFor("image-owner-a").mediaHub.image.prepareVideoInputs({
        assetIds: ["asset-owner-b"],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("keeps the ordinary library owner-only for administrators", async () => {
    await expect(
      callerFor("image-admin", "admin").mediaHub.image.prepareVideoInputs({
        assetIds: ["asset-owner-a"],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
