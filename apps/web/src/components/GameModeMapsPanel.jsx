import { useEffect, useState } from 'react';

const API_URL = import.meta.env.VITE_API_URL || '/api';

export default function GameModeMapsPanel({ serverId, token }) {
  const [modes, setModes] = useState([]);
  const [maps, setMaps] = useState({});
  const [selectedMode, setSelectedMode] = useState('');
  const [mapPool, setMapPool] = useState([]);
  const [mapLabels, setMapLabels] = useState({});
  const [mapMeta, setMapMeta] = useState({});
  const [defaultMap, setDefaultMap] = useState('');
  const [newMap, setNewMap] = useState('');
  const [newMapName, setNewMapName] = useState('');
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);

  const authHeaders = { Authorization: `Bearer ${token}` };
  const jsonHeaders = { ...authHeaders, 'Content-Type': 'application/json' };

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

  function displayName(map) {
    return mapLabels[map] || mapMeta[map]?.title || map;
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

  async function persist(modeId, nextDefault, nextPool, nextLabels = mapLabels, nextMeta = mapMeta, silent = false) {
    const data = await fetch(`${API_URL}/servers/${serverId}/game-mode-maps`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        modeId,
        defaultMap: nextDefault,
        mapPool: nextPool,
        mapLabels: nextLabels,
        mapMeta: nextMeta
      })
    }).then((r) => r.json());

    if (!data.ok) {
      alert(data.error || 'Erro ao guardar mapas.');
      return false;
    }

    setMaps((current) => ({
      ...current,
      [modeId]: {
        defaultMap: nextDefault,
        mapPool: nextPool,
        mapLabels: nextLabels,
        mapMeta: nextMeta
      }
    }));

    if (!silent) alert('Mapas guardados.');
    return true;
  }

  async function load() {
    const modesData = await fetch(`${API_URL}/servers/${serverId}/game-modes`, { headers: authHeaders }).then((r) => r.json());
    const mapsData = await fetch(`${API_URL}/servers/${serverId}/game-mode-maps`, { headers: authHeaders }).then((r) => r.json());

    const nextModes = modesData.ok ? modesData.items || [] : [];
    const nextMaps = mapsData.ok ? mapsData.data || {} : {};

    setModes(nextModes);
    setMaps(nextMaps);

    const modeToSelect = selectedMode || nextModes[0]?.id || '';
    if (modeToSelect) applyModeSelection(modeToSelect, nextModes, nextMaps);
  }

  function applyModeSelection(modeId, sourceModes = modes, sourceMaps = maps) {
    setSelectedMode(modeId);

    const mode = sourceModes.find((item) => item.id === modeId);
    const custom = sourceMaps[modeId] || {};

    const pool = custom.mapPool?.length ? custom.mapPool : mode?.mapPool || [];
    const def = custom.defaultMap || mode?.defaultMap || pool[0] || '';

    setMapPool(pool);
    setDefaultMap(def);
    setMapLabels(custom.mapLabels || {});
    setMapMeta(custom.mapMeta || {});
    setNewMap('');
    setNewMapName('');
    setSelectedFile(null);
  }

  async function addMap() {
    const value = normalizeWorkshopInput(newMap);
    if (!selectedMode || !value || mapPool.includes(value)) return;

    let label = newMapName.trim();
    const nextMeta = { ...mapMeta };

    if (value.startsWith('workshop:')) {
      const info = await fetchWorkshopInfo(value);
      if (info) {
        nextMeta[value] = info;
        if (!label) label = info.title;
      }
    }

    const nextPool = [...mapPool, value];
    const nextDefault = defaultMap || value;
    const nextLabels = {
      ...mapLabels,
      ...(label ? { [value]: label } : {})
    };

    setLoading(true);
    try {
      const ok = await persist(selectedMode, nextDefault, nextPool, nextLabels, nextMeta, true);
      if (!ok) return;

      setMapPool(nextPool);
      setDefaultMap(nextDefault);
      setMapLabels(nextLabels);
      setMapMeta(nextMeta);
      setNewMap('');
      setNewMapName('');
    } finally {
      setLoading(false);
    }
  }

  async function renameMap(map) {
    const nextName = prompt('Nome visível do mapa:', displayName(map));
    if (nextName === null) return;

    const clean = nextName.trim();
    const nextLabels = { ...mapLabels };

    if (clean && clean !== map) nextLabels[map] = clean;
    else delete nextLabels[map];

    setLoading(true);
    try {
      const ok = await persist(selectedMode, defaultMap, mapPool, nextLabels, mapMeta, true);
      if (!ok) return;
      setMapLabels(nextLabels);
    } finally {
      setLoading(false);
    }
  }

  async function removeMap(map) {
    if (!selectedMode) return;

    const nextPool = mapPool.filter((item) => item !== map);
    const nextDefault = defaultMap === map ? nextPool[0] || '' : defaultMap;
    const nextLabels = { ...mapLabels };
    const nextMeta = { ...mapMeta };

    delete nextLabels[map];
    delete nextMeta[map];

    setLoading(true);
    try {
      const ok = await persist(selectedMode, nextDefault, nextPool, nextLabels, nextMeta, true);
      if (!ok) return;

      setMapPool(nextPool);
      setDefaultMap(nextDefault);
      setMapLabels(nextLabels);
      setMapMeta(nextMeta);
    } finally {
      setLoading(false);
    }
  }

  async function setAndSaveDefault(map) {
    if (!selectedMode) return;

    setLoading(true);
    try {
      const ok = await persist(selectedMode, map, mapPool, mapLabels, mapMeta, true);
      if (!ok) return;
      setDefaultMap(map);
    } finally {
      setLoading(false);
    }
  }

  async function refreshWorkshopMeta(map) {
    const info = await fetchWorkshopInfo(map);
    if (!info) {
      alert('Não consegui obter dados do Workshop.');
      return;
    }

    const nextMeta = { ...mapMeta, [map]: info };
    const nextLabels = { ...mapLabels, [map]: info.title };

    setLoading(true);
    try {
      const ok = await persist(selectedMode, defaultMap, mapPool, nextLabels, nextMeta, true);
      if (!ok) return;

      setMapMeta(nextMeta);
      setMapLabels(nextLabels);
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    if (!selectedMode) return;

    setLoading(true);
    try {
      await persist(selectedMode, defaultMap, mapPool, mapLabels, mapMeta, false);
    } finally {
      setLoading(false);
    }
  }

  async function uploadMap(file) {
    if (!file || !selectedMode) return;

    setUploading(true);

    try {
      const form = new FormData();
      form.append('mapFile', file);

      const response = await fetch(`${API_URL}/servers/${serverId}/maps/upload`, {
        method: 'POST',
        headers: authHeaders,
        body: form
      });

      const text = await response.text();
      let data;

      try {
        data = JSON.parse(text);
      } catch {
        console.error('Resposta upload não JSON:', text);
        alert(`Erro no upload: resposta inválida da API (${response.status})`);
        return;
      }

      if (!data.ok) {
        alert(data.error || 'Erro ao fazer upload.');
        return;
      }

      const mapName = data.mapName;
      const nextPool = [...new Set([...mapPool, mapName])];
      const nextDefault = defaultMap || mapName;
      const nextLabels = { ...mapLabels, [mapName]: mapName };
      const nextMeta = { ...mapMeta };

      const ok = await persist(selectedMode, nextDefault, nextPool, nextLabels, nextMeta, true);
      if (!ok) return;

      setMapPool(nextPool);
      setDefaultMap(nextDefault);
      setMapLabels(nextLabels);
      setMapMeta(nextMeta);
      setSelectedFile(null);

      alert(`Mapa ${mapName} carregado e guardado na pool.`);
    } finally {
      setUploading(false);
    }
  }

  useEffect(() => {
    if (serverId && token) load();
  }, [serverId, token]);

  return (
    <div>
      <div className="gf-section-title" style={{ marginBottom: 16 }}>
        <div>
          <p className="gf-kicker">Map Pools</p>
          <h3>Mapas por modo</h3>
          <p style={{ marginTop: 6, opacity: 0.7 }}>
            Preview Steam, nome grande e ID técnico separado.
          </p>
        </div>
      </div>

      <div className="gf-actions" style={{ marginBottom: 18, flexWrap: 'wrap' }}>
        {modes.map((mode) => (
          <button
            key={mode.id}
            className={selectedMode === mode.id ? 'active' : ''}
            onClick={() => applyModeSelection(mode.id)}
          >
            {mode.name}
          </button>
        ))}
      </div>

      {selectedMode && (
        <>
          <div className="gf-form-grid">
            <label className="gf-field">
              <span>Mapa default</span>
              <select value={defaultMap} onChange={(e) => setAndSaveDefault(e.target.value)}>
                <option value="">Escolher mapa</option>
                {mapPool.map((map) => (
                  <option key={map} value={map}>{displayName(map)}</option>
                ))}
              </select>
            </label>

            <label className="gf-field">
              <span>Adicionar mapa / Workshop</span>
              <input
                value={newMap}
                onChange={(e) => setNewMap(e.target.value)}
                placeholder="de_mirage, 3706467974 ou link Steam Workshop..."
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addMap();
                }}
              />
            </label>

            <label className="gf-field">
              <span>Nome visível opcional</span>
              <input
                value={newMapName}
                onChange={(e) => setNewMapName(e.target.value)}
                placeholder="Preenche só se quiseres substituir o nome Steam"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addMap();
                }}
              />
            </label>

            <label className="gf-field">
              <span>Upload de mapa (.vpk / .bsp / .nav)</span>
              <input
                type="file"
                accept=".vpk,.bsp,.nav"
                onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
              />
            </label>
          </div>

          <div className="gf-actions" style={{ marginTop: 12 }}>
            <button disabled={loading} onClick={addMap}>Adicionar mapa</button>
            <button disabled={!selectedFile || uploading} onClick={() => uploadMap(selectedFile)}>
              {uploading ? 'A carregar...' : 'Upload mapa'}
            </button>
            <button className="gf-primary" disabled={loading || uploading} onClick={save}>
              {loading ? 'A guardar...' : 'Guardar mapas'}
            </button>
          </div>

          <div className="gf-detail-grid" style={{ marginTop: 18 }}>
            {mapPool.map((map) => {
              const meta = mapMeta[map] || {};
              const id = workshopId(map);

              return (
                <div key={map} className="gf-detail-card" style={{ overflow: 'hidden' }}>
                  {meta.previewUrl && (
                    <img
                      src={meta.previewUrl}
                      alt={displayName(map)}
                      style={{
                        width: '100%',
                        height: 120,
                        objectFit: 'cover',
                        borderRadius: 14,
                        marginBottom: 12,
                        border: '1px solid rgba(255,255,255,0.1)'
                      }}
                    />
                  )}

                  <span>{map === defaultMap ? 'Default' : id ? 'Workshop' : 'Mapa'}</span>
                  <strong style={{ fontSize: 18 }}>{displayName(map)}</strong>

                  <p style={{ marginTop: 6, opacity: 0.65, fontSize: 12 }}>
                    {id ? `Workshop ID: ${id}` : map}
                  </p>

                  <div className="gf-actions" style={{ marginTop: 12, flexWrap: 'wrap' }}>
                    <button disabled={loading} onClick={() => setAndSaveDefault(map)}>Definir default</button>
                    <button disabled={loading} onClick={() => renameMap(map)}>Renomear</button>
                    {id && <button disabled={loading} onClick={() => refreshWorkshopMeta(map)}>Atualizar info</button>}
                    <button disabled={loading} className="gf-btn-stop" onClick={() => removeMap(map)}>Remover</button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
