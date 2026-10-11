// Double-locked backup of Share 1, for the case "lost phone AND card".
// Lock A: the passkey of the client's Apple/Google account (PRF output). Nothing to write down.
// Lock B: a random key held by Swissquote, released only after identity checks.
// Built only from Node's crypto module (HKDF, HMAC, AES-256-GCM).
import { randomBytes, hkdfSync, createHmac, createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto';

// Lets Swissquote check that the client holds the passkey without learning lock A.
export const verifierOf = keyA => createHmac('sha256', keyA).update('swissquote-backup-verifier').digest('base64');

export function verifierMatches(proof, stored) {
  const a = Buffer.from(proof ?? '', 'base64');
  const b = Buffer.from(stored, 'base64');
  return a.length === b.length && timingSafeEqual(a, b);
}

const boxKey = (keyA, keyB) => Buffer.from(hkdfSync('sha256', Buffer.concat([keyA, keyB]), Buffer.alloc(0), 'share1-backup', 32));

export function seal(share, keyA, keyB) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', boxKey(keyA, keyB), iv);
  const data = Buffer.concat([cipher.update(share), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}

export function open(box, keyA, keyB) {
  const decipher = createDecipheriv('aes-256-gcm', boxKey(keyA, keyB), Buffer.from(box.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(box.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(box.data, 'base64')), decipher.final()]);
}

export const newLockBKey = () => randomBytes(32);
