import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findBestVideoElement, GenericAdapter, GenericVideoController } from '../generic.js';

describe('GenericAdapter and Controller', () => {
  let video: HTMLVideoElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    video = document.createElement('video');
    Object.defineProperty(video, 'duration', { value: 120, writable: true });
    Object.defineProperty(video, 'currentTime', { value: 0, writable: true });
    Object.defineProperty(video, 'playbackRate', { value: 1.0, writable: true });
    Object.defineProperty(video, 'paused', { value: true, writable: true });
    video.play = vi.fn().mockImplementation(() => {
      Object.defineProperty(video, 'paused', { value: false });
      video.dispatchEvent(new Event('play'));
      return Promise.resolve();
    });
    video.pause = vi.fn().mockImplementation(() => {
      Object.defineProperty(video, 'paused', { value: true });
      video.dispatchEvent(new Event('pause'));
    });
    document.body.appendChild(video);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('finds best video element by duration and area', () => {
    const smallVideo = document.createElement('video');
    Object.defineProperty(smallVideo, 'duration', { value: 0 });
    document.body.appendChild(smallVideo);

    const best = findBestVideoElement(document);
    expect(best).toBe(video);
  });

  it('matches all URLs as generic fallback', () => {
    const adapter = new GenericAdapter();
    expect(adapter.matches('https://example.com/movie.mp4')).toBe(true);
    expect(adapter.matches('file:///path/to/video.mp4')).toBe(true);
  });

  it('tracks play, pause, seek, rate and origin', async () => {
    const controller = new GenericVideoController(window, video);
    const events: any[] = [];
    controller.onEvent((e) => events.push(e));

    // Programmatic play
    await controller.play();
    expect(video.play).toHaveBeenCalled();
    expect(events.length).toBeGreaterThan(0);
    const playEvent = events.find((e) => e.type === 'play');
    expect(playEvent?.origin).toBe('program');

    // User pause (simulated direct event on video element without controller.pause())
    events.length = 0;
    Object.defineProperty(video, 'paused', { value: true });
    video.dispatchEvent(new Event('pause'));
    expect(events.length).toBe(1);
    expect(events[0].type).toBe('pause');
    expect(events[0].origin).toBe('user');

    // Programmatic seek
    events.length = 0;
    controller.seek(45);
    expect(video.currentTime).toBe(45);
    video.dispatchEvent(new Event('seeking'));
    expect(events.length).toBe(1);
    expect(events[0].type).toBe('seek');
    expect(events[0].origin).toBe('program');

    // User seek
    events.length = 0;
    video.currentTime = 60;
    video.dispatchEvent(new Event('seeking'));
    expect(events.length).toBe(1);
    expect(events[0].type).toBe('seek');
    expect(events[0].origin).toBe('user');

    // Set rate
    controller.setRate(1.25);
    expect(video.playbackRate).toBe(1.25);

    controller.dispose();
  });

  it('handles buffering states', () => {
    const controller = new GenericVideoController(window, video);
    const events: any[] = [];
    controller.onEvent((e) => events.push(e));

    // Waiting fires buffering: true
    video.dispatchEvent(new Event('waiting'));
    expect(events.some((e) => e.type === 'buffering' && e.buffering === true)).toBe(true);
    expect(controller.getState().buffering).toBe(true);

    // Playing fires buffering: false
    video.dispatchEvent(new Event('playing'));
    expect(events.some((e) => e.type === 'buffering' && e.buffering === false)).toBe(true);
    expect(controller.getState().buffering).toBe(false);

    controller.dispose();
  });

  it('observes DOM mutations when video is added dynamically', async () => {
    document.body.innerHTML = '<div>No video yet</div>';
    const controller = new GenericVideoController(window, null);
    expect(controller.getState().duration).toBe(0);

    // Now inject video
    const dynVideo = document.createElement('video');
    Object.defineProperty(dynVideo, 'duration', { value: 300 });
    document.body.appendChild(dynVideo);

    // Wait for mutation observer tick
    await new Promise((resolve) => setTimeout(resolve, 50));
    controller.bindVideo(dynVideo);

    expect(controller.getState().duration).toBe(300);
    controller.dispose();
  });
});

describe('cued embedded player (Google Drive on phones)', () => {
  /** A cued player; `loadsOnPlay` makes playVideo() deliver data like the real embed does. */
  function cuedPage(loadsOnPlay: boolean) {
    document.body.innerHTML = '';
    const calls: string[] = [];
    const player = document.createElement('div');
    player.id = 'movie_player';
    const video = document.createElement('video');
    Object.defineProperty(video, 'readyState', { value: 0, writable: true, configurable: true });
    const load = () => {
      Object.defineProperty(video, 'readyState', { value: 4, configurable: true });
      video.dispatchEvent(new Event('loadeddata'));
    };
    const api = player as unknown as Record<string, () => unknown>;
    api.getPlayerState = () => 5;
    for (const method of ['mute', 'unMute', 'pauseVideo'])
      api[method] = () => {
        calls.push(method);
      };
    api.playVideo = () => {
      calls.push('playVideo');
      if (loadsOnPlay) setTimeout(load, 5);
    };
    player.appendChild(video);
    document.body.appendChild(player);
    return { calls, video, load };
  }
  const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));

  it('starts the player muted to load it, then pauses it again', async () => {
    const { calls, video } = cuedPage(true);
    const controller = new GenericVideoController(window, video);
    await tick(600);
    expect(calls).toEqual(['mute', 'playVideo', 'pauseVideo', 'unMute']);
    controller.dispose();
  });

  it('keeps playing when play() arrives while the player is still being woken', async () => {
    const { calls, video, load } = cuedPage(false);
    const controller = new GenericVideoController(window, video);
    await tick(400);
    const playing = controller.play();
    await tick(400);
    load();
    await playing;
    await tick(100);
    expect(calls).not.toContain('pauseVideo');
    expect(calls.filter((c) => c === 'playVideo').length).toBeGreaterThanOrEqual(2);
    controller.dispose();
  });

  it('leaves ordinary pages alone', async () => {
    document.body.innerHTML = '<video></video>';
    const controller = new GenericVideoController(window, document.querySelector('video'));
    await tick();
    controller.dispose();
  });
});
