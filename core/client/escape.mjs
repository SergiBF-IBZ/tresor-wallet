// Independent open-source escape tool. It works when Swissquote no longer exists: it never talks
// to the co-signer (its address is deliberately unreachable), combines the phone's Share 1 with
// the card's Share 3 on this computer, and broadcasts through a public block explorer.
//
//   ESCAPE_PORT=5100 node client/escape.mjs
//
// MOCK: "importing the phone's key share" is choosing one of the demo phone folders (in production:
// the app's offline export, e.g. an encrypted file or QR code); the card is a folder, as in the app.
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDevice, addressOf, EXPLORER, NETWORK } from './device.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const demo = `${here}demo/`;
const PORT = Number(process.env.ESCAPE_PORT ?? 5100);
const BROADCAST = process.env.DRY_RUN !== '1';
const NO_SWISSQUOTE = 'http://127.0.0.1:9'; // nothing listens here: any co-signer call would fail

// Demo phones whose exported key share can be imported, with the card that belongs to each.
const SOURCES = {
  'phone-a': { label: 'Phone A export', card: 'card' },
  'phone-b': { label: 'Phone B export', card: 'card' },
  'phone-c': { label: 'Phone C export', card: 'client-c/card' },
};

function open(source) {
  const s = SOURCES[source];
  if (!s || !existsSync(`${demo}${source}/config.json`)) throw Object.assign(new Error('No wallet export found for that phone.'), { code: 'NO_EXPORT' });
  return openDevice({ phoneDir: `${demo}${source}`, cardDir: `${demo}${s.card}`, cosigner: NO_SWISSQUOTE });
}

const api = {
  'GET /api/info': () => ({ network: NETWORK, explorer: EXPLORER, broadcast: BROADCAST, version: '0.1.0', license: 'MIT (tool) · Silence Laboratories licence (MPC library)' }),
  'GET /api/sources': () => Object.entries(SOURCES).map(([id, s]) => ({
    id, label: s.label,
    address: existsSync(`${demo}${id}/config.json`) ? addressOf(JSON.parse(readFileSync(`${demo}${id}/config.json`)).wallet) : null,
  })),
  'POST /api/balance': ({ source }) => open(source).balance(),
  'POST /api/preview': ({ source, to }) => open(source).previewEscape({ to }),
  'POST /api/sweep': ({ source, to, pin }) => open(source).escape({ to, pin, broadcast: BROADCAST }),
};

createServer(async (req, res) => {
  const key = `${req.method} ${req.url.split('?')[0]}`;
  if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) {
    return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(readFileSync(`${here}public/escape.html`));
  }
  const handler = api[key];
  if (!handler) return res.writeHead(404).end('Not found');
  try {
    let body = '';
    for await (const chunk of req) body += chunk;
    const result = await handler(body ? JSON.parse(body) : {});
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result));
  } catch (err) {
    res.writeHead(err.code ? 400 : 500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: err.message, code: err.code }));
  }
}).listen(PORT, () => console.log(`Escape tool on http://localhost:${PORT} (no Swissquote server, ${BROADCAST ? 'broadcasting' : 'dry run'})`));
