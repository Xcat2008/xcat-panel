import React, { useEffect, useMemo, useState } from 'react';
import {
  Ban,
  CheckCircle2,
  Gamepad2,
  Map,
  MessageSquare,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Terminal,
  UserMinus,
  Users
} from 'lucide-react';

const API_URL = '/api';

const MAPS = [
  { label: 'Dust II', value: 'de_dust2', pool: 'Premier' },
  { label: 'Mirage', value: 'de_mirage', pool: 'Premier' },
  { label: 'Inferno', value: 'de_inferno', pool: 'Premier' },
  { label: 'Nuke', value: 'de_nuke', pool: 'Premier' },
  { label: 'Ancient', value: 'de_ancient', pool: 'Premier' },
  { label: 'Anubis', value: 'de_anubis', pool: 'Premier' },
  { label: 'Vertigo', value: 'de_vertigo', pool: 'Premier' },
  { label: 'Office', value: 'cs_office', pool: 'Casual' }
];

const QUICK_COMMANDS = [
  { label: 'Status', icon: CheckCircle2, command: 'status' },
  { label: 'Players', icon: Users, command: 'status' },
  { label: 'Restart round', icon: RotateCcw, command: 'mp_restartgame 1' },
  { label: 'Warmup off', icon: Play, command: 'mp_warmup_end' },
  { label: 'Say online', icon: MessageSquare, command: 'say [GameForge] Server online via Live Control' }
];

const MATCHZY_COMMANDS = [
  { label: 'Solo mode', command: 'css_readyrequired 1' },
  { label: 'Start match', command: 'css_forcestart' },
  { label: 'Stop match', command: 'css_forceend' },
  { label: 'Ready all', command: 'css_forceready' },
  { label: 'Pause', command: 'css_forcepause' },
  { label: 'Unpause', command: 'css_forceunpause' },
  { label: 'Settings', command: 'css_settings' }
];

function shellQuote(value) {
  return `"${String(value || '').replaceAll('"', '\\"')}"`;
}

function looksLikeIp(value) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(value);
}

function looksLikeSteamId(value) {
  return /^STEAM_\d+:\d+:\d+$/i.test(value) || /^\[U:\d+:\d+\]$/i.test(value);
}

export default function CS2LiveControl({ serverId, token }) {
  const [live, setLive] = useState(null);
  const [command, setCommand] = useState('');
  const [map, setMap] = useState('de_dust2');
  const [target, setTarget] = useState('');
  const [reason, setReason] = useState('Admin action');
  const [banMinutes, setBanMinutes] = useState(60);
  const [output, setOutput] = useState('Sem output ainda.');
  const [players, setPlayers] = useState([]);
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [playersOutput, setPlayersOutput] = useState('Clica em Ver jogadores para atualizar a lista.');
  const [loading, setLoading] = useState(false);

  const headers = useMemo(() => ({
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  }), [token]);

  async function parseResponse(response) {
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      return { ok: false, error: text.slice(0, 300) || 'Resposta invalida da API.' };
    }
  }

  function normalizeLiveControl(data) {
    const source = data?.item || data || {};
    const ready = source.ready === true || source.configured === true || source.available === true || source.connected === true;

    return {
      rconConfigured: ready ? 'Configurado' : 'A verificar...',
      host: source.host || source.rconHost || 'console.pipe',
      port: source.port || source.rconPort || 'stdin',
      status: ready ? 'Pronto' : 'Indisponivel'
    };
  }

  function normalizeOutput(value, fallback) {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object') return JSON.stringify(value, null, 2);
    return fallback || 'Comando executado.';
  }

  function cleanPlayerName(value) {
    return String(value || '')
      .replace(/[^\S\r\n]+/g, ' ')
      .replace(/[<>"]/g, '')
      .trim();
  }

  function upsertPlayer(map, player) {
    const name = cleanPlayerName(player.name);
    if (!name || /^bot$/i.test(player.steamId || '')) return;
    const key = player.steamId || player.userId || name;
    const current = map.get(key) || {};
    map.set(key, { ...current, ...player, key, name });
  }

  function removePlayer(map, line) {
    const patterns = [
      /(?:Dropped client|Disconnect client|Netchan)\s+'([^']+)'/i,
      /^(.+?) kicked by Console/i,
      /Steam Net connection .*?'([^']+)'.*closed/i,
      /\[#[^\]]+\s+'([^']+)'\]\s+closed/i
    ];

    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (!match) continue;
      const name = cleanPlayerName(match[1]);
      for (const [key, player] of map.entries()) {
        if (player.name === name) map.delete(key);
      }
    }
  }

  function parsePlayersFromLogs(logs) {
    const map = new Map();

    logs.forEach((line) => {
      removePlayer(map, line);

      let match = line.match(/CServerSideClientBase::Connect\( name='([^']+)', userid=(\d+)/i);
      if (match) {
        upsertPlayer(map, { name: match[1], userId: match[2] });
        return;
      }

      match = line.match(/Client #(\d+)\s+"([^"]+)"\s+connected/i);
      if (match) {
        upsertPlayer(map, { name: match[2], userId: match[1] });
        return;
      }

      match = line.match(/SV:\s+"([^"<]+)<(\d+)><([^>]+)>/i);
      if (match && !/BOT|STEAM_ID_PENDING/i.test(match[3])) {
        upsertPlayer(map, { name: match[1], userId: match[2], steamId: match[3] });
        return;
      }

      match = line.match(/\[MatchZy\].*Player ID:\s*(\d+),\s*Name:\s*(.+?)\s+has connected/i);
      if (match) {
        upsertPlayer(map, { name: match[2], userId: match[1] });
        return;
      }

      match = line.match(/Client\s+(\d+)\s+'([^']+)'\s+signon state .*SIGNONSTATE_FULL/i);
      if (match) {
        upsertPlayer(map, { name: match[2], userId: match[1] });
      }
    });

    return Array.from(map.values()).filter((player) => player.name);
  }

  async function loadStatus() {
    try {
      const response = await fetch(`${API_URL}/servers/${serverId}/live-control`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      const data = await parseResponse(response);

      if (!data.ok) {
        setLive(null);
        setOutput(data.error || 'Live Control indisponivel.');
        return;
      }

      setLive(normalizeLiveControl(data));
    } catch {
      setLive(null);
      setOutput('Erro ao contactar Live Control.');
    }
  }

  async function sendCommand(nextCommand = command, label = '') {
    const finalCommand = String(nextCommand || '').trim();
    if (!finalCommand) return;

    setLoading(true);
    setOutput(`A enviar: ${label || finalCommand}`);

    try {
      const response = await fetch(`${API_URL}/servers/${serverId}/live-control/command`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ command: finalCommand })
      });

      const data = await parseResponse(response);

      if (!data.ok) {
        setOutput(data.error || 'Erro ao executar comando.');
        return;
      }

      setOutput(normalizeOutput(data.output, `Enviado: ${label || finalCommand}`));
      await loadStatus();
    } catch {
      setOutput('Erro de ligacao ao executar comando.');
    } finally {
      setLoading(false);
    }
  }

  async function loadConsoleLogs() {
    try {
      const response = await fetch(`${API_URL}/console/${serverId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      const data = await parseResponse(response);
      return Array.isArray(data.logs) ? data.logs.filter(Boolean) : [];
    } catch {
      return [];
    }
  }

  async function showPlayers() {
    setPlayersOutput('A atualizar lista de jogadores...');
    setLoading(true);

    try {
      const response = await fetch(`${API_URL}/servers/${serverId}/live-control/players`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await parseResponse(response);

      if (!data.ok) {
        setPlayers([]);
        setSelectedPlayer(null);
        setPlayersOutput(data.error || 'Erro ao obter jogadores.');
        return;
      }

      const parsedPlayers = Array.isArray(data.items) ? data.items : [];
      setPlayers(parsedPlayers);

      if (parsedPlayers.length) {
        setPlayersOutput(`${parsedPlayers.length} jogador${parsedPlayers.length === 1 ? '' : 'es'} online.`);
        setOutput(parsedPlayers.map((player) => player.name).join('\n'));
        return;
      }

      setSelectedPlayer(null);
      setPlayersOutput('Nenhum jogador humano encontrado online.');
      setOutput('Nenhum jogador humano encontrado online.');
    } catch {
      setPlayersOutput('Nao consegui contactar a API de jogadores.');
    } finally {
      setLoading(false);
    }
  }

  async function changeMap(nextMap = map) {
    const finalMap = String(nextMap || '').trim();
    if (!finalMap) return;

    setMap(finalMap);
    setLoading(true);
    setOutput(`A mudar mapa para ${finalMap}...`);

    try {
      const response = await fetch(`${API_URL}/servers/${serverId}/live-control/change-map`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ map: finalMap })
      });

      const data = await parseResponse(response);

      if (!data.ok) {
        setOutput(data.error || 'Erro ao mudar mapa.');
        return;
      }

      setOutput(normalizeOutput(data.output, `Mapa alterado para ${finalMap}.`));
      await loadStatus();
    } catch {
      setOutput('Erro de ligacao ao mudar mapa.');
    } finally {
      setLoading(false);
    }
  }

  function runPlayerAction(type) {
    const player = selectedPlayer?.userId || selectedPlayer?.steamId || target.trim();
    if (!player) {
      const message = 'Indica primeiro o UserID, SteamID ou nome do jogador.';
      setPlayersOutput(message);
      setOutput(message);
      return;
    }

    const note = reason.trim() || 'Admin action';
    const isNumericId = /^\d+$/.test(player);
    let nextCommand = '';
    let label = '';

    if (type === 'kick') {
      nextCommand = isNumericId ? `kickid ${player} ${shellQuote(note)}` : `kick ${shellQuote(player)} ${shellQuote(note)}`;
      label = `Kick: ${selectedPlayer?.name || player}`;
    }

    if (type === 'ban') {
      const minutes = Math.max(0, Number(banMinutes) || 0);
      if (isNumericId || looksLikeSteamId(player)) {
        nextCommand = `banid ${minutes} ${player} kick`;
      } else if (looksLikeIp(player)) {
        nextCommand = `banip ${minutes} ${player} kick`;
      } else {
        nextCommand = `kick ${shellQuote(player)} ${shellQuote(note)}`;
      }
      label = `Ban ${minutes}m: ${selectedPlayer?.name || player}`;
    }

    const confirmed = window.confirm(`${label}\nMotivo: ${note}\n\nConfirmas esta acao?`);
    if (confirmed) {
      setPlayersOutput(`A executar: ${label}`);
      sendCommand(nextCommand, label);
    }
  }

  useEffect(() => {
    if (serverId && token) loadStatus();
  }, [serverId, token]);

  return (
    <div className="gf-cs2-admin">
      <div className="gf-section-title gf-cs2-admin-head">
        <div>
          <p className="gf-kicker">CS2 Admin</p>
          <h3>Menu visual de administracao</h3>
        </div>
        <button className="gf-icon-button" disabled={loading} onClick={loadStatus} title="Atualizar estado">
          <RefreshCw size={17} />
        </button>
      </div>

      <div className="gf-detail-grid gf-cs2-status">
        <div className="gf-detail-card"><span>Live Control</span><strong>{live?.status || 'A verificar...'}</strong></div>
        <div className="gf-detail-card"><span>Canal</span><strong>{live?.host || 'console.pipe'}</strong></div>
        <div className="gf-detail-card"><span>Porta</span><strong>{live?.port || 'stdin'}</strong></div>
        <div className="gf-detail-card"><span>RCON</span><strong>{live?.rconConfigured || 'A verificar...'}</strong></div>
      </div>

      <div className="gf-cs2-grid">
        <section className="gf-cs2-panel gf-cs2-panel-wide">
          <div className="gf-cs2-panel-title">
            <Map size={18} />
            <div>
              <span>Mapas</span>
              <strong>Troca rapida de mapa</strong>
            </div>
          </div>

          <div className="gf-map-grid">
            {MAPS.map((item) => (
              <button
                key={item.value}
                className={map === item.value ? 'active' : ''}
                disabled={loading}
                onClick={() => changeMap(item.value)}
              >
                <strong>{item.label}</strong>
                <span>{item.value} / {item.pool}</span>
              </button>
            ))}
          </div>

          <div className="gf-inline-control">
            <label className="gf-field">
              <span>Mapa manual</span>
              <input value={map} onChange={(event) => setMap(event.target.value)} placeholder="de_dust2" />
            </label>
            <button className="gf-primary gf-inline-primary" disabled={loading} onClick={() => changeMap(map)}>
              {loading ? 'A executar...' : 'Mudar'}
            </button>
          </div>
        </section>

        <section className="gf-cs2-panel">
          <div className="gf-cs2-panel-title">
            <Gamepad2 size={18} />
            <div>
              <span>Servidor</span>
              <strong>Comandos rapidos</strong>
            </div>
          </div>

          <div className="gf-command-grid">
            {QUICK_COMMANDS.map(({ label, icon: Icon, command: nextCommand }) => (
              <button key={label} disabled={loading} onClick={() => label === 'Players' ? showPlayers() : sendCommand(nextCommand, label)}>
                <Icon size={16} />
                {label}
              </button>
            ))}
          </div>
        </section>

        <section className="gf-cs2-panel gf-danger-panel">
          <div className="gf-cs2-panel-title">
            <ShieldAlert size={18} />
            <div>
              <span>Jogadores</span>
              <strong>Kick e ban</strong>
            </div>
          </div>

          <div className="gf-form-grid gf-player-form">
            <label className="gf-field">
              <span>UserID / SteamID / Nome</span>
              <input
                value={selectedPlayer?.name || target}
                onChange={(event) => {
                  setSelectedPlayer(null);
                  setTarget(event.target.value);
                }}
                placeholder="Seleciona um jogador na lista"
              />
            </label>
            <label className="gf-field">
              <span>Minutos de ban</span>
              <input type="number" min="0" value={banMinutes} onChange={(event) => setBanMinutes(event.target.value)} />
            </label>
            <label className="gf-field gf-wide">
              <span>Motivo</span>
              <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Motivo visivel no comando" />
            </label>
          </div>

          <div className="gf-danger-actions">
            <button disabled={loading} onClick={showPlayers}>
              <Users size={16} /> Ver jogadores
            </button>
            <button disabled={loading} onClick={() => runPlayerAction('kick')}>
              <UserMinus size={16} /> Kick
            </button>
            <button disabled={loading} onClick={() => runPlayerAction('ban')}>
              <Ban size={16} /> Ban
            </button>
          </div>

          <div className="gf-player-list">
            {players.map((player) => (
              <button
                key={player.key}
                className={selectedPlayer?.key === player.key ? 'active' : ''}
                onClick={() => {
                  setSelectedPlayer(player);
                  setTarget(player.name);
                }}
              >
                {player.name}
              </button>
            ))}
            {!players.length && <span>{playersOutput}</span>}
          </div>

          {players.length > 0 && <p className="gf-player-hint">{playersOutput}</p>}
        </section>

        <section className="gf-cs2-panel">
          <div className="gf-cs2-panel-title">
            <Play size={18} />
            <div>
              <span>MatchZy / PCW</span>
              <strong>Controlo competitivo</strong>
            </div>
          </div>

          <div className="gf-command-grid">
            {MATCHZY_COMMANDS.map((item) => (
              <button key={item.label} disabled={loading} onClick={() => sendCommand(item.command, item.label)}>
                {item.label}
              </button>
            ))}
          </div>
        </section>

        <section className="gf-cs2-panel gf-cs2-panel-wide">
          <div className="gf-cs2-panel-title">
            <Terminal size={18} />
            <div>
              <span>Comando manual</span>
              <strong>Executar comando direto</strong>
            </div>
          </div>

          <div className="gf-inline-control">
            <label className="gf-field">
              <span>Comando</span>
              <input
                value={command}
                onChange={(event) => setCommand(event.target.value)}
                placeholder="say teste | changelevel de_dust2 | css_forceunpause"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') sendCommand();
                }}
              />
            </label>
            <button className="gf-primary gf-inline-primary" disabled={loading} onClick={() => sendCommand()}>
              {loading ? 'A executar...' : 'Executar'}
            </button>
          </div>
        </section>
      </div>

      <pre className="gf-console gf-cs2-output">{output}</pre>
    </div>
  );
}
