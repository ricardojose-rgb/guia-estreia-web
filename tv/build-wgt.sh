#!/bin/sh
# Cria Showrunner.wgt (pacote por assinar; o Samsung Jellyfin Installer assina-o ao instalar).
cd "$(dirname "$0")" && rm -f Showrunner.wgt && zip -q -X Showrunner.wgt config.xml index.html app.js style.css icon.png && echo "Showrunner.wgt criado"
