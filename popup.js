'use strict';

// ── DOM refs ──────────────────────────────────────────────────────────────
const btnScrape    = document.getElementById('btnScrape');
const btnScrapeAll = document.getElementById('btnScrapeAll');
const btnExportCSV = document.getElementById('btnExportCSV');
const btnExportJSON= document.getElementById('btnExportJSON');
const btnClear     = document.getElementById('btnClear');
const btnLoadAuctions = document.getElementById('btnLoadAuctions');
const filterInput  = document.getElementById('filterInput');
const vehicleList  = document.getElementById('vehicleList');
const totalCount   = document.getElementById('totalCount');
const statusDot    = document.getElementById('statusDot');
const statusText   = document.getElementById('statusText');
const progressWrap = document.getElementById('progressWrap');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const auctionSection = document.getElementById('auctionSection');
const auctionSelect  = document.getElementById('auctionSelect');

let allVehicles  = [];
let activeTabId  = null;
let scraping     = false;
let auctionsList = []; // { name, url }

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
      loadAuctions(tabId);
    }
  } catch (e) {
    // Content script not yet injected — inject manually
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      setStatus('ok', 'Скрипт внедрён, готов к сбору данных');
      btnScrape.disabled    = false;
      btnScrapeAll.disabled = false;
      loadAuctions(tabId);
    } catch (e2) {
      setStatus('error', 'Не удалось подключиться. Обновите страницу.');
    }
  }
}

// ── Auction selector ──────────────────────────────────────────────────────

async function loadAuctions(tabId) {
  try {
    const resp = await sendToContent(tabId, { action: 'getAuctions' });
    if (!resp?.auctions) return;
    auctionsList = resp.auctions;
    renderAuctionSelect();
  } catch (_) {}
}

function renderAuctionSelect() {
  auctionSelect.innerHTML = '<option value="">— Все аукционы —</option>';
  auctionsList.forEach((a, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = a.name;
    auctionSelect.appendChild(opt);
  });
  auctionSection.style.display = auctionsList.length > 0 ? 'block' : 'none';
}

function getSelectedAuction() {
  const idx = auctionSelect.value;
  return idx !== '' ? auctionsList[parseInt(idx)] : null;
}

// Navigate tab to auction URL and wait for load
function navigateAndWait(tabId, url) {
  return new Promise((resolve) => {
    function onUpdated(tid, changeInfo) {
      if (tid === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.update(tabId, { url });
    // Safety timeout
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    }, 8000);
  });
}

btnLoadAuctions.addEventListener('click', () => {
  if (activeTabId) loadAuctions(activeTabId);
});

// Click "View Cars" on auction page and wait for the car list to load
async function tryViewCars(tabId) {
  try {
    const resp = await sendToContent(tabId, { action: 'viewCars' });
    if (resp?.clicked) {
      setStatus('busy', `Открываю список машин (${resp.text})…`);
      await sleep(2500); // wait for SPA to render car list
      return true;
    }
  } catch (_) {}
  return false;
}

auctionSelect.addEventListener('change', async () => {
  const auction = getSelectedAuction();
  if (!auction || !auction.url) return;

  // Navigate tab to auction URL if it has one
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  const currentUrl = tab.url || '';
  const targetUrl  = auction.url;

  if (targetUrl && !currentUrl.startsWith(targetUrl) && targetUrl !== currentUrl) {
    setStatus('busy', `Перехожу к аукциону "${auction.name}"…`);
    btnScrape.disabled    = true;
    btnScrapeAll.disabled = true;
    await navigateAndWait(tab.id, targetUrl);
    // Re-inject content script after navigation
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    } catch (_) {}
    await sleep(800);
    await tryViewCars(tab.id);
    setStatus('ok', `Аукцион: ${auction.name} — готов к сбору`);
    btnScrape.disabled    = false;
    btnScrapeAll.disabled = false;
  }
});

// ── Scrape current page ───────────────────────────────────────────────────

btnScrape.addEventListener('click', async () => {
  if (scraping || !activeTabId) return;
  await scrapePage(activeTabId);
});

async function scrapePage(tabId) {
  setScraping(true);
  setStatus('busy', 'Сканирую страницу…');
  const auction = getSelectedAuction();
  try {
    const msg = { action: 'scrape' };
    if (auction && !auction.url) msg.auctionFilter = auction.name;
    const resp = await sendToContent(tabId, msg);
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

  const auction = getSelectedAuction();

  // If selected auction has a URL, navigate there first
  if (auction?.url) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url !== auction.url && !tab.url.startsWith(auction.url)) {
      setStatus('busy', `Перехожу к аукциону "${auction.name}"…`);
      await navigateAndWait(tab.id, auction.url);
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      } catch (_) {}
      await sleep(800);
    }
  }

  // Click "View Cars" if present on the auction landing page
  setStatus('busy', 'Ищу кнопку "View Cars"…');
  const clicked = await tryViewCars(activeTabId);
  if (!clicked) await sleep(500); // short wait even if no button found

  setStatus('busy', auction ? `Сканирую "${auction.name}"…` : 'Сканирую все страницы…');

  let page = 1;
  let moved = true;
  const scrapeMsg = { action: 'scrape' };
  if (auction && !auction.url) scrapeMsg.auctionFilter = auction.name;

  while (moved) {
    setProgressText(`Страница ${page}…`);
    setProgressFill(Math.min(page * 10, 90));

    const resp = await sendToContent(activeTabId, scrapeMsg);
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
  const auctionLabel = auction ? ` (${auction.name})` : '';
  setStatus('ok', `Готово!${auctionLabel} Всего ${allVehicles.length} авто за ${page} стр.`);
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
