import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { eq } from "@acme/db";
import { mediaSystemSetting, mediaUserPreference } from "@acme/db/schema";

import { adminProcedure, protectedProcedure } from "../../trpc";
import {
  mediaSystemSettingId,
  readMediaSystemSetting,
  resolveMediaSystemSetting,
} from "./system-settings";

const userPreferenceSchema = z.object({
  contentLanguage: z.enum(["zh", "en"]),
  durationSeconds: z.union([
    z.literal(15),
    z.literal(30),
    z.literal(45),
    z.literal(60),
  ]),
  resolution: z.enum([
    "1344x768",
    "768x1344",
    "960x544",
    "544x960",
    "768x768",
    "1280x704",
    "704x1280",
  ]),
  youtubePrivacyStatus: z.enum(["public", "unlisted", "private"]),
  youtubeCategoryId: z.string().trim().min(1).max(10),
  youtubeNotifySubscribers: z.boolean(),
  instagramShareToFeed: z.boolean(),
});

const httpUrlOrEmpty = z
  .string()
  .trim()
  .max(500)
  .refine(
    (value) => value === "" || /^https?:\/\//i.test(value),
    "请输入以 http:// 或 https:// 开头的地址",
  );

const systemSettingSchema = z.object({
  codexWorkerUrl: httpUrlOrEmpty,
  codexWorkerSource: z.string().trim().max(100),
  codexTimeoutMs: z.number().int().min(10_000).max(900_000),
  ollamaBaseUrl: httpUrlOrEmpty,
  ollamaModel: z.string().trim().min(1).max(200),
  feishuReviewChatId: z.string().trim().max(200),
});

const defaultUserPreference = {
  contentLanguage: "en" as const,
  durationSeconds: 30 as const,
  resolution: "1344x768" as const,
  youtubePrivacyStatus: "public" as const,
  youtubeCategoryId: "22",
  youtubeNotifySubscribers: true,
  instagramShareToFeed: true,
};

function nullable(value: string): string | null {
  return value.trim() || null;
}

export const mediaSettingsRouter = {
  me: protectedProcedure.query(async ({ ctx }) => {
    const stored = await ctx.db.query.mediaUserPreference.findFirst({
      where: eq(mediaUserPreference.userId, ctx.session.user.id),
    });
    return stored
      ? {
          contentLanguage: stored.contentLanguage as "zh" | "en",
          durationSeconds: stored.durationSeconds as 15 | 30 | 45 | 60,
          resolution: stored.resolution as
            | "1344x768"
            | "768x1344"
            | "960x544"
            | "544x960"
            | "768x768"
            | "1280x704"
            | "704x1280",
          youtubePrivacyStatus: stored.youtubePrivacyStatus as
            | "public"
            | "unlisted"
            | "private",
          youtubeCategoryId: stored.youtubeCategoryId,
          youtubeNotifySubscribers: stored.youtubeNotifySubscribers,
          instagramShareToFeed: stored.instagramShareToFeed,
        }
      : defaultUserPreference;
  }),

  updateMe: protectedProcedure
    .input(userPreferenceSchema)
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      await ctx.db
        .insert(mediaUserPreference)
        .values({
          userId: ctx.session.user.id,
          ...input,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: mediaUserPreference.userId,
          set: { ...input, updatedAt: now },
        });
      return { ...input, updatedAt: now };
    }),

  system: adminProcedure.query(async () => {
    const [stored, effective] = await Promise.all([
      readMediaSystemSetting(),
      resolveMediaSystemSetting(),
    ]);
    return {
      values: {
        codexWorkerUrl: stored?.codexWorkerUrl ?? "",
        codexWorkerSource: stored?.codexWorkerSource ?? "",
        codexTimeoutMs: stored?.codexTimeoutMs ?? 180_000,
        ollamaBaseUrl: stored?.ollamaBaseUrl ?? "",
        ollamaModel: stored?.ollamaModel ?? "qwen3-vl:32b",
        feishuReviewChatId: stored?.feishuReviewChatId ?? "",
      },
      effective,
      updatedAt: stored?.updatedAt ?? null,
    };
  }),

  updateSystem: adminProcedure
    .input(systemSettingSchema)
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      const values = {
        codexWorkerUrl: nullable(input.codexWorkerUrl),
        codexWorkerSource: nullable(input.codexWorkerSource),
        codexTimeoutMs: input.codexTimeoutMs,
        ollamaBaseUrl: nullable(input.ollamaBaseUrl),
        ollamaModel: input.ollamaModel,
        feishuReviewChatId: nullable(input.feishuReviewChatId),
        updatedBy: ctx.session.user.id,
        updatedAt: now,
      };
      await ctx.db
        .insert(mediaSystemSetting)
        .values({
          id: mediaSystemSettingId,
          ...values,
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: mediaSystemSetting.id,
          set: values,
        });
      return { updatedAt: now };
    }),
} satisfies TRPCRouterRecord;
