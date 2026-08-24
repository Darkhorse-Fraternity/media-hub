import { createEnv } from "@t3-oss/env-core";
import { vercel } from "@t3-oss/env-core/presets-zod";
import { z } from "zod/v4";

import { authEnv } from "@acme/auth/env";

export const env = createEnv({
  clientPrefix: "VITE_",
  extends: [authEnv(), vercel()],
  shared: {
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
  },
  server: {
    APP_URL: z.url().optional(),
    TRUSTED_ORIGINS: z.string().optional(),
    AUTH_MIN_PASSWORD_LENGTH: z.coerce.number().int().min(8).default(8),
    AUTH_USE_SECURE_COOKIES: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),
    DATABASE_PATH: z.string().optional(),
    OLLAMA_BASE_URL: z.string().url().optional(),
    OLLAMA_MODEL: z.string().optional(),
    MEDIA_HUB_GENERATION_PROVIDER_URL: z.string().url().optional(),
    MEDIA_HUB_GENERATION_PROVIDER_TOKEN: z.string().optional(),
    CODEX_WORKER_URL: z.string().url().optional(),
    CODEX_WORKER_SOURCE: z.string().optional(),
  },
  client: {},
  runtimeEnv: process.env,
  skipValidation:
    !!process.env.CI || process.env.npm_lifecycle_event === "lint",
});
