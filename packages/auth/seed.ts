import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";

import { and, eq } from "@acme/db";
import { db } from "@acme/db/client";
import { account, user } from "@acme/db/schema";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

async function seedAdmin(): Promise<void> {
  const name = requiredEnv("MEDIA_HUB_SEED_ADMIN_NAME");
  const email = requiredEnv("MEDIA_HUB_SEED_ADMIN_EMAIL").toLowerCase();
  const password = requiredEnv("MEDIA_HUB_SEED_ADMIN_PASSWORD");
  if (password.length < 8) {
    throw new Error(
      "MEDIA_HUB_SEED_ADMIN_PASSWORD must be at least 8 characters",
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const action = await db.transaction(async (tx) => {
    const now = new Date();
    const existing = await tx.query.user.findFirst({
      where: eq(user.email, email),
    });

    if (existing) {
      await tx
        .update(user)
        .set({
          name,
          role: "admin",
          banned: false,
          banReason: null,
          banExpires: null,
          updatedAt: now,
        })
        .where(eq(user.id, existing.id));

      const credential = await tx.query.account.findFirst({
        where: and(
          eq(account.userId, existing.id),
          eq(account.providerId, "credential"),
        ),
      });
      if (credential) {
        await tx
          .update(account)
          .set({ password: passwordHash, updatedAt: now })
          .where(eq(account.id, credential.id));
      } else {
        await tx.insert(account).values({
          id: randomUUID(),
          accountId: existing.id,
          providerId: "credential",
          userId: existing.id,
          password: passwordHash,
          createdAt: now,
          updatedAt: now,
        });
      }
      return "Updated";
    }

    const userId = randomUUID();
    await tx.insert(user).values({
      id: userId,
      name,
      email,
      emailVerified: true,
      role: "admin",
      banned: false,
      createdAt: now,
      updatedAt: now,
    });
    await tx.insert(account).values({
      id: randomUUID(),
      accountId: userId,
      providerId: "credential",
      userId,
      password: passwordHash,
      createdAt: now,
      updatedAt: now,
    });
    return "Created";
  });

  console.log(`${action} seed administrator: ${email}`);
}

seedAdmin().then(
  () => {
    process.exitCode = 0;
    setTimeout(() => process.exit(0), 100);
  },
  (error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exitCode = 1;
    setTimeout(() => process.exit(1), 100);
  },
);
