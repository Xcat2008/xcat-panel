import fs from 'fs/promises';
import path from 'path';

const SERVERS_ROOT = '/opt/gameforge/servers';

const DEFAULT_MODE_SETTINGS = {
  competitive: {
    settings: { maxPlayers: 11, botQuota: 0, tvSlots: 1 },
    rotation: { enabled: true, mode: 'sequential' }
  },
  aim: {
    settings: { maxPlayers: 16, botQuota: 0, tvSlots: 1 },
    rotation: { enabled: true, mode: 'sequential' }
  },
  fun: {
    settings: { maxPlayers: 18, botQuota: 0, tvSlots: 1 },
    rotation: { enabled: true, mode: 'sequential' }
  },
  gungame: {
    settings: { maxPlayers: 18, botQuota: 0, tvSlots: 1 },
    rotation: { enabled: true, mode: 'sequential' }
  },
  retakes: {
    settings: { maxPlayers: 11, botQuota: 0, tvSlots: 1 },
    rotation: { enabled: true, mode: 'sequential' }
  }
};

function statePath(serverId) {
  return path.join(SERVERS_ROOT, serverId, 'game-mode-maps.json');
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

export async function getModeMaps(serverId) {
  const state = await readJson(statePath(serverId), {});

  for (const [modeId, defaults] of Object.entries(DEFAULT_MODE_SETTINGS)) {
    const item = state[modeId] || {};
    state[modeId] = {
      defaultMap: item.defaultMap || '',
      mapPool: Array.isArray(item.mapPool) ? item.mapPool : [],
      mapLabels: item.mapLabels && typeof item.mapLabels === 'object' ? item.mapLabels : {},
      mapMeta: item.mapMeta && typeof item.mapMeta === 'object' ? item.mapMeta : {},
      rotation: {
        ...defaults.rotation,
        ...(item.rotation && typeof item.rotation === 'object' ? item.rotation : {})
      },
      settings: {
        ...defaults.settings,
        ...(item.settings && typeof item.settings === 'object' ? item.settings : {})
      },
      configText: typeof item.configText === 'string' ? item.configText : ''
    };
  }

  return state;
}

export async function setModeMaps(serverId, modeId, data) {
  const state = await getModeMaps(serverId);
  const current = state[modeId] || {};
  const defaults = DEFAULT_MODE_SETTINGS[modeId] || { settings: {}, rotation: {} };

  state[modeId] = {
    defaultMap: data.defaultMap || '',
    mapPool: Array.isArray(data.mapPool) ? data.mapPool : [],
    mapLabels: data.mapLabels && typeof data.mapLabels === 'object' ? data.mapLabels : {},
    mapMeta: data.mapMeta && typeof data.mapMeta === 'object' ? data.mapMeta : {},
    rotation: data.rotation && typeof data.rotation === 'object'
      ? { ...defaults.rotation, ...data.rotation }
      : current.rotation || defaults.rotation,
    settings: data.settings && typeof data.settings === 'object'
      ? { ...defaults.settings, ...data.settings }
      : current.settings || defaults.settings,
    configText: typeof data.configText === 'string' ? data.configText : current.configText || ''
  };

  await writeJson(statePath(serverId), state);
  return state[modeId];
}
