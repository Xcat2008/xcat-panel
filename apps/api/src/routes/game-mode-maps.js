import express from 'express';
import { getModeMaps, setModeMaps } from '../services/gameModeMapsService.js';

const router = express.Router();

router.get('/servers/:serverId/game-mode-maps', async (req, res) => {
  try {
    const data = await getModeMaps(req.params.serverId);
    return res.json({ ok: true, data });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao carregar mapas.' });
  }
});

router.post('/servers/:serverId/game-mode-maps', async (req, res) => {
  try {
    const modeId = String(req.body?.modeId || '').trim();

    if (!modeId) {
      return res.status(400).json({ ok: false, error: 'modeId obrigatório.' });
    }

    const item = await setModeMaps(req.params.serverId, modeId, {
      defaultMap: req.body?.defaultMap || '',
      mapPool: Array.isArray(req.body?.mapPool) ? req.body.mapPool : [],
      mapLabels: req.body?.mapLabels && typeof req.body.mapLabels === 'object' ? req.body.mapLabels : {},
      mapMeta: req.body?.mapMeta && typeof req.body.mapMeta === 'object' ? req.body.mapMeta : {},
      rotation: req.body?.rotation && typeof req.body.rotation === 'object' ? req.body.rotation : undefined,
      settings: req.body?.settings && typeof req.body.settings === 'object' ? req.body.settings : undefined,
      configText: typeof req.body?.configText === 'string' ? req.body.configText : undefined
    });

    return res.json({ ok: true, item });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Erro ao guardar mapas.' });
  }
});

export default router;
