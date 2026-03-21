#!/bin/bash
# CarMax Extension — auto-updater
# Runs on Mac, checks GitHub for updates every hour

INSTALL_URL="https://raw.githubusercontent.com/vistua/carmax-ext/main/install-mac.sh"
HASH_FILE="$HOME/.carmax-ext-hash"

CURRENT_HASH=$(curl -sf "$INSTALL_URL" | shasum -a 256 | awk '{print $1}')
STORED_HASH=$(cat "$HASH_FILE" 2>/dev/null || echo "")

if [ "$CURRENT_HASH" != "$STORED_HASH" ]; then
  echo "🔄 Новая версия — обновляю..."
  curl -sf "$INSTALL_URL" | bash
  echo "$CURRENT_HASH" > "$HASH_FILE"
  echo "✅ Обновлено $(date)"
else
  echo "✅ Уже актуально $(date)"
fi
