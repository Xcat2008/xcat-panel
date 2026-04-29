#!/usr/bin/env bash
set -Eeuo pipefail

REPO_URL="${REPO_URL:-https://github.com/Xcat2008/xcat-panel.git}"
BRANCH="${BRANCH:-main}"
WORKDIR="${WORKDIR:-/tmp/xcat-panel-install}"

log() {
  printf '\033[1;36m[xcat-bootstrap]\033[0m %s\n' "$*"
}

fail() {
  printf '\033[1;31m[xcat-bootstrap]\033[0m %s\n' "$*" >&2
  exit 1
}

if [ "$(id -u)" -ne 0 ]; then
  fail "Executa com sudo/root."
fi

log "A instalar dependencias minimas"
apt-get update
apt-get install -y git ca-certificates curl

log "A descarregar Xcat Panel de ${REPO_URL} (${BRANCH})"
rm -rf "$WORKDIR"
git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$WORKDIR"

if [ ! -f "$WORKDIR/install/install.sh" ]; then
  fail "Repositorio invalido: falta install/install.sh"
fi

log "A iniciar instalador principal"
cd "$WORKDIR"
bash install/install.sh

