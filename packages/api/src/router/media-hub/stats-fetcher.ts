import "./meta-proxy";

import { and, eq } from "@acme/db";
import { db } from "@acme/db/client";
import {
  mediaPlatformAccount,
  mediaPlatformStats,
  mediaPublishTarget,
} from "@acme/db/schema";
import { log } from "@acme/logger";

import { getValidYouTubeAccessToken } from "./oauth-token";
import { getValidInstagramAccessToken } from "./oauth-token-instagram";

interface YouTubeVideoStats {
  id: string;
  title: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
}

interface InstagramMedia {
  id: string;
  caption?: string;
  comments_count?: number;
  like_count?: number;
  media_type?: string;
  timestamp?: string;
}

export interface StatsFetchIssue {
  platform: "youtube" | "instagram";
  accountId?: string | null;
  message: string;
}

export interface StatsFetchResult {
  issues: StatsFetchIssue[];
}

function buildStatsIssue(
  platform: StatsFetchIssue["platform"],
  accountId: string | null,
  err: unknown,
): StatsFetchIssue {
  const message = err instanceof Error ? err.message : String(err);
  if (platform === "youtube" && message.includes("token refresh failed")) {
    return {
      platform,
      accountId,
      message:
        "YouTube 授权已过期或被撤销，请在 Media Hub 的平台账号中重新授权后再查看数据。",
    };
  }
  if (platform === "youtube" && message.includes("reauthorize required")) {
    return {
      platform,
      accountId,
      message:
        "YouTube 账号缺少可刷新授权，请在 Media Hub 的平台账号中重新授权。",
    };
  }
  return {
    platform,
    accountId,
    message: `${platform === "youtube" ? "YouTube" : "Instagram"} 数据拉取失败：${message}`,
  };
}

async function fetchYouTubeVideoStats(
  accountId: string,
  videoIds: string[],
): Promise<YouTubeVideoStats[]> {
  if (videoIds.length === 0) return [];
  const token = await getValidYouTubeAccessToken(accountId);

  interface YTItem {
    id: string;
    snippet?: { title?: string };
    statistics?: {
      viewCount?: string;
      likeCount?: string;
      commentCount?: string;
    };
  }
  const parseItem = (item: YTItem): YouTubeVideoStats => ({
    id: item.id,
    title: item.snippet?.title ?? "",
    viewCount: parseInt(item.statistics?.viewCount ?? "0", 10),
    likeCount: parseInt(item.statistics?.likeCount ?? "0", 10),
    commentCount: parseInt(item.statistics?.commentCount ?? "0", 10),
  });

  const all: YouTubeVideoStats[] = [];
  for (let i = 0; i < videoIds.length; i += 50) {
    const ids = videoIds.slice(i, i + 50).join(",");
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${ids}&maxResults=50`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) throw new Error(`YouTube videos.list HTTP ${res.status}`);
    const data = (await res.json()) as { items?: YTItem[] };
    all.push(...(data.items ?? []).map(parseItem));
  }
  return all;
}

/**
 * 拉取所有已发布视频的最新数据并写入 media_platform_stats。
 * 每天调一次（每次 upsert，不会重复写）。
 */
export async function fetchAndSaveStats(): Promise<StatsFetchResult> {
  const today = new Date().toISOString().slice(0, 10);
  const issues: StatsFetchIssue[] = [];

  const targets = await db.query.mediaPublishTarget.findMany({
    where: and(
      eq(mediaPublishTarget.platform, "youtube"),
      eq(mediaPublishTarget.status, "published"),
    ),
  });

  const validTargets = targets.flatMap((t) =>
    t.externalPostId
      ? [{ accountId: t.accountId, videoId: t.externalPostId }]
      : [],
  );
  if (validTargets.length === 0) {
    log.info("No published YouTube videos to fetch stats for", {
      code: "MEDIA_STATS_EMPTY",
    });
  } else {
    const byAccount = validTargets.reduce<Map<string, string[]>>((map, t) => {
      const ids = map.get(t.accountId) ?? [];
      ids.push(t.videoId);
      return map.set(t.accountId, ids);
    }, new Map());

    for (const [accountId, videoIds] of byAccount) {
      try {
        const stats = await fetchYouTubeVideoStats(accountId, videoIds);
        for (const s of stats) {
          await db
            .insert(mediaPlatformStats)
            .values({
              id: crypto.randomUUID(),
              platform: "youtube",
              accountId,
              externalVideoId: s.id,
              videoTitle: s.title,
              viewCount: s.viewCount,
              likeCount: s.likeCount,
              commentCount: s.commentCount,
              snapshotDate: today,
              fetchedAt: new Date(),
            })
            .onConflictDoUpdate({
              target: [
                mediaPlatformStats.externalVideoId,
                mediaPlatformStats.snapshotDate,
              ],
              set: {
                viewCount: s.viewCount,
                likeCount: s.likeCount,
                commentCount: s.commentCount,
                videoTitle: s.title,
                fetchedAt: new Date(),
              },
            });
        }
        log.info("YouTube stats saved", {
          code: "MEDIA_STATS_SAVED",
          account_id: accountId,
          video_count: stats.length,
          date: today,
        });
      } catch (err) {
        issues.push(buildStatsIssue("youtube", accountId, err));
        log.error("Failed to fetch YouTube stats for account", {
          code: "MEDIA_STATS_FETCH_FAILED",
          account_id: accountId,
          err: err instanceof Error ? err : new Error(String(err)),
        });
      }
    }
  }

  issues.push(...(await fetchAndSaveInstagramStats(today)));
  return { issues };
}

async function fetchAndSaveInstagramStats(
  today: string,
): Promise<StatsFetchIssue[]> {
  const META_VERSION = process.env.META_API_VERSION ?? "v21.0";
  const GRAPH = `https://graph.facebook.com/${META_VERSION}`;
  const issues: StatsFetchIssue[] = [];

  const igTargets = await db.query.mediaPublishTarget.findMany({
    where: and(
      eq(mediaPublishTarget.platform, "instagram"),
      eq(mediaPublishTarget.status, "published"),
    ),
  });

  const validIgTargets = igTargets.flatMap((t) =>
    t.externalPostId
      ? [{ accountId: t.accountId, mediaId: t.externalPostId }]
      : [],
  );

  const byAccount = validIgTargets.reduce<Map<string, Set<string>>>(
    (map, t) => {
      const ids = map.get(t.accountId) ?? new Set<string>();
      ids.add(t.mediaId);
      return map.set(t.accountId, ids);
    },
    new Map(),
  );

  const igAccounts = await db.query.mediaPlatformAccount.findMany({
    where: eq(mediaPlatformAccount.platform, "instagram"),
  });
  for (const account of igAccounts) {
    if (!byAccount.has(account.id)) byAccount.set(account.id, new Set());
  }

  if (byAccount.size === 0) {
    log.info("No authorized Instagram accounts to fetch stats for", {
      code: "IG_STATS_EMPTY",
    });
    return issues;
  }

  async function fetchInstagramInsightMetric(
    mediaId: string,
    token: string,
    metricNames: string[],
  ): Promise<number> {
    for (const metricName of metricNames) {
      const res = await fetch(
        `${GRAPH}/${mediaId}/insights?metric=${metricName}&access_token=${token}`,
      );
      if (!res.ok) {
        const body = await res.text();
        log.warn("Instagram media insight metric failed", {
          code: "IG_STATS_INSIGHT_METRIC_FAILED",
          media_id: mediaId,
          metric: metricName,
          status: res.status,
          body,
        });
        continue;
      }

      const data = (await res.json()) as {
        data?: { name: string; values?: { value: number }[] }[];
      };
      return (
        (data.data ?? []).find((item) => item.name === metricName)?.values?.[0]
          ?.value ?? 0
      );
    }
    return 0;
  }

  for (const [accountId, mediaIds] of byAccount) {
    try {
      const { token, igUserId } = await getValidInstagramAccessToken(accountId);
      if (mediaIds.size === 0) {
        const recentMediaRes = await fetch(
          `${GRAPH}/${igUserId}/media?fields=id,caption,timestamp,media_type,like_count,comments_count&limit=25&access_token=${token}`,
        );
        if (recentMediaRes.ok) {
          const recentMediaData = (await recentMediaRes.json()) as {
            data?: InstagramMedia[];
          };
          for (const media of recentMediaData.data ?? []) {
            mediaIds.add(media.id);
          }
          log.info("Instagram recent media listed", {
            code: "IG_MEDIA_LISTED",
            account_id: accountId,
            media_count: recentMediaData.data?.length ?? 0,
          });
        } else {
          const body = await recentMediaRes.text();
          log.warn("Instagram recent media list failed", {
            code: "IG_MEDIA_LIST_FAILED",
            account_id: accountId,
            status: recentMediaRes.status,
            body,
          });
        }
      }

      for (const mediaId of mediaIds) {
        try {
          const mediaRes = await fetch(
            `${GRAPH}/${mediaId}?fields=id,caption,media_type,like_count,comments_count&access_token=${token}`,
          );
          const mediaData = mediaRes.ok
            ? ((await mediaRes.json()) as InstagramMedia)
            : { id: mediaId };

          const views = await fetchInstagramInsightMetric(mediaId, token, [
            "views",
            "plays",
            "ig_reels_aggregated_all_plays_count",
          ]);
          const likes = mediaData.like_count ?? 0;
          const comments = mediaData.comments_count ?? 0;

          const videoTitle =
            (mediaData.caption ?? "").split("\n")[0]?.slice(0, 80) ?? mediaId;

          await db
            .insert(mediaPlatformStats)
            .values({
              id: crypto.randomUUID(),
              platform: "instagram",
              accountId,
              externalVideoId: mediaId,
              videoTitle,
              viewCount: views,
              likeCount: likes,
              commentCount: comments,
              snapshotDate: today,
              fetchedAt: new Date(),
            })
            .onConflictDoUpdate({
              target: [
                mediaPlatformStats.externalVideoId,
                mediaPlatformStats.snapshotDate,
              ],
              set: {
                viewCount: views,
                likeCount: likes,
                commentCount: comments,
                videoTitle,
                fetchedAt: new Date(),
              },
            });
        } catch (err) {
          issues.push(buildStatsIssue("instagram", accountId, err));
          log.error("Instagram stats for media failed", {
            code: "IG_STATS_MEDIA_FAILED",
            media_id: mediaId,
            err: err instanceof Error ? err : new Error(String(err)),
          });
        }
      }

      log.info("Instagram stats saved", {
        code: "IG_STATS_SAVED",
        account_id: accountId,
        media_count: mediaIds.size,
        date: today,
      });
    } catch (err) {
      issues.push(buildStatsIssue("instagram", accountId, err));
      log.error("Instagram stats fetch failed for account", {
        code: "IG_STATS_ACCOUNT_FAILED",
        account_id: accountId,
        err: err instanceof Error ? err : new Error(String(err)),
      });
    }
  }
  return issues;
}
