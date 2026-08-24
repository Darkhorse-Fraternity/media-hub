import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { and, asc, count, desc, eq, gte, like, lte } from "@acme/db";
import { user as User } from "@acme/db/schema";
import {
  createUserSchema,
  PaginationDateQuerySchema,
  updateUserSchema,
} from "@acme/validators";

import { adminProcedure } from "../../trpc";

const createMediaHubUserSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.email("Please enter a valid email address"),
  password: z
    .string()
    .min(6, "Password must be at least 6 characters")
    .max(128, "Password cannot exceed 128 characters"),
  role: z.enum(["admin", "member"]).default("member"),
});

const setUserPasswordSchema = z.object({
  id: z.string().min(1),
  password: z
    .string()
    .min(6, "Password must be at least 6 characters")
    .max(128, "Password cannot exceed 128 characters"),
});

export const adminUserRouter = {
  all: adminProcedure.query(async ({ ctx }) => {
    return ctx.db.query.user.findMany({
      orderBy: desc(User.createdAt),
    });
  }),

  pagination: adminProcedure
    .input(
      z.object({
        ...PaginationDateQuerySchema.shape,
        userId: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const {
        pageSize = 10,
        pageIndex = 0,
        filters = [],
        sorting = [{ id: "createdAt", desc: true }],
        dateRange,
      } = input;

      const whereConditions = [];

      if (dateRange?.from) {
        whereConditions.push(gte(User.createdAt, dateRange.from));
      }
      if (dateRange?.to) {
        whereConditions.push(lte(User.createdAt, dateRange.to));
      }

      for (const filter of filters) {
        switch (filter.id) {
          case "name":
            if (filter.value) {
              whereConditions.push(like(User.name, `%${filter.value}%`));
            }
            break;
          case "email":
            if (filter.value) {
              whereConditions.push(like(User.email, `%${filter.value}%`));
            }
            break;
          case "banned":
            if (typeof filter.value === "boolean") {
              whereConditions.push(eq(User.banned, filter.value));
            }
            break;
        }
      }

      const whereClause =
        whereConditions.length > 0 ? and(...whereConditions) : undefined;

      const orderByConditions = [];
      for (const sort of sorting) {
        switch (sort.id) {
          case "name":
            orderByConditions.push(
              sort.desc ? desc(User.name) : asc(User.name),
            );
            break;
          case "email":
            orderByConditions.push(
              sort.desc ? desc(User.email) : asc(User.email),
            );
            break;
          case "role":
            orderByConditions.push(
              sort.desc ? desc(User.role) : asc(User.role),
            );
            break;
          case "banned":
            orderByConditions.push(
              sort.desc ? desc(User.banned) : asc(User.banned),
            );
            break;
          default:
            orderByConditions.push(
              sort.desc ? desc(User.createdAt) : asc(User.createdAt),
            );
            break;
        }
      }

      const [totalResult] = await ctx.db
        .select({ count: count() })
        .from(User)
        .where(whereClause);

      const total = totalResult?.count ?? 0;

      const data = await ctx.db.query.user.findMany({
        where: whereClause,
        orderBy: orderByConditions,
        limit: pageSize,
        offset: pageIndex * pageSize,
      });

      const pageCount = Math.ceil(total / pageSize);
      const hasNextPage = pageIndex < pageCount - 1;
      const hasPreviousPage = pageIndex > 0;

      return {
        data,
        total,
        pageCount,
        pageIndex,
        pageSize,
        hasNextPage,
        hasPreviousPage,
      };
    }),

  update: adminProcedure
    .input(updateUserSchema)
    .mutation(async ({ ctx, input }) => {
      const { id, ...updateData } = input;

      if (id === ctx.session.user.id && "role" in updateData) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You cannot modify your own role",
        });
      }

      await ctx.db.update(User).set(updateData).where(eq(User.id, id));

      return { success: true };
    }),

  getById: adminProcedure.input(z.string()).query(async ({ ctx, input }) => {
    const userData = await ctx.db.query.user.findFirst({
      where: eq(User.id, input),
    });

    if (!userData) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "User not found",
      });
    }

    return userData;
  }),

  create: adminProcedure
    .input(createUserSchema)
    .mutation(async ({ ctx, input }) => {
      const existingUser = await ctx.db.query.user.findFirst({
        where: eq(User.email, input.email),
      });

      if (existingUser) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "A user with this email already exists",
        });
      }

      const betterAuthRole = input.role === "admin" ? "admin" : "user";

      const result = await ctx.authApi.createUser({
        body: {
          name: input.name,
          email: input.email,
          password: input.password,
          role: betterAuthRole,
        },
      });

      const userId = result.user.id;
      await ctx.db
        .update(User)
        .set({ role: input.role })
        .where(eq(User.id, userId));

      return { success: true, user: result };
    }),

  /** Media Hub 使用 6 位临时密码，创建后可在账号管理中立即修改。 */
  createMediaHub: adminProcedure
    .input(createMediaHubUserSchema)
    .mutation(async ({ ctx, input }) => {
      const existingUser = await ctx.db.query.user.findFirst({
        where: eq(User.email, input.email),
      });

      if (existingUser) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "A user with this email already exists",
        });
      }

      const result = await ctx.authApi.createUser({
        body: {
          name: input.name,
          email: input.email,
          password: input.password,
          role: input.role === "admin" ? "admin" : "user",
        },
      });

      await ctx.db
        .update(User)
        .set({ role: input.role })
        .where(eq(User.id, result.user.id));

      return { success: true, user: result };
    }),

  setPassword: adminProcedure
    .input(setUserPasswordSchema)
    .mutation(async ({ ctx, input }) => {
      const existingUser = await ctx.db.query.user.findFirst({
        where: eq(User.id, input.id),
      });

      if (!existingUser) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      await ctx.authApi.setUserPassword({
        body: {
          userId: input.id,
          newPassword: input.password,
        },
      });

      return { success: true };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (input.id === ctx.session.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You cannot delete your own account",
        });
      }

      const existingUser = await ctx.db.query.user.findFirst({
        where: eq(User.id, input.id),
      });

      if (!existingUser) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      await ctx.db.delete(User).where(eq(User.id, input.id));
      return { success: true };
    }),
} satisfies TRPCRouterRecord;
