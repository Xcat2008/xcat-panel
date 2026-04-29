import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const SERVERS_ROOT = '/opt/xcat-panel/servers';
const PLUGIN_LIBRARY_ROOT = '/opt/xcat-panel/library/plugins';

const BUILTIN_PLUGINS = [
  {
    id: 'metamod',
    name: 'MetaMod:Source',
    category: 'Core',
    description: 'Base loader necessário para plugins CS2.',
    installMode: 'core',
    protected: true
  },
  {
    id: 'counterstrikesharp',
    name: 'CounterStrikeSharp',
    category: 'Core',
    description: 'Framework principal para plugins modernos de CS2.',
    installMode: 'core',
    protected: true
  },
  {
    id: 'matchzy',
    name: 'MatchZy',
    category: 'Competitive',
    description: 'Sistema competitivo/scrim/war/PCW para CS2.',
    installMode: 'cs2-plugin',
    protected: false
  }
];

function serverRoot(serverId) {
  return path.join(SERVERS_ROOT, serverId);
}

function csgoRoot(serverId) {
  return path.join(serverRoot(serverId), 'files/game/csgo');
}

function statePath(serverId) {
  return path.join(serverRoot(serverId), 'plugins.json');
}

function safeJoin(base, target) {
  const resolved = path.resolve(base, target);
  const root = path.resolve(base);

  if (!resolved.startsWith(`${root}${path.sep}`) && resolved !== root) {
    throw new Error('Caminho inválido no plugin.');
  }

  return resolved;
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function readJson(file, fallback = {}) {
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  await execFileAsync('rsync', ['-a', `${src}/`, `${dest}/`], {
    timeout: 120000
  });
}

async function loadLibraryPlugins(game = 'cs2') {
  const root = path.join(PLUGIN_LIBRARY_ROOT, game);

  if (!(await exists(root))) return [];

  const entries = await fs.readdir(root, { withFileTypes: true });
  const items = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const pluginDir = path.join(root, entry.name);
    const manifest = await readJson(path.join(pluginDir, 'plugin.json'), null);

    if (!manifest?.id || !manifest?.name) continue;

    items.push({
      id: manifest.id,
      name: manifest.name,
      version: manifest.version || '1.0.0',
      category: manifest.category || 'Community',
      description: manifest.description || 'Plugin da biblioteca local.',
      installMode: manifest.installMode || 'package',
      protected: Boolean(manifest.protected),
      requiresRestart: manifest.requiresRestart !== false,
      safeVac: manifest.safeVac !== false,
      warning: manifest.warning || '',
      actions: Array.isArray(manifest.actions) ? manifest.actions : [],
      removePaths: Array.isArray(manifest.removePaths) ? manifest.removePaths : [],
      hasPackage: true
    });
  }

  return items.sort((a, b) => a.name.localeCompare(b.name));
}

async function isBuiltinInstalled(serverId, pluginId) {
  const root = csgoRoot(serverId);

  if (pluginId === 'metamod') {
    return (await exists(path.join(root, 'addons/metamod'))) && (await exists(path.join(root, 'addons/metamod.vdf')));
  }

  if (pluginId === 'counterstrikesharp') {
    return await exists(path.join(root, 'addons/counterstrikesharp'));
  }

  if (pluginId === 'matchzy') {
    return (
      (await exists(path.join(root, 'addons/counterstrikesharp/plugins/MatchZy'))) ||
      (await exists(path.join(root, 'cfg/MatchZy')))
    );
  }

  return false;
}

async function getPluginState(serverId) {
  return readJson(statePath(serverId), { installed: {} });
}

async function setPluginInstalled(serverId, pluginId, installed, extra = {}) {
  const state = await getPluginState(serverId);

  if (!state.installed) state.installed = {};

  if (installed) {
    state.installed[pluginId] = {
      installedAt: state.installed[pluginId]?.installedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...extra
    };
  } else {
    delete state.installed[pluginId];
  }

  await writeJson(statePath(serverId), state);
}

async function getLibraryManifest(pluginId, game = 'cs2') {
  const pluginDir = path.join(PLUGIN_LIBRARY_ROOT, game, pluginId);
  const manifest = await readJson(path.join(pluginDir, 'plugin.json'), null);

  if (!manifest?.id || !manifest?.name) {
    return null;
  }

  return {
    pluginDir,
    manifest
  };
}

export async function getPluginRuntime(serverId) {
  return getPluginState(serverId);
}

export async function listPlugins(serverId, game = 'cs2') {
  const libraryPlugins = await loadLibraryPlugins(game);
  const all = [...BUILTIN_PLUGINS, ...libraryPlugins];
  const state = await getPluginState(serverId);

  const items = [];

  for (const plugin of all) {
    const builtinInstalled = await isBuiltinInstalled(serverId, plugin.id);
    const stateInstalled = Boolean(state.installed?.[plugin.id]);

    items.push({
      id: plugin.id,
      name: plugin.name,
      version: plugin.version || null,
      category: plugin.category,
      description: plugin.description,
      installMode: plugin.installMode,
      protected: Boolean(plugin.protected),
      requiresRestart: plugin.requiresRestart !== false,
      safeVac: plugin.safeVac !== false,
      warning: plugin.warning || '',
      actions: Array.isArray(plugin.actions) ? plugin.actions : [],
      installed: Boolean(builtinInstalled || stateInstalled),
      installedAt: state.installed?.[plugin.id]?.installedAt || null,
      updatedAt: state.installed?.[plugin.id]?.updatedAt || null
    });
  }

  return items;
}

export async function installPlugin(serverId, pluginId, game = 'cs2') {
  const builtin = BUILTIN_PLUGINS.find((plugin) => plugin.id === pluginId);

  if (builtin) {
    const installed = await isBuiltinInstalled(serverId, pluginId);

    if (!installed) {
      throw new Error(`O plugin core "${pluginId}" não tem pacote automático neste servidor.`);
    }

    await setPluginInstalled(serverId, pluginId, true, {
      source: 'builtin'
    });

    return {
      ok: true,
      installed: true,
      message: 'Plugin core já presente no servidor.'
    };
  }

  const loaded = await getLibraryManifest(pluginId, game);

  if (!loaded) {
    throw new Error('Plugin não existe na biblioteca local.');
  }

  const { pluginDir, manifest } = loaded;
  const installScript = path.join(pluginDir, 'install.sh');
  const filesDir = path.join(pluginDir, 'files');

  if (await exists(installScript)) {
    await fs.chmod(installScript, 0o755);

    await execFileAsync(installScript, [], {
      env: {
        ...process.env,
        SERVER_ID: serverId,
        SERVER_ROOT: serverRoot(serverId),
        CSGO_ROOT: csgoRoot(serverId),
        PLUGIN_DIR: pluginDir
      },
      timeout: 120000
    });
  } else if (await exists(filesDir)) {
    await copyDir(filesDir, csgoRoot(serverId));
  } else {
    throw new Error('Plugin sem install.sh e sem pasta files/.');
  }

  await setPluginInstalled(serverId, pluginId, true, {
    source: 'library',
    version: manifest.version || '1.0.0'
  });

  return {
    ok: true,
    installed: true,
    requiresRestart: manifest.requiresRestart !== false,
    message: manifest.installMessage || 'Plugin instalado.'
  };
}

export async function uninstallPlugin(serverId, pluginId, game = 'cs2') {
  const builtin = BUILTIN_PLUGINS.find((plugin) => plugin.id === pluginId);

  if (builtin?.protected) {
    throw new Error('Este plugin é core/protegido e não pode ser removido.');
  }

  if (pluginId === 'matchzy') {
    await fs.rm(path.join(csgoRoot(serverId), 'addons/counterstrikesharp/plugins/MatchZy'), { recursive: true, force: true });
    await fs.rm(path.join(csgoRoot(serverId), 'cfg/MatchZy'), { recursive: true, force: true });
    await setPluginInstalled(serverId, pluginId, false);

    return {
      ok: true,
      installed: false,
      message: 'MatchZy removido.'
    };
  }

  const loaded = await getLibraryManifest(pluginId, game);

  if (loaded?.manifest?.removePaths?.length) {
    for (const removePath of loaded.manifest.removePaths) {
      const target = safeJoin(csgoRoot(serverId), removePath);
      await fs.rm(target, { recursive: true, force: true });
    }
  }

  await setPluginInstalled(serverId, pluginId, false);

  return {
    ok: true,
    installed: false,
    message: loaded?.manifest?.uninstallMessage || 'Plugin removido.'
  };
}

export async function getPluginActions(serverId, pluginId, game = 'cs2') {
  const plugins = await listPlugins(serverId, game);
  const plugin = plugins.find((item) => item.id === pluginId);

  if (!plugin) {
    throw new Error('Plugin não encontrado.');
  }

  if (!plugin.installed) {
    throw new Error('Plugin não está instalado neste servidor.');
  }

  return plugin.actions || [];
}
