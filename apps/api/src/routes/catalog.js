import { Router } from 'express';
import { getCatalog } from '../services/catalogService.js';

const router = Router();

router.get('/', async (req, res) => {
  const catalog = await getCatalog();

  res.json({
    ok: true,
    items: catalog
  });
});

export default router;
