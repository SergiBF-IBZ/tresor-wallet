// MOCK of a passkey synced in the client's Apple/Google account. A real passkey would return a
// per-wallet secret through the WebAuthn PRF extension; the private key stays in the provider's
// end-to-end encrypted keychain. Here a folder plays the account's keychain: a new phone that
// "signs in to the account" gets the same folder, as a synced passkey would appear on it.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, hkdfSync } from 'node:crypto';

export function openKeychain(dir) {
  const path = dir && join(dir, 'passkey.json');
  return {
    available: () => !!path && existsSync(path),

    // PRF output for this wallet: the same secret every time, never stored next to the backup.
    prf(wallet, { create = false } = {}) {
      if (!path) throw Object.assign(new Error('No Apple/Google account on this phone.'), { code: 'NO_ACCOUNT' });
      if (!existsSync(path)) {
        if (!create) throw Object.assign(new Error('Sign in to your Apple/Google account first.'), { code: 'NO_ACCOUNT' });
        mkdirSync(dir, { recursive: true });
        writeFileSync(path, JSON.stringify({ secret: randomBytes(32).toString('base64'), createdAt: new Date().toISOString() }, null, 2));
      }
      const { secret } = JSON.parse(readFileSync(path));
      return Buffer.from(hkdfSync('sha256', Buffer.from(secret, 'base64'), Buffer.from(wallet, 'hex'), 'swissquote-backup-prf', 32));
    },
  };
}
