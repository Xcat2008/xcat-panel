import { Router } from 'express';
import {
  loginUser,
  getUserById,
  listUsers,
  createClientUser,
  registerClientUser,
  updateUserStatus,
  updateUserRole,
  deleteUser,
  beginTwoFactorSetup,
  confirmTwoFactorSetup,
  disableTwoFactor,
  requestPasswordReset,
  resetPassword
} from '../services/authService.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

router.post('/login', async (req, res) => {
  try {
    const result = await loginUser(req.body.email, req.body.password, req.body.twoFactorCode);

    if (result.requiresTwoFactor) {
      return res.json({ ok: true, requiresTwoFactor: true, user: result.user });
    }

    res.json({ ok: true, token: result.token, user: result.user });
  } catch (error) {
    res.status(401).json({ ok: false, error: error.message });
  }
});

router.post('/2fa/setup', requireAuth, async (req, res) => {
  try {
    const result = await beginTwoFactorSetup(req.user.id);
    res.json({ ok: true, item: result });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

router.post('/2fa/confirm', requireAuth, async (req, res) => {
  try {
    const user = await confirmTwoFactorSetup(req.user.id, req.body?.code);
    res.json({ ok: true, user });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

router.post('/2fa/disable', requireAuth, async (req, res) => {
  try {
    const user = await disableTwoFactor(req.user.id, req.body?.code);
    res.json({ ok: true, user });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

router.post('/register', async (req, res) => {
  try {
    const user = await registerClientUser(req.body);
    res.status(201).json({ ok: true, item: user });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

router.post('/password/forgot', async (req, res) => {
  try {
    const result = await requestPasswordReset(req.body?.email);
    res.json({ ok: true, item: result });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

router.post('/password/reset', async (req, res) => {
  try {
    await resetPassword(req.body?.email, req.body?.token, req.body?.password);
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

router.get('/me', requireAuth, async (req, res) => {
  const user = await getUserById(req.user.id);
  res.json({ ok: true, user });
});

router.get('/users', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    res.json({ ok: true, items: await listUsers() });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

router.post('/users', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const user = await createClientUser(req.body);
    res.status(201).json({ ok: true, item: user });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

router.patch('/users/:id/status', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const user = await updateUserStatus(req.params.id, req.body?.status);
    res.json({ ok: true, item: user });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

router.patch('/users/:id/role', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const user = await updateUserRole(req.params.id, req.body?.role);
    res.json({ ok: true, item: user });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

router.delete('/users/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const user = await deleteUser(req.params.id);
    res.json({ ok: true, item: user });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

export default router;
