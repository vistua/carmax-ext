/**
 * CarMax Auctions Scraper — Background Service Worker
 */

'use strict';

const STORAGE_KEY = 'carmax_vehicles';

// ── Listen for messages from popup or content scripts ─────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {

  if (message.action === 'pageChanged') {
    // SPA navigation detected — nothing to do automatically
    // (popup will re-trigger scrape on demand)
    return;
  }

  if (message.action === 'saveVehicles') {
    saveVehicles(message.vehicles).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.action === 'loadVehicles') {
    loadVehicles().then(data => sendResponse({ vehicles: data }));
    return true;
  }

  if (message.action === 'clearVehicles') {
    chrome.storage.local.remove(STORAGE_KEY, () => sendResponse({ ok: true }));
    return true;
  }

  if (message.action === 'exportCSV') {
    loadVehicles().then(vehicles => {
      const csv = toCSV(vehicles);
      sendResponse({ csv });
    });
    return true;
  }
});

// ── Storage helpers ───────────────────────────────────────────────────────

async function saveVehicles(incoming) {
  const existing = await loadVehicles();
  // Merge by VIN; if no VIN use index as key
  const map = new Map();
  existing.forEach(v => map.set(v.vin || `idx-${v.index}`, v));
  incoming.forEach(v => {
    const key = v.vin || `idx-${v.index}-${Date.now()}`;
    map.set(key, { ...v, savedAt: new Date().toISOString() });
  });
  const merged = Array.from(map.values());
  await chrome.storage.local.set({ [STORAGE_KEY]: merged });
  return merged;
}

async function loadVehicles() {
  return new Promise(resolve => {
    chrome.storage.local.get(STORAGE_KEY, result => {
      resolve(result[STORAGE_KEY] || []);
    });
  });
}

// ── CSV export ────────────────────────────────────────────────────────────

function toCSV(vehicles) {
  if (!vehicles.length) return '';

  const COLUMNS = ['index','vin','year','make','model','trim','mileage','price',
                   'auctionDate','location','condition','color','link','savedAt'];

  const escape = val => {
    const s = String(val ?? '').replace(/"/g, '""');
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s;
  };

  const header = COLUMNS.join(',');
  const rows = vehicles.map(v => COLUMNS.map(col => escape(v[col])).join(','));
  return [header, ...rows].join('\n');
}
