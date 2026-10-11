// Builds a Bitcoin testnet transaction, signs every input with 2 of the 3 MPC shares
// and (only with --broadcast) sends it through an Esplora block explorer API.
//
// Usage: node send.mjs [--to <address>] [--amount <sats>] [--signers phone,swissquote] [--broadcast]
// Env:   NETWORK=signet (default) | testnet | testnet4
import { readFileSync } from 'node:fs';
import * as bitcoin from 'bitcoinjs-lib';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { publicKeyOf, sign } from './mpc.mjs';

// mempool.space is unreachable from our network, so signet and testnet use Blockstream's Esplora.
const EXPLORERS = {
  signet: 'https://blockstream.info/signet',
  testnet: 'https://blockstream.info/testnet',
  testnet4: 'https://mempool.space/testnet4',
};
const NETWORK = process.env.NETWORK ?? 'signet';
if (!EXPLORERS[NETWORK]) throw new Error(`Unknown NETWORK "${NETWORK}".`);
const API = `${EXPLORERS[NETWORK]}/api`;
const net = bitcoin.networks.testnet; // same address format for testnet3, testnet4 and signet
const DUST = 546n;
// secp256k1 group order; Bitcoin only accepts signatures with s <= n/2 (low-S rule).
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

const args = process.argv.slice(2);
const arg = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };

const signers = arg('signers', 'phone,swissquote').split(',');
if (signers.length !== 2) throw new Error('Exactly 2 signers are required (2-of-3).');
const shares = signers.map(h => readFileSync(`data/${h}/share.bin`));

const pubkey = Buffer.from(publicKeyOf(shares[0]));
const own = bitcoin.payments.p2wpkh({ pubkey, network: net });
const to = arg('to', own.address);

const get = async path => {
  const res = await fetch(API + path);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${await res.text()}`);
  return res.json();
};

const utxos = await get(`/address/${own.address}/utxo`);
if (utxos.length === 0) {
  console.log(`No funds yet at ${own.address} on ${NETWORK}. Request coins from a faucet first.`);
} else {
  await spend(utxos);
}

async function spend(utxos) {
const total = utxos.reduce((sum, u) => sum + BigInt(u.value), 0n);
// Esplora fee estimates: sat/vB keyed by confirmation target in blocks.
const estimates = await get('/fee-estimates');
const feeRate = BigInt(Math.max(1, Math.ceil(estimates['6'] ?? 1)));

const amount = BigInt(arg('amount', String(total / 2n)));
// Approximate P2WPKH size: 11 vB overhead + 68 vB per input + 31 vB per output (2 outputs).
const fee = feeRate * (11n + 68n * BigInt(utxos.length) + 31n * 2n);
const change = total - amount - fee;
if (amount < DUST || change < 0n) throw new Error(`Not enough funds: total ${total}, amount ${amount}, fee ${fee}.`);

const tx = new bitcoin.Transaction();
tx.version = 2;
for (const u of utxos) tx.addInput(Buffer.from(u.txid, 'hex').reverse(), u.vout);
tx.addOutput(bitcoin.address.toOutputScript(to, net), amount);
if (change >= DUST) tx.addOutput(own.output, change);

// BIP-143: the script code for P2WPKH is the classic P2PKH script of the same key hash.
const scriptCode = bitcoin.payments.p2pkh({ hash: own.hash, network: net }).output;
utxos.forEach((u, i) => {
  const hash = tx.hashForWitnessV0(i, scriptCode, BigInt(u.value), bitcoin.Transaction.SIGHASH_ALL);
  const sig = sign(shares, hash);
  // Normalise to low-S, otherwise nodes reject the transaction as non-standard.
  let s = BigInt('0x' + Buffer.from(sig.slice(32)).toString('hex'));
  if (s > N / 2n) s = N - s;
  sig.set(Buffer.from(s.toString(16).padStart(64, '0'), 'hex'), 32);
  if (!secp256k1.verify(sig, hash, pubkey, { prehash: false })) throw new Error(`Invalid MPC signature on input ${i}.`);
  tx.setWitness(i, [bitcoin.script.signature.encode(sig, bitcoin.Transaction.SIGHASH_ALL), pubkey]);
});

const hex = tx.toHex();
console.log(`Network: ${NETWORK}`);
console.log(`Signed with: ${signers.join(' + ')}`);
console.log(`From ${own.address} (${total} sats in ${utxos.length} UTXO)`);
console.log(`To   ${to}: ${amount} sats · change ${change >= DUST ? change : 0n} · fee ~${fee} sats (${feeRate} sat/vB)`);
console.log(`Txid: ${tx.getId()}`);

if (!args.includes('--broadcast')) {
  console.log('\nDry run: transaction signed but NOT sent. Add --broadcast to send it.');
  console.log(hex);
} else {
  const res = await fetch(`${API}/tx`, { method: 'POST', body: hex });
  const body = await res.text();
  if (!res.ok) throw new Error(`Broadcast failed: HTTP ${res.status} ${body}`);
  console.log(`\nBroadcast OK: ${EXPLORERS[NETWORK]}/tx/${body}`);
}
}
