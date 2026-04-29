import { Router } from 'express';
import {
  startCs2Update,
  getCs2UpdateLogs,
  getCs2UpdateStatus
} from '../services/gameUpdateService.js';

const router = Router();

router.post('/cs2/start', async (req, res) => {
  try {
    const item = await startCs2Update(req.user);
    res.json({ ok: true, item });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

router.get('/cs2/logs', async (req, res) => {
  try {
    const items = await getCs2UpdateLogs(req.user);
    res.json({ ok: true, items });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

router.get('/cs2/status', async (req, res) => {
  try {
    const item = await getCs2UpdateStatus(req.user);
    res.json({ ok: true, item });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

export default router;
