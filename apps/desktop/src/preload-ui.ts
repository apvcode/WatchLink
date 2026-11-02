import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('watchlinkHost', {
  send: (message: unknown) => ipcRenderer.send('watchlink:ui', message),
  subscribe: (callback: (data: unknown) => void) => {
    const listener = (_event: unknown, data: unknown) => callback(data);
    ipcRenderer.on('watchlink:host', listener);
    return () => ipcRenderer.removeListener('watchlink:host', listener);
  },
});
