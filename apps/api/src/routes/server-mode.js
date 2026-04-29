import express from 'express';
import { execSync } from 'child_process';

const router = express.Router();

function writeCommand(serverId, command) {
  const pipe = `/opt/xcat-panel/servers/${serverId}/files/console.pipe`;
  execSync(`printf "%s\n" "${command}" > "${pipe}"`);
}

function applyMode(serverId, mode) {
  switch (mode) {
    case 'competitive':
      writeCommand(serverId, 'css_readyrequired 1');
      writeCommand(serverId, 'bot_kick');
      writeCommand(serverId, 'mp_warmup_end');
      break;

    case 'practice':
      writeCommand(serverId, 'sv_cheats 1');
      writeCommand(serverId, 'mp_warmup_start');
      writeCommand(serverId, 'mp_roundtime 60');
      break;

    case 'casual':
      writeCommand(serverId, 'sv_cheats 0');
      writeCommand(serverId, 'mp_warmup_start');
      writeCommand(serverId, 'bot_add');
      break;

    default:
      throw new Error('Modo inválido');
  }
}

router.post('/servers/:serverId/mode', async (req, res) => {
  try {
    const { mode } = req.body;

    applyMode(req.params.serverId, mode);

    return res.json({
      ok: true,
      mode
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

export default router;
