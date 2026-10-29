// The 3D graph. At first it shows only your nodes (one glowing sphere per hub, e.g. a
// company), sized by how many notes they hold. Opening a node unfolds its projects and
// notes around it and dims the other nodes. Built on 3d-force-graph (three.js / WebGL,
// which Windows runs through Direct3D on the graphics card).
import ForceGraph3D from '3d-force-graph';
import * as THREE from 'three';
import SpriteText from 'three-spritetext';
import { DAY } from './util.js';

const FADE_WINDOW = 3 * DAY; // notes start fading this long before they expire
const FADE_MIN = 0.4; // how faint a note gets just before it expires
const NOTE_LABEL_DISTANCE = 150; // note titles appear when the camera is this close
const LINK_DISTANCE = { project: 34, note: 12, 'hub-note': 24 };
const LINK_STRENGTH = { anchor: 0.12, project: 0.7, note: 0.9, 'hub-note': 0.6 };
const CHARGE = { anchor: 0, hub: -320, project: -70, note: -16 };
const DIMMED = 0.3; // other nodes while one is open

const GEO = {
  hub: new THREE.SphereGeometry(6, 32, 32),
  project: new THREE.IcosahedronGeometry(2.8, 1),
  note: new THREE.SphereGeometry(1.7, 16, 16),
};

let glowTexture;
function glowMap() {
  if (glowTexture) return glowTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.22, 'rgba(255,255,255,0.5)');
  grd.addColorStop(0.55, 'rgba(255,255,255,0.1)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  glowTexture = new THREE.CanvasTexture(c);
  glowTexture.colorSpace = THREE.SRGBColorSpace;
  return glowTexture;
}

function glow(color, size, opacity) {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowMap(), color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  sprite.scale.set(size, size, 1);
  sprite.userData.baseOpacity = opacity;
  sprite.userData.baseSize = size;
  return sprite;
}

function label(text, height, color, y) {
  const s = new SpriteText(text, height, color);
  s.fontFace = '"Segoe UI Variable", "Segoe UI", Roboto, system-ui, sans-serif';
  s.fontWeight = '600';
  s.strokeWidth = 0.5;
  s.strokeColor = 'rgba(4, 6, 12, 0.85)';
  // Always drawn on top, so names stay readable over glows and other nodes.
  s.material.depthWrite = false;
  s.material.depthTest = false;
  s.renderOrder = 10;
  s.position.y = y;
  s.userData.baseY = y;
  return s;
}

const short = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const noteTitle = (note) => short((note.title || note.body || 'Untitled').split('\n')[0].trim() || 'Untitled', 34);
const fadeOf = (expiresAt, now) => (expiresAt ? Math.min(1, Math.max(FADE_MIN, (expiresAt - now) / FADE_WINDOW)) : 1);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function rgba(hex, alpha) {
  const c = new THREE.Color(hex);
  return `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${alpha})`;
}

function buildObject(node) {
  const group = new THREE.Group();
  if (node.kind === 'anchor') return group; // invisible centre that keeps nodes together
  const parts = {};
  if (node.kind === 'hub') {
    parts.core = new THREE.Mesh(GEO.hub, new THREE.MeshBasicMaterial({ color: node.color, transparent: true }));
    parts.halo = glow(node.color, 44, 0.6);
    parts.label = label(node.name, 8, '#ffffff', 15);
  } else if (node.kind === 'project') {
    parts.core = new THREE.Mesh(GEO.project, new THREE.MeshBasicMaterial({ color: node.color, transparent: true }));
    parts.halo = glow(node.color, 16, 0.45);
    parts.label = label(node.name, 3.6, node.color, 6.8);
  } else {
    parts.core = new THREE.Mesh(GEO.note, new THREE.MeshBasicMaterial({ color: node.color, transparent: true }));
    parts.halo = glow(node.color, 9, 0.5);
    parts.label = label(node.title, 2.3, '#dfe6f3', 4);
    parts.label.visible = false;
  }
  Object.values(parts).forEach((p) => group.add(p));
  node.parts = parts;
  return group;
}

export function createGraph(container, handlers) {
  const nodes = new Map(); // id -> node object, reused across updates so positions stick
  const noteHub = new Map(); // note id -> hub id, for search highlighting of closed nodes
  let signature = '';
  let expanded = null; // hub id whose projects and notes are shown
  let selectedId = null;
  let highlightNotes = null; // Set of note ids, or null
  let highlightHubs = null;
  let effects = true;
  let fitted = false;
  let paused = false;
  let userMoved = false; // once you move the camera yourself, it is never re-fitted automatically
  let follow = null; // keeps a selected node centred while the layout is still settling
  let aimTimer = null;
  let clusterTimer = null; // re-frames an opened node once its projects and notes have spread out

  const graph = new ForceGraph3D(container, { controlType: 'orbit' })
    .backgroundColor('#05070d')
    .showNavInfo(false)
    .enableNodeDrag(false)
    .nodeThreeObject(buildObject)
    .nodeLabel(tooltip)
    .linkVisibility((l) => l.kind !== 'anchor')
    .linkColor((l) => l.color)
    .linkOpacity(1)
    .linkWidth((l) => (l.kind === 'project' ? 0.35 : 0))
    .linkDirectionalParticles((l) => (effects && l.kind === 'project' ? 2 : 0))
    .linkDirectionalParticleWidth(0.9)
    .linkDirectionalParticleSpeed(0.006)
    .linkDirectionalParticleColor((l) => l.particleColor)
    .cooldownTime(4500)
    .onNodeClick(clickNode)
    .onNodeHover((n) => {
      container.style.cursor = n && n.kind !== 'anchor' ? 'pointer' : '';
    })
    // The library only knows what is under the pointer after its next frame, so a quick
    // click or tap can arrive as a background click. Check directly before giving up.
    .onBackgroundClick((ev) => {
      const n = pickAt(ev);
      if (n) clickNode(n);
    })
    .onEngineTick(() => {
      followTick();
      updateLabels();
    })
    .onEngineStop(() => {
      if (!fitted && !userMoved) fit(900);
      fitted = true;
    });

  graph.d3Force('charge').strength((n) => CHARGE[n.kind]);
  graph.d3Force('link')
    .distance((l) => l.distance ?? LINK_DISTANCE[l.kind])
    .strength((l) => LINK_STRENGTH[l.kind]);

  const controls = graph.controls();
  controls.zoomToCursor = true;
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.minDistance = 8;
  controls.maxDistance = 2600;
  controls.addEventListener('change', updateLabels);
  controls.addEventListener('start', () => {
    userMoved = true;
    follow = null;
    clearTimeout(aimTimer);
    clearTimeout(clusterTimer);
  });
  graph.camera().position.set(0, 120, 700);

  graph.scene().add(starfield());

  new ResizeObserver(() => {
    const { clientWidth: w, clientHeight: h } = container;
    if (w && h) graph.width(w).height(h);
  }).observe(container);

  function tooltip(n) {
    let text = '';
    if (n.kind === 'hub') text = `${n.name} · ${plural(n.count, 'note')}`;
    else if (n.kind === 'project') text = `${n.name} · ${plural(n.count, 'note')}`;
    else if (n.kind === 'note') text = n.title;
    return text ? `<div class="graph-tip">${escapeHtml(text)}</div>` : '';
  }

  function clickNode(n) {
    if (n.kind === 'hub') handlers.onHub?.(n.hubId);
    else if (n.kind === 'project') handlers.onProject?.(n.hubId, n.name);
    else if (n.kind === 'note') handlers.onNote?.(n.noteId);
  }

  function pickAt(ev) {
    const rect = container.getBoundingClientRect();
    const pointer = new THREE.Vector2(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, graph.camera());
    const owner = new Map();
    for (const n of nodes.values()) if (n.parts && n.__threeObj?.visible) owner.set(n.__threeObj, n);
    for (const hit of raycaster.intersectObjects([...owner.keys()], true)) {
      if (!hit.object.visible) continue;
      for (let o = hit.object; o; o = o.parent) if (owner.has(o)) return owner.get(o);
    }
    return null;
  }

  function node(id, props) {
    let n = nodes.get(id);
    if (!n) {
      n = { id, ...props };
      nodes.set(id, n);
      return n;
    }
    // Keep the object (and its position); refresh what may have changed.
    if (n.parts?.label && n.label !== props.label) n.parts.label.text = props.label;
    if (n.color !== props.color && n.parts) {
      n.parts.core.material.color.set(props.color);
      n.parts.halo.material.color.set(props.color);
      if (n.kind === 'project') n.parts.label.color = props.color;
    }
    Object.assign(n, props);
    return n;
  }

  function placeNear(n, parent) {
    if (n.x != null || !parent || parent.x == null) return;
    const r = 6 + Math.random() * 6;
    n.x = parent.x + (Math.random() - 0.5) * r;
    n.y = parent.y + (Math.random() - 0.5) * r;
    n.z = parent.z + (Math.random() - 0.5) * r;
  }

  // hubs: all nodes; notes: active notes; open: the hub to unfold (or null for the overview).
  function update(hubs, notes, open = expanded) {
    expanded = open && hubs.some((x) => x.id === open) ? open : null;
    const list = [];
    const links = [];
    const now = Date.now();
    const anchor = node('anchor', { kind: 'anchor', fx: 0, fy: 0, fz: 0 });
    list.push(anchor);

    const counts = new Map();
    noteHub.clear();
    for (const note of notes) {
      noteHub.set(note.id, note.hubId);
      counts.set(note.hubId, (counts.get(note.hubId) || 0) + 1);
    }
    const ring = Math.max(90, 40 + 22 * hubs.length);
    for (const hub of hubs) {
      const count = counts.get(hub.id) || 0;
      const hn = node(`h:${hub.id}`, {
        kind: 'hub', hubId: hub.id, name: hub.name, label: hub.name, color: hub.color, count,
        size: 0.85 + Math.min(1.1, Math.sqrt(count) * 0.22),
      });
      list.push(hn);
      links.push({ source: 'anchor', target: hn.id, kind: 'anchor', distance: ring });
    }

    if (expanded) {
      const hubNode = nodes.get(`h:${expanded}`);
      const projectNodes = new Map();
      for (const note of notes) {
        if (note.hubId !== expanded) continue;
        let parent = hubNode;
        let kind = 'hub-note';
        const project = (note.project || '').trim();
        if (project) {
          const pid = `p:${note.hubId}:${project.toLowerCase()}`;
          let pn = projectNodes.get(pid);
          if (!pn) {
            pn = node(pid, { kind: 'project', hubId: note.hubId, name: project, label: project, color: hubNode.color, count: 0 });
            pn.count = 0;
            placeNear(pn, hubNode);
            projectNodes.set(pid, pn);
            list.push(pn);
            links.push({ source: hubNode.id, target: pid, kind: 'project', color: rgba(hubNode.color, 0.4), particleColor: hubNode.color });
          }
          pn.count++;
          parent = pn;
          kind = 'note';
        }
        const title = noteTitle(note);
        const nn = node(`n:${note.id}`, {
          kind: 'note', noteId: note.id, hubId: note.hubId, title, label: title, color: hubNode.color, fade: fadeOf(note.expiresAt, now),
        });
        placeNear(nn, parent);
        list.push(nn);
        links.push({ source: parent.id, target: nn.id, kind, color: rgba(hubNode.color, kind === 'note' ? 0.3 : 0.22) });
      }
    }

    // Folded-away projects and notes are forgotten, so next time they unfold from their node.
    const keep = new Set(list.map((n) => n.id));
    for (const id of nodes.keys()) if (!keep.has(id)) nodes.delete(id);

    const sig = list.map((n) => n.id).join('|') + '#' + links.map((l) => `${l.source}>${l.target}:${l.distance || ''}`).join('|');
    if (sig !== signature) {
      const first = !signature;
      signature = sig;
      graph.graphData({ nodes: list, links });
      if (first) setTimeout(() => !userMoved && fit(800), 1600);
    }
    refreshVisuals();
  }

  function refreshVisuals() {
    const glowBoost = effects ? 1 : 0.55;
    for (const n of nodes.values()) {
      if (!n.parts) continue;
      const selected = n.id === selectedId;
      let dim = 1;
      if (n.kind === 'hub') {
        if (expanded && n.hubId !== expanded) dim = DIMMED;
        if (highlightHubs && !highlightHubs.has(n.hubId)) dim = Math.min(dim, 0.2);
      } else if (highlightNotes) {
        dim = n.kind === 'note' ? (highlightNotes.has(n.noteId) ? 1 : 0.12) : 0.5;
      }
      const fade = n.kind === 'note' ? n.fade : 1;
      const scale = n.kind === 'hub' ? n.size * (selected ? 1.15 : 1) : selected ? 1.6 : 1;
      n.parts.core.scale.setScalar(scale);
      n.parts.core.material.opacity = fade * dim;
      n.parts.halo.scale.setScalar(n.parts.halo.userData.baseSize * scale * (selected ? 1.1 : 1) * (effects ? 1 : 0.8));
      n.parts.halo.material.opacity = n.parts.halo.userData.baseOpacity * fade * dim * glowBoost;
      n.parts.label.position.y = n.parts.label.userData.baseY * scale;
      n.parts.label.material.opacity = Math.max(0.35, fade) * (dim < 1 ? Math.max(0.3, dim) : 1);
    }
    updateLabels();
  }

  // After a camera flight, nudge the camera by however far the node drifted meanwhile,
  // then keep following it until the layout stops moving or you take over.
  function followTick() {
    if (!follow) return;
    const n = nodes.get(follow.id);
    if (!n || n.x == null) {
      follow = null;
      return;
    }
    const d = new THREE.Vector3(n.x - follow.x, n.y - follow.y, n.z - follow.z);
    if (d.lengthSq() > 1e-6) {
      graph.camera().position.add(d);
      controls.target.add(d);
      follow.x = n.x;
      follow.y = n.y;
      follow.z = n.z;
    }
  }

  const camPos = new THREE.Vector3();
  const nodePos = new THREE.Vector3();
  function updateLabels() {
    camPos.copy(graph.camera().position);
    for (const n of nodes.values()) {
      if (n.kind !== 'note' || !n.parts || n.x == null) continue;
      const near = camPos.distanceTo(nodePos.set(n.x, n.y, n.z)) < NOTE_LABEL_DISTANCE;
      n.parts.label.visible = near || n.id === selectedId || Boolean(highlightNotes?.has(n.noteId));
    }
  }

  // Moves the camera to look at a node from roughly the current angle.
  function flyTo(id, distance, ms = 1100) {
    const n = nodes.get(id);
    if (!n || n.x == null) return false;
    const cam = graph.camera().position;
    const dir = new THREE.Vector3(cam.x - n.x, cam.y - n.y, cam.z - n.z);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    dir.normalize().multiplyScalar(distance);
    const aim = { x: n.x, y: n.y, z: n.z };
    graph.cameraPosition({ x: n.x + dir.x, y: n.y + dir.y, z: n.z + dir.z }, aim, ms);
    userMoved = true;
    follow = null;
    clearTimeout(aimTimer);
    clearTimeout(clusterTimer);
    aimTimer = setTimeout(() => {
      follow = { id, ...aim };
      followTick();
    }, ms + 30);
    return true;
  }

  // Frames every node from the current viewing angle: for each node, works out how far back
  // the camera must be to keep it on screen. Tighter than the library's zoomToFit, which
  // sizes for the worst-case 3D box and leaves the graph small.
  function fit(ms, only) {
    const placed = [...nodes.values()].filter((n) => n.parts && n.x != null && (!only || only(n)));
    if (!placed.length) return;
    const min = new THREE.Vector3(Infinity, Infinity, Infinity);
    const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    placed.forEach((n) => {
      min.min(nodePos.set(n.x, n.y, n.z));
      max.max(nodePos);
    });
    const center = min.clone().add(max).multiplyScalar(0.5);
    const camera = graph.camera();
    const back = camera.position.clone().sub(controls.target);
    if (back.lengthSq() < 1e-6) back.set(0, 0.2, 1);
    const zAxis = back.normalize();
    const xAxis = new THREE.Vector3().crossVectors(camera.up, zAxis).normalize();
    const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis);
    const h = container.clientHeight || 1;
    const w = container.clientWidth || 1;
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * Math.max(0.4, 1 - 260 / h); // room for the top bar and labels
    const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * camera.aspect * Math.max(0.4, 1 - 220 / w);
    let distance = 140;
    const q = new THREE.Vector3();
    for (const n of placed) {
      q.set(n.x, n.y, n.z).sub(center);
      const z = q.dot(zAxis);
      distance = Math.max(distance, z + Math.abs(q.dot(xAxis)) / tanH, z + Math.abs(q.dot(yAxis)) / tanV);
    }
    const pos = center.clone().addScaledVector(zAxis, distance);
    follow = null;
    clearTimeout(aimTimer);
    clearTimeout(clusterTimer);
    graph.cameraPosition({ x: pos.x, y: pos.y, z: pos.z }, { x: center.x, y: center.y, z: center.z }, ms);
  }

  function clusterRadius(hubId) {
    const hub = nodes.get(`h:${hubId}`);
    let max = 0;
    for (const n of nodes.values()) {
      if (n.hubId !== hubId || n.kind === 'hub' || n.x == null) continue;
      max = Math.max(max, Math.hypot(n.x - hub.x, n.y - hub.y, n.z - hub.z));
    }
    return max;
  }

  function starfield() {
    const count = 1600;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(1800 + Math.random() * 2600);
      pos.set([v.x, v.y, v.z], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return new THREE.Points(geo, new THREE.PointsMaterial({
      color: '#9fb3d9', size: 1.4, sizeAttenuation: false, transparent: true, opacity: 0.65, depthWrite: false,
    }));
  }

  return {
    update,
    select(id) {
      selectedId = id;
      refreshVisuals();
    },
    setHighlight(noteIds) {
      highlightNotes = noteIds ? new Set(noteIds) : null;
      highlightHubs = noteIds ? new Set([...noteIds].map((id) => noteHub.get(id))) : null;
      refreshVisuals();
    },
    refreshFades(notes) {
      const now = Date.now();
      for (const note of notes) {
        const n = nodes.get(`n:${note.id}`);
        if (n) n.fade = fadeOf(note.expiresAt, now);
      }
      refreshVisuals();
    },
    focusHub(hubId) {
      // Fly over straight away, then frame the whole cluster once it has spread out.
      const ok = flyTo(`h:${hubId}`, Math.max(170, clusterRadius(hubId) * 3));
      if (ok) {
        clusterTimer = setTimeout(() => {
          if (expanded === hubId) fit(900, (n) => n.hubId === hubId);
        }, 1500);
      }
      return ok;
    },
    focusProject(hubId, project) {
      return flyTo(`p:${hubId}:${project.trim().toLowerCase()}`, 70);
    },
    focusNote(noteId) {
      return flyTo(`n:${noteId}`, 38);
    },
    reset() {
      fit(900);
    },
    setEffects(on) {
      effects = on;
      graph.linkDirectionalParticles((l) => (on && l.kind === 'project' ? 2 : 0));
      refreshVisuals();
    },
    get effects() {
      return effects;
    },
    pause() {
      if (paused) return;
      paused = true;
      graph.pauseAnimation();
    },
    resume() {
      if (!paused) return;
      paused = false;
      graph.resumeAnimation();
    },
    // For the automated tests: where a node is on screen, and what is shown.
    screenOf(id) {
      const n = nodes.get(id);
      if (!n || n.x == null) return null;
      const p = graph.graph2ScreenCoords(n.x, n.y, n.z);
      const rect = container.getBoundingClientRect();
      return { x: rect.left + p.x, y: rect.top + p.y };
    },
    stats() {
      const s = { hubs: 0, projects: 0, notes: 0 };
      for (const n of nodes.values()) {
        if (n.kind === 'hub') s.hubs++;
        else if (n.kind === 'project') s.projects++;
        else if (n.kind === 'note') s.notes++;
      }
      return s;
    },
    // Burst for an expiring note: on the note itself if its node is open, otherwise a
    // smaller one on its node.
    boom(noteId) {
      if (document.hidden) return Promise.resolve(false);
      const n = nodes.get(`n:${noteId}`);
      if (n?.x != null && n.__threeObj) return explode(graph.scene(), n, { hide: true, count: 260, scale: 1 });
      const hub = nodes.get(`h:${noteHub.get(noteId)}`);
      if (hub?.x != null) return explode(graph.scene(), hub, { hide: false, count: 110, scale: 0.6 });
      return Promise.resolve(false);
    },
  };
}

// Particle burst used when a note expires.
function explode(scene, n, { hide, count, scale }) {
  const origin = new THREE.Vector3(n.x, n.y, n.z);
  if (hide) n.__threeObj.visible = false;
  const pos = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const vel = [];
  const tint = new THREE.Color(n.color);
  const hot = new THREE.Color('#fff4d6');
  for (let i = 0; i < count; i++) {
    pos.set([origin.x, origin.y, origin.z], i * 3);
    const c = Math.random() < 0.35 ? hot : tint;
    colors.set([c.r, c.g, c.b], i * 3);
    vel.push(new THREE.Vector3().randomDirection().multiplyScalar((22 + Math.random() * 75) * scale));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size: 3.6 * scale, vertexColors: true, map: glowMap(), transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const sparks = new THREE.Points(geo, mat);
  const flash = glow('#ffffff', 6, 1);
  const ring = glow(n.color, 6, 1);
  flash.position.copy(origin);
  ring.position.copy(origin);
  scene.add(sparks, flash, ring);

  return new Promise((resolve) => {
    const start = performance.now();
    let last = start;
    const step = (t) => {
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      const k = (t - start) / 1400;
      for (let i = 0; i < count; i++) {
        pos[i * 3] += vel[i].x * dt;
        pos[i * 3 + 1] += vel[i].y * dt;
        pos[i * 3 + 2] += vel[i].z * dt;
        vel[i].multiplyScalar(0.965);
      }
      geo.attributes.position.needsUpdate = true;
      mat.opacity = Math.max(0, 1 - k * k);
      flash.scale.setScalar((6 + 44 * Math.min(1, k * 4)) * scale);
      flash.material.opacity = Math.max(0, 1 - k * 3.5);
      ring.scale.setScalar((6 + 95 * Math.min(1, k * 1.5)) * scale);
      ring.material.opacity = Math.max(0, 1 - k * 1.5);
      if (k < 1) {
        requestAnimationFrame(step);
        return;
      }
      scene.remove(sparks, flash, ring);
      geo.dispose();
      mat.dispose();
      flash.material.dispose();
      ring.material.dispose();
      resolve(true);
    };
    requestAnimationFrame(step);
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
