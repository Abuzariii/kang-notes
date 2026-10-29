// Builds web/ into dist/web: bundles the JavaScript, gives files content-hashed names,
// fills in index.html and the service worker's file list and version.
import * as esbuild from 'esbuild';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const web = path.join(root, 'web');
const out = path.join(root, 'dist', 'web');

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const version = `${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

// The graph library can optionally use three.js's WebGPU renderer, which we never turn on.
// Swapping it for a stub keeps about 500 KB out of the app.
const noWebGPU = {
  name: 'no-webgpu',
  setup(b) {
    b.onResolve({ filter: /^three\/webgpu$/ }, () => ({ path: 'three-webgpu-stub', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: 'export class WebGPURenderer { constructor() { throw new Error("WebGPU is not included"); } }',
      loader: 'js',
    }));
  },
};

const result = await esbuild.build({
  plugins: [noWebGPU],
  entryPoints: { app: path.join(web, 'src', 'main.js') },
  bundle: true,
  minify: true,
  format: 'esm',
  target: ['chrome110'],
  outdir: out,
  entryNames: '[name]-[hash]',
  legalComments: 'linked',
  define: { __APP_VERSION__: JSON.stringify(version) },
  metafile: true,
  logLevel: 'warning',
});

const css = fs.readFileSync(path.join(web, 'styles.css'));
const cssName = `app-${crypto.createHash('sha256').update(css).digest('hex').slice(0, 8)}.css`;
fs.writeFileSync(path.join(out, cssName), css);

const jsName = Object.keys(result.metafile.outputs).map((f) => path.basename(f)).find((f) => /^app-.*\.js$/.test(f));
fs.writeFileSync(path.join(out, 'index.html'),
  fs.readFileSync(path.join(web, 'index.html'), 'utf8').replace('%APP_JS%', jsName).replace('%APP_CSS%', cssName));

fs.cpSync(path.join(web, 'icons'), path.join(out, 'icons'), { recursive: true });
fs.copyFileSync(path.join(web, 'manifest.webmanifest'), path.join(out, 'manifest.webmanifest'));

const files = ['./', 'index.html', jsName, cssName, 'manifest.webmanifest', ...fs.readdirSync(path.join(out, 'icons')).map((f) => `icons/${f}`)];
fs.writeFileSync(path.join(out, 'sw.js'),
  fs.readFileSync(path.join(web, 'sw.js'), 'utf8').replace('%VERSION%', version).replace('%FILES%', JSON.stringify(files)));

const size = (f) => (fs.statSync(path.join(out, f)).size / 1024).toFixed(0);
console.log(`Built kang-notes ${version} into dist/web: ${jsName} (${size(jsName)} KB), ${cssName} (${size(cssName)} KB)`);
