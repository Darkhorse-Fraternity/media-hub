import type { TRPCRouterRecord } from "@trpc/server";

import {
  changeMediaPrevisRenderSchema,
  createMediaPrevisGroupSchema,
  createMediaPrevisRenderSchema,
  createMediaPrevisRevisionSchema,
  createMediaPrevisSceneSchema,
  deleteMediaPrevisGroupSchema,
  forkMediaPrevisSceneSchema,
  importMediaPrevisImagesSchema,
  listMediaPrevisRenderItemsSchema,
  listMediaPrevisRendersSchema,
  listMediaPrevisRevisionsSchema,
  listMediaPrevisScenesSchema,
  mediaPrevisArtifactIdSchema,
  mediaPrevisRenderIdSchema,
  mediaPrevisRevisionIdSchema,
  mediaPrevisSceneIdSchema,
  updateMediaPrevisGroupSchema,
  updateMediaPrevisSceneSchema,
} from "@acme/validators";

import { protectedProcedure } from "../../trpc";
import {
  createPrevisGroup,
  deletePrevisGroup,
  listPrevisGroups,
  updatePrevisGroup,
} from "./previs-group-service";
import {
  assertPrevisEnabled,
  changePrevisRender,
  createPrevisRender,
  getPrevisRender,
  importPrevisImages,
  listPrevisRenderItems,
  listPrevisRenders,
  ownedPrevisArtifact,
  requestPrevisThumbnail,
} from "./previs-render-service";
import { startPrevisScheduler } from "./previs-render-worker";
import {
  createPrevisRevision,
  createPrevisScene,
  forkPrevisScene,
  getPrevisRevision,
  getPrevisScene,
  listPrevisRevisions,
  listPrevisScenes,
  updatePrevisScene,
} from "./previs-service";

startPrevisScheduler();
const previsProcedure = protectedProcedure.use(({ next }) => {
  assertPrevisEnabled();
  return next();
});

export const mediaPrevisRouter = {
  groups: previsProcedure.query(({ ctx }) =>
    listPrevisGroups(ctx.db, ctx.session.user.id),
  ),
  createGroup: previsProcedure
    .input(createMediaPrevisGroupSchema)
    .mutation(({ ctx, input }) =>
      createPrevisGroup(ctx.db, ctx.session.user.id, input),
    ),
  updateGroup: previsProcedure
    .input(updateMediaPrevisGroupSchema)
    .mutation(({ ctx, input }) =>
      updatePrevisGroup(ctx.db, ctx.session.user.id, input),
    ),
  deleteGroup: previsProcedure
    .input(deleteMediaPrevisGroupSchema)
    .mutation(({ ctx, input }) =>
      deletePrevisGroup(ctx.db, ctx.session.user.id, input),
    ),
  thumbnail: previsProcedure
    .input(mediaPrevisSceneIdSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await requestPrevisThumbnail(
        ctx.db,
        ctx.session.user.id,
        input.id,
        true,
      );
      startPrevisScheduler();
      return result;
    }),
  create: previsProcedure
    .input(createMediaPrevisSceneSchema)
    .mutation(({ ctx, input }) =>
      createPrevisScene(ctx.db, ctx.session.user.id, input),
    ),
  list: previsProcedure
    .input(listMediaPrevisScenesSchema)
    .query(({ ctx, input }) =>
      listPrevisScenes(ctx.db, ctx.session.user.id, input),
    ),
  get: previsProcedure
    .input(mediaPrevisSceneIdSchema)
    .query(({ ctx, input }) =>
      getPrevisScene(ctx.db, ctx.session.user.id, input.id),
    ),
  update: previsProcedure
    .input(updateMediaPrevisSceneSchema)
    .mutation(({ ctx, input }) =>
      updatePrevisScene(ctx.db, ctx.session.user.id, input),
    ),
  createRevision: previsProcedure
    .input(createMediaPrevisRevisionSchema)
    .mutation(({ ctx, input }) =>
      createPrevisRevision(ctx.db, ctx.session.user.id, input),
    ),
  revisions: previsProcedure
    .input(listMediaPrevisRevisionsSchema)
    .query(({ ctx, input }) =>
      listPrevisRevisions(ctx.db, ctx.session.user.id, input),
    ),
  revision: previsProcedure
    .input(mediaPrevisRevisionIdSchema)
    .query(({ ctx, input }) =>
      getPrevisRevision(ctx.db, ctx.session.user.id, input.revisionId),
    ),
  fork: previsProcedure
    .input(forkMediaPrevisSceneSchema)
    .mutation(({ ctx, input }) =>
      forkPrevisScene(ctx.db, ctx.session.user.id, input),
    ),
  createRender: previsProcedure
    .input(createMediaPrevisRenderSchema)
    .mutation(async ({ ctx, input }) => {
      const render = await createPrevisRender(
        ctx.db,
        ctx.session.user.id,
        input,
      );
      startPrevisScheduler();
      return getPrevisRender(ctx.db, ctx.session.user.id, render.id);
    }),
  renders: previsProcedure
    .input(listMediaPrevisRendersSchema)
    .query(({ ctx, input }) =>
      listPrevisRenders(ctx.db, ctx.session.user.id, input),
    ),
  render: previsProcedure
    .input(mediaPrevisRenderIdSchema)
    .query(({ ctx, input }) =>
      getPrevisRender(ctx.db, ctx.session.user.id, input.renderId),
    ),
  renderItems: previsProcedure
    .input(listMediaPrevisRenderItemsSchema)
    .query(({ ctx, input }) =>
      listPrevisRenderItems(ctx.db, ctx.session.user.id, input),
    ),
  cancelRender: previsProcedure
    .input(changeMediaPrevisRenderSchema)
    .mutation(({ ctx, input }) =>
      changePrevisRender(ctx.db, ctx.session.user.id, input, "cancel"),
    ),
  retryRender: previsProcedure
    .input(changeMediaPrevisRenderSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await changePrevisRender(
        ctx.db,
        ctx.session.user.id,
        input,
        "retry",
      );
      startPrevisScheduler();
      return result;
    }),
  importImages: previsProcedure
    .input(importMediaPrevisImagesSchema)
    .mutation(({ ctx, input }) =>
      importPrevisImages(ctx.db, ctx.session.user.id, input),
    ),
  artifact: previsProcedure
    .input(mediaPrevisArtifactIdSchema)
    .query(async ({ ctx, input }) => {
      const { artifact, item, render } = await ownedPrevisArtifact(
        ctx.db,
        ctx.session.user.id,
        input.artifactId,
      );
      return {
        ...artifact,
        spec: item.spec,
        sceneId: render.sceneId,
        renderId: render.id,
        url: `/api/media-hub/previs-artifacts/${artifact.id}`,
      };
    }),
} satisfies TRPCRouterRecord;
