import express from 'express';
import { addStorageRoot, listStorageDisks, listStorageRoots, prepareStorageDisk } from '../services/storageService.js';

const router = express.Router();

router.get('/roots', async (req, res) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ ok: false, error: 'Apenas admin' });
    }

    const items = await listStorageRoots({ includeStats: true });
    res.json({ ok: true, items });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/roots', async (req, res) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ ok: false, error: 'Apenas admin' });
    }

    const item = await addStorageRoot(req.body || {});
    res.status(201).json({ ok: true, item });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.get('/disks', async (req, res) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ ok: false, error: 'Apenas admin' });
    }

    const items = await listStorageDisks();
    res.json({ ok: true, items });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/disks/prepare', async (req, res) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ ok: false, error: 'Apenas admin' });
    }

    const item = await prepareStorageDisk(req.body || {});
    res.status(201).json({ ok: true, item });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

export default router;
