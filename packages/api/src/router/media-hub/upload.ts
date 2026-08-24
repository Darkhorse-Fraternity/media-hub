import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";

import { getMediaHubPresignedUploadUrl } from "@acme/storage";
import { mediaUploadPresignSchema } from "@acme/validators";

import { protectedProcedure } from "../../trpc";

/** 单文件上限：1.5 GB（够 4K 短视频；YouTube Data API 单条上限 256GB，实际不会到那） */
const MAX_VIDEO_BYTES = 1_500_000_000;
/** 封面图 5 MB 上限 */
const MAX_COVER_BYTES = 5_000_000;

const ALLOWED_VIDEO_TYPES = new Set([
  "video/mp4",
  "video/quicktime", // .mov
  "video/x-matroska", // .mkv
]);

const ALLOWED_COVER_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function safeFilenameSuffix(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot < 0 || dot === filename.length - 1) return "";
  const ext = filename
    .slice(dot + 1)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return ext ? `.${ext}` : "";
}

export const mediaUploadRouter = {
  /** 拿一个预签名 PUT URL，前端直传美区 S3 */
  presign: protectedProcedure
    .input(mediaUploadPresignSchema)
    .mutation(async ({ ctx, input }) => {
      const isVideo = input.kind === "video";

      const limit = isVideo ? MAX_VIDEO_BYTES : MAX_COVER_BYTES;
      if (input.sizeBytes > limit) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${input.kind} 超过上限 ${Math.round(limit / 1_000_000)} MB`,
        });
      }

      const allowed = isVideo ? ALLOWED_VIDEO_TYPES : ALLOWED_COVER_TYPES;
      if (!allowed.has(input.contentType)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `不支持的 ${input.kind} contentType: ${input.contentType}`,
        });
      }

      // S3 key 结构：media-hub/<kind>/<userId>/<uuid><ext>
      // 按 user 分目录便于排查和按用户配额（暂未实施）
      const key = `media-hub/${input.kind}/${ctx.session.user.id}/${crypto.randomUUID()}${safeFilenameSuffix(input.filename)}`;

      const url = await getMediaHubPresignedUploadUrl(
        key,
        input.contentType,
        3600, // 1 小时上传窗口
      );

      return {
        key,
        url,
        contentType: input.contentType,
        expiresIn: 3600,
      };
    }),
} satisfies TRPCRouterRecord;
