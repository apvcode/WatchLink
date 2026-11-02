import { ipcRenderer, webFrame } from 'electron';
import { type ContentBridge, injectBridge } from '../../../packages/adapters/src/bridge.js';

// The bridge reports straight over IPC. It used to relay window.postMessage events, which let any
// page script forge player state; this function lives only in the isolated world.
(window as unknown as { __watchlink_send?: unknown }).__watchlink_send = (message: unknown) =>
  ipcRenderer.send('watchlink:content', message);
ipcRenderer.on('watchlink:command', (_event, command) => {
  const bridge = (window as unknown as { __watchlink_bridge__?: ContentBridge })
    .__watchlink_bridge__;
  bridge?.handleCommand(command);
});
window.addEventListener(
  'DOMContentLoaded',
  () => {
    const w = window as unknown as { __watchlink_bridge__?: unknown };
    if (!w.__watchlink_bridge__) w.__watchlink_bridge__ = injectBridge(window);
  },
  { once: true },
);

// Lets adapters reach page-defined player APIs (main world) from the isolated world.
(window as unknown as { __watchlink_main?: unknown }).__watchlink_main = (code: string) =>
  webFrame.executeJavaScript(code);
