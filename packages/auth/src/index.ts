import type { BetterAuthOptions } from "better-auth";
import bcrypt from "bcryptjs";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins";
import { reactStartCookies } from "better-auth/react-start";

import { db } from "@acme/db/client";

export function initAuth(options: {
  baseUrl: string;
  secret: string | undefined;
  trustedOrigins?: string[];
  disableSignUp?: boolean;
  minPasswordLength?: number;
  useSecureCookies?: boolean;
}) {
  const config = {
    database: drizzleAdapter(db, {
      provider: "pg",
    }),
    baseURL: options.baseUrl,
    secret: options.secret,
    trustedOrigins: options.trustedOrigins,
    emailAndPassword: {
      enabled: true,
      disableSignUp: options.disableSignUp ?? false,
      requireEmailVerification: false,
      minPasswordLength: options.minPasswordLength ?? 8,
      maxPasswordLength: 128,
      autoSignIn: true,
      password: {
        hash: async (password: string) => {
          const saltRounds = 12;
          return await bcrypt.hash(password, saltRounds);
        },
        verify: async ({
          hash,
          password,
        }: {
          hash: string;
          password: string;
        }) => {
          return await bcrypt.compare(password, hash);
        },
      },
    },
    plugins: [admin(), reactStartCookies()],
    advanced: {
      useSecureCookies: options.useSecureCookies,
    },
    onAPIError: {
      onError(error: unknown, ctx: unknown) {
        console.error("BETTER AUTH API ERROR", error, ctx);
      },
    },
  } satisfies BetterAuthOptions;

  return betterAuth(config);
}

export type Auth = ReturnType<typeof initAuth>;
export type Session = Auth["$Infer"]["Session"];
