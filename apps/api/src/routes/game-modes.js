import express from 'express';
import { applyGameMode, getGameModeState, listGameModes } from '../services/gameModeService.js';

const router = express.Router();

router.get('/servers/:serverId/game-modes', async (req, res) => {
  try {
    const state = await getGameModeState(req.params.serverId);
    const items = await listGameModes(req.params.serverId);

    return res.json({
      ok: true,
      state,
      items
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || 'Erro ao listar modos.'
    });
  }
});

router.post('/servers/:serverId/game-modes/apply', async (req, res) => {
  try {
    const modeId = String(req.body?.modeId || '').trim();
    const result = await applyGameMode(req.params.serverId, modeId);

    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || 'Erro ao aplicar modo.'
    });
  }
});

export default router;
