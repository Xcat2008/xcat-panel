import fs from 'fs/promises';
import path from 'path';
import net from 'net';
import { getServer } from './serverService.js';

const ROOT = process.env.GAMEFORGE_ROOT || '/opt/gameforge';

function unescapeValue(value = '') {
  return String(value)
    .replace(/\\s/g, ' ')
    .replace(/\\p/g, '|')
    .replace(/\\\//g, '/')
    .replace(/\\\\/g, '\\');
}

function escapeValue(value = '') {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\//g, '\\/')
    .replace(/\|/g, '\\p')
    .replace(/\s/g, '\\s');
}

function parseRows(raw = '') {
  return raw
    .split('|')
    .map((row) => {
      const item = {};
      for (const pair of row.trim().split(/\s+/)) {
        const [key, ...rest] = pair.split('=');
        if (!key) continue;
        item[key] = unescapeValue(rest.join('='));
      }
      return item;
    })
    .filter((item) => Object.keys(item).length > 0);
}

async function readText(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

async function readTeamSpeakSecrets(server) {
  const processLog = await readText(path.join(server.path, 'logs', 'process.log'));
  const tokenMatch = processLog.match(/token=([^\s]+)/);
  const passwordMatch = processLog.match(/password=\s*"([^"]+)"/);
  const apiKeyMatch = processLog.match(/apikey=\s*"([^"]+)"/);

  return {
    privilegeKey: tokenMatch?.[1] || '',
    queryLogin: 'serveradmin',
    queryPassword: passwordMatch?.[1] || '',
    apiKey: apiKeyMatch?.[1] || ''
  };
}

function sendQuery(port, commands) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port, timeout: 5000 });
    let buffer = '';
    let index = -1;
    const results = [];

    function sendNext() {
      index += 1;
      if (index >= commands.length) {
        socket.end('quit\n');
        resolve(results);
        return;
      }

      socket.write(`${commands[index]}\n`);
    }

    socket.on('connect', () => {});
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');

      if (index === -1 && buffer.includes('TS3')) {
        buffer = '';
        sendNext();
        return;
      }

      while (buffer.includes('error id=')) {
        const marker = buffer.indexOf('error id=');
        const before = buffer.slice(0, marker).trim();
        const rest = buffer.slice(marker);
        const lineEnd = rest.indexOf('\n');
        if (lineEnd === -1) return;

        const errorLine = rest.slice(0, lineEnd).trim();
        const id = Number(errorLine.match(/error id=(\d+)/)?.[1] || 0);
        const msg = unescapeValue(errorLine.match(/msg=([^\s]+)/)?.[1] || '');

        if (id !== 0) {
          socket.destroy();
          reject(new Error(msg || `TeamSpeak query error ${id}`));
          return;
        }

        results.push(before);
        buffer = rest.slice(lineEnd + 1);
        sendNext();
      }
    });
    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error('TeamSpeak ServerQuery não respondeu'));
    });
    socket.on('error', reject);
  });
}

export async function getTeamSpeakOverview(id, user) {
  const server = await getServer(id, user);
  if (!server || server.game !== 'teamspeak3') {
    throw new Error('Servidor TeamSpeak não encontrado');
  }

  const secrets = await readTeamSpeakSecrets(server);
  const queryPort = Number(server.installConfig?.queryPort || server.ports?.find((item) => item.name === 'Query')?.port || 10011);

  if (!secrets.queryPassword) {
    return {
      online: false,
      error: 'Credenciais ServerQuery ainda não foram geradas. Faz Start ao TeamSpeak e abre a consola.',
      privilegeKey: secrets.privilegeKey,
      channels: [],
      clients: []
    };
  }

  let queryResult;

  try {
    queryResult = await sendQuery(queryPort, [
      `login ${secrets.queryLogin} ${secrets.queryPassword}`,
      'use sid=1',
      'serverinfo',
      'channellist',
      'clientlist'
    ]);
  } catch (error) {
    return {
      online: false,
      error: error.message,
      privilegeKey: secrets.privilegeKey,
      channels: [],
      clients: []
    };
  }

  const [login, use, serverInfo, channels, clients] = queryResult;

  return {
    online: true,
    login: Boolean(login || use),
    privilegeKey: secrets.privilegeKey,
    serverInfo: parseRows(serverInfo)[0] || {},
    channels: parseRows(channels).map((channel) => ({
      id: channel.cid,
      parentId: channel.pid,
      name: channel.channel_name,
      order: Number(channel.channel_order || 0),
      clients: Number(channel.total_clients || 0),
      maxClients: Number(channel.channel_maxclients || -1)
    })),
    clients: parseRows(clients)
      .filter((client) => client.client_type !== '1')
      .map((client) => ({
        id: client.clid,
        databaseId: client.client_database_id,
        channelId: client.cid,
        name: client.client_nickname,
        platform: client.client_platform
      }))
  };
}

export async function createTeamSpeakAdminToken(id, user, description = '') {
  const server = await getServer(id, user);
  if (!server || server.game !== 'teamspeak3') {
    throw new Error('Servidor TeamSpeak não encontrado');
  }

  const secrets = await readTeamSpeakSecrets(server);
  if (!secrets.queryPassword) {
    throw new Error('Credenciais ServerQuery ainda não foram geradas');
  }

  const queryPort = Number(server.installConfig?.queryPort || server.ports?.find((item) => item.name === 'Query')?.port || 10011);
  const safeDescription = String(description || 'GameForge ServerAdmin').replace(/\s/g, '\\s');
  const [login, use, tokenResult] = await sendQuery(queryPort, [
    `login ${secrets.queryLogin} ${secrets.queryPassword}`,
    'use sid=1',
    `tokenadd tokentype=0 tokenid1=6 tokenid2=0 tokendescription=${safeDescription}`
  ]);

  const token = parseRows(tokenResult)[0]?.token;
  return {
    ok: Boolean(login || use),
    token: token || ''
  };
}

export async function runTeamSpeakAction(id, user, action, payload = {}) {
  const server = await getServer(id, user);
  if (!server || server.game !== 'teamspeak3') {
    throw new Error('Servidor TeamSpeak não encontrado');
  }

  const secrets = await readTeamSpeakSecrets(server);
  if (!secrets.queryPassword) throw new Error('Credenciais ServerQuery ainda não foram geradas');

  const queryPort = Number(server.installConfig?.queryPort || 10011);
  const base = [
    `login ${secrets.queryLogin} ${secrets.queryPassword}`,
    'use sid=1'
  ];

  if (action === 'create-channel') {
    const name = String(payload.name || '').trim();
    if (!name) throw new Error('Nome do canal obrigatório');
    const parts = [
      `channel_name=${escapeValue(name)}`,
      'channel_flag_permanent=1'
    ];
    if (payload.parentId) parts.push(`cpid=${Number(payload.parentId)}`);
    if (payload.maxClients) parts.push(`channel_maxclients=${Number(payload.maxClients)}`);
    if (payload.password) parts.push(`channel_password=${escapeValue(payload.password)}`);
    if (payload.topic) parts.push(`channel_topic=${escapeValue(payload.topic)}`);
    base.push(`channelcreate ${parts.join(' ')}`);
  } else if (action === 'delete-channel') {
    if (!payload.channelId) throw new Error('Canal obrigatório');
    base.push(`channeldelete cid=${Number(payload.channelId)} force=1`);
  } else if (action === 'move-client') {
    if (!payload.clientId || !payload.channelId) throw new Error('Cliente e canal obrigatórios');
    base.push(`clientmove clid=${Number(payload.clientId)} cid=${Number(payload.channelId)}`);
  } else if (action === 'kick-client') {
    if (!payload.clientId) throw new Error('Cliente obrigatório');
    base.push(`clientkick clid=${Number(payload.clientId)} reasonid=5 reasonmsg=${escapeValue(payload.reason || 'GameForge')}`);
  } else if (action === 'ban-client') {
    if (!payload.clientId) throw new Error('Cliente obrigatório');
    base.push(`banclient clid=${Number(payload.clientId)} time=${Number(payload.time || 600)} banreason=${escapeValue(payload.reason || 'GameForge ban')}`);
  } else {
    throw new Error('Ação TeamSpeak inválida');
  }

  await sendQuery(queryPort, base);
  return getTeamSpeakOverview(id, user);
}
