# Testar o Xcat Panel numa VM Ubuntu

Este instalador ainda e uma primeira versao tecnica, boa para testar numa VM. Nao uses numa maquina de producao sem snapshot.

## Requisitos da VM

- Ubuntu Server 22.04 ou 24.04
- 4 GB RAM minimo, 8 GB recomendado
- 2 vCPU minimo
- 40 GB disco minimo
- acesso root/sudo
- rede com acesso a internet

## Preparar pacote no Windows

Na pasta deste projeto, cria um pacote:

```powershell
Compress-Archive -Path apps,catalog,install,templates,docs,README.md -DestinationPath xcat-panel-test.zip -Force
```

Depois envia para a VM. Exemplo:

```powershell
scp .\xcat-panel-test.zip utilizador@IP_DA_VM:/tmp/
```

## Instalar na VM

Dentro da VM:

```bash
cd /tmp
sudo apt-get update
sudo apt-get install -y unzip
unzip xcat-panel-test.zip -d xcat-panel-test
cd xcat-panel-test
sudo bash install/install.sh
```

O instalador vai pedir:

- dominio publico
- email do admin
- password do admin inicial

Para um teste local sem dominio, podes usar algo como:

```bash
sudo DOMAIN=teste.local ADMIN_EMAIL=admin@teste.local ADMIN_PASSWORD='UmaPasswordForte123' PUBLIC_URL=http://IP_DA_VM bash install/install.sh
```

Nota: sem dominio real apontado para a VM, o HTTPS automatico com Let's Encrypt nao vai funcionar. O painel pode mesmo assim ser testado por HTTP na rede local.

## Confirmar se subiu

```bash
curl http://127.0.0.1:3101/api/health
```

Se responder `online`, a API esta viva.

No browser:

```text
http://IP_DA_VM
```

## O que ainda falta para ficar instalador final

- criar admin inicial automaticamente
- configurar SMTP para recuperacao de password
- wizard visual de primeira configuracao
- migrar todos os jogos para templates oficiais
- mostrar logs/progresso de jobs no painel
- detetar e preparar discos pelo painel numa instalacao nova
