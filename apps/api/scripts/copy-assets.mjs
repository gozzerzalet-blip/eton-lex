import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(scriptDir, '..');

const assets = [
  [path.join(apiRoot, 'src', 'db', 'schema.sql'), path.join(apiRoot, 'dist', 'db', 'schema.sql')],
  [
    path.join(apiRoot, 'src', 'data', 'academic-catalog.json'),
    path.join(apiRoot, 'dist', 'data', 'academic-catalog.json'),
  ],
];

for (const [from, to] of assets) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  console.log(`· asset copiado: ${path.relative(apiRoot, to)}`);
}
