export interface XiaohongshuPublishPackage {
  title: string;
  content: string;
  hashtags: string[];
  caption: string;
}

function truncateCodePoints(value: string, maxLength: number): string {
  return Array.from(value).slice(0, maxLength).join("");
}

export function normalizeXiaohongshuHashtags(value?: string | null): string[] {
  return [
    ...new Set(
      (value ?? "")
        .split(/[\s,，]+/)
        .map((tag) => tag.replace(/^#+/, "").trim())
        .filter(Boolean),
    ),
  ];
}

export function buildXiaohongshuPublishPackage(input: {
  title: string;
  description?: string | null;
  hashtags?: string | null;
}): XiaohongshuPublishPackage {
  const title = truncateCodePoints(input.title.trim(), 20);
  const requestedContent = input.description?.trim();
  const content = requestedContent?.length ? requestedContent : title;
  const hashtags = normalizeXiaohongshuHashtags(input.hashtags);
  const hashtagText = hashtags.map((tag) => `#${tag}`).join(" ");
  return {
    title,
    content,
    hashtags,
    caption: [title, content, hashtagText].filter(Boolean).join("\n\n"),
  };
}
