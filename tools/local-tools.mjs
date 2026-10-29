// On the PC kang-notes was built on, everything is kept off C:: temp files and the npm cache
// live in D:\Work\Personal\tools. On any other PC that folder doesn't exist, and the usual
// Windows locations are used instead.
import fs from 'node:fs';
import path from 'node:path';

const dir = 'D:\\Work\\Personal\\tools';
const present = fs.existsSync(dir);
const tmp = path.join(dir, 'tmp');
if (present) fs.mkdirSync(tmp, { recursive: true });

export const localTools = {
  present,
  // Extra environment variables for programs started by the scripts.
  env: present ? { TEMP: tmp, TMP: tmp, npm_config_cache: path.join(dir, 'npm-cache') } : {},
};
