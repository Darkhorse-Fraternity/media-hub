import { TRPCError } from "@trpc/server";
import { ZodError } from "zod/v4";

import { authenticateMediaHubAgentToken, mediaHubAppRouter } from "@acme/api";
import { db } from "@acme/db/client";

import { auth } from "~/auth/server";

export class AgentApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code = "bad_request",
  ) {
    super(message);
  }
}

export async function createAgentApiCaller(request: Request) {
  const actor = await authenticateMediaHubAgentToken(
    request.headers.get("authorization"),
  );
  if (!actor) {
    throw new AgentApiError(
      401,
      "Invalid or missing Bearer token",
      "unauthorized",
    );
  }

  const now = new Date();
  const caller = mediaHubAppRouter.createCaller({
    authApi: auth.api,
    db,
    session: {
      user: actor,
      session: {
        id: "media-hub-agent-api",
        userId: actor.id,
        token: "media-hub-agent-api",
        ipAddress: null,
        userAgent: request.headers.get("user-agent"),
        createdAt: now,
        updatedAt: now,
        expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
      },
    },
  });
  return { actor, caller };
}

export async function readAgentJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new AgentApiError(400, "Request body must be valid JSON");
  }
}

export function agentJson(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function handleAgentApiError(error: unknown): Response {
  if (error instanceof AgentApiError) {
    return agentJson(
      { error: { code: error.code, message: error.message } },
      error.status,
    );
  }
  if (error instanceof ZodError) {
    return agentJson(
      {
        error: {
          code: "validation_error",
          message: "Request validation failed",
          details: error.issues,
        },
      },
      400,
    );
  }
  if (error instanceof TRPCError) {
    const statusByCode: Partial<Record<TRPCError["code"], number>> = {
      BAD_REQUEST: 400,
      UNAUTHORIZED: 401,
      FORBIDDEN: 403,
      NOT_FOUND: 404,
      CONFLICT: 409,
      TOO_MANY_REQUESTS: 429,
    };
    return agentJson(
      { error: { code: error.code.toLowerCase(), message: error.message } },
      statusByCode[error.code] ?? 500,
    );
  }

  console.error("Media Hub Agent API request failed", error);
  return agentJson(
    { error: { code: "internal_error", message: "Internal server error" } },
    500,
  );
}
