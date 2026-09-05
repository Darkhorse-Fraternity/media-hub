import { Agent, fetch as undiciFetch } from "undici";

const asrDispatcher = new Agent({ connect: { timeout: 15_000 } });

function optionalSecret(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === "" ? undefined : trimmed;
}

export interface SpeechValidationResult {
  expectedText: string;
  transcript: string;
  matchPercent: number;
  model: string | null;
}

export class GenerationSpeechValidationError extends Error {
  readonly code: string;
  readonly failureStage = "audio_dialogue_validation";
  readonly retryable: boolean;

  constructor(
    message: string,
    options: { code?: string; retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "GenerationSpeechValidationError";
    this.code = options.code ?? "asr_dialogue_mismatch";
    this.retryable = options.retryable ?? true;
  }
}

export function extractExpectedH3Dialogue(prompt: string): string[] {
  return [...prompt.matchAll(/<d>\[[^\]]+]\s*([^<]+?)<\/d>/gi)]
    .map((match) => match[1]?.trim() ?? "")
    .filter(Boolean);
}

function comparableSpeech(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}]/gu, "");
}

export function speechMatchScore(expected: string, actual: string): number {
  const left = comparableSpeech(expected);
  const right = comparableSpeech(actual);
  if (!left || !right) return 0;
  if (right.includes(left)) return 1;

  const previous = Array.from(
    { length: right.length + 1 },
    (_, index) => index,
  );
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = previous[0] ?? 0;
    previous[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = previous[rightIndex] ?? rightIndex;
      const current = Math.min(
        above + 1,
        (previous[rightIndex - 1] ?? leftIndex) + 1,
        diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
      diagonal = above;
      previous[rightIndex] = current;
    }
  }
  const distance =
    previous[right.length] ?? Math.max(left.length, right.length);
  return Math.max(0, 1 - distance / Math.max(left.length, right.length));
}

function minimumSimilarity(): number {
  const configured = Number(process.env.MEDIA_HUB_ASR_MIN_SIMILARITY ?? "0.72");
  return Number.isFinite(configured) && configured >= 0 && configured <= 1
    ? configured
    : 0.72;
}

export async function validateGeneratedDialogue(
  video: Buffer,
  prompt: string,
  language: string,
): Promise<SpeechValidationResult | null> {
  const dialogues = extractExpectedH3Dialogue(prompt);
  if (!dialogues.length) return null;
  const baseUrl = process.env.MEDIA_HUB_ASR_URL?.trim();
  if (!baseUrl) {
    throw new GenerationSpeechValidationError(
      "视频包含逐字对白，但原声音轨 ASR 验收服务未配置",
      { code: "asr_not_configured", retryable: false },
    );
  }
  const token =
    optionalSecret(process.env.MEDIA_HUB_ASR_TOKEN) ??
    optionalSecret(process.env.MEDIA_HUB_GENERATION_PROVIDER_TOKEN);
  let response: Response;
  try {
    response = (await undiciFetch(
      `${baseUrl.replace(/\/$/, "")}/v1/transcriptions`,
      {
        method: "POST",
        dispatcher: asrDispatcher,
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : undefined),
        },
        body: JSON.stringify({
          content_base64: video.toString("base64"),
          content_type: "video/mp4",
          language: language === "zh" ? "zh" : "en",
        }),
        signal: AbortSignal.timeout(10 * 60 * 1000),
      },
    )) as unknown as Response;
  } catch (error) {
    throw new GenerationSpeechValidationError(
      `原声音轨 ASR 服务连接失败：${error instanceof Error ? error.message : String(error)}`,
      { code: "asr_unavailable", cause: error },
    );
  }
  const payload = (await response.json().catch(() => ({}))) as {
    text?: string;
    model?: string;
    message?: string;
  };
  if (!response.ok || typeof payload.text !== "string") {
    throw new GenerationSpeechValidationError(
      `原声音轨 ASR 失败：${payload.message ?? response.statusText}`,
      { code: `asr_http_${response.status}` },
    );
  }

  const expectedText = dialogues.join("");
  const transcript = payload.text.trim();
  const score = speechMatchScore(expectedText, transcript);
  const matchPercent = Math.round(score * 100);
  if (score < minimumSimilarity()) {
    throw new GenerationSpeechValidationError(
      `H3 原声对白与逐字台词不一致（匹配度 ${matchPercent}%）；识别结果：${transcript.slice(0, 300) || "无可识别人声"}`,
    );
  }
  return {
    expectedText,
    transcript,
    matchPercent,
    model: payload.model ?? null,
  };
}
