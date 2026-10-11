// Puts the demo back to its starting point (the co-signer must be running):
//   phone A:      a brand-new wallet, funded from the treasury wallet
//   phone B:      empty, same client as A, ready to play "the new phone" during recovery
//   phone C:      empty, a different client with a blank card, ready to create a wallet
//   card:         the recovery card of phone A's wallet
// The treasury is a wallet we control (phone + card folders) that holds signet coins.
// Funds still sitting in phones A–C are first sent back to the treasury (escape route: phone + card).
import { rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDevice } from '../client/device.mjs';

const demo = fileURLToPath(new URL('../client/demo/', import.meta.url));
const WANTED = Number(process.env.DEMO_FUNDING ?? 60000);
// MOCK card PIN for the demo card (the app asks for it on card taps).
const PIN = process.env.DEMO_PIN ?? '123456';
const MIN_FUNDING = 10_000;
const FEE_MARGIN = 5_000; // leaves room for the network fee and the change output
const SPONSOR_MIN = 4_000;      // Swissquote's fee wallet is topped up below this balance
const SPONSOR_TOP_UP = 12_000;

const treasury = openDevice({ phoneDir: demo + 'treasury/phone', cardDir: demo + 'treasury/card' });

// First run on a fresh copy: create the treasury wallet, then ask for faucet coins.
if (!existsSync(demo + 'treasury/phone/config.json')) {
  const address = await treasury.create({ pin: PIN });
  console.log(`Treasury wallet created: ${address}`);
  console.log('Request signet coins for it from a faucet, wait for 1 confirmation, then run this reset again.');
} else {
  await reset();
}

// Sends what the demo phones still hold back to the treasury before they are wiped, so resets do
// not burn test coins. Uses the escape route: phone share + card share, signed on this computer.
async function returnFunds() {
  let returned = 0;
  for (const [phone, cardDir] of [['phone-a', 'card'], ['phone-b', 'card'], ['phone-c', 'client-c/card']]) {
    if (!existsSync(`${demo}${phone}/config.json`)) continue;
    const device = openDevice({ phoneDir: demo + phone, cardDir: demo + cardDir });
    try {
      if ((await device.balance()).sats < 2_000) continue;
      const r = await device.escape({ to: treasury.address(), pin: PIN, broadcast: true });
      console.log(`Returned ${r.amount} sats from ${phone} to the treasury: ${r.url}`);
      returned += r.amount;
    } catch (err) {
      console.warn(`Could not return the funds of ${phone} (${err.code ?? err.message}); they are left in its wallet.`);
    }
  }
  if (returned) await new Promise(r => setTimeout(r, 3000)); // let the explorer index them
}

async function reset() {
  await returnFunds();
  // Check the treasury before deleting anything, so a failed reset never leaves the demo half-done.
  const { sats: available } = await treasury.balance();
  const funding = Math.min(WANTED, available - FEE_MARGIN);
  if (funding < MIN_FUNDING) {
    console.error(`The treasury has only ${available} sats. Nothing was changed.`);
    console.error(`Request signet coins for ${treasury.address()} from a faucet, wait for confirmation, then retry.`);
    process.exitCode = 1;
  } else {
    if (funding < WANTED) console.warn(`The treasury has ${available} sats: funding phone A with ${funding} instead of ${WANTED}.`);

    for (const dir of ['phone-a', 'phone-b', 'phone-c', 'card', 'cloud', 'keychain', 'client-c']) rmSync(demo + dir, { recursive: true, force: true });

    const phoneA = openDevice({ phoneDir: demo + 'phone-a', cardDir: demo + 'card', cloudDir: demo + 'cloud' });
    const address = await phoneA.create({ pin: PIN });
    console.log(`Phone A wallet: ${address} (card PIN ${PIN})`);

    console.log(`Funding ${funding} sats from the treasury (${treasury.address()})...`);
    const r = await treasury.send({ to: address, amount: String(funding), broadcast: true });
    console.log(`Funded: ${r.url}`);
    // Swissquote's fee wallet pays the network fee of sponsored ("gasless") payments: keep it topped up.
    const sponsor = await fetch('http://localhost:4000/sponsor/info', { method: 'POST' }).then(r => r.json()).catch(() => null);
    if (sponsor?.address && sponsor.sats < SPONSOR_MIN && available - funding - SPONSOR_TOP_UP > FEE_MARGIN) {
      await new Promise(r => setTimeout(r, 3000)); // let the explorer see the treasury's new change
      const t = await treasury.send({ to: sponsor.address, amount: String(SPONSOR_TOP_UP), broadcast: true });
      console.log(`Topped up Swissquote's fee wallet (${sponsor.address}) with ${SPONSOR_TOP_UP} sats: ${t.url}`);
    }
    console.log(`Demo ready. Card PIN ${PIN}. Phone B: recover A. Phone C: another client, create a wallet.`);
    if (available - funding < MIN_FUNDING + FEE_MARGIN) console.warn(`The treasury is nearly empty: refill ${treasury.address()} before the next reset.`);
  }
}
