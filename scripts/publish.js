#!/usr/bin/env node
/**
 * Publish to Chrome Web Store via API.
 * Requires these env vars (set as GitHub Secrets):
 *   CHROME_EXTENSION_ID   — from developer dashboard
 *   CHROME_CLIENT_ID      — OAuth2 client ID (Google Cloud Console)
 *   CHROME_CLIENT_SECRET  — OAuth2 client secret
 *   CHROME_REFRESH_TOKEN  — one-time OAuth2 flow; stored permanently
 *
 * First-time setup: run scripts/get-refresh-token.js locally.
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const {
  CHROME_EXTENSION_ID,
  CHROME_CLIENT_ID,
  CHROME_CLIENT_SECRET,
  CHROME_REFRESH_TOKEN,
} = process.env;

for (const [k, v] of Object.entries({ CHROME_EXTENSION_ID, CHROME_CLIENT_ID, CHROME_CLIENT_SECRET, CHROME_REFRESH_TOKEN })) {
  if (!v) { console.error(`Missing env var: ${k}`); process.exit(1); }
}

async function getAccessToken() {
  const body = new URLSearchParams({
    client_id:     CHROME_CLIENT_ID,
    client_secret: CHROME_CLIENT_SECRET,
    refresh_token: CHROME_REFRESH_TOKEN,
    grant_type:    'refresh_token',
  });
  const res  = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Token error: ${JSON.stringify(data)}`);
  return data.access_token;
}

async function uploadZip(token, zipPath) {
  console.log(`Uploading ${path.basename(zipPath)}…`);
  const buf = fs.readFileSync(zipPath);
  const res = await fetch(
    `https://www.googleapis.com/upload/chromewebstore/v1.1/items/${CHROME_EXTENSION_ID}?uploadType=media`,
    {
      method:  'PUT',
      headers: { Authorization: `Bearer ${token}`, 'x-goog-api-version': '2', 'Content-Type': 'application/zip' },
      body:    buf,
    }
  );
  const data = await res.json();
  if (data.uploadState !== 'SUCCESS') throw new Error(`Upload failed: ${JSON.stringify(data)}`);
  console.log('✅ Upload successful');
}

async function publish(token) {
  console.log('Publishing…');
  const res = await fetch(
    `https://www.googleapis.com/chromewebstore/v1.1/items/${CHROME_EXTENSION_ID}/publish`,
    {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}`, 'x-goog-api-version': '2', 'Content-Length': '0' },
    }
  );
  const data = await res.json();
  const ok = !data.status || data.status.some(s => s.includes('OK'));
  if (!ok) throw new Error(`Publish failed: ${JSON.stringify(data)}`);
  console.log('🚀 Published to Chrome Web Store:', JSON.stringify(data.status));
}

function findZip() {
  const distDir = path.join(__dirname, '..', 'dist');
  const zips = fs.readdirSync(distDir)
    .filter(f => f.endsWith('.zip'))
    .map(f => ({ f, mtime: fs.statSync(path.join(distDir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (!zips.length) throw new Error('No zip in dist/. Run: npm run zip');
  return path.join(distDir, zips[0].f);
}

async function main() {
  const zipPath = findZip();
  const token   = await getAccessToken();
  await uploadZip(token, zipPath);
  await publish(token);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
