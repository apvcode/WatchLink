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
