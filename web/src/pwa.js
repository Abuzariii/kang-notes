// Service worker: lets the app open offline and picks up new versions by itself.
// When a new version takes over, the page reloads at the next safe moment
// (immediately if nothing is being typed, otherwise when the app is hidden).
export function setupUpdates({ isBusy, onUpdateReady }) {
  const params = new URLSearchParams(location.search);
  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (!('serviceWorker' in navigator) || (local && !params.has('sw'))) return;

  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  const reload = () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  };

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return; // first install, nothing to refresh
    if (!isBusy()) return reload();
    onUpdateReady(reload);
    document.addEventListener('visibilitychange', () => document.hidden && reload());
  });

  navigator.serviceWorker.register('sw.js').then((reg) => {
    const check = () => reg.update().catch(() => {});
    setInterval(check, 30 * 60e3);
    document.addEventListener('visibilitychange', () => !document.hidden && check());
  }).catch(() => {});
}
