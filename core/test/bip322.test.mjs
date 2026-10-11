// BIP-322 ownership proofs, checked against the official test vectors of the BIP.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { messageHash, toSign, proofHash, encodeSimple, verifySimple } from '../shared/bip322.mjs';
import { bitcoin, p2wpkh } from '../shared/bitcoin.mjs';

const hex = b => Buffer.from(b).toString('hex');
const mainnet = bitcoin.networks.bitcoin;
const ADDRESS = 'bc1q9vza2e8x573nczrlzms0wvx3gsqjx7vavgkx0l';

test('message hashes match the BIP-322 vectors', () => {
  assert.equal(hex(messageHash('')), 'c90c269c4f8fcbe6880f72a721ddfbf1914268a794cbb21cfafee13770ae19f1');
  assert.equal(hex(messageHash('Hello World')), 'f0eb03b1a75ac6d9847f55c624a99169b5dccba2a31f5b23bea77ba270de0a7a');
});

test('to_spend and to_sign txids match the BIP-322 vectors', () => {
  const empty = toSign(ADDRESS, '', mainnet);
  assert.equal(empty.toSpend.getId(), 'c5680aa69bb8d860bf82d4e9cd3504b55dde018de765a91bb566283c545a99a7');
  assert.equal(empty.toSign.getId(), '1e9654e951a5ba44c8604c4de6c67fd78a27e81dcadcfe1edf638ba3aaebaed6');
  const hello = toSign(ADDRESS, 'Hello World', mainnet);
  assert.equal(hello.toSpend.getId(), 'b79d196740ad5217771c1098fc4a4b51e0535c32236c71f1ea4d61a2d603352b');
  assert.equal(hello.toSign.getId(), '88737ae86f2077145f93cc4b153ae9a1cb8d56afa511988c149c5c8c9d93bddf');
});

test('the "Hello World" signature from the specification verifies; a changed message does not', () => {
  const sig = 'AkcwRAIgZRfIY3p7/DoVTty6YZbWS71bc5Vct9p9Fia83eRmw2QCICK/ENGfwLtptFluMGs2KsqoNSk89pO7F29zJLUx9a/sASECx/EgAxlkQpQ9hYjgGu6EBCPMVPwVIVJqO4XCsMvViHI=';
  assert.ok(verifySimple(ADDRESS, 'Hello World', sig, mainnet));
  assert.ok(!verifySimple(ADDRESS, 'Hello World!', sig, mainnet));
});

test('round trip on signet; a proof for one address does not verify for another', () => {
  const sk = secp256k1.utils.randomSecretKey();
  const pk = secp256k1.getPublicKey(sk, true);
  const message = 'Swissquote self-custody wallet ownership proof';
  const sig = encodeSimple(secp256k1.sign(proofHash(pk, message), sk, { prehash: false, lowS: true, format: 'compact' }), pk);
  assert.ok(verifySimple(p2wpkh(pk).address, message, sig));
  const other = p2wpkh(secp256k1.getPublicKey(secp256k1.utils.randomSecretKey(), true)).address;
  assert.ok(!verifySimple(other, message, sig));
  assert.ok(!verifySimple(p2wpkh(pk).address, message, 'not a signature'));
});
