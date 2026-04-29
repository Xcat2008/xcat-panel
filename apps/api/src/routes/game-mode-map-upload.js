import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import multer from 'multer';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024 * 500 } });

const SERVERS_ROOT = '/opt/gameforge/servers';
const ALLOWED_EXT = new Set(['.vpk', '.bsp', '.nav']);

function safeFileName(name) {
  return path.basename(String(name || '')).replace(/[^\w.\-]/g, '_');
}

router.post('/servers/:serverId/maps/upload', upload.single('mapFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: 'Nenhum ficheiro enviado.' });
    }

    const fileName = safeFileName(req.file.originalname);
    const ext = path.extname(fileName).toLowerCase();

    if (!ALLOWED_EXT.has(ext)) {
      return res.status(400).json({
        ok: false,
        error: 'Formato inválido. Usa .vpk, .bsp ou .nav.'
      });
    }

    const mapsDir = path.join(SERVERS_ROOT, req.params.serverId, 'files/game/csgo/maps');
    await fs.mkdir(mapsDir, { recursive: true });

    const target = path.join(mapsDir, fileName);
    await fs.writeFile(target, req.file.buffer);

    return res.json({
      ok: true,
      fileName,
      mapName: path.basename(fileName, ext),
      path: target
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
