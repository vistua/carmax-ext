#!/bin/bash
# CarMax Extension — автообновление из git + перезагрузка в Chrome

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "⬇  Получаю обновления..."
cd "$SCRIPT_DIR"
git pull origin claude/chrome-auction-scraper-ZKir4

echo "🔄 Перезагружаю расширение в Chrome..."

# Перезагружаем расширение через AppleScript
osascript <<'APPLESCRIPT'
tell application "Google Chrome"
  set ext_url to "chrome://extensions/"

  -- Ищем вкладку с extensions, если нет — открываем
  set found to false
  repeat with w in windows
    repeat with t in tabs of w
      if URL of t starts with "chrome://extensions" then
        set active tab of w to t
        set index of w to 1
        set found to true
        exit repeat
      end if
    end repeat
    if found then exit repeat
  end repeat

  if not found then
    tell front window
      set newTab to make new tab with properties {URL: ext_url}
      set active tab to newTab
    end tell
    delay 1
  end if

  -- Нажимаем кнопку обновления (reload) на всех расширениях
  tell active tab of front window
    execute javascript "
      document.querySelectorAll('extensions-manager, extensions-item-list, extensions-item').forEach(el => {
        const shadow = el.shadowRoot;
        if (shadow) {
          const reload = shadow.querySelector('#reload-button, cr-icon-button[id*=reload], .reload-button');
          if (reload) reload.click();
        }
      });
      // Универсальный метод через DevTools extension API
      chrome.runtime.reload && chrome.runtime.reload();
    "
  end tell
end tell
APPLESCRIPT

echo "✅ Готово! Расширение обновлено."
