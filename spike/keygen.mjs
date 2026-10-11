// Generates the 2-of-3 wallet once and prints its Bitcoin testnet address.
// Spike only: shares go to separate folders standing in for separate storages.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as bitcoin from 'bitcoinjs-lib';
import { HOLDERS, dkg, publicKeyOf } from './mpc.mjs';

const path = h => `data/${h}/share.bin`;

if (HOLDERS.some(h => existsSync(path(h)))) {
  console.log('Wallet already exists, not overwriting it.');
} else {
  dkg(3, 2).forEach((share, i) => {
    mkdirSync(`data/${HOLDERS[i]}`, { recursive: true });
    writeFileSync(path(HOLDERS[i]), share.toBytes());
  });
  console.log('New 2-of-3 wallet generated.');
}

const pubkey = publicKeyOf(readFileSync(path('phone')));
const { address } = bitcoin.payments.p2wpkh({ pubkey: Buffer.from(pubkey), network: bitcoin.networks.testnet });
console.log('Public key:', Buffer.from(pubkey).toString('hex'));
console.log('Testnet address (P2WPKH):', address);
