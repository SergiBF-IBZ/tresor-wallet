// Double-locked backup of Share 1: both locks are needed; Swissquote only checks a verifier.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { seal, open, verifierOf, verifierMatches, newLockBKey } from '../shared/backup.mjs';

const share = randomBytes(2048);
const keyA = randomBytes(32); // the passkey's PRF output
const keyB = newLockBKey();    // Swissquote's key

test('the backup opens with both locks', () => {
  assert.deepEqual(open(seal(share, keyA, keyB), keyA, keyB), share);
});

test('either lock alone cannot open it, and tampering is detected', () => {
  const box = seal(share, keyA, keyB);
  assert.throws(() => open(box, randomBytes(32), keyB));
  assert.throws(() => open(box, keyA, randomBytes(32)));
  const data = Buffer.from(box.data, 'base64');
  data[0] ^= 1;
  assert.throws(() => open({ ...box, data: data.toString('base64') }, keyA, keyB));
});

test('Swissquote can check the passkey proof without learning lock A', () => {
  const stored = verifierOf(keyA);
  assert.ok(verifierMatches(verifierOf(keyA), stored));
  assert.ok(!verifierMatches(verifierOf(randomBytes(32)), stored));
  assert.ok(!verifierMatches(undefined, stored));
});
