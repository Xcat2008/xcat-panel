import { Router } from 'express';

const router = Router();

router.get('/', (req, res) => {
  res.json({
    ok: true,
    name: 'GameForge API',
    version: '0.1.0',
    status: 'online',
    timestamp: new Date().toISOString()
  });
});

export default router;
