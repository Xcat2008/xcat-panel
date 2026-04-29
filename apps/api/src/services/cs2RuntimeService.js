import fs from 'fs/promises';
import path from 'path';
import { getConfig } from './cs2ConfigService.js';

function firstPort(server) {
  return Number(server?.ports?.[0]?.port || server?.installConfig?.port || 27015);
}

export async function writeCs2Runtime(server) {
  if (!server || server.game !== 'cs2') return null;

  const saved = await getConfig(server.id);
  const cfg = saved.config || {};

  const runtime = {
    serverId: server.id,
    generatedAt: new Date().toISOString(),
    port: firstPort(server),
    map: cfg.map || 'de_dust2',
    tickrate: Number(cfg.tickrate || 128),
    maxplayers: Number(cfg.maxplayers || server.installConfig?.maxPlayers || 12),
    game_type: Number(cfg.game_type ?? 0),
    game_mode: Number(cfg.game_mode ?? 1),
    servercfgfile: 'server.cfg',
    gslt: cfg.gslt || ''
  };

  const runtimePath = path.join(server.path, 'runtime.json');
  await fs.writeFile(runtimePath, JSON.stringify(runtime, null, 2));

  return {
    path: runtimePath,
    runtime
  };
}
