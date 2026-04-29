# Xcat Panel

Painel privado para alojamento e gestao de servidores de jogos, voz e audio.

## Instalacao rapida numa VM Ubuntu

Num Ubuntu fresco, executa:

```bash
curl -fsSL https://raw.githubusercontent.com/Xcat2008/xcat-panel/main/install/bootstrap.sh | sudo bash
```

Para testar com valores ja definidos:

```bash
curl -fsSL https://raw.githubusercontent.com/Xcat2008/xcat-panel/main/install/bootstrap.sh | sudo DOMAIN=panel.exemplo.pt ADMIN_EMAIL=admin@exemplo.pt ADMIN_PASSWORD='MudaEstaPassword123' bash
```

## Variaveis aceites

```bash
DOMAIN=panel.exemplo.pt
PUBLIC_URL=https://panel.exemplo.pt
ADMIN_EMAIL=admin@exemplo.pt
ADMIN_NAME=Xcat
ADMIN_PASSWORD='password-forte'
APP_DIR=/opt/xcat-panel
DATA_DIR=/opt/xcat-panel/data
SERVER_DIR=/opt/xcat-panel/servers
NODE_MAJOR=22
REPO_URL=https://github.com/Xcat2008/xcat-panel.git
BRANCH=main
```

## Requisitos

- Ubuntu Server 22.04 ou 24.04
- 4 GB RAM minimo, 8 GB recomendado
- 2 vCPU minimo
- acesso root/sudo
- dominio apontado para a maquina, se quiseres HTTPS automatico

## Estado

Este instalador ainda esta em fase inicial. Ja prepara painel, API, Nginx, PM2 e admin inicial. A fase seguinte e estabilizar templates de jogos, jobs com progresso e SMTP para recuperacao de password.

## Estrutura

```text
apps/api     API Node.js
apps/web     Frontend React
install      Instalador automatico
templates    Templates de jogos/voz/audio
docs         Notas tecnicas e roadmap
```
