#!/bin/sh
# Cria GuiaEstreias.wgt (pacote por assinar; o Samsung Jellyfin Installer assina-o ao instalar).
cd "$(dirname "$0")" && rm -f GuiaEstreias.wgt && zip -q -X GuiaEstreias.wgt config.xml index.html app.js style.css icon.png && echo "GuiaEstreias.wgt criado"
