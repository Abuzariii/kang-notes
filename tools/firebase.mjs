// Runs the Firebase command-line tool with its login kept in .firebase-cli\ in this folder.
// On the PC this was built on, its temp files and npm cache also go to D:\Work\Personal\tools;
// elsewhere they use the usual places.
// Usage: node tools/firebase.mjs <firebase arguments>, e.g. `login` or `deploy --only hosting`.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { localTools } from './local-tools.mjs';

const root = path.resolve(import.meta.dirname, '..');
const configDir = path.join(root, '.firebase-cli');
fs.mkdirSync(configDir, { recursive: true });

const cli = path.join(root, 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js');
const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    ...localTools.env,
    XDG_CONFIG_HOME: configDir,
    XDG_CACHE_HOME: path.join(configDir, 'cache'),
  },
});
child.on('exit', (code) => process.exit(code ?? 1));
