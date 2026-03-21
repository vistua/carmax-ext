#!/usr/bin/env node
/**
 * Build script — produces dist/unpacked/ for testing and dist/*.zip for CWS.
 * Usage:
 *   node scripts/build.js          → dist/unpacked/ only
 *   node scripts/build.js --zip    → dist/unpacked/ + dist/carmax-extension-vX.Y.Z.zip
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT  = path.resolve(__dirname, '..');
const DIST  = path.join(ROOT, 'dist');
const UNPACKED = path.join(DIST, 'unpacked');

const EXTENSION_FILES = [
  'manifest.json',
  'background.js',
  'content.js',
  'error-handler.js',
  'popup.html',
  'popup.js',
  'popup.css',
];

const SENTRY_DSN = process.env.SENTRY_DSN || '';

// ── Clean & prepare dist/unpacked ────────────────────────────────────────────

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(UNPACKED, { recursive: true });
fs.mkdirSync(path.join(UNPACKED, 'icons'), { recursive: true });

// Copy extension files, injecting SENTRY_DSN into error-handler.js
for (const file of EXTENSION_FILES) {
  const src = path.join(ROOT, file);
  const dst = path.join(UNPACKED, file);
  let content = fs.readFileSync(src, 'utf8');
  if (file === 'error-handler.js') {
    content = content.replace('__SENTRY_DSN__', JSON.stringify(SENTRY_DSN));
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, content);
}

// Copy icons
const iconsDir = path.join(ROOT, 'icons');
for (const icon of fs.readdirSync(iconsDir)) {
  fs.copyFileSync(
    path.join(iconsDir, icon),
    path.join(UNPACKED, 'icons', icon)
  );
}

const manifest = JSON.parse(fs.readFileSync(path.join(UNPACKED, 'manifest.json'), 'utf8'));
console.log(`✅ dist/unpacked/ built — v${manifest.version}`);

// ── Optionally create zip ─────────────────────────────────────────────────────

if (process.argv.includes('--zip')) {
  const archiver = require('archiver');
  const version  = manifest.version;
  const zipPath  = path.join(DIST, `carmax-extension-v${version}.zip`);
  const output   = fs.createWriteStream(zipPath);
  const archive  = archiver('zip', { zlib: { level: 9 } });

  archive.pipe(output);
  archive.directory(UNPACKED, false);

  output.on('close', () => {
    console.log(`📦 ${zipPath} — ${(archive.pointer() / 1024).toFixed(1)} KB`);
  });

  archive.finalize();
}
