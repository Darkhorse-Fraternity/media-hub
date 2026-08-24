export function imageFramingPrompt(
  prompt: string,
  width: number,
  height: number,
): string {
  const framing =
    width === height
      ? "Compose for a strict square 1:1 canvas. Reframe the subject and environment into a balanced square composition that fills the canvas; do not preserve a portrait or landscape crop merely because a reference image uses it."
      : width > height
        ? `Compose for a strict landscape canvas (${width}:${height}). Use the horizontal space intentionally and reframe portrait references into a complete wide composition without stretching.`
        : `Compose for a strict portrait canvas (${width}:${height}). Use the vertical space intentionally and reframe landscape references into a complete tall composition without stretching.`;
  return `${prompt}\n\nCanvas and composition requirement: ${framing}`;
}

export function imageVariationPrompt(
  prompt: string,
  outputCount: number,
  diversity: number,
): string {
  if (outputCount === 1) return prompt;
  const direction =
    diversity <= 15
      ? "Keep the subject, composition, camera angle, lighting, and visual style highly consistent across the set; vary only tiny natural details."
      : diversity <= 40
        ? "Keep the subject and overall composition consistent across the set, while allowing modest changes in pose, crop, lighting, and small details."
        : diversity <= 70
          ? "Create distinct alternatives across the set by varying composition, camera angle, pose, lighting, and environmental details while preserving the requested subject and intent."
          : diversity <= 90
            ? "Explore clearly different visual interpretations across the set: use noticeably different viewpoints, compositions, lighting, color treatment, and scene details while preserving the core request."
            : "Maximize visual diversity across the set. Reinterpret viewpoint, composition, scale, lighting, palette, environment, and styling for every image while keeping only the essential subject and intent unchanged.";
  return `${prompt}\n\nBatch variation direction (${diversity}/100): ${direction}`;
}
