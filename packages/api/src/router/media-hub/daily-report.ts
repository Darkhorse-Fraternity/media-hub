import { gte } from "@acme/db";
import { db } from "@acme/db/client";
import { mediaPlatformStats } from "@acme/db/schema";
import { log } from "@acme/logger";

import type { StatsFetchIssue } from "./stats-fetcher";
import { buildDailyReportSuggestionSystemPrompt } from "./growth-prompts";
import { resolveMediaSystemSetting } from "./system-settings";

function dateStr(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

function fmtNum(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}w`;
  return n.toLocaleString();
}

function deltaStr(cur: number, prev: number): string {
  if (prev === 0) return "";
  const pct = ((cur - prev) / prev) * 100;
  const sign = pct >= 0 ? "+" : "";
  return ` (${sign}${pct.toFixed(1)}%)`;
}

function platformTag(platform: string): string {
  if (platform === "youtube") return "[YT]";
  if (platform === "instagram") return "[IG]";
  return `[${platform.toUpperCase()}]`;
}

function platformLabel(platform: string): string {
  if (platform === "youtube") return "YouTube";
  if (platform === "instagram") return "Instagram";
  return platform;
}

function buildPlatformSummary(input: {
  platform: string;
  weekRows: (typeof mediaPlatformStats.$inferSelect)[];
  today: string;
  yesterday: string;
}) {
  const rows = input.weekRows.filter((r) => r.platform === input.platform);
  const todayRows = rows
    .filter((r) => r.snapshotDate === input.today)
    .sort((a, b) => b.viewCount - a.viewCount);
  const yesterdayRows = rows.filter((r) => r.snapshotDate === input.yesterday);

  const totalViews = todayRows.reduce((s, r) => s + r.viewCount, 0);
  const totalLikes = todayRows.reduce((s, r) => s + r.likeCount, 0);
  const totalComments = todayRows.reduce((s, r) => s + r.commentCount, 0);
  const ydViews = yesterdayRows.reduce((s, r) => s + r.viewCount, 0);

  const byDate = new Map<string, number>();
  for (const r of rows) {
    byDate.set(r.snapshotDate, (byDate.get(r.snapshotDate) ?? 0) + r.viewCount);
  }
  const trendDates = [...byDate.keys()].sort();
  const trendLines = trendDates
    .map(
      (d) =>
        `${d.slice(5).replace("-", "/")}  ${fmtNum(byDate.get(d) ?? 0)} 次播放`,
    )
    .join("\n");
  const trendSummary = trendDates
    .map((d) => `${d}=${byDate.get(d) ?? 0}`)
    .join(", ");

  const topRows = todayRows.slice(0, 3);
  const topLines = topRows
    .map(
      (r, i) =>
        `${i + 1}. **${(r.videoTitle ?? r.externalVideoId).slice(0, 40)}**\n` +
        `   👁 ${fmtNum(r.viewCount)}  👍 ${fmtNum(r.likeCount)}  💬 ${fmtNum(r.commentCount)}`,
    )
    .join("\n");

  return {
    platform: input.platform,
    label: platformLabel(input.platform),
    todayRows,
    totalViews,
    totalLikes,
    totalComments,
    ydViews,
    trendDates,
    trendLines,
    trendSummary,
    topRows,
    topLines,
  };
}

function buildPlatformElements(
  summary: ReturnType<typeof buildPlatformSummary>,
) {
  return [
    {
      tag: "div" as const,
      text: {
        tag: "lark_md" as const,
        content: `**${summary.label}**`,
      },
    },
    {
      tag: "div" as const,
      fields: [
        {
          is_short: true,
          text: {
            tag: "lark_md" as const,
            content: `**播放**\n${fmtNum(summary.totalViews)}${deltaStr(summary.totalViews, summary.ydViews)}`,
          },
        },
        {
          is_short: true,
          text: {
            tag: "lark_md" as const,
            content: `**点赞**\n${fmtNum(summary.totalLikes)}`,
          },
        },
      ],
    },
    {
      tag: "div" as const,
      fields: [
        {
          is_short: true,
          text: {
            tag: "lark_md" as const,
            content: `**评论**\n${fmtNum(summary.totalComments)}`,
          },
        },
        {
          is_short: true,
          text: {
            tag: "lark_md" as const,
            content: `**视频数**\n${summary.todayRows.length}`,
          },
        },
      ],
    },
    ...(summary.trendLines
      ? [
          {
            tag: "div" as const,
            text: {
              tag: "lark_md" as const,
              content: `**近 7 天播放趋势**\n${summary.trendLines}`,
            },
          },
        ]
      : []),
    {
      tag: "div" as const,
      text: {
        tag: "lark_md" as const,
        content:
          summary.topRows.length > 0
            ? `**热门视频 Top ${summary.topRows.length}** ${platformTag(summary.platform)}\n${summary.topLines}`
            : `暂无 ${summary.label} 发布视频数据`,
      },
    },
  ];
}

function buildIssueElements(issues: StatsFetchIssue[]) {
  if (issues.length === 0) return [];

  const uniqueMessages = [
    ...new Set(issues.map((issue) => `• ${issue.message}`)),
  ];
  return [
    {
      tag: "div" as const,
      text: {
        tag: "lark_md" as const,
        content: `**⚠️ 数据拉取异常**\n${uniqueMessages.join("\n")}`,
      },
    },
    { tag: "hr" as const },
  ];
}

async function generateAiSuggestions(
  summaryText: string,
): Promise<string | null> {
  const settings = await resolveMediaSystemSetting();
  if (!settings.ollamaBaseUrl) return null;

  try {
    const res = await fetch(`${settings.ollamaBaseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: settings.ollamaModel,
        stream: false,
        think: false,
        messages: [
          {
            role: "system",
            content: buildDailyReportSuggestionSystemPrompt(),
          },
          { role: "user", content: summaryText },
        ],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { message?: { content?: string } };
    return (data.message?.content ?? "").trim() || null;
  } catch {
    return null;
  }
}

export async function sendDailyReport(input?: {
  issues?: StatsFetchIssue[];
}): Promise<void> {
  const today = dateStr(0);
  const yesterday = dateStr(1);
  const sevenDaysAgo = dateStr(7);
  const issues = input?.issues ?? [];

  const weekRows = await db.query.mediaPlatformStats.findMany({
    where: gte(mediaPlatformStats.snapshotDate, sevenDaysAgo),
    orderBy: [mediaPlatformStats.snapshotDate],
  });
  const platformSummaries = ["youtube", "instagram"].map((platform) =>
    buildPlatformSummary({ platform, weekRows, today, yesterday }),
  );

  const summaryText = [
    ...platformSummaries.map(
      (summary) =>
        `${summary.label}：播放 ${summary.totalViews}，点赞 ${summary.totalLikes}，评论 ${summary.totalComments}，7天趋势 ${summary.trendSummary || "暂无"}`,
    ),
    ...platformSummaries.map((summary) =>
      summary.topRows.length > 0
        ? `${summary.label} Top：${summary.topRows.map((r) => `${r.videoTitle ?? r.externalVideoId}=${r.viewCount}次`).join("; ")}`
        : `${summary.label} 暂无发布数据`,
    ),
  ].join("\n");

  const aiSuggestions = await generateAiSuggestions(summaryText);

  const dateLabel = new Date().toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const card = {
    config: { wide_screen_mode: true },
    header: {
      template: "turquoise",
      title: { tag: "plain_text", content: `📊 每日运营报告 · ${dateLabel}` },
    },
    elements: [
      ...buildIssueElements(issues),
      ...platformSummaries.flatMap((summary, index) => [
        ...(index === 0 ? [] : [{ tag: "hr" as const }]),
        ...buildPlatformElements(summary),
      ]),
      ...(aiSuggestions
        ? [
            { tag: "hr" as const },
            {
              tag: "div" as const,
              text: {
                tag: "lark_md",
                content: `**💡 本周建议**\n${aiSuggestions}`,
              },
            },
          ]
        : []),
    ],
  };

  log.info("Daily report generated without an unscoped notification", {
    code: "MEDIA_DAILY_REPORT_NOTIFICATION_DISABLED",
    date: today,
    card_bytes: Buffer.byteLength(JSON.stringify(card)),
    video_count: platformSummaries.reduce(
      (sum, summary) => sum + summary.todayRows.length,
      0,
    ),
    total_views: platformSummaries.reduce(
      (sum, summary) => sum + summary.totalViews,
      0,
    ),
    ai_suggestions: !!aiSuggestions,
  });
}
