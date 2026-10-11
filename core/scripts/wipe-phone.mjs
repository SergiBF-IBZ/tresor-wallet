// Factory-resets one demo phone: deletes its folder, so the app shows the welcome screen again.
//   npm run demo:wipe -- b          (phone a, b or c)
//   npm run demo:wipe -- a --force  (even if its wallet still holds funds)
// Wiping a phone with a funded wallet is like losing that phone: the funds can then only be
// recovered with the card or the Apple/Google backup, on another phone.
import { existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDevice } from '../client/device.mjs';

const demo = fileURLToPath(new URL('../client/demo/', import.meta.url));
const name = (process.argv[2] ?? '').toLowerCase().replace(/^phone-?/, '');
if (!['a', 'b', 'c'].includes(name)) {
  console.log('Usage: npm run demo:wipe -- a|b|c [--force]');
  process.exit(1);
}
const dir = `${demo}phone-${name}`;
if (!existsSync(dir)) {
  console.log(`Phone ${name.toUpperCase()} is already empty.`);
  process.exit(0);
}

const phone = openDevice({ phoneDir: dir, cardDir: `${demo}${name === 'c' ? 'client-c/card' : 'card'}` });
// If the balance cannot be read (no network, rate limit), refuse unless --force: better safe.
const funds = phone.hasWallet() && !process.argv.includes('--force')
  ? await phone.balance().then(b => b.sats, () => -1)
  : 0;
if (funds < 0) {
  console.log(`Could not read phone ${name.toUpperCase()}'s balance. Add --force to wipe it anyway.`);
  process.exitCode = 1;
} else if (funds > 0) {
  console.log(`Phone ${name.toUpperCase()} holds wallet ${phone.address()} with ${funds} sats.`);
  console.log('Wiping it is like losing the phone. Add --force to continue.');
  process.exitCode = 1;
} else {
  rmSync(dir, { recursive: true, force: true });
  // Phone C belongs to its own client: wiping it also resets that client's card and backups.
  if (name === 'c') rmSync(`${demo}client-c`, { recursive: true, force: true });
  console.log(`Phone ${name.toUpperCase()} wiped. Reload http://localhost:500${{ a: 1, b: 2, c: 3 }[name]} to see the welcome screen.`);
}
