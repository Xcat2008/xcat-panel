import React, { useEffect, useState } from 'react';
import { RefreshCw, Terminal, ShieldCheck, Zap, Cpu } from 'lucide-react';

const API_BASE = '/api';

export default function Cs2UpdatePanel({ token }) {
  const [status, setStatus] = useState(null);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);

  async function api(path, options = {}) {
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });

    const text = await res.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(text.slice(0, 300) || 'Resposta inválida da API');
    }

    if (!data.ok) throw new Error(data.error || 'Erro desconhecido');
    return data;
  }

  async function loadStatus() {
    try {
      const data = await api('/system/cs2-update-status');

      const logLines = String(data.log || '')
        .split('\n')
        .filter(Boolean);

      setStatus({
        buildLocal: data.buildLocal || 'unknown',
        lastLine: logLines.length ? logLines[logLines.length - 1] : 'Sem atividade recente.'
      });

      setLogs(logLines);
    } catch (err) {
      setLogs(prev => [...prev.slice(-80), `[UI] ${err.message}`]);
    }
  }

  async function startUpdate() {
    if (!confirm('Executar verificação/update CS2 agora? Se houver update, os servidores CS2 online poderão ser reiniciados.')) return;

    setLoading(true);

    try {
      await api('/system/cs2-update-run', { method: 'POST' });
      await loadStatus();
    } catch (err) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!token) return;

    loadStatus();

    const interval = setInterval(loadStatus, 5000);
    return () => clearInterval(interval);
  }, [token]);

  return (
    <section className="gf-detail-card" style={{ marginBottom: 18 }}>
      <div className="gf-section-title" style={{ marginBottom: 18 }}>
        <div>
          <p className="gf-kicker">Game Updates</p>
          <h3>CS2 Auto-Update Center</h3>
          <p style={{ color: 'rgba(226,232,240,.72)', marginTop: 8, maxWidth: 820 }}>
            Verifica a build Steam e mantém a biblioteca CS2 partilhada atualizada. Cada servidor tem pasta, portas, configuração e overlay próprios.
          </p>
        </div>
      </div>

      <div className="gf-detail-grid" style={{ marginBottom: 18 }}>
        <div className="gf-detail-card">
          <span><ShieldCheck size={15} /> Estado</span>
          <strong>{loading ? 'A verificar...' : 'Pronto'}</strong>
        </div>

        <div className="gf-detail-card">
          <span><Cpu size={15} /> Build local</span>
          <strong>{status?.buildLocal || 'unknown'}</strong>
        </div>

        <div className="gf-detail-card">
          <span><ShieldCheck size={15} /> Modelo</span>
          <strong>Library + overlay</strong>
        </div>

        <div className="gf-detail-card">
          <span><Zap size={15} /> Última ação</span>
          <strong style={{ fontSize: 14, lineHeight: 1.4 }}>{status?.lastLine || 'Sem atividade recente.'}</strong>
        </div>
      </div>

      <div className="gf-modal-actions" style={{ marginBottom: 18 }}>
        <button className="gf-primary" disabled={loading} onClick={startUpdate}>
          <RefreshCw size={16} className={loading ? 'spin' : ''} />
          {loading ? 'A executar...' : 'Verificar / atualizar CS2 agora'}
        </button>
      </div>

      <div className="gf-detail-card">
        <span><Terminal size={15} /> Logs do auto-update</span>
        <pre className="gf-console" style={{ minHeight: 320, marginTop: 14 }}>
          {logs.length ? logs.join('\n') : 'Sem logs disponíveis.'}
        </pre>
      </div>
    </section>
  );
}
