import { Router } from 'express';
import {
  listRequests,
  createRequest,
  approveRequest,
  rejectRequest,
  deleteRequest
} from '../services/requestService.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    res.json({ ok: true, items: await listRequests(req.user) });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    if (req.user.role !== 'client') {
      return res.status(403).json({
        ok: false,
        error: 'Só clientes podem criar pedidos'
      });
    }

    const request = await createRequest(req.user, req.body);

    res.status(201).json({ ok: true, item: request });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

router.post('/:id/approve', async (req, res) => {
  try {
    res.json({ ok: true, item: await approveRequest(req.user, req.params.id) });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

router.post('/:id/reject', async (req, res) => {
  try {
    res.json({
      ok: true,
      item: await rejectRequest(req.user, req.params.id, req.body.adminNotes || '')
    });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    res.json({ ok: true, item: await deleteRequest(req.user, req.params.id) });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

export default router;
