export const MAX_VIDEO_EDIT_TITLE_LENGTH = 200;

export function createVideoEditTitle(sourceTitle: string): string {
  return `修改：${sourceTitle}`.slice(0, MAX_VIDEO_EDIT_TITLE_LENGTH);
}

export function validateVideoEditTitle(title: string): string | null {
  return title.trim().length > MAX_VIDEO_EDIT_TITLE_LENGTH
    ? `视频名称不能超过 ${MAX_VIDEO_EDIT_TITLE_LENGTH} 个字符。`
    : null;
}
