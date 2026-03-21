/**
 * CarMax Extension — Centralized Error Handler
 * Loaded in all execution contexts: background SW, content script, popup.
 * Usage: carmaxError.capture(err, { action: 'scrape', context: 'popup' })
 */
(function () {
  'use strict';

  // Injected at build time by scripts/build.js (replaces __SENTRY_DSN__)
  const SENTRY_DSN = typeof __SENTRY_DSN__ !== 'undefined' ? __SENTRY_DSN__ : null;

  function capture(err, meta = {}) {
    const entry = {
      message: err?.message || String(err),
      stack:   err?.stack   || '',
      meta,
      version: _version(),
      context: _context(),
      ts:      new Date().toISOString(),
    };

    console.error('[CarMax]', entry.message, entry);

    if (SENTRY_DSN) {
      _sendSentry(entry).catch(() => {});
    }
  }

  function _version() {
    try { return chrome.runtime.getManifest().version; } catch (_) { return 'unknown'; }
  }

  function _context() {
    if (typeof window === 'undefined') return 'service-worker';
    if (location.pathname.includes('popup'))   return 'popup';
    if (location.protocol === 'chrome-extension:') return 'extension-page';
    return 'content-script';
  }

  async function _sendSentry(entry) {
    // Minimal Sentry store POST — no SDK needed, keeps extension lean
    const match = SENTRY_DSN.match(/https:\/\/([^@]+)@([^/]+)\/(\d+)/);
    if (!match) return;
    const [, key, host, projectId] = match;
    await fetch(`https://${host}/api/${projectId}/store/`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${key}`,
      },
      body: JSON.stringify({
        platform:    'javascript',
        level:       'error',
        message:     entry.message,
        extra:       entry,
        tags:        { context: entry.context, version: entry.version },
        timestamp:   entry.ts,
      }),
    });
  }

  // Global uncaught error handlers (active in popup and content script contexts)
  if (typeof window !== 'undefined') {
    window.addEventListener('error', e => {
      capture(e.error || new Error(e.message), { type: 'uncaught', source: e.filename });
    });
    window.addEventListener('unhandledrejection', e => {
      capture(e.reason instanceof Error ? e.reason : new Error(String(e.reason)),
              { type: 'unhandledrejection' });
    });
  }

  globalThis.carmaxError = { capture };
})();
