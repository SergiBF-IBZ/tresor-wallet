// Co-signer policy: freeze, sanctions, card threshold, daily limit, and sponsored fee change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bitcoin, p2wpkh } from '../shared/bitcoin.mjs';
import { review, recordSpend } from '../cosigner/policy.mjs';

const newAddress = () => p2wpkh(secp256k1.getPublicKey(secp256k1.utils.randomSecretKey(), true));
const wallet = newAddress(), ana = newAddress(), feeWallet = newAddress();

function payment(outputs) {
  const tx = new bitcoin.Transaction();
  tx.addInput(Buffer.alloc(32, 1), 0);
  for (const [script, value] of outputs) tx.addOutput(script, BigInt(value));
  return tx;
}

test('a small payment within the limits is accepted', () => {
  assert.equal(review(payment([[ana.output, 10_000], [wallet.output, 40_000]]), wallet.output, {}, []), null);
});

test('a frozen wallet is refused', () => {
  assert.equal(review(payment([[ana.output, 1_000]]), wallet.output, { frozen: true }, []).code, 'FROZEN');
});

test('a sanctioned recipient is refused', () => {
  assert.equal(review(payment([[ana.output, 1_000]]), wallet.output, {}, [ana.address]).code, 'SANCTIONED');
});

test('above the card threshold the card must approve; with approval it passes', () => {
  const tx = payment([[ana.output, 30_000]]);
  assert.equal(review(tx, wallet.output, {}, []).code, 'CARD_REQUIRED');
  assert.equal(review(tx, wallet.output, {}, [], { cardApproved: true }), null);
});

test('the daily limit counts what was already spent today', () => {
  const state = {};
  recordSpend(payment([[ana.output, 90_000]]), wallet.output, state);
  assert.equal(review(payment([[ana.output, 20_000]]), wallet.output, state, [], { cardApproved: true }).code, 'LIMIT');
});

test('the change returned to the Swissquote fee wallet is not counted as a payment', () => {
  const tx = payment([[ana.output, 20_000], [wallet.output, 5_000], [feeWallet.output, 11_500]]);
  assert.equal(review(tx, wallet.output, {}, []).code, 'CARD_REQUIRED'); // 31,500 sats if counted
  assert.equal(review(tx, wallet.output, {}, [], { ignore: [feeWallet.output] }), null);
});
