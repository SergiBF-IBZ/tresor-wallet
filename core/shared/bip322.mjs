// BIP-322 "simple" message signatures for P2WPKH addresses: proof that whoever controls an
// address signed a message, without moving funds. The message is committed to a virtual
// transaction that spends nothing real, then signed with the normal BIP-143 sighash, so the
// same MPC signing used for payments signs it. Used for the Travel Rule ownership proof.
// Spec: https://github.com/bitcoin/bips/blob/master/bip-0322.mediawiki
import { sha256 } from '@noble/hashes/sha2.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bitcoin, net, SIGHASH, p2wpkh, sighash } from './bitcoin.mjs';

const TAG = sha256(Buffer.from('BIP0322-signed-message'));

// Tagged hash of the message, as in BIP-340: sha256(tag || tag || message).
export const messageHash = message => sha256(Buffer.concat([TAG, TAG, Buffer.from(message, 'utf8')]));

// to_spend: commits to the message and the address; its input does not exist on-chain.
function toSpend(scriptPubKey, message) {
  const tx = new bitcoin.Transaction();
  tx.version = 0;
  tx.locktime = 0;
  const scriptSig = bitcoin.script.compile([bitcoin.opcodes.OP_0, Buffer.from(messageHash(message))]);
  tx.addInput(Buffer.alloc(32), 0xffffffff, 0, scriptSig);
  tx.addOutput(Buffer.from(scriptPubKey), 0n);
  return tx;
}

// to_sign: spends to_spend into an OP_RETURN output. Signing its only input is the proof.
export function toSign(address, message, network = net) {
  const scriptPubKey = bitcoin.address.toOutputScript(address, network);
  const spend = toSpend(scriptPubKey, message);
  const tx = new bitcoin.Transaction();
  tx.version = 0;
  tx.locktime = 0;
  tx.addInput(Buffer.from(spend.getHash()), 0, 0);
  tx.addOutput(bitcoin.script.compile([bitcoin.opcodes.OP_RETURN]), 0n);
  return { toSpend: spend, toSign: tx };
}

// The 32-byte hash the wallet signs for `message`. The virtual input's value is 0.
export function proofHash(pubkey, message) {
  return sighash(toSign(p2wpkh(pubkey).address, message).toSign, 0, pubkey, 0);
}

// The "simple" signature: the witness stack of to_sign, serialized and base64-encoded.
export function encodeSimple(sig64, pubkey) {
  const stack = [bitcoin.script.signature.encode(Buffer.from(sig64), SIGHASH), Buffer.from(pubkey)];
  return Buffer.concat([Buffer.from([stack.length]), ...stack.flatMap(item => [Buffer.from([item.length]), item])]).toString('base64');
}

function decodeSimple(b64) {
  const buf = Buffer.from(b64 ?? '', 'base64');
  const items = [];
  let pos = 1;
  for (let i = 0; i < buf[0]; i++) {
    const len = buf[pos];
    items.push(buf.subarray(pos + 1, pos + 1 + len));
    pos += 1 + len;
  }
  if (items.length !== 2 || pos !== buf.length) throw new Error('Not a P2WPKH BIP-322 signature.');
  return items;
}

// Verifies a "simple" signature for a P2WPKH address. Returns true or false, never throws.
export function verifySimple(address, message, signature, network = net) {
  try {
    const [encoded, pubkey] = decodeSimple(signature);
    if (!Buffer.from(p2wpkh(pubkey).output).equals(Buffer.from(bitcoin.address.toOutputScript(address, network)))) return false;
    const { signature: sig, hashType } = bitcoin.script.signature.decode(encoded);
    if (hashType !== SIGHASH) return false;
    return secp256k1.verify(sig, proofHash(pubkey, message), pubkey, { prehash: false });
  } catch {
    return false;
  }
}
