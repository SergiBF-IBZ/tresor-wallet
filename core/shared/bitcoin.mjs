// Bitcoin helpers: P2WPKH addresses, BIP-143 sighashes and the Esplora API.
import * as bitcoin from 'bitcoinjs-lib';

export { bitcoin };
export const net = bitcoin.networks.testnet; // same address format for testnet and signet
export const SIGHASH = bitcoin.Transaction.SIGHASH_ALL;

// Esplora explorers, tried in order. Blockstream first; mempool.space (same API) takes over when
// Blockstream rate-limits us or is unreachable. ESPLORA_URLS (comma-separated) overrides the list.
const EXPLORERS = {
  signet: ['https://blockstream.info/signet', 'https://mempool.space/signet'],
  testnet: ['https://blockstream.info/testnet', 'https://mempool.space/testnet'],
};
export const NETWORK = process.env.NETWORK ?? 'signet';
if (!EXPLORERS[NETWORK]) throw new Error(`Unknown NETWORK "${NETWORK}".`);
const BASES = process.env.ESPLORA_URLS ? process.env.ESPLORA_URLS.split(',').map(u => u.trim().replace(/\/$/, '')) : EXPLORERS[NETWORK];
export const EXPLORER = BASES[0]; // used for the links shown to the client

export const p2wpkh = pubkey => bitcoin.payments.p2wpkh({ pubkey: Buffer.from(pubkey), network: net });

// BIP-143 sighash for input `i` of a P2WPKH wallet. The input value is part of the
// hash, so a wrong value simply yields a signature the network rejects.
export function sighash(tx, i, pubkey, value) {
  const { hash } = p2wpkh(pubkey);
  const scriptCode = bitcoin.payments.p2pkh({ hash, network: net }).output;
  return tx.hashForWitnessV0(i, scriptCode, BigInt(value), SIGHASH);
}

// Blockstream's free API allows about 700 requests per hour per IP, so reads are cached briefly:
// fee estimates for 2 minutes, everything else (balances, history) for 15 seconds. Broadcasting a
// transaction clears the cache so balances refresh right away.
const cache = new Map();
const ttlFor = path => (path === '/fee-estimates' ? 120_000 : 15_000);

export async function esplora(path, init) {
  const isRead = !init?.method || init.method === 'GET';
  if (!isRead) cache.clear();
  const hit = isRead && cache.get(path);
  if (hit && Date.now() < hit.expires) return hit.value;
  const value = await esploraFetch(path, init);
  if (isRead) cache.set(path, { value, expires: Date.now() + ttlFor(path) });
  return value;
}

// An explorer that rate-limits us or fails is skipped for a few minutes, so the next one serves
// the requests. A clear refusal (for example a transaction the network rejects) is not retried.
const COOL_DOWN_MS = 5 * 60_000;
const coolingUntil = new Map();

async function esploraFetch(path, init) {
  let rateLimited = false;
  let lastError;
  const order = [...BASES].sort((a, b) => (coolingUntil.get(a) ?? 0) - (coolingUntil.get(b) ?? 0));
  for (const base of order) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      let res;
      try {
        res = await fetch(`${base}/api${path}`, { ...init, signal: AbortSignal.timeout(15_000) });
      } catch (err) {
        lastError = err;
        if (attempt < 2) { await new Promise(r => setTimeout(r, 800)); continue; }
        coolingUntil.set(base, Date.now() + COOL_DOWN_MS);
        break;
      }
      const body = await res.text();
      if (res.status === 429 || res.status >= 500) {
        rateLimited ||= res.status === 429;
        lastError = new Error(`${base}: HTTP ${res.status}`);
        coolingUntil.set(base, Date.now() + COOL_DOWN_MS);
        break;
      }
      if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${body}`);
      coolingUntil.delete(base);
      return body.startsWith('{') || body.startsWith('[') ? JSON.parse(body) : body;
    }
  }
  if (rateLimited) {
    throw Object.assign(new Error('The block explorers are rate-limiting us (too many requests). Wait a few minutes and try again.'), { code: 'RATE_LIMITED' });
  }
  throw Object.assign(new Error('Cannot reach the Bitcoin network. Check the internet connection and try again.'), { code: 'NETWORK', cause: lastError });
}
