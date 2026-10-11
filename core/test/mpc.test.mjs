// 2-of-3 threshold ECDSA with DKLs23: every pair signs, one share alone cannot, and the
// lost-card re-share keeps the same key while the old card share stops working.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { PARTIES, THRESHOLD, PARTY, KeygenSession, Keyshare, SignSession, toLowS } from '../shared/mpc.mjs';

const broadcastTo = (msgs, id) => msgs.filter(m => m.from_id !== id).map(m => m.clone());
const directTo = (msgs, id) => msgs.filter(m => m.to_id === id).map(m => m.clone());

function runKeygen(parties) {
  const m1 = parties.map(p => p.createFirstMessage());
  const m2 = parties.flatMap((p, id) => p.handleMessages(broadcastTo(m1, id)));
  const commitments = parties.map(p => p.calculateChainCodeCommitment());
  const m3 = parties.flatMap((p, id) => p.handleMessages(directTo(m2, id)));
  const m4 = parties.flatMap((p, id) => p.handleMessages(directTo(m3, id), commitments));
  parties.forEach((p, id) => p.handleMessages(broadcastTo(m4, id)));
  return parties.map(p => p.keyshare().toBytes());
}

function sign(shareBytes, hash) {
  const parties = shareBytes.map(b => new SignSession(Keyshare.fromBytes(b), 'm'));
  const ids = shareBytes.map(b => Keyshare.fromBytes(b).partyId);
  const m1 = parties.map(p => p.createFirstMessage());
  const m2 = parties.flatMap((p, i) => p.handleMessages(broadcastTo(m1, ids[i])));
  const m3 = parties.flatMap((p, i) => p.handleMessages(directTo(m2, ids[i])));
  parties.forEach((p, i) => p.handleMessages(directTo(m3, ids[i])));
  const last = parties.map(p => p.lastMessage(hash));
  return toLowS(parties[0].combine(broadcastTo(last, ids[0])));
}

const shares = runKeygen(Array.from({ length: PARTIES }, (_, i) => new KeygenSession(PARTIES, THRESHOLD, i)));
const pubkey = Keyshare.fromBytes(shares[0]).publicKey;
const hash = sha256(new TextEncoder().encode('Swissquote wallet test'));
const valid = sig => secp256k1.verify(sig, hash, pubkey, { prehash: false });

test('all three shares agree on one public key', () => {
  for (const s of shares) assert.deepEqual(Keyshare.fromBytes(s).publicKey, pubkey);
});

for (const [a, b] of [[PARTY.phone, PARTY.swissquote], [PARTY.phone, PARTY.card], [PARTY.swissquote, PARTY.card]]) {
  test(`parties ${a} + ${b} produce a valid low-S signature`, () => {
    assert.ok(valid(sign([shares[a], shares[b]], hash)));
  });
}

test('a single share cannot sign', () => {
  assert.throws(() => sign([shares[PARTY.swissquote]], hash));
});

test('lost card: phone + Swissquote re-share the same key; the old card share no longer combines', () => {
  const lost = new Uint8Array([PARTY.card]);
  const fresh = runKeygen([
    KeygenSession.initKeyRecovery(Keyshare.fromBytes(shares[PARTY.phone]), lost),
    KeygenSession.initKeyRecovery(Keyshare.fromBytes(shares[PARTY.swissquote]), lost),
    KeygenSession.initLostShareRecovery(PARTIES, THRESHOLD, PARTY.card, pubkey, lost),
  ]);
  for (const s of fresh) assert.deepEqual(Keyshare.fromBytes(s).publicKey, pubkey, 'same address after re-share');
  assert.ok(valid(sign([fresh[PARTY.phone], fresh[PARTY.card]], hash)));
  let oldCardWorks;
  try { oldCardWorks = valid(sign([fresh[PARTY.phone], shares[PARTY.card]], hash)); } catch { oldCardWorks = false; }
  assert.equal(oldCardWorks, false, 'old card share must not combine with the new shares');
});
