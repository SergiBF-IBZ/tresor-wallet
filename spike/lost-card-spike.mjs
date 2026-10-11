// Spike: replace a lost card share (party 2) with phone (0) + Swissquote (1).
// Checks: same public key, new pairs sign, the lost card share no longer works.
import { KeygenSession, Keyshare } from '@silencelaboratories/dkls-wasm-ll-node';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { dkg, sign } from './mpc.mjs';

const broadcastTo = (msgs, id) => msgs.filter(m => m.from_id !== id).map(m => m.clone());
const directTo = (msgs, id) => msgs.filter(m => m.to_id === id).map(m => m.clone());

// Runs the 4-round key generation protocol over already-initialised sessions (party i = index i).
function runKeygen(parties) {
  const msg1 = parties.map(p => p.createFirstMessage());
  const msg2 = parties.flatMap((p, id) => p.handleMessages(broadcastTo(msg1, id)));
  const commitments = parties.map(p => p.calculateChainCodeCommitment());
  const msg3 = parties.flatMap((p, id) => p.handleMessages(directTo(msg2, id)));
  const msg4 = parties.flatMap((p, id) => p.handleMessages(directTo(msg3, id), commitments));
  parties.flatMap((p, id) => p.handleMessages(broadcastTo(msg4, id)));
  return parties.map(p => p.keyshare());
}

const old = dkg(3, 2).map(s => s.toBytes());
const pubkey = Keyshare.fromBytes(old[0]).publicKey;
const lost = new Uint8Array([2]);

const fresh = runKeygen([
  KeygenSession.initKeyRecovery(Keyshare.fromBytes(old[0]), lost),
  KeygenSession.initKeyRecovery(Keyshare.fromBytes(old[1]), lost),
  KeygenSession.initLostShareRecovery(3, 2, 2, pubkey, lost),
]).map(s => s.toBytes());

const hash = sha256(new TextEncoder().encode('lost card spike'));
const check = (label, shares) => {
  try {
    const ok = secp256k1.verify(sign(shares, hash), hash, pubkey, { prehash: false, lowS: false });
    console.log(`${label}: ${ok ? 'VALID signature' : 'invalid signature'}`);
  } catch (e) { console.log(`${label}: failed (${e.message ?? e})`); }
};

console.log('Same public key after recovery:',
  fresh.every(b => Buffer.from(Keyshare.fromBytes(b).publicKey).equals(Buffer.from(pubkey))));
check('new phone + new Swissquote', [fresh[0], fresh[1]]);
check('new phone + NEW card', [fresh[0], fresh[2]]);
check('new Swissquote + NEW card', [fresh[1], fresh[2]]);
check('new phone + OLD (lost) card', [fresh[0], old[2]]);
check('new Swissquote + OLD (lost) card', [fresh[1], old[2]]);
check('OLD phone + OLD (lost) card (old shares not deleted)', [old[0], old[2]]);
