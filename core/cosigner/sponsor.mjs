// Fee sponsoring ("gasless" payments on Bitcoin): Swissquote pays the network fee for its clients.
// The client's payment gets one extra input from Swissquote's own small fee wallet, and that input
// pays the whole fee; the client sends exactly the amount and needs no extra coins for fees.
// The fee wallet holds Swissquote's money only (a hot wallet with a single key, like any bank's
// operational wallet); it never holds client funds and is unrelated to the client's key shares.
//
// Abuse prevention:
// - only wallets with a verified ownership proof (a Swissquote client who proved the address);
// - Swissquote signs its input last, only for a transaction it has already co-signed under the
//   normal policy (limits, sanctions, card), and only if its net outflow is at most MAX_FEE;
// - per-wallet daily quota (number of sponsored payments and total fees), capped fee rate;
// - each fee-wallet coin is reserved for one wallet at a time and never signed twice.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bitcoin, SIGHASH, p2wpkh, sighash, esplora } from '../shared/bitcoin.mjs';

export const MAX_FEE_SATS = BigInt(process.env.SPONSOR_MAX_FEE_SATS ?? 1_000);
export const DAILY_COUNT = Number(process.env.SPONSOR_DAILY_COUNT ?? 10);
export const DAILY_FEES_SATS = BigInt(process.env.SPONSOR_DAILY_FEES_SATS ?? 5_000);
const MAX_FEE_RATE = Number(process.env.SPONSOR_MAX_FEE_RATE ?? 2); // sat/vB; signet confirms at 1-2
const RESERVATION_MS = 2 * 60_000;

const today = () => new Date().toISOString().slice(0, 10);
const outpoint = (txid, vout) => `${txid}:${vout}`;
const inputOutpoint = input => outpoint(Buffer.from(input.hash).reverse().toString('hex'), input.index);

export function openSponsor(dataDir) {
  const file = new URL('sponsor.json', dataDir);
  if (!existsSync(file)) {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(file, JSON.stringify({ privateKey: Buffer.from(secp256k1.utils.randomSecretKey()).toString('hex'), createdAt: new Date().toISOString() }, null, 2));
  }
  const privateKey = Buffer.from(JSON.parse(readFileSync(file)).privateKey, 'hex');
  const pubkey = Buffer.from(secp256k1.getPublicKey(privateKey, true));
  const { address, output } = p2wpkh(pubkey);
  const reservations = new Map(); // outpoint → { wallet, value, expires }
  // Coins signed away. If the payment is never broadcast, the coin becomes usable again after a
  // while; reusing it then only invalidates the old signed payment, Swissquote never pays twice.
  const spent = new Map(); // outpoint → time after which it may be offered again
  const isSpent = op => (spent.get(op) ?? 0) > Date.now();

  const usage = state => (state.sponsor?.day === today() ? state.sponsor : { day: today(), count: 0, fees: '0' });

  // Why a wallet cannot be sponsored right now, or null.
  function ineligible(state) {
    if (!state.ownership) return 'Prove ownership of the wallet first.';
    const u = usage(state);
    if (u.count >= DAILY_COUNT) return `Daily quota of ${DAILY_COUNT} sponsored payments reached.`;
    if (BigInt(u.fees) + MAX_FEE_SATS > DAILY_FEES_SATS) return 'Daily sponsored fee budget reached.';
    return null;
  }

  return {
    address,

    async info() {
      const utxos = await esplora(`/address/${address}/utxo`);
      return { address, sats: utxos.reduce((s, u) => s + u.value, 0), maxFee: String(MAX_FEE_SATS), dailyCount: DAILY_COUNT, dailyFees: String(DAILY_FEES_SATS) };
    },

    // Offers one fee-wallet coin. A preview only peeks (`reserve` false); a payment reserves the
    // coin for this wallet until it is signed or the reservation expires. When coins are few and
    // this one is large, the client is asked to return Swissquote's change as two coins, so the fee
    // wallet keeps several coins and can sponsor several clients at the same time.
    async quote(wallet, state, { reserve = false } = {}) {
      const reason = ineligible(state);
      if (reason) return { available: false, reason };
      const now = Date.now();
      for (const [op, r] of reservations) if (r.expires < now) reservations.delete(op);
      const utxos = await esplora(`/address/${address}/utxo`);
      const free = utxos.filter(u => !isSpent(outpoint(u.txid, u.vout)) && !reservations.has(outpoint(u.txid, u.vout)));
      let [op, r] = [...reservations].find(([, x]) => x.wallet === wallet) ?? [];
      if (!op) {
        const coin = free
          .filter(u => BigInt(u.value) >= MAX_FEE_SATS + 546n)
          .sort((a, b) => Number(b.status.confirmed) - Number(a.status.confirmed) || a.value - b.value)[0];
        if (!coin) return { available: false, reason: 'Swissquote fee wallet temporarily empty.' };
        op = outpoint(coin.txid, coin.vout);
        r = { wallet, value: coin.value };
      }
      if (reserve) reservations.set(op, { ...r, expires: now + RESERVATION_MS });
      const estimates = await esplora('/fee-estimates');
      const feeRate = Math.min(MAX_FEE_RATE, Math.max(1, Math.ceil(estimates['6'] ?? 1)));
      const changeOutputs = free.length < 6 && BigInt(r.value) >= 4n * MAX_FEE_SATS + 2n * 546n ? 2 : 1;
      const [txid, vout] = op.split(':');
      return { available: true, reserved: reserve, txid, vout: Number(vout), value: r.value, address, feeRate, changeOutputs, maxFee: String(MAX_FEE_SATS) };
    },

    // Finds Swissquote's input in a transaction and checks the sponsorship terms. Returns
    // { index, value, fee } when the transaction has a valid sponsor input, null when it has none,
    // or throws a refusal. `fee` is what Swissquote actually pays: its input minus its change.
    inspect(tx, wallet) {
      const mine = tx.ins.map((input, index) => ({ index, op: inputOutpoint(input) })).filter(x => reservations.has(x.op) || isSpent(x.op));
      if (mine.length === 0) return null;
      const refuse = reason => { throw Object.assign(new Error(reason), { status: 403, code: 'SPONSOR_REFUSED' }); };
      if (mine.length > 1) refuse('Only one Swissquote fee input per payment.');
      const { index, op } = mine[0];
      const r = reservations.get(op);
      if (!r || r.wallet !== wallet || isSpent(op)) refuse('This fee-wallet coin is not reserved for this wallet.');
      const changes = tx.outs.filter(o => Buffer.from(o.script).equals(Buffer.from(output)));
      if (changes.length < 1 || changes.length > 2) refuse('The payment must return Swissquote\'s change to its fee wallet.');
      const fee = BigInt(r.value) - changes.reduce((sum, o) => sum + BigInt(o.value), 0n);
      if (fee < 0n || fee > MAX_FEE_SATS) refuse(`Swissquote pays at most ${MAX_FEE_SATS} sats of fees per payment.`);
      // Size of a P2WPKH transaction once signed: the witnesses are not there yet.
      const vsize = BigInt(11 + 68 * tx.ins.length + 31 * tx.outs.length);
      if (fee > vsize * BigInt(MAX_FEE_RATE)) refuse('Fee rate above the sponsored maximum.');
      return { index, value: r.value, fee };
    },

    // Swissquote's script, so the policy does not count its change as an outgoing payment.
    script: output,

    // Signs Swissquote's input, last, and records the quota. Called only for a transaction the
    // co-signer has co-signed (its inputs carry the client's signatures).
    sign(tx, wallet, state) {
      const found = this.inspect(tx, wallet);
      if (!found) throw Object.assign(new Error('No Swissquote fee input in this payment.'), { status: 400 });
      const reason = ineligible(state);
      if (reason) throw Object.assign(new Error(reason), { status: 403, code: 'SPONSOR_REFUSED' });
      const hash = sighash(tx, found.index, pubkey, found.value);
      const sig = secp256k1.sign(hash, privateKey, { prehash: false, lowS: true, format: 'compact' });
      const op = inputOutpoint(tx.ins[found.index]);
      spent.set(op, Date.now() + 30 * 60_000);
      reservations.delete(op);
      const u = usage(state);
      state.sponsor = { day: u.day, count: u.count + 1, fees: String(BigInt(u.fees) + found.fee) };
      return { index: found.index, witness: [Buffer.from(bitcoin.script.signature.encode(Buffer.from(sig), SIGHASH)).toString('hex'), pubkey.toString('hex')], fee: String(found.fee) };
    },
  };
}

