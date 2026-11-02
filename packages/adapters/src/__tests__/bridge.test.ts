import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentBridge, pinOuterWindowSize } from '../bridge.js';

describe('ContentBridge', () => {
  let video: HTMLVideoElement;

  beforeEach(() => {
    document.body.innerHTML = '<video></video>';
    video = document.querySelector('video') as HTMLVideoElement;
    Object.defineProperty(video, 'duration', { value: 50, writable: true });
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
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('receives host commands and controls player', async () => {
    const bridge = new ContentBridge(window);
    bridge.init();

    const controller = bridge.getController();
    expect(controller).toBeDefined();

    // Send play command via window.postMessage
    window.dispatchEvent(
      new MessageEvent('message', { data: { type: 'watchlink:cmd:play' }, source: window }),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(video.play).toHaveBeenCalled();

    // Send seek command
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'watchlink:cmd:seek', position: 25 },
        source: window,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(video.currentTime).toBe(25);

    // Send rate command
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'watchlink:cmd:rate', rate: 1.5 },
        source: window,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(video.playbackRate).toBe(1.5);

    bridge.dispose();
  });

  it('posts messages to Android WatchLinkBridge if present', () => {
    const androidPost = vi.fn();
    (window as any).WatchLinkBridge = {
      postMessage: androidPost,
    };

    const bridge = new ContentBridge(window);
    bridge.init();

    expect(androidPost).toHaveBeenCalled();
    const firstCall = androidPost.mock.calls[0];
    expect(firstCall).toBeDefined();
    if (firstCall) {
      const parsed = JSON.parse(firstCall[0]);
      expect(parsed.type).toBe('watchlink:ready');
    }

    delete (window as any).WatchLinkBridge;
    bridge.dispose();
  });
});

describe('pinOuterWindowSize', () => {
  it('is self-contained: it still works after being stringified into the page', () => {
    const fake = { screen: { width: 1920, height: 1080 }, outerWidth: 300, outerHeight: 200 };
    const run = new Function(`return (${pinOuterWindowSize.toString()})`)() as (w: unknown) => void;
    run(fake);
    expect(fake.outerWidth).toBe(1920);
    expect(fake.outerHeight).toBe(1080);
  });
});
