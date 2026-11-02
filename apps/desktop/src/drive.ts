// Read-only Google Drive client used by the host shell. Tokens never leave this process.

export type DriveView = 'mine' | 'shared' | 'recent' | 'search';
/** Who can open the file with just its link: everyone, only invited people, or not known. */
export type DriveAccess = 'link' | 'private' | 'unknown';

export interface DriveFile {
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
  modifiedTime?: string;
  access: DriveAccess;
}
export interface DriveListRequest {
  view: DriveView;
  /** Folder to open (view "mine"); the root of "My Drive" when absent. */
  folderId?: string;
  query?: string;
  pageToken?: string;
}
export interface DriveListResult {
  files: DriveFile[];
  nextPageToken?: string;
}

const API = 'https://www.googleapis.com/drive/v3';
export const FOLDER_MIME = 'application/vnd.google-apps.folder';
const FIELDS =
  'nextPageToken,files(id,name,mimeType,size,thumbnailLink,resourceKey,modifiedTime,ownedByMe,' +
  'videoMediaMetadata(durationMillis,width,height),permissions(type,role))';

export class DriveError extends Error {
  constructor(
    readonly status: number,
    message?: string,
  ) {
    super(message ?? `Drive HTTP ${status}`);
  }
}

/** Quotes a value for the Drive query language ('...' with \ and ' escaped). */
export function quote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

const VIDEO_OR_FOLDER = `(mimeType contains 'video/' or mimeType = '${FOLDER_MIME}')`;

export function buildQuery(request: DriveListRequest): { q: string; orderBy?: string } {
  switch (request.view) {
    case 'shared':
      return {
        q: `sharedWithMe = true and trashed = false and ${VIDEO_OR_FOLDER}`,
        orderBy: 'folder,name_natural',
      };
    case 'recent':
      return {
        q: "trashed = false and mimeType contains 'video/'",
        orderBy: 'viewedByMeTime desc,modifiedTime desc',
      };
    case 'search':
      return {
        q: `name contains ${quote((request.query ?? '').trim())} and trashed = false and mimeType contains 'video/'`,
        orderBy: 'modifiedTime desc',
      };
    default:
      return {
        q: `${quote(request.folderId || 'root')} in parents and trashed = false and ${VIDEO_OR_FOLDER}`,
        orderBy: 'folder,name_natural',
      };
  }
}

interface RawFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  thumbnailLink?: string;
  resourceKey?: string;
  modifiedTime?: string;
  ownedByMe?: boolean;
  videoMediaMetadata?: { durationMillis?: string; width?: number; height?: number };
  permissions?: Array<{ type: string; role: string }>;
}

export function toDriveFile(raw: RawFile): DriveFile {
  // Drive only reveals the permission list to people who can manage the file.
  const access: DriveAccess = raw.permissions?.some((p) => p.type === 'anyone')
    ? 'link'
    : raw.ownedByMe && raw.permissions
      ? 'private'
      : 'unknown';
  return {
    id: raw.id,
    name: raw.name,
    mimeType: raw.mimeType,
    isFolder: raw.mimeType === FOLDER_MIME,
    size: raw.size ? Number(raw.size) : undefined,
    durationMs: raw.videoMediaMetadata?.durationMillis
      ? Number(raw.videoMediaMetadata.durationMillis)
      : undefined,
    width: raw.videoMediaMetadata?.width,
    height: raw.videoMediaMetadata?.height,
    thumbnail: raw.thumbnailLink,
    resourceKey: raw.resourceKey,
    modifiedTime: raw.modifiedTime,
    access,
  };
}

/** Pulls a Drive file id out of a share link (/file/d/<id>/..., open?id=<id>). */
export function driveFileId(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    if (url.hostname !== 'drive.google.com' && url.hostname !== 'docs.google.com') return undefined;
    return (
      url.pathname.match(/\/file\/d\/([\w-]+)/)?.[1] ?? url.searchParams.get('id') ?? undefined
    );
  } catch {
    return undefined;
  }
}

export class DriveClient {
  constructor(
    private readonly getToken: (forceRefresh?: boolean) => Promise<string>,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async list(request: DriveListRequest): Promise<DriveListResult> {
    const { q, orderBy } = buildQuery(request);
    const params = new URLSearchParams({
      q,
      fields: FIELDS,
      pageSize: '40',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    });
    if (orderBy) params.set('orderBy', orderBy);
    if (request.pageToken) params.set('pageToken', request.pageToken);
    const data = (await this.get(`${API}/files?${params}`)) as {
      files?: RawFile[];
      nextPageToken?: string;
    };
    return { files: (data.files ?? []).map(toDriveFile), nextPageToken: data.nextPageToken };
  }

  async file(id: string, resourceKey?: string): Promise<DriveFile> {
    const params = new URLSearchParams({
      fields: FIELDS.slice(FIELDS.indexOf('(') + 1, -1),
      supportsAllDrives: 'true',
    });
    return toDriveFile(
      (await this.get(
        `${API}/files/${encodeURIComponent(id)}?${params}`,
        resourceKey ? { [id]: resourceKey } : undefined,
      )) as RawFile,
    );
  }

  private async get(url: string, resourceKeys?: Record<string, string>): Promise<unknown> {
    for (const force of [false, true]) {
      const headers: Record<string, string> = {
        authorization: `Bearer ${await this.getToken(force)}`,
      };
      if (resourceKeys)
        headers['x-goog-drive-resource-keys'] = Object.entries(resourceKeys)
          .map(([id, key]) => `${id}/${key}`)
          .join(',');
      const response = await this.fetchImpl(url, { headers });
      // An expired access token is refreshed once; anything else is the caller's problem.
      if (response.status === 401 && !force) continue;
      if (!response.ok) throw new DriveError(response.status);
      return response.json();
    }
    throw new DriveError(401);
  }
}
