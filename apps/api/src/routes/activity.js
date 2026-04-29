import { Router } from 'express';
import { listActivity } from '../services/activityService.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    res.json({
      ok: true,
      items: await listActivity(req.user)
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

export default router;
