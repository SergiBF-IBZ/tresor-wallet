// The "phone": a local process that holds Share 1 and serves the wallet UI.
// Run one instance per simulated phone:
//   APP_PORT=5001 CLIENT_DATA=client/demo/phone-a CARD_DATA=client/demo/card node client/app.mjs
// MOCK: Face ID prompts, the card (a folder), the Apple/Google account keychain (a folder),
// the cloud drive (a folder), CHF rate, contacts and video identification.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDevice, EXPLORER, NETWORK } from './device.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.APP_PORT ?? 5001);
const BROADCAST = process.env.DRY_RUN !== '1';
const device = openDevice({
  phoneDir: resolve(process.env.CLIENT_DATA ?? `${here}/demo/phone-a`),
  cardDir: resolve(process.env.CARD_DATA ?? `${here}/demo/card`),
  cloudDir: resolve(process.env.CLOUD_DATA ?? `${here}/demo/cloud`),
  keychainDir: resolve(process.env.KEYCHAIN_DATA ?? `${here}/demo/keychain`),
  cosigner: process.env.COSIGNER_URL,
});

// MOCK: an indicative rate for showing CHF amounts; signet coins have no value.
const CHF_PER_BTC = 85_000;
const CONTACTS = [
  { name: 'My Swissquote account', address: 'tb1qamhytefc99u4vq6r0utnvh4w560cn79cxqd0td' }, // MOCK: the demo treasury plays the account's deposit address
  { name: 'Ana Keller', address: 'tb1q02pgvfa4gxw4zq5q0neushhxn3kamswrzphqwl' },
  { name: 'Sanctioned test entity', address: 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx' },
];

const api = {
  'GET /api/state': () => ({
    hasWallet: device.hasWallet(), hasCard: device.hasCard(), hasBackup: device.hasBackup(),
    address: device.hasWallet() ? device.address() : null,
    network: NETWORK, explorer: EXPLORER, chfPerBtc: CHF_PER_BTC, contacts: CONTACTS, broadcast: BROADCAST,
  }),
  'POST /api/create': async ({ pin }) => ({ address: await device.create({ pin }) }),
  'GET /api/balance': () => device.balance(),
  'GET /api/history': () => device.history(),
  'GET /api/status': () => device.status(),
  'POST /api/preview': ({ to, amount, sweep }) => device.preview({ to, amount, sweep }),
  'POST /api/screen': ({ to, amount }) => device.screen({ to, amount }),
  'POST /api/send': ({ to, amount, pin }) => device.send({ to, amount, pin, broadcast: BROADCAST }),
  'POST /api/limits': ({ cardThreshold, dailyLimit, pin }) => device.setLimits({ cardThreshold, dailyLimit, pin }),
  'POST /api/freeze': () => device.freeze(),
  'POST /api/unfreeze': ({ identity, pin }) => device.unfreeze({ identity, pin }),
  'POST /api/escape': ({ to, pin }) => device.escape({ to, pin, broadcast: BROADCAST }),
  'POST /api/card/replace/start': ({ identity }) => device.cardReplaceStart({ identity }),
  'POST /api/card/replace/complete': ({ pin }) => device.cardReplaceComplete({ pin }),
  'POST /api/ownership': () => device.proveOwnership(),
  'POST /api/backup': () => device.backupCreate(),
  'POST /api/recovery/start': ({ identity, method }) => device.recoveryStart({ identity, method }),
  'POST /api/recovery/complete': ({ pin }) => device.recoveryComplete({ broadcast: BROADCAST, pin }),
};

const page = () => readFileSync(`${here}/public/index.html`);

createServer(async (req, res) => {
  const key = `${req.method} ${req.url.split('?')[0]}`;
  if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) {
    return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page());
  }
  const handler = api[key];
  if (!handler) return res.writeHead(404).end('Not found');
  try {
    let body = '';
    for await (const chunk of req) body += chunk;
    const result = await handler(body ? JSON.parse(body) : {});
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result));
  } catch (err) {
    const status = err.code ? 400 : 500;
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify({ error: err.message, code: err.code }));
  }
}).listen(PORT, () => console.log(`Phone app on http://localhost:${PORT} (${BROADCAST ? 'broadcasting' : 'dry run'})`));
