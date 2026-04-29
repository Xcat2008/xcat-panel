import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const ROOT = process.env.GAMEFORGE_ROOT || '/opt/xcat-panel';
const DATA_DIR = path.join(ROOT, 'data');
const STORAGE_FILE = path.join(DATA_DIR, 'storage-roots.json');
const DEFAULT_STORAGE = {
  id: 'default',
  label: 'Disco principal',
  path: path.join(ROOT, 'servers'),
  default: true
};

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

function normalizeRoot(root) {
  const rawPath = String(root.path || DEFAULT_STORAGE.path);
  const migratedPath = rawPath.startsWith('/opt/gameforge')
    ? rawPath.replace('/opt/gameforge', ROOT)
    : rawPath;

  return {
    id: String(root.id || '').trim(),
    label: String(root.label || root.id || 'Storage').trim(),
    path: path.resolve(migratedPath),
    default: Boolean(root.default)
  };
}

function slugify(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

export async function listStorageRoots({ includeStats = false } = {}) {
  await fs.mkdir(DATA_DIR, { recursive: true });

  let roots = await readJson(STORAGE_FILE, null);
  if (!Array.isArray(roots) || roots.length === 0) {
    roots = [DEFAULT_STORAGE];
    await writeJson(STORAGE_FILE, roots);
  }

  const normalized = roots
    .map(normalizeRoot)
    .filter((root) => root.id && root.path);

  if (!normalized.some((root) => root.default)) {
    normalized[0].default = true;
  }

  if (JSON.stringify(roots) !== JSON.stringify(normalized)) {
    await writeJson(STORAGE_FILE, normalized);
  }

  for (const root of normalized) {
    await fs.mkdir(root.path, { recursive: true });
  }

  if (!includeStats) return normalized;

  return Promise.all(normalized.map(async (root) => ({
    ...root,
    ...(await getStorageStats(root.path))
  })));
}

export async function getStorageRoot(id = '') {
  const roots = await listStorageRoots();
  return roots.find((root) => root.id === id) || roots.find((root) => root.default) || roots[0];
}

export async function addStorageRoot(input = {}) {
  const current = await listStorageRoots();
  const nextRoot = normalizeRoot({
    id: input.id || slugify(input.label || ''),
    label: input.label,
    path: input.path,
    default: input.default
  });

  if (!nextRoot.id) throw new Error('ID do destino em falta');
  if (!nextRoot.path.startsWith('/')) throw new Error('O caminho tem de ser absoluto');
  if (current.some((root) => root.id === nextRoot.id)) throw new Error('Ja existe um destino com esse ID');

  await fs.mkdir(nextRoot.path, { recursive: true });

  const roots = nextRoot.default
    ? current.map((root) => ({ ...root, default: false }))
    : current;

  roots.push(nextRoot);
  await writeJson(STORAGE_FILE, roots);

  return nextRoot;
}

export async function listStorageDisks() {
  const { stdout } = await execFileAsync('lsblk', ['-J', '-b', '-o', 'NAME,PATH,SIZE,TYPE,FSTYPE,MOUNTPOINT,LABEL,MODEL,SERIAL,UUID'], { timeout: 8000 });
  const parsed = JSON.parse(stdout);
  const roots = await listStorageRoots();
  const rootPaths = new Set(roots.map((root) => path.resolve(root.path)));

  function flatten(items = [], parent = null) {
    return items.flatMap((item) => {
      const current = { ...item, parent };
      return [current, ...flatten(item.children || [], current)];
    });
  }

  return flatten(parsed.blockdevices || [])
    .filter((item) => ['disk', 'part', 'lvm'].includes(item.type))
    .filter((item) => !['/', '/boot'].includes(item.mountpoint || ''))
    .map((item) => {
      const mountPath = item.mountpoint ? path.resolve(item.mountpoint, 'servers') : '';
      const isConfigured = mountPath ? rootPaths.has(mountPath) || [...rootPaths].some((rootPath) => rootPath.startsWith(path.resolve(item.mountpoint) + path.sep)) : false;
      const children = item.children || [];
      const blankDisk = item.type === 'disk' && !item.fstype && !item.mountpoint && children.length === 0;
      const mountedStorage = Boolean(item.mountpoint && !['/', '/boot'].includes(item.mountpoint));

      return {
        id: item.name,
        name: item.name,
        path: item.path,
        sizeBytes: Number(item.size || 0),
        sizeLabel: formatBytes(Number(item.size || 0)),
        type: item.type,
        fstype: item.fstype || '',
        mountpoint: item.mountpoint || '',
        label: item.label || '',
        model: item.model || '',
        serial: item.serial || '',
        uuid: item.uuid || '',
        status: isConfigured ? 'configured' : mountedStorage ? 'mounted' : blankDisk ? 'blank' : 'unavailable',
        canUse: mountedStorage && !isConfigured,
        canPrepare: blankDisk,
        storagePath: mountedStorage ? mountPath : ''
      };
    });
}

export async function prepareStorageDisk(input = {}) {
  const devicePath = String(input.path || '').trim();
  const label = String(input.label || '').trim() || 'Disco servidores';
  const id = slugify(input.id || label || path.basename(devicePath));

  if (!devicePath.startsWith('/dev/')) throw new Error('Disco invalido');
  if (!id) throw new Error('Nome do destino em falta');

  const disks = await listStorageDisks();
  const disk = disks.find((item) => item.path === devicePath);
  if (!disk || !disk.canPrepare) {
    throw new Error('Este disco nao esta vazio ou nao pode ser preparado automaticamente');
  }

  const mountBase = path.join('/mnt', 'gameforge-storage', id);
  const serversPath = path.join(mountBase, 'servers');
  const partitionPath = devicePath.match(/\d$/) ? `${devicePath}p1` : `${devicePath}1`;
  const fsLabel = `gf_${id}`.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 16);

  await execFileAsync('parted', ['-s', devicePath, 'mklabel', 'gpt', 'mkpart', 'primary', 'ext4', '0%', '100%'], { timeout: 30000 });
  await execFileAsync('partprobe', [devicePath], { timeout: 10000 }).catch(() => null);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  await execFileAsync('mkfs.ext4', ['-F', '-L', fsLabel, partitionPath], { timeout: 120000 });
  await fs.mkdir(mountBase, { recursive: true });
  await execFileAsync('mount', [partitionPath, mountBase], { timeout: 30000 });
  await fs.mkdir(serversPath, { recursive: true });

  const { stdout } = await execFileAsync('blkid', ['-s', 'UUID', '-o', 'value', partitionPath], { timeout: 10000 });
  const uuid = stdout.trim();
  if (uuid) {
    const fstabLine = `UUID=${uuid} ${mountBase} ext4 defaults,nofail 0 2`;
    const fstab = await fs.readFile('/etc/fstab', 'utf8').catch(() => '');
    if (!fstab.includes(uuid) && !fstab.includes(` ${mountBase} `)) {
      await fs.appendFile('/etc/fstab', `\n${fstabLine}\n`);
    }
  }

  return addStorageRoot({
    id,
    label,
    path: serversPath
  });
}

function formatBytes(bytes) {
  if (!bytes) return '0B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let index = 0;

  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }

  return `${value >= 10 ? Math.round(value) : value.toFixed(1)}${units[index]}`;
}

export async function isPathInsideStorageRoots(candidatePath) {
  const roots = await listStorageRoots();
  const resolvedCandidate = path.resolve(candidatePath);

  return roots.some((root) => {
    const resolvedRoot = path.resolve(root.path);
    return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(resolvedRoot + path.sep);
  });
}

async function getStorageStats(rootPath) {
  try {
    const { stdout } = await execFileAsync('df', ['-Pk', rootPath], { timeout: 5000 });
    const lines = stdout.trim().split('\n');
    const columns = lines[1]?.trim().split(/\s+/);

    if (!columns || columns.length < 6) {
      return { availableMb: null, usedPercent: null };
    }

    return {
      availableMb: Math.round(Number(columns[3]) / 1024),
      usedPercent: Number(String(columns[4]).replace('%', ''))
    };
  } catch {
    return { availableMb: null, usedPercent: null };
  }
}
