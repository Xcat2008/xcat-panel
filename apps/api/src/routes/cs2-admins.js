import express from 'express';
import fs from 'fs/promises';
import path from 'path';

const router = express.Router();

const SERVERS_ROOT = '/opt/gameforge/servers';

function getAdminsPath(serverId) {
  return path.join(
    SERVERS_ROOT,
    serverId,
    'files/game/csgo/addons/counterstrikesharp/configs/admins.json'
  );
}

function safeKey(name, steamId) {
  const base = String(name || steamId || 'admin')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gi, '_')
    .replace(/^_+|_+$/g, '');

  return base || `admin_${Date.now()}`;
}

function normalizeFlags(flags) {
  if (Array.isArray(flags)) {
    return flags.filter(Boolean).map(String);
  }

  if (typeof flags === 'string') {
    return flags
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return ['@css/root'];
}

async function readAdmins(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);

    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }

    return {};
  } catch {
    return {};
  }
}

async function writeAdmins(filePath, admins) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(admins, null, 2)}\n`, 'utf8');
}

router.get('/:serverId', async (req, res) => {
  try {
    const filePath = getAdminsPath(req.params.serverId);
    const admins = await readAdmins(filePath);

    return res.json({
      ok: true,
      admins
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || 'Erro ao carregar admins'
    });
  }
});

router.post('/:serverId', async (req, res) => {
  try {
    const { SteamID, steamId, identity, Name, name, Flags, flags } = req.body || {};

    const finalSteamId = String(SteamID || steamId || identity || '').trim();
    const finalName = String(Name || name || finalSteamId || '').trim();

    if (!finalSteamId) {
      return res.status(400).json({
        ok: false,
        error: 'SteamID obrigatório'
      });
    }

    const filePath = getAdminsPath(req.params.serverId);
    const admins = await readAdmins(filePath);

    const key = safeKey(finalName, finalSteamId);

    admins[key] = {
      identity: finalSteamId,
      flags: normalizeFlags(Flags ?? flags)
    };

    await writeAdmins(filePath, admins);

    return res.json({
      ok: true,
      admins
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || 'Erro ao adicionar admin'
    });
  }
});

router.delete('/:serverId/:adminId', async (req, res) => {
  try {
    const filePath = getAdminsPath(req.params.serverId);
    const admins = await readAdmins(filePath);

    const adminId = decodeURIComponent(req.params.adminId);

    for (const [key, admin] of Object.entries(admins)) {
      if (
        key === adminId ||
        admin?.identity === adminId ||
        admin?.SteamID === adminId ||
        admin?.steamId === adminId
      ) {
        delete admins[key];
      }
    }

    await writeAdmins(filePath, admins);

    return res.json({
      ok: true,
      admins
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || 'Erro ao remover admin'
    });
  }
});

export default router;
