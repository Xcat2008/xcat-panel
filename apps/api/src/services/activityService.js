import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const ROOT = process.env.GAMEFORGE_ROOT || '/opt/gameforge';
const ACTIVITY_FILE = path.join(ROOT, 'data', 'activity.json');

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

export async function addActivity(event) {
  const activity = await readJson(ACTIVITY_FILE, []);

  const item = {
    id: crypto.randomUUID(),
    type: event.type || 'system',
    title: event.title || 'Evento GameForge',
    message: event.message || '',
    actorId: event.actorId || null,
    actorEmail: event.actorEmail || '',
    actorRole: event.actorRole || '',
    clientId: event.clientId || null,
    serverId: event.serverId || null,
    requestId: event.requestId || null,
    createdAt: new Date().toISOString()
  };

  activity.unshift(item);

  await writeJson(ACTIVITY_FILE, activity.slice(0, 500));

  return item;
}

export async function listActivity(user) {
  const activity = await readJson(ACTIVITY_FILE, []);

  if (user.role === 'admin') {
    return activity;
  }

  return activity.filter((item) => {
    return item.clientId === user.id || item.actorId === user.id;
  });
}
