import { getUserById, verifyToken } from '../services/authService.js';

export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;

    if (!token) {
      return res.status(401).json({
        ok: false,
        error: 'Autenticação necessária'
      });
    }

    const payload = verifyToken(token);
    const user = await getUserById(payload.sub);

    if (!user) {
      return res.status(401).json({
        ok: false,
        error: 'Utilizador inválido'
      });
    }

    req.user = user;
    next();
  } catch {
    res.status(401).json({
      ok: false,
      error: 'Sessão inválida ou expirada'
    });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        ok: false,
        error: 'Sem permissões'
      });
    }

    next();
  };
}
