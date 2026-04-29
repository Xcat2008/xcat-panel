#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="xcat-panel"
APP_DIR="${APP_DIR:-/opt/xcat-panel}"
DATA_DIR="${DATA_DIR:-/opt/xcat-panel/data}"
SERVER_DIR="${SERVER_DIR:-/opt/xcat-panel/servers}"
DOMAIN="${DOMAIN:-}"
ADMIN_EMAIL="${ADMIN_EMAIL:-}"
ADMIN_NAME="${ADMIN_NAME:-Xcat}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
PUBLIC_URL="${PUBLIC_URL:-}"
NODE_MAJOR="${NODE_MAJOR:-22}"

log() {
  printf '\033[1;36m[xcat-installer]\033[0m %s\n' "$*"
}

fail() {
  printf '\033[1;31m[xcat-installer]\033[0m %s\n' "$*" >&2
  exit 1
}

need_root() {
  if [ "$(id -u)" -ne 0 ]; then
    fail "Executa como root: sudo bash install/install.sh"
  fi
}

ask_defaults() {
  if [ -z "$DOMAIN" ]; then
    read -r -p "Dominio publico, ex: painel.exemplo.pt: " DOMAIN
  fi

  if [ -z "$ADMIN_EMAIL" ]; then
    read -r -p "Email do admin inicial: " ADMIN_EMAIL
  fi

  if [ -z "$ADMIN_PASSWORD" ]; then
    read -r -s -p "Password do admin inicial: " ADMIN_PASSWORD
    printf '\n'
  fi

  if [ -z "$PUBLIC_URL" ]; then
    PUBLIC_URL="https://${DOMAIN}"
  fi
}

install_packages() {
  log "A instalar dependencias base"
  apt-get update
  apt-get install -y ca-certificates curl gnupg nginx certbot python3-certbot-nginx jq unzip tar xz-utils rsync software-properties-common

  if ! command -v node >/dev/null 2>&1 || ! node -v | grep -q "v${NODE_MAJOR}"; then
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
    apt-get install -y nodejs
  fi

  if ! command -v pm2 >/dev/null 2>&1; then
    npm install -g pm2
  fi

  if ! command -v steamcmd >/dev/null 2>&1; then
    add-apt-repository -y multiverse || true
    dpkg --add-architecture i386 || true
    apt-get update
    echo steam steam/question select "I AGREE" | debconf-set-selections || true
    echo steam steam/license note "" | debconf-set-selections || true
    apt-get install -y steamcmd || log "SteamCMD nao ficou instalado automaticamente. O painel pode instalar depois."
  fi
}

create_user_and_dirs() {
  log "A preparar utilizador e diretorios"
  if ! id xcatpanel >/dev/null 2>&1; then
    useradd --system --create-home --shell /bin/bash xcatpanel
  fi

  mkdir -p "$APP_DIR/apps/api" "$APP_DIR/apps/web" "$APP_DIR/templates" "$DATA_DIR" "$SERVER_DIR"
  chown -R xcatpanel:xcatpanel "$APP_DIR"
}

copy_bundle() {
  log "A copiar bundle local"
  local source_root
  source_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

  if [ ! -d "$source_root/apps/web" ]; then
    fail "Bundle incompleto: falta apps/web"
  fi

  rsync -a --delete "$source_root/apps/web/" "$APP_DIR/apps/web/"

  local api_source
  api_source="$source_root/apps/api"

  if [ -d "$api_source" ]; then
    rsync -a --delete "$api_source/" "$APP_DIR/apps/api/"
  else
    fail "Bundle incompleto: falta remote-api"
  fi

  if [ -d "$source_root/templates" ]; then
    rsync -a --delete "$source_root/templates/" "$APP_DIR/templates/"
  fi

  chown -R xcatpanel:xcatpanel "$APP_DIR"
}

write_env() {
  log "A criar configuracao da API"
  local jwt_secret
  jwt_secret="$(openssl rand -hex 32)"

  cat > "$APP_DIR/apps/api/.env" <<EOF
NODE_ENV=production
PORT=3101
GAMEFORGE_PUBLIC_URL=${PUBLIC_URL}
GAMEFORGE_ROOT=${APP_DIR}
GAMEFORGE_DATA_DIR=${DATA_DIR}
GAMEFORGE_SERVERS_DIR=${SERVER_DIR}
GAMEFORGE_JWT_SECRET=${jwt_secret}
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
EOF

  chown xcatpanel:xcatpanel "$APP_DIR/apps/api/.env"
  chmod 600 "$APP_DIR/apps/api/.env"
}

build_apps() {
  log "A instalar e compilar aplicacoes"
  sudo -u xcatpanel bash -lc "cd '$APP_DIR/apps/web' && npm install && npm run build"
  sudo -u xcatpanel bash -lc "cd '$APP_DIR/apps/api' && if [ -f package.json ]; then npm install --omit=dev; fi"
}

create_initial_admin() {
  log "A criar admin inicial"
  mkdir -p "$DATA_DIR"
  chown -R xcatpanel:xcatpanel "$DATA_DIR"

  sudo -u xcatpanel env \
    GAMEFORGE_ROOT="$APP_DIR" \
    ADMIN_EMAIL="$ADMIN_EMAIL" \
    ADMIN_NAME="$ADMIN_NAME" \
    ADMIN_PASSWORD="$ADMIN_PASSWORD" \
    node --input-type=module <<'NODE'
import fs from 'fs/promises';
import path from 'path';
import bcrypt from 'bcryptjs';

const root = process.env.GAMEFORGE_ROOT;
const usersFile = path.join(root, 'data', 'users.json');
const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const name = String(process.env.ADMIN_NAME || 'Xcat').trim() || 'Xcat';
const password = String(process.env.ADMIN_PASSWORD || '');

if (!email || !password) {
  throw new Error('Email/password do admin em falta');
}

let users = [];
try {
  users = JSON.parse(await fs.readFile(usersFile, 'utf8'));
} catch {
  users = [];
}

const existing = users.find((user) => String(user.email || '').toLowerCase() === email);
if (!existing) {
  users.push({
    id: `admin-${Date.now()}`,
    name,
    email,
    passwordHash: await bcrypt.hash(password, 12),
    role: 'admin',
    status: 'approved',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  await fs.mkdir(path.dirname(usersFile), { recursive: true });
  await fs.writeFile(usersFile, JSON.stringify(users, null, 2));
}
NODE
}

configure_pm2() {
  log "A configurar servico da API"
  sudo -u xcatpanel bash -lc "cd '$APP_DIR/apps/api' && PM2_HOME=/home/xcatpanel/.pm2 pm2 start src/main.js --name xcat-panel-api --update-env || PM2_HOME=/home/xcatpanel/.pm2 pm2 restart xcat-panel-api --update-env"
  sudo -u xcatpanel bash -lc "PM2_HOME=/home/xcatpanel/.pm2 pm2 save"
  env PATH="$PATH:/usr/bin" pm2 startup systemd -u xcatpanel --hp /home/xcatpanel >/tmp/xcat-pm2-startup.txt || true
  bash /tmp/xcat-pm2-startup.txt 2>/dev/null || true
}

configure_nginx() {
  log "A configurar Nginx"
  cat > "/etc/nginx/sites-available/${APP_NAME}.conf" <<EOF
server {
  listen 80;
  server_name ${DOMAIN};

  root ${APP_DIR}/apps/web/dist;
  index index.html;

  location /api/ {
    proxy_pass http://127.0.0.1:3101/api/;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }

  location / {
    try_files \$uri /index.html;
  }
}
EOF

  ln -sf "/etc/nginx/sites-available/${APP_NAME}.conf" "/etc/nginx/sites-enabled/${APP_NAME}.conf"
  nginx -t
  systemctl reload nginx

  if [ -n "$DOMAIN" ] && [ -n "$ADMIN_EMAIL" ]; then
    certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$ADMIN_EMAIL" || log "HTTPS nao configurado automaticamente. Verifica DNS/firewall."
  fi
}

main() {
  need_root
  ask_defaults
  install_packages
  create_user_and_dirs
  copy_bundle
  write_env
  build_apps
  create_initial_admin
  configure_pm2
  configure_nginx
  log "Instalacao concluida: ${PUBLIC_URL}"
}

main "$@"
