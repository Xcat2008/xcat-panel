import { Router } from 'express';
import { createTeamSpeakAdminToken, getTeamSpeakOverview, runTeamSpeakAction } from '../services/teamspeakService.js';

const router = Router();

router.get('/:id/overview', async (req, res) => {
  try {
    res.json({ ok: true, item: await getTeamSpeakOverview(req.params.id, req.user) });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

router.post('/:id/tokens/server-admin', async (req, res) => {
  try {
    res.json({ ok: true, item: await createTeamSpeakAdminToken(req.params.id, req.user, req.body?.description) });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

router.post('/:id/actions/:action', async (req, res) => {
  try {
    res.json({ ok: true, item: await runTeamSpeakAction(req.params.id, req.user, req.params.action, req.body) });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

export default router;
