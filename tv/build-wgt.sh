#!/bin/sh
# Cria EstreiasTV.wgt (pacote por assinar; o Samsung Jellyfin Installer assina-o ao instalar).
cd "$(dirname "$0")" && rm -f EstreiasTV.wgt && zip -q -X EstreiasTV.wgt config.xml index.html app.js style.css icon.png && echo "EstreiasTV.wgt criado"
