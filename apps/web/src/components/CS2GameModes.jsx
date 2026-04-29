import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Gamepad2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Star,
  Trash2,
  Upload
} from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || '/api';

const DEFAULT_SETTINGS = {
  competitive: { maxPlayers: 11, botQuota: 0, tvSlots: 1 },
  aim: { maxPlayers: 16, botQuota: 0, tvSlots: 1 },
  fun: { maxPlayers: 18, botQuota: 0, tvSlots: 1 },
  gungame: { maxPlayers: 18, botQuota: 0, tvSlots: 1 },
  retakes: { maxPlayers: 11, botQuota: 0, tvSlots: 1 }
};

export default function CS2GameModes({ serverId, token }) {
  const [modes, setModes] = useState([]);
  const [maps, setMaps] = useState({});
  const [activeMode, setActiveMode] = useState('');
  const [selectedModeId, setSelectedModeId] = useState('');
  const [loading, setLoading] = useState(false);
  const [newMap, setNewMap] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);

  const authHeaders = { Authorization: `Bearer ${token}` };
  const jsonHeaders = { ...authHeaders, 'Content-Type': 'application/json' };

  const selectedMode = useMemo(
    () => modes.find((mode) => mode.id === selectedModeId) || modes[0],
    [modes, selectedModeId]
  );

  function normalizeWorkshopInput(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (raw.startsWith('workshop:')) return raw;

    const match = raw.match(/[?&]id=(\d+)/) || raw.match(/(\d{8,})/);
    if (match) return `workshop:${match[1]}`;

    return raw;
  }

  function workshopId(map) {
    return String(map || '').startsWith('workshop:')
      ? String(map).replace('workshop:', '').trim()
      : '';
  }

  function modeDefaults(mode) {
    return {
      mapPool: mode?.mapPool || [],
      defaultMap: mode?.defaultMap || '',
      mapLabels: {},
      mapMeta: {},
      rotation: { enabled: true, mode: 'sequential' },
      settings: DEFAULT_SETTINGS[mode?.id] || mode?.defaultSettings || { maxPlayers: 12, botQuota: 0, tvSlots: 1 },
      configText: ''
    };
  }

  function getModeData(mode) {
    if (!mode) return modeDefaults(mode);

    const defaults = modeDefaults(mode);
    const custom = maps[mode.id] || {};

    return {
      mapPool: custom.mapPool?.length ? custom.mapPool : defaults.mapPool,
      defaultMap: custom.defaultMap || defaults.defaultMap,
      mapLabels: custom.mapLabels || {},
      mapMeta: custom.mapMeta || {},
      rotation: { ...defaults.rotation, ...(custom.rotation || {}) },
      settings: { ...defaults.settings, ...(custom.settings || {}) },
      configText: typeof custom.configText === 'string' ? custom.configText : ''
    };
  }

  function displayName(map, data) {
    return data.mapLabels?.[map] || data.mapMeta?.[map]?.title || map;
  }

  async function fetchWorkshopInfo(mapValue) {
    const id = workshopId(mapValue);
    if (!id) return null;

    try {
      const data = await fetch(`${API_URL}/workshop/${id}`, { headers: authHeaders }).then((r) => r.json());
      if (!data.ok) return null;

      return {
        id,
        title: data.title || `Workshop ${id}`,
        previewUrl: data.previewUrl || '',
        creator: data.creator || ''
      };
    } catch {
      return null;
    }
  }

  async function load() {
    const [modesData, mapsData] = await Promise.all([
      fetch(`${API_URL}/servers/${serverId}/game-modes`, { headers: authHeaders }).then((r) => r.json()),
      fetch(`${API_URL}/servers/${serverId}/game-mode-maps`, { headers: authHeaders }).then((r) => r.json())
    ]);

    if (modesData.ok) {
      const items = modesData.items || [];
      setModes(items);
      setActiveMode(modesData.state?.activeMode || '');

      if (!selectedModeId && items[0]) {
        setSelectedModeId(modesData.state?.activeMode || items[0].id);
      }
    }

    if (mapsData.ok) {
      setMaps(mapsData.data || {});
    }
  }

  async function persist(modeId, payload) {
    const data = await fetch(`${API_URL}/servers/${serverId}/game-mode-maps`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        modeId,
        defaultMap: payload.defaultMap,
        mapPool: payload.mapPool,
        mapLabels: payload.mapLabels,
        mapMeta: payload.mapMeta,
        rotation: payload.rotation,
        settings: payload.settings,
        configText: payload.configText
      })
    }).then((r) => r.json());

    if (!data.ok) {
      alert(data.error || 'Erro ao guardar.');
      return false;
    }

    setMaps((current) => ({
      ...current,
      [modeId]: data.item
    }));

    return true;
  }

  async function addMap() {
    if (!selectedMode) return;

    const value = normalizeWorkshopInput(newMap);
    if (!value) return;

    const data = getModeData(selectedMode);

    if (data.mapPool.includes(value)) {
      alert('Esse mapa ja existe neste modo.');
      return;
    }

    setLoading(true);

    try {
      let label = newLabel.trim();
      const nextMeta = { ...data.mapMeta };

      if (value.startsWith('workshop:')) {
        const info = await fetchWorkshopInfo(value);
        if (info) {
          nextMeta[value] = info;
          if (!label) label = info.title;
        }
      }

      const ok = await persist(selectedMode.id, {
        ...data,
        mapPool: [...data.mapPool, value],
        defaultMap: data.defaultMap || value,
        mapLabels: {
          ...data.mapLabels,
          ...(label ? { [value]: label } : {})
        },
        mapMeta: nextMeta
      });

      if (ok) {
        setNewMap('');
        setNewLabel('');
      }
    } finally {
      setLoading(false);
    }
  }

  async function uploadMap() {
    if (!selectedMode || !selectedFile) return;

    const data = getModeData(selectedMode);
    setLoading(true);

    try {
      const form = new FormData();
      form.append('mapFile', selectedFile);

      const response = await fetch(`${API_URL}/servers/${serverId}/maps/upload`, {
        method: 'POST',
        headers: authHeaders,
        body: form
      });

      const text = await response.text();
      let uploadData;

      try {
        uploadData = JSON.parse(text);
      } catch {
        alert(`Erro no upload: resposta invalida da API (${response.status})`);
        return;
      }

      if (!uploadData.ok) {
        alert(uploadData.error || 'Erro ao fazer upload.');
        return;
      }

      const mapName = uploadData.mapName;
      const ok = await persist(selectedMode.id, {
        ...data,
        mapPool: [...new Set([...data.mapPool, mapName])],
        defaultMap: data.defaultMap || mapName,
        mapLabels: { ...data.mapLabels, [mapName]: mapName }
      });

      if (ok) {
        setSelectedFile(null);
        alert(`Mapa ${mapName} carregado.`);
      }
    } finally {
      setLoading(false);
    }
  }

  async function setDefault(map) {
    if (!selectedMode) return;

    setLoading(true);
    try {
      await persist(selectedMode.id, {
        ...getModeData(selectedMode),
        defaultMap: map
      });
    } finally {
      setLoading(false);
    }
  }

  async function removeMap(map) {
    if (!selectedMode) return;
    if (!confirm(`Remover ${map}?`)) return;

    const data = getModeData(selectedMode);
    const nextPool = data.mapPool.filter((item) => item !== map);
    const nextLabels = { ...data.mapLabels };
    const nextMeta = { ...data.mapMeta };

    delete nextLabels[map];
    delete nextMeta[map];

    setLoading(true);
    try {
      await persist(selectedMode.id, {
        ...data,
        mapPool: nextPool,
        defaultMap: data.defaultMap === map ? nextPool[0] || '' : data.defaultMap,
        mapLabels: nextLabels,
        mapMeta: nextMeta
      });
    } finally {
      setLoading(false);
    }
  }

  async function renameMap(map) {
    if (!selectedMode) return;

    const data = getModeData(selectedMode);
    const nextName = prompt('Nome visivel do mapa:', displayName(map, data));

    if (nextName === null) return;

    const nextLabels = { ...data.mapLabels };
    const clean = nextName.trim();

    if (clean && clean !== map) nextLabels[map] = clean;
    else delete nextLabels[map];

    setLoading(true);
    try {
      await persist(selectedMode.id, {
        ...data,
        mapLabels: nextLabels
      });
    } finally {
      setLoading(false);
    }
  }

  async function refreshMeta(map) {
    if (!selectedMode) return;

    const data = getModeData(selectedMode);
    const info = await fetchWorkshopInfo(map);

    if (!info) {
      alert('Nao consegui obter dados do Workshop.');
      return;
    }

    setLoading(true);
    try {
      await persist(selectedMode.id, {
        ...data,
        mapLabels: { ...data.mapLabels, [map]: info.title },
        mapMeta: { ...data.mapMeta, [map]: info }
      });
    } finally {
      setLoading(false);
    }
  }

  async function moveMap(map, direction) {
    if (!selectedMode) return;

    const data = getModeData(selectedMode);
    const index = data.mapPool.indexOf(map);
    const nextIndex = index + direction;

    if (index < 0 || nextIndex < 0 || nextIndex >= data.mapPool.length) return;

    const nextPool = [...data.mapPool];
    [nextPool[index], nextPool[nextIndex]] = [nextPool[nextIndex], nextPool[index]];

    setLoading(true);
    try {
      await persist(selectedMode.id, {
        ...data,
        mapPool: nextPool
      });
    } finally {
      setLoading(false);
    }
  }

  async function saveSettings(partial) {
    if (!selectedMode) return;

    const data = getModeData(selectedMode);

    setLoading(true);
    try {
      await persist(selectedMode.id, {
        ...data,
        settings: {
          ...data.settings,
          ...partial
        }
      });
    } finally {
      setLoading(false);
    }
  }

  async function saveRotation(partial) {
    if (!selectedMode) return;

    const data = getModeData(selectedMode);

    setLoading(true);
    try {
      await persist(selectedMode.id, {
        ...data,
        rotation: {
          ...data.rotation,
          ...partial
        }
      });
    } finally {
      setLoading(false);
    }
  }

  async function saveConfigText(value) {
    if (!selectedMode) return;

    setLoading(true);
    try {
      await persist(selectedMode.id, {
        ...getModeData(selectedMode),
        configText: value
      });
    } finally {
      setLoading(false);
    }
  }

  async function sendLiveCommand(command, label = 'Comando enviado.') {
    setLoading(true);

    try {
      const result = await fetch(`${API_URL}/servers/${serverId}/live-control/command`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ command })
      }).then((r) => r.json());

      if (!result.ok) {
        alert(result.error || 'Erro ao enviar comando.');
        return false;
      }

      alert(label);
      return true;
    } finally {
      setLoading(false);
    }
  }

  async function applyBotQuotaNow() {
    const quota = Number(data.settings?.botQuota || 0);
    await sendLiveCommand(
      `mp_autoteambalance 0; mp_limitteams 0; bot_quota_mode fill; bot_quota ${Math.max(0, quota)}`,
      `Bot quota aplicado: ${Math.max(0, quota)}`
    );
  }

  async function applyMode() {
    if (!selectedMode) return;

    const data = getModeData(selectedMode);
    const needsRestart = selectedMode.restartRequired || Number(data.settings?.maxPlayers) > 0;

    if (needsRestart && !confirm('Aplicar este modo pode reiniciar o servidor CS2 se mudar plugins ou slots. Continuar?')) {
      return;
    }

    setLoading(true);

    try {
      const result = await fetch(`${API_URL}/servers/${serverId}/game-modes/apply`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ modeId: selectedMode.id })
      }).then((r) => r.json());

      if (!result.ok) {
        alert(result.error || 'Erro ao aplicar modo.');
        return;
      }

      await load();
      alert(result.restarted ? 'Modo aplicado e servidor reiniciado.' : 'Modo aplicado.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (serverId && token) load();
  }, [serverId, token]);

  if (!selectedMode) {
    return <div className="gf-empty">A carregar modos...</div>;
  }

  const data = getModeData(selectedMode);

  return (
    <div>
      <div className="gf-section-title" style={{ marginBottom: 18 }}>
        <div>
          <p className="gf-kicker">CS2 Mode Control</p>
          <h3>Game Modes</h3>
          <p style={{ opacity: 0.72, marginTop: 6 }}>
            Modos, rotacao de mapas, slots e configs no mesmo painel.
          </p>
        </div>
        <Gamepad2 color="#67e8f9" />
      </div>

      <div className="gf-actions" style={{ marginBottom: 18, flexWrap: 'wrap' }}>
        {modes.map((mode) => (
          <button
            key={mode.id}
            className={selectedMode.id === mode.id ? 'active' : ''}
            onClick={() => setSelectedModeId(mode.id)}
          >
            {mode.name}
            {activeMode === mode.id ? ' - Ativo' : ''}
          </button>
        ))}
      </div>

      <div className="gf-detail-card" style={{ marginBottom: 18 }}>
        <span>{selectedMode.category || 'Mode'}</span>
        <strong style={{ fontSize: 24 }}>{selectedMode.name}</strong>
        <p style={{ marginTop: 8, opacity: 0.78 }}>{selectedMode.description}</p>

        <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {activeMode === selectedMode.id && (
            <span style={{ color: '#4ade80', fontWeight: 900 }}>ATIVO</span>
          )}

          {selectedMode.pluginProfile && Object.entries(selectedMode.pluginProfile).map(([plugin, enabled]) => (
            <span className="gf-mode-pill" key={plugin}>
              {plugin}: {enabled ? 'ON' : 'OFF'}
            </span>
          ))}
        </div>
      </div>

      <div className="gf-mode-layout">
        <div className="gf-detail-card">
          <div className="gf-section-title" style={{ marginBottom: 14 }}>
            <div>
              <p className="gf-kicker">Map Pool</p>
              <h3>Mapas deste modo</h3>
            </div>
          </div>

          <label className="gf-field" style={{ marginBottom: 16 }}>
            <span>Mapa default</span>
            <select
              value={data.defaultMap}
              onChange={(event) => setDefault(event.target.value)}
              disabled={loading || data.mapPool.length === 0}
            >
              {data.mapPool.length === 0 && <option value="">Sem mapas</option>}
              {data.mapPool.map((map) => (
                <option key={map} value={map}>{displayName(map, data)}</option>
              ))}
            </select>
          </label>

          <div className="gf-rotation-row">
            <label>
              <input
                type="checkbox"
                checked={Boolean(data.rotation.enabled)}
                onChange={(event) => saveRotation({ enabled: event.target.checked })}
                disabled={loading}
              />
              Rotacao ativa
            </label>

            <select
              value={data.rotation.mode || 'sequential'}
              onChange={(event) => saveRotation({ mode: event.target.value })}
              disabled={loading}
            >
              <option value="sequential">Sequencial</option>
              <option value="random">Aleatoria</option>
            </select>
          </div>

          <div style={{ display: 'grid', gap: 12 }}>
            {data.mapPool.map((map, index) => {
              const id = workshopId(map);
              const meta = data.mapMeta[map] || {};
              const name = displayName(map, data);

              return (
                <div
                  key={map}
                  className="gf-map-row"
                  style={{
                    gridTemplateColumns: meta.previewUrl ? '120px minmax(0, 1fr)' : 'minmax(0, 1fr)'
                  }}
                >
                  {meta.previewUrl && (
                    <img
                      src={meta.previewUrl}
                      alt={name}
                    />
                  )}

                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                      <div>
                        <strong style={{ fontSize: 18 }}>{name}</strong>
                        <p style={{ marginTop: 4, opacity: 0.55, fontSize: 12 }}>
                          {id ? `Workshop ID: ${id}` : map}
                        </p>
                      </div>

                      {map === data.defaultMap && (
                        <span style={{ color: '#facc15', fontSize: 12, fontWeight: 900 }}>DEFAULT</span>
                      )}
                    </div>

                    <div className="gf-actions" style={{ marginTop: 12, flexWrap: 'wrap' }}>
                      <button disabled={loading || index === 0} onClick={() => moveMap(map, -1)} title="Subir">
                        <ArrowUp size={13} />
                      </button>
                      <button disabled={loading || index === data.mapPool.length - 1} onClick={() => moveMap(map, 1)} title="Descer">
                        <ArrowDown size={13} />
                      </button>
                      <button disabled={loading} onClick={() => setDefault(map)}>
                        <Star size={13} /> Default
                      </button>
                      <button disabled={loading} onClick={() => renameMap(map)}>
                        <Pencil size={13} /> Nome
                      </button>
                      {id && (
                        <button disabled={loading} onClick={() => refreshMeta(map)}>
                          <RefreshCw size={13} /> Info
                        </button>
                      )}
                      <button disabled={loading} className="gf-btn-stop" onClick={() => removeMap(map)}>
                        <Trash2 size={13} /> Remover
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}

            {data.mapPool.length === 0 && (
              <div className="gf-empty">Este modo ainda nao tem mapas.</div>
            )}
          </div>
        </div>

        <aside className="gf-detail-card">
          <div className="gf-section-title" style={{ marginBottom: 14 }}>
            <div>
              <p className="gf-kicker">Settings</p>
              <h3>Configurar</h3>
            </div>
          </div>

          <div className="gf-mode-settings">
            <label className="gf-field">
              <span>Slots</span>
              <input
                type="number"
                min="1"
                max="64"
                value={data.settings.maxPlayers || ''}
                onChange={(event) => saveSettings({ maxPlayers: Number(event.target.value) })}
                disabled={loading}
              />
            </label>

            <label className="gf-field">
              <span>Bots</span>
              <input
                type="number"
                min="0"
                max="32"
                value={data.settings.botQuota || 0}
                onChange={(event) => saveSettings({ botQuota: Number(event.target.value) })}
                disabled={loading}
              />
            </label>

            <label className="gf-field">
              <span>TV slots</span>
              <input
                type="number"
                min="0"
                max="8"
                value={data.settings.tvSlots || 0}
                onChange={(event) => saveSettings({ tvSlots: Number(event.target.value) })}
                disabled={loading}
              />
            </label>
          </div>

          <p className="gf-hint">Alterar slots so entra em vigor quando aplicares o modo e o CS2 reiniciar.</p>

          <div className="gf-live-bot-panel">
            <p className="gf-kicker">Live bots</p>
            <div className="gf-live-bot-actions">
              <button
                disabled={loading}
                onClick={() => sendLiveCommand('mp_autoteambalance 0; mp_limitteams 0; bot_join_team CT; bot_add_ct', 'Bot CT adicionado.')}
              >
                + CT
              </button>
              <button
                disabled={loading}
                onClick={() => sendLiveCommand('mp_autoteambalance 0; mp_limitteams 0; bot_join_team T; bot_add_t', 'Bot T adicionado.')}
              >
                + T
              </button>
              <button disabled={loading} onClick={applyBotQuotaNow}>
                Quota
              </button>
              <button disabled={loading} className="gf-btn-stop" onClick={() => sendLiveCommand('bot_kick', 'Bots removidos.')}>
                Limpar
              </button>
            </div>
          </div>

          <label className="gf-field" style={{ marginTop: 14 }}>
            <span>Adicionar mapa / Workshop</span>
            <input
              value={newMap}
              onChange={(event) => setNewMap(event.target.value)}
              placeholder="de_mirage, 3706467974 ou link Steam"
              onKeyDown={(event) => {
                if (event.key === 'Enter') addMap();
              }}
            />
          </label>

          <label className="gf-field" style={{ marginTop: 12 }}>
            <span>Nome visivel opcional</span>
            <input
              value={newLabel}
              onChange={(event) => setNewLabel(event.target.value)}
              placeholder="ex: AWP Lego, Aim Redline..."
              onKeyDown={(event) => {
                if (event.key === 'Enter') addMap();
              }}
            />
          </label>

          <button disabled={loading} onClick={addMap} style={{ width: '100%', marginTop: 12 }}>
            <Plus size={14} /> Adicionar mapa
          </button>

          <label className="gf-file-input">
            <Upload size={14} />
            {selectedFile ? selectedFile.name : 'Escolher ficheiro .vpk/.bsp/.nav'}
            <input
              type="file"
              accept=".vpk,.bsp,.nav"
              style={{ display: 'none' }}
              onChange={(event) => setSelectedFile(event.target.files?.[0] || null)}
            />
          </label>

          <button disabled={loading || !selectedFile} onClick={uploadMap} style={{ width: '100%', marginTop: 12 }}>
            Upload mapa
          </button>

          <button
            className="gf-primary"
            disabled={loading || !selectedMode.canApply}
            onClick={applyMode}
            style={{ width: '100%', marginTop: 18 }}
          >
            {loading ? 'A processar...' : selectedMode.canApply ? 'Aplicar modo' : selectedMode.unavailableReason || 'Indisponivel'}
          </button>
        </aside>
      </div>

      <div className="gf-detail-card" style={{ marginTop: 18 }}>
        <div className="gf-section-title" style={{ marginBottom: 14 }}>
          <div>
            <p className="gf-kicker">CFG</p>
            <h3>Config extra deste modo</h3>
          </div>
          <button disabled={loading} onClick={() => saveConfigText(data.configText)}>
            <Save size={14} /> Guardar CFG
          </button>
        </div>

        <textarea
          className="gf-config-editor"
          value={data.configText}
          onChange={(event) => {
            const value = event.target.value;
            setMaps((current) => ({
              ...current,
              [selectedMode.id]: {
                ...data,
                configText: value
              }
            }));
          }}
          placeholder="Opcional. Se deixares vazio, o painel usa a config base deste modo."
        />
      </div>
    </div>
  );
}
