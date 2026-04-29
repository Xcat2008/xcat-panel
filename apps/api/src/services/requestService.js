import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { getCatalog } from './catalogService.js';
import { installServer } from './serverService.js';
import { addActivity } from './activityService.js';

const ROOT = process.env.GAMEFORGE_ROOT || '/opt/gameforge';
const REQUESTS_FILE = path.join(ROOT, 'data', 'server-requests.json');

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

function defaultsFromSchema(schema = []) {
  const values = {};
  for (const field of schema) {
    values[field.key] = field.default ?? '';
  }
  return values;
}

export async function listRequests(user) {
  const requests = await readJson(REQUESTS_FILE, []);
  if (user.role === 'admin') return requests;
  return requests.filter((request) => request.clientId === user.id);
}

export async function createRequest(user, payload) {
  const catalog = await getCatalog();
  const template = catalog.find((item) => item.id === payload.game);

  if (!template) throw new Error('Template inválido');

  const requests = await readJson(REQUESTS_FILE, []);

  const config = {
    ...defaultsFromSchema(template.schema),
    ...(payload.config || {})
  };

  const request = {
    id: crypto.randomUUID(),
    clientId: user.id,
    clientName: user.name,
    clientEmail: user.email,
    game: template.id,
    gameName: template.name,
    status: 'pending',
    config,
    adminNotes: '',
    serverId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  requests.push(request);
  await writeJson(REQUESTS_FILE, requests);

  await addActivity({
    type: 'request.created',
    title: 'Novo pedido de servidor',
    message: `${user.name} pediu ${template.name}`,
    actorId: user.id,
    actorEmail: user.email,
    actorRole: user.role,
    clientId: user.id,
    requestId: request.id
  });

  return request;
}

export async function approveRequest(user, requestId) {
  if (user.role !== 'admin') throw new Error('Sem permissões');

  const requests = await readJson(REQUESTS_FILE, []);
  const index = requests.findIndex((request) => request.id === requestId);

  if (index === -1) throw new Error('Pedido não encontrado');

  const request = requests[index];

  if (request.status !== 'pending') {
    throw new Error('Pedido já foi processado');
  }

  const catalog = await getCatalog();
  const template = catalog.find((item) => item.id === request.game);

  if (!template) throw new Error('Template do pedido já não existe');

  const finalConfig = {
    ...defaultsFromSchema(template.schema),
    ...(request.config || {})
  };

  if (!finalConfig.serverName) {
    finalConfig.serverName = `${request.gameName} - ${request.clientName}`;
  }

  const server = await installServer({
    game: request.game,
    config: finalConfig,
    ownerId: request.clientId,
    ownerName: request.clientName,
    ownerEmail: request.clientEmail
  }, user);

  request.status = 'approved';
  request.config = finalConfig;
  request.serverId = server.id;
  request.updatedAt = new Date().toISOString();

  requests[index] = request;
  await writeJson(REQUESTS_FILE, requests);

  await addActivity({
    type: 'request.approved',
    title: 'Pedido aprovado',
    message: `${user.email} aprovou ${request.gameName} para ${request.clientEmail}`,
    actorId: user.id,
    actorEmail: user.email,
    actorRole: user.role,
    clientId: request.clientId,
    requestId: request.id,
    serverId: server.id
  });

  return { request, server };
}

export async function rejectRequest(user, requestId, adminNotes = '') {
  if (user.role !== 'admin') throw new Error('Sem permissões');

  const requests = await readJson(REQUESTS_FILE, []);
  const index = requests.findIndex((request) => request.id === requestId);

  if (index === -1) throw new Error('Pedido não encontrado');

  requests[index].status = 'rejected';
  requests[index].adminNotes = adminNotes;
  requests[index].updatedAt = new Date().toISOString();

  await writeJson(REQUESTS_FILE, requests);

  await addActivity({
    type: 'request.rejected',
    title: 'Pedido rejeitado',
    message: `${user.email} rejeitou pedido de ${requests[index].clientEmail}`,
    actorId: user.id,
    actorEmail: user.email,
    actorRole: user.role,
    clientId: requests[index].clientId,
    requestId: requests[index].id
  });

  return requests[index];
}

export async function deleteRequest(user, requestId) {
  if (user.role !== 'admin') {
    throw new Error('Só o admin pode apagar pedidos');
  }

  const requests = await readJson(REQUESTS_FILE, []);
  const index = requests.findIndex((request) => request.id === requestId);

  if (index === -1) {
    throw new Error('Pedido não encontrado');
  }

  const [deleted] = requests.splice(index, 1);
  await writeJson(REQUESTS_FILE, requests);

  await addActivity({
    type: 'request.deleted',
    title: 'Pedido apagado',
    message: `${user.email} apagou um pedido de ${deleted.clientEmail}`,
    actorId: user.id,
    actorEmail: user.email,
    actorRole: user.role,
    clientId: deleted.clientId,
    requestId: deleted.id
  });

  return deleted;
}
