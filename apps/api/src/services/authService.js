import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const ROOT = process.env.GAMEFORGE_ROOT || '/opt/xcat-panel';
const USERS_FILE = path.join(ROOT, 'data', 'users.json');
const JWT_SECRET = process.env.GAMEFORGE_JWT_SECRET || 'gameforge-dev-secret-change-me';

async function readUsers() {
  try {
    return JSON.parse(await fs.readFile(USERS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

async function writeUsers(users) {
  await fs.mkdir(path.dirname(USERS_FILE), { recursive: true });
  await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2));
}

function sanitizeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status || 'approved',
    twoFactorEnabled: Boolean(user.twoFactorEnabled),
    createdAt: user.createdAt
  };
}

function base32Encode(buffer) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  let output = '';

  for (const byte of buffer) bits += byte.toString(2).padStart(8, '0');
  for (let i = 0; i < bits.length; i += 5) {
    output += alphabet[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  }

  return output;
}

function base32Decode(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = String(secret || '').replace(/=+$/g, '').replace(/\s+/g, '').toUpperCase();
  let bits = '';

  for (const char of clean) {
    const value = alphabet.indexOf(char);
    if (value >= 0) bits += value.toString(2).padStart(5, '0');
  }

  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }

  return Buffer.from(bytes);
}

function totp(secret, step = Math.floor(Date.now() / 30000)) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = crypto.createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = ((hmac.readUInt32BE(offset) & 0x7fffffff) % 1000000).toString().padStart(6, '0');
  return code;
}

function verifyTotp(secret, code) {
  const clean = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(clean)) return false;

  const currentStep = Math.floor(Date.now() / 30000);
  return [-1, 0, 1].some((offset) => totp(secret, currentStep + offset) === clean);
}

export async function loginUser(email, password, twoFactorCode = '') {
  const users = await readUsers();
  const user = users.find((item) => item.email.toLowerCase() === String(email).toLowerCase());

  if (!user) throw new Error('Credenciais inválidas');

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) throw new Error('Credenciais inválidas');

  if ((user.status || 'approved') !== 'approved') {
    throw new Error(user.status === 'rejected'
      ? 'Conta recusada pelo administrador'
      : 'Conta ainda pendente de aprovação');
  }

  if (user.twoFactorEnabled) {
    if (!twoFactorCode) {
      return { requiresTwoFactor: true, user: { email: user.email } };
    }

    if (!verifyTotp(user.twoFactorSecret, twoFactorCode)) {
      throw new Error('Código 2FA inválido');
    }
  }

  const safeUser = sanitizeUser(user);

  const token = jwt.sign(
    {
      sub: user.id,
      role: user.role,
      email: user.email
    },
    JWT_SECRET,
    { expiresIn: '12h' }
  );

  return { token, user: safeUser };
}

export async function getUserById(id) {
  const users = await readUsers();
  const user = users.find((item) => item.id === id);
  return user ? sanitizeUser(user) : null;
}

export async function listUsers() {
  const users = await readUsers();
  return users.map(sanitizeUser);
}

export async function beginTwoFactorSetup(userId) {
  const users = await readUsers();
  const user = users.find((item) => item.id === userId);
  if (!user) throw new Error('Utilizador não encontrado');

  const secret = base32Encode(crypto.randomBytes(20));
  user.twoFactorPendingSecret = secret;
  user.updatedAt = new Date().toISOString();
  await writeUsers(users);

  const issuer = encodeURIComponent('Xcat Panel');
  const label = encodeURIComponent(`${user.email}`);

  return {
    secret,
    otpauth: `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`
  };
}

export async function confirmTwoFactorSetup(userId, code) {
  const users = await readUsers();
  const user = users.find((item) => item.id === userId);
  if (!user?.twoFactorPendingSecret) throw new Error('Não existe configuração 2FA pendente');
  if (!verifyTotp(user.twoFactorPendingSecret, code)) throw new Error('Código 2FA inválido');

  user.twoFactorSecret = user.twoFactorPendingSecret;
  user.twoFactorEnabled = true;
  delete user.twoFactorPendingSecret;
  user.updatedAt = new Date().toISOString();
  await writeUsers(users);

  return sanitizeUser(user);
}

export async function disableTwoFactor(userId, code) {
  const users = await readUsers();
  const user = users.find((item) => item.id === userId);
  if (!user) throw new Error('Utilizador não encontrado');
  if (user.twoFactorEnabled && !verifyTotp(user.twoFactorSecret, code)) throw new Error('Código 2FA inválido');

  delete user.twoFactorSecret;
  delete user.twoFactorPendingSecret;
  user.twoFactorEnabled = false;
  user.updatedAt = new Date().toISOString();
  await writeUsers(users);

  return sanitizeUser(user);
}

export async function requestPasswordReset(email) {
  const users = await readUsers();
  const user = users.find((item) => item.email.toLowerCase() === String(email || '').trim().toLowerCase());

  if (!user) return { delivered: true };

  const token = crypto.randomBytes(32).toString('base64url');
  user.passwordResetHash = crypto.createHash('sha256').update(token).digest('hex');
  user.passwordResetExpiresAt = new Date(Date.now() + 1000 * 60 * 30).toISOString();
  user.updatedAt = new Date().toISOString();
  await writeUsers(users);

  const publicUrl = process.env.GAMEFORGE_PUBLIC_URL || 'https://aleijados.duckdns.org';
  const resetUrl = `${publicUrl}/#/login?reset=${token}&email=${encodeURIComponent(user.email)}`;
  console.log(`[password-reset] ${user.email}: ${resetUrl}`);

  return {
    delivered: false,
    message: 'SMTP ainda não configurado. Link registado nos logs da API.',
    resetUrl: process.env.GAMEFORGE_SHOW_RESET_LINK === '1' ? resetUrl : undefined
  };
}

export async function resetPassword(email, token, password) {
  const nextPassword = String(password || '').trim();
  if (!nextPassword || nextPassword.length < 8) throw new Error('Password mínima: 8 caracteres');

  const users = await readUsers();
  const user = users.find((item) => item.email.toLowerCase() === String(email || '').trim().toLowerCase());
  const tokenHash = crypto.createHash('sha256').update(String(token || '')).digest('hex');

  if (!user?.passwordResetHash || user.passwordResetHash !== tokenHash) throw new Error('Token inválido');
  if (new Date(user.passwordResetExpiresAt || 0).getTime() < Date.now()) throw new Error('Token expirado');

  user.passwordHash = await bcrypt.hash(nextPassword, 10);
  delete user.passwordResetHash;
  delete user.passwordResetExpiresAt;
  user.updatedAt = new Date().toISOString();
  await writeUsers(users);

  return sanitizeUser(user);
}

export async function createClientUser(payload) {
  const users = await readUsers();

  const email = String(payload.email || '').trim().toLowerCase();
  const name = String(payload.name || '').trim();
  const password = String(payload.password || '').trim();

  if (!name) throw new Error('Nome obrigatório');
  if (!email) throw new Error('Email obrigatório');
  if (!password || password.length < 8) throw new Error('Password mínima: 8 caracteres');

  const exists = users.some((user) => user.email.toLowerCase() === email);
  if (exists) throw new Error('Já existe um utilizador com esse email');

  const passwordHash = await bcrypt.hash(password, 10);

  const user = {
    id: crypto.randomUUID(),
    name,
    email,
    role: 'client',
    status: payload.status || 'approved',
    passwordHash,
    createdAt: new Date().toISOString()
  };

  users.push(user);
  await writeUsers(users);

  return sanitizeUser(user);
}

export async function registerClientUser(payload) {
  const users = await readUsers();

  const email = String(payload.email || '').trim().toLowerCase();
  const name = String(payload.name || '').trim();
  const password = String(payload.password || '').trim();

  if (!name) throw new Error('Nome obrigatório');
  if (!email) throw new Error('Email obrigatório');
  if (!password || password.length < 8) throw new Error('Password mínima: 8 caracteres');

  const exists = users.some((user) => user.email.toLowerCase() === email);
  if (exists) throw new Error('Já existe um utilizador com esse email');

  const passwordHash = await bcrypt.hash(password, 10);

  const user = {
    id: crypto.randomUUID(),
    name,
    email,
    role: 'client',
    status: 'pending',
    passwordHash,
    createdAt: new Date().toISOString()
  };

  users.push(user);
  await writeUsers(users);

  return sanitizeUser(user);
}

export async function updateUserStatus(id, status) {
  const allowed = ['pending', 'approved', 'rejected'];
  const nextStatus = String(status || '').trim();

  if (!allowed.includes(nextStatus)) throw new Error('Estado inválido');

  const users = await readUsers();
  const user = users.find((item) => item.id === id);

  if (!user) throw new Error('Utilizador não encontrado');
  if (user.role === 'admin') throw new Error('Não podes alterar o estado de administradores');

  user.status = nextStatus;
  user.updatedAt = new Date().toISOString();
  await writeUsers(users);

  return sanitizeUser(user);
}

export async function updateUserRole(id, role) {
  const allowed = ['client', 'admin'];
  const nextRole = String(role || '').trim();

  if (!allowed.includes(nextRole)) throw new Error('Tipo de conta inválido');

  const users = await readUsers();
  const admins = users.filter((user) => user.role === 'admin');
  const user = users.find((item) => item.id === id);

  if (!user) throw new Error('Utilizador não encontrado');
  if (user.role === 'admin' && nextRole !== 'admin' && admins.length <= 1) {
    throw new Error('Não podes remover o último administrador');
  }

  user.role = nextRole;
  user.status = user.status || 'approved';
  user.updatedAt = new Date().toISOString();
  await writeUsers(users);

  return sanitizeUser(user);
}

export async function deleteUser(id) {
  const users = await readUsers();
  const index = users.findIndex((user) => user.id === id);

  if (index === -1) throw new Error('Utilizador não encontrado');
  if (users[index].role === 'admin') throw new Error('Não podes apagar administradores por aqui');

  const [deleted] = users.splice(index, 1);
  await writeUsers(users);

  return sanitizeUser(deleted);
}

export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}
