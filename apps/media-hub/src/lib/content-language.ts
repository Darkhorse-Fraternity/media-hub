export type ContentLanguage = "zh" | "en";

export const defaultContentLanguage: ContentLanguage = "en";

export function parseContentLanguage(value: string | null): ContentLanguage {
  return value === "zh" ? "zh" : defaultContentLanguage;
}

export function contentLanguageStorageKey(userId: string): string {
  return `media-hub:content-language:${userId}`;
}
