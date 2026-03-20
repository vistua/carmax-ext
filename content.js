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
   * Find and click a "View Cars" button on the auction/location page.
   * Handles CarMax's yellow "View cars" button in the "Next auction" section.
   * Returns { clicked, text, href }.
   */
  function clickViewCars() {
    // Normalize text for comparison
    function norm(s) {
      return (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    const VIEW_CARS_PATTERNS = [
      /^view\s+cars?$/i,
      /^view\s+vehicles?$/i,
      /^view\s+inventory$/i,
      /^view\s+lots?$/i,
      /^view\s+all$/i,
      /^see\s+cars?$/i,
      /^browse\s+(cars?|vehicles?)$/i,
      /^shop\s+cars?$/i,
    ];

    function matches(el) {
      const text  = norm(el.innerText || el.textContent || '');
      const label = norm(el.getAttribute('aria-label') || '');
      return VIEW_CARS_PATTERNS.some(p => p.test(text) || p.test(label));
    }

    // 1. Search inside "Next auction" section first (most specific)
    const nextSection = document.querySelector(
      '[class*="next-auction"], [class*="NextAuction"], ' +
      '[class*="upcoming"], [class*="Upcoming"], ' +
      'section, article, div'
    );
    // Walk all sections, find one that contains "Next auction" heading
    const allSections = Array.from(document.querySelectorAll('section, [class*="section"], [class*="Section"], article, div[class]'));
    for (const section of allSections) {
      const heading = section.querySelector('h1,h2,h3,h4');
      if (heading && /next\s+auction/i.test(heading.innerText || '')) {
        const btn = Array.from(section.querySelectorAll('button, a, [role="button"]')).find(matches);
        if (btn) {
          btn.scrollIntoView({ behavior: 'instant', block: 'center' });
          btn.click();
          return { clicked: true, text: (btn.innerText || btn.textContent || '').trim(), href: btn.href || '' };
        }
      }
    }

    // 2. General search across all clickable elements
    const candidates = Array.from(
      document.querySelectorAll('button, a[href], [role="button"]')
    );
    const found = candidates.find(matches);
    if (found) {
      found.scrollIntoView({ behavior: 'instant', block: 'center' });
      found.click();
      return { clicked: true, text: (found.innerText || found.textContent || '').trim(), href: found.href || '' };
    }

    // 3. data-testid fallback
    const dataEl = document.querySelector(
      '[data-testid*="view-car"], [data-testid*="viewCar"], [data-testid*="view-vehicle"], [data-testid*="viewVehicle"]'
    );
    if (dataEl) {
      dataEl.click();
      return { clicked: true, text: (dataEl.innerText || '').trim(), href: dataEl.href || '' };
    }

    return { clicked: false };
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

  /**
   * Find available auctions (events/locations) on the current page.
   * Returns array of { name, url } objects.
   */
  function findAuctions() {
    const auctions = [];
    const seen = new Set();

    function add(name, url) {
      const key = name.toLowerCase().trim();
      if (!key || key.length < 2 || key.length > 80 || seen.has(key)) return;
      // Skip generic nav labels
      if (/^(home|about|help|login|sign in|log out|register|dashboard|profile|contact|faq|terms|privacy|back|next|close|menu|search)$/i.test(key)) return;
      seen.add(key);
      auctions.push({ name: name.trim(), url: url || '' });
    }

    // Strategy 1: Links with auction/location/event in href
    const hrefPatterns = [
      'a[href*="/auction/"]',
      'a[href*="/auctions/"]',
      'a[href*="/location/"]',
      'a[href*="/locations/"]',
      'a[href*="/event/"]',
      'a[href*="/events/"]',
      'a[href*="/sale/"]',
    ];
    for (const sel of hrefPatterns) {
      document.querySelectorAll(sel).forEach(el => {
        const name = (el.innerText || el.textContent || '').trim();
        add(name || el.href, el.href);
      });
    }

    // Strategy 2: Elements with auction/location class names
    if (auctions.length === 0) {
      const classPatterns = [
        '[class*="auction-item"] a',
        '[class*="AuctionItem"] a',
        '[class*="auction-nav"] a',
        '[class*="location-nav"] a',
        '[class*="event-item"] a',
        '[class*="schedule-item"] a',
        '[class*="auction-list"] li a',
        '[class*="location-list"] li a',
        '[class*="event-list"] li a',
        '[class*="AuctionList"] a',
        '[class*="LocationList"] a',
      ];
      for (const sel of classPatterns) {
        document.querySelectorAll(sel).forEach(el => {
          const name = (el.innerText || el.textContent || '').trim();
          add(name, el.href);
        });
        if (auctions.length > 0) break;
      }
    }

    // Strategy 3: Select/option dropdowns for location/auction
    if (auctions.length === 0) {
      const selects = document.querySelectorAll(
        'select[class*="auction"], select[class*="location"], select[id*="auction"], select[id*="location"]'
      );
      selects.forEach(sel => {
        Array.from(sel.options).forEach(opt => {
          if (opt.value && opt.text && opt.text.trim() !== '') {
            add(opt.text, opt.value.startsWith('http') ? opt.value : '');
          }
        });
      });
    }

    // Strategy 4: Tab/button rows for auction sections
    if (auctions.length === 0) {
      const tabSels = [
        '[role="tab"]',
        '[class*="tab-item"]',
        '[class*="TabItem"]',
        '[class*="auction-tab"]',
        '[class*="location-tab"]',
      ];
      for (const sel of tabSels) {
        document.querySelectorAll(sel).forEach(el => {
          const name = (el.innerText || el.textContent || '').trim();
          add(name, el.href || '');
        });
        if (auctions.length > 0) break;
      }
    }

    // Strategy 5: Extract unique locations from visible vehicle cards
    if (auctions.length === 0) {
      const vehicles = scrapeVehicles();
      if (Array.isArray(vehicles)) {
        vehicles.forEach(v => {
          if (v.location) add(v.location, '');
        });
      }
    }

    return auctions;
  }

  // ── Message listener (from popup / background) ────────────────────────────

  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.action === 'scrape') {
      let vehicles = scrapeVehicles();
      // Filter by auction location if requested
      if (request.auctionFilter && Array.isArray(vehicles)) {
        const f = request.auctionFilter.toLowerCase();
        vehicles = vehicles.filter(v =>
          (v.location || '').toLowerCase().includes(f) ||
          (v.auctionDate || '').toLowerCase().includes(f)
        );
      }
      sendResponse({ vehicles, url: window.location.href, timestamp: new Date().toISOString() });
    }

    if (request.action === 'nextPage') {
      const moved = tryNextPage();
      sendResponse({ moved });
    }

    if (request.action === 'ping') {
      sendResponse({ alive: true, url: window.location.href });
    }

    if (request.action === 'getAuctions') {
      sendResponse({ auctions: findAuctions(), url: window.location.href });
    }

    if (request.action === 'viewCars') {
      const result = clickViewCars();
      sendResponse(result);
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
