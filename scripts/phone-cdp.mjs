import WebSocket from '../packages/core/node_modules/ws/index.js';
export async function phoneEvaluate(surface, expression) {
  const pages = await (await fetch('http://127.0.0.1:9223/json/list')).json();
  const page = pages.find(
    (p) =>
      p.type === 'page' &&
      (surface === 'ui' ? p.url.includes('appassets') : !p.url.includes('appassets')),
  );
  if (!page) throw Error(`Phone ${surface} webview not found`);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });
  const result = new Promise((resolve, reject) => {
    ws.on('message', (raw) => {
      const d = JSON.parse(raw);
      if (d.id === 1) {
        ws.close();
        if (d.result?.exceptionDetails) reject(Error(d.result.exceptionDetails.text));
        else resolve(d.result?.result?.value);
      }
    });
    ws.on('error', reject);
  });
  ws.send(
    JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: { expression, returnByValue: true, awaitPromise: true, userGesture: true },
    }),
  );
  return result;
}
