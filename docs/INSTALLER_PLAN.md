# Xcat Panel installer plan

Objetivo: transformar o painel num produto instalavel em qualquer maquina Ubuntu, com instalacao do painel, deteccao de discos, templates de jogos/voz, progresso visivel e recuperacao segura.

## Visao geral

O painel deve ficar dividido em 4 camadas:

1. Core panel
   - API Node.js
   - Web React compilado
   - Nginx reverse proxy
   - PM2/systemd para manter a API online
   - dados em `/opt/xcat-panel`

2. Storage manager
   - deteta discos e particoes
   - permite escolher destinos sem escrever caminhos
   - cria/monta discos novos quando autorizado pelo admin
   - cada servidor fica numa pasta isolada

3. Template engine
   - cada jogo/servico tem um manifest proprio
   - define recursos, portas, campos de configuracao, imagem e comandos
   - cada servidor criado recebe uma copia isolada da instalacao/config

4. Job runner
   - instala, atualiza, inicia, para e apaga servidores em tarefas com progresso
   - guarda logs por tarefa
   - mostra estado em direto no painel

## Melhor que OpenGamePanel

- Instalador guiado com dominio, HTTPS, admin inicial e disco de dados.
- Templates com imagens, requisitos e configs editaveis.
- Progresso real de instalacao/start/update no painel.
- Separacao clara entre painel e servidores.
- Multi-destino: SSD para painel, HDD/SSD grande para servidores.
- Cada servidor com dono, portas e pasta propria.
- Export/import de configuracao para migrar para outra maquina.
- Verificacoes antes de instalar: RAM, disco livre, portas ocupadas, dependencias.
- Reparacao automatica: botao "Diagnosticar" por servidor.

## Instalador base

Fluxo previsto:

1. Validar Ubuntu 22.04/24.04.
2. Instalar dependencias:
   - Node.js LTS
   - npm
   - nginx
   - certbot
   - pm2
   - steamcmd
   - unzip, tar, curl, jq
3. Criar utilizador de sistema `xcatpanel`.
4. Criar diretorios:
   - `/opt/xcat-panel/apps/api`
   - `/opt/xcat-panel/apps/web`
   - `/opt/xcat-panel/data`
   - `/opt/xcat-panel/templates`
   - `/opt/xcat-panel/servers`
5. Configurar `.env` da API.
6. Compilar frontend.
7. Configurar PM2/systemd.
8. Configurar Nginx e HTTPS.
9. Criar admin inicial.
10. Abrir apenas portas necessarias.

## Template engine

Cada template deve ter:

```json
{
  "id": "satisfactory",
  "name": "Satisfactory",
  "type": "game",
  "image": "/assets/catalog/satisfactory.webp",
  "installer": "steamcmd",
  "steam": {
    "appId": "1690800",
    "anonymous": true
  },
  "ports": [
    { "name": "Game", "default": 7777, "protocol": "udp" },
    { "name": "Beacon", "default": 15000, "protocol": "udp" },
    { "name": "Query", "default": 15777, "protocol": "udp" }
  ],
  "resources": {
    "ramMb": 8192,
    "diskMb": 20000,
    "cpuLimit": 200
  },
  "commands": {
    "install": "templates/satisfactory/install.sh",
    "start": "templates/satisfactory/start.sh",
    "stop": "templates/common/stop-by-pid.sh",
    "update": "templates/satisfactory/update.sh",
    "health": "templates/satisfactory/health.sh"
  },
  "configSchema": [
    { "key": "serverName", "label": "Nome", "type": "text", "default": "Satisfactory Factory" },
    { "key": "maxPlayers", "label": "Slots", "type": "number", "default": 4 },
    { "key": "password", "label": "Password", "type": "password", "default": "" }
  ]
}
```

## Isolamento por servidor

Cada servidor deve ter esta estrutura:

```text
/mnt/gameforge-storage/servers/<server-id>/
  config.json
  status.json
  install.log
  console.log
  files/
    game/
    data/
    scripts/
```

Nada deve partilhar configs com outro servidor. SteamCMD pode usar cache global no futuro, mas a pasta final do jogo deve ser sempre isolada.

## Progresso real no painel

Cada acao cria um job:

```json
{
  "id": "job_...",
  "serverId": "...",
  "action": "install",
  "status": "running",
  "step": "steamcmd",
  "percent": 45,
  "message": "A descarregar ficheiros do jogo",
  "logPath": "/opt/xcat-panel/data/jobs/job_...log"
}
```

O frontend deve consultar `/api/jobs/:id` a cada 1-2 segundos e mostrar:

- fase atual
- percentagem
- ultimas linhas do log
- erro claro se falhar
- botao "Ver diagnostico"

## Recuperacao de password

O fluxo ja existe no painel, mas falta SMTP. Para ficar completo o instalador deve pedir:

- host SMTP
- porta
- user
- password/app password
- email remetente

Se o admin nao configurar SMTP, o painel deve mostrar "email nao configurado" e permitir copiar link apenas para admins.

## Roadmap pratico

Fase 1:
- Criar instalador base.
- Criar formato oficial de templates.
- Guardar jobs com progresso.
- Adicionar imagens ao catalogo.

Fase 2:
- Migrar CS2, TeamSpeak, SinusBot e Satisfactory para templates reais.
- Corrigir Satisfactory com portas corretas e log de arranque.
- Adicionar "Diagnosticar servidor".

Fase 3:
- Export/import do painel.
- Instalador offline em ficheiro `.tar.gz`.
- Atualizador do proprio painel.

