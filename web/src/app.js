// The app once signed in, in one of two layouts:
//   Simple: top bar, 3D graph, and a side panel (a bottom sheet on phones) with views:
//           home, hub (a node's projects and notes), note editor, history, trash, search, new node.
//   Focus:  Windows app only. A small window that stays on top, with a quick-note box,
//           one node's notes, search and the editor. No graph.
import { createGraph } from './graph.js';
import { mockData } from './mock.js';
import { host } from './host.js';
import {
  h, icons, newId, deviceName, ago, until, fullDate, toLocalInput, fromLocalInput, debounce, HUB_COLORS, HOUR, DAY,
} from './util.js';

const HISTORY_KEEP = 10;
const HISTORY_EVERY = 10 * 60e3; // during long edits, also keep a version every 10 minutes
const FULL_VIEWS = new Set(['note', 'history']); // full screen on phones
const mobile = matchMedia('(max-width: 760px)');

const firstLine = (text) => (text || '').split('\n').find((l) => l.trim())?.trim() || '';
const noteName = (note) => note.title.trim() || firstLine(note.body) || 'Untitled';
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const sameProject = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

function normalizeNote(n) {
  return {
    title: '', body: '', project: '', tags: [], history: [], expiresAt: null, trashedAt: null, trashReason: null,
    createdAt: 0, updatedAt: 0, ...n,
  };
}

export function startApp({ store, source, email, version, onSignOut }) {
  const params = new URLSearchParams(location.search);
  const canSwitchLayout = Boolean(host) || params.has('layout'); // ?layout=focus lets the tests try Focus in a browser
  let layout = host ? host.initialMode : params.get('layout') === 'focus' ? 'focus' : 'simple';
  let hubs = [];
  let notes = [];
  let status = {};
  let hubById = new Map();
  let noteById = new Map();
  let view = { type: 'home' };
  let depth = 0;
  let editor = null;
  let current = { key: '', target: null, refresh: undefined };
  let searchText = '';
  let focusHubId = readText('focusHub', '');
  let focusProject = '';
  let focusSearch = '';
  let loaded = false;
  let blocked = false;
  const booming = new Set();

  // ---------- layout ----------
  const graphEl = h('div', { class: 'graph' });
  const searchInput = h('input', {
    type: 'search', placeholder: 'Search notes or #tags', 'aria-label': 'Search notes', enterkeyhint: 'search',
    oninput: () => onSearch(searchInput.value),
  });
  const syncEl = h('span', { class: 'sync' });
  const trashCount = h('span', { class: 'count' });
  const menuBtn = h('button', { class: 'btn icon', title: 'More', html: icons.menu, onclick: (e) => toggleMenu(e) });
  const topbar = h('header', { class: 'topbar' },
    h('button', { class: 'brand', title: 'Show all nodes (Home)', onclick: () => home() },
      h('span', { class: 'logo', html: LOGO }), h('span', { class: 'brand-name' }, 'kang-notes')),
    h('label', { class: 'search' }, h('span', { html: icons.search }), searchInput),
    syncEl,
    h('div', { class: 'actions' },
      canSwitchLayout ? layoutSwitch() : null,
      h('button', { class: 'btn primary', title: 'New note (N)', onclick: () => newNote() },
        h('span', { html: icons.plus }), h('span', { class: 'label' }, 'Note')),
      h('button', { class: 'btn', title: 'New node', onclick: () => go({ type: 'new-hub' }) },
        h('span', { html: icons.node }), h('span', { class: 'label' }, 'Node')),
      h('button', { class: 'btn icon trash-btn', title: 'Trash', onclick: () => go({ type: 'trash' }) },
        h('span', { html: icons.trash }), trashCount),
      menuBtn));
  const hint = h('div', { class: 'hint' }, mobile.matches
    ? 'Drag to rotate · pinch to zoom · tap a node to open it'
    : 'Drag to rotate · scroll to zoom · right-drag to move · click a node to open it');
  const panel = h('aside', { class: 'panel' });
  const stage = h('main', { class: 'stage' }, graphEl, topbar, hint);

  const focusDot = h('i', { class: 'f-dot' });
  const focusBody = h('div', { class: 'f-body' });
  const focusShell = h('section', { class: 'focus' },
    h('header', {
      class: 'f-head',
      // Normally Windows drags the window by this bar itself (app-region: drag). If that is
      // not available, mouse-downs reach the page and we ask the Windows app to drag.
      onmousedown: (e) => e.button === 0 && !e.target.closest('button, select, input') && host?.startDrag(),
    },
    h('span', { class: 'logo', html: LOGO }), h('span', { class: 'f-title' }, 'kang-notes'), focusDot,
    h('span', { class: 'spacer' }),
    canSwitchLayout ? layoutSwitch() : null,
    host ? h('button', { class: 'f-win', title: 'Minimize', html: icons.minimize, onclick: () => host.minimize() }) : null,
    host ? h('button', { class: 'f-win close', title: 'Close kang-notes', html: icons.close, onclick: () => host.close() }) : null),
    focusBody);

  const menu = h('div', { class: 'menu', hidden: true });
  const toastEl = h('div', { class: 'toast', hidden: true, role: 'status' });
  const loading = h('div', { class: 'loading' }, h('span', { class: 'spinner' }), 'Loading your notes…');
  const root = document.getElementById('app');
  root.replaceChildren(stage, panel, focusShell, menu, toastEl, loading);
  root.classList.add('signed-in');
  if (source === 'demo') stage.append(h('div', { class: 'demo-pill', title: 'Notes in demo mode stay in this browser only' }, 'Demo'));

  function layoutSwitch() {
    return h('div', { class: 'seg', role: 'group', 'aria-label': 'Layout' },
      h('button', { 'data-layout': 'simple', title: 'Simple: the full app with the 3D graph', onclick: () => switchLayout('simple') }, 'Simple'),
      h('button', { 'data-layout': 'focus', title: 'Focus: a small window that stays on top, for quick notes (Ctrl+Shift+F)', onclick: () => switchLayout('focus') },
        h('span', { html: icons.pin }), 'Focus'));
  }

  const graph = createGraph(graphEl, {
    onHub: (hubId) => go({ type: 'hub', hubId }),
    onProject: (hubId, project) => go({ type: 'hub', hubId, project }),
    onNote: (noteId) => go({ type: 'note', noteId }),
  });
  graph.setEffects(readPref('effects', true));

  // ---------- data ----------
  function onData(snap) {
    hubs = snap.hubs.slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    notes = snap.notes.map(normalizeNote);
    status = snap.status || {};
    hubById = new Map(hubs.map((x) => [x.id, x]));
    noteById = new Map(notes.map((x) => [x.id, x]));
    for (const id of booming) if (!noteById.get(id) || noteById.get(id).trashedAt) booming.delete(id);
    if (!loaded) {
      loaded = true;
      loading.remove();
      store.seedOnce(mockData());
    }
    view = validate(view);
    syncGraph();
    render();
    checkExpiry();
  }

  const activeNotes = () => notes.filter((n) => !n.trashedAt && hubById.has(n.hubId));
  const trashedNotes = () => notes.filter((n) => n.trashedAt).sort((a, b) => b.trashedAt - a.trashedAt);
  const notesOf = (hubId) => activeNotes().filter((n) => n.hubId === hubId);
  const projectsOf = (hubId) => [...new Set(notesOf(hubId).map((n) => n.project.trim()).filter(Boolean))].sort();
  const byRecent = (a, b) => b.updatedAt - a.updatedAt;
  const recentHub = () => activeNotes().sort(byRecent)[0]?.hubId || hubs[0]?.id || '';

  // Optimistic local updates, so the UI changes before the store echoes the write back.
  function patchNote(id, patch) {
    const note = noteById.get(id);
    if (note) Object.assign(note, patch);
    store.updateNote(id, patch);
  }

  function createNote(hubId, fields = {}) {
    const now = Date.now();
    const note = normalizeNote({ id: newId(), hubId, createdAt: now, updatedAt: now, device: deviceName, ...fields });
    store.addNote({ ...note });
    notes.push(note);
    noteById.set(note.id, note);
    syncGraph();
    return note;
  }

  // The graph unfolds the node you're in (or the node of the note you're editing).
  function expandedFor(v) {
    if (v.type === 'hub') return v.hubId;
    if (v.type === 'note' || v.type === 'history') return noteById.get(v.noteId)?.hubId || null;
    return null;
  }

  function syncGraph() {
    graph.update(hubs, activeNotes(), expandedFor(view));
    graph.setHighlight(searchText ? searchResults(searchText).map((n) => n.id) : null);
  }

  // ---------- navigation ----------
  function validate(v) {
    if (v.type === 'hub' && !hubById.has(v.hubId)) return { type: 'home' };
    if (v.type === 'note' || v.type === 'history') {
      const note = noteById.get(v.noteId);
      if (!note || note.trashedAt) return note && hubById.has(note.hubId) ? { type: 'hub', hubId: note.hubId } : { type: 'home' };
    }
    return v;
  }

  function go(next, { replace = false } = {}) {
    closeMenu();
    view = validate(next);
    if (replace) history.replaceState({ view, depth }, '');
    else history.pushState({ view, depth: ++depth }, '');
    syncGraph();
    render();
    aimCamera();
  }

  function back() {
    if (depth > 0) history.back();
    else go(parentOf(view), { replace: true });
  }

  function parentOf(v) {
    if (v.type === 'history') return { type: 'note', noteId: v.noteId };
    if (v.type === 'note') return { type: 'hub', hubId: noteById.get(v.noteId)?.hubId };
    if (v.type === 'hub' && v.project) return { type: 'hub', hubId: v.hubId };
    return { type: 'home' };
  }

  function home() {
    if (searchText) clearSearch();
    go({ type: 'home' });
  }

  window.addEventListener('popstate', (e) => {
    const next = e.state?.view || { type: 'home' };
    depth = e.state?.depth || 0;
    closeMenu();
    if (view.type === 'search' && next.type !== 'search') clearSearch();
    view = validate(next);
    syncGraph();
    render();
    aimCamera();
  });
  history.replaceState({ view, depth }, '');

  function aimCamera() {
    if (layout === 'focus') return;
    if (view.type === 'hub') {
      graph.select(`h:${view.hubId}`);
      if (!(view.project && graph.focusProject(view.hubId, view.project))) graph.focusHub(view.hubId);
    } else if (view.type === 'note') {
      graph.select(`n:${view.noteId}`);
      // A brand-new note is still drifting into place, so show its node instead.
      if (editor?.isNew && editor.noteId === view.noteId) graph.focusHub(noteById.get(view.noteId)?.hubId);
      else graph.focusNote(view.noteId);
    } else if (view.type === 'home') {
      graph.select(null);
      graph.reset();
    }
  }

  function switchLayout(next) {
    if (next === layout || !canSwitchLayout) return;
    editor?.flush();
    layout = next;
    if (next === 'focus' && view.type !== 'note' && view.type !== 'history') {
      const hubId = expandedFor(view) || (hubById.has(focusHubId) ? focusHubId : recentHub());
      view = hubId ? { type: 'hub', hubId } : { type: 'home' };
      history.replaceState({ view, depth }, '');
    }
    syncGraph();
    render();
    aimCamera();
    host?.setMode(next).catch((err) => toast(err.message));
  }

  // ---------- rendering ----------
  // Each view returns { els, refresh }. When the same view is shown again after a data change,
  // refresh() updates it in place, so text you're typing (quick note, editor) is never wiped.
  // refresh undefined = rebuild every time; null = leave as it is.
  function render() {
    renderStatus();
    root.dataset.layout = layout;
    root.dataset.view = view.type;
    root.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('on', b.dataset.layout === layout));
    const target = layout === 'focus' ? focusBody : panel;
    const key = `${layout}|${view.type}|${view.hubId || ''}|${view.noteId || ''}|${view.project || ''}`;
    if (current.key === key && current.target === target && current.refresh !== undefined) {
      current.refresh?.();
    } else {
      if (editor) closeEditor();
      const built = layout === 'focus' ? buildFocusView() : buildPanelView();
      target.replaceChildren(...built.els);
      target.dataset.view = view.type;
      current = { key, target, refresh: built.refresh };
    }
    if (layout === 'focus' || (FULL_VIEWS.has(view.type) && mobile.matches)) graph.pause();
    else graph.resume();
  }

  function buildPanelView() {
    switch (view.type) {
      case 'hub': return hubView(hubById.get(view.hubId));
      case 'note': return editorView(noteById.get(view.noteId));
      case 'history': return { els: historyView(noteById.get(view.noteId)) };
      case 'trash': return { els: trashView() };
      case 'search': return { els: searchView() };
      case 'new-hub': return { els: newHubView(), refresh: null };
      default: return { els: homeView() };
    }
  }

  function buildFocusView() {
    switch (view.type) {
      case 'note': return editorView(noteById.get(view.noteId), { compact: true });
      case 'history': return { els: historyView(noteById.get(view.noteId)) };
      case 'new-hub': return { els: newHubView(), refresh: null };
      default: return focusListView();
    }
  }

  function renderStatus() {
    const trashed = trashedNotes().length;
    trashCount.textContent = trashed ? String(trashed) : '';
    let text = 'Synced';
    let cls = 'ok';
    let tip = 'All changes are saved and synced';
    if (source === 'demo') [text, cls, tip] = ['This browser', 'demo', 'Demo mode: notes stay in this browser only'];
    else if (!navigator.onLine) [text, cls, tip] = ['Offline', 'off', 'Changes are saved on this device and sync when you’re back online'];
    else if (status.pending) [text, cls, tip] = ['Saving…', 'busy', 'Uploading your latest changes'];
    else if (status.fromCache) [text, cls, tip] = ['Connecting…', 'busy', 'Showing the copy on this device while connecting'];
    syncEl.className = `sync ${cls}`;
    syncEl.title = tip;
    syncEl.replaceChildren(h('i'), h('span', null, text));
    focusDot.className = `f-dot ${cls}`;
    focusDot.title = `${text}: ${tip}`;
  }

  function head(left, extra = []) {
    return h('div', { class: 'panel-head' }, left, h('span', { class: 'spacer' }), extra);
  }

  const backButton = () => h('button', { class: 'btn icon ghost', title: 'Back (Esc)', html: icons.back, onclick: back });

  // A box at the top of a node for jotting something down: Enter adds it as a note.
  // The first line becomes the title, the rest the text.
  function captureBox(getHubId, getProject) {
    const text = h('textarea', {
      class: 'cap-text', rows: 1, 'aria-label': 'Quick note', enterkeyhint: 'send',
      placeholder: mobile.matches && !host ? 'Quick note…' : 'Quick note… press Enter to add',
      title: 'Enter adds it, Shift+Enter starts a new line. The first line becomes the title.',
      oninput: () => grow(),
      onkeydown: (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
          e.preventDefault();
          submit();
        }
      },
    });
    const grow = () => {
      text.style.height = 'auto';
      text.style.height = `${Math.min(text.scrollHeight, 180)}px`;
      text.style.overflowY = text.scrollHeight > 180 ? 'auto' : 'hidden';
    };
    function submit() {
      const raw = text.value.trim();
      if (!raw) return text.focus();
      const hubId = getHubId();
      if (!hubById.has(hubId)) return toast('Pick or create a node first.');
      const [first, ...rest] = raw.split('\n');
      const note = createNote(hubId, { title: first.trim().slice(0, 200), body: rest.join('\n').trim(), project: getProject() || '' });
      text.value = '';
      grow();
      text.focus();
      current.refresh?.();
      toast(`Added to ${hubById.get(hubId).name}`, { action: { label: 'Open', fn: () => go({ type: 'note', noteId: note.id }) } });
    }
    return {
      el: h('div', { class: 'capture' }, text,
        h('button', { class: 'btn primary small cap-add', title: 'Add note (Enter)', onclick: submit }, 'Add')),
      focus: () => text.focus(),
    };
  }

  function homeView() {
    const cards = hubs.map((hub) => {
      const hubNotes = notesOf(hub.id);
      const projects = new Set(hubNotes.map((n) => n.project.trim().toLowerCase()).filter(Boolean)).size;
      const last = hubNotes.sort(byRecent)[0];
      return h('button', { class: 'hub-card', style: `--c:${hub.color}`, onclick: () => go({ type: 'hub', hubId: hub.id }) },
        h('i', { class: 'dot' }),
        h('span', { class: 'hub-card-text' },
          h('span', { class: 'hub-card-name' }, hub.name),
          h('span', { class: 'muted' }, `${plural(hubNotes.length, 'note')} · ${plural(projects, 'project')}${last ? ` · ${ago(last.updatedAt)}` : ''}`)),
        h('span', { class: 'chev', html: icons.chevron }));
    });
    const recent = activeNotes().sort(byRecent).slice(0, 8);
    return [
      head(h('h2', null, 'All nodes'), h('button', { class: 'btn small', onclick: () => go({ type: 'new-hub' }) }, '+ Node')),
      h('div', { class: 'panel-body' },
        hubs.length
          ? [
            h('p', { class: 'muted lead' }, 'Open a node to see its projects and notes.'),
            h('div', { class: 'hub-list' }, cards, h('button', { class: 'hub-card add', onclick: () => go({ type: 'new-hub' }) }, '+ New node')),
          ]
          : h('div', { class: 'empty' },
            h('p', null, 'Create your first node, for example a company you work with.'),
            h('button', { class: 'btn primary', onclick: () => go({ type: 'new-hub' }) }, 'Create a node')),
        recent.length ? h('div', { class: 'recent' }, h('h3', null, 'Recently edited'), recent.map((n) => noteRow(n, { showHub: true }))) : null),
    ];
  }

  function hubView(hub) {
    const project = view.project || '';
    const nameInput = h('input', {
      class: 'title-input', value: hub.name, 'aria-label': 'Node name', maxlength: 60,
      onchange: () => {
        const name = nameInput.value.trim();
        if (!name) return void (nameInput.value = hubById.get(hub.id)?.name || '');
        store.updateHub(hub.id, { name, updatedAt: Date.now() });
      },
      onkeydown: (e) => e.key === 'Enter' && nameInput.blur(),
    });
    const title = h('div', { class: 'hub-title', style: `--c:${hub.color}` }, h('i', { class: 'dot' }), nameInput);
    const swatches = h('div', { class: 'swatches' });
    const options = h('div', { class: 'hub-options', hidden: true },
      swatches, h('button', { class: 'btn danger small', onclick: () => deleteHub(hubById.get(hub.id)) }, 'Delete node'));
    const countText = h('span', { class: 'muted' });
    const capture = captureBox(() => hub.id, () => project);
    const list = h('div', { class: 'hub-groups' });

    function refresh() {
      const fresh = hubById.get(hub.id);
      if (!fresh) return;
      title.style.setProperty('--c', fresh.color);
      if (document.activeElement !== nameInput) nameInput.value = fresh.name;
      swatches.replaceChildren(...HUB_COLORS.map((c) => h('button', {
        class: `swatch${c === fresh.color ? ' on' : ''}`, style: `--c:${c}`, title: 'Use this colour',
        onclick: () => store.updateHub(hub.id, { color: c, updatedAt: Date.now() }),
      })));
      const hubNotes = notesOf(hub.id).sort(byRecent);
      const groups = new Map();
      for (const note of hubNotes) {
        const key = note.project.trim().toLowerCase();
        if (!groups.has(key)) groups.set(key, { name: note.project.trim(), notes: [] });
        groups.get(key).notes.push(note);
      }
      const projectCount = [...groups.keys()].filter(Boolean).length;
      if (project) {
        const shown = groups.get(project.toLowerCase())?.notes || [];
        countText.textContent = plural(shown.length, 'note');
        list.replaceChildren(...(shown.length ? shown.map((n) => noteRow(n)) : [h('div', { class: 'empty' }, h('p', null, 'No notes in this project yet.'))]));
        return;
      }
      countText.textContent = `${plural(hubNotes.length, 'note')} · ${plural(projectCount, 'project')}`;
      const ordered = [...groups.values()].sort((a, b) => (a.name ? 0 : 1) - (b.name ? 0 : 1));
      list.replaceChildren(...(hubNotes.length ? ordered.map((g) => h('section', { class: 'group' },
        h('button', {
          class: 'group-head', disabled: !g.name, title: g.name ? `Open ${g.name}` : '',
          onclick: () => go({ type: 'hub', hubId: hub.id, project: g.name }),
        }, h('span', null, g.name || 'No project'), h('span', { class: 'muted' }, String(g.notes.length)), g.name ? h('span', { class: 'chev', html: icons.chevron }) : null),
        g.notes.map((n) => noteRow(n))))
        : [h('div', { class: 'empty' }, h('p', null, 'No notes here yet. Type one above and press Enter.'))]));
    }
    refresh();

    const crumbs = h('nav', { class: 'crumbs', 'aria-label': 'Where you are' },
      h('button', { class: 'crumb', onclick: () => go({ type: 'home' }) }, 'All nodes'),
      h('span', { class: 'crumb-sep', html: icons.chevron }),
      project
        ? [h('button', { class: 'crumb', onclick: () => go({ type: 'hub', hubId: hub.id }, { replace: true }) }, hub.name),
          h('span', { class: 'crumb-sep', html: icons.chevron }),
          h('span', { class: 'crumb-here' }, project)]
        : title);
    return {
      els: [
        head(crumbs, project ? null : h('button', { class: 'btn icon ghost', title: 'Colour, delete', html: icons.menu, onclick: () => (options.hidden = !options.hidden) })),
        options,
        h('div', { class: 'panel-sub' }, countText,
          h('button', { class: 'btn primary small', title: 'New note in the full editor (N)', onclick: () => newNote(hub.id, project) }, '+ New note')),
        h('div', { class: 'panel-body' }, capture.el, list),
      ],
      refresh,
    };
  }

  function focusListView() {
    if (!hubs.length) {
      return {
        els: [h('div', { class: 'empty' },
          h('p', null, 'Create your first node, for example a company you work with.'),
          h('button', { class: 'btn primary', onclick: () => go({ type: 'new-hub' }) }, 'Create a node'))],
      };
    }
    const hubId = view.type === 'hub' && hubById.has(view.hubId) ? view.hubId : hubById.has(focusHubId) ? focusHubId : recentHub();
    focusHubId = hubId;
    writeText('focusHub', hubId);
    const hubSelect = h('select', {
      class: 'f-hub', 'aria-label': 'Node',
      onchange: () => {
        if (hubSelect.value === '__new') return go({ type: 'new-hub' });
        focusProject = '';
        go({ type: 'hub', hubId: hubSelect.value }, { replace: true });
      },
    });
    const projectList = h('datalist', { id: 'f-projects' });
    const projectInput = h('input', {
      class: 'f-project', placeholder: 'All projects', 'aria-label': 'Project', list: 'f-projects', value: focusProject, maxlength: 60,
      title: 'Show one project; quick notes go into it',
      oninput: () => {
        focusProject = projectInput.value.trim();
        refresh();
      },
    });
    const searchBox = h('input', {
      type: 'search', placeholder: 'Search all notes', 'aria-label': 'Search all notes', value: focusSearch,
      oninput: () => {
        focusSearch = searchBox.value.trim();
        refresh();
      },
    });
    const capture = captureBox(() => hubId, () => focusProject);
    const list = h('div', { class: 'f-list' });

    function refresh() {
      const hub = hubById.get(hubId);
      if (!hub) return;
      if (document.activeElement !== hubSelect) {
        hubSelect.replaceChildren(...hubs.map((x) => h('option', { value: x.id, selected: x.id === hubId }, x.name)),
          h('option', { value: '__new' }, '+ New node…'));
      }
      hubSelect.style.setProperty('--c', hub.color);
      projectList.replaceChildren(...projectsOf(hubId).map((p) => h('option', { value: p })));
      let rows;
      if (focusSearch) {
        const found = searchResults(focusSearch);
        rows = found.length ? found.map((n) => noteRow(n, { showHub: true })) : [h('p', { class: 'muted f-empty' }, 'No notes match.')];
      } else {
        const shown = notesOf(hubId).filter((n) => !focusProject || sameProject(n.project, focusProject)).sort(byRecent);
        rows = shown.length
          ? shown.map((n) => noteRow(n, { showProject: !focusProject }))
          : [h('p', { class: 'muted f-empty' }, focusProject ? `Nothing in ${focusProject} yet. Type above and press Enter.` : 'No notes yet. Type above and press Enter.')];
      }
      capture.el.hidden = Boolean(focusSearch);
      list.replaceChildren(...rows);
    }
    refresh();
    return {
      els: [
        h('div', { class: 'f-bar' }, hubSelect, projectInput, projectList),
        h('label', { class: 'f-search' }, h('span', { html: icons.search }), searchBox),
        capture.el,
        list,
      ],
      refresh,
    };
  }

  function noteRow(note, { showHub = false, showProject = showHub } = {}) {
    const hub = hubById.get(note.hubId);
    const snippet = note.title.trim() ? firstLine(note.body) : (note.body || '').split('\n').filter((l) => l.trim())[1] || '';
    const chips = [
      showHub && hub ? h('span', { class: 'chip hub' }, hub.name) : null,
      showProject && note.project ? h('span', { class: 'chip' }, note.project) : null,
      ...note.tags.map((t) => h('span', { class: 'chip tag' }, `#${t}`)),
      note.expiresAt ? expiryBadge(note.expiresAt) : null,
    ].filter(Boolean);
    return h('button', { class: 'note-row', style: `--c:${hub?.color || '#888'}`, onclick: () => go({ type: 'note', noteId: note.id }) },
      h('span', { class: 'note-top' }, h('span', { class: 'note-title' }, noteName(note)), h('span', { class: 'muted when' }, ago(note.updatedAt))),
      snippet ? h('span', { class: 'note-snippet' }, snippet) : null,
      chips.length ? h('span', { class: 'note-meta' }, chips) : null);
  }

  function expiryBadge(ms) {
    const soon = ms - Date.now() < DAY;
    return h('span', { class: `chip expiry${soon ? ' soon' : ''}`, title: `Expires ${fullDate(ms)}` },
      h('span', { html: icons.clock }), until(ms));
  }

  // ---------- note editor ----------
  function editorView(note, { compact = false } = {}) {
    const hub = hubById.get(note.hubId);
    let sent = { title: note.title, body: note.body };
    let changed = false;
    let lastVersionAt = Date.now();

    const titleEl = h('input', { class: 'ed-title', value: note.title, placeholder: 'Title', maxlength: 200, oninput: () => saveText() });
    const bodyEl = h('textarea', { class: 'ed-body', value: note.body, placeholder: 'Write something…', oninput: () => saveText() });
    const saveText = debounce(() => {
      sent = { title: titleEl.value, body: bodyEl.value };
      changed = true;
      patchNote(note.id, { ...sent, updatedAt: Date.now(), device: deviceName });
      if (Date.now() - lastVersionAt > HISTORY_EVERY) {
        lastVersionAt = Date.now();
        saveVersion(noteById.get(note.id));
      }
    }, 450);

    const hubSelect = h('select', {
      class: 'hub-select', 'aria-label': 'Node', style: `--c:${hub.color}`,
      onchange: () => {
        const target = hubById.get(hubSelect.value);
        patchNote(note.id, { hubId: target.id, updatedAt: Date.now() });
        hubSelect.style.setProperty('--c', target.color);
        projectList.replaceChildren(...projectsOf(target.id).map((p) => h('option', { value: p })));
        syncGraph();
        setTimeout(() => layout === 'simple' && graph.focusNote(note.id), 600);
      },
    }, hubs.map((x) => h('option', { value: x.id, selected: x.id === note.hubId }, x.name)));

    const listId = `projects-${note.id}`;
    const projectList = h('datalist', { id: listId }, projectsOf(note.hubId).map((p) => h('option', { value: p })));
    const projectEl = h('input', {
      class: 'field-input', value: note.project, placeholder: 'No project', list: listId, maxlength: 60,
      onchange: () => {
        patchNote(note.id, { project: projectEl.value.trim(), updatedAt: Date.now() });
        showSummary(noteById.get(note.id));
        syncGraph();
      },
      onkeydown: (e) => e.key === 'Enter' && projectEl.blur(),
    });

    const tags = tagsEditor(note.tags, (next) => {
      patchNote(note.id, { tags: next, updatedAt: Date.now() });
      showSummary(noteById.get(note.id));
    });

    const expiryInput = h('input', {
      type: 'datetime-local', class: 'field-input', 'aria-label': 'Expiry date and time',
      value: note.expiresAt ? toLocalInput(note.expiresAt) : '',
      onfocus: () => (expiryInput.min = toLocalInput(Date.now() + 60e3)),
      onchange: () => setExpiry(fromLocalInput(expiryInput.value)),
    });
    const expiryText = h('span', { class: 'expiry-text' });
    const setExpiry = (ms) => {
      if (ms != null && ms <= Date.now()) {
        toast('Pick a time in the future.');
        expiryInput.value = noteById.get(note.id).expiresAt ? toLocalInput(noteById.get(note.id).expiresAt) : '';
        return;
      }
      patchNote(note.id, { expiresAt: ms, updatedAt: Date.now() });
      expiryInput.value = ms ? toLocalInput(ms) : '';
      showExpiry(ms);
      showSummary(noteById.get(note.id));
      graph.refreshFades(activeNotes());
    };
    const showExpiry = (ms) => {
      expiryText.className = `expiry-text${ms && ms - Date.now() < DAY ? ' soon' : ''}`;
      expiryText.textContent = ms ? `Bursts ${until(ms)}, then goes to Trash` : 'Never expires';
    };
    showExpiry(note.expiresAt);
    const quick = (label, ms) => h('button', { class: 'btn small ghost', onclick: () => setExpiry(Date.now() + ms) }, label);

    // Project, tags and expiry fold away in Focus, so the note itself gets the space.
    const summaryText = h('span', { class: 'sum-text' });
    const showSummary = (n) => {
      const bits = [n.project, ...n.tags.map((t) => `#${t}`), n.expiresAt ? `expires ${until(n.expiresAt)}` : ''].filter(Boolean);
      summaryText.textContent = bits.length ? bits.join(' · ') : 'Project, tags, expiry';
    };
    showSummary(note);

    const meta = h('p', { class: 'ed-meta muted' });
    const showMeta = (n) => {
      meta.textContent = `Created ${fullDate(n.createdAt)} · Edited ${ago(n.updatedAt)}${n.device ? ` on ${n.device}` : ''}`;
    };
    showMeta(note);

    editor = {
      noteId: note.id,
      isNew: Boolean(note.isNew),
      busy: () => [titleEl, bodyEl, projectEl, expiryInput].includes(document.activeElement) || saveText.pending(),
      flush: () => saveText.flush(),
      sync(n) {
        if (!n) return;
        // Take changes made on the other device, unless you're typing in that field.
        if (n.title !== sent.title && document.activeElement !== titleEl && !saveText.pending()) {
          titleEl.value = n.title;
          sent.title = n.title;
        }
        if (n.body !== sent.body && document.activeElement !== bodyEl && !saveText.pending()) {
          bodyEl.value = n.body;
          sent.body = n.body;
        }
        if (document.activeElement !== projectEl) projectEl.value = n.project;
        if (document.activeElement !== expiryInput) expiryInput.value = n.expiresAt ? toLocalInput(n.expiresAt) : '';
        if (hubSelect.value !== n.hubId && hubById.has(n.hubId)) hubSelect.value = n.hubId;
        tags.set(n.tags);
        showExpiry(n.expiresAt);
        showSummary(n);
        showMeta(n);
      },
      close() {
        saveText.flush();
        const n = noteById.get(note.id);
        if (!n || n.trashedAt) return;
        if (!n.title.trim() && !n.body.trim() && editor.isNew) store.deleteNote(n.id);
        else if (changed) saveVersion(n);
      },
    };

    if (note.isNew) {
      delete note.isNew;
      setTimeout(() => titleEl.focus(), 50);
    }

    return {
      els: [
        h('div', { class: 'panel-head' },
          backButton(),
          hubSelect,
          h('span', { class: 'spacer' }),
          h('button', { class: 'btn icon ghost', title: 'Earlier versions', html: icons.history, onclick: () => go({ type: 'history', noteId: note.id }) }),
          h('button', { class: 'btn icon ghost danger', title: 'Move to Trash', html: icons.trash, onclick: () => trashNote(note.id) })),
        h('div', { class: 'panel-body editor' },
          titleEl,
          bodyEl,
          h('details', { class: 'ed-details', open: !compact },
            h('summary', null, h('span', { class: 'sum-label' }, 'Details'), summaryText),
            h('div', { class: 'fields' },
              h('label', { class: 'field' }, h('span', null, 'Project'), projectEl, projectList),
              h('div', { class: 'field' }, h('span', null, 'Tags'), tags.el),
              h('div', { class: 'field expiry-field' },
                h('span', null, 'Expires'),
                h('div', { class: 'expiry-row' }, expiryInput, quick('+1 h', HOUR), quick('+1 day', DAY), quick('+1 week', 7 * DAY),
                  h('button', { class: 'btn small ghost', onclick: () => setExpiry(null) }, 'Never')),
                expiryText))),
          meta),
      ],
      refresh: () => editor?.sync(noteById.get(note.id)),
    };
  }

  function closeEditor() {
    const ed = editor;
    editor = null;
    ed?.close();
  }

  function tagsEditor(initial, onChange) {
    let tags = [...initial];
    const list = h('span', { class: 'tag-list' });
    const input = h('input', {
      class: 'tag-input', placeholder: 'Add tag', maxlength: 30, enterkeyhint: 'done',
      onkeydown: (e) => {
        if ((e.key === 'Enter' || e.key === ',' || e.key === 'Tab') && input.value.trim()) {
          if (e.key !== 'Tab') e.preventDefault();
          add(input.value);
        } else if (e.key === 'Backspace' && !input.value && tags.length) {
          tags = tags.slice(0, -1);
          draw();
          onChange(tags);
        }
      },
      oninput: () => input.value.includes(',') && add(input.value),
      onblur: () => input.value.trim() && add(input.value),
    });
    function add(raw) {
      const fresh = raw.split(',').map((t) => t.trim().replace(/^#+/, '')).filter(Boolean);
      input.value = '';
      const next = [...tags];
      for (const t of fresh) if (!next.some((x) => x.toLowerCase() === t.toLowerCase())) next.push(t);
      if (next.length === tags.length) return;
      tags = next;
      draw();
      onChange(tags);
    }
    function draw() {
      list.replaceChildren(...tags.map((t) => h('span', { class: 'chip tag removable' }, `#${t}`,
        h('button', {
          class: 'chip-x', title: `Remove #${t}`, html: icons.close,
          onclick: () => {
            tags = tags.filter((x) => x !== t);
            draw();
            onChange(tags);
          },
        }))));
    }
    draw();
    return {
      el: h('div', { class: 'tags-edit', onclick: (e) => e.target === e.currentTarget && input.focus() }, list, input),
      set(next) {
        if (document.activeElement === input || JSON.stringify(next) === JSON.stringify(tags)) return;
        tags = [...next];
        draw();
      },
    };
  }

  function saveVersion(note) {
    if (!note) return;
    const entry = { title: note.title, body: note.body, project: note.project, tags: note.tags, at: Date.now(), device: deviceName };
    const last = note.history[note.history.length - 1];
    if (last && last.title === entry.title && last.body === entry.body) return;
    if (note.history.length >= HISTORY_KEEP + 2) {
      patchNote(note.id, { history: [...note.history.slice(-(HISTORY_KEEP - 1)), entry] });
    } else {
      note.history = [...note.history, entry];
      store.appendHistory(note.id, entry);
    }
  }

  function historyView(note) {
    const entries = note.history.slice().sort((a, b) => b.at - a.at);
    return [
      head([backButton(), h('h2', null, `Versions of “${noteName(note)}”`)]),
      h('div', { class: 'panel-body' },
        entries.length ? entries.map((v) => {
          const body = h('div', { class: 'version-body', hidden: true },
            h('pre', null, (v.title ? `${v.title}\n\n` : '') + v.body),
            h('button', {
              class: 'btn primary small',
              onclick: () => {
                saveVersion(noteById.get(note.id));
                patchNote(note.id, { title: v.title, body: v.body, project: v.project || '', tags: v.tags || [], updatedAt: Date.now(), device: deviceName });
                toast('Version restored');
                back();
              },
            }, 'Restore this version'));
          return h('div', { class: 'version' },
            h('button', { class: 'version-head', onclick: () => (body.hidden = !body.hidden) },
              h('span', null, v.title || firstLine(v.body) || 'Untitled'),
              h('span', { class: 'muted' }, `${ago(v.at)}${v.device ? ` · ${v.device}` : ''}`)),
            body);
        }) : h('div', { class: 'empty' }, h('p', null, 'No earlier versions yet. A version is kept each time you finish editing a note.'))),
    ];
  }

  // ---------- trash ----------
  function trashView() {
    const items = trashedNotes();
    return [
      head([backButton(), h('h2', null, 'Trash')], items.length ? h('button', { class: 'btn small danger', onclick: emptyTrash }, 'Empty trash') : null),
      h('div', { class: 'panel-body' },
        items.length ? items.map(trashRow) : h('div', { class: 'empty' }, h('p', null, 'Trash is empty.')),
        items.length ? h('p', { class: 'muted small-print' }, 'Notes stay here until you restore them, delete them, or empty the trash.') : null),
    ];
  }

  function trashRow(note) {
    const hub = hubById.get(note.hubId);
    const hubName = hub?.name || note.hubName || 'Deleted node';
    const reason = note.trashReason === 'expired' ? `Expired ${ago(note.expiresAt || note.trashedAt)}` : `Deleted ${ago(note.trashedAt)}`;
    const chooser = h('div', { class: 'restore-chooser', hidden: true });
    const row = h('div', { class: 'trash-row', style: `--c:${hub?.color || note.hubColor || '#888'}` },
      h('div', { class: 'trash-info' },
        h('span', { class: 'note-title' }, noteName(note)),
        h('span', { class: 'note-meta' }, h('span', { class: 'chip hub' }, hubName),
          h('span', { class: `chip ${note.trashReason === 'expired' ? 'expiry soon' : ''}` }, reason))),
      h('div', { class: 'trash-actions' },
        h('button', {
          class: 'btn small', onclick: () => {
            if (note.trashReason === 'expired' || (note.expiresAt && note.expiresAt <= Date.now())) chooser.hidden = !chooser.hidden;
            else restore(note, note.expiresAt);
          },
        }, h('span', { html: icons.restore }), 'Restore'),
        h('button', {
          class: 'btn small ghost danger', onclick: () => {
            if (confirm(`Delete “${noteName(note)}” forever? This can’t be undone.`)) store.deleteNote(note.id);
          },
        }, 'Delete forever')),
      chooser);
    const when = h('input', { type: 'datetime-local', class: 'field-input', value: toLocalInput(Date.now() + DAY), min: toLocalInput(Date.now() + 60e3) });
    chooser.append(
      h('span', { class: 'muted' }, 'It expired, so choose what happens next:'),
      h('div', { class: 'expiry-row' }, when,
        h('button', {
          class: 'btn small primary', onclick: () => {
            const ms = fromLocalInput(when.value);
            if (!ms || ms <= Date.now()) return toast('Pick a time in the future.');
            restore(note, ms);
          },
        }, 'Restore with this expiry'),
        h('button', { class: 'btn small', onclick: () => restore(note, null) }, 'Keep forever')));
    return row;
  }

  function restore(note, expiresAt) {
    const now = Date.now();
    const ops = [];
    if (!hubById.has(note.hubId)) {
      ops.push({ kind: 'hub', type: 'set', id: note.hubId, data: { id: note.hubId, name: note.hubName || 'Restored', color: note.hubColor || HUB_COLORS[0], createdAt: now, updatedAt: now } });
    }
    ops.push({ kind: 'note', type: 'update', id: note.id, data: { trashedAt: null, trashReason: null, expiresAt: expiresAt ?? null, updatedAt: now } });
    store.batch(ops);
    toast(`Restored “${noteName(note)}”`, { action: { label: 'Open', fn: () => go({ type: 'note', noteId: note.id }) } });
  }

  function emptyTrash() {
    const items = trashedNotes();
    if (!confirm(`Delete all ${items.length} notes in Trash forever? This can’t be undone.`)) return;
    store.batch(items.map((n) => ({ kind: 'note', type: 'delete', id: n.id })));
  }

  function trashNote(id) {
    const note = noteById.get(id);
    if (!note) return;
    const hub = hubById.get(note.hubId);
    const empty = !note.title.trim() && !note.body.trim();
    const ed = editor;
    editor = null; // skip saving a version of a note that is being thrown away
    if (ed?.noteId === id && ed.isNew && empty) {
      store.deleteNote(id);
    } else {
      patchNote(id, { trashedAt: Date.now(), trashReason: 'deleted', hubName: hub?.name || '', hubColor: hub?.color || '' });
      toast(`Moved “${noteName(note)}” to Trash`, { action: { label: 'Undo', fn: () => patchNote(id, { trashedAt: null, trashReason: null }) } });
    }
    go({ type: 'hub', hubId: note.hubId }, { replace: true });
  }

  function deleteHub(hub) {
    if (!hub) return;
    const inHub = notesOf(hub.id);
    const msg = inHub.length
      ? `Delete “${hub.name}”? Its ${plural(inHub.length, 'note')} will move to Trash.`
      : `Delete “${hub.name}”?`;
    if (!confirm(msg)) return;
    const now = Date.now();
    store.batch([
      ...inHub.map((n) => ({ kind: 'note', type: 'update', id: n.id, data: { trashedAt: now, trashReason: 'deleted', hubName: hub.name, hubColor: hub.color } })),
      { kind: 'hub', type: 'delete', id: hub.id },
    ]);
    go({ type: 'home' }, { replace: true });
  }

  // ---------- new things ----------
  function newNote(hubId, project = '') {
    hubId ||= view.type === 'hub' && hubById.has(view.hubId) ? view.hubId
      : view.type === 'note' ? noteById.get(view.noteId)?.hubId
        : layout === 'focus' && hubById.has(focusHubId) ? focusHubId : recentHub();
    if (!hubId) {
      toast('Create a node first.');
      return go({ type: 'new-hub' });
    }
    if (view.type === 'hub' && view.hubId === hubId && !project) project = view.project || (layout === 'focus' ? focusProject : '');
    const note = createNote(hubId, { project });
    note.isNew = true;
    go({ type: 'note', noteId: note.id });
  }

  function newHubView() {
    let color = HUB_COLORS[hubs.length % HUB_COLORS.length];
    const name = h('input', { class: 'field-input big', placeholder: 'Name, e.g. a company', maxlength: 60, enterkeyhint: 'done' });
    const swatches = h('div', { class: 'swatches' });
    const drawSwatches = () => swatches.replaceChildren(...HUB_COLORS.map((c) => h('button', {
      type: 'button', class: `swatch${c === color ? ' on' : ''}`, style: `--c:${c}`, title: 'Use this colour',
      onclick: () => {
        color = c;
        drawSwatches();
      },
    })));
    drawSwatches();
    const create = (e) => {
      e.preventDefault();
      const value = name.value.trim();
      if (!value) return name.focus();
      const now = Date.now();
      const hub = { id: newId(), name: value, color, createdAt: now, updatedAt: now };
      store.addHub(hub);
      hubs.push(hub);
      hubById.set(hub.id, hub);
      focusHubId = hub.id;
      go({ type: 'hub', hubId: hub.id }, { replace: true });
    };
    setTimeout(() => name.focus(), 50);
    return [
      head([backButton(), h('h2', null, 'New node')]),
      h('form', { class: 'panel-body form', onsubmit: create },
        h('label', { class: 'field' }, h('span', null, 'Name'), name),
        h('div', { class: 'field' }, h('span', null, 'Colour'), swatches),
        h('button', { class: 'btn primary', type: 'submit' }, 'Create node'),
        h('p', { class: 'muted small-print' }, 'A node is something you take notes for, such as a company or client. Inside it, notes group by project.')),
    ];
  }

  // ---------- search ----------
  function searchResults(query) {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!tokens.length) return [];
    return activeNotes().filter((n) => {
      const hay = `${n.title}\n${n.body}\n${n.project}\n${hubById.get(n.hubId)?.name || ''}\n${n.tags.map((t) => `#${t}`).join(' ')}`.toLowerCase();
      return tokens.every((t) => (t.startsWith('#') ? n.tags.some((x) => x.toLowerCase().startsWith(t.slice(1))) : hay.includes(t)));
    }).sort(byRecent);
  }

  function onSearch(value) {
    searchText = value.trim();
    if (!searchText) {
      graph.setHighlight(null);
      if (view.type === 'search') back();
      return;
    }
    graph.setHighlight(searchResults(searchText).map((n) => n.id));
    if (view.type === 'search') render();
    else go({ type: 'search' });
  }

  function clearSearch() {
    searchText = '';
    searchInput.value = '';
    graph.setHighlight(null);
  }

  function searchView() {
    const results = searchResults(searchText);
    return [
      head(h('h2', null, plural(results.length, 'result')), h('button', {
        class: 'btn small ghost',
        onclick: () => {
          clearSearch();
          back();
        },
      }, 'Clear')),
      h('div', { class: 'panel-body' },
        results.length ? results.map((n) => noteRow(n, { showHub: true })) : h('div', { class: 'empty' }, h('p', null, 'No notes match.'))),
    ];
  }

  // ---------- expiry ----------
  function checkExpiry() {
    const now = Date.now();
    for (const note of notes) {
      if (note.trashedAt || !note.expiresAt || note.expiresAt > now || booming.has(note.id)) continue;
      booming.add(note.id);
      const burst = layout === 'focus' ? Promise.resolve(false) : graph.boom(note.id);
      burst.then(() => {
        const fresh = noteById.get(note.id);
        if (!fresh || fresh.trashedAt) return;
        const hub = hubById.get(fresh.hubId);
        const wasOpen = editor?.noteId === note.id;
        if (wasOpen) editor = null;
        patchNote(note.id, {
          trashedAt: Date.now(), trashReason: 'expired', hubName: hub?.name || fresh.hubName || '', hubColor: hub?.color || fresh.hubColor || '',
        });
        syncGraph();
        if (wasOpen) {
          toast(`“${noteName(fresh)}” expired and moved to Trash`);
          go({ type: 'hub', hubId: fresh.hubId }, { replace: true });
        } else {
          render();
        }
      });
    }
  }
  setInterval(checkExpiry, 3000);
  setInterval(() => {
    graph.refreshFades(activeNotes());
    render();
  }, 60e3);

  // ---------- menu, backup, toasts ----------
  function toggleMenu(e) {
    e.stopPropagation();
    if (!menu.hidden) return closeMenu();
    const hasMock = notes.some((n) => n.mock) || hubs.some((x) => x.mock);
    const item = (label, fn, extra) => h('button', { class: 'menu-item', onclick: () => { closeMenu(); fn(); } }, label, extra);
    const check = (on) => h('span', { class: `check${on ? ' on' : ''}`, html: icons.check });
    menu.replaceChildren(
      item('Back up now', backup),
      host ? item('Open backups folder', () => host.openBackups().catch((err) => toast(err.message))) : null,
      host ? h('button', { class: 'menu-item autostart', onclick: toggleAutostart }, 'Start with Windows', check(false)) : null,
      h('button', {
        class: 'menu-item', onclick: () => {
          graph.setEffects(!graph.effects);
          writePref('effects', graph.effects);
          closeMenu();
        },
      }, 'Glow effects', check(graph.effects)),
      hasMock ? item('Remove sample notes', removeSamples) : null,
      onSignOut ? item('Sign out', () => onSignOut()) : null,
      h('div', { class: 'menu-foot muted' }, email ? h('div', null, email) : null, h('div', null, `Version ${version}`)));
    menu.hidden = false;
    const r = menuBtn.getBoundingClientRect();
    menu.style.top = `${r.bottom + 8}px`;
    menu.style.right = `${Math.max(8, innerWidth - r.right)}px`;
    if (host) {
      host.info().then((info) => {
        menu.querySelector('.autostart .check')?.classList.toggle('on', Boolean(info.autostart));
      }).catch(() => {});
    }
  }

  function closeMenu() {
    menu.hidden = true;
  }

  async function toggleAutostart() {
    const on = !menu.querySelector('.autostart .check').classList.contains('on');
    try {
      const info = await host.setAutostart(on);
      menu.querySelector('.autostart .check')?.classList.toggle('on', Boolean(info.autostart));
      toast(info.autostart ? 'kang-notes will start with Windows' : 'kang-notes won’t start with Windows');
    } catch (err) {
      toast(err.message);
    }
  }

  async function backup() {
    const stamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-');
    const name = `kang-notes-backup-${stamp}.json`;
    const json = JSON.stringify({ app: 'kang-notes', version, exportedAt: new Date().toISOString(), hubs, notes }, null, 2);
    try {
      if (host) {
        const res = await host.backup(name, json);
        toast(`Backup saved: ${res.path}`, { action: { label: 'Show', fn: () => host.openBackups() }, ms: 7000 });
      } else {
        const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        h('a', { href: url, download: name }).click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        toast('Backup downloaded');
      }
    } catch (err) {
      toast(`Backup failed: ${err.message}`);
    }
  }

  function removeSamples() {
    const mockNotes = notes.filter((n) => n.mock);
    if (!confirm(`Remove the ${mockNotes.length} sample notes? Notes you wrote yourself stay.`)) return;
    const ops = mockNotes.map((n) => ({ kind: 'note', type: 'delete', id: n.id }));
    for (const hub of hubs.filter((x) => x.mock)) {
      const ownNotes = notes.some((n) => n.hubId === hub.id && !n.mock);
      ops.push(ownNotes ? { kind: 'hub', type: 'update', id: hub.id, data: { mock: false } } : { kind: 'hub', type: 'delete', id: hub.id });
    }
    store.batch(ops);
    go({ type: 'home' }, { replace: true });
    toast('Sample notes removed');
  }

  let toastTimer;
  function toast(text, { action, ms = 4500 } = {}) {
    clearTimeout(toastTimer);
    toastEl.replaceChildren(h('span', null, text), action ? h('button', {
      class: 'btn small ghost', onclick: () => {
        toastEl.hidden = true;
        action.fn();
      },
    }, action.label) : null);
    toastEl.hidden = false;
    if (ms) toastTimer = setTimeout(() => (toastEl.hidden = true), ms);
  }

  // ---------- global events ----------
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !menu.contains(e.target)) closeMenu();
  });
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
    const key = e.key.toLowerCase();
    if (e.key === 'Escape') {
      if (!menu.hidden) return closeMenu();
      if (document.activeElement === searchInput && searchInput.value) {
        clearSearch();
        return back();
      }
      if (typing) return document.activeElement.blur();
      if (layout === 'focus' ? view.type === 'note' || view.type === 'history' || view.type === 'new-hub' : view.type !== 'home') back();
    } else if (e.ctrlKey && e.shiftKey && key === 'f' && canSwitchLayout) {
      e.preventDefault();
      switchLayout(layout === 'focus' ? 'simple' : 'focus');
    } else if ((e.ctrlKey && !e.shiftKey && key === 'k') || (!typing && e.key === '/')) {
      e.preventDefault();
      const box = layout === 'focus' ? focusBody.querySelector('.f-search input') : searchInput;
      box?.focus();
      box?.select();
    } else if (!typing && !e.ctrlKey && !e.altKey && !e.metaKey && key === 'n') {
      e.preventDefault();
      newNote();
    } else if (!typing && e.key === 'Home' && layout === 'simple') {
      home();
    }
  });
  // Ctrl+Alt+N anywhere in Windows brings kang-notes forward, ready to type a quick note.
  host?.on('summon', () => {
    const box = (layout === 'focus' ? focusBody : panel).querySelector('.capture:not([hidden]) .cap-text');
    if (box) box.focus();
    else if (layout === 'simple') searchInput.focus();
  });
  addEventListener('online', renderStatus);
  addEventListener('offline', renderStatus);
  document.addEventListener('visibilitychange', () => {
    // Leaving the app mid-sentence: save the last words straight away.
    if (document.hidden) editor?.flush();
    else checkExpiry();
  });
  mobile.addEventListener('change', () => {
    current.key = '';
    render();
  });
  const hideHint = () => hint.classList.add('gone');
  graphEl.addEventListener('pointerdown', hideHint, { once: true });
  setTimeout(hideHint, 9000);

  function error(err) {
    console.error(err);
    if (err?.code === 'permission-denied' && !blocked) {
      blocked = true;
      root.append(h('div', { class: 'blocker' }, h('div', { class: 'card' },
        h('h2', null, 'This account can’t open these notes'),
        h('p', { class: 'muted' }, 'kang-notes only lets one account in. Sign out and sign in with the account set up for it.'),
        onSignOut ? h('button', { class: 'btn primary', onclick: () => onSignOut() }, 'Sign out') : null)));
      return;
    }
    toast(`Couldn’t save: ${err?.message || err}`);
  }

  store.subscribe(onData);

  const api = {
    error,
    isBusy: () => Boolean(editor?.busy()) || Boolean(document.activeElement?.classList.contains('cap-text') && document.activeElement.value),
    updateReady: (reload) => toast('A new version of kang-notes is ready', { action: { label: 'Reload', fn: reload }, ms: 0 }),
  };
  // Hooks for the automated tests in test/smoke.mjs.
  if (source === 'demo') {
    window.__kang = {
      graph, store, go, switchLayout,
      get view() { return view; }, get layout() { return layout; }, get notes() { return notes; }, get hubs() { return hubs; },
    };
  }
  return api;
}

function readPref(key, fallback) {
  const v = readText(key, null);
  return v == null ? fallback : v === 'true';
}

function readText(key, fallback) {
  try {
    const v = localStorage.getItem(`kang-notes:${key}`);
    return v == null ? fallback : v;
  } catch {
    return fallback;
  }
}

function writePref(key, value) {
  writeText(key, String(value));
}

function writeText(key, value) {
  try {
    localStorage.setItem(`kang-notes:${key}`, value);
  } catch {
    // Preferences are optional.
  }
}

export const LOGO = `<svg viewBox="0 0 32 32" aria-hidden="true">
  <path d="M16 16 7 9M16 16l10-5M16 16l-2 10" stroke="rgba(255,255,255,.45)" stroke-width="1.6" fill="none"/>
  <circle cx="7" cy="9" r="3.4" fill="#5ee6c9"/><circle cx="26" cy="11" r="3" fill="#ffb547"/>
  <circle cx="14" cy="26" r="3" fill="#a78bfa"/><circle cx="16" cy="16" r="2.6" fill="#fff"/></svg>`;
