import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { inferRouterOutputs } from "@trpc/server";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { MediaHubAppRouter } from "@acme/api";
import type { db as applicationDb } from "@acme/db/client";
import type { MediaPrevisRecipe } from "@acme/validators";
import { and, count, eq } from "@acme/db";
import { migrate } from "@acme/db/migrate";
import {
  mediaApiToken,
  mediaImageAsset,
  mediaPrevisRender,
  mediaPrevisRenderAttempt,
  mediaPrevisRenderItem,
  mediaPrevisRequest,
  mediaPrevisRevision,
  mediaPrevisScene,
  user,
} from "@acme/db/schema";

import { configureTestDockerHost } from "./helpers/postgres";

type Document =
  inferRouterOutputs<MediaHubAppRouter>["mediaHub"]["previs"]["create"];
let handlers: typeof import("../lib/agent-previs");
let renderHandlers: typeof import("../lib/agent-previs-render");
let worker: typeof import("../../../../packages/api/src/router/media-hub/previs-render-worker");
let database: typeof applicationDb;
let container: StartedPostgreSqlContainer | undefined;
const owner = "previs-owner";
const other = "previs-other";
const tokens = {
  owner: "mh_agent_previs_owner_token",
  other: "mh_agent_previs_other_token",
};
const recipe = {
  format: "crucible.scene",
  schemaVersion: 1,
  geometries: [{ id: "box", type: "box", bevel: 0 }],
  materials: [{ id: "grey", color: [0.5, 0.5, 0.5] }],
  nodes: [
    {
      id: "proxy",
      geometry: "box",
      material: "grey",
      translation: [0, 0.5, 0],
    },
  ],
  camera: { eye: [0, 3, 8], target: [0, 0.5, 0], fov: 40 },
} satisfies MediaPrevisRecipe;

function request(
  method: string,
  body?: unknown,
  key?: string,
  token: string = tokens.owner,
) {
  return new Request("http://previs.test/api/v1/previs", {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function document(response: Response) {
  const body: unknown = await response.json();
  expect(response.status, JSON.stringify(body)).toBeLessThan(300);
  return body as Document;
}

async function fixture(token: string = tokens.owner) {
  return document(
    await handlers.handlePrevisCreate(
      request(
        "POST",
        {
          title: `Scene ${crypto.randomUUID()}`,
          recipe,
          views: [{ id: "front", label: "Front", camera: { eye: [0, 3, 8] } }],
        },
        undefined,
        token,
      ),
    ),
  );
}

function edit(parent: Document, x: number, setCurrent = false) {
  return {
    parent_revision_id: parent.revision.id,
    operations: [{ type: "set-node", id: "proxy", translation: [x, 0.5, 0] }],
    set_current: setCurrent,
    ...(setCurrent
      ? { expected_head_revision_id: parent.scene.headRevisionId }
      : {}),
  };
}

async function revisionCount(sceneId: string) {
  const [row] = await database
    .select({ total: count() })
    .from(mediaPrevisRevision)
    .where(eq(mediaPrevisRevision.sceneId, sceneId));
  return row?.total;
}

describe("Crucible scene/version HTTP services with PostgreSQL", () => {
  beforeAll(async () => {
    configureTestDockerHost();
    container = await new PostgreSqlContainer(
      process.env.TEST_POSTGRES_IMAGE ?? "postgres:17",
    ).start();
    process.env.POSTGRES_URL = container.getConnectionUri();
    process.env.NODE_ENV = "development";
    process.env.MEDIA_HUB_GENERATION_WORKER_ENABLED = "false";
    process.env.APP_URL = "http://previs.test";
    process.env.AUTH_SECRET = "previs-integration-test-secret";
    process.env.MEDIA_HUB_CRYPTO_KEY = Buffer.alloc(32, 9).toString("base64");
    database = (await import("@acme/db/client")).db;
    await migrate(database, {
      migrationsFolder: fileURLToPath(
        new URL("../../../../packages/db/drizzle", import.meta.url),
      ),
    });
    await database.insert(user).values(
      [owner, other].map((id) => ({
        id,
        name: id,
        email: `${id}@test.invalid`,
        emailVerified: true,
        role: "member",
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    );
    await database.insert(mediaApiToken).values([
      {
        id: "previs-owner-token",
        label: "Test",
        tokenHash: createHash("sha256").update(tokens.owner).digest("hex"),
        tokenEnc: "not-used",
        createdBy: owner,
      },
      {
        id: "previs-other-token",
        label: "Test",
        tokenHash: createHash("sha256").update(tokens.other).digest("hex"),
        tokenEnc: "not-used",
        createdBy: other,
      },
    ]);
    handlers = await import("../lib/agent-previs");
    renderHandlers = await import("../lib/agent-previs-render");
    worker =
      await import("../../../../packages/api/src/router/media-hub/previs-render-worker");
  }, 120_000);

  afterAll(async () => {
    try {
      await database?.$client.end({ timeout: 5 });
    } finally {
      await container?.stop();
    }
  });

  it("creates an empty static scene and downloads a pinned canonical source", async () => {
    const created = await document(
      await handlers.handlePrevisCreate(request("POST", { title: "Empty" })),
    );
    expect(created.scene).toMatchObject({
      ownerUserId: owner,
      headRevisionId: created.revision.id,
      revisionCount: 1,
      version: 1,
    });
    expect(created.revision).toMatchObject({
      revisionNumber: 1,
      engineVersion: "0.20.0",
      recipe: { nodes: [] },
    });
    const read = await document(
      await handlers.handlePrevisGet(request("GET"), created.scene.id),
    );
    expect(read).toEqual(created);
    const source = await handlers.handlePrevisRevisionSource(
      request("GET"),
      created.revision.id,
    );
    expect(source.status).toBe(200);
    expect(source.headers.get("content-disposition")).toContain(`v1.json`);
    expect(source.headers.get("cache-control")).toBe("no-store");
    expect(await source.json()).toMatchObject({
      engineVersion: "0.20.0",
      recipe: created.revision.recipe,
      checksum: created.revision.checksum,
    });
  });

  it("keeps branches immutable and explicitly selects and rolls back the head", async () => {
    const original = await fixture();
    const branch = await document(
      await handlers.handlePrevisRevisionCreate(
        request("POST", edit(original, 2)),
        original.scene.id,
      ),
    );
    expect(branch.scene).toMatchObject({
      headRevisionId: original.revision.id,
      revisionCount: 2,
      version: 2,
    });
    expect(branch.revision).toMatchObject({
      parentRevisionId: original.revision.id,
      revisionNumber: 2,
    });
    expect(branch.revision.views).toEqual(original.revision.views);
    const selected = await document(
      await handlers.handlePrevisPatch(
        request("PATCH", {
          version: branch.scene.version,
          head_revision_id: branch.revision.id,
          expected_head_revision_id: original.revision.id,
        }),
        original.scene.id,
      ),
    );
    expect(selected.scene.headRevisionId).toBe(branch.revision.id);
    const restored = await document(
      await handlers.handlePrevisPatch(
        request("PATCH", {
          version: selected.scene.version,
          head_revision_id: original.revision.id,
          expected_head_revision_id: branch.revision.id,
        }),
        original.scene.id,
      ),
    );
    expect(restored.revision).toEqual(original.revision);
    const retained = await document(
      await handlers.handlePrevisRevisionGet(
        request("GET"),
        branch.revision.id,
      ),
    );
    expect(retained.revision).toEqual(branch.revision);
    const history = await handlers.handlePrevisRevisionList(
      request("GET"),
      original.scene.id,
    );
    expect(await history.json()).toMatchObject({
      total: 2,
      headRevisionId: original.revision.id,
      items: [
        { revisionNumber: 2, parentRevisionId: original.revision.id },
        { revisionNumber: 1, parentRevisionId: null },
      ],
    });
  }, 15_000);

  it("allows only one concurrent head advance and rolls back the losing reservation", async () => {
    const original = await fixture();
    const keys = [crypto.randomUUID(), crypto.randomUUID()];
    const results = await Promise.all(
      [1, 2].map((x, i) =>
        handlers.handlePrevisRevisionCreate(
          request("POST", edit(original, x, true), keys[i]),
          original.scene.id,
        ),
      ),
    );
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    expect(await revisionCount(original.scene.id)).toBe(2);
    const reservations = await database
      .select()
      .from(mediaPrevisRequest)
      .where(eq(mediaPrevisRequest.sceneId, original.scene.id));
    expect(reservations).toHaveLength(1);
    const current = await document(
      await handlers.handlePrevisGet(request("GET"), original.scene.id),
    );
    expect(current.scene.headRevisionId).not.toBe(original.revision.id);
    expect(current.scene.revisionCount).toBe(2);
  });

  it("serializes concurrent branches into unique sequence numbers without moving the head", async () => {
    const original = await fixture();
    const results = await Promise.all(
      [1, 2, 3].map((x) =>
        handlers.handlePrevisRevisionCreate(
          request("POST", edit(original, x)),
          original.scene.id,
        ),
      ),
    );
    expect(results.map((result) => result.status)).toEqual([201, 201, 201]);
    const history = await handlers.handlePrevisRevisionList(
      request("GET"),
      original.scene.id,
    );
    expect(await history.json()).toMatchObject({
      total: 4,
      headRevisionId: original.revision.id,
      items: [
        { revisionNumber: 4 },
        { revisionNumber: 3 },
        { revisionNumber: 2 },
        { revisionNumber: 1 },
      ],
    });
  });

  it("deduplicates concurrent creation and scopes idempotency keys to the owner", async () => {
    const key = crypto.randomUUID();
    const input = { title: `Idempotent ${key}`, recipe };
    const [first, second] = await Promise.all([
      handlers.handlePrevisCreate(request("POST", input, key)),
      handlers.handlePrevisCreate(request("POST", input, key)),
    ]);
    const one = await document(first);
    const two = await document(second);
    expect(two.scene.id).toBe(one.scene.id);
    expect(two.revision.id).toBe(one.revision.id);
    expect(await revisionCount(one.scene.id)).toBe(1);
    expect(
      (
        await handlers.handlePrevisCreate(
          request("POST", { ...input, title: "Different" }, key),
        )
      ).status,
    ).toBe(409);
    const anotherOwner = await document(
      await handlers.handlePrevisCreate(
        request("POST", input, key, tokens.other),
      ),
    );
    expect(anotherOwner.scene.id).not.toBe(one.scene.id);
    expect(anotherOwner.scene.ownerUserId).toBe(other);
  }, 15_000);

  it("replays a saved revision after the selected head changed without creating another revision", async () => {
    const original = await fixture();
    const key = crypto.randomUUID();
    const input = edit(original, 2, true);
    const saved = await document(
      await handlers.handlePrevisRevisionCreate(
        request("POST", input, key),
        original.scene.id,
      ),
    );
    const replay = await document(
      await handlers.handlePrevisRevisionCreate(
        request("POST", input, key),
        original.scene.id,
      ),
    );
    expect(replay.revision).toEqual(saved.revision);
    expect(await revisionCount(original.scene.id)).toBe(2);
    expect(
      (
        await handlers.handlePrevisRevisionCreate(
          request("POST", edit(original, 3, true), key),
          original.scene.id,
        )
      ).status,
    ).toBe(409);
  });

  it("detects stale scene versions even when the head has not changed", async () => {
    const original = await fixture();
    await document(
      await handlers.handlePrevisRevisionCreate(
        request("POST", edit(original, 2)),
        original.scene.id,
      ),
    );
    expect(
      (
        await handlers.handlePrevisPatch(
          request("PATCH", { version: 1, title: "Stale" }),
          original.scene.id,
        )
      ).status,
    ).toBe(409);
    const current = await document(
      await handlers.handlePrevisGet(request("GET"), original.scene.id),
    );
    expect(current.scene.title).toBe(original.scene.title);
  });

  it("rejects parents and selected revisions from another owned scene", async () => {
    const first = await fixture();
    const second = await fixture();
    expect(
      (
        await handlers.handlePrevisRevisionCreate(
          request("POST", edit(second, 2)),
          first.scene.id,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await handlers.handlePrevisPatch(
          request("PATCH", {
            version: first.scene.version,
            head_revision_id: second.revision.id,
            expected_head_revision_id: first.revision.id,
          }),
          first.scene.id,
        )
      ).status,
    ).toBe(404);
    expect(await revisionCount(first.scene.id)).toBe(1);
  });

  it("enforces ownership on every scene, version, download and mutation entry point", async () => {
    const foreign = await fixture(tokens.other);
    const attempts = [
      () => handlers.handlePrevisGet(request("GET"), foreign.scene.id),
      () => handlers.handlePrevisRevisionList(request("GET"), foreign.scene.id),
      () =>
        handlers.handlePrevisRevisionGet(request("GET"), foreign.revision.id),
      () =>
        handlers.handlePrevisRevisionSource(
          request("GET"),
          foreign.revision.id,
        ),
      () =>
        handlers.handlePrevisPatch(
          request("PATCH", { version: 1, archived: true }),
          foreign.scene.id,
        ),
      () =>
        handlers.handlePrevisRevisionCreate(
          request("POST", edit(foreign, 2)),
          foreign.scene.id,
        ),
      () =>
        handlers.handlePrevisFork(
          request("POST", { revision_id: foreign.revision.id }),
          foreign.scene.id,
        ),
    ];
    for (const attempt of attempts) expect((await attempt()).status).toBe(404);
    const list = await handlers.handlePrevisList(
      new Request(
        `http://previs.test/api/v1/previs?search=${foreign.scene.title}`,
        { headers: { authorization: `Bearer ${tokens.owner}` } },
      ),
    );
    expect(await list.json()).toMatchObject({ items: [], total: 0 });
  }, 15_000);

  it("archives without losing versions, filters the list and restores before editing", async () => {
    const original = await fixture();
    const archived = await document(
      await handlers.handlePrevisPatch(
        request("PATCH", {
          version: 1,
          archived: true,
          description: "Keep history",
        }),
        original.scene.id,
      ),
    );
    expect(archived.scene.archivedAt).toBeTruthy();
    expect(archived.revision).toEqual(original.revision);
    expect(
      (
        await handlers.handlePrevisRevisionCreate(
          request("POST", edit(original, 2)),
          original.scene.id,
        )
      ).status,
    ).toBe(412);
    const listUrl = `http://previs.test/api/v1/previs?search=${encodeURIComponent(original.scene.title)}`;
    const headers = { authorization: `Bearer ${tokens.owner}` };
    expect(
      await (
        await handlers.handlePrevisList(new Request(listUrl, { headers }))
      ).json(),
    ).toMatchObject({ total: 0 });
    expect(
      await (
        await handlers.handlePrevisList(
          new Request(`${listUrl}&status=archived`, { headers }),
        )
      ).json(),
    ).toMatchObject({ total: 1 });
    const restored = await document(
      await handlers.handlePrevisPatch(
        request("PATCH", { version: archived.scene.version, archived: false }),
        original.scene.id,
      ),
    );
    expect(restored.scene).toMatchObject({
      archivedAt: null,
      description: "Keep history",
    });
    expect(
      (
        await handlers.handlePrevisRevisionCreate(
          request("POST", edit(original, 2)),
          original.scene.id,
        )
      ).status,
    ).toBe(201);
  }, 15_000);

  it("copies the specified historic revision independently and deduplicates the fork", async () => {
    const original = await fixture();
    await document(
      await handlers.handlePrevisRevisionCreate(
        request("POST", edit(original, 2, true)),
        original.scene.id,
      ),
    );
    const key = crypto.randomUUID();
    const forkBody = { revision_id: original.revision.id };
    const forked = await document(
      await handlers.handlePrevisFork(
        request("POST", forkBody, key),
        original.scene.id,
      ),
    );
    const replay = await document(
      await handlers.handlePrevisFork(
        request("POST", forkBody, key),
        original.scene.id,
      ),
    );
    expect(replay.scene.id).toBe(forked.scene.id);
    expect(forked.scene).toMatchObject({
      revisionCount: 1,
      forkedFromRevisionId: original.revision.id,
    });
    expect(forked.revision).toMatchObject({
      revisionNumber: 1,
      parentRevisionId: null,
      recipe: original.revision.recipe,
      checksum: original.revision.checksum,
    });
    const edited = await document(
      await handlers.handlePrevisRevisionCreate(
        request("POST", edit(forked, 3, true)),
        forked.scene.id,
      ),
    );
    expect(edited.revision.sceneId).toBe(forked.scene.id);
    expect(
      (
        await document(
          await handlers.handlePrevisRevisionGet(
            request("GET"),
            original.revision.id,
          ),
        )
      ).revision,
    ).toEqual(original.revision);
  }, 15_000);

  it("rolls back invalid operations and validates the request boundary", async () => {
    const original = await fixture();
    const invalid = await handlers.handlePrevisRevisionCreate(
      request("POST", {
        parent_revision_id: original.revision.id,
        operations: [
          { type: "set-node", id: "proxy", translation: [9, 0.5, 0] },
          { type: "remove-material", id: "grey" },
        ],
      }),
      original.scene.id,
    );
    expect(invalid.status).toBe(400);
    expect(await revisionCount(original.scene.id)).toBe(1);
    expect(
      (
        await document(
          await handlers.handlePrevisGet(request("GET"), original.scene.id),
        )
      ).revision,
    ).toEqual(original.revision);
    expect(
      (
        await handlers.handlePrevisCreate(
          request("POST", { title: "Injected owner", ownerUserId: other }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await handlers.handlePrevisCreate(
          request("POST", {
            title: "Unsafe recipe",
            recipe: { ...recipe, game: {} },
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await handlers.handlePrevisRevisionCreate(
          request("POST", { ...edit(original, 2), recipe }),
          original.scene.id,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await handlers.handlePrevisPatch(
          request("PATCH", {
            version: 1,
            head_revision_id: original.revision.id,
          }),
          original.scene.id,
        )
      ).status,
    ).toBe(400);
    expect(
      (await handlers.handlePrevisGet(request("GET"), "not-a-uuid")).status,
    ).toBe(400);
    expect(
      (
        await handlers.handlePrevisCreate(
          new Request("http://previs.test", { method: "POST", body: "{}" }),
        )
      ).status,
    ).toBe(401);
  }, 15_000);

  it("keeps referenced scene versions protected by database foreign keys", async () => {
    const original = await fixture();
    await expect(
      database
        .delete(mediaPrevisRevision)
        .where(eq(mediaPrevisRevision.id, original.revision.id)),
    ).rejects.toThrow();
    expect(await revisionCount(original.scene.id)).toBe(1);
    const [stored] = await database
      .select()
      .from(mediaPrevisScene)
      .where(
        and(
          eq(mediaPrevisScene.id, original.scene.id),
          eq(mediaPrevisScene.ownerUserId, owner),
        ),
      );
    expect(stored?.headRevisionId).toBe(original.revision.id);
  });

  type Render =
    inferRouterOutputs<MediaHubAppRouter>["mediaHub"]["previs"]["createRender"];
  type Items =
    inferRouterOutputs<MediaHubAppRouter>["mediaHub"]["previs"]["renderItems"];
  async function renderFixture(frames = [1]) {
    const original = await fixture();
    const response = await renderHandlers.handlePrevisRenderCreate(
      request("POST", {
        revision_id: original.revision.id,
        width: 64,
        height: 64,
        frames,
      }),
      original.scene.id,
    );
    expect(response.status).toBe(202);
    return { original, render: (await response.json()) as Render };
  }
  async function renderItems(id: string) {
    const response = await renderHandlers.handlePrevisRenderItems(
      request("GET"),
      id,
    );
    expect(response.status).toBe(200);
    return (await response.json()) as Items;
  }
  function output() {
    return {
      content: Buffer.from("injected-test-render-output"),
      contentType: "image/png" as const,
      checksum: "sha256:test",
      width: 64,
      height: 64,
      frameCount: 1,
      fps: 24,
      durationSeconds: 0,
      metadata: { backend: "injected-test" },
    };
  }

  it("organizes reusable scenes in owned groups, preserves introductions on fork and retains scenes when deleting groups", async () => {
    type Group =
      inferRouterOutputs<MediaHubAppRouter>["mediaHub"]["previs"]["createGroup"];
    const name = `Rooms ${crypto.randomUUID()}`;
    const response = await handlers.handlePrevisGroups(
      request("POST", { name }),
    );
    expect(response.status).toBe(201);
    const { group } = (await response.json()) as Group;
    expect(
      (await handlers.handlePrevisGroups(request("POST", { name }))).status,
    ).toBe(409);
    expect(
      (
        await handlers.handlePrevisGroups(
          request("POST", { name }, undefined, tokens.other),
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await handlers.handlePrevisCreate(
          request(
            "POST",
            { title: "Foreign", group_id: group.id },
            undefined,
            tokens.other,
          ),
        )
      ).status,
    ).toBe(404);
    const original = await document(
      await handlers.handlePrevisCreate(
        request("POST", {
          title: "Reusable room",
          description: "Living room with space for tracking shots",
          group_id: group.id,
          recipe,
        }),
      ),
    );
    const copied = await document(
      await handlers.handlePrevisFork(
        request("POST", { revision_id: original.revision.id }),
        original.scene.id,
      ),
    );
    expect(copied.scene).toMatchObject({
      groupId: group.id,
      description: original.scene.description,
    });
    const listed = await handlers.handlePrevisList(
      new Request(
        `http://previs.test/api/v1/previs?group_id=${group.id}&search=tracking`,
        { headers: request("GET").headers },
      ),
    );
    expect(
      ((await listed.json()) as { items: { id: string }[] }).items
        .map((item) => item.id)
        .sort(),
    ).toEqual([original.scene.id, copied.scene.id].sort());
    const renameResults = await Promise.all(
      ["A", "B"].map((suffix) =>
        handlers.handlePrevisGroup(
          request("PATCH", { version: 1, name: `${name}-${suffix}` }),
          group.id,
        ),
      ),
    );
    expect(renameResults.map((result) => result.status).sort()).toEqual([
      200, 409,
    ]);
    expect(
      (
        await handlers.handlePrevisGroup(
          request("DELETE", { version: 2 }, undefined, tokens.other),
          group.id,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await handlers.handlePrevisGroup(
          request("DELETE", { version: 1 }),
          group.id,
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await handlers.handlePrevisGroup(
          request("DELETE", { version: 2 }),
          group.id,
        )
      ).status,
    ).toBe(200);
    const retained = await document(
      await handlers.handlePrevisGet(request("GET"), original.scene.id),
    );
    expect(retained.scene).toMatchObject({
      groupId: null,
      description: original.scene.description,
      revisionCount: 1,
      version: original.scene.version + 1,
    });
    expect(retained.revision.id).toBe(original.revision.id);
    expect(
      (
        await document(
          await handlers.handlePrevisGet(request("GET"), copied.scene.id),
        )
      ).scene.groupId,
    ).toBeNull();
  }, 20_000);

  it("protects manually selected covers, deduplicates automatic thumbnails and restores the current revision cover", async () => {
    const { original, render } = await renderFixture([1, 2]);
    const dependencies = {
      render: () => Promise.resolve(output()),
      put: () => Promise.resolve(),
      remove: () => Promise.resolve(),
    };
    await worker.runPrevisWorkerTick(database, dependencies);
    await worker.runPrevisWorkerTick(database, dependencies);
    const results = await renderItems(render.id);
    const first = results.items[0]!.artifact!,
      second = results.items[1]!.artifact!;
    let current = await document(
      await handlers.handlePrevisGet(request("GET"), original.scene.id),
    );
    expect(current.scene).toMatchObject({
      thumbnailArtifactId: null,
      thumbnailRevisionId: null,
      version: original.scene.version,
    });
    current = await document(
      await handlers.handlePrevisPatch(
        request("PATCH", {
          version: current.scene.version,
          thumbnail_artifact_id: second.id,
        }),
        original.scene.id,
      ),
    );
    expect(current.scene.thumbnailMode).toBe("manual");
    const advanced = await document(
      await handlers.handlePrevisRevisionCreate(
        request("POST", edit(original, 3, true)),
        original.scene.id,
      ),
    );
    expect(advanced.scene.thumbnailArtifactId).toBe(second.id);
    expect(
      (await handlers.handlePrevisThumbnail(request("POST"), original.scene.id))
        .status,
    ).toBe(412);
    const unrelated = await fixture();
    expect(
      (
        await handlers.handlePrevisPatch(
          request("PATCH", {
            version: unrelated.scene.version,
            thumbnail_artifact_id: first.id,
          }),
          unrelated.scene.id,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await handlers.handlePrevisThumbnail(
          request("POST", undefined, undefined, tokens.other),
          original.scene.id,
        )
      ).status,
    ).toBe(404);
    current = await document(
      await handlers.handlePrevisPatch(
        request("PATCH", {
          version: advanced.scene.version,
          thumbnail_artifact_id: null,
        }),
        original.scene.id,
      ),
    );
    const thumbnails = await Promise.all(
      [1, 2].map(async () => {
        const response = await handlers.handlePrevisThumbnail(
          request("POST"),
          original.scene.id,
        );
        expect(response.status).toBe(202);
        return (await response.json()) as Render;
      }),
    );
    expect(thumbnails[0]!.id).toBe(thumbnails[1]!.id);
    expect(thumbnails[0]!.purpose).toBe("thumbnail");
    await worker.runPrevisWorkerTick(database, dependencies);
    const thumbnail = (await renderItems(thumbnails[0]!.id)).items[0]!
      .artifact!;
    const covered = await document(
      await handlers.handlePrevisGet(request("GET"), original.scene.id),
    );
    expect(covered.scene).toMatchObject({
      thumbnailMode: "auto",
      thumbnailArtifactId: thumbnail.id,
      thumbnailRevisionId: advanced.revision.id,
      version: current.scene.version,
    });
    const batches = await renderHandlers.handlePrevisRenderList(
      request("GET"),
      original.scene.id,
    );
    expect(
      ((await batches.json()) as { items: { id: string }[] }).items.map(
        (batch) => batch.id,
      ),
    ).toEqual([render.id]);
  }, 20_000);

  it("pins render inputs, preserves expansion order beyond eight stills and deduplicates requests", async () => {
    const original = await fixture();
    const body = {
      revision_id: original.revision.id,
      view_ids: ["front"],
      frames: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      width: 64,
      height: 64,
    };
    const responses = await Promise.all(
      [1, 2].map(() =>
        renderHandlers.handlePrevisRenderCreate(
          request("POST", body, "render-once"),
          original.scene.id,
        ),
      ),
    );
    const batches = await Promise.all(
      responses.map(async (response) => {
        expect(response.status).toBe(202);
        return (await response.json()) as Render;
      }),
    );
    expect(batches[0]!.id).toBe(batches[1]!.id);
    expect(
      (
        await handlers.handlePrevisCreate(
          request("POST", { title: "Key collision" }, "render-once"),
        )
      ).status,
    ).toBe(409);
    const keyed = await document(
      await handlers.handlePrevisCreate(
        request("POST", { title: "Authoring key" }, "authoring-key"),
      ),
    );
    expect(
      (
        await renderHandlers.handlePrevisRenderCreate(
          request("POST", { revision_id: keyed.revision.id }, "authoring-key"),
          keyed.scene.id,
        )
      ).status,
    ).toBe(409);
    const items = await renderItems(batches[0]!.id);
    expect(items.items.map((item) => item.spec.frame)).toEqual(body.frames);
    expect(items.items.map((item) => item.position)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8,
    ]);
    await document(
      await handlers.handlePrevisRevisionCreate(
        request("POST", edit(original, 7, true)),
        original.scene.id,
      ),
    );
    expect(batches[0]!.revisionId).toBe(original.revision.id);
    expect(
      (
        await renderHandlers.handlePrevisRenderCreate(
          request("POST", { ...body, width: 128 }, "render-once"),
          original.scene.id,
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await renderHandlers.handlePrevisRenderCreate(
          request("POST", { ...body, profile: "h3_reference" }),
          original.scene.id,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await renderHandlers.handlePrevisRenderGet(
          request("GET", undefined, undefined, tokens.other),
          batches[0]!.id,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await renderHandlers.handlePrevisRenderChange(
          request("POST", {}, undefined, tokens.other),
          batches[0]!.id,
          "cancel",
        )
      ).status,
    ).toBe(404);
    await renderHandlers.handlePrevisRenderChange(
      request("POST", {}),
      batches[0]!.id,
      "cancel",
    );
  });

  it("retries only failed items, retains successes and imports PNGs idempotently with provenance", async () => {
    const { render } = await renderFixture([1, 2]);
    const put = vi.fn(() => Promise.resolve());
    const remove = vi.fn(() => Promise.resolve());
    await worker.runPrevisWorkerTick(database, {
      render: () => Promise.resolve(output()),
      put,
      remove,
    });
    await worker.runPrevisWorkerTick(database, {
      render: () => Promise.reject(new Error("deliberate renderer failure")),
      put,
      remove,
    });
    let items = await renderItems(render.id);
    expect(items.items.map((item) => item.status)).toEqual([
      "succeeded",
      "failed",
    ]);
    const firstArtifact = items.items[0]!.artifact!;
    await renderHandlers.handlePrevisRenderChange(
      request("POST", {}),
      render.id,
      "retry",
    );
    await worker.runPrevisWorkerTick(database, {
      render: () => Promise.resolve(output()),
      put,
      remove,
    });
    items = await renderItems(render.id);
    expect(items.items.map((item) => item.status)).toEqual([
      "succeeded",
      "succeeded",
    ]);
    expect(items.items[0]!.artifact!.id).toBe(firstArtifact.id);
    expect(items.items.map((item) => item.attempts.length)).toEqual([1, 2]);
    expect(put).toHaveBeenCalledTimes(2);
    const imports = await Promise.all(
      [1, 2].map(() =>
        renderHandlers.handlePrevisImagesImport(
          request("POST", { artifact_ids: [firstArtifact.id] }),
          render.id,
        ),
      ),
    );
    const results = await Promise.all(
      imports.map(async (response) => {
        expect(response.status).toBe(200);
        return (await response.json()) as { assets: { assetId: string }[] };
      }),
    );
    expect(results[0]).toEqual(results[1]);
    const assetId = results[0]!.assets[0]!.assetId;
    const [asset] = await database
      .select()
      .from(mediaImageAsset)
      .where(eq(mediaImageAsset.id, assetId));
    expect(asset).toMatchObject({
      origin: "previs",
      ownerUserId: owner,
      checksum: firstArtifact.checksum,
    });
    await database
      .update(mediaImageAsset)
      .set({ deletedAt: new Date() })
      .where(eq(mediaImageAsset.id, assetId));
    await renderHandlers.handlePrevisImagesImport(
      request("POST", { artifact_ids: [firstArtifact.id] }),
      render.id,
    );
    const [restored] = await database
      .select()
      .from(mediaImageAsset)
      .where(eq(mediaImageAsset.id, assetId));
    expect(restored?.deletedAt).toBeNull();
    expect(
      (
        await renderHandlers.handlePrevisArtifactDownload(
          request("GET", undefined, undefined, tokens.other),
          firstArtifact.id,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await renderHandlers.handlePrevisImagesImport(
          request(
            "POST",
            { artifact_ids: [firstArtifact.id] },
            undefined,
            tokens.other,
          ),
          render.id,
        )
      ).status,
    ).toBe(404);
  }, 20_000);

  it("fences expired attempts after interruption and allows only the replacement to publish", async () => {
    const { render } = await renderFixture();
    const old = (await worker.claimPrevisItem(database))!;
    await database
      .update(mediaPrevisRenderAttempt)
      .set({ leaseExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(mediaPrevisRenderAttempt.id, old.attemptId));
    expect(await worker.recoverPrevisAttempts(database)).toBe(1);
    expect((await renderItems(render.id)).items[0]!.status).toBe("interrupted");
    await renderHandlers.handlePrevisRenderChange(
      request("POST", {}),
      render.id,
      "retry",
    );
    const current = (await worker.claimPrevisItem(database))!;
    const { content, ...metadata } = output();
    expect(
      await worker.publishPrevisOutput(
        database,
        old,
        metadata,
        "stale-output",
        content.length,
      ),
    ).toBe(false);
    expect(
      await worker.publishPrevisOutput(
        database,
        current,
        metadata,
        `current-${current.attemptId}`,
        content.length,
      ),
    ).toBe(true);
    const items = await renderItems(render.id);
    expect(items.items[0]!.attempts.map((attempt) => attempt.status)).toEqual([
      "interrupted",
      "succeeded",
    ]);
    expect(items.items[0]!.artifact!.attemptId).toBe(current.attemptId);
  });

  it("ignores late historical covers and restores cached thumbnails after rollback", async () => {
    const original = await fixture();
    const service =
      await import("../../../../packages/api/src/router/media-hub/previs-render-service");
    await service.requestPrevisThumbnail(database, owner, original.scene.id);
    const claim = (await worker.claimPrevisItem(database))!;
    const advanced = await document(
      await handlers.handlePrevisRevisionCreate(
        request("POST", edit(original, 4, true)),
        original.scene.id,
      ),
    );
    const { content, ...metadata } = output();
    expect(
      await worker.publishPrevisOutput(
        database,
        claim,
        metadata,
        `previs/history/${crypto.randomUUID()}.png`,
        content.length,
      ),
    ).toBe(true);
    expect(
      (
        await document(
          await handlers.handlePrevisGet(request("GET"), original.scene.id),
        )
      ).scene.thumbnailArtifactId,
    ).toBeNull();
    const automatic = await service.requestPrevisThumbnail(
      database,
      owner,
      original.scene.id,
    );
    const dependencies = {
      render: () => Promise.resolve(output()),
      put: () => Promise.resolve(),
      remove: () => Promise.resolve(),
    };
    await worker.runPrevisWorkerTick(database, dependencies);
    const coverId = (await renderItems(automatic.id)).items[0]!.artifact!.id;
    let scene = await document(
      await handlers.handlePrevisGet(request("GET"), original.scene.id),
    );
    expect(scene.scene.thumbnailArtifactId).toBe(coverId);
    scene = await document(
      await handlers.handlePrevisPatch(
        request("PATCH", {
          version: scene.scene.version,
          head_revision_id: original.revision.id,
          expected_head_revision_id: advanced.revision.id,
        }),
        original.scene.id,
      ),
    );
    await service.requestPrevisThumbnail(database, owner, original.scene.id);
    await worker.runPrevisWorkerTick(database, dependencies);
    scene = await document(
      await handlers.handlePrevisGet(request("GET"), original.scene.id),
    );
    await document(
      await handlers.handlePrevisPatch(
        request("PATCH", {
          version: scene.scene.version,
          head_revision_id: advanced.revision.id,
          expected_head_revision_id: original.revision.id,
        }),
        original.scene.id,
      ),
    );
    expect(
      (await service.requestPrevisThumbnail(database, owner, original.scene.id))
        .id,
    ).toBe(automatic.id);
    expect(
      (
        await document(
          await handlers.handlePrevisGet(request("GET"), original.scene.id),
        )
      ).scene.thumbnailArtifactId,
    ).toBe(coverId);
  }, 20_000);

  it("cancels running work before upload and serializes concurrent claims", async () => {
    const { render } = await renderFixture([1, 2]);
    const claims = await Promise.all([
      worker.claimPrevisItem(database),
      worker.claimPrevisItem(database),
    ]);
    expect(new Set(claims.map((claim) => claim!.item.id)).size).toBe(2);
    await renderHandlers.handlePrevisRenderChange(
      request("POST", {}),
      render.id,
      "cancel",
    );
    for (const claim of claims)
      expect(await worker.heartbeatPrevisAttempt(database, claim!)).toBe(false);
    await database
      .update(mediaPrevisRenderAttempt)
      .set({ leaseExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(mediaPrevisRenderAttempt.status, "running"));
    await worker.recoverPrevisAttempts(database);
    expect(
      (await renderItems(render.id)).items.every(
        (item) => item.status === "canceled",
      ),
    ).toBe(true);
    const fresh = await renderFixture();
    const put = vi.fn(() => Promise.resolve());
    await worker.runPrevisWorkerTick(database, {
      render: async () => {
        await renderHandlers.handlePrevisRenderChange(
          request("POST", {}),
          fresh.render.id,
          "cancel",
        );
        return output();
      },
      put,
    });
    expect(put).not.toHaveBeenCalled();
    expect((await renderItems(fresh.render.id)).items[0]!.status).toBe(
      "canceled",
    );
  }, 20_000);

  it("keeps a committed object when publish throws before acknowledging success", async () => {
    const { render } = await renderFixture([1, 2]);
    const remove = vi.fn(() => Promise.resolve());
    const dependencies = {
      render: () => Promise.resolve(output()),
      put: () => Promise.resolve(),
      remove,
    };
    await worker.runPrevisWorkerTick(database, {
      ...dependencies,
      publish: async (...args) => {
        expect(await worker.publishPrevisOutput(...args)).toBe(true);
        throw new Error("Lost commit acknowledgement");
      },
    });
    expect(remove).not.toHaveBeenCalled();
    await worker.runPrevisWorkerTick(database, {
      ...dependencies,
      publish: () => Promise.reject(new Error("Transaction rolled back")),
    });
    expect(remove).toHaveBeenCalledTimes(1);
    const { items } = await renderItems(render.id);
    expect(items.map((item) => item.status)).toEqual(["succeeded", "failed"]);
    expect(remove).not.toHaveBeenCalledWith(items[0]!.artifact!.storageKey);
  }, 20_000);

  it("admits a thumbnail while an overlapping revision insert holds the owner foreign-key lock", async () => {
    const original = await fixture();
    const result = await database.transaction(async (tx) => {
      await tx
        .select({ id: user.id })
        .from(user)
        .where(eq(user.id, owner))
        .for("key share");
      const admission = handlers.handlePrevisThumbnail(
        request("POST"),
        original.scene.id,
      );
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), 5_000);
      });
      try {
        const admitted = await Promise.race([
          admission.then((response) => response.status === 202),
          deadline,
        ]);
        return { admission, admitted };
      } finally {
        clearTimeout(timer);
      }
    });
    const response = await result.admission;
    expect(response.status).toBe(202);
    const thumbnail = (await response.json()) as Render;
    await renderHandlers.handlePrevisRenderChange(
      request("POST", {}),
      thumbnail.id,
      "cancel",
    );
    expect(result.admitted).toBe(true);
  }, 20_000);

  it("scans beyond a full page of over-quota thumbnail candidates", async () => {
    await database.update(mediaPrevisScene).set({ archivedAt: new Date() });
    const seed = (await fixture()).revision;
    const scenes = Array.from({ length: 11 }, (_, i) => ({
      id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      ownerUserId: i === 10 ? other : owner,
      title: `Thumbnail candidate ${i}`,
    }));
    await database.insert(mediaPrevisScene).values(scenes);
    for (const scene of scenes) {
      const revisionId = crypto.randomUUID();
      await database.insert(mediaPrevisRevision).values({
        id: revisionId,
        sceneId: scene.id,
        revisionNumber: 1,
        createdBy: scene.ownerUserId,
        recipe: seed.recipe,
        views: seed.views,
        checksum: seed.checksum,
        engineVersion: seed.engineVersion,
        schemaVersion: seed.schemaVersion,
      });
      await database
        .update(mediaPrevisScene)
        .set({ headRevisionId: revisionId, revisionCount: 1 })
        .where(eq(mediaPrevisScene.id, scene.id));
    }
    const reserved = await renderFixture();
    const [reservedItem] = await database
      .select()
      .from(mediaPrevisRenderItem)
      .where(eq(mediaPrevisRenderItem.renderId, reserved.render.id));
    expect(reservedItem).toBeDefined();
    await database.insert(mediaPrevisRenderItem).values(
      Array.from({ length: 127 }, (_, i) => ({
        id: crypto.randomUUID(),
        renderId: reserved.render.id,
        spec: reservedItem!.spec,
        position: i + 1,
      })),
    );
    const service =
      await import("../../../../packages/api/src/router/media-hub/previs-render-service");
    expect(await service.queuePrevisThumbnail(database)).toBe(true);
    const thumbnails = await database
      .select()
      .from(mediaPrevisRender)
      .where(
        and(
          eq(mediaPrevisRender.purpose, "thumbnail"),
          eq(mediaPrevisRender.ownerUserId, other),
        ),
      );
    expect(thumbnails.map((item) => item.sceneId)).toEqual([scenes[10]!.id]);
  }, 20_000);
});
