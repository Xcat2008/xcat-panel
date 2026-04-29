import { useEffect, useMemo, useState } from 'react';
import CS2Admins from './components/CS2Admins.jsx';
import CS2LiveControl from './components/CS2LiveControl.jsx';
import CS2GameModes from './components/CS2GameModes.jsx';
import Cs2UpdatePanel from './components/Cs2UpdatePanel.jsx';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Activity,
  Check,
  Cpu,
  Database,
  FileText,
  Folder,
  Gamepad2,
  HardDrive,
  LayoutDashboard,
  Lock,
  LogOut,
  Play,
  Power,
  Save,
  Server,
  Shield,
  Sparkles,
  Terminal,
  User,
  X
} from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || '/api';

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('O servidor demorou demasiado a responder. Tenta novamente.');
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function isLiveOnline(server) {
  return Boolean(server?.live?.online || server?.status === 'online');
}

function getDisplayStatus(server) {
  if (['starting', 'stopping', 'restarting'].includes(server?.status)) return server.status;
  return isLiveOnline(server) ? 'online' : 'offline';
}

function getServerProgress(server) {
  return server?.runtime?.progress || null;
}

function shouldShowServerProgress(progress, status) {
  if (!progress) return false;
  return ['starting', 'stopping', 'restarting'].includes(status) || progress.step === 'error';
}

function progressStatus(progress, fallbackStatus) {
  if (!progress) return fallbackStatus;
  if (progress.step === 'start') return 'starting';
  if (progress.step === 'stop') return 'stopping';
  if (progress.step === 'restart') return 'restarting';
  return fallbackStatus;
}

function getRamText(server) {
  if (server?.live?.ramMb > 0) return `${Math.round(server.live.ramMb)}MB`;
  return `${server?.resources?.ramMb || 0}MB`;
}

function getCpuText(server) {
  if (server?.live?.cpuPercent > 0) return `${Number(server.live.cpuPercent).toFixed(1)}%`;
  return `${server?.resources?.cpuLimit || 0}%`;
}

function getInitialRoute() {
  return window.location.hash.replace('#', '') || '/dashboard';
}

function App() {
  const [route, setRoute] = useState(getInitialRoute());
  const [token, setToken] = useState(localStorage.getItem('gameforge_token'));
  const [user, setUser] = useState(null);
  const [health, setHealth] = useState(null);
  const [catalog, setCatalog] = useState([]);
  const [servers, setServers] = useState([]);
  const [requests, setRequests] = useState([]);
  const [users, setUsers] = useState([]);
  const [storageRoots, setStorageRoots] = useState([]);
  const [storageDisks, setStorageDisks] = useState([]);
  const [activity, setActivity] = useState([]);
  const [selectedGame, setSelectedGame] = useState(null);
  const [selectedServer, setSelectedServer] = useState(null);
  const [installing, setInstalling] = useState(false);
  const [busyServerId, setBusyServerId] = useState(null);
  const [actionProgress, setActionProgress] = useState(null);
  const [authLoading, setAuthLoading] = useState(Boolean(token));

  function navigate(nextRoute) {
    window.location.hash = nextRoute;
    setRoute(nextRoute);
  }

  function authHeaders() {
    return { Authorization: `Bearer ${token}` };
  }

  async function api(path, options = {}) {
    const response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        ...(options.headers || {}),
        ...(token ? authHeaders() : {})
      }
    });

    if (response.status === 401) {
      logout();
      throw new Error('Sessão expirada');
    }

    return response.json();
  }

  async function load() {
    if (!token) return;

    const [healthRes, catalogRes, serversRes, requestsRes, activityRes] = await Promise.all([
      fetch(`${API_URL}/health`),
      api('/catalog'),
      api('/servers'),
      api('/requests'),
      api('/activity')
    ]);

    setHealth(await healthRes.json());
    setCatalog(catalogRes.items || []);

    const baseServers = serversRes.items || [];

    const serversWithLiveStats = await Promise.all(
      baseServers.map(async (server) => {
        try {
          const monitor = await api(`/monitor/${server.id}`);

          if (monitor.ok && monitor.item) {
            const transitional = ['starting', 'stopping', 'restarting'].includes(server.status);
            return {
              ...server,
              status: transitional ? server.status : monitor.item.online ? 'online' : 'offline',
              live: monitor.item
            };
          }

          return server;
        } catch {
          return server;
        }
      })
    );

    setServers(serversWithLiveStats);
    setRequests(requestsRes.items || []);
    setActivity(activityRes.items || []);

    if (user?.role === 'admin') {
      const [usersRes, storageRes, disksRes] = await Promise.all([
        api('/auth/users'),
        api('/storage/roots'),
        api('/storage/disks')
      ]);
      setUsers(usersRes.items || []);
      setStorageRoots(storageRes.items || []);
      setStorageDisks(disksRes.items || []);
    }
  }

  async function checkSession() {
    if (!token) {
      setAuthLoading(false);
      return;
    }

    try {
      const data = await api('/auth/me');
      setUser(data.user);
      await load();
    } catch {
      logout();
    } finally {
      setAuthLoading(false);
    }
  }

  async function login(email, password, twoFactorCode = '') {
    const response = await fetchWithTimeout(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, twoFactorCode })
    });

    const data = await response.json().catch(() => ({
      ok: false,
      error: 'Resposta inválida do servidor'
    }));

    if (!data.ok) {
      throw new Error(data.error || 'Login falhou');
    }

    if (data.requiresTwoFactor) {
      return { requiresTwoFactor: true };
    }

    localStorage.setItem('gameforge_token', data.token);
    setToken(data.token);
    setUser(data.user);
    navigate('/dashboard');

    return { ok: true };
  }

  async function register(payload) {
    const response = await fetch(`${API_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!data.ok) {
      throw new Error(data.error || 'Registo falhou');
    }

    return data.item;
  }

  async function forgotPassword(email) {
    const response = await fetch(`${API_URL}/auth/password/forgot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    return response.json();
  }

  async function resetPassword(payload) {
    const response = await fetch(`${API_URL}/auth/password/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return response.json();
  }

  function logout() {
    localStorage.removeItem('gameforge_token');
    setToken(null);
    setUser(null);
    setCatalog([]);
    setServers([]);
    setRequests([]);
    setUsers([]);
    setStorageRoots([]);
    setStorageDisks([]);
    setActivity([]);
    setSelectedGame(null);
    setSelectedServer(null);
    window.location.hash = '/login';
    setRoute('/login');
  }

  async function createRequest(game, config, ownerId = '') {
    setInstalling(true);

    try {
      const owner = users.find((item) => item.id === ownerId);
      const { storageRootId, ...cleanConfig } = config || {};
      await api(user?.role === 'admin' ? '/servers' : '/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          game: game.id,
          config: cleanConfig,
          ...(user?.role === 'admin' && storageRootId ? { storageRootId } : {}),
          ...(owner ? { ownerId: owner.id, ownerName: owner.name, ownerEmail: owner.email } : {})
        })
      });

      setSelectedGame(null);
      await load();
      navigate(user?.role === 'admin' ? '/servers' : '/requests');
    } finally {
      setInstalling(false);
    }
  }

  async function addStorageRoot(payload) {
    const result = await api('/storage/roots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!result.ok) {
      throw new Error(result.error || 'Erro ao adicionar destino');
    }

    await load();
  }

  async function prepareStorageDisk(payload) {
    const result = await api('/storage/disks/prepare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!result.ok) {
      throw new Error(result.error || 'Erro ao preparar disco');
    }

    await load();
  }

  async function beginTwoFactorSetup() {
    return api('/auth/2fa/setup', { method: 'POST' });
  }

  async function confirmTwoFactorSetup(code) {
    const result = await api('/auth/2fa/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    });

    if (result.user) setUser(result.user);
    return result;
  }

  async function disableTwoFactor(code) {
    const result = await api('/auth/2fa/disable', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    });

    if (result.user) setUser(result.user);
    return result;
  }

  async function approveRequest(id) {
    const result = await api(`/requests/${id}/approve`, { method: 'POST' });

    if (!result.ok) {
      alert(result.error || 'Erro ao aprovar pedido');
      return;
    }

    await load();
  }

  async function rejectRequest(id) {
    const result = await api(`/requests/${id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminNotes: 'Pedido rejeitado pelo administrador.' })
    });

    if (!result.ok) {
      alert(result.error || 'Erro ao rejeitar pedido');
      return;
    }

    await load();
  }

  async function deleteRequest(id) {
    if (!confirm('Apagar este pedido?')) return;

    const result = await api(`/requests/${id}`, { method: 'DELETE' });

    if (!result.ok) {
      alert(result.error || 'Erro ao apagar pedido');
      return;
    }

    await load();
  }

  async function serverAction(id, action) {
    const labels = {
      start: 'A iniciar servidor',
      stop: 'A parar servidor',
      restart: 'A reiniciar servidor'
    };
    const wasPanelOpen = selectedServer?.id === id;
    const startedAt = Date.now();

    setBusyServerId(id);
    setActionProgress({
      id,
      label: labels[action] || 'A processar',
      step: action,
      percent: action === 'stop' ? 50 : 35
    });

    try {
      const result = await api(`/servers/${id}/${action}`, { method: 'POST' });

      if (!result.ok) {
        alert(result.error || 'Erro na ação do servidor');
        return;
      }

      await load();

      const updated = await api(`/servers/${id}`);
      if (wasPanelOpen && updated.item) setSelectedServer(updated.item);
    } finally {
      const remainingMs = Math.max(0, 1800 - (Date.now() - startedAt));
      if (remainingMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, remainingMs));
      }
      setBusyServerId(null);
      setActionProgress(null);
    }
  }

  async function deleteServer(id) {
    if (!confirm('Apagar este servidor e todos os ficheiros?')) return;

    const result = await api(`/servers/${id}`, { method: 'DELETE' });

    if (!result.ok) {
      alert(result.error || 'Erro ao apagar servidor');
      return;
    }

    setSelectedServer(null);
    await load();
  }

  async function updateServerConfig(id, payload) {
    const result = await api(`/servers/${id}/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!result.ok) {
      alert(result.error || 'Erro ao guardar configurações');
      return;
    }

    await load();

    const updated = await api(`/servers/${id}`);
    if (updated.item) setSelectedServer(updated.item);
  }

  async function reinstallServer(id) {
    if (!confirm('Reinstalar este servidor? Isto vai repor os ficheiros base.')) return;

    const result = await api(`/servers/${id}/reinstall`, { method: 'POST' });

    if (!result.ok) {
      alert(result.error || 'Erro ao reinstalar servidor');
      return;
    }

    await load();

    const updated = await api(`/servers/${id}`);
    if (updated.item) setSelectedServer(updated.item);
  }

  async function assignServerOwner(id, ownerId) {
    const owner = users.find((item) => item.id === ownerId);
    const result = await api(`/servers/${id}/owner`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(owner ? {
        ownerId: owner.id,
        ownerName: owner.name,
        ownerEmail: owner.email
      } : {
        ownerId: null,
        ownerName: 'Sem cliente',
        ownerEmail: ''
      })
    });

    if (!result.ok) {
      alert(result.error || 'Erro ao atribuir servidor');
      return;
    }

    await load();
    const updated = await api(`/servers/${id}`);
    if (updated.item) setSelectedServer(updated.item);
  }

  async function createClient(payload) {
    const result = await api('/auth/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!result.ok) {
      alert(result.error || 'Erro ao criar cliente');
      return;
    }

    await load();
  }

  async function deleteClient(id) {
    if (!confirm('Apagar este cliente?')) return;

    const result = await api(`/auth/users/${id}`, { method: 'DELETE' });

    if (!result.ok) {
      alert(result.error || 'Erro ao apagar cliente');
      return;
    }

    await load();
  }

  async function updateClientStatus(id, status) {
    const result = await api(`/auth/users/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });

    if (!result.ok) {
      alert(result.error || 'Erro ao atualizar cliente');
      return;
    }

    await load();
  }

  async function updateClientRole(id, role) {
    const result = await api(`/auth/users/${id}/role`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role })
    });

    if (!result.ok) {
      alert(result.error || 'Erro ao alterar tipo de conta');
      return;
    }

    await load();
  }

  useEffect(() => {
    checkSession();

    const listener = () => setRoute(getInitialRoute());
    window.addEventListener('hashchange', listener);

    return () => window.removeEventListener('hashchange', listener);
  }, []);

  useEffect(() => {
    if (!token || !user) return undefined;

    let cancelled = false;
    let inFlight = false;

    async function refresh() {
      if (cancelled || inFlight) return;
      inFlight = true;

      try {
        await load();
      } finally {
        inFlight = false;
      }
    }

    refresh();
    const interval = setInterval(refresh, 5000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [token, user]);

  if (authLoading) {
    return (
      <main className="gf-app gf-login-wrap">
        <motion.div className="gf-login-card" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <div className="gf-logo gf-login-logo"><Gamepad2 /></div>
          <h1>Xcat Control</h1>
          <p>A validar sessão...</p>
        </motion.div>
      </main>
    );
  }

  if (!token || !user || route === '/login') {
    return <LoginPage onLogin={login} onRegister={register} onForgotPassword={forgotPassword} onResetPassword={resetPassword} />;
  }

  return (
    <main className="gf-app">
      <div className="gf-shell">
        <Sidebar user={user} route={route} navigate={navigate} logout={logout} />

        <section className="gf-main">
          <TopHero health={health} user={user} />

          {route === '/dashboard' && (
            <DashboardPage
              user={user}
              servers={servers}
              catalog={catalog}
              requests={requests}
              activity={activity}
              navigate={navigate}
            />
          )}

          {route === '/catalog' && (
            <CatalogPage
              user={user}
              catalog={catalog}
              onConfigure={setSelectedGame}
            />
          )}

          {route === '/requests' && (
            <RequestsPage
              user={user}
              requests={requests}
              onApprove={approveRequest}
              onReject={rejectRequest}
              onDelete={deleteRequest}
              navigate={navigate}
            />
          )}

          {route === '/servers' && (
            <ServersPage
              user={user}
              servers={servers}
              onOpen={setSelectedServer}
              onAction={serverAction}
              onDelete={deleteServer}
              onReinstall={reinstallServer}
              busyServerId={busyServerId}
              actionProgress={actionProgress}
              navigate={navigate}
            />
          )}

          {route === '/activity' && user.role === 'admin' && (
            <ActivityPage activity={activity} />
          )}

          {route === '/clients' && user.role === 'admin' && (
            <ClientsPage
              users={users}
              servers={servers}
              requests={requests}
              onCreate={createClient}
              onStatus={updateClientStatus}
              onRole={updateClientRole}
              onDelete={deleteClient}
            />
          )}

          {route === '/security' && (
            <SecurityPage
              user={user}
              storageRoots={storageRoots}
              storageDisks={storageDisks}
              onAddStorageRoot={addStorageRoot}
              onPrepareStorageDisk={prepareStorageDisk}
              onBeginTwoFactorSetup={beginTwoFactorSetup}
              onConfirmTwoFactorSetup={confirmTwoFactorSetup}
              onDisableTwoFactor={disableTwoFactor}
            />
          )}
        </section>
      </div>

      <AnimatePresence>
        {selectedGame && (
          <InstallWizard
            user={user}
            game={selectedGame}
            onClose={() => setSelectedGame(null)}
            onSubmit={createRequest}
            installing={installing}
            users={users}
            storageRoots={storageRoots}
          />
        )}

        {selectedServer && (
          <ServerPanel
            user={user}
            server={selectedServer}
            token={token}
            onClose={() => setSelectedServer(null)}
            onAction={serverAction}
            onDelete={deleteServer}
            onReinstall={reinstallServer}
            onUpdateConfig={updateServerConfig}
            onAssignOwner={assignServerOwner}
            users={users}
            busyServerId={busyServerId}
            actionProgress={actionProgress}
          />
        )}
      </AnimatePresence>
    </main>
  );
}

function LoginPage({ onLogin, onRegister, onForgotPassword, onResetPassword }) {
  const resetParams = new URLSearchParams((window.location.hash.split('?')[1] || ''));
  const resetToken = resetParams.get('reset') || '';
  const resetEmail = resetParams.get('email') || '';
  const [mode, setMode] = useState(resetToken ? 'reset' : 'login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState(resetEmail);
  const [password, setPassword] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [needsTwoFactor, setNeedsTwoFactor] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError('');
    setNotice('');
    setLoading(true);

    try {
      if (mode === 'forgot') {
        const result = await onForgotPassword(email);
        if (!result.ok) throw new Error(result.error || 'Erro ao pedir recuperação');
        setNotice('Se a conta existir, será enviado um link de recuperação.');
      } else if (mode === 'reset') {
        const result = await onResetPassword({ email, token: resetToken, password });
        if (!result.ok) throw new Error(result.error || 'Erro ao alterar password');
        setNotice('Password alterada. Já podes entrar.');
        setMode('login');
        setPassword('');
      } else if (mode === 'register') {
        await onRegister({ name, email, password });
        setNotice('Registo recebido. Um administrador vai validar o teu acesso.');
        setName('');
        setEmail('');
        setPassword('');
        setMode('login');
      } else {
        const result = await onLogin(email, password, twoFactorCode);
        if (result?.requiresTwoFactor) {
          setNeedsTwoFactor(true);
          setNotice('Introduz o código 2FA da tua aplicação.');
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="gf-app gf-login-wrap gf-login-stage">
      <section className="gf-login-showcase">
        <div className="gf-orbit-scene" aria-hidden="true">
          <div className="gf-orbit-core">
            <Server size={34} />
          </div>
          <div className="gf-orbit-ring ring-a" />
          <div className="gf-orbit-ring ring-b" />
          <div className="gf-orbit-node node-game"><Gamepad2 size={19} /></div>
          <div className="gf-orbit-node node-audio"><Activity size={19} /></div>
          <div className="gf-orbit-node node-db"><Database size={19} /></div>
          <div className="gf-eq-bars">
            <i /><i /><i /><i /><i /><i /><i />
          </div>
        </div>

        <p className="gf-kicker">Xcat Control System</p>
        <h1>Xcat Hosting OS</h1>
        <p>Plataforma privada para servidores de jogos, voz, áudio, ficheiros, consola, backups e automação live.</p>
        <div className="gf-login-stats">
          <span><strong>Game</strong> servers</span>
          <span><strong>Voice</strong> audio</span>
          <span><strong>Xcat</strong> design</span>
        </div>
      </section>

      <motion.form
        className="gf-login-card"
        onSubmit={submit}
        initial={{ opacity: 0, y: 28, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
      >
        <p className="gf-kicker">{mode === 'register' ? 'Novo acesso' : mode === 'forgot' || mode === 'reset' ? 'Recuperar acesso' : 'Acesso privado'}</p>

        <h1>{mode === 'register' ? 'Criar conta' : mode === 'forgot' ? 'Recuperar password' : mode === 'reset' ? 'Nova password' : 'Entrar'}</h1>
        <p className="gf-login-sub">
          {mode === 'register'
            ? 'Pede acesso ao painel. A conta fica pendente até aprovação.'
            : mode === 'forgot'
              ? 'Indica o email da conta para receberes um link de recuperação.'
              : mode === 'reset'
                ? 'Define uma nova password para a tua conta.'
                : 'Entra com a tua conta aprovada.'}
        </p>

        {mode === 'register' && (
          <label className="gf-field">
            <span>Nome</span>
            <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" />
          </label>
        )}

        <label className="gf-field">
          <span>Email</span>
          <input value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
        </label>

        {mode !== 'forgot' && (
          <label className="gf-field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={mode === 'register' || mode === 'reset' ? 'new-password' : 'current-password'}
            />
          </label>
        )}

        {needsTwoFactor && (
          <label className="gf-field">
            <span>Código 2FA</span>
            <input
              value={twoFactorCode}
              onChange={(event) => setTwoFactorCode(event.target.value)}
              inputMode="numeric"
              maxLength={6}
              autoComplete="one-time-code"
            />
          </label>
        )}

        {error && <div className="gf-auth-error">{error}</div>}
        {notice && <div className="gf-auth-notice">{notice}</div>}

        <button className="gf-primary" disabled={loading}>
          {loading ? 'A processar...' : mode === 'register' ? 'Pedir acesso' : mode === 'forgot' ? 'Enviar recuperação' : mode === 'reset' ? 'Guardar password' : 'Entrar no painel'}
        </button>

        {mode === 'login' && (
          <button className="gf-auth-switch" type="button" onClick={() => setMode('forgot')}>
            Esqueci-me da password
          </button>
        )}

        <button
          className="gf-auth-switch"
          type="button"
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login');
            setError('');
            setNotice('');
            setNeedsTwoFactor(false);
            setTwoFactorCode('');
          }}
        >
          {mode === 'login' ? 'Criar nova conta' : 'Já tenho conta'}
        </button>
      </motion.form>
    </main>
  );
}

function Sidebar({ user, route, navigate, logout }) {
  const items = [
    ['/dashboard', LayoutDashboard, 'Dashboard'],
    ['/catalog', Gamepad2, user.role === 'admin' ? 'Catálogo' : 'Pedir servidor'],
    ['/requests', Terminal, user.role === 'admin' ? 'Pedidos' : 'Meus pedidos'],
    ['/servers', Server, 'Servidores'],
    ...(user.role === 'admin' ? [
      ['/activity', Activity, 'Atividade'],
      ['/clients', User, 'Clientes']
    ] : []),
    ['/security', Shield, 'Segurança']
  ];

  return (
    <aside className="gf-sidebar">
      <div className="gf-brand">
        <div className="gf-logo"><Gamepad2 /></div>
        <div>
          <h1>Xcat Panel</h1>
          <p>Owner / Designer</p>
        </div>
      </div>

      <nav className="gf-nav">
        {items.map(([path, Icon, label]) => (
          <button
            key={path}
            className={route === path ? 'active' : ''}
            onClick={() => navigate(path)}
          >
            <Icon size={18} /> {label}
          </button>
        ))}
      </nav>

      <div className="gf-user-box">
        <div className="gf-user-avatar"><User size={18} /></div>
        <div>
          <strong>{user.name}</strong>
          <span>{user.role}</span>
        </div>
      </div>

      <button className="gf-logout" onClick={logout}>
        <LogOut size={16} /> Sair
      </button>
    </aside>
  );
}

function TopHero({ health, user }) {
  return (
    <motion.header className="gf-hero" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}>
      <div>
        <p className="gf-kicker">Enterprise Game Server Platform</p>
        <h2>{user.role === 'admin' ? 'Admin Control Plane.' : 'Área de Cliente.'}</h2>
        <p className="gf-hero-sub">
          {user.role === 'admin'
            ? 'Valida pedidos, provisiona servidores e gere toda a infraestrutura.'
            : 'Escolhe o jogo, envia o pedido e acompanha a aprovação do teu servidor.'}
        </p>
      </div>

      <div className="gf-status">
        <Power color="#6ee7b7" />
        <span>API Status</span>
        <strong>{health?.status || 'loading'}</strong>
      </div>
    </motion.header>
  );
}

function DashboardPage({ user, servers, catalog, requests, activity = [], navigate }) {
  const isAdmin = user.role === 'admin';
  const pending = requests.filter((request) => request.status === 'pending').length;
  const online = servers.filter((server) => isLiveOnline(server)).length;
  const offline = Math.max(servers.length - online, 0);
  const avgCpu = servers.length
    ? Math.round(servers.reduce((sum, server) => sum + Number(server.live?.cpuPercent || 0), 0) / servers.length)
    : 0;
  const avgRam = servers.length
    ? Math.round(servers.reduce((sum, server) => sum + Number(server.live?.ramPercent || 0), 0) / servers.length)
    : 0;
  const serviceTypes = servers.reduce((acc, server) => {
    const label = server.gameName || server.game || 'Servidor';
    acc[label] = (acc[label] || 0) + 1;
    return acc;
  }, {});
  const recentServers = [...servers].slice(0, 4);
  const recentActivity = activity.slice(0, 4);

  return (
    <>
      <section className="gf-metrics">
        <Metric icon={Server} label="Servidores" value={servers.length} />
        <Metric icon={Activity} label="Online" value={online} />
        <Metric icon={Gamepad2} label={isAdmin ? 'Templates' : 'Catálogo'} value={isAdmin ? catalog.length : 'ON'} />
        <Metric icon={Terminal} label={isAdmin ? 'Pendentes' : 'Pedidos'} value={isAdmin ? pending : requests.length} />
      </section>

      <section className="gf-ops-grid">
        {isAdmin && (
        <div className="gf-card gf-ops-card">
          <div className="gf-section-title">
            <div>
              <p className="gf-kicker">{isAdmin ? 'Live Health' : 'Os teus serviços'}</p>
              <h3>{isAdmin ? 'Estado da infraestrutura' : 'Estado dos teus servidores'}</h3>
            </div>
            <Activity color="#67e8f9" />
          </div>

          <div className="gf-health-row">
            <div>
              <span>Online</span>
              <strong>{online}</strong>
            </div>
            <div>
              <span>Offline</span>
              <strong>{offline}</strong>
            </div>
            <div>
              <span>CPU media</span>
              <strong>{avgCpu}%</strong>
            </div>
            <div>
              <span>RAM media</span>
              <strong>{avgRam}%</strong>
            </div>
          </div>

          <div className="gf-mini-bars">
            <div>
              <div className="gf-bar-head"><span>CPU global</span><strong>{avgCpu}%</strong></div>
              <div className="gf-bar-bg"><div className="gf-bar-fill cpu" style={{ width: `${Math.min(avgCpu, 100)}%` }} /></div>
            </div>
            <div>
              <div className="gf-bar-head"><span>RAM global</span><strong>{avgRam}%</strong></div>
              <div className="gf-bar-bg"><div className="gf-bar-fill ram" style={{ width: `${Math.min(avgRam, 100)}%` }} /></div>
            </div>
          </div>
        </div>
        )}

        <div className="gf-card gf-ops-card">
          <div className="gf-section-title">
            <div>
              <p className="gf-kicker">Service Mix</p>
              <h3>Servicos ativos</h3>
            </div>
            <Database color="#c084fc" />
          </div>

          <div className="gf-service-mix">
            {Object.keys(serviceTypes).length === 0 && <span>Nenhum servidor criado.</span>}
            {Object.entries(serviceTypes).map(([label, count]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{count}</strong>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="gf-grid-content">
        <div className="gf-card">
          <div className="gf-section-title">
            <div>
              <p className="gf-kicker">Resumo</p>
              <h3>{user.role === 'admin' ? 'Operação admin' : 'A tua área'}</h3>
            </div>
            <Sparkles color="#67e8f9" />
          </div>

          <div className="gf-detail-grid">
            <div className="gf-detail-card"><span>Role</span><strong>{user.role}</strong></div>
            <div className="gf-detail-card"><span>Pedidos</span><strong>{requests.length}</strong></div>
            <div className="gf-detail-card"><span>Servidores</span><strong>{servers.length}</strong></div>
            <div className="gf-detail-card"><span>Alertas</span><strong>{pending + offline}</strong></div>
          </div>

          <div className="gf-dashboard-list">
            {recentServers.length === 0 && <span>Ainda nao existem servidores.</span>}
            {recentServers.map((server) => (
              <button key={server.id} onClick={() => navigate('/servers')}>
                <span>{server.name}</span>
                <em className={getDisplayStatus(server)}>{getDisplayStatus(server)}</em>
              </button>
            ))}
          </div>
        </div>

        <div className="gf-card">
          <div className="gf-section-title">
            <div>
              <p className="gf-kicker">Ações</p>
              <h3>Começar</h3>
            </div>
            <Terminal color="#c084fc" />
          </div>

          <div className="gf-actions-column">
            {isAdmin ? (
              <>
                <button onClick={() => navigate('/requests')}>Ver pedidos pendentes</button>
                <button onClick={() => navigate('/servers')}>Gerir servidores</button>
                <button onClick={() => navigate('/catalog')}>Criar novo servidor</button>
                <button onClick={() => navigate('/clients')}>Gerir clientes</button>
              </>
            ) : (
              <>
                <button onClick={() => navigate('/catalog')}>Pedir novo servidor</button>
                <button onClick={() => navigate('/requests')}>Ver os meus pedidos</button>
                <button onClick={() => navigate('/servers')}>Abrir servidores</button>
              </>
            )}
          </div>

          <div className="gf-activity-mini">
            <strong>Ultima atividade</strong>
            {(!isAdmin || recentActivity.length === 0) && <span>Sem eventos recentes.</span>}
            {isAdmin && recentActivity.map((item) => (
              <button key={item.id} onClick={() => navigate('/activity')}>
                <span>{item.title}</span>
                <em>{item.type}</em>
              </button>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

function CatalogPage({ user, catalog, onConfigure }) {
  return (
    <section className="gf-card gf-page-card">
      <div className="gf-section-title">
        <div>
          <p className="gf-kicker">{user.role === 'admin' ? 'Catálogo de serviços' : 'Escolher serviço'}</p>
          <h3>{user.role === 'admin' ? 'Templates disponíveis' : 'Que servidor queres pedir?'}</h3>
        </div>
        <Sparkles color="#67e8f9" />
      </div>

      <div className="gf-catalog">
        {catalog.map((game, index) => {
          const isVoice = ['Voice', 'Audio'].includes(game.category);
          const statusLabel = game.available === false ? 'Indisponivel' : 'Instalacao ativa';
          const actionLabel = user.role === 'admin'
            ? 'Criar servidor'
            : isVoice
              ? 'Pedir servidor de voz'
              : 'Pedir este servidor';

          return (
          <motion.article
            className="gf-game"
            key={game.id}
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.06 }}
          >
            <div className="gf-game-icon">{game.icon}</div>
            <div className="gf-game-head">
              <div>
                <h4>{game.name}</h4>
                <p className="gf-game-category">{game.category}</p>
              </div>
              <span className={`gf-template-status ${game.available === false ? 'off' : 'on'}`}>{statusLabel}</span>
            </div>
            <p className="gf-game-desc">{game.description}</p>

            <div className="gf-mini-grid">
              <div className="gf-mini"><Cpu size={14} /> {game.defaultResources.ramMb / 1024}GB</div>
              <div className="gf-mini"><HardDrive size={14} /> {Math.round(game.defaultResources.diskMb / 1024)}GB</div>
              <div className="gf-mini"><Database size={14} /> {game.schema?.length || 0} configs</div>
            </div>

            <button className="gf-primary" disabled={game.available === false} onClick={() => onConfigure(game)}>
              <Play size={15} /> {actionLabel}
            </button>
          </motion.article>
          );
        })}
      </div>
    </section>
  );
}

function RequestsPage({ user, requests, onApprove, onReject, onDelete, navigate }) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const title = user.role === 'admin' ? 'Pedidos pendentes / processados' : 'Meus pedidos';
  const pending = requests.filter((request) => request.status === 'pending').length;
  const approved = requests.filter((request) => request.status === 'approved').length;
  const rejected = requests.filter((request) => request.status === 'rejected').length;
  const filteredRequests = requests.filter((request) => {
    const text = `${request.gameName} ${request.clientName || ''} ${request.clientEmail || ''} ${request.config?.serverName || ''}`.toLowerCase();
    return text.includes(search.toLowerCase())
      && (statusFilter === 'all' || request.status === statusFilter);
  });

  return (
    <section className="gf-card gf-page-card">
      <div className="gf-section-title">
        <div>
          <p className="gf-kicker">Requests</p>
          <h3>{title}</h3>
        </div>
        <Terminal color="#c084fc" />
      </div>

      <div className="gf-client-stats">
        <div><span>Total</span><strong>{requests.length}</strong></div>
        <div><span>Pendentes</span><strong>{pending}</strong></div>
        <div><span>Aprovados</span><strong>{approved}</strong></div>
        <div><span>Recusados</span><strong>{rejected}</strong></div>
      </div>

      <div className="gf-server-toolbar">
        <label className="gf-server-search">
          <Terminal size={16} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Pesquisar jogo, cliente ou servidor" />
        </label>

        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="all">Todos os estados</option>
          <option value="pending">Pendentes</option>
          <option value="approved">Aprovados</option>
          <option value="rejected">Recusados</option>
        </select>

        <button className="gf-toolbar-button" onClick={() => navigate('/catalog')}>Novo pedido</button>
      </div>

      <div className="gf-request-list">
        {requests.length === 0 && (
          <div className="gf-empty">
            {user.role === 'admin'
              ? 'Ainda não existem pedidos de clientes.'
              : 'Ainda não fizeste nenhum pedido.'}
            {user.role === 'client' && (
              <>
                <br />
                <button className="gf-primary gf-inline-primary" onClick={() => navigate('/catalog')}>
                  Pedir servidor
                </button>
              </>
            )}
          </div>
        )}

        {requests.length > 0 && filteredRequests.length === 0 && (
          <div className="gf-empty">Nenhum pedido corresponde aos filtros.</div>
        )}

        {filteredRequests.map((request) => (
          <article className="gf-request" key={request.id}>
            <div className="gf-request-main">
              <div>
                <div className="gf-request-title">
                  <strong>{request.gameName}</strong>
                  <span className={`gf-request-status ${request.status}`}>{request.status}</span>
                </div>

                <p>
                  {user.role === 'admin'
                    ? `${request.clientName} · ${request.clientEmail}`
                    : request.serverId
                      ? `Servidor criado: ${request.serverId}`
                      : 'A aguardar validação do administrador'}
                </p>

                <div className="gf-request-config">
                  <span>Nome: {request.config?.serverName || '-'}</span>
                  <span>RAM: {request.config?.ramMb || '-'} MB</span>
                  <span>Slots: {request.config?.maxPlayers || '-'}</span>
                  <span>Porta: {request.config?.port || '-'}</span>
                  <span>Criado: {request.createdAt ? new Date(request.createdAt).toLocaleString() : '-'}</span>
                </div>
              </div>

              {user.role === 'admin' && (
                <div className="gf-request-actions">
                  {request.status === 'pending' && (
                    <>
                      <button className="approve" onClick={() => onApprove(request.id)}>
                        <Check size={15} /> Aprovar
                      </button>
                      <button className="reject" onClick={() => onReject(request.id)}>
                        <X size={15} /> Rejeitar
                      </button>
                    </>
                  )}

                  <button className="delete" onClick={() => onDelete(request.id)}>
                    Apagar
                  </button>
                </div>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function ServersPage({ user, servers, onOpen, onAction, onDelete, onReinstall, busyServerId, actionProgress, navigate }) {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [copiedId, setCopiedId] = useState('');
  const publicHost = 'aleijados.duckdns.org';
  const serviceTypes = [...new Set(servers.map((server) => server.gameName || server.game || 'Servidor'))];
  const filteredServers = servers.filter((server) => {
    const status = getDisplayStatus(server);
    const type = server.gameName || server.game || 'Servidor';
    const text = `${server.name} ${type} ${server.ownerName || ''} ${server.node || ''}`.toLowerCase();
    return text.includes(search.toLowerCase())
      && (typeFilter === 'all' || type === typeFilter)
      && (statusFilter === 'all' || status === statusFilter);
  });

  function getServerAddress(server) {
    const port = Number(server.ports?.[0]?.port || server.installConfig?.port || 0);
    if (server.game === 'cs2') return `connect ${publicHost}:${port || 27015}`;
    if (server.game === 'teamspeak3') return `${publicHost}:${port || 9987}`;
    return port ? `${publicHost}:${port}` : publicHost;
  }

  function copyServerAddress(server) {
    navigator.clipboard?.writeText(getServerAddress(server));
    setCopiedId(server.id);
    setTimeout(() => setCopiedId(''), 1600);
  }

  return (
    <section className="gf-card gf-page-card">
      <div className="gf-section-title">
        <div>
          <p className="gf-kicker">Live Nodes</p>
          <h3>Servidores</h3>
        </div>
        <Terminal color="#c084fc" />
      </div>

      <div className="gf-server-toolbar">
        <label className="gf-server-search">
          <Terminal size={16} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Pesquisar servidor, cliente ou node" />
        </label>

        <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
          <option value="all">Todos os servicos</option>
          {serviceTypes.map((type) => (
            <option key={type} value={type}>{type}</option>
          ))}
        </select>

        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="all">Todos os estados</option>
          <option value="online">Online</option>
          <option value="offline">Offline</option>
        </select>
      </div>

      <div className="gf-server-summary">
        <span>{filteredServers.length} visiveis</span>
        <span>{servers.filter((server) => isLiveOnline(server)).length} online</span>
        <span>{servers.length - servers.filter((server) => isLiveOnline(server)).length} offline</span>
      </div>

      <div className="gf-server-list">
        {servers.length === 0 && (
          <div className="gf-empty">
            Ainda não existem servidores aprovados.
            <br />
            <button className="gf-primary gf-inline-primary" onClick={() => navigate('/catalog')}>
              Ir para catálogo
            </button>
          </div>
        )}

        {servers.length > 0 && filteredServers.length === 0 && (
          <div className="gf-empty">Nenhum servidor corresponde aos filtros.</div>
        )}

        {filteredServers.map((server) => {
          const serverStatus = getDisplayStatus(server);
          const displayStatus = progressStatus(actionProgress?.id === server.id ? actionProgress : null, serverStatus);
          const liveProgress = getServerProgress(server);
          const progress = actionProgress?.id === server.id
            ? actionProgress
            : shouldShowServerProgress(liveProgress, displayStatus)
              ? liveProgress
              : null;
          const busyStatus = ['starting', 'stopping', 'restarting'].includes(displayStatus);

          return (
          <article className="gf-server" key={server.id}>
            <div className="gf-server-top">
              <div>
                <h4>{server.name}</h4>
                <p>{server.gameName || server.game} · {server.ownerName || 'Sem cliente'} · {server.node}</p>
                <p>{server.path}</p>
              </div>

              <span className={`gf-badge ${displayStatus}`}>
                {displayStatus}
              </span>
            </div>

            {progress && (
              <div className={`gf-progress ${progress.step === 'error' ? 'error' : ''}`}>
                <div>
                  <span>{progress.label || 'A processar'}</span>
                  <strong>{Math.max(0, Math.min(100, Number(progress.percent || 0)))}%</strong>
                </div>
                <i style={{ width: `${Math.max(0, Math.min(100, Number(progress.percent || 0)))}%` }} />
                {progress.error && <em>{progress.error}</em>}
              </div>
            )}

            <div className="gf-mini-grid" style={{ marginTop: 14 }}>
              <div className="gf-mini"><Cpu size={14} /> {getRamText(server)}</div>
              <div className="gf-mini"><Activity size={14} /> {getCpuText(server)}</div>
              <div className="gf-mini"><HardDrive size={14} /> {server.installStatus}</div>
            </div>

            <div className="gf-server-connect">
              <div>
                <span>Ligacao</span>
                <strong>{getServerAddress(server)}</strong>
              </div>
              <button onClick={() => copyServerAddress(server)}>{copiedId === server.id ? 'Copiado' : 'Copiar'}</button>
            </div>

            <div className="gf-actions">
              <button onClick={() => onOpen(server)}>Abrir</button>

              {busyServerId === server.id ? (
                <button disabled>A processar...</button>
              ) : (
                <>
                  {!isLiveOnline(server) && !busyStatus && (
                    <button className="gf-btn-start" onClick={() => onAction(server.id, 'start')}>Start</button>
                  )}

                  {isLiveOnline(server) && !busyStatus && (
                    <>
                      <button className="gf-btn-stop" onClick={() => onAction(server.id, 'stop')}>Stop</button>
                      <button className="gf-btn-restart" onClick={() => onAction(server.id, 'restart')}>Restart</button>
                    </>
                  )}

                  {busyStatus && <button disabled>{progress?.label || 'A processar...'}</button>}

                  <button className="gf-btn-reinstall" onClick={() => onReinstall(server.id)}>Reinstalar</button>

                  {user.role === 'admin' && (
                    <button onClick={() => onDelete(server.id)}>Apagar servidor</button>
                  )}
                </>
              )}
            </div>
          </article>
          );
        })}
      </div>
    </section>
  );
}

function ActivityPage({ activity }) {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const types = [...new Set(activity.map((item) => item.type).filter(Boolean))];
  const today = new Date().toDateString();
  const todayCount = activity.filter((item) => item.createdAt && new Date(item.createdAt).toDateString() === today).length;
  const serverEvents = activity.filter((item) => String(item.type || '').includes('server')).length;
  const filteredActivity = activity.filter((item) => {
    const text = `${item.title || ''} ${item.message || ''} ${item.type || ''}`.toLowerCase();
    return text.includes(search.toLowerCase())
      && (typeFilter === 'all' || item.type === typeFilter);
  });

  return (
    <section className="gf-card gf-page-card">
      <div className="gf-section-title">
        <div>
          <p className="gf-kicker">Activity Center</p>
          <h3>Auditoria e eventos</h3>
        </div>
        <Activity color="#67e8f9" />
      </div>

      <div className="gf-client-stats">
        <div><span>Total</span><strong>{activity.length}</strong></div>
        <div><span>Hoje</span><strong>{todayCount}</strong></div>
        <div><span>Tipos</span><strong>{types.length}</strong></div>
        <div><span>Servidor</span><strong>{serverEvents}</strong></div>
      </div>

      <div className="gf-server-toolbar">
        <label className="gf-server-search">
          <Activity size={16} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Pesquisar evento, mensagem ou tipo" />
        </label>

        <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
          <option value="all">Todos os tipos</option>
          {types.map((type) => (
            <option key={type} value={type}>{type}</option>
          ))}
        </select>

        <button className="gf-toolbar-button" onClick={() => { setSearch(''); setTypeFilter('all'); }}>Limpar filtros</button>
      </div>

      <div className="gf-activity-list">
        {activity.length === 0 && (
          <div className="gf-empty">Ainda não existe atividade registada.</div>
        )}

        {activity.length > 0 && filteredActivity.length === 0 && (
          <div className="gf-empty">Nenhum evento corresponde aos filtros.</div>
        )}

        {filteredActivity.map((item) => (
          <article className="gf-activity-item" key={item.id}>
            <div>
              <strong>{item.title}</strong>
              <p>{item.message}</p>
              <span>{new Date(item.createdAt).toLocaleString()}</span>
            </div>

            <em>{item.type}</em>
          </article>
        ))}
      </div>
    </section>
  );
}

function ClientsPage({ users, servers = [], requests = [], onCreate, onStatus, onRole, onDelete }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  function submit(event) {
    event.preventDefault();
    onCreate({ name, email, password });
    setName('');
    setEmail('');
    setPassword('');
  }

  const accounts = users;
  const pending = accounts.filter((item) => (item.status || 'approved') === 'pending');
  const admins = accounts.filter((item) => item.role === 'admin').length;
  const clients = accounts.filter((item) => item.role !== 'admin').length;
  const filteredAccounts = accounts.filter((client) => {
    const status = client.status || 'approved';
    const text = `${client.name} ${client.email} ${client.role}`.toLowerCase();
    return text.includes(search.toLowerCase())
      && (roleFilter === 'all' || client.role === roleFilter)
      && (statusFilter === 'all' || status === statusFilter);
  });

  function clientServers(client) {
    return servers.filter((server) => server.ownerId === client.id || server.ownerEmail === client.email);
  }

  function clientRequests(client) {
    return requests.filter((request) => request.clientId === client.id || request.clientEmail === client.email);
  }

  return (
    <section className="gf-card gf-page-card">
      <div className="gf-section-title">
        <div>
          <p className="gf-kicker">Clients</p>
          <h3>Gestão de acessos</h3>
        </div>
        <User color="#67e8f9" />
      </div>

      <div className="gf-client-stats">
        <div><span>Total</span><strong>{accounts.length}</strong></div>
        <div><span>Clientes</span><strong>{clients}</strong></div>
        <div><span>Admins</span><strong>{admins}</strong></div>
        <div><span>Pendentes</span><strong>{pending.length}</strong></div>
      </div>

      {pending.length > 0 && (
        <div className="gf-auth-queue">
          <p className="gf-kicker">Pendentes</p>
          <strong>{pending.length} conta{pending.length === 1 ? '' : 's'} à espera de aprovação</strong>
        </div>
      )}

      <div className="gf-server-toolbar">
        <label className="gf-server-search">
          <User size={16} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Pesquisar nome, email ou role" />
        </label>

        <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
          <option value="all">Todas as roles</option>
          <option value="client">Clientes</option>
          <option value="admin">Admins</option>
        </select>

        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="all">Todos os estados</option>
          <option value="approved">Aprovados</option>
          <option value="pending">Pendentes</option>
          <option value="rejected">Recusados</option>
        </select>
      </div>

      <form className="gf-client-form" onSubmit={submit}>
        <label className="gf-field">
          <span>Nome</span>
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>

        <label className="gf-field">
          <span>Email</span>
          <input value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>

        <label className="gf-field">
          <span>Password</span>
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>

        <button className="gf-primary">Criar cliente</button>
      </form>

      <div className="gf-client-list">
        {filteredAccounts.map((client) => {
          const ownedServers = clientServers(client);
          const ownedRequests = clientRequests(client);

          return (
          <article className="gf-client-card" key={client.id}>
            <div className="gf-client-main">
              <div>
                <div className="gf-client-title">
                  <strong>{client.name}</strong>
                  <span className={`gf-request-status ${client.status === 'pending' ? 'pending' : client.status === 'rejected' ? 'rejected' : 'approved'}`}>
                    {(client.status || 'approved').toUpperCase()}
                  </span>
                </div>
                <p>{client.email}</p>
                <div className="gf-client-meta">
                  <span>{client.role}</span>
                  <span>{ownedServers.length} servidor(es)</span>
                  <span>{ownedRequests.length} pedido(s)</span>
                  <span>Criado: {new Date(client.createdAt).toLocaleString()}</span>
                </div>
                <div className="gf-client-services">
                  {ownedServers.slice(0, 3).map((server) => (
                    <em key={server.id}>{server.name}</em>
                  ))}
                  {ownedServers.length > 3 && <em>+{ownedServers.length - 3}</em>}
                  {ownedServers.length === 0 && <em>Sem servidores</em>}
                </div>
              </div>

              <div className="gf-client-actions">
                <select value={client.role} onChange={(event) => onRole(client.id, event.target.value)}>
                  <option value="client">Cliente</option>
                  <option value="admin">Admin</option>
                </select>
                {(client.status || 'approved') !== 'approved' && (
                  <button className="approve" onClick={() => onStatus(client.id, 'approved')} type="button">
                    <Check size={15} /> Aprovar
                  </button>
                )}
                {(client.status || 'approved') !== 'rejected' && (
                  <button className="reject" onClick={() => onStatus(client.id, 'rejected')} type="button">
                    <X size={15} /> Recusar
                  </button>
                )}
                <button className="reject" onClick={() => onDelete(client.id)} type="button">
                  <X size={15} /> Apagar
                </button>
              </div>
            </div>
          </article>
          );
        })}

        {accounts.length === 0 && (
          <div className="gf-empty">Ainda não existem contas.</div>
        )}
        {accounts.length > 0 && filteredAccounts.length === 0 && (
          <div className="gf-empty">Nenhuma conta corresponde aos filtros.</div>
        )}
      </div>
    </section>
  );
}

function SecurityPage({
  user,
  storageRoots = [],
  storageDisks = [],
  onAddStorageRoot,
  onPrepareStorageDisk,
  onBeginTwoFactorSetup,
  onConfirmTwoFactorSetup,
  onDisableTwoFactor
}) {
  const [storageLabel, setStorageLabel] = useState('');
  const [storagePath, setStoragePath] = useState('');
  const [storageSaving, setStorageSaving] = useState(false);
  const [diskPreparing, setDiskPreparing] = useState('');
  const [twoFactorSetup, setTwoFactorSetup] = useState(null);
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [twoFactorBusy, setTwoFactorBusy] = useState(false);

  async function submitStorage(event) {
    event.preventDefault();
    if (!storageLabel.trim() || !storagePath.trim()) return;

    setStorageSaving(true);
    try {
      await onAddStorageRoot?.({
        label: storageLabel.trim(),
        path: storagePath.trim()
      });
      setStorageLabel('');
      setStoragePath('');
    } catch (err) {
      alert(err.message);
    } finally {
      setStorageSaving(false);
    }
  }

  async function prepareDisk(disk) {
    const label = `Disco servidores ${disk.sizeLabel}`;
    const ok = confirm(`Preparar ${disk.path} (${disk.sizeLabel}) para servidores?\n\nIsto vai formatar esse disco vazio e monta-lo automaticamente.`);
    if (!ok) return;

    setDiskPreparing(disk.path);
    try {
      await onPrepareStorageDisk?.({
        path: disk.path,
        label
      });
    } catch (err) {
      alert(err.message);
    } finally {
      setDiskPreparing('');
    }
  }

  async function startTwoFactor() {
    setTwoFactorBusy(true);
    try {
      const result = await onBeginTwoFactorSetup?.();
      if (!result?.ok) throw new Error(result?.error || 'Erro ao iniciar 2FA');
      setTwoFactorSetup(result.item);
      setTwoFactorCode('');
    } catch (err) {
      alert(err.message);
    } finally {
      setTwoFactorBusy(false);
    }
  }

  async function confirmTwoFactor() {
    setTwoFactorBusy(true);
    try {
      const result = await onConfirmTwoFactorSetup?.(twoFactorCode);
      if (!result?.ok) throw new Error(result?.error || 'Erro ao ativar 2FA');
      setTwoFactorSetup(null);
      setTwoFactorCode('');
    } catch (err) {
      alert(err.message);
    } finally {
      setTwoFactorBusy(false);
    }
  }

  async function turnOffTwoFactor() {
    const code = prompt('Código 2FA atual');
    if (!code) return;

    setTwoFactorBusy(true);
    try {
      const result = await onDisableTwoFactor?.(code);
      if (!result?.ok) throw new Error(result?.error || 'Erro ao desativar 2FA');
    } catch (err) {
      alert(err.message);
    } finally {
      setTwoFactorBusy(false);
    }
  }

  const checks = [
    { label: 'HTTPS publico', value: 'ativo', good: true },
    { label: 'Acesso LAN', value: 'permitido', good: true },
    { label: 'Credenciais publicas', value: 'removidas', good: true },
    { label: '2FA conta', value: user.twoFactorEnabled ? 'ativo' : 'pendente', good: Boolean(user.twoFactorEnabled) }
  ];
  const recommendations = [
    'Ativar 2FA para contas admin.',
    'Criar logs de login e tentativas falhadas.',
    'Separar permissoes de staff, suporte e admin total.',
    'Adicionar expirar sessoes antigas.'
  ];

  return (
    <section className="gf-card gf-page-card">
      <div className="gf-section-title">
        <div>
          <p className="gf-kicker">Security</p>
          <h3>Conta e permissões</h3>
        </div>
        <Lock color="#67e8f9" />
      </div>

      <div className="gf-client-stats">
        <div><span>Conta</span><strong>{user.role}</strong></div>
        <div><span>Sessao</span><strong>JWT</strong></div>
        <div><span>HTTPS</span><strong>ON</strong></div>
        <div><span>LAN</span><strong>ON</strong></div>
      </div>

      <div className="gf-detail-grid">
        <div className="gf-detail-card"><span>Nome</span><strong>{user.name}</strong></div>
        <div className="gf-detail-card"><span>Email</span><strong>{user.email}</strong></div>
        <div className="gf-detail-card"><span>Role</span><strong>{user.role}</strong></div>
        <div className="gf-detail-card"><span>Sessão</span><strong>JWT</strong></div>
      </div>

      <div className="gf-security-grid">
        {user.role === 'admin' && (
        <section className="gf-overview-panel">
          <div className="gf-section-title">
            <div>
              <p className="gf-kicker">Access Policy</p>
              <h3>Estado atual</h3>
            </div>
            <Shield color="#67e8f9" />
          </div>

          <div className="gf-security-checks">
            {checks.map((check) => (
              <div key={check.label}>
                <span>{check.label}</span>
                <strong className={check.good ? 'good' : 'warn'}>{check.value}</strong>
              </div>
            ))}
          </div>
        </section>
        )}

        <section className="gf-overview-panel">
          <div className="gf-section-title">
            <div>
              <p className="gf-kicker">2FA</p>
              <h3>Autenticação extra</h3>
            </div>
            <Shield color="#67e8f9" />
          </div>

          <div className="gf-security-list">
            <div>
              <Check size={15} />
              <span>{user.twoFactorEnabled ? '2FA ativo nesta conta.' : 'Protege esta conta com uma aplicação Authenticator.'}</span>
            </div>
          </div>

          {!user.twoFactorEnabled && !twoFactorSetup && (
            <button className="gf-primary" onClick={startTwoFactor} disabled={twoFactorBusy}>
              {twoFactorBusy ? 'A preparar...' : 'Ativar 2FA'}
            </button>
          )}

          {user.twoFactorEnabled && (
            <button className="gf-secondary" onClick={turnOffTwoFactor} disabled={twoFactorBusy}>
              Desativar 2FA
            </button>
          )}

          {twoFactorSetup && (
            <div className="gf-2fa-box">
              <span>Chave manual</span>
              <strong>{twoFactorSetup.secret}</strong>
              <p>Adiciona esta chave na tua aplicação Authenticator e confirma com o código de 6 dígitos.</p>
              <label className="gf-field">
                <span>Código 2FA</span>
                <input value={twoFactorCode} onChange={(event) => setTwoFactorCode(event.target.value)} inputMode="numeric" maxLength={6} />
              </label>
              <button className="gf-primary" onClick={confirmTwoFactor} disabled={twoFactorBusy || twoFactorCode.length < 6}>
                Confirmar 2FA
              </button>
            </div>
          )}
        </section>

        {user.role === 'admin' && (
          <section className="gf-overview-panel">
            <div className="gf-section-title">
              <div>
                <p className="gf-kicker">Storage</p>
                <h3>Destinos de instalacao</h3>
              </div>
              <HardDrive color="#67e8f9" />
            </div>

            <div className="gf-security-list">
              {storageRoots.map((root) => (
                <div key={root.id}>
                  <Check size={15} />
                  <span>{root.label} · {root.path} {root.availableMb ? `· ${root.availableMb}MB livres` : ''}</span>
                </div>
              ))}
              {storageRoots.length === 0 && (
                <div><Check size={15} /><span>Disco principal preparado</span></div>
              )}
            </div>

            <div className="gf-storage-disks">
              {storageDisks.map((disk) => (
                <article className="gf-storage-disk" key={`${disk.path}-${disk.status}`}>
                  <div>
                    <strong>{disk.path}</strong>
                    <span>{disk.sizeLabel} · {disk.fstype || 'sem formato'} · {disk.mountpoint || 'nao montado'}</span>
                  </div>
                  {disk.status === 'configured' && <em>Em uso</em>}
                  {disk.canUse && (
                    <button
                      type="button"
                      onClick={() => {
                        setStorageLabel(disk.label || `Disco servidores ${disk.sizeLabel}`);
                        setStoragePath(disk.storagePath);
                      }}
                    >
                      Usar
                    </button>
                  )}
                  {disk.canPrepare && (
                    <button type="button" disabled={diskPreparing === disk.path} onClick={() => prepareDisk(disk)}>
                      {diskPreparing === disk.path ? 'A preparar...' : 'Preparar'}
                    </button>
                  )}
                  {!disk.canPrepare && !disk.canUse && disk.status !== 'configured' && <em>Indisponivel</em>}
                </article>
              ))}
            </div>

            <form className="gf-client-form" onSubmit={submitStorage}>
              <label className="gf-field">
                <span>Nome do destino</span>
                <input value={storageLabel} onChange={(event) => setStorageLabel(event.target.value)} placeholder="Ex: Disco jogos 2TB" />
              </label>
              <label className="gf-field">
                <span>Caminho no Ubuntu</span>
                <input value={storagePath} onChange={(event) => setStoragePath(event.target.value)} placeholder="/mnt/jogos/servers" />
              </label>
              <button className="gf-primary" disabled={storageSaving || !storageLabel.trim() || !storagePath.trim()}>
                {storageSaving ? 'A guardar...' : 'Adicionar destino'}
              </button>
            </form>
          </section>
        )}

        {user.role === 'admin' && (
        <section className="gf-overview-panel">
          <div className="gf-section-title">
            <div>
              <p className="gf-kicker">Hardening</p>
              <h3>Proximos passos</h3>
            </div>
            <Lock color="#c084fc" />
          </div>

          <div className="gf-security-list">
            {recommendations.map((item) => (
              <div key={item}>
                <Check size={15} />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </section>
        )}
      </div>
    </section>
  );
}

function ServerPanel({ user, server, token, onClose, onAction, onDelete, onReinstall, onUpdateConfig, onAssignOwner, users = [], busyServerId, actionProgress }) {
  const isAdmin = user.role === 'admin';
  const [tab, setTab] = useState('overview');
  const [cs2Config, setCs2Config] = useState(null);
  const [cs2GsltInput, setCs2GsltInput] = useState('');
  const [cs2Saving, setCs2Saving] = useState(false);
  const [logs, setLogs] = useState([]);
  const [files, setFiles] = useState([]);
  const [filePath, setFilePath] = useState('');
  const [editingPath, setEditingPath] = useState('');
  const [content, setContent] = useState('');
  const [backups, setBackups] = useState([]);
  const [backupLoading, setBackupLoading] = useState(false);
  const [liveStats, setLiveStats] = useState(server.live || null);
  const [plugins, setPlugins] = useState([]);
  const [loadingPlugins, setLoadingPlugins] = useState(false);
  const [overviewPlayers, setOverviewPlayers] = useState([]);
  const [overviewMessage, setOverviewMessage] = useState('');
  const [tvBusy, setTvBusy] = useState(false);
  const [teamspeak, setTeamspeak] = useState(null);
  const [tsChannelModalOpen, setTsChannelModalOpen] = useState(false);
  const [tsSelectedClientId, setTsSelectedClientId] = useState('');
  const [tsSelectedChannelId, setTsSelectedChannelId] = useState('');
  const [tsChannelForm, setTsChannelForm] = useState({
    name: '',
    parentId: '',
    maxClients: '',
    password: '',
    topic: ''
  });

  const [settings, setSettings] = useState({
    serverName: server.installConfig?.serverName || server.name || '',
    motd: server.installConfig?.motd || '',
    maxPlayers: server.installConfig?.maxPlayers || 20,
    port: server.installConfig?.port || server.ports?.[0]?.port || 25565,
    ramMb: server.resources?.ramMb || 2048,
    onlineMode: server.installConfig?.onlineMode || 'true'
  });

  const headers = { Authorization: `Bearer ${token}` };
  const panelServer = { ...server, live: liveStats || server.live };
  const panelStatus = progressStatus(actionProgress?.id === server.id ? actionProgress : null, getDisplayStatus(panelServer));
  const panelLiveProgress = getServerProgress(server);
  const panelProgress = actionProgress?.id === server.id
    ? actionProgress
    : shouldShowServerProgress(panelLiveProgress, panelStatus)
      ? panelLiveProgress
      : null;
  const gamePort = Number(server.ports?.[0]?.port || server.installConfig?.port || 27015);
  const tvPort = Number(server.installConfig?.tvPort || 27020);
  const publicHost = 'aleijados.duckdns.org';
  const gameConnectCommand = `connect ${publicHost}:${gamePort}`;
  const tvConnectCommand = `connect ${publicHost}:${tvPort}`;
  const tsChannels = teamspeak?.channels || [];
  const tsClients = teamspeak?.clients || [];
  const tsSelectedClient = tsClients.find((client) => String(client.id) === String(tsSelectedClientId));
  const tsSelectedChannel = tsChannels.find((channel) => String(channel.id) === String(tsSelectedChannelId));
  const tsClientsByChannel = tsClients.reduce((acc, client) => {
    const key = String(client.channelId || '0');
    acc[key] = [...(acc[key] || []), client];
    return acc;
  }, {});

  async function loadLiveStats() {
    try {
      const data = await fetch(`${API_URL}/monitor/${server.id}`, { headers }).then((r) => r.json());

      if (data.ok && data.item) {
        setLiveStats(data.item);
      }
    } catch {}
  }

  async function loadOverviewPlayers() {
    if (server.game !== 'cs2') return;

    try {
      const data = await fetch(`${API_URL}/servers/${server.id}/live-control/players`, { headers }).then((r) => r.json());

      if (data.ok) {
        setOverviewPlayers(data.items || []);
      }
    } catch {}
  }

  async function sendLiveCommand(command, label = command) {
    setTvBusy(true);
    setOverviewMessage(`A enviar: ${label}`);

    try {
      const data = await fetch(`${API_URL}/servers/${server.id}/live-control/command`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ command })
      }).then((r) => r.json());

      if (!data.ok) {
        setOverviewMessage(data.error || 'Erro ao enviar comando.');
        return false;
      }

      setOverviewMessage(data.output || `Enviado: ${label}`);
      return true;
    } catch {
      setOverviewMessage('Erro de ligacao ao Live Control.');
      return false;
    } finally {
      setTvBusy(false);
    }
  }

  async function enableCstv() {
    setTvBusy(true);
    setOverviewMessage('A ativar CSTV/GOTV...');

    const commands = [
      'tv_enable 1',
      `tv_port ${tvPort}`,
      'tv_delay 90',
      'tv_maxclients 10',
      'tv_advertise_watchable 1',
      'say [GameForge] CSTV configurado. Spectators: connect aleijados.duckdns.org:27020'
    ];

    try {
      for (const command of commands) {
        const ok = await sendLiveCommand(command, command);
        if (!ok) return;
        await new Promise((resolve) => setTimeout(resolve, 150));
      }

      setOverviewMessage('CSTV enviado para o servidor. Se a porta nao abrir, e necessario reiniciar o CS2 com tv_enable ativo.');
    } finally {
      setTvBusy(false);
    }
  }

  function copyText(value, label) {
    navigator.clipboard?.writeText(value);
    setOverviewMessage(`${label} copiado.`);
  }

  async function loadLogs() {
    const data = await fetch(`${API_URL}/console/${server.id}`, { headers }).then((r) => r.json());
    setLogs(data.logs || data.items || []);
  }

  async function loadFiles(current = '') {
    const data = await fetch(`${API_URL}/files/${server.id}?path=${encodeURIComponent(current)}`, { headers }).then((r) => r.json());
    setFiles(data.items || []);
    setFilePath(current);
  }

  async function loadBackups() {
    setBackupLoading(true);

    try {
      const data = await fetch(`${API_URL}/backups/${server.id}`, { headers }).then((r) => r.json());

      if (!data.ok) {
        alert(data.error || 'Erro ao carregar backups');
        setBackups([]);
        return;
      }

      setBackups(data.items || []);
    } finally {
      setBackupLoading(false);
    }
  }

  async function loadCs2Config() {
    if (server.game !== 'cs2') return;

    const data = await fetch(`${API_URL}/servers/${server.id}/cs2-config`, { headers }).then((r) => r.json());

    if (!data.success) {
      alert(data.error || 'Erro ao carregar configuração CS2');
      return;
    }

    setCs2Config(data.config || {});
    setCs2GsltInput('');
  }

  async function loadPlugins() {
    setLoadingPlugins(true);

    try {
      const data = await fetch(`${API_URL}/servers/${server.id}/plugins`, { headers }).then((r) => r.json());

      if (!data.ok) {
        alert(data.error || 'Erro ao carregar plugins');
        setPlugins([]);
        return;
      }

      setPlugins(data.items || []);
    } catch {
      setPlugins([]);
    } finally {
      setLoadingPlugins(false);
    }
  }

  async function loadTeamspeak() {
    if (server.game !== 'teamspeak3') return;

    const data = await fetch(`${API_URL}/teamspeak/${server.id}/overview`, { headers }).then((r) => r.json());
    setTeamspeak(data.ok ? data.item : { online: false, error: data.error || 'Erro ao carregar TeamSpeak' });
  }

  async function createTeamspeakAdminToken() {
    const data = await fetch(`${API_URL}/teamspeak/${server.id}/tokens/server-admin`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'GameForge ServerAdmin' })
    }).then((r) => r.json());

    if (!data.ok || !data.item?.token) {
      alert(data.error || 'Erro ao gerar token ServerAdmin');
      return;
    }

    setTeamspeak((current) => ({ ...(current || {}), privilegeKey: data.item.token }));
    await copyText(data.item.token, 'Novo token ServerAdmin');
  }

  async function runTeamspeakAction(action, payload = {}) {
    const data = await fetch(`${API_URL}/teamspeak/${server.id}/actions/${action}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then((r) => r.json());

    if (!data.ok) {
      alert(data.error || 'Erro TeamSpeak');
      return;
    }

    setTeamspeak(data.item);
  }

  async function createTeamspeakChannel() {
    if (!tsChannelForm.name.trim()) {
      alert('Escreve o nome da sala.');
      return;
    }

    await runTeamspeakAction('create-channel', {
      name: tsChannelForm.name.trim(),
      parentId: tsChannelForm.parentId || undefined,
      maxClients: tsChannelForm.maxClients || undefined,
      password: tsChannelForm.password || undefined,
      topic: tsChannelForm.topic || undefined
    });

    setTsChannelForm({ name: '', parentId: '', maxClients: '', password: '', topic: '' });
    setTsChannelModalOpen(false);
  }

  async function installPlugin(pluginId) {
    const data = await fetch(`${API_URL}/servers/${server.id}/plugins/${pluginId}/install`, {
      method: 'POST',
      headers
    }).then((r) => r.json());

    if (!data.ok) {
      alert(data.error || 'Erro ao instalar plugin');
      return;
    }

    await loadPlugins();
    alert('Plugin instalado/ativado. Reinicia o servidor para aplicar.');
  }

  async function uninstallPlugin(pluginId) {
    if (!confirm('Remover/desativar este plugin?')) return;

    const data = await fetch(`${API_URL}/servers/${server.id}/plugins/${pluginId}/uninstall`, {
      method: 'POST',
      headers
    }).then((r) => r.json());

    if (!data.ok) {
      alert(data.error || 'Erro ao remover plugin');
      return;
    }

    await loadPlugins();
    alert('Plugin removido/desativado. Reinicia o servidor para aplicar.');
  }

  async function saveCs2Config() {
    if (!cs2Config) return;

    setCs2Saving(true);

    try {
      const payload = { ...cs2Config };

      if (cs2GsltInput.trim()) {
        payload.gslt = cs2GsltInput.trim();
      } else {
        delete payload.gslt;
      }

      const data = await fetch(`${API_URL}/servers/${server.id}/cs2-config/save-and-apply`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then((r) => r.json());

      if (!data.success) {
        alert(data.error || 'Erro ao guardar configuração CS2');
        return;
      }

      setCs2Config(data.config || {});
      setCs2GsltInput('');
      alert('Configuração CS2 guardada e aplicada.');
    } finally {
      setCs2Saving(false);
    }
  }

  async function createBackup() {
    if (!confirm('Criar backup deste servidor?')) return;

    setBackupLoading(true);

    try {
      const data = await fetch(`${API_URL}/backups/${server.id}`, {
        method: 'POST',
        headers
      }).then((r) => r.json());

      if (!data.ok) {
        alert(data.error || 'Erro ao criar backup');
        return;
      }

      await loadBackups();
    } finally {
      setBackupLoading(false);
    }
  }

  async function restoreBackup(backupId) {
    if (!confirm('Restaurar este backup? Os ficheiros atuais serão substituídos.')) return;

    const data = await fetch(`${API_URL}/backups/${server.id}/${backupId}/restore`, {
      method: 'POST',
      headers
    }).then((r) => r.json());

    if (!data.ok) {
      alert(data.error || 'Erro ao restaurar backup');
      return;
    }

    await loadFiles('');
    alert('Backup restaurado.');
  }

  async function deleteBackup(backupId) {
    if (!confirm('Apagar este backup?')) return;

    const data = await fetch(`${API_URL}/backups/${server.id}/${backupId}`, {
      method: 'DELETE',
      headers
    }).then((r) => r.json());

    if (!data.ok) {
      alert(data.error || 'Erro ao apagar backup');
      return;
    }

    await loadBackups();
  }

  async function openFile(name) {
    const fullPath = filePath ? `${filePath}/${name}` : name;
    const data = await fetch(`${API_URL}/files/${server.id}/read?path=${encodeURIComponent(fullPath)}`, { headers }).then((r) => r.json());
    setEditingPath(fullPath);
    setContent(data.content || '');
  }

  async function saveFile() {
    await fetch(`${API_URL}/files/${server.id}/write`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: editingPath, content })
    });
    await loadLogs();
  }

  useEffect(() => {
    loadLogs();
    loadFiles('');
    loadLiveStats();
    loadOverviewPlayers();
    loadTeamspeak();
  }, [server.id]);

  useEffect(() => {
    if (tab !== 'console') return;

    const interval = setInterval(() => {
      loadLogs();
    }, 2000);

    return () => clearInterval(interval);
  }, [tab, server.id]);

  useEffect(() => {
    loadLiveStats();
    loadOverviewPlayers();

    const interval = setInterval(() => {
      loadLiveStats();
      loadOverviewPlayers();
    }, 2000);

    return () => clearInterval(interval);
  }, [server.id]);

  useEffect(() => {
    if (isAdmin && tab === 'backups' && server?.id) {
      loadBackups();
    }

    if (tab === 'cs2config' && server?.id) {
      loadCs2Config();
    }

    if (isAdmin && tab === 'plugins' && server?.id) {
      loadPlugins();
    }

    if (tab === 'teamspeak' && server?.id) {
      loadTeamspeak();
    }
  }, [tab, server?.id, isAdmin]);

  return (
    <motion.div className="gf-modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="gf-modal gf-server-modal" initial={{ scale: 0.94, y: 30 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.94, y: 30 }}>
        <div className="gf-modal-head">
          <div>
            <p className="gf-kicker">Server Control</p>
            <h3>{server.name}</h3>
            <p>{server.gameName} · {server.ownerName || 'Sem cliente'} · {server.path}</p>
          </div>
          <button className="gf-close" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="gf-tabs">
          <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>Overview</button>
          <button className={tab === 'console' ? 'active' : ''} onClick={() => { setTab('console'); loadLogs(); }}>Console</button>
          <button className={tab === 'files' ? 'active' : ''} onClick={() => { setTab('files'); loadFiles(''); }}>File Manager</button>

          {server.game !== 'cs2' && (
            <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>Configurações</button>
          )}

          {server.game === 'teamspeak3' && (
            <button className={tab === 'teamspeak' ? 'active' : ''} onClick={() => { setTab('teamspeak'); loadTeamspeak(); }}>TeamSpeak</button>
          )}

          {server.game === 'sinusbot' && (
            <button className={tab === 'musicbot' ? 'active' : ''} onClick={() => setTab('musicbot')}>Music Bot</button>
          )}

          {server.game === 'cs2' && (
            <button className={tab === 'cs2config' ? 'active' : ''} onClick={() => setTab('cs2config')}>CS2 Config</button>
          )}

          {isAdmin && server.game === 'cs2' && (
            <button className={tab === 'plugins' ? 'active' : ''} onClick={() => setTab('plugins')}>Plugins</button>
          )}

          {isAdmin && server.game === 'cs2' && (
            <button className={tab === 'admins' ? 'active' : ''} onClick={() => setTab('admins')}>Admins</button>
          )}

          {isAdmin && server.game === 'cs2' && (
            <>
              <button className={tab === 'live' ? 'active' : ''} onClick={() => setTab('live')}>Live Control</button>
            <button className={tab === 'modes' ? 'active' : ''} onClick={() => setTab('modes')}>Game Modes</button>
              <button className={tab === 'updates' ? 'active' : ''} onClick={() => setTab('updates')}>Updates</button>
            </>
          )}

          {isAdmin && (
            <button className={tab === 'backups' ? 'active' : ''} onClick={() => setTab('backups')}>Backups</button>
          )}
        </div>

        {tab === 'overview' && (
          <>
            <div className="gf-detail-grid">
              <div className="gf-detail-card"><span>Status</span><strong>{panelStatus}</strong></div>
              <div className="gf-detail-card"><span>Provisioning</span><strong>{server.installStatus}</strong></div>
              <div className="gf-detail-card"><span>RAM real</span><strong>{getRamText(panelServer)}</strong></div>
              <div className="gf-detail-card"><span>Porta</span><strong>{server.ports?.[0]?.port}</strong></div>
            </div>

            {panelProgress && (
              <div className={`gf-progress ${panelProgress.step === 'error' ? 'error' : ''}`} style={{ marginBottom: 18 }}>
                <div>
                  <span>{panelProgress.label || 'A processar'}</span>
                  <strong>{Math.max(0, Math.min(100, Number(panelProgress.percent || 0)))}%</strong>
                </div>
                <i style={{ width: `${Math.max(0, Math.min(100, Number(panelProgress.percent || 0)))}%` }} />
                {panelProgress.error && <em>{panelProgress.error}</em>}
              </div>
            )}

            {isAdmin && (
              <div className="gf-detail-card gf-wide" style={{ marginBottom: 18 }}>
                <span>Dono do servidor</span>
                <select value={server.ownerId || ''} onChange={(event) => onAssignOwner(server.id, event.target.value)}>
                  <option value="">Sem cliente</option>
                  {users.map((account) => (
                    <option key={account.id} value={account.id}>{account.name} · {account.email} · {account.role}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="gf-chart">
              <div className="gf-bar">
                <div className="gf-bar-head">
                  <span>CPU</span>
                  <strong>{Math.round(panelServer?.live?.cpuPercent || 0)}%</strong>
                </div>

                <div className="gf-bar-bg">
                  <div
                    className="gf-bar-fill cpu"
                    style={{ width: `${Math.min(panelServer?.live?.cpuPercent || 0, 100)}%` }}
                  />
                </div>
              </div>

              <div className="gf-bar">
                <div className="gf-bar-head">
                  <span>RAM</span>
                  <strong>{Math.round(panelServer?.live?.ramPercent || 0)}%</strong>
                </div>

                <div className="gf-bar-bg">
                  <div
                    className="gf-bar-fill ram"
                    style={{ width: `${Math.min(panelServer?.live?.ramPercent || 0, 100)}%` }}
                  />
                </div>
              </div>
            </div>

            {server.game === 'cs2' && (
              <div className="gf-overview-grid">
                <section className="gf-overview-panel gf-tv-panel">
                  <div className="gf-section-title">
                    <div>
                      <p className="gf-kicker">CSTV / HLTV</p>
                      <h3>Servidor TV</h3>
                    </div>
                    <Activity color="#67e8f9" />
                  </div>

                  <div className="gf-tv-screen">
                    <div>
                      <span>TV externa</span>
                      <strong>{tvConnectCommand}</strong>
                    </div>
                    <button onClick={() => copyText(tvConnectCommand, 'Comando CSTV')}>Copiar</button>
                  </div>

                  <div className="gf-tv-actions">
                    <button disabled={tvBusy} onClick={enableCstv}>Ativar CSTV</button>
                    <button disabled={tvBusy} onClick={() => sendLiveCommand(`tv_record gameforge_${Date.now()}`, 'Gravar demo')}>Gravar demo</button>
                    <button disabled={tvBusy} onClick={() => sendLiveCommand('tv_stoprecord', 'Parar demo')}>Parar demo</button>
                  </div>

                  <p className="gf-tv-note">
                    O browser nao consegue reproduzir CSTV diretamente. Para ver como HLTV, abre o CS2 e usa o comando acima.
                  </p>

                  {overviewMessage && <p className="gf-tv-message">{overviewMessage}</p>}
                </section>

                <section className="gf-overview-panel">
                  <div className="gf-section-title">
                    <div>
                      <p className="gf-kicker">Live Match</p>
                      <h3>Jogadores</h3>
                    </div>
                    <User color="#67e8f9" />
                  </div>

                  <div className="gf-player-pills">
                    {overviewPlayers.map((player) => (
                      <span key={player.key || player.name}>{player.name}</span>
                    ))}
                    {!overviewPlayers.length && <em>Sem jogadores humanos detetados.</em>}
                  </div>

                  <div className="gf-tv-screen compact">
                    <div>
                      <span>Servidor</span>
                      <strong>{gameConnectCommand}</strong>
                    </div>
                    <button onClick={() => copyText(gameConnectCommand, 'Comando do servidor')}>Copiar</button>
                  </div>
                </section>
              </div>
            )}
          </>
        )}

        {tab === 'console' && (
          <div>
            <div className="gf-actions" style={{ marginBottom: 14 }}>
              <span className="gf-live-pill">LIVE • auto-refresh 2s</span>
            </div>
            <pre className="gf-console">{logs.join('\n') || 'Sem logs ainda.'}</pre>
          </div>
        )}

        {tab === 'files' && (
          <div className="gf-file-layout">
            <div className="gf-file-list">
              <p className="gf-path">/{filePath}</p>

              {filePath && (
                <button className="gf-file-row" onClick={() => loadFiles(filePath.split('/').slice(0, -1).join('/'))}>
                  <Folder size={16} /> ..
                </button>
              )}

              {files.map((item) => (
                <button
                  className="gf-file-row"
                  key={item.name}
                  onClick={() => item.type === 'directory'
                    ? loadFiles(filePath ? `${filePath}/${item.name}` : item.name)
                    : openFile(item.name)}
                >
                  {item.type === 'directory' ? <Folder size={16} /> : <FileText size={16} />}
                  {item.name}
                </button>
              ))}
            </div>

            <div className="gf-editor">
              <div className="gf-editor-head">
                <strong>{editingPath || 'Seleciona um ficheiro'}</strong>
                {editingPath && <button onClick={saveFile}><Save size={15} /> Guardar</button>}
              </div>
              <textarea value={content} onChange={(e) => setContent(e.target.value)} disabled={!editingPath} />
            </div>
          </div>
        )}

        {tab === 'settings' && server.game !== 'cs2' && (
          <div>
            <div className="gf-form-grid">
              <label className="gf-field">
                <span>Nome do servidor</span>
                <input value={settings.serverName} onChange={(e) => setSettings({ ...settings, serverName: e.target.value })} />
              </label>

              <label className="gf-field">
                <span>MOTD</span>
                <input value={settings.motd} onChange={(e) => setSettings({ ...settings, motd: e.target.value })} />
              </label>

              <label className="gf-field">
                <span>Slots</span>
                <input type="number" value={settings.maxPlayers} onChange={(e) => setSettings({ ...settings, maxPlayers: e.target.value })} />
              </label>

              <label className="gf-field">
                <span>Porta</span>
                <input type="number" value={settings.port} onChange={(e) => setSettings({ ...settings, port: e.target.value })} />
              </label>

              <label className="gf-field">
                <span>RAM MB</span>
                <input type="number" value={settings.ramMb} onChange={(e) => setSettings({ ...settings, ramMb: e.target.value })} />
              </label>

              <label className="gf-field">
                <span>Online Mode</span>
                <select value={settings.onlineMode} onChange={(e) => setSettings({ ...settings, onlineMode: e.target.value })}>
                  <option value="true">Ativo</option>
                  <option value="false">Inativo</option>
                </select>
              </label>
            </div>

            <div className="gf-modal-actions">
              <button className="gf-primary" onClick={() => onUpdateConfig(server.id, settings)}>
                Guardar configurações
              </button>
            </div>

            <div className="gf-empty" style={{ marginTop: 18 }}>
              O jogo/template não pode ser alterado pelo cliente. Para mudar de jogo, é necessário novo pedido.
            </div>
          </div>
        )}

        {tab === 'teamspeak' && server.game === 'teamspeak3' && (
          <div>
            <div className="gf-actions" style={{ marginBottom: 16 }}>
              <button onClick={loadTeamspeak}>Atualizar</button>
              <button onClick={() => setTsChannelModalOpen(true)}>Criar sala</button>
              <button onClick={createTeamspeakAdminToken}>Gerar token admin</button>
              {teamspeak?.privilegeKey && (
                <button onClick={() => copyText(teamspeak.privilegeKey, 'Token TeamSpeak')}>Copiar token admin</button>
              )}
            </div>

            <div className="gf-detail-grid" style={{ marginBottom: 18 }}>
              <div className="gf-detail-card"><span>ServerQuery</span><strong>{teamspeak?.online ? 'online' : 'offline'}</strong></div>
              <div className="gf-detail-card"><span>Clientes</span><strong>{teamspeak?.clients?.length || 0}</strong></div>
              <div className="gf-detail-card"><span>Canais</span><strong>{teamspeak?.channels?.length || 0}</strong></div>
              <div className="gf-detail-card"><span>Slots</span><strong>{teamspeak?.serverInfo?.virtualserver_maxclients || server.installConfig?.maxPlayers || 32}</strong></div>
            </div>

            {teamspeak?.privilegeKey && (
              <div className="gf-detail-card gf-wide" style={{ marginBottom: 18 }}>
                <span>Token inicial ServerAdmin</span>
                <strong>{teamspeak.privilegeKey}</strong>
              </div>
            )}

            {teamspeak?.error && (
              <div className="gf-empty" style={{ marginBottom: 18 }}>{teamspeak.error}</div>
            )}

            <div className="gf-ts-console">
              <section className="gf-overview-panel gf-ts-tree">
                <div className="gf-section-title">
                  <div>
                    <p className="gf-kicker">Voice Tree</p>
                    <h3>Servidor em direto</h3>
                  </div>
                  <Folder color="#67e8f9" />
                </div>

                <div className="gf-ts-tree-list">
                  {tsChannels.map((channel) => {
                    const channelClients = tsClientsByChannel[String(channel.id)] || [];
                    return (
                      <article
                        className={`gf-ts-channel ${String(tsSelectedChannelId) === String(channel.id) ? 'selected' : ''}`}
                        key={channel.id}
                        onClick={() => setTsSelectedChannelId(channel.id)}
                      >
                        <div className="gf-ts-channel-head">
                          <div>
                            <strong>{channel.name}</strong>
                            <span>ID {channel.id} Â· {channelClients.length} cliente(s)</span>
                          </div>
                          <button
                            className="reject"
                            onClick={(event) => {
                              event.stopPropagation();
                              if (confirm(`Apagar a sala "${channel.name}"?`)) {
                                runTeamspeakAction('delete-channel', { channelId: channel.id });
                              }
                            }}
                          >
                            Apagar
                          </button>
                        </div>

                        <div className="gf-ts-client-stack">
                          {channelClients.map((client) => (
                            <button
                              key={client.id}
                              className={`gf-ts-client ${String(tsSelectedClientId) === String(client.id) ? 'selected' : ''}`}
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                setTsSelectedClientId(client.id);
                                setTsSelectedChannelId(channel.id);
                              }}
                            >
                              <User size={15} />
                              <span>{client.name}</span>
                            </button>
                          ))}
                          {channelClients.length === 0 && <em>Sala vazia</em>}
                        </div>
                      </article>
                    );
                  })}
                  {tsChannels.length === 0 && <div className="gf-empty">Sem canais para mostrar.</div>}
                </div>
              </section>

              <aside className="gf-overview-panel gf-ts-side">
                <div className="gf-section-title">
                  <div>
                    <p className="gf-kicker">Actions</p>
                    <h3>Gestao rapida</h3>
                  </div>
                  <User color="#67e8f9" />
                </div>

                <div className="gf-ts-selected">
                  <span>Cliente selecionado</span>
                  <strong>{tsSelectedClient?.name || 'Nenhum cliente'}</strong>
                  <span>Canal selecionado</span>
                  <strong>{tsSelectedChannel?.name || 'Nenhum canal'}</strong>
                </div>

                <label className="gf-field">
                  <span>Mover para canal</span>
                  <select value={tsSelectedChannelId} onChange={(event) => setTsSelectedChannelId(event.target.value)}>
                    <option value="">Escolhe uma sala</option>
                    {tsChannels.map((channel) => (
                      <option key={channel.id} value={channel.id}>{channel.name}</option>
                    ))}
                  </select>
                </label>

                <div className="gf-ts-action-grid">
                  <button
                    disabled={!tsSelectedClientId || !tsSelectedChannelId}
                    onClick={() => runTeamspeakAction('move-client', { clientId: tsSelectedClientId, channelId: tsSelectedChannelId })}
                  >
                    Mover cliente
                  </button>
                  <button
                    disabled={!tsSelectedClientId}
                    onClick={() => runTeamspeakAction('kick-client', { clientId: tsSelectedClientId, reason: 'GameForge' })}
                  >
                    Kick
                  </button>
                  <button
                    className="reject"
                    disabled={!tsSelectedClientId}
                    onClick={() => runTeamspeakAction('ban-client', { clientId: tsSelectedClientId, time: 600, reason: 'GameForge ban' })}
                  >
                    Ban 10 min
                  </button>
                  <button onClick={() => setTsChannelModalOpen(true)}>Nova sala</button>
                </div>
              </aside>
            </div>

            <AnimatePresence>
              {tsChannelModalOpen && (
                <motion.div className="gf-mini-modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <motion.div className="gf-mini-modal" initial={{ scale: 0.96, y: 18 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 18 }}>
                    <div className="gf-modal-head">
                      <div>
                        <p className="gf-kicker">TeamSpeak</p>
                        <h3>Criar sala</h3>
                        <p>Define a sala pai, limite e password numa so janela.</p>
                      </div>
                      <button className="gf-close" onClick={() => setTsChannelModalOpen(false)}><X size={18} /></button>
                    </div>

                    <div className="gf-form-grid">
                      <label className="gf-field gf-wide">
                        <span>Nome da sala</span>
                        <input value={tsChannelForm.name} onChange={(event) => setTsChannelForm({ ...tsChannelForm, name: event.target.value })} autoFocus />
                      </label>
                      <label className="gf-field">
                        <span>Sala pai</span>
                        <select value={tsChannelForm.parentId} onChange={(event) => setTsChannelForm({ ...tsChannelForm, parentId: event.target.value })}>
                          <option value="">Raiz do servidor</option>
                          {tsChannels.map((channel) => (
                            <option key={channel.id} value={channel.id}>{channel.name}</option>
                          ))}
                        </select>
                      </label>
                      <label className="gf-field">
                        <span>Slots da sala</span>
                        <input type="number" min="0" placeholder="Sem limite" value={tsChannelForm.maxClients} onChange={(event) => setTsChannelForm({ ...tsChannelForm, maxClients: event.target.value })} />
                      </label>
                      <label className="gf-field">
                        <span>Password opcional</span>
                        <input type="password" value={tsChannelForm.password} onChange={(event) => setTsChannelForm({ ...tsChannelForm, password: event.target.value })} />
                      </label>
                      <label className="gf-field">
                        <span>Topico</span>
                        <input value={tsChannelForm.topic} onChange={(event) => setTsChannelForm({ ...tsChannelForm, topic: event.target.value })} />
                      </label>
                    </div>

                    <div className="gf-modal-actions">
                      <button onClick={() => setTsChannelModalOpen(false)}>Cancelar</button>
                      <button className="gf-primary" onClick={createTeamspeakChannel}>Criar sala</button>
                    </div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {tab === 'musicbot' && server.game === 'sinusbot' && (
          <div>
            <div className="gf-detail-grid" style={{ marginBottom: 18 }}>
              <div className="gf-detail-card">
                <span>Painel web</span>
                <strong>{publicHost}/sinusbot/</strong>
              </div>
              <div className="gf-detail-card">
                <span>User</span>
                <strong>admin</strong>
              </div>
              <div className="gf-detail-card">
                <span>Password inicial</span>
                <strong>{server.installConfig?.webPassword || 'credentials.txt'}</strong>
              </div>
              <div className="gf-detail-card">
                <span>TeamSpeak alvo</span>
                <strong>{server.installConfig?.ts3Host || '127.0.0.1'}:{server.installConfig?.ts3Port || 9987}</strong>
              </div>
            </div>

            <div className="gf-actions" style={{ marginBottom: 16 }}>
              <button onClick={() => copyText(`https://${publicHost}/sinusbot/`, 'URL SinusBot')}>Copiar URL</button>
              <button disabled={!server.installConfig?.webPassword} onClick={() => copyText(server.installConfig?.webPassword || '', 'Password SinusBot')}>Copiar password</button>
            </div>

            <section className="gf-overview-panel">
              <div className="gf-section-title">
                <div>
                  <p className="gf-kicker">SinusBot</p>
                  <h3>Painel incorporado</h3>
                </div>
              </div>
              <iframe className="gf-service-frame" title="SinusBot Web Panel" src="/sinusbot/" />
            </section>
          </div>
        )}

        {tab === 'cs2config' && server.game === 'cs2' && (
          <div>
            {!cs2Config ? (
              <div className="gf-detail-card">
                <span>A carregar configuração CS2...</span>
              </div>
            ) : (
              <>
                <div className="gf-detail-grid" style={{ marginBottom: 18 }}>
                  <div className="gf-detail-card">
                    <span>GSLT</span>
                    <strong>{cs2Config.gslt?.configured ? `Configurado ••••${cs2Config.gslt.last4}` : 'Em falta'}</strong>
                  </div>
                  <div className="gf-detail-card">
                    <span>Mapa</span>
                    <strong>{cs2Config.map}</strong>
                  </div>
                  <div className="gf-detail-card">
                    <span>Slots</span>
                    <strong>{cs2Config.maxplayers}</strong>
                  </div>
                  <div className="gf-detail-card">
                    <span>Tickrate</span>
                    <strong>{cs2Config.tickrate}</strong>
                  </div>
                </div>

                {!cs2Config.gslt?.configured && (
                  <div className="gf-detail-card gf-wide" style={{ marginBottom: 18, borderColor: 'rgba(245, 158, 11, 0.45)' }}>
                    <span>Servidor em modo limitado</span>
                    <strong>Sem GSLT, o servidor pode ficar restrito/sem listagem pública.</strong>
                    <p style={{ marginTop: 8 }}>
                      Cria um token em{' '}
                      <a href="https://steamcommunity.com/dev/managegameservers" target="_blank" rel="noreferrer">
                        Steam Game Server Account
                      </a>{' '}
                      usando App ID <strong>730</strong>.
                    </p>
                  </div>
                )}

                <div className="gf-form-grid">
                  <label className="gf-field">
                    <span>Hostname</span>
                    <input value={cs2Config.hostname || ''} onChange={(e) => setCs2Config({ ...cs2Config, hostname: e.target.value })} />
                  </label>

                  <label className="gf-field">
                    <span>RCON Password</span>
                    <input type="password" value={cs2Config.rcon_password || ''} onChange={(e) => setCs2Config({ ...cs2Config, rcon_password: e.target.value })} />
                  </label>

                  <label className="gf-field">
                    <span>Password do servidor</span>
                    <input type="password" value={cs2Config.sv_password || ''} onChange={(e) => setCs2Config({ ...cs2Config, sv_password: e.target.value })} />
                  </label>

                  <label className="gf-field">
                    <span>Novo GSLT</span>
                    <input
                      type="password"
                      value={cs2GsltInput}
                      onChange={(e) => setCs2GsltInput(e.target.value)}
                      placeholder={cs2Config.gslt?.configured ? `Configurado ••••${cs2Config.gslt.last4}` : 'Colar token Steam GSLT'}
                    />
                  </label>

                  <label className="gf-field">
                    <span>Slots</span>
                    <input type="number" value={cs2Config.maxplayers || 12} onChange={(e) => setCs2Config({ ...cs2Config, maxplayers: e.target.value })} />
                  </label>

                  <label className="gf-field">
                    <span>Tickrate</span>
                    <select value={cs2Config.tickrate || 128} onChange={(e) => setCs2Config({ ...cs2Config, tickrate: e.target.value })}>
                      <option value="64">64</option>
                      <option value="128">128</option>
                    </select>
                  </label>

                  <label className="gf-field">
                    <span>Mapa inicial</span>
                    <input value={cs2Config.map || 'de_dust2'} onChange={(e) => setCs2Config({ ...cs2Config, map: e.target.value })} />
                  </label>

                  <label className="gf-field">
                    <span>Game Type</span>
                    <input type="number" value={cs2Config.game_type ?? 0} onChange={(e) => setCs2Config({ ...cs2Config, game_type: e.target.value })} />
                  </label>

                  <label className="gf-field">
                    <span>Game Mode</span>
                    <input type="number" value={cs2Config.game_mode ?? 1} onChange={(e) => setCs2Config({ ...cs2Config, game_mode: e.target.value })} />
                  </label>

                  <label className="gf-field">
                    <span>Bots</span>
                    <select value={cs2Config.bots_enabled ? 'true' : 'false'} onChange={(e) => setCs2Config({ ...cs2Config, bots_enabled: e.target.value === 'true' })}>
                      <option value="true">Ativos</option>
                      <option value="false">Desativos</option>
                    </select>
                  </label>

                  <label className="gf-field">
                    <span>Bot quota</span>
                    <input type="number" value={cs2Config.bot_quota || 0} onChange={(e) => setCs2Config({ ...cs2Config, bot_quota: e.target.value })} />
                  </label>

                  <label className="gf-field">
                    <span>Warmup</span>
                    <select value={cs2Config.warmup_enabled ? 'true' : 'false'} onChange={(e) => setCs2Config({ ...cs2Config, warmup_enabled: e.target.value === 'true' })}>
                      <option value="true">Ativo</option>
                      <option value="false">Desativo</option>
                    </select>
                  </label>

                  <label className="gf-field">
                    <span>Warmup segundos</span>
                    <input type="number" value={cs2Config.mp_warmuptime || 0} onChange={(e) => setCs2Config({ ...cs2Config, mp_warmuptime: e.target.value })} />
                  </label>

                  <label className="gf-field">
                    <span>Autobalance</span>
                    <select value={cs2Config.autobalance ? 'true' : 'false'} onChange={(e) => setCs2Config({ ...cs2Config, autobalance: e.target.value === 'true' })}>
                      <option value="true">Ativo</option>
                      <option value="false">Desativo</option>
                    </select>
                  </label>

                  <label className="gf-field">
                    <span>SV Cheats</span>
                    <select value={String(cs2Config.sv_cheats || 0)} onChange={(e) => setCs2Config({ ...cs2Config, sv_cheats: e.target.value })}>
                      <option value="0">Desativo</option>
                      <option value="1">Ativo</option>
                    </select>
                  </label>
                </div>

                <div className="gf-modal-actions">
                  <button className="gf-primary" onClick={saveCs2Config} disabled={cs2Saving}>
                    {cs2Saving ? 'A guardar...' : 'Guardar e aplicar CS2 Config'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {isAdmin && tab === 'plugins' && server.game === 'cs2' && (
          <div>
            <div className="gf-section-title" style={{ marginBottom: 16 }}>
              <div>
                <p className="gf-kicker">CS2 Addons</p>
                <h3>Plugins do servidor</h3>
              </div>
              <Sparkles color="#67e8f9" />
            </div>

            {loadingPlugins && (
              <div className="gf-empty">A carregar plugins...</div>
            )}

            {!loadingPlugins && plugins.length === 0 && (
              <div className="gf-empty">Sem plugins disponíveis.</div>
            )}

            <div className="gf-detail-grid">
              {plugins.map((plugin) => (
                <div className="gf-detail-card" key={plugin.id}>
                  <span>{plugin.category || 'Plugin'}</span>
                  <strong>{plugin.name}</strong>
                  <p style={{ marginTop: 8 }}>{plugin.description}</p>
                  <p style={{ marginTop: 8, opacity: 0.75 }}>
                    Estado: {plugin.installed ? 'Instalado' : 'Disponível'} · {plugin.installMode}
                  </p>

                  <div className="gf-actions" style={{ marginTop: 12 }}>
                    {plugin.installed ? (
                      <button className="gf-btn-stop" onClick={() => uninstallPlugin(plugin.id)}>
                        Remover
                      </button>
                    ) : (
                      <button className="gf-btn-start" onClick={() => installPlugin(plugin.id)}>
                        Instalar
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {isAdmin && tab === 'admins' && server.game === 'cs2' && (
          <CS2Admins serverId={server.id} token={token} />
        )}

        {isAdmin && tab === 'live' && server.game === 'cs2' && (
          <CS2LiveControl serverId={server.id} token={token} />
        )}

        {isAdmin && tab === 'modes' && server.game === 'cs2' && (
          <CS2GameModes serverId={server.id} token={token} />
        )}

        {isAdmin && tab === 'updates' && server.game === 'cs2' && (
          <Cs2UpdatePanel token={token} />
        )}

        {isAdmin && tab === 'backups' && (
          <div>
            <div className="gf-actions" style={{ marginBottom: 16 }}>
              <button className="gf-btn-start" onClick={createBackup} disabled={backupLoading}>
                {backupLoading ? 'A processar...' : 'Criar backup'}
              </button>
              <button onClick={loadBackups} disabled={backupLoading}>Atualizar</button>
            </div>

            <div className="gf-backup-list">
              {backupLoading && backups.length === 0 && (
                <div className="gf-empty">A carregar backups...</div>
              )}

              {!backupLoading && backups.length === 0 && (
                <div className="gf-empty">
                  <h3>Sem backups ainda</h3>
                  <p>Cria o primeiro snapshot deste servidor.</p>
                </div>
              )}

              {backups.map((backup) => (
                <article className="gf-backup-item" key={backup.id}>
                  <div>
                    <strong>{backup.type === 'compressed-snapshot' ? 'Snapshot comprimido' : 'Snapshot'}</strong>
                    <p>{backup.id}</p>
                    <span>
                      Criado por {backup.createdBy} em {new Date(backup.createdAt).toLocaleString()}
                      {backup.sizeMb !== undefined ? ` · ${backup.sizeMb} MB` : ''}
                    </span>
                  </div>

                  <div className="gf-request-actions">
                    <button className="approve" onClick={() => restoreBackup(backup.id)}>Restaurar</button>
                    <button className="reject" onClick={() => deleteBackup(backup.id)}>Apagar</button>
                  </div>
                </article>
              ))}
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

function InstallWizard({ user, game, onClose, onSubmit, installing, users = [], storageRoots = [] }) {
  const initialValues = useMemo(() => {
    const values = {};
    for (const field of game.schema || []) values[field.key] = field.default ?? '';
    return values;
  }, [game]);

  const [values, setValues] = useState(initialValues);
  const [ownerId, setOwnerId] = useState('');
  const defaultStorageId = storageRoots.find((root) => root.default)?.id || storageRoots[0]?.id || '';

  function update(key, value) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  return (
    <motion.div className="gf-modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="gf-modal" initial={{ scale: 0.94, y: 30 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.94, y: 30 }}>
        <div className="gf-modal-head">
          <div>
            <p className="gf-kicker">{user.role === 'admin' ? 'Criar servidor' : 'Pedido de servidor'}</p>
            <h3>{game.icon} {user.role === 'admin' ? 'Criar' : 'Pedir'} {game.name}</h3>
            <p>
              {user.role === 'admin'
                ? 'Provisiona este serviço diretamente no node local.'
                : 'Preenche os dados. O admin valida e só depois o servidor fica disponível.'}
            </p>
          </div>
          <button className="gf-close" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="gf-form-grid">
          {user.role === 'admin' && (
            <label className="gf-field">
              <span>Atribuir a utilizador</span>
              <select value={ownerId} onChange={(event) => setOwnerId(event.target.value)}>
                <option value="">Administrador / sem cliente</option>
                {users.map((account) => (
                  <option key={account.id} value={account.id}>{account.name} · {account.email}</option>
                ))}
              </select>
            </label>
          )}

          {user.role === 'admin' && storageRoots.length > 0 && (
            <label className="gf-field">
              <span>Destino de instalacao</span>
              <select value={values.storageRootId || defaultStorageId} onChange={(event) => update('storageRootId', event.target.value)}>
                {storageRoots.map((root) => (
                  <option key={root.id} value={root.id}>
                    {root.label} Â· {root.availableMb ? `${root.availableMb}MB livres` : root.path}
                  </option>
                ))}
              </select>
            </label>
          )}

          {(game.schema || []).map((field) => (
            <label className="gf-field" key={field.key}>
              <span>{field.label}</span>
              {field.type === 'select' ? (
                <select value={values[field.key]} onChange={(event) => update(field.key, event.target.value)}>
                  {field.options.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              ) : (
                <input
                  type={field.type}
                  value={values[field.key]}
                  min={field.min}
                  max={field.max}
                  onChange={(event) => update(field.key, event.target.value)}
                />
              )}
            </label>
          ))}
        </div>

        <div className="gf-modal-actions">
          <button className="gf-secondary" onClick={onClose}>Cancelar</button>
          <button className="gf-primary" onClick={() => onSubmit(game, values, ownerId)} disabled={installing}>
            {installing ? 'A processar...' : user.role === 'admin' ? 'Criar servidor' : 'Enviar pedido'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function Metric({ icon: Icon, label, value }) {
  return (
    <motion.div className="gf-card" whileHover={{ y: -6 }}>
      <Icon color="#67e8f9" />
      <p className="gf-card-label">{label}</p>
      <p className="gf-card-value">{value}</p>
    </motion.div>
  );
}

export default App;
