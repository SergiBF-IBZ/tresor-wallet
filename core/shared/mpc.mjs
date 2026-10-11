// DKLs23 (Silence Laboratories) helpers shared by the client and the co-signer.
// The protocol is a sequence of message rounds; each side runs only its own party
// and exchanges messages over HTTP.
import { KeygenSession, Keyshare, Message, SignSession } from '@silencelaboratories/dkls-wasm-ll-node';

export const PARTIES = 3;
export const THRESHOLD = 2;
export const PARTY = { phone: 0, swissquote: 1, card: 2 };

export { KeygenSession, Keyshare, SignSession };

// Wire format: messages travel as JSON with a base64 payload.
export const toWire = m => ({ payload: Buffer.from(m.payload).toString('base64'), from: m.from_id, to: m.to_id });
export const fromWire = w => new Message(Buffer.from(w.payload, 'base64'), w.from, w.to ?? undefined);

// Broadcast messages from everyone except `id`, and direct messages addressed to `id`.
export const broadcastFor = (msgs, id) => msgs.filter(m => m.to === undefined && m.from !== id);
export const directFor = (msgs, id) => msgs.filter(m => m.to === id);

// Feeds wire messages into a session and returns its outgoing messages in wire format.
export function step(session, wireMsgs, ...extra) {
  return session.handleMessages(wireMsgs.map(fromWire), ...extra).map(toWire);
}

// secp256k1 group order; Bitcoin only accepts signatures with s <= n/2 (low-S rule).
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

// Combines the DKLs output [r, s] into a 64-byte low-S signature.
export function toLowS([r, s]) {
  let sn = BigInt('0x' + Buffer.from(s).toString('hex'));
  if (sn > N / 2n) sn = N - sn;
  return new Uint8Array([...r, ...Buffer.from(sn.toString(16).padStart(64, '0'), 'hex')]);
}
