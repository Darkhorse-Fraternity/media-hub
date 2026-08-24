import { eq } from "@acme/db";
import { mediaSystemSetting } from "@acme/db/schema";

import { resolveMediaSystemSettingValues } from "./system-settings-policy";

export const mediaSystemSettingId = "default";

export async function readMediaSystemSetting() {
  const { db } = await import("@acme/db/client");
  return db.query.mediaSystemSetting.findFirst({
    where: eq(mediaSystemSetting.id, mediaSystemSettingId),
  });
}

export async function resolveMediaSystemSetting() {
  const stored = await readMediaSystemSetting();
  return resolveMediaSystemSettingValues(stored, process.env);
}
