// Pure helpers for Drive links and labels (no DOM access, unit-tested).

/** The link shared with the room: the file's normal Drive URL, with the resource key if any. */
export function driveShareUrl(id: string, resourceKey?: string): string {
  const url = new URL(`https://drive.google.com/file/d/${encodeURIComponent(id)}/view`);
  if (resourceKey) url.searchParams.set('resourcekey', resourceKey);
  return url.href;
}

/** Whether a (normalised) room URL points at one Drive file. */
export function isDriveFileUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.hostname === 'drive.google.com' && /\/file\/d\/[\w-]+/.test(url.pathname);
  } catch {
    return false;
  }
}

export function fmtSize(bytes: number | undefined): string {
  if (!bytes || bytes < 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

export type DriveAccess = 'link' | 'private' | 'unknown';
export interface DriveItem {
  id: string;
  name: string;
  mimeType: string;
  isFolder: boolean;
  size?: number;
  durationMs?: number;
  width?: number;
  height?: number;
  thumbnail?: string;
  resourceKey?: string;
  access: DriveAccess;
}
export type DriveView = 'mine' | 'shared' | 'recent' | 'search';
export interface DriveListRequest {
  view: DriveView;
  folderId?: string;
  query?: string;
  pageToken?: string;
}
export interface DriveListResult {
  files: DriveItem[];
  nextPageToken?: string;
}
