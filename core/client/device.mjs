// Client-side wallet logic shared by the command line and the app.
// A device holds Share 1 (phone) in `phoneDir`. The recovery card is a separate object,
// `cardDir` (MOCK: a folder standing in for the FIDO2 card envelope with Share 3).
// The device never sees Share 2: it only exchanges protocol messages with the co-signer.
// `cloudDir` is the client's own cloud drive (MOCK: a folder) holding the encrypted Share 1 backup.
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { PARTIES, THRESHOLD, PARTY, KeygenSession, Keyshare, SignSession, step, toWire, fromWire, broadcastFor, directFor, toLowS } from '../shared/mpc.mjs';
import { bitcoin, net, SIGHASH, EXPLORER, NETWORK, p2wpkh, sighash, esplora } from '../shared/bitcoin.mjs';
import { verifierOf, seal, open } from '../shared/backup.mjs';
import { proofHash, encodeSimple, verifySimple } from '../shared/bip322.mjs';
import { openCard } from './card.mjs';
import { openKeychain } from './keychain.mjs';

export { EXPLORER, NETWORK };
const DUST = 546n;
export const addressOf = hex => p2wpkh(Buffer.from(hex, 'hex')).address;

// `keychainDir` is the client's Apple/Google account keychain holding the passkey (MOCK: a folder).
export function openDevice({ phoneDir, cardDir, cloudDir, keychainDir, cosigner = 'http://localhost:4000' }) {
  const file = (dir, name) => join(dir, name);
  const readJson = (dir, name) => JSON.parse(readFileSync(file(dir, name)));
  const writeJson = (dir, name, value) => { mkdirSync(dir, { recursive: true }); writeFileSync(file(dir, name), JSON.stringify(value, null, 2)); };
  const config = () => readJson(phoneDir, 'config.json');
  const hasWallet = () => existsSync(file(phoneDir, 'config.json'));
  const cardShare = () => readFileSync(file(cardDir, 'share.bin'));
  const backup = () => (cloudDir && existsSync(file(cloudDir, 'backup.json')) ? readJson(cloudDir, 'backup.json') : null);
  const card = openCard(cardDir);
  const keychain = openKeychain(keychainDir);

  // A card tap: Swissquote's challenge for this purpose, signed by the card after its PIN check.
  async function tapCard(pin, purpose, detail) {
    const wallet = config().wallet;
    const challenge = await api('/card/challenge', { wallet, purpose, detail });
    return { challengeId: challenge.id, signature: card.tap(pin, challenge.message) };
  }

  async function api(route, body = {}, token = hasWallet() ? config().token : undefined) {
    let res;
    try {
      res = await fetch(cosigner + route, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw Object.assign(new Error('Swissquote cannot be reached right now.'), { code: 'COSIGNER_UNREACHABLE', cause: err });
    }
    const json = await res.json();
    if (!res.ok) throw Object.assign(new Error(json.error), { code: json.code });
    return json;
  }

  // Distributed key generation: the phone and card parties run here, Swissquote on its server.
  // With `replaceCard`, the existing key is re-shared instead: the phone and Swissquote keep it,
  // and a new card share replaces the lost one.
  async function keygen({ recovery, token, replaceCard, pin } = {}) {
    // The (new) card prepares its key first; it is registered together with the wallet and only
    // committed to the card once Swissquote confirmed, so a network failure leaves the card unchanged.
    const activation = card.prepareActivation(pin);
    const cardKey = activation.publicKey;
    const ids = [PARTY.phone, PARTY.card];
    const lost = new Uint8Array([PARTY.card]);
    const local = replaceCard
      ? {
          [PARTY.phone]: KeygenSession.initKeyRecovery(Keyshare.fromBytes(readFileSync(file(phoneDir, 'share.bin'))), lost),
          [PARTY.card]: KeygenSession.initLostShareRecovery(PARTIES, THRESHOLD, PARTY.card, Buffer.from(replaceCard, 'hex'), lost),
        }
      : Object.fromEntries(ids.map(id => [id, new KeygenSession(PARTIES, THRESHOLD, id)]));
    const run = fn => ids.flatMap(id => fn(local[id], id));

    const m1 = ids.map(id => toWire(local[id].createFirstMessage()));
    const s = await api('/keygen/start', { m1, recovery, replaceCard }, token);
    const all1 = [...m1, s.m1];
    const m2 = [...run((p, id) => step(p, broadcastFor(all1, id))), ...s.m2];
    const commitments = [PARTY.phone, PARTY.swissquote, PARTY.card].map(id =>
      id === PARTY.swissquote ? s.commitment : Buffer.from(local[id].calculateChainCodeCommitment()).toString('base64'));

    const { m3: s3 } = await api('/keygen/round2', { id: s.id, m2: directFor(m2, PARTY.swissquote) });
    const m3 = [...run((p, id) => step(p, directFor(m2, id))), ...s3];

    const { m4: s4 } = await api('/keygen/round3', { id: s.id, m3: directFor(m3, PARTY.swissquote), commitments });
    const all = commitments.map(c => Buffer.from(c, 'base64'));
    const m4 = [...run((p, id) => step(p, directFor(m3, id), all)), ...s4];

    const created = await api('/keygen/finish', { id: s.id, m4: m4.filter(m => m.from !== PARTY.swissquote), cardKey });
    run((p, id) => step(p, broadcastFor(m4, id)));

    const [phoneShare, cardShareNew] = ids.map(id => local[id].keyshare());
    for (const share of [phoneShare, cardShareNew]) {
      if (Buffer.from(share.publicKey).toString('hex') !== created.wallet) throw new Error('Public keys do not match.');
    }
    mkdirSync(phoneDir, { recursive: true });
    mkdirSync(cardDir, { recursive: true });
    // Overwriting the phone share deletes the old one, which matters after a re-share.
    writeFileSync(file(phoneDir, 'share.bin'), phoneShare.toBytes());
    // Sealing Share 3 to the card. During a recovery, keep the previous card share until the
    // sweep is done; a replaced (lost) card share is simply overwritten.
    if (!replaceCard && existsSync(file(cardDir, 'share.bin'))) copyFileSync(file(cardDir, 'share.bin'), file(cardDir, 'previous.bin'));
    writeFileSync(file(cardDir, 'share.bin'), cardShareNew.toBytes());
    writeJson(phoneDir, 'config.json', { wallet: created.wallet, token: created.token });
    activation.commit();
    return created.wallet;
  }

  // Two-party MPC signing with the co-signer. `start` opens the session on the server and
  // returns its first messages; `hashOf` gives the hash to sign, from what the server returned.
  async function cosign({ share, party, token, start, hashOf }) {
    const session = new SignSession(Keyshare.fromBytes(share), 'm');
    const m1 = toWire(session.createFirstMessage());
    const s = await start([m1]);
    const m2 = step(session, broadcastFor([s.m1], party));
    const m3 = step(session, directFor(s.m2, party));
    const f = await api('/sign/finish', { id: s.id, m2, m3 }, token);
    step(session, directFor(f.m3, party));
    // Only the client assembles the final signature, so its own last message stays local.
    session.lastMessage(hashOf(s));
    return { sig: session.combine([fromWire(f.last)]), started: s };
  }

  // One input signed with the co-signer, using either the phone share or the card share.
  async function signWithCosigner({ tx, i, values, wallet, share, party, token }) {
    const { sig } = await cosign({
      share, party, token,
      start: m1 => api('/sign/start', { wallet, txHex: tx.toHex(), input: i, values, m1 }, token),
      hashOf: () => sighash(tx, i, Buffer.from(wallet, 'hex'), values[i]),
    });
    return sig;
  }

  // Ownership proof for the Travel Rule: phone + Swissquote sign Swissquote's message with
  // BIP-322. The hash is computed here from the message text, so the phone only ever signs a
  // virtual BIP-322 transaction, never a payment. No funds move and no fee is paid.
  async function proveOwnership() {
    const { wallet, token } = config();
    const pubkey = Buffer.from(wallet, 'hex');
    const { sig, started } = await cosign({
      share: readFileSync(file(phoneDir, 'share.bin')), party: PARTY.phone, token,
      start: m1 => api('/ownership/start', { wallet, m1 }, token),
      hashOf: s => proofHash(pubkey, s.message),
    });
    const signature = encodeSimple(toLowS(sig), pubkey);
    if (!verifySimple(addressOf(wallet), started.message, signature)) throw new Error('Invalid ownership proof.');
    return api('/ownership/verify', { wallet, signature }, token);
  }

  // Escape route: phone + card sign together on the device, without any server.
  function signLocally({ tx, i, values, wallet }) {
    const hash = sighash(tx, i, Buffer.from(wallet, 'hex'), values[i]);
    const shares = [readFileSync(file(phoneDir, 'share.bin')), cardShare()];
    const ids = [PARTY.phone, PARTY.card];
    const parties = shares.map(b => new SignSession(Keyshare.fromBytes(b), 'm'));
    const m1 = parties.map(p => toWire(p.createFirstMessage()));
    const m2 = parties.flatMap((p, k) => step(p, broadcastFor(m1, ids[k])));
    const m3 = parties.flatMap((p, k) => step(p, directFor(m2, ids[k])));
    parties.forEach((p, k) => step(p, directFor(m3, ids[k])));
    const last = parties.map(p => toWire(p.lastMessage(hash)));
    return parties[0].combine([fromWire(last[1])]);
  }

  // Builds an unsigned transaction and a plain-language summary of it. With a sponsor `quote`,
  // Swissquote's fee wallet adds one input that pays the whole network fee ("gasless" payment):
  // the client's coins cover exactly the amount and the client's change.
  async function build({ wallet, to, amount, sweep, quote }) {
    const own = p2wpkh(Buffer.from(wallet, 'hex'));
    const utxos = await esplora(`/address/${own.address}/utxo`);
    if (utxos.length === 0) throw Object.assign(new Error('There are no funds in this wallet.'), { code: 'NO_FUNDS' });
    const total = utxos.reduce((sum, u) => sum + BigInt(u.value), 0n);
    const sponsored = !sweep && quote?.available;
    let feeRate;
    if (sponsored) feeRate = BigInt(quote.feeRate);
    else {
      const estimates = await esplora('/fee-estimates');
      // Signet fee estimates are noisy and its blocks are not full: 1-2 sat/vB confirms. Cap the
      // rate so test fees stay proportionate (production would follow the market).
      const maxRate = Number(process.env.MAX_FEE_RATE ?? 2);
      feeRate = BigInt(Math.min(maxRate, Math.max(1, Math.ceil(estimates['6'] ?? 1))));
    }
    const inputs = BigInt(utxos.length + (sponsored ? 1 : 0));
    const outputs = sweep ? 1n : 2n + (sponsored ? BigInt(quote.changeOutputs ?? 1) : 0n);
    const fee = feeRate * (11n + 68n * inputs + 31n * outputs);
    const value = sweep ? total - fee : BigInt(amount);
    // When sponsored, the client pays no fee: only a change below the dust limit is left to the fee.
    const change = total - value - (sponsored ? 0n : fee);
    if (value < DUST || change < 0n) throw Object.assign(new Error(`Not enough funds: ${total} sats available.`), { code: 'NO_FUNDS' });

    let script;
    try { script = bitcoin.address.toOutputScript(to, net); }
    catch { throw Object.assign(new Error('That is not a valid Bitcoin test address.'), { code: 'BAD_ADDRESS' }); }

    const tx = new bitcoin.Transaction();
    tx.version = 2;
    for (const u of utxos) tx.addInput(Buffer.from(u.txid, 'hex').reverse(), u.vout);
    tx.addOutput(script, value);
    const keepsChange = !sweep && change >= DUST;
    if (keepsChange) tx.addOutput(own.output, change);
    const values = utxos.map(u => u.value);
    let clientFee = sponsored ? (keepsChange ? 0n : change) : fee;
    let sponsorIndex = null;
    if (sponsored) {
      // Swissquote's input goes last; its change goes back to its fee wallet.
      const sponsorPays = fee > clientFee ? fee - clientFee : 0n;
      if (sponsorPays > BigInt(quote.maxFee)) {
        return build({ wallet, to, amount, quote: { available: false, reason: 'This fee is above what Swissquote sponsors.' } });
      }
      sponsorIndex = tx.ins.length;
      tx.addInput(Buffer.from(quote.txid, 'hex').reverse(), quote.vout);
      // Swissquote's change, as one or two coins (see the quote).
      const back = BigInt(quote.value) - sponsorPays;
      const feeScript = bitcoin.address.toOutputScript(quote.address, net);
      if ((quote.changeOutputs ?? 1) === 2) {
        tx.addOutput(feeScript, back / 2n);
        tx.addOutput(feeScript, back - back / 2n);
      } else tx.addOutput(feeScript, back);
      values.push(quote.value);
    } else if (!sweep && !keepsChange) clientFee = fee + change;
    const summary = {
      from: own.address, to, amount: Number(value), fee: Number(clientFee), feeRate: Number(feeRate),
      sponsored: !!sponsored, networkFee: Number(fee), sponsorNote: sweep ? null : (sponsored ? null : quote?.reason ?? null),
    };
    return { tx, values, sponsorIndex, summary };
  }

  // Asks Swissquote to pay the fee of the next payment. Never fails: without a sponsor the
  // client simply pays the fee, as before.
  async function sponsorQuote(wallet, { reserve = false } = {}) {
    try { return await api('/sponsor/quote', { wallet, reserve }); }
    catch (err) { return { available: false, reason: err.message }; }
  }

  async function signAndSend({ tx, values, wallet, signer, broadcast, sponsorIndex = null }) {
    const pubkey = Buffer.from(wallet, 'hex');
    for (let i = 0; i < values.length; i++) {
      if (i === sponsorIndex) continue;
      const sig = toLowS(await signer({ tx, i, values, wallet }));
      if (!secp256k1.verify(sig, sighash(tx, i, pubkey, values[i]), pubkey, { prehash: false })) throw new Error(`Invalid signature on input ${i}.`);
      tx.setWitness(i, [bitcoin.script.signature.encode(sig, SIGHASH), pubkey]);
    }
    if (sponsorIndex !== null) {
      // Swissquote signs its fee input last, after co-signing the client's inputs.
      const s = await api('/sponsor/sign', { wallet, txHex: tx.toHex() });
      tx.setWitness(s.index, s.witness.map(w => Buffer.from(w, 'hex')));
    }
    const txid = broadcast ? await esplora('/tx', { method: 'POST', body: tx.toHex() }) : tx.getId();
    return { txid, broadcast: !!broadcast, url: `${EXPLORER}/tx/${txid}` };
  }

  // After creation or recovery the wallet already exists, so a failed proof must not undo it:
  // it is reported and can be retried from the app ("Prove ownership") or `wallet.mjs prove`.
  async function proveOwnershipSafely() {
    try { return await proveOwnership(); }
    catch (err) { console.warn(`Ownership proof not recorded yet: ${err.message}`); return null; }
  }

  const phoneSigner = () => {
    const { token } = config();
    const share = readFileSync(file(phoneDir, 'share.bin'));
    return ctx => signWithCosigner({ ...ctx, share, party: PARTY.phone, token });
  };

  return {
    hasWallet,
    hasCard: () => existsSync(file(cardDir, 'share.bin')),
    wallet: () => config().wallet,
    address: () => addressOf(config().wallet),

    async create({ pin }) {
      if (hasWallet()) throw new Error('A wallet already exists on this device.');
      // Like a real FIDO2 card, an activated card is not silently reused for another wallet.
      if (existsSync(file(cardDir, 'share.bin'))) {
        throw Object.assign(new Error('This recovery card already belongs to a wallet. Use "Recover my wallet" instead.'), { code: 'CARD_IN_USE' });
      }
      const address = addressOf(await keygen({ pin }));
      await proveOwnershipSafely();
      return address;
    },

    proveOwnership,

    async balance() {
      const utxos = await esplora(`/address/${addressOf(config().wallet)}/utxo`);
      return {
        sats: utxos.reduce((s, u) => s + u.value, 0),
        pending: utxos.filter(u => !u.status.confirmed).reduce((s, u) => s + u.value, 0),
      };
    },

    async history() {
      const address = addressOf(config().wallet);
      const txs = await esplora(`/address/${address}/txs`);
      return txs.map(t => {
        const received = t.vout.filter(o => o.scriptpubkey_address === address).reduce((s, o) => s + o.value, 0);
        const sent = t.vin.filter(i => i.prevout?.scriptpubkey_address === address).reduce((s, i) => s + i.prevout.value, 0);
        return { txid: t.txid, delta: received - sent, confirmed: t.status.confirmed, time: t.status.block_time ?? null, url: `${EXPLORER}/tx/${t.txid}` };
      });
    },

    // Swissquote's pre-signing checks on the recipient and the limits, for the review screen.
    screen: ({ to, amount }) => api('/screen', { wallet: config().wallet, to, amount: String(amount ?? 0) }),

    async preview({ to, amount, sweep }) {
      const wallet = config().wallet;
      const quote = sweep ? null : await sponsorQuote(wallet);
      return (await build({ wallet, to, amount, sweep, quote })).summary;
    },

    // With `pin`, the card is tapped first to approve this exact transaction (needed above the
    // card threshold; the co-signer answers CARD_REQUIRED otherwise).
    async send({ to, amount, broadcast, pin }) {
      const wallet = config().wallet;
      const { tx, values, summary, sponsorIndex } = await build({ wallet, to, amount, quote: await sponsorQuote(wallet, { reserve: true }) });
      if (pin !== undefined) {
        const txid = tx.getId();
        await api('/card/approve', { wallet, txid, ...(await tapCard(pin, 'sign', txid)) });
      }
      return { ...summary, ...(await signAndSend({ tx, values, wallet, signer: phoneSigner(), broadcast, sponsorIndex })) };
    },

    // Raising a limit needs a card tap bound to the new values; lowering one does not.
    async setLimits({ cardThreshold, dailyLimit, pin }) {
      const wallet = config().wallet;
      const values = { cardThreshold: String(cardThreshold), dailyLimit: String(dailyLimit) };
      const tap = pin !== undefined ? await tapCard(pin, 'limits', `${values.cardThreshold}:${values.dailyLimit}`) : {};
      return api('/settings/limits', { wallet, ...values, ...tap });
    },

    // Escape: phone + card sign locally, no server involved. The card must accept its PIN first,
    // as a real card would before releasing Share 3.
    async escape({ to, broadcast, pin }) {
      const wallet = config().wallet;
      card.tap(pin ?? '', `escape-unlock|${wallet}`);
      const { tx, values, summary } = await build({ wallet, to, sweep: true });
      return { ...summary, ...(await signAndSend({ tx, values, wallet, signer: signLocally, broadcast })) };
    },
    previewEscape: async ({ to }) => (await build({ wallet: config().wallet, to, sweep: true })).summary,

    // Lost card: identity verification and a waiting period, then phone + Swissquote re-share
    // the key onto a new card. The address does not change; the old card stops working.
    async cardReplaceStart({ identity }) {
      return api('/card/replace', { wallet: config().wallet, identity });
    },
    async cardReplaceComplete({ pin }) {
      const { wallet } = config();
      await keygen({ replaceCard: wallet, pin });
      return { address: addressOf(wallet) };
    },

    freeze: () => api('/freeze', { wallet: config().wallet }),
    // Unfreeze: video identification result plus a card tap bound to this wallet.
    async unfreeze({ identity, pin }) {
      const wallet = config().wallet;
      const tap = identity === 'pass' && pin !== undefined ? await tapCard(pin, 'unfreeze', wallet) : {};
      return api('/unfreeze', { wallet, identity, ...tap });
    },
    status: () => api('/status', { wallet: config().wallet }),

    // --- Backup of Share 1, for losing the phone AND the card. Lock A is the passkey of the
    // client's Apple/Google account: nothing for the client to write down. ---
    hasBackup() {
      const b = backup();
      return !!b && (!hasWallet() || b.wallet === config().wallet);
    },
    hasAccount: () => keychain.available(),
    async backupCreate() {
      if (!cloudDir) throw new Error('No cloud drive configured.');
      const { wallet } = config();
      const keyA = keychain.prf(wallet, { create: true });
      const { keyB } = await api('/backup/enroll', { wallet, verifier: verifierOf(keyA) });
      const box = seal(readFileSync(file(phoneDir, 'share.bin')), keyA, Buffer.from(keyB, 'base64'));
      writeJson(cloudDir, 'backup.json', { wallet, lock: 'passkey', createdAt: new Date().toISOString(), ...box });
    },

    // Recovery on a new phone, with the card (method "card") or with the Apple/Google backup when
    // the card is lost too (method "backup"). The old phone is gone either way.
    async recoveryStart({ identity, method = 'card' }) {
      if (hasWallet()) throw new Error('This phone already has a wallet.');
      let oldWallet, party;
      if (method === 'backup') {
        if (!backup()) throw Object.assign(new Error('No backup found in your cloud drive.'), { code: 'NO_BACKUP' });
        oldWallet = backup().wallet;
        party = PARTY.phone;
      } else {
        const old = Keyshare.fromBytes(cardShare());
        oldWallet = Buffer.from(old.publicKey).toString('hex');
        party = old.partyId;
      }
      const { token, readyAt } = await api('/recovery/start', { wallet: oldWallet, identity, method }, null);
      writeJson(phoneDir, 'recovery.json', { oldWallet, token, readyAt, party, method });
      return { oldAddress: addressOf(oldWallet), readyAt };
    },

    async recoveryComplete({ broadcast, pin }) {
      const rec = readJson(phoneDir, 'recovery.json');
      if (Date.now() < rec.readyAt) throw Object.assign(new Error('The waiting period has not ended yet.'), { code: 'RECOVERY_PENDING' });
      let oldShare;
      if (rec.method === 'backup') {
        const keyA = keychain.prf(rec.oldWallet); // the passkey synced from the client's Apple/Google account
        // Prove lock A to Swissquote (without revealing it), get lock B, open the backup.
        const { keyB } = await api('/recovery/backup-key', { wallet: rec.oldWallet, proof: verifierOf(keyA) }, rec.token);
        oldShare = open(backup(), keyA, Buffer.from(keyB, 'base64'));
      } else {
        // Read the old card share before keygen seals a new one onto the card.
        oldShare = cardShare();
      }
      const newWallet = await keygen({ recovery: rec.oldWallet, token: rec.token, pin });
      const { tx, values, summary } = await build({ wallet: rec.oldWallet, to: addressOf(newWallet), sweep: true });
      const result = await signAndSend({
        tx, values, wallet: rec.oldWallet, broadcast,
        signer: ctx => signWithCosigner({ ...ctx, share: oldShare, party: rec.party, token: rec.token }),
      });
      // The new wallet proves its ownership too, so Swissquote's Travel Rule record follows the funds.
      const ownership = await proveOwnershipSafely();
      return { ...summary, ...result, newAddress: addressOf(newWallet), ownership };
    },
  };
}
