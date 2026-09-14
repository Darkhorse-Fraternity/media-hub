export function buildDouyinText(input: {
  title: string;
  description?: string | null;
  hashtags?: string | null;
}): string {
  return [input.title, input.description, input.hashtags]
    .map((value) => value?.trim())
    .filter((value): value is string => !!value)
    .join("\n\n");
}
