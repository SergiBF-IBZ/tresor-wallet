// Spike: 2-of-3 MPC key generation and signing with DKLs23, verified with @noble/curves.
import { KeygenSession, Keyshare, SignSession } from '@silencelaboratories/dkls-wasm-ll-node';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';

const N = 3, T = 2;
const NAMES = ['phone', 'swissquote', 'card'];

// Messages are routed by party ID, not by array index.
const broadcastTo = (msgs, id) => msgs.filter(m => m.from_id !== id).map(m => m.clone());
const directTo = (msgs, id) => msgs.filter(m => m.to_id === id).map(m => m.clone());

function dkg(n, t) {
  const parties = Array.from({ length: n }, (_, i) => new KeygenSession(n, t, i));
  const msg1 = parties.map(p => p.createFirstMessage());
  const msg2 = parties.flatMap((p, id) => p.handleMessages(broadcastTo(msg1, id)));
  const commitments = parties.map(p => p.calculateChainCodeCommitment());
  const msg3 = parties.flatMap((p, id) => p.handleMessages(directTo(msg2, id)));
  const msg4 = parties.flatMap((p, id) => p.handleMessages(directTo(msg3, id), commitments));
  parties.flatMap((p, id) => p.handleMessages(broadcastTo(msg4, id)));
  return parties.map(p => p.keyshare());
}

function sign(shareBytes, hash) {
  // SignSession consumes the keyshare, so rebuild it from bytes each time.
  const parties = shareBytes.map(b => new SignSession(Keyshare.fromBytes(b), 'm'));
  const ids = shareBytes.map(b => Keyshare.fromBytes(b).partyId);
  const msg1 = parties.map(p => p.createFirstMessage());
  const msg2 = parties.flatMap((p, i) => p.handleMessages(broadcastTo(msg1, ids[i])));
  const msg3 = parties.flatMap((p, i) => p.handleMessages(directTo(msg2, ids[i])));
  parties.flatMap((p, i) => p.handleMessages(directTo(msg3, ids[i])));
  // Each pre-signature is used exactly once: reuse would expose the private key.
  const last = parties.map(p => p.lastMessage(hash));
  return parties.map((p, i) => p.combine(broadcastTo(last, ids[i])));
}

const shares = dkg(N, T);
const bytes = shares.map(s => s.toBytes());
const pubkey = shares[0].publicKey;

console.log('Public key:', Buffer.from(pubkey).toString('hex'), `(${pubkey.length} bytes)`);
shares.forEach((s, i) => console.log(`Share ${i + 1} (${NAMES[i]}): party ${s.partyId}, ${bytes[i].length} bytes serialized`));
console.log('All shares agree on the public key:',
  shares.every(s => Buffer.from(s.publicKey).equals(Buffer.from(pubkey))));

const hash = sha256(new TextEncoder().encode('Swissquote wallet spike'));
const pairs = [[0, 1], [0, 2], [1, 2]];
for (const [a, b] of pairs) {
  const [[r, s]] = sign([bytes[a], bytes[b]], hash);
  const sig = new Uint8Array([...r, ...s]);
  // `hash` is already SHA-256: tell noble not to hash it again.
  const ok = secp256k1.verify(sig, hash, pubkey, { lowS: false, prehash: false });
  console.log(`Sign with ${NAMES[a]} + ${NAMES[b]}: signature valid = ${ok}`);
}

// A single share must not be able to sign.
try {
  sign([bytes[1]], hash);
  console.log('Swissquote alone: SIGNED (unexpected)');
} catch (e) {
  console.log('Swissquote alone: refused ->', e.message ?? e);
}
