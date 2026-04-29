import React, { useEffect, useState } from 'react';

const API_URL = '/api';

export default function GameModesPanel({ serverId, token }) {
  const [modes, setModes] = useState([]);
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(false);

  async function api(path, options = {}) {
    const res = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });

    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Erro');
    return data;
  }

  async function loadModes() {
    try {
      const data = await api(`/servers/${serverId}/game-modes`);
      setModes(data.items || []);
      setState(data.state || null);
    } catch (err) {
      console.error(err);
    }
  }

  async function applyMode(modeId) {
    if (!confirm(`Aplicar modo "${modeId}"?`)) return;

    setLoading(true);
    try {
      await api(`/servers/${serverId}/game-modes/apply`, {
        method: 'POST',
        body: JSON.stringify({ modeId })
      });
      await loadModes();
    } catch (err) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (serverId && token) loadModes();
  }, [serverId, token]);

  return (
    <div>
      <div className="gf-section-title" style={{ marginBottom: 16 }}>
        <div>
          <p className="gf-kicker">Game Modes</p>
          <h3>Modos do Servidor</h3>
        </div>
      </div>

      <div className="gf-detail-grid">
        {modes.map((mode) => (
          <div key={mode.id} className="gf-detail-card">
            <span>{mode.category}</span>
            <strong>{mode.name}</strong>

            <p style={{ fontSize: 13, opacity: 0.7, marginTop: 6 }}>
              {mode.description}
            </p>

            <div style={{ marginTop: 10 }}>
              {mode.active && (
                <div style={{ color: '#22c55e', fontWeight: 'bold' }}>
                  ● Ativo
                </div>
              )}

              {!mode.canApply && (
                <div style={{ color: '#ef4444', fontSize: 12 }}>
                  {mode.unavailableReason}
                </div>
              )}
            </div>

            <div className="gf-actions" style={{ marginTop: 12 }}>
              <button
                disabled={!mode.canApply || loading}
                onClick={() => applyMode(mode.id)}
              >
                {mode.active ? 'Ativo' : 'Aplicar'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
