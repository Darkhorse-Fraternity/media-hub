import http from "node:http";
import https from "node:https";

import { resolveMediaSystemSetting } from "./system-settings";

interface CodexWorkerResponse {
  result?: string;
  error?: string;
}

interface CodexWorkerStreamEvent extends CodexWorkerResponse {
  type?: "progress" | "result" | "error";
  status?: string;
}

interface VideoPromptInput {
  prompt: string;
  title?: string;
  durationSeconds: number;
  hasReferenceImage: boolean;
  language: "zh" | "en";
}

interface PlatformDescriptionInput {
  videoJobId: string;
  prompt: string;
  title?: string;
  durationSeconds: number;
  platform: "youtube" | "instagram";
  accountLabel?: string;
  currentDescription?: string;
  language: "zh" | "en";
}

function outputLanguageInstruction(language: "zh" | "en"): string {
  return language === "zh"
    ? "Write the entire returned content in natural Simplified Chinese. Translate source material when needed, while preserving proper nouns and factual meaning."
    : "Write the entire returned content in natural English. Translate source material when needed, while preserving proper nouns and factual meaning.";
}

function compactLines(lines: (string | undefined)[]): string {
  return lines.filter((line): line is string => Boolean(line)).join("\n");
}

export function buildVideoPromptOptimizationPrompt(
  input: VideoPromptInput,
): string {
  return compactLines([
    "You are optimizing a production prompt for MiniMax H3 video generation.",
    "Do not inspect files, browse, or use tools. Work only from the content below.",
    "Preserve the user's subject, intent, and factual constraints.",
    outputLanguageInstruction(input.language),
    `Target duration: ${input.durationSeconds} seconds.`,
    "Use the target duration only to plan pacing. Do not mention the duration, seconds, timestamps, segment counts, or planning notes in the returned prompt unless the original prompt explicitly requests them.",
    input.hasReferenceImage
      ? "A reference image is supplied. Preserve its subject identity, appearance, and scene continuity."
      : "No reference image is supplied. Make the subject and environment visually explicit.",
    "Improve the prompt with a coherent timed action arc, camera movement, framing, lighting, motion continuity, and a clear ending.",
    "Avoid contradictory directions, unsupported product claims, on-screen text, logos, subtitles, watermarks, and prompt commentary.",
    "Return only the optimized prompt as plain text, with no heading, quotes, markdown, or explanation.",
    input.title ? `Working title: ${input.title}` : undefined,
    "Original prompt:",
    input.prompt,
  ]);
}

export function removeGeneratedDurationLead(
  value: string,
  durationSeconds: number,
): string {
  const duration = String(durationSeconds).replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
  const durationLead = new RegExp(
    `^\\s*(?:(?:视频(?:总)?时长|时长|duration)\\s*[:：]?\\s*)?(?:约\\s*)?${duration}\\s*(?:秒(?:钟)?|s(?:ec(?:ond)?s?)?)\\s*[,，、:：;；。\\-—]+\\s*`,
    "i",
  );

  return value.replace(durationLead, "").trim();
}

export function buildPlatformDescriptionPrompt(
  input: PlatformDescriptionInput,
): string {
  const platformRules =
    input.platform === "youtube"
      ? "Write a concise YouTube description with a strong opening, 2–4 short paragraphs, a natural call to action, and 3–5 relevant hashtags. Keep it under 1,500 characters."
      : "Write an Instagram Reels caption with a strong first line, concise story context, a natural engagement question or call to action, and 5–10 relevant hashtags. Keep it under 1,800 characters.";

  return compactLines([
    "You are a senior social media editor for Pumpkii, a pet companion robot brand.",
    "Do not inspect files, browse, or use tools. Work only from the content below.",
    platformRules,
    outputLanguageInstruction(input.language),
    "Preserve factual constraints and do not invent features, results, awards, prices, or guarantees.",
    "Make the copy ready to publish. Return only the final description as plain text, with no heading, quotes, markdown fence, or explanation.",
    `This copy is bound to generated video job: ${input.videoJobId}.`,
    `Video duration: ${input.durationSeconds} seconds.`,
    `Platform: ${input.platform}`,
    input.accountLabel ? `Account: ${input.accountLabel}` : undefined,
    input.title ? `Video title: ${input.title}` : undefined,
    "Video generation prompt:",
    input.prompt,
    input.currentDescription
      ? `Current description to improve:\n${input.currentDescription}`
      : "Create a new description because no current description was provided.",
  ]);
}

export function normalizeCodexCopy(value: string, maxLength: number): string {
  let normalized = value.trim();
  const fenced = /^```(?:text|markdown|md)?\s*([\s\S]*?)\s*```$/i.exec(
    normalized,
  );
  if (fenced?.[1]) normalized = fenced[1].trim();
  if (!normalized) throw new Error("Codex Worker 返回了空内容");
  return normalized.slice(0, maxLength).trim();
}

function positiveTimeout(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseStreamEvent(line: string): CodexWorkerStreamEvent | undefined {
  try {
    return JSON.parse(line) as CodexWorkerStreamEvent;
  } catch {
    return undefined;
  }
}

export function parseCodexWorkerBody(
  bodyText: string,
  contentType: string,
  statusCode: number,
  maxLength: number,
): string {
  if (!contentType.includes("application/x-ndjson")) {
    let body: CodexWorkerResponse;
    try {
      body = JSON.parse(bodyText) as CodexWorkerResponse;
    } catch {
      throw new Error(`Codex Worker 返回了无效响应（HTTP ${statusCode}）`);
    }
    if (
      statusCode < 200 ||
      statusCode >= 300 ||
      typeof body.result !== "string"
    ) {
      throw new Error(
        body.error ?? `Codex Worker 请求失败（HTTP ${statusCode}）`,
      );
    }
    return normalizeCodexCopy(body.result, maxLength);
  }

  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(`Codex Worker 请求失败（HTTP ${statusCode}）`);
  }

  let result: string | undefined;
  for (const line of bodyText.split("\n")) {
    const event = parseStreamEvent(line.trim());
    if (!event) continue;
    if (event.type === "error") {
      throw new Error(event.error ?? "Codex Worker 执行失败");
    }
    if (event.type === "result" && typeof event.result === "string") {
      result = event.result;
    }
  }

  if (result === undefined) throw new Error("Codex Worker 未返回结果");
  return normalizeCodexCopy(result, maxLength);
}

export async function readCodexWorkerResponse(
  response: Response,
  maxLength: number,
): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "";
  return parseCodexWorkerBody(
    await response.text(),
    contentType,
    response.status,
    maxLength,
  );
}

class CodexWorkerConnectionError extends Error {
  override name = "CodexWorkerConnectionError";
}

function queryCodexWorkerOnce(
  url: string,
  prompt: string,
  source: string,
  timeoutMs: number,
  maxLength: number,
): Promise<string> {
  const connectTimeoutMs = 15_000;
  const queueGraceMs = 120_000;
  const requestBody = JSON.stringify({
    prompt,
    source,
    sandbox: "read-only",
    timeoutMs,
    stream: true,
  });

  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const transport = parsedUrl.protocol === "https:" ? https : http;
    let settled = false;
    let timeout: ReturnType<typeof setTimeout>;

    const finish = (error?: Error, result?: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(result ?? "");
    };

    const request = transport.request(
      parsedUrl,
      {
        method: "POST",
        agent: false,
        headers: {
          Accept: "application/x-ndjson",
          Connection: "close",
          "Content-Length": Buffer.byteLength(requestBody),
          "Content-Type": "application/json",
        },
      },
      (response) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => {
          request.destroy(new Error("Codex Worker 执行超时"));
        }, timeoutMs + queueGraceMs);

        response.setEncoding("utf8");
        let bodyText = "";
        response.on("data", (chunk: string) => {
          bodyText += chunk;
        });
        response.on("aborted", () => {
          finish(new CodexWorkerConnectionError("Codex Worker 响应连接中断"));
        });
        response.on("error", (error) => {
          finish(
            new CodexWorkerConnectionError(
              `Codex Worker 响应失败：${error.message}`,
            ),
          );
        });
        response.on("end", () => {
          try {
            finish(
              undefined,
              parseCodexWorkerBody(
                bodyText,
                String(response.headers["content-type"] ?? ""),
                response.statusCode ?? 500,
                maxLength,
              ),
            );
          } catch (error) {
            finish(error instanceof Error ? error : new Error(String(error)));
          }
        });
      },
    );

    request.on("error", (error) => {
      if (
        error.message === "Codex Worker 连接超时" ||
        error.message === "Codex Worker 执行超时"
      ) {
        finish(error);
        return;
      }
      finish(
        new CodexWorkerConnectionError(
          `Codex Worker 连接失败：${error.message}`,
        ),
      );
    });
    timeout = setTimeout(() => {
      request.destroy(new Error("Codex Worker 连接超时"));
    }, connectTimeoutMs);
    request.end(requestBody);
  });
}

export async function queryCodexWorker(
  url: string,
  prompt: string,
  source: string,
  timeoutMs: number,
  maxLength: number,
): Promise<string> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return await queryCodexWorkerOnce(
        url,
        prompt,
        source,
        timeoutMs,
        maxLength,
      );
    } catch (error) {
      lastError = error;
      if (!(error instanceof CodexWorkerConnectionError) || attempt === 2) {
        throw error;
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Codex Worker 连接失败");
}

export async function queryMediaHubCodex(
  prompt: string,
  maxLength: number,
): Promise<string> {
  const settings = await resolveMediaSystemSetting();
  const configuredBaseUrl = settings.codexWorkerUrl;
  if (!configuredBaseUrl) {
    throw new Error("Missing CODEX_WORKER_URL");
  }
  const baseUrl = configuredBaseUrl.replace(/\/$/, "");
  const source = settings.codexWorkerSource;
  const timeoutMs = positiveTimeout(String(settings.codexTimeoutMs), 180_000);
  return queryCodexWorker(
    `${baseUrl}/query`,
    prompt,
    source,
    timeoutMs,
    maxLength,
  );
}
