export const resolutionOptions = [
  {
    value: "960x544",
    label: "横屏 · 960 × 544（默认）",
    width: 960,
    height: 544,
  },
  { value: "544x960", label: "竖屏 · 544 × 960", width: 544, height: 960 },
  { value: "768x768", label: "方形 · 768 × 768", width: 768, height: 768 },
  {
    value: "1280x704",
    label: "高清横屏 · 1280 × 704",
    width: 1280,
    height: 704,
  },
  {
    value: "704x1280",
    label: "高清竖屏 · 704 × 1280",
    width: 704,
    height: 1280,
  },
] as const;

export type ResolutionValue = (typeof resolutionOptions)[number]["value"];
