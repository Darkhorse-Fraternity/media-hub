import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { eq } from "@acme/db";
import { mediaSystemSetting, mediaUserPreference } from "@acme/db/schema";

import { adminProcedure, protectedProcedure } from "../../trpc";
import { getMediaGenerationProviderHealth } from "./generation";
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
  feishuWebhookUrl: z
    .string()
    .trim()
    .max(500)
    .refine(
      (value) =>
        value === "" ||
        /^https:\/\/open\.feishu\.cn\/open-apis\/bot\/v2\/hook\/[A-Za-z0-9-]+$/i.test(
          value,
        ),
      "请输入有效的飞书机器人 Webhook 地址",
    ),
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
  h3GenerationProfile: z.string().trim().max(200),
  h3EditProfile: z.string().trim().max(200),
  codexWorkerUrl: httpUrlOrEmpty,
  codexWorkerSource: z.string().trim().max(100),
  codexTimeoutMs: z.number().int().min(10_000).max(900_000),
  ollamaBaseUrl: httpUrlOrEmpty,
  ollamaModel: z.string().trim().min(1).max(200),
});

const defaultUserPreference = {
  contentLanguage: "en" as const,
  durationSeconds: 30 as const,
  resolution: "1344x768" as const,
  youtubePrivacyStatus: "public" as const,
  youtubeCategoryId: "22",
  youtubeNotifySubscribers: true,
  instagramShareToFeed: true,
  feishuWebhookUrl: "",
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
          feishuWebhookUrl: stored.feishuWebhookUrl ?? "",
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
          feishuWebhookUrl: nullable(input.feishuWebhookUrl),
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: mediaUserPreference.userId,
          set: {
            ...input,
            feishuWebhookUrl: nullable(input.feishuWebhookUrl),
            updatedAt: now,
          },
        });
      return { ...input, updatedAt: now };
    }),

  system: adminProcedure.query(async () => {
    const [stored, effective, providerHealth] = await Promise.all([
      readMediaSystemSetting(),
      resolveMediaSystemSetting(),
      getMediaGenerationProviderHealth(false),
    ]);
    return {
      values: {
        h3GenerationProfile: stored?.h3GenerationProfile ?? "",
        h3EditProfile: stored?.h3EditProfile ?? "",
        codexWorkerUrl: stored?.codexWorkerUrl ?? "",
        codexWorkerSource: stored?.codexWorkerSource ?? "",
        codexTimeoutMs: stored?.codexTimeoutMs ?? 180_000,
        ollamaBaseUrl: stored?.ollamaBaseUrl ?? "",
        ollamaModel: stored?.ollamaModel ?? "qwen3-vl:32b",
      },
      effective,
      availableH3Profiles: providerHealth.profiles,
      h3ProviderStatus: providerHealth.status,
      h3ProviderMessage: providerHealth.message,
      updatedAt: stored?.updatedAt ?? null,
    };
  }),

  updateSystem: adminProcedure
    .input(systemSettingSchema)
    .mutation(async ({ ctx, input }) => {
      const requestedProfiles = [
        { id: input.h3GenerationProfile, kind: "generate" as const },
        { id: input.h3EditProfile, kind: "edit" as const },
      ].filter((profile) => profile.id.length > 0);
      if (requestedProfiles.length) {
        const health = await getMediaGenerationProviderHealth(true);
        if (health.status !== "healthy") {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `H3 Provider 当前不可用，不能校验工作流：${health.message}`,
          });
        }
        for (const requested of requestedProfiles) {
          const profile = health.profiles.find(
            (candidate) => candidate.id === requested.id,
          );
          if (!profile) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `H3 Provider 未注册工作流 ${requested.id}`,
            });
          }
          if (profile.kind !== requested.kind) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `工作流 ${requested.id} 不支持${requested.kind === "edit" ? "视频编辑" : "视频生成"}`,
            });
          }
        }
      }
      const now = new Date();
      const values = {
        h3GenerationProfile: nullable(input.h3GenerationProfile),
        h3EditProfile: nullable(input.h3EditProfile),
        codexWorkerUrl: nullable(input.codexWorkerUrl),
        codexWorkerSource: nullable(input.codexWorkerSource),
        codexTimeoutMs: input.codexTimeoutMs,
        ollamaBaseUrl: nullable(input.ollamaBaseUrl),
        ollamaModel: input.ollamaModel,
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
