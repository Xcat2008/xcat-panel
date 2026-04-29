import express from 'express';
import {
  installPlugin,
  listPlugins,
  uninstallPlugin
} from '../services/pluginService.js';

const router = express.Router();

router.get('/servers/:serverId/plugins', async (req, res) => {
  try {
    const items = await listPlugins(req.params.serverId, 'cs2');

    return res.json({
      ok: true,
      items
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || 'Erro ao listar plugins'
    });
  }
});

router.post('/servers/:serverId/plugins/:pluginId/install', async (req, res) => {
  try {
    const result = await installPlugin(req.params.serverId, req.params.pluginId, 'cs2');

    return res.json({
      ok: true,
      ...result
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || 'Erro ao instalar plugin'
    });
  }
});

router.post('/servers/:serverId/plugins/:pluginId/uninstall', async (req, res) => {
  try {
    const result = await uninstallPlugin(req.params.serverId, req.params.pluginId, 'cs2');

    return res.json({
      ok: true,
      ...result
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || 'Erro ao remover plugin'
    });
  }
});

export default router;
