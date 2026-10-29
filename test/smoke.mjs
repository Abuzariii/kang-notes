// End-to-end check of the web app in demo mode, driven through headless Chrome (or Edge).
// Run after `npm run build`:  npm test
// Screenshots go to test/screens/. The test browser profile lives in .cache/ in this folder.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { localTools } from '../tools/local-tools.mjs';

const root = path.resolve(import.meta.dirname, '..');
const shots = path.join(root, 'test', 'screens');
const profile = path.join(root, '.cache', 'edge-test');
const port = 5174;
const base = `http://localhost:${port}/?demo`;
// Chrome if installed: from an admin terminal Edge restarts itself through Explorer and then
// ignores the temp folder it was given, while Chrome honours --do-not-de-elevate.
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const edge = fs.existsSync(chrome) ? chrome : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

fs.rmSync(profile, { recursive: true, force: true });
fs.mkdirSync(shots, { recursive: true });

const server = spawn(process.execPath, [path.join(root, 'tools', 'serve.mjs')], { env: { ...process.env, PORT: String(port) } });
await new Promise((resolve) => server.stdout.once('data', resolve));

// The browser is started on a debugging port and connected to, rather than launched by
// puppeteer: if it restarts itself unelevated, puppeteer's launch pipe would break.
const debugPort = 9461;
spawn(edge, [
  '--headless=new', `--user-data-dir=${profile}`, `--remote-debugging-port=${debugPort}`, '--do-not-de-elevate',
  '--no-first-run', '--no-default-browser-check', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', 'about:blank',
], { detached: true, stdio: 'ignore', env: { ...process.env, ...localTools.env } }).unref();
let browser;
for (let i = 0; i < 40 && !browser; i++) {
  await wait(250);
  browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${debugPort}`, defaultViewport: null, protocolTimeout: 30000 }).catch(() => null);
}
if (!browser) throw new Error('Could not start Edge for testing');

const problems = [];
const results = [];
const check = (name, ok, detail = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) problems.push(name);
};

async function open(viewport, query = '', settle = 5000) {
  const page = await browser.newPage();
  page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
  page.on('console', (msg) => msg.type() === 'error' && problems.push(`console: ${msg.text()}`));
  await page.setViewport(viewport);
  await page.goto(base + query, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__kang?.notes?.length > 0, { timeout: 15000 });
  await wait(settle); // let the layout settle and the camera fit
  return page;
}

// Types into a quick-note box: the first line, Shift+Enter, the rest, then Enter to add it.
async function quickNote(page, selector, first, rest) {
  await page.click(selector);
  await page.keyboard.type(first);
  if (rest) {
    await page.keyboard.down('Shift');
    await page.keyboard.press('Enter');
    await page.keyboard.up('Shift');
    await page.keyboard.type(rest);
  }
  await page.keyboard.press('Enter');
  await wait(700);
}

const state = (page) => page.evaluate(() => ({
  view: window.__kang.view,
  notes: window.__kang.notes.map((n) => ({ id: n.id, hubId: n.hubId, title: n.title, body: n.body, project: n.project, tags: n.tags, expiresAt: n.expiresAt, trashedAt: n.trashedAt, trashReason: n.trashReason, history: n.history.length })),
}));
const screenOf = (page, id) => page.evaluate((nodeId) => window.__kang.graph.screenOf(nodeId), id);
const shot = (page, name) => page.screenshot({ path: path.join(shots, `${name}.png`) });

try {
  // ---------- desktop ----------
  const page = await open({ width: 1366, height: 820, deviceScaleFactor: 1 });
  const webgl = await page.evaluate(() => Boolean(document.querySelector('.graph canvas')?.getContext('webgl2')));
  check('3D canvas renders with WebGL', webgl);
  let s = await state(page);
  check('sample notes loaded', s.notes.length === 15, `${s.notes.length} notes`);
  const overview = await page.evaluate(() => window.__kang.graph.stats());
  check('the 3D view starts with only the nodes', overview.hubs === 3 && overview.projects === 0 && overview.notes === 0, JSON.stringify(overview));
  await shot(page, '1-desktop-home');

  const hubAt = await screenOf(page, 'h:mock-trilops');
  check('Trilops node is on screen', Boolean(hubAt && hubAt.x > 0 && hubAt.x < 1366 - 400 && hubAt.y > 0 && hubAt.y < 820), JSON.stringify(hubAt));
  await page.mouse.click(hubAt.x, hubAt.y);
  await wait(2500);
  s = await state(page);
  check('clicking a node opens it', s.view.type === 'hub' && s.view.hubId === 'mock-trilops', JSON.stringify(s.view));
  const unfolded = await page.evaluate(() => window.__kang.graph.stats());
  check('the opened node unfolds its 2 projects and 6 notes', unfolded.projects === 2 && unfolded.notes === 6, JSON.stringify(unfolded));
  await shot(page, '2-desktop-node');

  await quickNote(page, '.panel .cap-text', 'Call Sara', 'about the Q4 numbers');
  s = await state(page);
  const quick = s.notes.find((n) => n.title === 'Call Sara');
  check('a quick note is added with Enter (first line = title)', Boolean(quick && quick.body === 'about the Q4 numbers'), JSON.stringify(quick));

  await page.evaluate(() => [...document.querySelectorAll('.group-head')].find((b) => b.textContent.startsWith('Website revamp')).click());
  await wait(1500);
  s = await state(page);
  const crumb = await page.$eval('.crumb-here', (el) => el.textContent).catch(() => '');
  const projectRows = await page.$$eval('.panel .note-row', (els) => els.length);
  check('opening a project shows just its notes', s.view.project === 'Website revamp' && crumb === 'Website revamp' && projectRows === 3, `${crumb}, ${projectRows} rows`);
  await shot(page, '2b-desktop-project');
  await page.evaluate(() => document.querySelector('.crumbs .crumb:nth-of-type(2)')?.click());
  await wait(800);

  await page.click('.panel-sub .btn.primary');
  await wait(400);
  await page.type('.ed-title', 'Test note');
  await page.type('.ed-body', 'Hello from the smoke test.\nSecond line.');
  const project = await page.$('.fields .field-input[list]');
  await project.click({ clickCount: 3 });
  await project.type('Website revamp');
  await page.keyboard.press('Enter');
  await page.type('.tag-input', 'urgent');
  await page.keyboard.press('Enter');
  await page.evaluate(() => [...document.querySelectorAll('.expiry-row .btn')].find((b) => b.textContent === '+1 h').click());
  await wait(1200);
  s = await state(page);
  const mine = s.notes.find((n) => n.title === 'Test note');
  check('new note saved with text, project, tag and expiry',
    Boolean(mine && mine.body.startsWith('Hello') && mine.project === 'Website revamp' && mine.tags.includes('urgent') && mine.expiresAt > Date.now()),
    JSON.stringify(mine));
  await shot(page, '3-desktop-editor');

  await page.click('.panel-head .btn.icon'); // back
  await wait(800);
  s = await state(page);
  check('leaving the editor keeps a version in history', s.notes.find((n) => n.id === mine.id)?.history === 1);
  check('back returns to the node', s.view.type === 'hub', JSON.stringify(s.view));

  // Expiry: make the note expire in 2.5 s and watch it burst into Trash.
  await page.evaluate((id) => window.__kang.store.updateNote(id, { expiresAt: Date.now() + 2500 }), mine.id);
  await wait(3600);
  await shot(page, '4-desktop-boom');
  await wait(3500);
  s = await state(page);
  const expired = s.notes.find((n) => n.id === mine.id);
  check('expired note moved to Trash', Boolean(expired?.trashedAt && expired.trashReason === 'expired'), JSON.stringify(expired));

  await page.click('.trash-btn');
  await wait(500);
  await shot(page, '5-desktop-trash');
  const restoreBtn = await page.evaluateHandle(() => [...document.querySelectorAll('.trash-row')]
    .find((r) => r.textContent.includes('Test note')).querySelector('.trash-actions .btn'));
  await restoreBtn.click();
  await wait(300);
  await page.evaluate(() => [...document.querySelectorAll('.restore-chooser .btn')].find((b) => b.textContent === 'Keep forever').click());
  await wait(800);
  s = await state(page);
  const restored = s.notes.find((n) => n.id === mine.id);
  check('restoring an expired note with "Keep forever" clears its expiry', Boolean(restored && !restored.trashedAt && restored.expiresAt == null), JSON.stringify(restored));

  await page.click('.search input');
  await page.type('.search input', '#hiring');
  await wait(800);
  s = await state(page);
  const rows = await page.$$eval('.panel .note-row', (els) => els.length);
  check('searching #hiring finds the 2 hiring notes', s.view.type === 'search' && rows === 2, `${rows} rows`);
  await shot(page, '6-desktop-search');
  await page.keyboard.press('Escape');
  await wait(500);

  // Zoom with the mouse wheel and make sure nothing breaks.
  await page.mouse.move(500, 400);
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel({ deltaY: -240 });
    await wait(80);
  }
  await wait(800);
  await shot(page, '7-desktop-zoomed');

  // New node.
  await page.evaluate(() => [...document.querySelectorAll('.topbar .btn')].find((b) => b.title === 'New node').click());
  await wait(400);
  await page.type('.form .field-input', 'Acme');
  await page.click('.form .btn.primary');
  await wait(1500);
  s = await state(page);
  check('creating a node opens it', s.view.type === 'hub', JSON.stringify(s.view));
  await page.close();

  // ---------- Focus layout (in the Windows app it's a small window that stays on top) ----------
  const focus = await open({ width: 420, height: 680, deviceScaleFactor: 1 }, '&layout=focus', 800);
  const shown = await focus.evaluate(() => ({
    layout: window.__kang.layout,
    graphHidden: getComputedStyle(document.querySelector('.stage')).display === 'none',
    focusShown: getComputedStyle(document.querySelector('.focus')).display !== 'none',
  }));
  check('Focus layout hides the graph', shown.layout === 'focus' && shown.graphHidden && shown.focusShown, JSON.stringify(shown));
  await focus.select('.f-hub', 'mock-periegesis');
  await wait(500);
  await quickNote(focus, '.focus .cap-text', 'Book the venue');
  s = await state(focus);
  const fnote = s.notes.find((n) => n.title === 'Book the venue');
  const fRows = await focus.$$eval('.f-list .note-row', (els) => els.map((e) => e.querySelector('.note-title').textContent));
  check('Focus: quick note goes into the chosen node and shows in the list', fnote?.hubId === 'mock-periegesis' && fRows[0] === 'Book the venue', JSON.stringify(fRows.slice(0, 3)));
  await shot(focus, '11-focus-list');
  await focus.click('.f-list .note-row');
  await wait(500);
  const fEditor = await focus.evaluate(() => ({ view: window.__kang.view.type, detailsOpen: document.querySelector('.focus .ed-details')?.open }));
  check('Focus: a note opens in a compact editor', fEditor.view === 'note' && fEditor.detailsOpen === false, JSON.stringify(fEditor));
  await shot(focus, '12-focus-editor');
  await focus.keyboard.press('Escape');
  await wait(400);
  await focus.click('.f-head .seg button[data-layout="simple"]');
  await wait(1500);
  const backToSimple = await focus.evaluate(() => ({ layout: window.__kang.layout, view: window.__kang.view }));
  check('Focus → Simple keeps you in the same node', backToSimple.layout === 'simple' && backToSimple.view.hubId === 'mock-periegesis', JSON.stringify(backToSimple));
  await focus.close();

  // ---------- phone ----------
  const phone = await open({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await shot(phone, '8-phone-home');
  const pHub = await screenOf(phone, 'h:mock-periegesis');
  check('Periegesis node is on the phone screen', Boolean(pHub && pHub.x > 0 && pHub.x < 390 && pHub.y > 60 && pHub.y < 844), JSON.stringify(pHub));
  if (pHub) await phone.touchscreen.tap(pHub.x, pHub.y);
  await wait(1800);
  s = await state(phone);
  check('tapping a node opens it on the phone', s.view.type === 'hub' && s.view.hubId === 'mock-periegesis', JSON.stringify(s.view));
  await shot(phone, '9-phone-node');
  const row = await phone.evaluate(() => {
    const r = document.querySelector('.panel .note-row').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await phone.touchscreen.tap(row.x, row.y);
  await wait(800);
  s = await state(phone);
  check('tapping a note opens the editor full screen', s.view.type === 'note');
  await shot(phone, '10-phone-editor');
  await phone.close();
} catch (err) {
  problems.push(`test crashed: ${err.stack || err}`);
} finally {
  await browser.close();
  server.kill();
}

console.log(results.join('\n'));
const extra = problems.filter((p) => !results.some((r) => r.includes(p)));
if (extra.length) console.log(`\nProblems:\n${extra.join('\n')}`);
console.log(`\nScreenshots: ${shots}`);
process.exit(problems.length ? 1 : 0);
