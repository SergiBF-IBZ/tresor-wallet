// Swissquote co-signer: a separate process that holds Share 2 of every wallet in its own storage.
// Each share is generated here during distributed key generation and never leaves this process.
// MOCK: banking backend, client authentication (bearer tokens instead of passkeys),
// video identification and compliance provider.
import { createServer } from 'node:http';
import { randomUUID, randomBytes, verify as ecVerify } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { PARTIES, THRESHOLD, PARTY, KeygenSession, Keyshare, SignSession, step, toWire, broadcastFor, directFor } from '../shared/mpc.mjs';
import { bitcoin, net, p2wpkh, sighash } from '../shared/bitcoin.mjs';
import { review, recordSpend, limitsOf, MAX_DAILY_LIMIT_SATS } from './policy.mjs';
import { newLockBKey, verifierMatches } from '../shared/backup.mjs';
import { proofHash, verifySimple } from '../shared/bip322.mjs';
import { openSponsor } from './sponsor.mjs';

const PORT = Number(process.env.COSIGNER_PORT ?? 4000);
// 48 hours in production; set RECOVERY_DELAY_SECONDS=20 for the demo.
const RECOVERY_DELAY_MS = Number(process.env.RECOVERY_DELAY_SECONDS ?? 48 * 3600) * 1000;
// Recovering without the card (Apple/Google passkey backup) waits longer: a thief holding the
// unlocked phone may also hold the synced passkey, so the real client needs more time to react.
// 7 days in production; set BACKUP_RECOVERY_DELAY_SECONDS=40 for the demo.
const BACKUP_RECOVERY_DELAY_MS = Number(process.env.BACKUP_RECOVERY_DELAY_SECONDS ?? 7 * 24 * 3600) * 1000;
const DATA = new URL('./data/', import.meta.url);
const sponsor = openSponsor(DATA); // Swissquote's fee wallet for sponsored ("gasless") payments

// --- Storage: one folder per wallet, keyed by its public key. ---
const walletDir = id => new URL(`wallets/${id}/`, DATA);
const walletExists = id => existsSync(new URL('share.bin', walletDir(id)));
const loadWallet = id => {
  if (!/^[0-9a-f]{66}$/.test(id ?? '') || !walletExists(id)) throw httpError(404, 'Unknown wallet.');
  return JSON.parse(readFileSync(new URL('state.json', walletDir(id))));
};
const saveWallet = (id, state) => writeFileSync(new URL('state.json', walletDir(id)), JSON.stringify(state, null, 2));
const shareOf = id => readFileSync(new URL('share.bin', walletDir(id)));
// MOCK sanctions list: data/sanctions.json if present, otherwise the default list shipped with the code.
const sanctionsFile = () => existsSync(new URL('sanctions.json', DATA)) ? new URL('sanctions.json', DATA) : new URL('./sanctions.json', import.meta.url);
const sanctioned = () => JSON.parse(readFileSync(sanctionsFile()));
// MOCK directory of counterparties Swissquote has verified (its own deposit addresses, approved services).
const directory = () => JSON.parse(readFileSync(new URL('./directory.json', import.meta.url)));

const keygens = new Map();   // in-progress key generation sessions
const signings = new Map();  // in-progress signing sessions, each used exactly once
const challenges = new Map();    // card-tap challenges, single use, 2 minutes
const cardApprovals = new Map(); // `${wallet}:${txid}` → expiry, after a valid card tap
const ownershipRequests = new Map(); // wallet → ownership message waiting for its signature
const coSigned = new Map(); // `${wallet}:${txid}` → expiry, payments whose client inputs Swissquote co-signed

// Card taps: Swissquote issues a challenge bound to one purpose (a transaction or new limits);
// the card signs it with the key registered at wallet creation, after checking its PIN.
function newChallenge(wallet, purpose, detail) {
  const id = randomUUID();
  const message = `swissquote-card|${wallet}|${purpose}|${detail}|${randomBytes(16).toString('hex')}`;
  challenges.set(id, { wallet, purpose, detail, message, expires: Date.now() + 120_000 });
  return { id, message };
}

function checkCardTap(state, wallet, { challengeId, signature } = {}, purpose, detail) {
  const c = challenges.get(challengeId);
  challenges.delete(challengeId);
  const valid = c && c.wallet === wallet && c.purpose === purpose && c.detail === detail && Date.now() < c.expires
    && state.cardKey && ecVerify('sha256', Buffer.from(c.message),
      { key: Buffer.from(state.cardKey, 'base64'), format: 'der', type: 'spki' }, Buffer.from(signature ?? '', 'base64'));
  if (!valid) throw httpError(403, 'The card tap could not be verified.', 'CARD_INVALID');
}

// Who is calling: the wallet owner (normal mode) or an approved recovery (recovery mode).
function authenticate(req, body) {
  const token = (req.headers.authorization ?? '').replace('Bearer ', '');
  const id = body.wallet;
  const state = loadWallet(id);
  if (token && token === state.token) return { id, state, mode: 'normal' };
  const rec = state.recovery;
  if (token && rec && token === rec.token) {
    if (rec.status !== 'approved' || Date.now() < rec.readyAt) throw httpError(403, 'Recovery is still in its waiting period.', 'RECOVERY_PENDING');
    return { id, state, mode: 'recovery' };
  }
  throw httpError(401, 'Not authenticated.');
}

const routes = {
  // --- Distributed key generation: Swissquote runs party 1 only. ---
  // MOCK: onboarding would require a logged-in, KYC-verified Swissquote client.
  // During a recovery, the new wallet must be created with the recovery token.
  // With `replaceCard`, the same protocol re-shares an existing key: phone and Swissquote keep
  // the key, a new card share replaces the lost one, and every old share stops working.
  'POST /keygen/start'({ m1, recovery, replaceCard }, req) {
    let linkedFrom = null;
    let session;
    if (recovery) {
      const { id, mode } = authenticate(req, { wallet: recovery });
      if (mode !== 'recovery') throw httpError(403, 'A new wallet during recovery needs an approved recovery.');
      linkedFrom = id;
    }
    if (replaceCard) {
      const { id, state, mode } = authenticate(req, { wallet: replaceCard });
      const pending = state.cardReplacement;
      if (mode !== 'normal' || !pending || Date.now() < pending.readyAt) {
        throw httpError(403, 'Card replacement needs identity verification and the waiting period.', 'REPLACEMENT_PENDING');
      }
      session = KeygenSession.initKeyRecovery(Keyshare.fromBytes(shareOf(id)), new Uint8Array([PARTY.card]));
    } else {
      session = new KeygenSession(PARTIES, THRESHOLD, PARTY.swissquote);
    }
    const own1 = toWire(session.createFirstMessage());
    const own2 = step(session, broadcastFor(m1, PARTY.swissquote));
    const commitment = Buffer.from(session.calculateChainCodeCommitment()).toString('base64');
    const id = randomUUID();
    keygens.set(id, { session, linkedFrom, replaceCard });
    return { id, m1: own1, m2: own2, commitment };
  },
  'POST /keygen/round2'({ id, m2 }) {
    return { m3: step(keygen(id).session, directFor(m2, PARTY.swissquote)) };
  },
  'POST /keygen/round3'({ id, m3, commitments }) {
    const all = commitments.map(c => Buffer.from(c, 'base64'));
    return { m4: step(keygen(id).session, directFor(m3, PARTY.swissquote), all) };
  },
  // `cardKey` is the public key of the card activated during this key generation. It is only
  // registered here (creation, recovery, verified card replacement), never on its own, so a
  // thief with an unlocked phone cannot register a card of their own.
  'POST /keygen/finish'({ id, m4, cardKey }) {
    const { session, linkedFrom, replaceCard } = keygen(id);
    step(session, broadcastFor(m4, PARTY.swissquote));
    const keyshare = session.keyshare();
    keygens.delete(id);
    const wallet = Buffer.from(keyshare.publicKey).toString('hex');

    if (replaceCard) {
      if (wallet !== replaceCard) throw httpError(500, 'Re-sharing changed the public key.');
      // Overwriting the old share deletes it: refreshed shares are only safe once old ones are gone.
      writeFileSync(new URL('share.bin', walletDir(wallet)), keyshare.toBytes());
      const state = loadWallet(wallet);
      delete state.cardReplacement;
      if (cardKey) state.cardKey = cardKey;
      saveWallet(wallet, state);
      alert(wallet, 'Recovery card replaced. The old card no longer works.');
      return { wallet, token: state.token };
    }

    mkdirSync(walletDir(wallet), { recursive: true });
    writeFileSync(new URL('share.bin', walletDir(wallet)), keyshare.toBytes());
    const token = randomUUID();
    // MOCK: the Swissquote client number would come from the logged-in, KYC-verified session.
    const clientId = linkedFrom ? clientOf(linkedFrom) : `SQ-${randomBytes(4).toString('hex').toUpperCase()}`;
    saveWallet(wallet, { token, clientId, frozen: false, createdAt: new Date().toISOString(), recoveredFrom: linkedFrom, cardKey: cardKey ?? null });
    if (linkedFrom) {
      const old = loadWallet(linkedFrom);
      old.recovery.newWallet = wallet;
      saveWallet(linkedFrom, old);
    }
    log(`Wallet created: ${p2wpkh(keyshare.publicKey).address}${linkedFrom ? ' (replacement during recovery)' : ''}`);
    return { wallet, token };
  },

  // --- Co-signing: the server rebuilds the sighash itself from the transaction. ---
  'POST /sign/start'(body, req) {
    const { id, state, mode } = authenticate(req, body);
    const { txHex, input, values, m1 } = body;
    const pubkey = Buffer.from(id, 'hex');
    const tx = bitcoin.Transaction.fromHex(txHex);
    const walletScript = p2wpkh(pubkey).output;
    const counterpart = m1[0]?.from;

    // Normal use pairs Swissquote with the phone only; the card is reserved for recovery,
    // where Swissquote pairs with the card only and may only sweep into the new wallet.
    let refusal;
    // A sponsored payment carries one input from Swissquote's fee wallet; its change is not a payment.
    const sponsored = mode === 'normal' ? sponsor.inspect(tx, id) : null;
    if (sponsored && input === sponsored.index) throw httpError(400, 'The fee input is signed by Swissquote, not with MPC.');
    const clientInputs = tx.ins.map((_, i) => i).filter(i => i !== sponsored?.index);
    if (mode === 'normal') {
      const approval = cardApprovals.get(`${id}:${tx.getId()}`);
      refusal = counterpart !== PARTY.phone
        ? { code: 'WRONG_PARTY', reason: 'Daily use must be signed with the phone.' }
        : review(tx, walletScript, state, sanctioned(), { cardApproved: !!approval && Date.now() < approval, ignore: sponsored ? [sponsor.script] : [] });
    } else {
      const rec = state.recovery;
      const target = rec.newWallet && p2wpkh(Buffer.from(rec.newWallet, 'hex')).output;
      // A card recovery pairs with the card. A backup recovery pairs with the restored phone
      // share, and only after the client proved it holds the Apple/Google passkey.
      const expected = rec.method === 'backup' ? PARTY.phone : PARTY.card;
      if (rec.method === 'backup' && !rec.backupProven) refusal = { code: 'BACKUP_NOT_PROVEN', reason: 'Prove the Apple/Google passkey first.' };
      else if (counterpart !== expected) refusal = { code: 'WRONG_PARTY', reason: 'Recovery must be signed with the recovery card, not the phone.' };
      else if (!target) refusal = { code: 'NO_NEW_WALLET', reason: 'Create the replacement wallet first.' };
      else if (!tx.outs.every(o => Buffer.from(o.script).equals(Buffer.from(target)))) {
        refusal = { code: 'NOT_A_SWEEP', reason: 'During recovery, funds can only move to the new wallet.' };
      }
    }
    if (refusal) {
      log(`REFUSED (${refusal.code}) ${mode}: ${refusal.reason}`);
      throw httpError(403, refusal.reason, refusal.code);
    }

    const hash = sighash(tx, input, pubkey, values[input]);
    const session = new SignSession(Keyshare.fromBytes(shareOf(id)), 'm');
    const own1 = toWire(session.createFirstMessage());
    const own2 = step(session, broadcastFor(m1, PARTY.swissquote));
    const sid = randomUUID();
    signings.set(sid, { session, hash, tx, walletScript, id, mode, sponsored: !!sponsored, last: input === clientInputs[clientInputs.length - 1] });
    return { id: sid, m1: own1, m2: own2 };
  },

  // --- Ownership proof for the Travel Rule (BIP-322): the wallet signs a message, no funds move.
  // Swissquote writes the message and computes the hash itself, so this route can never be used
  // to obtain a signature on a real transaction. Signed with the phone, like a payment. ---
  'POST /ownership/start'(body, req) {
    const { id, state, mode } = authenticate(req, body);
    if (mode !== 'normal') throw httpError(403, 'Use the wallet owner session.');
    if (state.retired) throw httpError(403, 'This wallet was replaced after a recovery.', 'RETIRED');
    if (body.m1[0]?.from !== PARTY.phone) throw httpError(403, 'The ownership proof must be signed with the phone.', 'WRONG_PARTY');
    const pubkey = Buffer.from(id, 'hex');
    const message = [
      'Swissquote self-custody wallet ownership proof',
      `Client: ${clientOf(id)}`,
      `Address: ${p2wpkh(pubkey).address}`,
      `Date: ${new Date().toISOString()}`,
      `Nonce: ${randomBytes(8).toString('hex')}`,
    ].join('\n');
    ownershipRequests.set(id, message);
    const session = new SignSession(Keyshare.fromBytes(shareOf(id)), 'm');
    const own1 = toWire(session.createFirstMessage());
    const own2 = step(session, broadcastFor(body.m1, PARTY.swissquote));
    const sid = randomUUID();
    signings.set(sid, { session, hash: proofHash(pubkey, message), id, kind: 'ownership' });
    return { id: sid, m1: own1, m2: own2, message };
  },
  // Swissquote checks the finished BIP-322 signature itself and records the result.
  'POST /ownership/verify'(body, req) {
    const { id, state, mode } = authenticate(req, body);
    if (mode !== 'normal') throw httpError(403, 'Use the wallet owner session.');
    const message = ownershipRequests.get(id);
    ownershipRequests.delete(id);
    const address = p2wpkh(Buffer.from(id, 'hex')).address;
    if (!message || !verifySimple(address, message, body.signature)) {
      throw httpError(403, 'The ownership proof could not be verified.', 'PROOF_INVALID');
    }
    state.clientId = clientOf(id);
    state.ownership = { clientId: state.clientId, address, message, signature: body.signature, format: 'BIP-322 simple', verifiedAt: new Date().toISOString() };
    saveWallet(id, state);
    log(`TRAVEL RULE record: ${address} belongs to client ${state.clientId} (BIP-322 proof verified)`);
    return state.ownership;
  },
  'POST /sign/finish'({ id: sid, m2, m3 }) {
    const entry = signings.get(sid);
    if (!entry) throw httpError(404, 'Unknown or already used signing session.');
    signings.delete(sid); // a pre-signature must never be used twice
    const { session, hash, tx, walletScript, id, mode, last, kind, sponsored } = entry;
    const own3 = step(session, directFor(m2, PARTY.swissquote));
    step(session, directFor(m3, PARTY.swissquote));
    const lastMsg = toWire(session.lastMessage(hash));
    session.free();
    if (kind === 'ownership') log(`Co-signed ownership proof for ${p2wpkh(Buffer.from(id, 'hex')).address}`);
    else if (last) {
      const state = loadWallet(id);
      if (mode === 'normal') {
        recordSpend(tx, walletScript, state, sponsored ? [sponsor.script] : []);
        // Remember who this wallet has paid, so a first payment to a new address can be flagged.
        const paid = tx.outs.filter(o => ![walletScript, sponsor.script].some(x => Buffer.from(o.script).equals(Buffer.from(x))))
          .map(o => bitcoin.address.fromOutputScript(o.script, net));
        state.payees = [...new Set([...(state.payees ?? []), ...paid])].slice(-200);
        coSigned.set(`${id}:${tx.getId()}`, Date.now() + 10 * 60_000);
      } else { state.recovery.status = 'swept'; state.retired = true; }
      saveWallet(id, state);
      log(`Co-signed ${mode === 'recovery' ? 'RECOVERY SWEEP' : sponsored ? 'transaction (fee sponsored by Swissquote)' : 'transaction'} ${tx.getId()}`);
    }
    return { m3: own3, last: lastMsg };
  },

  // --- Pre-signing screening, shown to the client in plain language before Face ID. The same
  // rules are enforced again when co-signing; this only explains them in advance. ---
  'POST /screen'(body, req) {
    const { id, state } = authenticate(req, body);
    const to = String(body.to ?? '');
    const amount = BigInt(body.amount ?? 0);
    const verified = directory().find(d => d.address === to) ?? null;
    const { dailyLimit, cardThreshold, spentToday } = limitsOf(state);
    const after = spentToday + amount;
    return {
      sanctioned: sanctioned().includes(to),
      verified,
      knownPayee: (state.payees ?? []).includes(to),
      frozen: !!state.frozen,
      spentToday: String(spentToday), dailyLimit: String(dailyLimit), cardThreshold: String(cardThreshold),
      needsCard: after > cardThreshold && after <= dailyLimit,
      overLimit: after > dailyLimit,
    };
  },

  // --- Fee sponsoring ("gasless"): Swissquote's fee wallet pays the network fee. ---
  'POST /sponsor/info'() {
    return sponsor.info();
  },
  'POST /sponsor/quote'(body, req) {
    const { id, state, mode } = authenticate(req, body);
    if (mode !== 'normal' || state.frozen || state.retired) return { available: false, reason: 'Not available for this wallet.' };
    return sponsor.quote(id, state, { reserve: !!body.reserve });
  },
  // Swissquote signs its fee input last, only for a payment whose client inputs it co-signed.
  'POST /sponsor/sign'(body, req) {
    const { id, state, mode } = authenticate(req, body);
    if (mode !== 'normal') throw httpError(403, 'Use the wallet owner session.');
    const tx = bitcoin.Transaction.fromHex(body.txHex);
    const approved = coSigned.get(`${id}:${tx.getId()}`);
    if (!approved || Date.now() > approved) throw httpError(403, 'Swissquote only pays the fee of a payment it co-signed.', 'SPONSOR_REFUSED');
    const result = sponsor.sign(tx, id, state);
    coSigned.delete(`${id}:${tx.getId()}`);
    saveWallet(id, state);
    log(`Fee of ${result.fee} sats paid by Swissquote for ${tx.getId()} (${state.sponsor.count} sponsored today)`);
    return result;
  },

  // --- Recovery: identity verification + waiting period with alerts. ---
  'POST /recovery/start'({ wallet, identity, method = 'card' }) {
    const state = loadWallet(wallet);
    if (method === 'backup' && !state.backup) throw httpError(400, 'This wallet has no backup set up.', 'NO_BACKUP');
    // MOCK video identification: a real provider would compare a live video with the KYC record.
    if (identity !== 'pass') {
      alert(wallet, 'Recovery attempt REFUSED: video identification failed.');
      throw httpError(403, 'Video identification failed.', 'IDENTITY_FAILED');
    }
    const token = randomUUID();
    state.frozen = true; // the old phone is cut off as soon as a recovery starts
    const delay = method === 'backup' ? BACKUP_RECOVERY_DELAY_MS : RECOVERY_DELAY_MS;
    state.recovery = { token, method, status: 'approved', startedAt: Date.now(), readyAt: Date.now() + delay, wrongProofs: 0 };
    saveWallet(wallet, state);
    alert(wallet, `Recovery started (${method === 'backup' ? 'Apple/Google backup' : 'recovery card'}). Funds can move to a new wallet after ${new Date(state.recovery.readyAt).toISOString()}. Not you? Cancel now.`);
    return { token, readyAt: state.recovery.readyAt };
  },

  // --- Backup of Share 1: Swissquote keeps lock B and a verifier of the passkey secret, never the secret. ---
  'POST /backup/enroll'(body, req) {
    const { id, state, mode } = authenticate(req, body);
    if (mode !== 'normal') throw httpError(403, 'Use the wallet owner session.');
    const keyB = newLockBKey();
    state.backup = { keyB: keyB.toString('base64'), verifier: body.verifier, enrolledAt: new Date().toISOString() };
    saveWallet(id, state);
    log(`Backup enrolled for ${p2wpkh(Buffer.from(id, 'hex')).address}`);
    return { keyB: keyB.toString('base64') };
  },
  'POST /recovery/backup-key'(body, req) {
    const { id, state, mode } = authenticate(req, body);
    const rec = state.recovery;
    if (mode !== 'recovery' || rec.method !== 'backup') throw httpError(403, 'Not a backup recovery.');
    if (state.backup.locked) throw httpError(403, 'The backup is locked after too many failed passkey proofs. Contact Swissquote.', 'BACKUP_LOCKED');
    if (!verifierMatches(body.proof, state.backup.verifier)) {
      // Failed proofs are counted per wallet, not per recovery, so restarting a recovery does
      // not give an attacker fresh guesses: 5 per recovery, 10 in total, then the backup locks.
      rec.wrongProofs += 1;
      state.backup.wrongProofs = (state.backup.wrongProofs ?? 0) + 1;
      if (state.backup.wrongProofs >= 10) { state.backup.locked = true; alert(id, 'Backup LOCKED: too many failed passkey proofs.'); }
      if (rec.wrongProofs >= 5) { delete state.recovery; alert(id, 'Recovery CANCELLED: too many failed passkey proofs.'); }
      else alert(id, 'Failed passkey proof during a recovery.');
      saveWallet(id, state);
      throw httpError(403, 'This Apple/Google passkey does not match the backup.', 'WRONG_PASSKEY');
    }
    rec.backupProven = true;
    saveWallet(id, state);
    log(`Backup lock A (passkey) proven for ${p2wpkh(Buffer.from(id, 'hex')).address}: releasing lock B`);
    return { keyB: state.backup.keyB };
  },
  'POST /recovery/cancel'(body, req) {
    // MOCK: in production, cancelling would come from the Swissquote web login or a call.
    const { id, state } = authenticate(req, body);
    delete state.recovery;
    saveWallet(id, state);
    alert(id, 'Recovery CANCELLED by the client.');
    return { cancelled: true };
  },

  // --- Lost card: phone + Swissquote can re-share the key, but only after the same checks as a
  // recovery. Otherwise a thief with an unlocked phone could enrol their own card and escape. ---
  'POST /card/replace'(body, req) {
    const { id, state, mode } = authenticate(req, body);
    if (mode !== 'normal') throw httpError(403, 'Use the wallet owner session.');
    if (state.frozen) throw httpError(403, 'The wallet is frozen. Unfreeze it with strong verification.', 'FROZEN');
    // MOCK video identification, as in recovery.
    if (body.identity !== 'pass') {
      alert(id, 'Card replacement REFUSED: video identification failed.');
      throw httpError(403, 'Video identification failed.', 'IDENTITY_FAILED');
    }
    state.cardReplacement = { requestedAt: Date.now(), readyAt: Date.now() + RECOVERY_DELAY_MS };
    saveWallet(id, state);
    alert(id, `Card replacement requested. A new card can be activated after ${new Date(state.cardReplacement.readyAt).toISOString()}. Not you? Cancel now.`);
    return { readyAt: state.cardReplacement.readyAt };
  },

  // --- Card taps for payments above the card threshold, and for raising limits. ---
  'POST /card/challenge'(body, req) {
    const { id, mode } = authenticate(req, body);
    if (mode !== 'normal') throw httpError(403, 'Use the wallet owner session.');
    if (!['sign', 'limits', 'unfreeze'].includes(body.purpose)) throw httpError(400, 'Unknown purpose.');
    return newChallenge(id, body.purpose, String(body.detail));
  },
  'POST /card/approve'(body, req) {
    const { id, state } = authenticate(req, body);
    checkCardTap(state, id, body, 'sign', body.txid);
    cardApprovals.set(`${id}:${body.txid}`, Date.now() + 300_000);
    log(`Card tap verified for transaction ${body.txid}`);
    return { approved: true };
  },
  // Lowering a limit is always allowed (like freezing); raising one needs a card tap.
  'POST /settings/limits'(body, req) {
    const { id, state, mode } = authenticate(req, body);
    if (mode !== 'normal') throw httpError(403, 'Use the wallet owner session.');
    const current = limitsOf(state);
    const dailyLimit = BigInt(body.dailyLimit);
    const cardThreshold = BigInt(body.cardThreshold);
    if (dailyLimit <= 0n || cardThreshold <= 0n) throw httpError(400, 'Limits must be positive.', 'BAD_LIMITS');
    if (cardThreshold > dailyLimit) throw httpError(400, 'The card threshold cannot exceed the daily limit.', 'BAD_LIMITS');
    if (dailyLimit > MAX_DAILY_LIMIT_SATS) throw httpError(400, `The daily limit cannot exceed ${MAX_DAILY_LIMIT_SATS} sats.`, 'BAD_LIMITS');
    const raising = dailyLimit > current.dailyLimit || cardThreshold > current.cardThreshold;
    if (raising) checkCardTap(state, id, body, 'limits', `${cardThreshold}:${dailyLimit}`);
    state.dailyLimit = String(dailyLimit);
    state.cardThreshold = String(cardThreshold);
    saveWallet(id, state);
    alert(id, `Limits changed: card above ${cardThreshold} sats, daily limit ${dailyLimit} sats${raising ? ' (confirmed with the card)' : ''}.`);
    return { dailyLimit: String(dailyLimit), cardThreshold: String(cardThreshold) };
  },

  // --- Freeze: easy to set, hard to lift (unfreeze would require strong verification). ---
  'POST /freeze'(body, req) {
    const { id, state } = authenticate(req, body);
    state.frozen = true;
    saveWallet(id, state);
    log(`Wallet FROZEN: ${p2wpkh(Buffer.from(id, 'hex')).address}`);
    return { frozen: true };
  },
  // Unfreezing needs strong verification: video identification AND a tap of the registered card.
  // A thief with the phone lacks the card; a thief with phone and card lacks the PIN and the face.
  'POST /unfreeze'(body, req) {
    const { id, state, mode } = authenticate(req, body);
    if (mode !== 'normal') throw httpError(403, 'Use the wallet owner session.');
    if (state.retired) throw httpError(403, 'This wallet was replaced after a recovery. Use your new phone.', 'RETIRED');
    if (state.recovery) throw httpError(403, 'A recovery is in progress for this wallet. Cancel it before unfreezing.', 'RECOVERY_IN_PROGRESS');
    if (!state.frozen) return { frozen: false };
    // MOCK video identification, as in recovery.
    if (body.identity !== 'pass') {
      alert(id, 'Unfreeze REFUSED: video identification failed.');
      throw httpError(403, 'Video identification failed.', 'IDENTITY_FAILED');
    }
    checkCardTap(state, id, body, 'unfreeze', id);
    state.frozen = false;
    saveWallet(id, state);
    alert(id, 'Wallet UNFROZEN after video identification and a card tap.');
    return { frozen: false };
  },
  'POST /status'(body, req) {
    const { state } = authenticate(req, body);
    const { dailyLimit, cardThreshold, spentToday } = limitsOf(state);
    return {
      frozen: state.frozen, retired: !!state.retired, recovery: state.recovery?.status ?? null, hasCard: !!state.cardKey,
      ownership: state.ownership ?? null, sponsoredToday: state.sponsor?.day === new Date().toISOString().slice(0, 10) ? state.sponsor.count : 0,
      spentToday: String(spentToday), dailyLimit: String(dailyLimit), cardThreshold: String(cardThreshold), maxDailyLimit: String(MAX_DAILY_LIMIT_SATS),
    };
  },
};

// Client number of a wallet. Wallets created before client numbers existed get one on first use.
function clientOf(id) {
  const state = loadWallet(id);
  if (!state.clientId) { state.clientId = `SQ-${randomBytes(4).toString('hex').toUpperCase()}`; saveWallet(id, state); }
  return state.clientId;
}

function keygen(id) {
  const entry = keygens.get(id);
  if (!entry) throw httpError(404, 'Unknown key generation session.');
  return entry;
}

function httpError(status, message, code) {
  return Object.assign(new Error(message), { status, code });
}

const log = msg => console.log(`[cosigner ${new Date().toISOString()}] ${msg}`);
// MOCK alert channels: app on other devices, email, SMS, Swissquote web, phone call.
const alert = (wallet, msg) => log(`ALERT → client of ${p2wpkh(Buffer.from(wallet, 'hex')).address} (app, email, SMS, web, phone): ${msg}`);

createServer(async (req, res) => {
  const key = `${req.method} ${req.url}`;
  try {
    const handler = routes[key];
    if (!handler) throw httpError(404, `No route ${key}`);
    let body = '';
    for await (const chunk of req) body += chunk;
    const result = await handler(body ? JSON.parse(body) : {}, req);
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result));
  } catch (err) {
    res.writeHead(err.status ?? 500, { 'content-type': 'application/json' })
      .end(JSON.stringify({ error: err.message, code: err.code }));
  }
}).listen(PORT, () => log(`Swissquote co-signer listening on http://localhost:${PORT} (recovery wait ${RECOVERY_DELAY_MS / 1000}s with card, ${BACKUP_RECOVERY_DELAY_MS / 1000}s with backup)`));
