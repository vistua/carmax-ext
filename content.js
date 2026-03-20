/**
 * CarMax Auctions - Content Script
 * Scrapes vehicle auction data from carmaxauctions.com
 */

(function () {
  'use strict';

  // ── Selector strategies for CarMax Auctions ──────────────────────────────
  // The site is a dealer-only SPA (likely React/Angular).
  // We try several selector patterns and fall back to heuristic text parsing.

  const SELECTORS = {
    // Auction listing containers (try multiple patterns)
    vehicleCard: [
      '[class*="vehicle-card"]',
      '[class*="VehicleCard"]',
      '[class*="auction-item"]',
      '[class*="AuctionItem"]',
      '[class*="car-card"]',
      '[class*="inventory-item"]',
      '[data-testid*="vehicle"]',
      '[data-testid*="auction"]',
      'article[class*="vehicle"]',
      'li[class*="vehicle"]',
      'div[class*="vehicle-tile"]',
      'div[class*="vehicle-row"]',
    ],

    // Inside a card
    vin:        ['[class*="vin"]', '[data-vin]', '[id*="vin"]'],
    year:       ['[class*="year"]', '[data-year]'],
    make:       ['[class*="make"]', '[data-make]'],
    model:      ['[class*="model"]', '[data-model]'],
    trim:       ['[class*="trim"]', '[data-trim]'],
    mileage:    ['[class*="mileage"]', '[class*="odometer"]', '[class*="miles"]'],
    price:      ['[class*="price"]', '[class*="bid"]', '[class*="amount"]'],
    auctionDate:['[class*="auction-date"]', '[class*="sale-date"]', '[class*="event-date"]', 'time'],
    location:   ['[class*="location"]', '[class*="auction-location"]', '[class*="lane"]'],
    condition:  ['[class*="condition"]', '[class*="grade"]'],
    color:      ['[class*="color"]', '[class*="exterior"]'],
    image:      ['img[src*="vehicle"]', 'img[src*="car"]', 'img[class*="vehicle"]'],
  };

  // ── Utilities ─────────────────────────────────────────────────────────────

  function firstText(el, selectorList) {
    for (const sel of selectorList) {
      const found = el.querySelector(sel);
      if (found) {
        const val = (found.getAttribute('data-value') ||
                     found.getAttribute('title') ||
                     found.innerText || '').trim();
        if (val) return val;
      }
    }
    return '';
  }

  function firstAttr(el, selectorList, attr) {
    for (const sel of selectorList) {
      const found = el.querySelector(sel);
      if (found && found.getAttribute(attr)) return found.getAttribute(attr).trim();
    }
    return '';
  }

  /**
   * Try to find VIN anywhere in an element's text (17-char alphanum).
   */
  function extractVIN(el) {
    const vinFromSel = firstText(el, SELECTORS.vin) ||
                       firstAttr(el, SELECTORS.vin, 'data-vin');
    if (vinFromSel && /^[A-HJ-NPR-Z0-9]{17}$/i.test(vinFromSel)) return vinFromSel.toUpperCase();

    const text = el.innerText || '';
    const match = text.match(/\b([A-HJ-NPR-Z0-9]{17})\b/i);
    return match ? match[1].toUpperCase() : '';
  }

  /**
   * Find the first container element that matches any selector in the list.
   */
  function findContainers() {
    for (const sel of SELECTORS.vehicleCard) {
      const els = Array.from(document.querySelectorAll(sel));
      if (els.length > 0) return els;
    }
    return [];
  }

  /**
   * Extract JSON-LD or embedded window.__INITIAL_STATE__ / window.__PRELOADED_STATE__
   * that some SPAs expose.
   */
  function extractEmbeddedData() {
    const results = [];

    // JSON-LD
    document.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
      try {
        const data = JSON.parse(s.textContent);
        const items = Array.isArray(data) ? data : [data];
        items.forEach(item => {
          if (item['@type'] === 'Car' || item['@type'] === 'Vehicle') {
            results.push({
              vin:         item.vehicleIdentificationNumber || '',
              year:        item.modelDate || item.vehicleModelDate || '',
              make:        item.brand?.name || item.manufacturer || '',
              model:       item.model || '',
              trim:        item.vehicleConfiguration || item.bodyType || '',
              mileage:     item.mileageFromOdometer?.value || '',
              price:       item.offers?.price || '',
              auctionDate: '',
              location:    '',
              condition:   item.itemCondition || '',
              color:       item.color || '',
              image:       item.image || '',
              source:      'json-ld',
            });
          }
        });
      } catch (_) {}
    });

    // Window state (common React/Next.js pattern)
    try {
      const stateKey = Object.keys(window).find(k =>
        k.includes('STATE') || k.includes('DATA') || k.includes('AUCTION')
      );
      if (stateKey && window[stateKey]) {
        const raw = JSON.stringify(window[stateKey]);
        // Look for VIN patterns in serialized state
        const vins = [...new Set(raw.match(/[A-HJ-NPR-Z0-9]{17}/gi) || [])];
        if (vins.length && results.length === 0) {
          // Return raw state hint for debugging
          results.push({ _rawStateVins: vins, source: 'window-state' });
        }
      }
    } catch (_) {}

    return results;
  }

  /**
   * Main scraping function — returns array of vehicle objects.
   */
  function scrapeVehicles() {
    // 1. Try embedded structured data first
    const embedded = extractEmbeddedData();
    if (embedded.length > 0 && !embedded[0]._rawStateVins) {
      return embedded;
    }

    // 2. Try DOM card selectors
    const containers = findContainers();
    if (containers.length === 0) {
      return { error: 'no_containers', message: 'Карточки автомобилей не найдены на странице. Убедитесь, что открыт список аукционов.' };
    }

    return containers.map((card, idx) => {
      const vin         = extractVIN(card);
      const year        = firstText(card, SELECTORS.year);
      const make        = firstText(card, SELECTORS.make);
      const model       = firstText(card, SELECTORS.model);
      const trim        = firstText(card, SELECTORS.trim);
      const mileage     = firstText(card, SELECTORS.mileage);
      const price       = firstText(card, SELECTORS.price);
      const auctionDate = firstText(card, SELECTORS.auctionDate);
      const location    = firstText(card, SELECTORS.location);
      const condition   = firstText(card, SELECTORS.condition);
      const color       = firstText(card, SELECTORS.color);
      const image       = firstAttr(card, SELECTORS.image, 'src');
      const link        = (card.querySelector('a[href*="/vehicle"], a[href*="/auction"]') || {}).href || '';

      // Fallback: try to parse year/make/model from title text
      const titleEl = card.querySelector('h1,h2,h3,h4,[class*="title"],[class*="heading"]');
      const titleText = titleEl ? titleEl.innerText.trim() : '';
      const titleMatch = titleText.match(/^(\d{4})\s+([A-Za-z]+)\s+(.+)$/);

      return {
        index:       idx + 1,
        vin:         vin || '',
        year:        year || (titleMatch ? titleMatch[1] : ''),
        make:        make || (titleMatch ? titleMatch[2] : ''),
        model:       model || (titleMatch ? titleMatch[3] : ''),
        trim,
        mileage,
        price,
        auctionDate,
        location,
        condition,
        color,
        image,
        link,
        titleFallback: titleText,
        source:      'dom',
      };
    });
  }

  /**
   * Auto-pagination: clicks "next page" or "load more" if present.
   * Returns true if it navigated.
   */
  function tryNextPage() {
    const nextSelectors = [
      'button[aria-label*="next" i]',
      'a[aria-label*="next" i]',
      '[class*="next-page"]',
      '[class*="nextPage"]',
      'button[class*="next"]',
      'a[rel="next"]',
      'button[class*="load-more"]',
      'button[class*="loadMore"]',
      '[data-testid*="next"]',
    ];
    for (const sel of nextSelectors) {
      const btn = document.querySelector(sel);
      if (btn && !btn.disabled) {
        btn.click();
        return true;
      }
    }
    return false;
  }

  // ── Message listener (from popup / background) ────────────────────────────

  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.action === 'scrape') {
      const vehicles = scrapeVehicles();
      sendResponse({ vehicles, url: window.location.href, timestamp: new Date().toISOString() });
    }

    if (request.action === 'nextPage') {
      const moved = tryNextPage();
      sendResponse({ moved });
    }

    if (request.action === 'ping') {
      sendResponse({ alive: true, url: window.location.href });
    }

    return true; // keep channel open for async
  });

  // ── Auto-detect page changes (SPA navigation) ────────────────────────────

  let lastPath = location.pathname;
  const observer = new MutationObserver(() => {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      chrome.runtime.sendMessage({ action: 'pageChanged', url: window.location.href }).catch(() => {});
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

})();
