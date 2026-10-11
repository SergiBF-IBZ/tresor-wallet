// Command-line client. CLIENT_DATA selects the phone folder and CARD_DATA the card folder,
// so a second phone folder plays the role of a new phone during recovery.
// --pin is the recovery card's PIN (MOCK card): needed to activate a card and for card taps.
//
//   node client/wallet.mjs create --pin <pin>
//   node client/wallet.mjs address | balance | status | freeze
//   node client/wallet.mjs unfreeze --identity pass|fail --pin <pin>  video ID + card tap
//   node client/wallet.mjs send --to <address> --amount <sats> [--pin <pin>] [--broadcast]
//   node client/wallet.mjs limits --card <sats> --daily <sats> [--pin <pin>]   raising needs the card
//   node client/wallet.mjs escape --to <address> --pin <pin> [--broadcast]   phone + card, no server
//   node client/wallet.mjs prove                                      ownership proof for Swissquote (BIP-322, no funds move)
//   node client/wallet.mjs backup                                     backup of Share 1 (Apple/Google passkey + Swissquote)
//   node client/wallet.mjs recover --identity pass|fail --pin <new card pin> [--method card|backup] [--broadcast]
//   node client/wallet.mjs replace-card --identity pass|fail --pin <new card pin>   lost card, same address
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDevice } from './device.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const device = openDevice({
  phoneDir: resolve(process.env.CLIENT_DATA ?? `${here}/data/phone`),
  cardDir: resolve(process.env.CARD_DATA ?? `${here}/data/card`),
  cloudDir: resolve(process.env.CLOUD_DATA ?? `${here}/data/cloud`),
  keychainDir: resolve(process.env.KEYCHAIN_DATA ?? `${here}/data/keychain`),
  cosigner: process.env.COSIGNER_URL,
});

const args = process.argv.slice(2);
const arg = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const broadcast = args.includes('--broadcast');
const pin = arg('pin');
const report = r => console.log(`${r.from} → ${r.to}: ${r.amount} sats · fee ${r.fee} sats\n${r.broadcast ? 'Broadcast OK' : 'Dry run (add --broadcast to send)'}: ${r.url}`);
const waitUntil = async t => { while (Date.now() < t) await new Promise(r => setTimeout(r, 1000)); };

const commands = {
  create: async () => console.log('Wallet created:', await device.create({ pin })),
  address: () => console.log(device.address()),
  balance: async () => console.log(await device.balance()),
  status: async () => console.log(await device.status()),
  freeze: async () => console.log(await device.freeze()),
  unfreeze: async () => console.log(await device.unfreeze({ identity: arg('identity', 'fail'), pin })),
  send: async () => report(await device.send({ to: arg('to'), amount: arg('amount', '10000'), pin, broadcast })),
  limits: async () => console.log(await device.setLimits({ cardThreshold: arg('card'), dailyLimit: arg('daily'), pin })),
  escape: async () => report(await device.escape({ to: arg('to'), pin, broadcast })),
  async 'replace-card'() {
    const { readyAt } = await device.cardReplaceStart({ identity: arg('identity', 'fail') });
    console.log(`Video identification passed; new card can be activated after ${new Date(readyAt).toLocaleString()}...`);
    await waitUntil(readyAt);
    const { address } = await device.cardReplaceComplete({ pin });
    console.log(`New card activated for ${address} (same address). The old card no longer works.`);
  },
  prove: async () => {
    const p = await device.proveOwnership();
    console.log(`Ownership verified by Swissquote for client ${p.clientId}.

${p.message}

BIP-322 signature: ${p.signature}`);
  },
  backup: async () => {
    await device.backupCreate();
    console.log('Backup saved to your cloud drive, locked with your Apple/Google passkey and a Swissquote key.');
  },
  async recover() {
    const method = arg('method', 'card');
    const { oldAddress, readyAt } = await device.recoveryStart({ identity: arg('identity', 'fail'), method });
    console.log(`Recovering ${oldAddress} with the ${method}. Video identification passed; waiting until ${new Date(readyAt).toLocaleString()}...`);
    await waitUntil(readyAt);
    const r = await device.recoveryComplete({ broadcast, pin });
    console.log(`New wallet: ${r.newAddress}`);
    report(r);
  },
};

const command = commands[args[0]];
if (!command) {
  console.log(`Commands: ${Object.keys(commands).join(', ')}`);
} else {
  try {
    await command();
  } catch (err) {
    console.error(`Error${err.code ? ` [${err.code}]` : ''}: ${err.message}`);
    process.exitCode = 1;
  }
}
