// Runs before route imports in the explicit design environment. Metro and the
// canvas loopback APIs continue to work; app JS requests cannot call a backend.
const local = (value: string) => { try { const url = new URL(value); return ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || ['file:', 'data:', 'blob:'].includes(url.protocol); } catch { return false; } };
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => local(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  ? originalFetch(input, init) : Promise.reject(new Error('External requests are disconnected in Canvas design preview.'));
const open = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function(this: XMLHttpRequest, method: string, url: string, ...args: any[]) {
  if (!local(String(url))) throw new Error('External requests are disconnected in Canvas design preview.');
  return (open as any).call(this, method, url, ...args);
} as any;
