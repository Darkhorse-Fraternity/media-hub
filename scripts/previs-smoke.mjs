// Run after pnpm build:
// MEDIA_HUB_PREVIS_BROWSER=/absolute/chromium pnpm test:previs-smoke
// All credentials, database, bucket, HTTP servers and browser contexts are temporary.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const appRequire = createRequire(join(root, "apps/media-hub/package.json"));
const { PostgreSqlContainer } = appRequire("@testcontainers/postgresql");
const { GenericContainer, Wait } = createRequire(
  appRequire.resolve("@testcontainers/postgresql"),
)("testcontainers");
const { S3Client, CreateBucketCommand } = createRequire(
  join(root, "packages/storage/package.json"),
)("@aws-sdk/client-s3");
const bcrypt = createRequire(join(root, "packages/auth/package.json"))(
  "bcryptjs",
);
const { chromium } = createRequire(
  appRequire.resolve("@codepawlhq/crucible/package.json"),
)("playwright-core");
const browserPath = process.env.MEDIA_HUB_PREVIS_BROWSER;
assert.ok(
  browserPath,
  "Set MEDIA_HUB_PREVIS_BROWSER to the Chromium executable to test.",
);
process.env.DOCKER_HOST ??= execFileSync(
  "docker",
  ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"],
  { encoding: "utf8" },
).trim();
const outputDir =
  process.env.PREVIS_SMOKE_OUTPUT ??
  `/private/tmp/media-hub-previs-smoke-${Date.now()}`;
await mkdir(outputDir, { recursive: true });
const resources = [];
let database,
  child,
  browser,
  provider,
  logs = "";
try {
  const postgres = await new PostgreSqlContainer("postgres:17").start();
  resources.push(postgres);
  const minio = await new GenericContainer(
    process.env.TEST_MINIO_IMAGE ??
      "minio/minio@sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e",
  )
    .withEnvironment({
      MINIO_ROOT_USER: "previs-smoke",
      MINIO_ROOT_PASSWORD: "temporary-previs-smoke-password",
    })
    .withCommand(["server", "/data"])
    .withExposedPorts(9000)
    .withWaitStrategy(Wait.forHttp("/minio/health/live", 9000))
    .start();
  resources.push(minio);
  Object.assign(process.env, {
    POSTGRES_URL: postgres.getConnectionUri(),
    MEDIA_HUB_S3_ENDPOINT: `http://${minio.getHost()}:${minio.getMappedPort(9000)}`,
    MEDIA_HUB_S3_REGION: "us-east-1",
    MEDIA_HUB_S3_ACCESS_KEY: "previs-smoke",
    MEDIA_HUB_S3_SECRET_KEY: "temporary-previs-smoke-password",
    MEDIA_HUB_S3_BUCKET: "previs-smoke",
    MEDIA_HUB_GENERATION_WORKER_ENABLED: "false",
    MEDIA_HUB_PREVIS_WORKER_ENABLED: "false",
  });
  const s3 = new S3Client({
    endpoint: process.env.MEDIA_HUB_S3_ENDPOINT,
    region: "us-east-1",
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.MEDIA_HUB_S3_ACCESS_KEY,
      secretAccessKey: process.env.MEDIA_HUB_S3_SECRET_KEY,
    },
  });
  await s3.send(new CreateBucketCommand({ Bucket: "previs-smoke" }));
  s3.destroy();
  const { db } = await import("../packages/db/src/client.ts");
  database = db;
  const { migrate } = await import("../packages/db/src/migrate.ts");
  const schema = await import("../packages/db/src/schema.ts");
  const { eq } = await import("../packages/db/src/index.ts");
  await migrate(db, { migrationsFolder: join(root, "packages/db/drizzle") });
  const owner = randomUUID(),
    email = `${owner}@test.invalid`,
    password = randomBytes(24).toString("hex");
  const token = `mh_agent_${randomBytes(24).toString("hex")}`;
  await db.insert(schema.user).values({
    id: owner,
    name: "白模闭环验证",
    email,
    emailVerified: true,
    role: "member",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await db.insert(schema.account).values({
    id: randomUUID(),
    accountId: owner,
    providerId: "credential",
    userId: owner,
    password: await bcrypt.hash(password, 4),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await db.insert(schema.mediaApiToken).values({
    id: randomUUID(),
    label: "Temporary smoke",
    tokenHash: createHash("sha256").update(token).digest("hex"),
    tokenEnc: "not-used",
    createdBy: owner,
  });
  let providerSubmissions = 0;
  await db.insert(schema.mediaSystemSetting).values({
    id: "default",
    h3GenerationProfile: "smoke-base",
    h3EditProfile: "smoke-reference",
  });
  provider = createServer((request, response) => {
    if (request.method !== "GET") providerSubmissions++;
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        status: "healthy",
        contract: "ydc_generated_media_provider_request.v1",
        profiles: ["smoke-reference", "smoke-base"],
        profile_details: [
          {
            id: "smoke-base",
            kind: "generate",
            supports_native_av_continuation: false,
          },
          {
            id: "smoke-reference",
            kind: "edit",
            supports_reference_video: true,
            max_reference_images: 4,
            max_reference_audios: 0,
          },
        ],
      }),
    );
  });
  await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const portProbe = createServer();
  await new Promise((resolve) => portProbe.listen(0, "127.0.0.1", resolve));
  const port = portProbe.address().port;
  await new Promise((resolve) => portProbe.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  child = spawn(
    process.execPath,
    [join(root, "apps/media-hub/.output/server/index.mjs")],
    {
      cwd: join(root, "apps/media-hub"),
      env: {
        ...process.env,
        CI: "",
        NODE_ENV: "production",
        PORT: String(port),
        NITRO_PORT: String(port),
        HOST: "127.0.0.1",
        NITRO_HOST: "127.0.0.1",
        APP_URL: base,
        MEDIA_HUB_AGENT_PUBLIC_URL: base,
        TRUSTED_ORIGINS: base,
        AUTH_USE_SECURE_COOKIES: "false",
        AUTH_SECRET: randomBytes(48).toString("base64"),
        MEDIA_HUB_CRYPTO_KEY: randomBytes(32).toString("base64"),
        MEDIA_HUB_PREVIS_WORKER_ENABLED: "true",
        MEDIA_HUB_PREVIS_CRUCIBLE_CLI: "",
        MEDIA_HUB_PREVIS_ENABLED: "true",
        MEDIA_HUB_GENERATION_PROVIDER_URL: `http://127.0.0.1:${provider.address().port}`,
        MEDIA_HUB_GENERATION_PROVIDER_TOKEN: "temporary-provider",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout.on("data", (bytes) => {
    logs = (logs + bytes).slice(-40_000);
  });
  child.stderr.on("data", (bytes) => {
    logs = (logs + bytes).slice(-40_000);
  });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) break;
    } catch {}
    if (child.exitCode !== null)
      throw new Error(`Built server exited: ${logs}`);
    await delay(200);
  }
  async function call(path, method = "GET", body, extraHeaders = {}) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...extraHeaders,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await response.json();
    assert.ok(
      response.ok,
      `${method} ${path}: ${response.status} ${JSON.stringify(result)}`,
    );
    return result;
  }
  const spec = await call("/api/openapi");
  assert.equal(spec.info.version, "1.12.0");
  function checkRefs(value) {
    if (!value || typeof value !== "object") return;
    if (typeof value.$ref === "string" && value.$ref.startsWith("#/"))
      assert.ok(
        value.$ref
          .slice(2)
          .split("/")
          .reduce(
            (node, key) =>
              node?.[key.replaceAll("~1", "/").replaceAll("~0", "~")],
            spec,
          ),
        value.$ref,
      );
    Object.values(value).forEach(checkRefs);
  }
  checkRefs(spec);
  const { previsStarterRecipe } =
    await import("../apps/media-hub/src/lib/previs-editor.ts");
  const demo =
    process.env.PREVIS_SMOKE_DEMO === "living-room"
      ? (await import("./fixtures/previs-living-room.mjs")).previsLivingRoom
      : undefined;
  const { group } = await call("/api/v1/previs-groups", "POST", {
    name: "可复用室内场景",
  });
  const intro =
    "客厅构图模板：保留沙发、茶几与遮挡台，可替换主体、调整镜头后复用。";
  const starter = demo?.recipe ?? previsStarterRecipe;
  const subject = starter.nodes.find((node) => node.id === "subject");
  const scale = subject.scale ?? [1, 1, 1];
  const created = await call("/api/v1/previs", "POST", {
    title: demo?.title ?? "遮挡与运镜验证",
    group_id: group.id,
    description: intro,
    recipe: {
      ...starter,
      motion: {
        ...starter.motion,
        tracks: [
          ...starter.motion.tracks,
          {
            kind: "node",
            id: "subject",
            property: "scale",
            keyframes: [{ time: 0, value: scale }],
          },
          {
            kind: "node",
            id: "subject",
            property: "rotation",
            keyframes: [{ time: 0, value: [0, 0, 0, 1] }],
          },
          {
            kind: "camera",
            property: "fov",
            keyframes: [{ time: 0, value: starter.camera.fov }],
          },
        ],
      },
    },
    views: demo?.views ?? [
      {
        id: "front",
        label: "正面",
        camera: { eye: [0, 3, 8], target: [0, 0.5, 0] },
      },
      {
        id: "side",
        label: "侧面",
        camera: { eye: [7, 3, 0], target: [0, 0.5, 0] },
      },
    ],
  });
  const saved = await call(
    `/api/v1/previs/${created.scene.id}/revisions`,
    "POST",
    {
      parent_revision_id: created.revision.id,
      operations: [
        { type: "set-node", id: "occluder", scale: [1.4, 1.6, 0.3] },
      ],
      set_current: true,
      expected_head_revision_id: created.revision.id,
      message: "扩大遮挡物",
    },
  );
  browser = await chromium.launch({
    executablePath: browserPath,
    headless: true,
    args: [
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--no-sandbox",
    ],
  });
  const context = await browser.newContext({
    viewport: { width: 1512, height: 1100 },
  });
  const login = await context.request.post(`${base}/api/auth/sign-in/email`, {
    data: { email, password },
    headers: { origin: base },
  });
  assert.equal(login.status(), 200, await login.text());
  const page = await context.newPage();
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.goto(`${base}/previs`);
  await page.getByLabel("分组筛选", { exact: true }).selectOption(group.id);
  await page
    .getByRole("button", { name: demo?.title ?? "遮挡与运镜验证" })
    .click();
  await page.getByRole("button", { name: "保存新版本", exact: true }).waitFor();
  await page
    .getByText("正在打开三维预览…")
    .waitFor({ state: "hidden", timeout: 30_000 });
  assert.equal(
    await page.getByText("当前浏览器无法显示三维预览").count(),
    0,
    (await page.getByRole("alert").allTextContents()).join("\n"),
  );
  const nodeX = () =>
    page
      .getByRole("group", { name: "位置（米）", exact: true })
      .getByLabel("X", { exact: true });
  await page.getByRole("button", { name: /^v1 / }).click();
  await page.getByLabel("选择物体").selectOption("occluder");
  await nodeX().fill("0.25");
  await page.getByLabel("分组筛选", { exact: true }).selectOption("all");
  assert.equal(await nodeX().inputValue(), "0.25");
  await page.getByLabel("分组筛选", { exact: true }).selectOption(group.id);
  await page
    .getByRole("textbox", { name: "场景简介", exact: true })
    .fill(`${intro} 已在页面精修。`);
  await page
    .getByRole("button", { name: "保存简介与分组", exact: true })
    .click();
  await page.getByText("场景已更新", { exact: true }).waitFor();
  assert.equal(await nodeX().inputValue(), "0.25");
  await page.getByText("版本 1 · 历史版本", { exact: true }).waitFor();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: /^v2 / }).click();
  assert.equal(await nodeX().inputValue(), "0.25");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: /^v2 / }).click();
  await page.getByLabel("选择物体").selectOption("subject");
  assert.equal(
    await page
      .getByRole("group", { name: "缩放", exact: true })
      .getByLabel("X", { exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(
    await page.getByLabel("水平朝向（度）", { exact: true }).isDisabled(),
    true,
  );
  assert.equal(
    await page.getByLabel("视野角度", { exact: true }).isDisabled(),
    true,
  );
  const shift = Number(await nodeX().inputValue()) + 0.5;
  await nodeX().fill(String(shift));
  await page.getByLabel("选择物体").selectOption("occluder");
  await nodeX().fill("0.5");
  const introInput = page.getByRole("textbox", {
    name: "场景简介",
    exact: true,
  });
  const introDraft = `${intro} 未提交的修改。`;
  await introInput.fill(introDraft);
  await page.getByRole("button", { name: "保存新版本", exact: true }).click();
  await page.getByText("新版本已保存", { exact: true }).waitFor();
  await page.getByText("版本 3 · 当前选定", { exact: true }).waitFor();
  assert.equal(await introInput.inputValue(), introDraft);
  const edited = await call(`/api/v1/previs/${created.scene.id}`);
  const moved = edited.revision.recipe.motion.tracks.find(
    (track) => track.id === "subject" && track.property === "translation",
  );
  assert.equal(moved.keyframes[0].value[0], shift);
  assert.equal(
    moved.keyframes.at(-1).value[0],
    saved.revision.recipe.motion.tracks
      .find((track) => track.id === "subject")
      .keyframes.at(-1).value[0] + 0.5,
  );
  await page.getByLabel("采样帧（从 1 开始，24 FPS）").fill("");
  await page.getByRole("combobox", { name: /^输出/ }).selectOption("video");
  await page.getByLabel("宽度", { exact: true }).fill("384");
  await page.getByLabel("高度", { exact: true }).fill("224");
  await page.getByRole("button", { name: "开始渲染", exact: true }).click();
  await page.getByText(/渲染批次已创建/).waitFor();
  const standard = (
    await call(`/api/v1/previs/${created.scene.id}/renders`)
  ).items.find((item) => item.request.outputType === "video");
  assert.equal(standard.request.profile, "standard");
  assert.equal(standard.request.durationSeconds, 5);
  assert.equal(standard.revisionId, edited.revision.id);
  await page.screenshot({
    path: join(outputDir, "workbench-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: join(outputDir, "workbench-mobile.png"),
    fullPage: true,
  });
  assert.deepEqual(browserErrors, []);
  const batchBody = {
    revision_id: saved.revision.id,
    output_type: "image",
    profile: "standard",
    view_ids: ["front", "side"],
    frames: [1, 25, 49, 73, 97],
    width: demo ? 896 : 384,
    height: demo ? 512 : 224,
  };
  const batch = await call(
    `/api/v1/previs/${created.scene.id}/renders`,
    "POST",
    batchBody,
    { "Idempotency-Key": "smoke-images" },
  );
  const replay = await call(
    `/api/v1/previs/${created.scene.id}/renders`,
    "POST",
    batchBody,
    { "Idempotency-Key": "smoke-images" },
  );
  assert.equal(batch.id, replay.id);
  const movie = await call(
    `/api/v1/previs/${created.scene.id}/renders`,
    "POST",
    {
      revision_id: saved.revision.id,
      output_type: "video",
      profile: "h3_reference",
      duration_seconds: 5,
      width: batchBody.width,
      height: batchBody.height,
    },
  );
  async function finished(renderId) {
    for (let i = 0; i < 600; i++) {
      const state = await call(`/api/v1/previs-renders/${renderId}`);
      if (!["queued", "running"].includes(state.status)) {
        const items = await call(`/api/v1/previs-renders/${renderId}/items`);
        assert.equal(
          state.status,
          "succeeded",
          JSON.stringify(
            items.items
              .filter((item) => item.status !== "succeeded")
              .map((item) => ({
                position: item.position,
                status: item.status,
                error: item.error,
              })),
          ),
        );
        return items.items;
      }
      await delay(500);
    }
    throw new Error(`Render timeout: ${renderId}; ${logs}`);
  }
  const ordinaryVideos = await finished(standard.id);
  assert.equal(ordinaryVideos[0].artifact.frameCount, 120);
  await page
    .locator(`video[src$="/${ordinaryVideos[0].artifact.id}"]`)
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "复制视频产物 ID", exact: true })
      .count(),
    0,
  );
  const images = await finished(batch.id),
    videos = await finished(movie.id);
  assert.equal(images.length, 10);
  assert.notEqual(
    images[0].artifact.checksum,
    images[4].artifact.checksum,
    "Motion samples must change the rendered image",
  );
  assert.notEqual(
    images[0].artifact.checksum,
    images[5].artifact.checksum,
    "Named views must use independent cameras",
  );
  assert.deepEqual(
    images.map((item) => item.spec.frame),
    [...batchBody.frames, ...batchBody.frames],
  );
  for (const item of [...images, ...videos]) {
    const artifact = item.artifact;
    assert.ok(artifact);
    assert.equal(artifact.revisionId, saved.revision.id);
    const response = await fetch(
      `${base}/api/v1/previs-artifacts/${artifact.id}/download`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    assert.equal(response.status, 200);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.length, artifact.sizeBytes);
    assert.equal(
      `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      artifact.checksum,
    );
    await writeFile(
      join(
        outputDir,
        `${item.spec.outputType}-${item.position}.${item.spec.outputType === "image" ? "png" : "mp4"}`,
      ),
      bytes,
    );
  }
  assert.equal(videos[0].artifact.frameCount, 124);
  assert.equal(videos[0].artifact.fps, 24);
  assert.ok(Math.abs(videos[0].artifact.durationSeconds - 124 / 24) < 0.001);
  const source = await call(
    `/api/v1/previs-revisions/${saved.revision.id}/source`,
  );
  const reused = await call("/api/v1/previs", "POST", {
    title: "从源码重新创建",
    recipe: source.recipe,
    views: source.views,
  });
  assert.equal(reused.revision.checksum, saved.revision.checksum);
  assert.notEqual(reused.scene.id, saved.scene.id);
  await writeFile(
    join(outputDir, "scene-source.json"),
    JSON.stringify(source, null, 2),
  );
  await writeFile(
    join(outputDir, "render-artifacts.json"),
    JSON.stringify([...images, ...videos], null, 2),
  );
  const imported = await call(
    `/api/v1/previs-renders/${batch.id}/image-assets`,
    "POST",
    { artifact_ids: images.slice(0, 2).map((item) => item.artifact.id) },
  );
  assert.deepEqual(
    await call(`/api/v1/previs-renders/${batch.id}/image-assets`, "POST", {
      artifact_ids: images.slice(0, 2).map((item) => item.artifact.id),
    }),
    imported,
  );
  const artifactId = videos[0].artifact.id;
  const prompt =
    "subject_definitions: Replace the moving blue proxy with a small pet robot.\nsummary: [reference generation] Use <Video 1> for the motion and camera.\nretention_analysis: Retain trajectories, perspective and occlusion; replace proxy shapes and flat colors.\ndetailed_description: [Shot 1] A pet robot travels left to right behind the stationary block, reappearing at the end. Keep the room layout.\noverall_soundscape: No dialogue. Soft rolling sounds and room ambience.\nnon_diegetic_music: N/A";
  const generation = await call("/api/v1/generations", "POST", {
    prompt,
    generation_mode: "reference",
    reference_artifact_id: artifactId,
    generation_profile: "smoke-reference",
    duration_seconds: 5,
    width: batchBody.width,
    height: batchBody.height,
  });
  const [job] = await db
    .select()
    .from(schema.mediaGenerationJob)
    .where(eq(schema.mediaGenerationJob.id, generation.id));
  assert.equal(job.referenceVideo.artifactId, artifactId);
  assert.equal(job.referenceVideo.checksum, videos[0].artifact.checksum);
  const script = await call("/api/v1/scripts", "POST", {
    title: "白模参考分镜",
    brief: "A pet robot moves behind a block",
    copy: "Two five-second shots.",
    copy_status: "approved",
    width: batchBody.width,
    height: batchBody.height,
    default_profile: "smoke-base",
    shots: [
      {
        id: "shot-a",
        title: "遮挡",
        duration_seconds: 5,
        visual_description:
          "A small pet robot travels left to right behind the stationary block, reappearing at the end.",
        reference_artifact_id: artifactId,
      },
      {
        id: "shot-b",
        title: "普通镜头",
        duration_seconds: 5,
        visual_description:
          "A small pet robot waits in a quiet room. The camera remains steady.",
      },
    ],
  });
  const scriptJobs = await call(
    `/api/v1/scripts/${script.id}/generate`,
    "POST",
    { shot_ids: ["shot-a"], continuity_mode: "independent" },
  );
  const [scriptJob] = await db
    .select()
    .from(schema.mediaGenerationJob)
    .where(eq(schema.mediaGenerationJob.id, scriptJobs.jobs[0].id));
  assert.equal(scriptJob.referenceVideo.artifactId, artifactId);
  assert.match(scriptJob.prompt, /^subject_definitions:/);
  const mixedJobs = await call(
    `/api/v1/scripts/${script.id}/generate`,
    "POST",
    { generation_profile: "smoke-base", continuity_mode: "independent" },
  );
  for (const summary of mixedJobs.jobs) {
    const [mixed] = await db
      .select()
      .from(schema.mediaGenerationJob)
      .where(eq(schema.mediaGenerationJob.id, summary.id));
    assert.equal(
      mixed.profile,
      mixed.scriptShotId === "shot-a" ? "smoke-reference" : "smoke-base",
    );
    if (mixed.scriptShotId === "shot-a")
      assert.equal(mixed.referenceVideo.artifactId, artifactId);
    else assert.equal(mixed.referenceVideo, null);
  }
  assert.equal(providerSubmissions, 0);
  const thumbnail = await call(
    `/api/v1/previs/${created.scene.id}/thumbnail`,
    "POST",
  );
  const thumbnailItems = await finished(thumbnail.id);
  assert.equal(thumbnailItems[0].artifact.width, 320);
  assert.equal(thumbnailItems[0].artifact.height, 180);
  const automatic = await call(`/api/v1/previs/${created.scene.id}`);
  assert.equal(
    automatic.scene.thumbnailRevisionId,
    automatic.scene.headRevisionId,
  );
  assert.equal(automatic.scene.thumbnailMode, "auto");
  assert.equal(
    automatic.scene.thumbnailArtifactId,
    thumbnailItems[0].artifact.id,
  );
  await page.setViewportSize({ width: 1512, height: 1100 });
  await page.getByRole("button", { name: /批次.*10\/10.*已完成/ }).click();
  await page.waitForFunction(() => {
    const images = [...document.querySelectorAll('img[alt^="白模渲染"]')];
    return (
      images.length === 10 &&
      images.every((image) => image.complete && image.naturalWidth > 0)
    );
  });
  await page
    .getByRole("button", { name: "用作场景封面", exact: true })
    .first()
    .click();
  let latest;
  for (let i = 0; i < 60; i++) {
    latest = await call(`/api/v1/previs/${created.scene.id}`);
    if (latest.scene.thumbnailMode === "manual") break;
    await delay(100);
  }
  assert.equal(latest.scene.thumbnailMode, "manual");
  assert.equal(latest.scene.thumbnailArtifactId, images[0].artifact.id);
  assert.equal(latest.scene.description, `${intro} 已在页面精修。`);
  assert.equal(latest.scene.groupId, group.id);
  const copied = await call(`/api/v1/previs/${created.scene.id}/fork`, "POST", {
    revision_id: saved.revision.id,
    title: "复用后的独立场景",
  });
  assert.equal(copied.scene.groupId, group.id);
  assert.equal(copied.scene.description, latest.scene.description);
  await page.waitForFunction(() => {
    const cover = document.querySelector('img[alt^="场景缩略图："]');
    return cover?.complete && cover.naturalWidth > 0;
  });
  assert.equal(
    await page.getByText("有未保存修改", { exact: true }).count(),
    0,
  );
  await page.getByLabel("分组筛选", { exact: true }).selectOption("all");
  await page.getByLabel("分组筛选", { exact: true }).selectOption(group.id);
  await page.getByRole("button", { name: /复用后的独立场景/ }).waitFor();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: /复用后的独立场景/ }).click();
  assert.equal(await introInput.inputValue(), introDraft);
  await introInput.fill(latest.scene.description);
  await page.getByRole("button", { name: /复用后的独立场景/ }).click();
  await page.getByText("版本 1 · 当前选定", { exact: true }).waitFor();
  await page.getByLabel("选择物体").selectOption("occluder");
  await nodeX().fill("0.75");
  let releaseSave;
  const heldSave = new Promise((resolve) => {
    releaseSave = resolve;
  });
  const saveUrl = "**/api/trpc/mediaHub.previs.createRevision?*";
  await page.route(
    saveUrl,
    async (route) => {
      const response = await route.fetch();
      await heldSave;
      await route.fulfill({ response });
    },
    { times: 1 },
  );
  await page.getByRole("button", { name: "保存新版本", exact: true }).click();
  await page.getByRole("button", { name: "正在保存…", exact: true }).waitFor();
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: demo?.title ?? "遮挡与运镜验证" })
    .click();
  await page.getByText("版本 3 · 当前选定", { exact: true }).waitFor();
  const savedCopyResponse = page.waitForResponse((response) =>
    response.url().includes("mediaHub.previs.createRevision"),
  );
  releaseSave();
  assert.equal((await savedCopyResponse).status(), 200);
  await page.getByText("新版本已保存", { exact: true }).waitFor();
  assert.equal(
    await page.getByLabel("修改场景名称").inputValue(),
    demo?.title ?? "遮挡与运镜验证",
  );
  await page.getByText("版本 3 · 当前选定", { exact: true }).waitFor();
  assert.equal(
    (await call(`/api/v1/previs/${copied.scene.id}`)).scene.revisionCount,
    2,
  );
  await page.screenshot({
    path: join(outputDir, "workbench-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: join(outputDir, "workbench-mobile.png"),
    fullPage: true,
  });
  assert.deepEqual(browserErrors, []);
  assert.equal(latest.scene.revisionCount, 3);
  await call(`/api/v1/previs/${created.scene.id}`, "PATCH", {
    version: latest.scene.version,
    archived: true,
  });
  const historic = await call(`/api/v1/previs-revisions/${saved.revision.id}`);
  assert.equal(historic.revision.id, saved.revision.id);
  const stillReadable = await fetch(
    `${base}/api/v1/previs-artifacts/${artifactId}/download`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  assert.equal(stillReadable.status, 200);
  await stillReadable.arrayBuffer();
  await call(`/api/v1/previs-groups/${group.id}`, "DELETE", {
    version: group.version,
  });
  const ungrouped = await call(`/api/v1/previs/${created.scene.id}`);
  assert.equal(ungrouped.scene.groupId, null);
  assert.equal(ungrouped.scene.thumbnailArtifactId, images[0].artifact.id);
  assert.equal(ungrouped.scene.description, latest.scene.description);
  const report = {
    passed: true,
    productionBundle: true,
    realPostgres17: true,
    realMinio: true,
    realChromium: browser.version(),
    cpuBackend: true,
    engineVersion: "0.20.0",
    scene: demo?.title ?? "遮挡与运镜验证",
    nodeCount: saved.revision.recipe.nodes.length,
    width: batchBody.width,
    height: batchBody.height,
    imageCount: images.length,
    h3FrameCount: videos[0].artifact.frameCount,
    h3ActualSeconds: videos[0].artifact.durationSeconds,
    imageImportIdempotent: true,
    sourceReimportChecksumMatches: true,
    groupsAndIntroductionsReusable: true,
    automaticAndManualThumbnails: true,
    groupDeletionKeepsScene: true,
    videoAndScriptReferencesPinned: true,
    aiInferenceSubmissions: providerSubmissions,
    browserEditAndSave: true,
    standardMp4ViaBrowserFrames: ordinaryVideos[0].artifact.frameCount,
    draftPreservedAcrossGroupAndMetadataChanges: true,
    introductionDraftSurvivesRevisionAndCover: true,
    delayedSavePreservedSceneSelection: true,
    movedAnimationTrack: true,
    keyframedFieldsRequireEditingTrack: true,
    browserErrors,
    archiveKeepsArtifacts: true,
    outputDir,
  };
  await writeFile(
    join(outputDir, "report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(logs.slice(-6000));
  throw error;
} finally {
  await browser?.close();
  if (child && child.exitCode === null) {
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGTERM");
    await Promise.race([exited, delay(5000)]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
  await database?.$client.end({ timeout: 5 });
  if (provider) await new Promise((resolve) => provider.close(resolve));
  for (const resource of resources.reverse()) await resource.stop();
}
