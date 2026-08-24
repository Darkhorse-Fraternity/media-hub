import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { and, desc, eq, inArray } from "@acme/db";
import {
  mediaPlatformAccount,
  mediaPublishTarget,
  user as User,
} from "@acme/db/schema";
import { mediaPlatformEnum } from "@acme/validators";

import { adminProcedure, protectedProcedure } from "../../trpc";
import {
  canManageMediaPlatformAccount,
  isMediaHubAdmin,
} from "./platform-account-access";

export const mediaAccountRouter = {
  /** 成员只看到自己的平台账号；管理员可查看全部账号。不返回 token。 */
  list: protectedProcedure
    .input(
      z
        .object({ platform: mediaPlatformEnum.optional() })
        .optional()
        .default({}),
    )
    .query(async ({ ctx, input }) => {
      const actorRole = (
        ctx.session.user as typeof ctx.session.user & { role?: string }
      ).role;
      const isAdmin = isMediaHubAdmin(actorRole);
      const rows = await ctx.db.query.mediaPlatformAccount.findMany({
        where: and(
          input.platform
            ? eq(mediaPlatformAccount.platform, input.platform)
            : undefined,
          isAdmin
            ? undefined
            : eq(mediaPlatformAccount.createdBy, ctx.session.user.id),
        ),
        orderBy: desc(mediaPlatformAccount.createdAt),
        columns: {
          id: true,
          platform: true,
          accountLabel: true,
          externalAccountId: true,
          scopes: true,
          tokenExpiresAt: true,
          createdAt: true,
          createdBy: true,
        },
      });
      const ownerIds = [...new Set(rows.map((row) => row.createdBy))];
      const owners = ownerIds.length
        ? await ctx.db.query.user.findMany({
            where: inArray(User.id, ownerIds),
            columns: { id: true, name: true, email: true },
          })
        : [];
      const ownerById = new Map(owners.map((owner) => [owner.id, owner]));

      return rows.map((row) => ({
        ...row,
        owner: ownerById.get(row.createdBy) ?? null,
        canManage: canManageMediaPlatformAccount({
          actorUserId: ctx.session.user.id,
          actorRole,
          ownerUserId: row.createdBy,
        }),
      }));
    }),

  /** 解绑账号（删除存的 token，对端 OAuth 不撤销 —— 用户自己去平台撤回） */
  remove: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.mediaPlatformAccount.findFirst({
        where: eq(mediaPlatformAccount.id, input.id),
      });
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      const actorRole = (
        ctx.session.user as typeof ctx.session.user & { role?: string }
      ).role;
      if (
        !canManageMediaPlatformAccount({
          actorUserId: ctx.session.user.id,
          actorRole,
          ownerUserId: existing.createdBy,
        })
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "只能解绑自己的平台账号",
        });
      }
      const linkedTarget = await ctx.db.query.mediaPublishTarget.findFirst({
        where: eq(mediaPublishTarget.accountId, input.id),
        columns: { id: true },
      });
      if (linkedTarget) {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "该账号已有发布记录，为保留历史记录暂不能解绑，可重新授权或由管理员转交归属",
        });
      }
      await ctx.db
        .delete(mediaPlatformAccount)
        .where(eq(mediaPlatformAccount.id, input.id));
      return { ok: true };
    }),

  /** 管理员将平台账号转交给另一个后台用户。 */
  assignOwner: adminProcedure
    .input(z.object({ id: z.string().min(1), userId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const [account, owner] = await Promise.all([
        ctx.db.query.mediaPlatformAccount.findFirst({
          where: eq(mediaPlatformAccount.id, input.id),
          columns: { id: true },
        }),
        ctx.db.query.user.findFirst({
          where: eq(User.id, input.userId),
          columns: { id: true, name: true, email: true },
        }),
      ]);
      if (!account) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "平台账号不存在",
        });
      }
      if (!owner) {
        throw new TRPCError({ code: "NOT_FOUND", message: "用户不存在" });
      }
      await ctx.db
        .update(mediaPlatformAccount)
        .set({ createdBy: owner.id, updatedAt: new Date() })
        .where(eq(mediaPlatformAccount.id, account.id));
      return { ok: true, owner };
    }),
} satisfies TRPCRouterRecord;
