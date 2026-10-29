// Bridge to the Windows app (desktop/KangNotes.cs). `host` is null on the phone and in
// a normal browser. Each call posts a message with an id; the Windows app replies with
// { reply: id, ... } or { reply: id, error }. It can also send { event: name } on its own,
// e.g. "summon" when the Ctrl+Alt+N shortcut brings the window forward.
const webview = window.chrome?.webview;
const waiting = new Map();
const listeners = new Map();
let seq = 0;

webview?.addEventListener('message', (e) => {
  const msg = e.data || {};
  if (msg.event) {
    (listeners.get(msg.event) || []).forEach((fn) => fn(msg));
    return;
  }
  const pending = waiting.get(msg.reply);
  if (!pending) return;
  waiting.delete(msg.reply);
  if (msg.error) pending.reject(new Error(msg.error));
  else pending.resolve(msg);
});

function call(type, payload = {}) {
  return new Promise((resolve, reject) => {
    const id = String(++seq);
    waiting.set(id, { resolve, reject });
    webview.postMessage({ ...payload, type, id });
    setTimeout(() => {
      if (waiting.delete(id)) reject(new Error('The Windows app didn’t answer.'));
    }, 15000);
  });
}

export const host = webview
  ? {
      // Set by the Windows app before the page loads: 'simple' or 'focus'.
      initialMode: window.kangHost?.mode === 'focus' ? 'focus' : 'simple',
      info: () => call('info'),
      backup: (fileName, content) => call('backup', { fileName, content }),
      openBackups: () => call('open-backups'),
      setAutostart: (on) => call('autostart', { on }),
      setMode: (mode) => call('mode', { mode }),
      minimize: () => call('window', { action: 'minimize' }),
      close: () => call('window', { action: 'close' }),
      // Fallback for dragging the frameless Focus window by its top bar.
      startDrag: () => webview.postMessage({ type: 'drag' }),
      on(event, fn) {
        listeners.set(event, [...(listeners.get(event) || []), fn]);
      },
    }
  : null;
