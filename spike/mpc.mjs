// Thin wrapper around DKLs23 (Silence Laboratories) for 2-of-3 key generation and signing.
// In this spike all parties run in one process; later each party becomes its own service.
import { KeygenSession, Keyshare, SignSession } from '@silencelaboratories/dkls-wasm-ll-node';

export const HOLDERS = ['phone', 'swissquote', 'card'];

// Messages are routed by party ID, not by array index.
const broadcastTo = (msgs, id) => msgs.filter(m => m.from_id !== id).map(m => m.clone());
const directTo = (msgs, id) => msgs.filter(m => m.to_id === id).map(m => m.clone());

export function dkg(n, t) {
  const parties = Array.from({ length: n }, (_, i) => new KeygenSession(n, t, i));
  const msg1 = parties.map(p => p.createFirstMessage());
  const msg2 = parties.flatMap((p, id) => p.handleMessages(broadcastTo(msg1, id)));
  const commitments = parties.map(p => p.calculateChainCodeCommitment());
  const msg3 = parties.flatMap((p, id) => p.handleMessages(directTo(msg2, id)));
  const msg4 = parties.flatMap((p, id) => p.handleMessages(directTo(msg3, id), commitments));
  parties.flatMap((p, id) => p.handleMessages(broadcastTo(msg4, id)));
  return parties.map(p => p.keyshare());
}

export const publicKeyOf = shareBytes => Keyshare.fromBytes(shareBytes).publicKey;

// Signs a 32-byte hash with the given shares; returns a 64-byte r||s signature.
export function sign(shareBytes, hash) {
  // SignSession consumes the keyshare, so rebuild it from bytes each time.
  const ids = shareBytes.map(b => Keyshare.fromBytes(b).partyId);
  const parties = shareBytes.map(b => new SignSession(Keyshare.fromBytes(b), 'm'));
  const msg1 = parties.map(p => p.createFirstMessage());
  const msg2 = parties.flatMap((p, i) => p.handleMessages(broadcastTo(msg1, ids[i])));
  const msg3 = parties.flatMap((p, i) => p.handleMessages(directTo(msg2, ids[i])));
  parties.flatMap((p, i) => p.handleMessages(directTo(msg3, ids[i])));
  // Each pre-signature is used exactly once: reuse would expose the private key.
  const last = parties.map(p => p.lastMessage(hash));
  const [[r, s]] = parties.map((p, i) => p.combine(broadcastTo(last, ids[i])));
  return new Uint8Array([...r, ...s]);
}
