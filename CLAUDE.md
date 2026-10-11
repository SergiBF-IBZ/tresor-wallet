# CLAUDE.md — context for Claude Code

Hackathon project: **Swissquote Wallet Challenge**. Build the self-custody wallet Swissquote could launch: client holds the keys, Swiss-bank safety, one step from the Swissquote account. Judges score: technical 35, security/custody 20, legal 15, business 15, UX/pitch 15, bonus up to +20 (gasless, compliant dApps) only if create → sign → recover works end to end. Required: a real transaction on a blockchain (testnet OK); mocks allowed if clearly labelled; **a mocked share holder must run as a separate process with its own storage and the client app must never hold its share**; no homemade crypto.

The team speaks **Spanish**; chat replies follow the language the user writes in. **Everything produced is in English**: code, comments, UI text, docs, slides, guides, zip contents (team decision, 2026-10-11). The user is not a crypto expert: explain simply.

Read first: `README.md` (submission, 6 required topics, real vs mock), `WORKFLOW.md` (full design, threat model, limitations, build table with status and tx evidence), `GUIDE.md` (walkthrough of everything built + Q&A for the judges).

## Final design decisions (and why)

- **Custody:** 2-of-3 **MPC threshold ECDSA (DKLs23)**, `@silencelaboratories/dkls-wasm-ll-node`. Shares: phone (party 0), Swissquote co-signer (party 1), recovery card (party 2). Same secp256k1 key works for Bitcoin and EVM; chosen over ERC-4337 (EVM-only). Swissquote alone can block, never move funds.
- **Chain:** Bitcoin **signet**, explorers **Blockstream Esplora** first and **mempool.space** as automatic fallback (same API; `ESPLORA_URLS` overrides). P2WPKH, BIP-143, low-S normalisation. Signet fee rate capped at 2 sat/vB (`MAX_FEE_RATE`).
- **Recovery card:** FIDO2-style NFC card with PIN (8 tries). It cannot run MPC; it guards Share 3 and signs Swissquote challenges (P-256). **Simulated by a folder.** Card public key is registered only at wallet creation, recovery, or verified card replacement (otherwise a thief with the phone could enrol their own card).
- **Payments:** Face ID only up to the **card threshold** (default 25,000 sats/day); above it the card + PIN approves that exact txid; above the **daily limit** (100,000 sats) refused. Limits editable in Settings; raising needs a card tap, lowering doesn't; max 1,000,000. Per-wallet overrides in co-signer state.
- **Lost phone:** card + Swissquote, video ID (simulated call) + waiting period (48 h prod / 20 s demo), then a **new wallet** and sweep (old shares stay valid together, so refreshing is unsafe when a thief holds one). In recovery mode the co-signer pairs only with the card and only signs a sweep to the new wallet.
- **Lost card:** video ID + wait, then phone + Swissquote **re-share the same key** (DKLs `initKeyRecovery` / `initLostShareRecovery`); same address; old shares overwritten.
- **Lost phone AND card:** backup of Share 1 in the client's cloud, double-locked: **Apple/Google passkey (PRF) + Swissquote key** (team decision; **no phrase option**: the 6-word phrase was removed as too hard for clients). Backup recovery waits **7 days** (demo 40 s) because a thief with the unlocked phone may hold the passkey. Swissquote only stores an HMAC verifier. Passkey/keychain and cloud are **simulated by folders**.
- **Ownership proof (Travel Rule):** BIP-322 simple, signed phone + Swissquote after creation and every recovery; the co-signer writes the message and computes the hash itself, verifies, records client ↔ address.
- **Gasless (bonus):** Bitcoin fee sponsoring. Swissquote's fee wallet (`cosigner/sponsor.mjs`, key in `cosigner/data/sponsor.json`) adds its coin as the last input and pays the whole fee. Only wallets with an ownership proof; signs only payments it co-signed; ≤1,000 sats/payment, 10 payments and 5,000 sats/wallet/day; previews peek, payments reserve; big coins split into two. Falls back to client-paid fee.
- **Compliant interaction (bonus):** `/screen` (sanctions, `cosigner/directory.json` verified counterparties, known payees, limits) shown on the review screen with "What will happen"; the policy enforces the same rules when co-signing. Contact *My Swissquote account* = treasury address.
- **Freeze:** easy (any channel). **Unfreeze:** video ID + card tap.
- **Swissquote gone:** independent **Exit Tool** (separate process, not Swissquote-branded) signs phone share + card share locally, never contacts the co-signer.
- Rejected ideas (don't reintroduce): plain NFC stickers (no secure element), 2-of-4 with two cards, independent escrow partner holding a share, seed phrases or any words to write down (incl. the 6-word backup phrase), on-chain backup of the share (a DKLs share is ~247 KB).

## Layout

```
core/                  the product (npm project)
  shared/              mpc.mjs (DKLs wire protocol), bitcoin.mjs (Esplora + fallback + cache), backup.mjs, bip322.mjs (ownership proof)
  cosigner/            server.mjs (Swissquote co-signer, :4000), policy.mjs (limits, sanctions), sponsor.mjs (fee wallet),
                       sanctions.json + directory.json (MOCK lists)
  test/                npm test: 19 tests (MPC, BIP-322 vectors, policy, backup)
  client/              device.mjs (all wallet logic), card.mjs (mock card), keychain.mjs (mock passkey),
                       app.mjs + public/index.html (phone app UI), wallet.mjs (CLI),
                       escape.mjs + public/escape.html (Exit Tool, :5100)
  scripts/             demo.mjs, reset-demo.mjs, wipe-phone.mjs
  client/demo/         demo state: phone-a/b/c, card, cloud, keychain, client-c/, treasury/ (NOT in git)
  cosigner/data/       co-signer state: wallets/<pubkey>/{share.bin,state.json}, optional sanctions.json override (NOT in git)
spike/                 first experiments (mpc-spike.mjs, lost-card-spike.mjs)
pitch/                 SPEAKER-NOTES.md, deck.html (offline deck), slides/ (sources), build-deck.py
GUIDE.md, START-HERE.md  team guide + Q&A; install/run instructions
package.json (root)    forwards npm run demo / demo:reset / demo:wipe / test to core/
```

## Run

```bash
npm install            # root postinstall installs core/
npm run demo           # co-signer :4000, phones A :5001, B :5002, C :5003, Exit Tool :5100
npm run demo:reset     # returns leftover phone funds to the treasury, new funded wallet on phone A (card PIN 123456), B and C empty, tops up the fee wallet
npm test               # 19 automated tests
npm run demo:wipe -- b # factory-reset one phone (a|b|c), --force if it holds funds
```

Phones A and B = same client (shared card, cloud, Apple/Google account): B is "the new phone" for recoveries. Phone C = a different client with its own blank card (onboarding demo). Treasury (`core/client/demo/treasury`, address `tb1qamhytefc99u4vq6r0utnvh4w560cn79cxqd0td`) funds resets; refill it from a signet faucet (e.g. signet257.bublina.eu.org) and wait for confirmation.

## Gotchas learned the hard way

- **Faucets replace unconfirmed txs (RBF):** only spend confirmed faucet coins.
- **Blockstream rate limit ~700 req/hour per public IP** (shared networks share it). Reads are cached (15 s, fees 2 min); 429/5xx/unreachable → mempool.space for 5 minutes; both refusing → `RATE_LIMITED`. For the live demo, use a phone hotspot.
- **bitcoinjs-lib v7 returns `Uint8Array`, not `Buffer`:** wrap with `Buffer.from(...)` before `.toString('hex')` (a bug here produced "Non-canonical DER").
- Blockstream's signet `fee-estimates['6']` is noisy (seen at 11 sat/vB while 1 sat/vB confirms): keep the fee caps.
- Bash heredocs in this environment mangle `\'`: use the Write/Edit tools for JS with escaped quotes.
- The UI's `call(path)` without a body does a GET: POST routes need `call(path, {})`.
- **Windows:** stopping the demo can leave `node` processes on ports 4000/5001-5003/5100; kill them before restarting. `process.exit()` right after `fetch` crashes Node on Windows: use `process.exitCode`.
- **Commands must run from the repo root or `core/`** (root package.json forwards).
- Don't restart the demo while the user is clicking around: warn first.
- Pre-signatures must never be reused (key exposure). The co-signer rebuilds the sighash itself.
- `@noble` v2 imports need `.js` suffixes and `verify(..., { prehash: false })` for pre-hashed messages.
- Shared-folder demo pitfall: creating a wallet with a card that already belongs to another wallet is blocked (`CARD_IN_USE`).

## Status and next steps

Done and tested: everything in the WORKFLOW build table marked ✅ (DKG over HTTP, real signet txs, policy refusals, recovery incl. attackers, lost card, passkey backup, card threshold + limits, unfreeze, simulated Face ID with camera, simulated video call, card-tap animation, CHF/sats send with fee preview, Exit Tool incl. UI with real funds, BIP-322, fee sponsoring, screening, explorer fallback, 19 tests). Every flow was re-run on signet with the final code on 2026-10-11.

Pitch deck: Slides artifact https://claude.ai/artifact/Phi1TiNUejNtNqet9111UR (sources and offline copy in `pitch/`).

Pending:
1. Team name on the first and last slides (`[Team name]`), README "AI tools used" table.
2. README screenshots (optional).
3. Business figures are hypothetical (replace with public Swissquote data if found).
4. Optional: real FIDO2 card (Token2 / Cryptnox), EVM gasless (ERC-4337 paymaster), approved-dApp list, Taproot production design (WORKFLOW §15).
