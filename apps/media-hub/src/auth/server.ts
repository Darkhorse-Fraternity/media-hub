import { initAuth } from "@acme/auth";

import { env } from "~/env";
import { getBaseUrl } from "~/lib/url";

export const auth = initAuth({
  baseUrl: getBaseUrl(),
  secret: env.AUTH_SECRET,
  disableSignUp: true,
  minPasswordLength: env.AUTH_MIN_PASSWORD_LENGTH,
  useSecureCookies: env.AUTH_USE_SECURE_COOKIES,
  trustedOrigins:
    env.TRUSTED_ORIGINS?.split(",")
      .map((s) => s.trim())
      .filter(Boolean) ?? [],
});
