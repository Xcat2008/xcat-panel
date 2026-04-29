import React, { useState, useEffect } from 'react';

export default function ServerCard({ server, token, refresh }) {
  const [loading, setLoading] = useState(false);
  const [players, setPlayers] = useState([]);  // Estado para armazenar jogadores

  async function api(path, options = {}) {
    const res = await fetch(`/api${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });

    const data = await res.json();

    if (!data.ok) {
      throw new Error(data.error || 'Erro desconhecido');
    }

    return data;
  }

  // Função para buscar a lista de jogadores
  useEffect(() => {
    const fetchPlayers = async () => {
      const response = await api(`/servers/${server.id}/players`);
      setPlayers(response.data);  // Supondo que a resposta da API tem a lista de jogadores em "data"
    };

    if (server.id) fetchPlayers();  // Chama a função se o server.id existir
  }, [server.id]);

  async function handleStart() {
    if (loading) return;
    setLoading(true);
    try {
      await api(`/servers/${server.id}/start`, { method: 'POST' });
      await refresh();
    } catch (err) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleStop() {
    if (loading) return;
    setLoading(true);
    try {
      await api(`/servers/${server.id}/stop`, { method: 'POST' });
      await refresh();
    } catch (err) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleRestart() {
    if (loading) return;
    setLoading(true);
    try {
      await api(`/servers/${server.id}/restart`, { method: 'POST' });
      await refresh();
    } catch (err) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleOpen() {
    if (!server?.installConfig?.port) {
      alert('Porta não definida');
      return;
    }

    window.open(`http://${window.location.hostname}:${server.installConfig.port}`, '_blank');
  }

  // Função para expulsar jogador
  const kickPlayer = async (playerId) => {
    try {
      await api(`/servers/${server.id}/players/${playerId}/kick`, { method: 'POST' });
      alert('Jogador expulso com sucesso!');
      fetchPlayers();  // Atualiza a lista de jogadores
    } catch (error) {
      alert('Erro ao expulsar jogador');
    }
  };

  // Função para banir jogador
  const banPlayer = async (playerId) => {
    try {
      await api(`/servers/${server.id}/players/${playerId}/ban`, { method: 'POST' });
      alert('Jogador banido com sucesso!');
      fetchPlayers();  // Atualiza a lista de jogadores
    } catch (error) {
      alert('Erro ao banir jogador');
    }
  };

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur">
      <h3 className="text-lg font-bold">{server.name}</h3>

      <p className="text-sm text-slate-400">
        {server.game} • {server.node}
      </p>

      <p className="text-xs text-slate-500 mt-1">
        {server.path || `/opt/gameforge/servers/${server.id}`}
      </p>

      <div className="mt-4 flex gap-2">
        <button
          onClick={handleOpen}
          className="px-3 py-1 rounded bg-slate-700 hover:bg-slate-600"
        >
          Abrir
        </button>

        <button
          onClick={handleStart}
          disabled={loading}
          className="px-3 py-1 rounded bg-green-600 hover:bg-green-500"
        >
          Start
        </button>

        <button
          onClick={handleStop}
          disabled={loading}
          className="px-3 py-1 rounded bg-red-600 hover:bg-red-500"
        >
          Stop
        </button>

        <button
          onClick={handleRestart}
          disabled={loading}
          className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-500"
        >
          Restart
        </button>
      </div>

      {/* Listagem dos jogadores com opções de expulsar ou banir */}
      {players && players.length > 0 ? (
        <div>
          <h4 className="text-md font-bold mt-4">Jogadores Ativos</h4>
          <ul>
            {players.map((player) => (
              <li key={player.id} className="flex justify-between items-center mt-2">
                <span>{player.name}</span>
                <div>
                  <button
                    onClick={() => kickPlayer(player.id)}
                    className="px-2 py-1 bg-red-500 text-white rounded hover:bg-red-400 mr-2"
                  >
                    Kick
                  </button>
                  <button
                    onClick={() => banPlayer(player.id)}
                    className="px-2 py-1 bg-yellow-500 text-white rounded hover:bg-yellow-400"
                  >
                    Ban
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p>Nenhum jogador ativo no momento.</p>
      )}
    </div>
  );
}
