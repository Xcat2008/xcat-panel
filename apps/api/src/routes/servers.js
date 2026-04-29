import express from 'express';
import {
  listServers,
  getServer,
  startServer,
  stopServer,
  restartServer,
  deleteServer,
  reinstallServer,
  installServer,
  assignServerOwner
} from '../services/serverService.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const result = await listServers(req.user);
    res.json({ ok: true, items: result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const result = await installServer({
      game: req.body.game,
      config: req.body.config,
      storageRootId: req.body.storageRootId,
      ownerId: req.body.ownerId || req.user.id,
      ownerName: req.body.ownerName || req.user.name || 'Administrador',
      ownerEmail: req.body.ownerEmail || req.user.email
    }, req.user);

    res.status(201).json({ ok: true, item: result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const result = await getServer(req.params.id, req.user);
    res.json({ ok: true, item: result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/:id/start', async (req, res) => {
  try {
    const result = await startServer(req.params.id, req.user);
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/:id/stop', async (req, res) => {
  try {
    const result = await stopServer(req.params.id, req.user);
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/:id/restart', async (req, res) => {
  try {
    const result = await restartServer(req.params.id, req.user);
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/:id/reinstall', async (req, res) => {
  try {
    const result = await reinstallServer(req.params.id, req.user);
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.patch('/:id/owner', async (req, res) => {
  try {
    const result = await assignServerOwner(req.params.id, req.body, req.user);
    res.json({ ok: true, item: result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = await deleteServer(req.user, req.params.id);

    if (!result.ok) {
      return res.status(400).json(result);
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
