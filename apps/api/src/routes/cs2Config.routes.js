import express from 'express';
import {
  DEFAULT_CS2_CONFIG,
  getConfig,
  saveConfig,
  applyConfig,
  saveAndApplyConfig,
  renderServerCfg,
  normalizeConfig,
} from '../services/cs2ConfigService.js';

const router = express.Router();

function maskGslt(gslt) {
  if (!gslt) return { configured: false, last4: null };
  return {
    configured: true,
    last4: String(gslt).slice(-4),
  };
}

function safeConfig(config = {}) {
  return {
    ...config,
    gslt: maskGslt(config.gslt),
  };
}

router.get('/servers/:serverId/cs2-config/defaults', async (req, res) => {
  res.json({
    success: true,
    defaults: safeConfig(DEFAULT_CS2_CONFIG),
  });
});

router.get('/servers/:serverId/cs2-config', async (req, res) => {
  try {
    const result = await getConfig(req.params.serverId);

    res.json({
      success: true,
      serverId: result.serverId,
      config: safeConfig(result.config),
      exists: result.exists,
      updatedAt: result.updatedAt,
    });
  } catch (err) {
    console.error('[CS2 CONFIG] GET failed:', err);
    res.status(500).json({ success: false, error: 'Falha ao obter configuração CS2.' });
  }
});

router.put('/servers/:serverId/cs2-config', async (req, res) => {
  try {
    const result = await saveConfig(req.params.serverId, req.body || {});
    res.json({
      success: true,
      message: 'Configuração CS2 guardada.',
      serverId: req.params.serverId,
      config: safeConfig(result.config),
      updatedAt: result.updatedAt,
    });
  } catch (err) {
    console.error('[CS2 CONFIG] PUT failed:', err);
    res.status(500).json({ success: false, error: 'Falha ao guardar configuração CS2.' });
  }
});

router.post('/servers/:serverId/cs2-config/apply', async (req, res) => {
  try {
    const result = await applyConfig(req.params.serverId);
    res.json({
      success: true,
      message: 'server.cfg gerado/aplicado com sucesso.',
      serverId: result.serverId,
      path: result.path,
      config: safeConfig(result.config),
      appliedAt: result.appliedAt,
    });
  } catch (err) {
    console.error('[CS2 CONFIG] APPLY failed:', err);
    res.status(500).json({ success: false, error: 'Falha ao aplicar configuração CS2.' });
  }
});

router.put('/servers/:serverId/cs2-config/save-and-apply', async (req, res) => {
  try {
    const result = await saveAndApplyConfig(req.params.serverId, req.body || {});
    res.json({
      success: true,
      message: 'Configuração CS2 guardada e aplicada.',
      serverId: req.params.serverId,
      config: safeConfig(result.config),
      updatedAt: result.updatedAt,
      serverCfgPath: result.serverCfgPath,
      appliedAt: result.appliedAt,
    });
  } catch (err) {
    console.error('[CS2 CONFIG] SAVE/APPLY failed:', err);
    res.status(500).json({ success: false, error: 'Falha ao guardar/aplicar configuração CS2.' });
  }
});

router.post('/servers/:serverId/cs2-config/preview', async (req, res) => {
  try {
    const config = normalizeConfig(req.body || {});
    res.type('text/plain').send(renderServerCfg(config));
  } catch (err) {
    console.error('[CS2 CONFIG] PREVIEW failed:', err);
    res.status(500).json({ success: false, error: 'Falha ao gerar preview do server.cfg.' });
  }
});

export default router;
