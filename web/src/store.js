// Where notes are kept. Both stores have the same methods, so the rest of the app
// doesn't care which one it has:
//   - the Firebase store syncs through Firestore and keeps an offline copy on the device;
//   - the local store keeps everything in this browser only (used for ?demo and tests).
// Writes are fire-and-forget: Firestore applies them to the local copy at once and
// uploads them when it can, so the UI never waits on the network.
import {
  collection, doc, onSnapshot, setDoc, updateDoc, deleteDoc, getDoc, writeBatch, arrayUnion,
} from 'firebase/firestore';

function rafBatched(fn) {
  let queued = false;
  return () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      fn();
    });
  };
}

export function createFirebaseStore(db, uid, onError) {
  const hubsCol = collection(db, 'users', uid, 'hubs');
  const notesCol = collection(db, 'users', uid, 'notes');
  const metaDoc = doc(db, 'users', uid, 'meta', 'app');
  const subs = new Set();
  const state = { hubs: [], notes: [], hubsPending: false, notesPending: false, fromCache: true, hubsLoaded: false, notesLoaded: false };
  const fail = (err) => onError?.(err);

  const snapshot = () => ({
    hubs: state.hubs,
    notes: state.notes,
    status: { pending: state.hubsPending || state.notesPending, fromCache: state.fromCache },
  });
  const emit = rafBatched(() => {
    if (!state.hubsLoaded || !state.notesLoaded) return;
    const snap = snapshot();
    subs.forEach((fn) => fn(snap));
  });

  const listen = (col, key) => onSnapshot(col, { includeMetadataChanges: true }, (snap) => {
    state[key] = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
    state[`${key}Pending`] = snap.metadata.hasPendingWrites;
    state.fromCache = snap.metadata.fromCache;
    state[`${key}Loaded`] = true;
    emit();
  }, fail);
  const unsubs = [listen(hubsCol, 'hubs'), listen(notesCol, 'notes')];

  const apply = (batch, op) => {
    const col = op.kind === 'hub' ? hubsCol : notesCol;
    if (op.type === 'set') batch.set(doc(col, op.id), op.data);
    else if (op.type === 'update') batch.update(doc(col, op.id), op.data);
    else if (op.type === 'delete') batch.delete(doc(col, op.id));
  };

  return {
    kind: 'firebase',
    subscribe(fn) {
      subs.add(fn);
      if (state.hubsLoaded && state.notesLoaded) fn(snapshot());
      return () => subs.delete(fn);
    },
    // Adds the sample notes once per account. Skipped when offline on a new device,
    // so it can never seed over notes that exist on the server but not here yet.
    async seedOnce(data) {
      try {
        const meta = await getDoc(metaDoc);
        if (meta.exists() || state.hubs.length || state.notes.length) return false;
        const batch = writeBatch(db);
        data.hubs.forEach((hub) => batch.set(doc(hubsCol, hub.id), hub));
        data.notes.forEach((note) => batch.set(doc(notesCol, note.id), note));
        batch.set(metaDoc, { seededAt: Date.now() });
        await batch.commit();
        return true;
      } catch (err) {
        if (err?.code !== 'unavailable') fail(err);
        return false;
      }
    },
    addHub: (hub) => void setDoc(doc(hubsCol, hub.id), hub).catch(fail),
    updateHub: (id, patch) => void updateDoc(doc(hubsCol, id), patch).catch(fail),
    deleteHub: (id) => void deleteDoc(doc(hubsCol, id)).catch(fail),
    addNote: (note) => void setDoc(doc(notesCol, note.id), note).catch(fail),
    updateNote: (id, patch) => void updateDoc(doc(notesCol, id), patch).catch(fail),
    deleteNote: (id) => void deleteDoc(doc(notesCol, id)).catch(fail),
    // arrayUnion merges on the server, so versions saved on two offline devices both survive.
    appendHistory: (id, entry) => void updateDoc(doc(notesCol, id), { history: arrayUnion(entry) }).catch(fail),
    // ops: [{ kind: 'hub' | 'note', type: 'set' | 'update' | 'delete', id, data }]
    batch(ops) {
      for (let i = 0; i < ops.length; i += 450) {
        const batch = writeBatch(db);
        ops.slice(i, i + 450).forEach((op) => apply(batch, op));
        batch.commit().catch(fail);
      }
    },
    close: () => unsubs.forEach((u) => u()),
  };
}

export function createLocalStore(key) {
  const subs = new Set();
  let data;
  try {
    data = JSON.parse(localStorage.getItem(key)) || null;
  } catch {
    data = null;
  }
  data ||= { hubs: {}, notes: {}, seeded: false };

  const snapshot = () => ({
    hubs: Object.values(data.hubs).map((x) => ({ ...x })),
    notes: Object.values(data.notes).map((x) => ({ ...x, tags: [...(x.tags || [])], history: [...(x.history || [])] })),
    status: { local: true },
  });
  const emit = rafBatched(() => {
    const snap = snapshot();
    subs.forEach((fn) => fn(snap));
  });
  const commit = () => {
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch {
      // Storage full or blocked: keep working in memory.
    }
    emit();
  };
  const table = (kind) => (kind === 'hub' ? data.hubs : data.notes);
  const apply = (op) => {
    const t = table(op.kind);
    if (op.type === 'set') t[op.id] = structuredClone(op.data);
    else if (op.type === 'update' && t[op.id]) Object.assign(t[op.id], structuredClone(op.data));
    else if (op.type === 'delete') delete t[op.id];
  };

  return {
    kind: 'local',
    subscribe(fn) {
      subs.add(fn);
      queueMicrotask(() => fn(snapshot())); // async, like Firestore
      return () => subs.delete(fn);
    },
    async seedOnce(seed) {
      if (data.seeded) return false;
      seed.hubs.forEach((hub) => (data.hubs[hub.id] = structuredClone(hub)));
      seed.notes.forEach((note) => (data.notes[note.id] = structuredClone(note)));
      data.seeded = true;
      commit();
      return true;
    },
    addHub: (hub) => (apply({ kind: 'hub', type: 'set', id: hub.id, data: hub }), commit()),
    updateHub: (id, patch) => (apply({ kind: 'hub', type: 'update', id, data: patch }), commit()),
    deleteHub: (id) => (apply({ kind: 'hub', type: 'delete', id }), commit()),
    addNote: (note) => (apply({ kind: 'note', type: 'set', id: note.id, data: note }), commit()),
    updateNote: (id, patch) => (apply({ kind: 'note', type: 'update', id, data: patch }), commit()),
    deleteNote: (id) => (apply({ kind: 'note', type: 'delete', id }), commit()),
    appendHistory(id, entry) {
      const note = data.notes[id];
      if (note) note.history = [...(note.history || []), structuredClone(entry)];
      commit();
    },
    batch(ops) {
      ops.forEach(apply);
      commit();
    },
    close() {},
  };
}
