'use strict';

// ── DOM refs ──────────────────────────────────────────────────────────────
const btnScrape    = document.getElementById('btnScrape');
const btnScrapeAll = document.getElementById('btnScrapeAll');
const btnExportCSV = document.getElementById('btnExportCSV');
const btnExportJSON= document.getElementById('btnExportJSON');
const btnClear     = document.getElementById('btnClear');
const filterInput  = document.getElementById('filterInput');
const vehicleList  = document.getElementById('vehicleList');
const totalCount   = document.getElementById('totalCount');
const statusDot    = document.getElementById('statusDot');
const statusText   = document.getElementById('statusText');
const progressWrap = document.getElementById('progressWrap');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');

let allVehicles = [];
let activeTabId = null;
let scraping    = false;

// ── Init ──────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  // Load saved vehicles
  const stored = await bg('loadVehicles');
  if (stored?.vehicles?.length) {
    allVehicles = stored.vehicles;
    renderList();
    updateCount();
    setFooterEnabled(true);
  }

  // Check current tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  activeTabId = tab.id;

  const isCarMax = tab.url?.includes('carmaxauctions.com');
  if (isCarMax) {
    pingContentScript(tab.id);
  } else {
    setStatus('error', `Открыт не тот сайт: ${new URL(tab.url || 'about:blank').hostname}`);
  }
});

// ── Ping content script ───────────────────────────────────────────────────

async function pingContentScript(tabId) {
  try {
    const resp = await sendToContent(tabId, { action: 'ping' });
    if (resp?.alive) {
      setStatus('ok', 'Сайт открыт, готов к сбору данных');
      btnScrape.disabled    = false;
      btnScrapeAll.disabled = false;
    }
  } catch (e) {
    // Content script not yet injected — inject manually
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      setStatus('ok', 'Скрипт внедрён, готов к сбору данных');
      btnScrape.disabled    = false;
      btnScrapeAll.disabled = false;
    } catch (e2) {
      setStatus('error', 'Не удалось подключиться. Обновите страницу.');
    }
  }
}

// ── Scrape current page ───────────────────────────────────────────────────

btnScrape.addEventListener('click', async () => {
  if (scraping || !activeTabId) return;
  await scrapePage(activeTabId);
});

async function scrapePage(tabId) {
  setScraping(true);
  setStatus('busy', 'Сканирую страницу…');
  try {
    const resp = await sendToContent(tabId, { action: 'scrape' });
    if (!resp) throw new Error('Нет ответа от страницы');

    const vehicles = resp.vehicles;
    if (vehicles?.error) {
      setStatus('error', vehicles.message || 'Ошибка парсинга');
      setScraping(false);
      return;
    }

    if (!Array.isArray(vehicles) || vehicles.length === 0) {
      setStatus('warn', 'Автомобили не найдены на этой странице');
      setScraping(false);
      return;
    }

    await bg('saveVehicles', { vehicles });
    const stored = await bg('loadVehicles');
    allVehicles = stored.vehicles;
    renderList();
    updateCount();
    setFooterEnabled(true);
    setStatus('ok', `Собрано ${vehicles.length} авто с этой страницы`);
  } catch (e) {
    setStatus('error', `Ошибка: ${e.message}`);
  }
  setScraping(false);
}

// ── Scrape all pages ──────────────────────────────────────────────────────

btnScrapeAll.addEventListener('click', async () => {
  if (scraping || !activeTabId) return;
  setScraping(true);
  showProgress(true);
  setStatus('busy', 'Сканирую все страницы…');

  let page = 1;
  let moved = true;

  while (moved) {
    setProgressText(`Страница ${page}…`);
    setProgressFill(Math.min(page * 10, 90));

    const resp = await sendToContent(activeTabId, { action: 'scrape' });
    const vehicles = resp?.vehicles;

    if (Array.isArray(vehicles) && vehicles.length > 0) {
      await bg('saveVehicles', { vehicles });
    }

    // Try to go to the next page
    const navResp = await sendToContent(activeTabId, { action: 'nextPage' });
    moved = navResp?.moved === true;

    if (moved) {
      page++;
      // Wait for page to render (SPA)
      await sleep(2000);
    }
  }

  const stored = await bg('loadVehicles');
  allVehicles = stored.vehicles;
  renderList();
  updateCount();
  setFooterEnabled(true);
  setProgressFill(100);
  setStatus('ok', `Готово! Всего ${allVehicles.length} авто за ${page} стр.`);
  setScraping(false);
  setTimeout(() => showProgress(false), 1500);
});

// ── Export ────────────────────────────────────────────────────────────────

btnExportCSV.addEventListener('click', async () => {
  const { csv } = await bg('exportCSV');
  if (!csv) return;
  downloadFile(csv, 'carmax_auction.csv', 'text/csv');
});

btnExportJSON.addEventListener('click', () => {
  const json = JSON.stringify(allVehicles, null, 2);
  downloadFile(json, 'carmax_auction.json', 'application/json');
});

// ── Clear ─────────────────────────────────────────────────────────────────

btnClear.addEventListener('click', async () => {
  if (!confirm('Удалить все собранные данные?')) return;
  await bg('clearVehicles');
  allVehicles = [];
  renderList();
  updateCount();
  setFooterEnabled(false);
  setStatus('ok', 'Данные очищены');
});

// ── Filter ────────────────────────────────────────────────────────────────

filterInput.addEventListener('input', renderList);

// ── Render ────────────────────────────────────────────────────────────────

function renderList() {
  const q = filterInput.value.toLowerCase().trim();
  const filtered = q
    ? allVehicles.filter(v =>
        [v.vin, v.year, v.make, v.model, v.trim, v.location, v.color]
          .join(' ').toLowerCase().includes(q)
      )
    : allVehicles;

  if (filtered.length === 0) {
    vehicleList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">${q ? '🔍' : '🏁'}</div>
        <p>${q ? 'Ничего не найдено' : 'Данных пока нет.<br>Войдите на сайт и нажмите «Собрать данные».'}</p>
      </div>`;
    return;
  }

  vehicleList.innerHTML = filtered.map(v => renderCard(v)).join('');
}

function renderCard(v) {
  const title = [v.year, v.make, v.model, v.trim].filter(Boolean).join(' ') || v.titleFallback || '—';
  const price  = v.price ? `<span class="v-price">${v.price}</span>` : '';
  const link   = v.link  ? `<a href="${v.link}" target="_blank">🔗 Открыть</a>` : '';

  const tags = [
    v.vin         && { icon: '🔑', label: 'VIN',     val: v.vin },
    v.mileage     && { icon: '🛣',  label: 'Пробег',  val: v.mileage },
    v.auctionDate && { icon: '📅',  label: 'Дата',    val: v.auctionDate },
    v.location    && { icon: '📍',  label: 'Место',   val: v.location },
    v.condition   && { icon: '⭐',  label: 'Сост.',   val: v.condition },
    v.color       && { icon: '🎨',  label: 'Цвет',    val: v.color },
    link          && { icon: '',    label: '',         val: link, raw: true },
  ].filter(Boolean);

  const tagsHtml = tags.map(t =>
    t.raw ? `<span class="v-tag">${t.val}</span>` :
            `<span class="v-tag">${t.icon} <strong>${t.label}:</strong>&nbsp;${esc(t.val)}</span>`
  ).join('');

  return `
    <div class="v-card">
      <div class="v-header">
        <span class="v-title">${esc(title)}</span>
        ${price}
      </div>
      <div class="v-meta">${tagsHtml}</div>
    </div>`;
}

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Helpers ───────────────────────────────────────────────────────────────

function updateCount() {
  totalCount.textContent = `${allVehicles.length} авто`;
}

function setStatus(type, msg) {
  statusDot.className = `status-dot ${type === 'ok' ? 'ok' : type === 'busy' ? 'busy' : type === 'warn' ? 'ok' : 'error'}`;
  statusText.textContent = msg;
}

function setScraping(val) {
  scraping = val;
  btnScrape.disabled    = val;
  btnScrapeAll.disabled = val;
}

function setFooterEnabled(val) {
  btnExportCSV.disabled = !val;
  btnExportJSON.disabled= !val;
  btnClear.disabled     = !val;
}

function showProgress(val) {
  progressWrap.style.display = val ? 'flex' : 'none';
  if (!val) { progressFill.style.width = '0%'; }
}

function setProgressFill(pct) {
  progressFill.style.width = `${pct}%`;
}

function setProgressText(msg) {
  progressText.textContent = msg;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function downloadFile(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function sendToContent(tabId, msg) {
  return chrome.tabs.sendMessage(tabId, msg);
}

function bg(action, extra = {}) {
  return chrome.runtime.sendMessage({ action, ...extra });
}
