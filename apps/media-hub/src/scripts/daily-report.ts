/**
 * 每日运营报告脚本（由 Docker/cron 显式调用，不使用 pm2）
 * 1. 拉取所有已发布视频的最新数据并写入 media_platform_stats
 * 2. 生成汇总卡片推送到飞书审核群
 */
import { fetchAndSaveStats, sendDailyReport } from "@acme/api";

async function main() {
  console.log(
    JSON.stringify({
      level: "info",
      code: "MEDIA_DAILY_JOB_START",
      msg: "Daily report job started",
    }),
  );
  try {
    const statsResult = await fetchAndSaveStats();
    await sendDailyReport({ issues: statsResult.issues });
    console.log(
      JSON.stringify({
        level: "info",
        code: "MEDIA_DAILY_JOB_DONE",
        msg: "Daily report job done",
      }),
    );
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        code: "MEDIA_DAILY_JOB_FAILED",
        msg: String(err),
      }),
    );
    process.exit(1);
  }
}

void main();
