// Checks the Windows app (app\KangNotes.exe) against the local demo build:
// the page loads inside it, backups land in backups\, "Start with Windows" switches on and off,
// a second launch doesn't open a second window, and Focus mode works, including real mouse and
// keyboard input (dragging, resizing, Ctrl+Alt+N). Run after `npm run build` and `npm run desktop`,
// with kang-notes closed. The test window and the mouse move on screen for a few seconds.
// Your saved window position and layout are put back afterwards.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const root = path.resolve(import.meta.dirname, '..');
const exe = path.join(root, 'app', 'KangNotes.exe');
const windowFile = path.join(root, 'data', 'window.txt');
const backupsDir = path.join(root, 'backups');
const port = 5176;
const debugPort = 9463;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
const runKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const runValue = () => {
  try {
    return execFileSync('reg', ['query', runKey, '/v', 'kang-notes'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
};

const savedWindow = fs.existsSync(windowFile) ? fs.readFileSync(windowFile) : null;
const hadBackups = fs.existsSync(backupsDir);
fs.rmSync(windowFile, { force: true }); // start from the defaults: Simple layout

const server = spawn(process.execPath, [path.join(root, 'tools', 'serve.mjs')], { env: { ...process.env, PORT: String(port) } });
await new Promise((r) => server.stdout.once('data', r));
const app = spawn(exe, ['--url', `http://localhost:${port}/?demo`, '--debug-port', String(debugPort)]);

let browser;
try {
  for (let i = 0; i < 60 && !browser; i++) {
    await wait(250);
    browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${debugPort}`, defaultViewport: null, protocolTimeout: 30000 }).catch(() => null);
  }
  check('KangNotes.exe starts WebView2', Boolean(browser));
  let page;
  for (let i = 0; i < 40 && !page; i++) {
    page = (await browser.pages()).find((p) => p.url().includes(`localhost:${port}`));
    if (!page) await wait(250);
  }
  await page.waitForFunction(() => window.__kang?.notes?.length > 0, { timeout: 20000 });
  check('kang-notes loads inside the window', true);
  await wait(4500);
  const gpu = await page.evaluate(() => {
    const gl = document.querySelector('.graph canvas').getContext('webgl2');
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });
  check('3D runs on the graphics card', !/swiftshader/i.test(gpu), gpu);
  await page.screenshot({ path: path.join(root, 'test', 'screens', '20-windows-simple.png') });

  const ask = (msg) => page.evaluate((m) => new Promise((resolve) => {
    const id = `t${Math.random()}`;
    const onMessage = (e) => {
      if (e.data?.reply !== id) return;
      window.chrome.webview.removeEventListener('message', onMessage);
      resolve(e.data);
    };
    window.chrome.webview.addEventListener('message', onMessage);
    window.chrome.webview.postMessage({ ...m, id });
  }), msg);

  const info = await ask({ type: 'info' });
  check('the app reports its folders on D:', info.backupDir?.startsWith('D:\\') && info.dataDir?.startsWith('D:\\'), `${info.backupDir} | ${info.dataDir}`);
  check('starts in the Simple layout with a normal window', info.mode === 'simple' && !info.topMost && !info.frameless);

  const saved = await ask({ type: 'backup', fileName: 'test-backup.json', content: '{"hello":"world"}' });
  const ok = saved.path && fs.existsSync(saved.path) && fs.readFileSync(saved.path, 'utf8') === '{"hello":"world"}';
  check('backup is written to the backups folder', Boolean(ok), saved.path || saved.error);
  if (saved.path) fs.rmSync(saved.path, { force: true });

  const wasOn = runValue().includes('kang-notes');
  const on = await ask({ type: 'autostart', on: true });
  check('"Start with Windows" can be turned on', on.autostart === true && runValue().includes('KangNotes.exe'));
  const off = await ask({ type: 'autostart', on: false });
  check('"Start with Windows" can be turned off again', off.autostart === false && !runValue().includes('kang-notes'));
  if (wasOn) await ask({ type: 'autostart', on: true });

  const second = spawn(exe, []);
  const code = await new Promise((r) => second.on('exit', r));
  check('a second launch reuses the open window', code === 0);

  // ---------- Focus ----------
  await page.evaluate(() => window.__kang.switchLayout('focus'));
  await wait(1500);
  const focus = await ask({ type: 'info' });
  check('Focus: small frameless window that stays on top', focus.mode === 'focus' && focus.topMost && focus.frameless && focus.bounds[2] < info.bounds[2],
    `${focus.bounds.join(',')}`);
  check('Focus: same window and page after switching', focus.window === info.window && (await page.evaluate(() => window.__kang.layout)) === 'focus');
  await page.screenshot({ path: path.join(root, 'test', 'screens', '21-windows-focus.png') });

  const input = JSON.parse(execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    path.join(root, 'test', 'desktop-input.ps1'), '-ProcessId', String(app.pid)], { encoding: 'utf8' }).trim().split('\n').pop());
  check('Focus: dragging the top bar moves the window', input.moved, `${input.start} → ${input.afterDrag}`);
  check('Focus: dragging a corner resizes it', input.resized, `${input.afterDrag} → ${input.afterResize}`);
  check('Ctrl+Alt+N brings a minimized kang-notes back', input.minimized && input.summoned);
  const typing = await page.evaluate(() => document.activeElement?.classList.contains('cap-text'));
  check('…ready to type a quick note', typing);

  await page.evaluate(() => window.__kang.switchLayout('simple'));
  await wait(1500);
  const simple = await ask({ type: 'info' });
  check('back to Simple: normal window, not on top, same size as before', simple.mode === 'simple' && !simple.topMost && !simple.frameless
    && simple.bounds[2] === info.bounds[2] && simple.bounds[3] === info.bounds[3], simple.bounds.join(','));
  await page.evaluate(() => window.__kang.switchLayout('focus'));
  await wait(1200);
  const again = await ask({ type: 'info' });
  check('Focus remembers where you left it', again.bounds[0] !== focus.bounds[0] && again.bounds[2] > focus.bounds[2], again.bounds.join(','));
  const saved2 = fs.existsSync(windowFile) ? fs.readFileSync(windowFile, 'utf8') : '';
  check('the layout is saved for next time', saved2.includes('mode=focus') && saved2.includes('focus='), saved2.replace(/\r?\n/g, ' | '));
} catch (err) {
  check(`test crashed: ${err.message}`, false);
} finally {
  browser?.disconnect();
  app.kill();
  server.kill();
  await wait(800);
  if (savedWindow) fs.writeFileSync(windowFile, savedWindow);
  else fs.rmSync(windowFile, { force: true });
  if (!hadBackups && fs.existsSync(backupsDir) && !fs.readdirSync(backupsDir).length) fs.rmdirSync(backupsDir);
}
console.log(results.join('\n'));
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
