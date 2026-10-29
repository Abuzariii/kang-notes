// Small helpers shared by the whole app: ids, dates, DOM building, icons.

export const HUB_COLORS = ['#5ee6c9', '#ffb547', '#a78bfa', '#60a5fa', '#f472b6', '#a3e635', '#fb7185', '#22d3ee'];

export const MIN = 60e3;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

const ID_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export function newId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(20)), (b) => ID_CHARS[b % 62]).join('');
}

export const deviceName = window.chrome?.webview ? 'PC' : /Android/i.test(navigator.userAgent) ? 'Phone' : 'Browser';

export function ago(ms, now = Date.now()) {
  const d = now - ms;
  if (d < MIN) return 'just now';
  if (d < HOUR) return `${Math.floor(d / MIN)} min ago`;
  if (d < DAY) return `${Math.floor(d / HOUR)} h ago`;
  if (d < 7 * DAY) return `${Math.floor(d / DAY)} d ago`;
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function until(ms, now = Date.now()) {
  const d = ms - now;
  if (d <= 0) return 'now';
  if (d < MIN) return 'in under a minute';
  if (d < HOUR) return `in ${Math.ceil(d / MIN)} min`;
  if (d < DAY) return `in ${Math.floor(d / HOUR)} h`;
  const days = Math.floor(d / DAY);
  return `in ${days} day${days > 1 ? 's' : ''}`;
}

export function fullDate(ms) {
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

// <input type="datetime-local"> works in local time without seconds.
export function toLocalInput(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fromLocalInput(value) {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

export function debounce(fn, ms) {
  let timer = null;
  let args = [];
  const run = () => {
    timer = null;
    fn(...args);
  };
  const debounced = (...a) => {
    args = a;
    clearTimeout(timer);
    timer = setTimeout(run, ms);
  };
  debounced.flush = () => {
    if (timer) {
      clearTimeout(timer);
      run();
    }
  };
  debounced.pending = () => timer !== null;
  return debounced;
}

// h('button', { class: 'x', onclick }, 'Label', child) builds DOM without innerHTML,
// so note text can never inject markup. Only `html` (used for our own icons) sets innerHTML.
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'hidden') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

const svg = (body) => `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;

export const icons = {
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  node: svg('<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8" stroke-dasharray="3 3"/>'),
  trash: svg('<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5"/>'),
  menu: svg('<path d="M5 12h.01M12 12h.01M19 12h.01" stroke-width="3.2"/>'),
  back: svg('<path d="M14.5 5.5 8 12l6.5 6.5"/>'),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  search: svg('<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>'),
  history: svg('<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v3.5h3.5M12 8v4.5l3 1.8"/>'),
  clock: svg('<circle cx="12" cy="12" r="8"/><path d="M12 8v4.5l3 1.8"/>'),
  restore: svg('<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v3.5h3.5"/>'),
  target: svg('<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'),
  check: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  pin: svg('<path d="M9 4h6l-1 5 3 3v2H7v-2l3-3-1-5zM12 14v6"/>'),
  minimize: svg('<path d="M6 12h12"/>'),
  chevron: svg('<path d="m9.5 6 6 6-6 6"/>'),
};
