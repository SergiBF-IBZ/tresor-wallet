// Compliance rules the co-signer applies before contributing its share. MOCK:
// a real deployment would call a sanctions-screening provider and a risk engine.
import { bitcoin, net } from '../shared/bitcoin.mjs';

// Defaults for every wallet, overridable with environment variables. Each client can change
// their own limits in the app (raising them needs a card tap), up to MAX_DAILY_LIMIT_SATS.
export const DAILY_LIMIT_SATS = BigInt(process.env.DAILY_LIMIT_SATS ?? 100_000);
export const CARD_THRESHOLD_SATS = BigInt(process.env.CARD_THRESHOLD_SATS ?? 25_000);
export const MAX_DAILY_LIMIT_SATS = BigInt(process.env.MAX_DAILY_LIMIT_SATS ?? 1_000_000);

const today = () => new Date().toISOString().slice(0, 10);

export function limitsOf(state) {
  const dailyLimit = state.dailyLimit ? BigInt(state.dailyLimit) : DAILY_LIMIT_SATS;
  const cardThreshold = state.cardThreshold ? BigInt(state.cardThreshold) : CARD_THRESHOLD_SATS;
  const spentToday = state.day === today() ? BigInt(state.spentToday) : 0n;
  return { dailyLimit, cardThreshold: cardThreshold < dailyLimit ? cardThreshold : dailyLimit, spentToday };
}

// `ignore` lists scripts that are not payments: Swissquote's own fee-wallet change when it sponsors the fee.
const isOwn = (out, walletScript, ignore) => [walletScript, ...ignore].some(s => Buffer.from(out.script).equals(Buffer.from(s)));
const outgoingOf = (tx, walletScript, ignore = []) => tx.outs
  .filter(o => !isOwn(o, walletScript, ignore)) // change back to the wallet or to the fee wallet
  .reduce((sum, o) => sum + BigInt(o.value), 0n);

// Returns null when the transaction may be co-signed, or a refusal { code, reason }.
export function review(tx, walletScript, state, sanctioned, { cardApproved = false, ignore = [] } = {}) {
  if (state.frozen) return { code: 'FROZEN', reason: 'The wallet is frozen. Unfreeze it with strong verification.' };

  for (const out of tx.outs) {
    if (isOwn(out, walletScript, ignore)) continue;
    const to = bitcoin.address.fromOutputScript(out.script, net);
    if (sanctioned.includes(to)) return { code: 'SANCTIONED', reason: `Recipient ${to} is on the sanctions list.` };
  }

  const { dailyLimit, cardThreshold, spentToday } = limitsOf(state);
  const total = spentToday + outgoingOf(tx, walletScript, ignore);
  if (total > dailyLimit) {
    return { code: 'LIMIT', reason: `Daily limit of ${dailyLimit} sats exceeded. You can raise it in Settings with your card.` };
  }
  // Above the card threshold, a tap of the registered card (with its PIN) must approve this transaction.
  if (total > cardThreshold && !cardApproved) {
    return { code: 'CARD_REQUIRED', reason: `Payments above ${cardThreshold} sats per day need your recovery card and PIN.` };
  }
  return null;
}

export function recordSpend(tx, walletScript, state, ignore = []) {
  const { spentToday } = limitsOf(state);
  state.day = today();
  state.spentToday = String(spentToday + outgoingOf(tx, walletScript, ignore));
}
