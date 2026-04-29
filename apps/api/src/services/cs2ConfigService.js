import fs from 'fs/promises';
import path from 'path';
import { readJson, writeJson } from '../utils/jsonStore.js';

const CONFIG_DB_PATH = '/opt/xcat-panel/apps/api/data/cs2-configs.json';
const SERVERS_ROOT = '/opt/xcat-panel/servers';

export const DEFAULT_CS2_CONFIG = {
  hostname: 'GameForge CS2 Server',
  rcon_password: '',
  sv_password: '',
  maxplayers: 12,
  tickrate: 128,
  map: 'de_dust2',
  game_type: 0,
  game_mode: 1,
  sv_cheats: 0,
  bots_enabled: true,
  bot_quota: 5,
  warmup_enabled: true,
  mp_warmuptime: 60,
  mp_warmup_pausetimer: 0,
  autobalance: true,
  mp_limitteams: 1,
  tv_enable: 1,
  tv_port: 27020,
  tv_delay: 90,
  tv_maxclients: 10,
  tv_autorecord: 0,
  gslt: '',
};

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function sanitizeString(value, fallback = '') {
  if (typeof value !== 'string') return fallback;
  return value.replace(/[\r\n"]/g, '').trim();
}

function normalizeBoolToInt(value, fallback = 0) {
  if (value === true || value === 1 || value === '1' || value === 'true') return 1;
  if (value === false || value === 0 || value === '0' || value === 'false') return 0;
  return fallback;
}

export function normalizeConfig(input = {}) {
  const cfg = {
    ...DEFAULT_CS2_CONFIG,
    ...input,
  };

  return {
    hostname: sanitizeString(cfg.hostname, DEFAULT_CS2_CONFIG.hostname),
    rcon_password: sanitizeString(cfg.rcon_password, ''),
    sv_password: sanitizeString(cfg.sv_password, ''),
    maxplayers: clampNumber(cfg.maxplayers, 2, 64, DEFAULT_CS2_CONFIG.maxplayers),
    tickrate: clampNumber(cfg.tickrate, 64, 128, DEFAULT_CS2_CONFIG.tickrate),
    map: sanitizeString(cfg.map, DEFAULT_CS2_CONFIG.map),
    game_type: clampNumber(cfg.game_type, 0, 3, DEFAULT_CS2_CONFIG.game_type),
    game_mode: clampNumber(cfg.game_mode, 0, 3, DEFAULT_CS2_CONFIG.game_mode),
    sv_cheats: normalizeBoolToInt(cfg.sv_cheats, 0),
    bots_enabled: Boolean(cfg.bots_enabled),
    bot_quota: clampNumber(cfg.bot_quota, 0, 32, DEFAULT_CS2_CONFIG.bot_quota),
    warmup_enabled: Boolean(cfg.warmup_enabled),
    mp_warmuptime: clampNumber(cfg.mp_warmuptime, 0, 600, DEFAULT_CS2_CONFIG.mp_warmuptime),
    mp_warmup_pausetimer: normalizeBoolToInt(cfg.mp_warmup_pausetimer, 0),
    autobalance: Boolean(cfg.autobalance),
    mp_limitteams: clampNumber(cfg.mp_limitteams, 0, 32, DEFAULT_CS2_CONFIG.mp_limitteams),
    tv_enable: normalizeBoolToInt(cfg.tv_enable, DEFAULT_CS2_CONFIG.tv_enable),
    tv_port: clampNumber(cfg.tv_port, 1024, 65535, DEFAULT_CS2_CONFIG.tv_port),
    tv_delay: clampNumber(cfg.tv_delay, 0, 600, DEFAULT_CS2_CONFIG.tv_delay),
    tv_maxclients: clampNumber(cfg.tv_maxclients, 0, 64, DEFAULT_CS2_CONFIG.tv_maxclients),
    tv_autorecord: normalizeBoolToInt(cfg.tv_autorecord, DEFAULT_CS2_CONFIG.tv_autorecord),
    gslt: sanitizeString(cfg.gslt, ''),
  };
}

function getServerCfgPath(serverId) {
  return path.join(SERVERS_ROOT, serverId, 'overlay/upper/csgo/cfg/server.cfg');
}

export function renderServerCfg(config) {
  const cfg = normalizeConfig(config);

  return `// ============================================================================
// GameForge Hosting OS - CS2 server.cfg
// Generated automatically. Do not edit manually unless you know what you are doing.
// ============================================================================

hostname "${cfg.hostname}"

rcon_password "${cfg.rcon_password}"
sv_password "${cfg.sv_password}"

sv_cheats ${cfg.sv_cheats}

mp_autoteambalance ${cfg.autobalance ? 1 : 0}
mp_limitteams ${cfg.mp_limitteams}

bot_quota ${cfg.bots_enabled ? cfg.bot_quota : 0}
bot_quota_mode "fill"
bot_difficulty 2

mp_warmuptime ${cfg.warmup_enabled ? cfg.mp_warmuptime : 0}
mp_warmup_pausetimer ${cfg.mp_warmup_pausetimer}

sv_lan 0
sv_pure 1
sv_region 3

// CSTV / GOTV
tv_enable ${cfg.tv_enable}
tv_port ${cfg.tv_port}
tv_delay ${cfg.tv_delay}
tv_maxclients ${cfg.tv_maxclients}
tv_autorecord ${cfg.tv_autorecord}
tv_advertise_watchable 1

writeid
writeip
`;
}

async function getAllConfigs() {
  return readJson(CONFIG_DB_PATH, {});
}

export async function getConfig(serverId) {
  const db = await getAllConfigs();

  if (!db[serverId]) {
    return {
      serverId,
      config: DEFAULT_CS2_CONFIG,
      exists: false,
    };
  }

  return {
    serverId,
    config: normalizeConfig(db[serverId].config),
    exists: true,
    updatedAt: db[serverId].updatedAt,
  };
}

export async function saveConfig(serverId, inputConfig) {
  const db = await getAllConfigs();
  const existingConfig = db[serverId]?.config || {};
  const incoming = inputConfig || {};

  const normalized = normalizeConfig({
    ...existingConfig,
    ...incoming,
    gslt: incoming.gslt !== undefined ? incoming.gslt : existingConfig.gslt
  });

  db[serverId] = {
    serverId,
    config: normalized,
    updatedAt: new Date().toISOString(),
  };

  await writeJson(CONFIG_DB_PATH, db);

  return db[serverId];
}

export async function applyConfig(serverId) {
  const saved = await getConfig(serverId);
  const cfgPath = getServerCfgPath(serverId);

  await fs.mkdir(path.dirname(cfgPath), { recursive: true });
  await fs.writeFile(cfgPath, renderServerCfg(saved.config), 'utf8');

function maskGslt(gslt) {
  if (!gslt) return { configured: false, last4: null };
  return {
    configured: true,
    last4: gslt.slice(-4)
  };
}

const safeConfig = {
  ...saved.config,
  gslt: maskGslt(saved.config.gslt)
};

return {
  serverId,
  path: cfgPath,
  config: safeConfig,
  appliedAt: new Date().toISOString(),
};
}

export async function saveAndApplyConfig(serverId, inputConfig) {
  const saved = await saveConfig(serverId, inputConfig);
  const applied = await applyConfig(serverId);

  return {
    ...saved,
    serverCfgPath: applied.path,
    appliedAt: applied.appliedAt,
  };
}
