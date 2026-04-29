# Templates de servicos

Esta pasta e a base para transformar jogos e servicos em instaladores reutilizaveis.

Cada template deve ter:

```text
templates/<service-id>/
  manifest.json
  install.sh
  start.sh
  stop.sh
  update.sh
  health.sh
  image.webp
```

Regras:

- Cada servidor criado tem uma pasta propria.
- O template nunca deve escrever fora da pasta do servidor, exceto caches globais aprovadas.
- Todos os scripts recebem variaveis pelo ambiente:
  - `SERVER_ID`
  - `SERVER_PATH`
  - `GAME_PATH`
  - `DATA_PATH`
  - `CONFIG_JSON`
  - `LOG_PATH`
  - `PORT`
- Os scripts devem escrever mensagens claras no log.
- O start deve gravar PID quando possivel.
- O health deve devolver codigo 0 quando o servidor esta online.

