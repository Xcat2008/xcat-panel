import fs from 'fs/promises';
import path from 'path';

const ROOT = process.env.GAMEFORGE_ROOT || '/opt/xcat-panel';
const CATALOG_DIR = path.join(ROOT, 'catalog');

export async function getCatalog() {
  const files = await fs.readdir(CATALOG_DIR);
  const templates = [];

  for (const file of files) {
    if (!file.endsWith('.json')) continue;

    const raw = await fs.readFile(path.join(CATALOG_DIR, file), 'utf8');
    templates.push(JSON.parse(raw));
  }

  return templates.sort((a, b) => a.name.localeCompare(b.name));
}
