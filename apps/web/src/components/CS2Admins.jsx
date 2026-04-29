import { useEffect, useState } from 'react';

const API_URL = import.meta.env.VITE_API_URL || '/api';

function normalizeAdmins(value) {
  if (Array.isArray(value)) return value;

  if (value && typeof value === 'object') {
    return Object.entries(value).map(([key, admin]) => ({
      key,
      Name: key,
      SteamID: admin.identity || admin.SteamID || admin.steamId || key,
      Flags: admin.flags || admin.Flags || []
    }));
  }

  return [];
}

export default function CS2Admins({ serverId, token }) {
  const [admins, setAdmins] = useState([]);
  const [steamId, setSteamId] = useState('');
  const [name, setName] = useState('');
  const [flags, setFlags] = useState('@css/root');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const headers = { Authorization: `Bearer ${token}` };

  async function readJson(response) {
    const text = await response.text();

    try {
      return JSON.parse(text);
    } catch {
      throw new Error(text.slice(0, 220) || 'Resposta inválida da API');
    }
  }

  async function loadAdmins() {
    setError('');

    try {
      const response = await fetch(`${API_URL}/cs2/admins/${serverId}`, { headers });
      const data = await readJson(response);

      if (!data.ok) {
        setError(data.error || 'Erro ao carregar admins');
        setAdmins([]);
        return;
      }

      setAdmins(normalizeAdmins(data.admins));
    } catch (err) {
      setError(err.message || 'Erro ao carregar admins');
      setAdmins([]);
    }
  }

  async function addAdmin(event) {
    event.preventDefault();

    if (!steamId.trim()) {
      alert('SteamID obrigatório');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch(`${API_URL}/cs2/admins/${serverId}`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          SteamID: steamId.trim(),
          Name: name.trim() || steamId.trim(),
          Flags: flags.trim() || '@css/root'
        })
      });

      const data = await readJson(response);

      if (!data.ok) {
        setError(data.error || 'Erro ao adicionar admin');
        return;
      }

      setSteamId('');
      setName('');
      setFlags('@css/root');
      await loadAdmins();
    } catch (err) {
      setError(err.message || 'Erro ao adicionar admin');
    } finally {
      setLoading(false);
    }
  }

  async function removeAdmin(admin) {
    const id = admin?.SteamID || admin?.identity || admin?.steamId || admin?.key;

    if (!id) {
      alert('Não foi possível identificar este admin');
      return;
    }

    if (!confirm(`Remover admin ${id}?`)) return;

    setLoading(true);
    setError('');

    try {
      const response = await fetch(`${API_URL}/cs2/admins/${serverId}/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers
      });

      const data = await readJson(response);

      if (!data.ok) {
        setError(data.error || 'Erro ao remover admin');
        return;
      }

      await loadAdmins();
    } catch (err) {
      setError(err.message || 'Erro ao remover admin');
    } finally {
      setLoading(false);
    }
  }

  function getAdminName(admin) {
    return admin?.Name || admin?.name || admin?.key || 'Admin';
  }

  function getAdminSteam(admin) {
    return admin?.SteamID || admin?.identity || admin?.steamId || '-';
  }

  function getAdminFlags(admin) {
    const value = admin?.Flags || admin?.flags || [];
    if (Array.isArray(value)) return value.join(', ');
    return String(value || '-');
  }

  useEffect(() => {
    loadAdmins();
  }, [serverId]);

  return (
    <div>
      <div className="gf-section-title" style={{ marginBottom: 16 }}>
        <div>
          <p className="gf-kicker">CS2 Admin Control</p>
          <h3>Admins do servidor</h3>
        </div>
      </div>

      {error && <div className="gf-auth-error" style={{ marginBottom: 16 }}>{error}</div>}

      <form className="gf-form-grid" onSubmit={addAdmin}>
        <label className="gf-field">
          <span>Nome</span>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex: Xcat" />
        </label>

        <label className="gf-field">
          <span>SteamID</span>
          <input value={steamId} onChange={(event) => setSteamId(event.target.value)} placeholder="STEAM_1:1:16132305" />
        </label>

        <label className="gf-field">
          <span>Permissões</span>
          <select value={flags} onChange={(event) => setFlags(event.target.value)}>
            <option value="@css/root">Root / Tudo</option>
            <option value="@css/admin">Admin</option>
            <option value="@css/ban">Ban</option>
            <option value="@css/kick">Kick</option>
          </select>
        </label>

        <button className="gf-primary" disabled={loading}>
          {loading ? 'A guardar...' : 'Adicionar admin'}
        </button>
      </form>

      <div className="gf-detail-grid" style={{ marginTop: 18 }}>
        {admins.length === 0 && <div className="gf-empty">Ainda não existem admins configurados.</div>}

        {admins.map((admin, index) => (
          <div className="gf-detail-card" key={`${getAdminSteam(admin)}-${index}`}>
            <span>{getAdminName(admin)}</span>
            <strong>{getAdminSteam(admin)}</strong>
            <p style={{ marginTop: 8 }}>Permissões: {getAdminFlags(admin)}</p>

            <div className="gf-actions" style={{ marginTop: 12 }}>
              <button className="gf-btn-stop" type="button" onClick={() => removeAdmin(admin)}>
                Remover
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
