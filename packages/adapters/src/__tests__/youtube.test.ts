import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isYouTubeUrl, YouTubeAdapter, YouTubeController } from '../youtube.js';

describe('YouTubeAdapter and YouTubeController', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="movie_player">
        <video class="html5-main-video"></video>
      </div>
    `;
    const video = document.querySelector('video') as HTMLVideoElement;
    Object.defineProperty(video, 'duration', { value: 600, writable: true });
    Object.defineProperty(video, 'currentTime', { value: 10, writable: true });
    Object.defineProperty(video, 'playbackRate', { value: 1.0, writable: true });
    Object.defineProperty(video, 'paused', { value: false, writable: true });
    video.play = vi.fn().mockResolvedValue(undefined);
    video.pause = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('matches YouTube URLs correctly', () => {
    const adapter = new YouTubeAdapter();
    expect(adapter.id).toBe('youtube');
    expect(adapter.matches('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true);
    expect(isYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true);
    expect(isYouTubeUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(true);
    expect(isYouTubeUrl('https://m.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true);
    expect(isYouTubeUrl('https://vimeo.com/123456')).toBe(false);
  });

  it('detects ads and suppresses seek commands during ads', () => {
    const player = document.querySelector('#movie_player') as HTMLElement;
    const controller = new YouTubeController(window);

    expect(controller.getState().adPlaying).toBe(false);

    // Ad starts playing
    player.classList.add('ad-showing');
    expect(controller.getState().adPlaying).toBe(true);

    const video = document.querySelector('video') as HTMLVideoElement;
    const initialTime = video.currentTime;

    // Seek during ad should be suppressed
    controller.seek(200);
    expect(video.currentTime).toBe(initialTime);

    // Ad finishes
    player.classList.remove('ad-showing');
    expect(controller.getState().adPlaying).toBe(false);

    controller.dispose();
  });

  it('handles SPA navigation via yt-navigate-finish', async () => {
    const controller = new YouTubeController(window);
    const states: any[] = [];
    controller.onState((s) => states.push(s));

    // Dispatch SPA navigate event
    window.dispatchEvent(new CustomEvent('yt-navigate-finish'));
    await new Promise((resolve) => setTimeout(resolve, 250));

    expect(states.length).toBeGreaterThan(0);
    controller.dispose();
  });
});
