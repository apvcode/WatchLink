import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GDriveAdapter, isGDriveUrl, toGDrivePreviewUrl } from '../gdrive.js';
import { resolveAdapter } from '../registry.js';
import { isVKUrl, VKVideoAdapter } from '../vk.js';

describe('VK and Google Drive Adapters', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div class="video_box">
        <video></video>
      </div>
    `;
    const video = document.querySelector('video') as HTMLVideoElement;
    Object.defineProperty(video, 'duration', { value: 300, writable: true });
    Object.defineProperty(video, 'currentTime', { value: 0, writable: true });
    Object.defineProperty(video, 'playbackRate', { value: 1.0, writable: true });
    Object.defineProperty(video, 'paused', { value: true, writable: true });
    video.play = vi.fn().mockResolvedValue(undefined);
    video.pause = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('matches VK URLs', () => {
    expect(isVKUrl('https://vk.com/video-123_456')).toBe(true);
    expect(isVKUrl('https://vkvideo.ru/video-123_456')).toBe(true);
    expect(isVKUrl('https://vk.com/video_ext.php?oid=1&id=2')).toBe(true);
    expect(isVKUrl('https://facebook.com/video')).toBe(false);
  });

  it('matches and transforms Google Drive URLs', () => {
    expect(isGDriveUrl('https://drive.google.com/file/d/1a2b3c/view')).toBe(true);
    expect(isGDriveUrl('https://drive.google.com/file/d/1a2b3c/preview')).toBe(true);
    expect(isGDriveUrl('https://dropbox.com/s/123')).toBe(false);

    expect(toGDrivePreviewUrl('https://drive.google.com/file/d/1AbC-123/view?usp=sharing')).toBe(
      'https://drive.google.com/file/d/1AbC-123/preview',
    );
  });

  it('resolves correct adapter from registry', () => {
    expect(resolveAdapter('https://www.youtube.com/watch?v=123').id).toBe('youtube');
    expect(resolveAdapter('https://vk.com/video123').id).toBe('vk');
    expect(resolveAdapter('https://drive.google.com/file/d/123/preview').id).toBe('gdrive');
    expect(resolveAdapter('https://example.com/stream.mp4').id).toBe('generic');
  });

  it('attaches VK and GDrive controllers', () => {
    const vkAdapter = new VKVideoAdapter();
    const vkCtrl = vkAdapter.attach(window);
    expect(vkCtrl).toBeDefined();
    expect(vkCtrl?.getState().duration).toBe(300);
    vkCtrl?.dispose();

    const gdriveAdapter = new GDriveAdapter();
    const gdriveCtrl = gdriveAdapter.attach(window);
    expect(gdriveCtrl).toBeDefined();
    expect(gdriveCtrl?.getState().duration).toBe(300);
    gdriveCtrl?.dispose();
  });
});
