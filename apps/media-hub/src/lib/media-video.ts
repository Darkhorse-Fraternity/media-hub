export function mediaVideoContentDisposition(
  jobId: string,
  download: boolean,
): string {
  const safeJobId = jobId.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 120);
  const disposition = download ? "attachment" : "inline";
  return `${disposition}; filename="media-hub-${safeJobId || "video"}.mp4"`;
}
