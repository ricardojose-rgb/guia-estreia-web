#!/bin/sh
# Cria Watchlist.wgt (pacote por assinar; o Samsung Jellyfin Installer assina-o ao instalar).
cd "$(dirname "$0")" && rm -f Watchlist.wgt && zip -q -X Watchlist.wgt config.xml index.html app.js style.css icon.png && echo "Watchlist.wgt criado"
