export function generationNotificationRetryDelayMs(attempts: number): number {
  return Math.min(5 * 60_000, 5_000 * 2 ** Math.max(0, attempts - 1));
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const escaped: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return escaped[character] ?? character;
  });
}

export function buildGenerationVideoPlayerHtml(input: {
  title: string;
  videoUrl: string;
}): string {
  const title = escapeHtml(input.title);
  const videoUrl = escapeHtml(input.videoUrl);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <title>${title}</title>
  <style>
    :root { color-scheme: dark; font-family: system-ui, -apple-system, sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #050914; color: #f8fafc; }
    main { width: min(100%, 1080px); padding: 16px; }
    video { display: block; width: 100%; max-height: 78vh; background: #000; border-radius: 12px; }
    h1 { margin: 16px 0 12px; font-size: 18px; line-height: 1.4; }
    a { display: inline-block; padding: 10px 16px; border: 1px solid #64748b; border-radius: 8px; color: #e2e8f0; text-decoration: none; }
  </style>
</head>
<body>
  <main>
    <video controls playsinline preload="metadata" src="${videoUrl}"></video>
    <h1>${title}</h1>
    <a href="${videoUrl}">无法播放时直接打开视频</a>
  </main>
</body>
</html>`;
}
