import { describe, expect, it } from 'vitest';
import { driveShareUrl, fmtSize, isDriveFileUrl } from '../../packages/ui/src/drive-links';

describe('drive links', () => {
  it('builds the share link, keeping the resource key', () => {
    expect(driveShareUrl('abc_DEF-123')).toBe('https://drive.google.com/file/d/abc_DEF-123/view');
    expect(driveShareUrl('abc', 'rk 1')).toBe(
      'https://drive.google.com/file/d/abc/view?resourcekey=rk+1',
    );
  });

  it('recognises Drive file links in any form, nothing else', () => {
    expect(isDriveFileUrl('https://drive.google.com/file/d/abcDEF123456/preview')).toBe(true);
    expect(isDriveFileUrl('https://drive.google.com/drive/folders/abcDEF123456')).toBe(false);
    expect(isDriveFileUrl('https://evil.example/file/d/abcDEF123456')).toBe(false);
    expect(isDriveFileUrl('nope')).toBe(false);
  });

  it('formats sizes', () => {
    expect(fmtSize(undefined)).toBe('');
    expect(fmtSize(512)).toBe('512 B');
    expect(fmtSize(1536)).toBe('1.5 KB');
    expect(fmtSize(3 * 1024 ** 3)).toBe('3.0 GB');
  });
});
