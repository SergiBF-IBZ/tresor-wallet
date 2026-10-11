# The Swissquote Wallet: complete guide

This guide explains everything the team built, why each decision was made, how each flow works under the hood, and how to answer the questions Swissquote's judges (bankers, compliance and security people) are likely to ask. Read sections 1 and 2 before the pitch; keep section 8 (questions and answers) open during Q&A.

Related documents: [README.md](README.md) (the submission), [WORKFLOW.md](WORKFLOW.md) (full design and build status), [START-HERE.md](START-HERE.md) (install and run), [pitch/SPEAKER-NOTES.md](pitch/SPEAKER-NOTES.md) (the 5-minute script).

---

## Contents

1. [The product in one minute](#1-the-product-in-one-minute)
2. [The demo story, click by click, with what happens underneath](#2-the-demo-story-click-by-click)
3. [Components: what each part does, where the code is, real or mocked](#3-components)
4. [Every flow in detail](#4-every-flow-in-detail)
5. [Security model](#5-security-model)
6. [Legal reasoning (Switzerland)](#6-legal-reasoning-switzerland)
7. [Business case and assumptions](#7-business-case-and-assumptions)
8. [Questions the bank may ask, with answers](#8-questions-the-bank-may-ask)
9. [Glossary for non-crypto readers](#9-glossary)
10. [Demo-day checklist and troubleshooting](#10-demo-day-checklist-and-troubleshooting)
11. [What was built, in order](#11-what-was-built-in-order)

---

## 1. The product in one minute

**The problem.** A Swissquote client who wants to hold their own crypto ("self-custody") must today withdraw it to an external wallet. Swissquote loses the assets, the trading and often the client. The client is left alone with a 12- or 24-word seed phrase: lose it and the money is gone; leak it and the money is stolen.

**The answer.** A wallet whose private key is split into **three shares** with **MPC** (multi-party computation, specifically 2-of-3 threshold ECDSA with the DKLs23 protocol):

| Share | Who holds it | Where |
|---|---|---|
| Share 1 | The client | The phone, behind Face ID |
| Share 2 | Swissquote | An isolated co-signer server with its own storage |
| Share 3 | The client | A recovery card (NFC, with a PIN), kept at home |

**Any two shares can sign; one share alone cannot.** The full key never exists anywhere, not even while signing.

- Phone + Swissquote = everyday payments (Face ID).
- Card + Swissquote = recovery when the phone is lost.
- Phone + card = the exit, if Swissquote disappears or refuses to cooperate.

**What this gives:**
- **Swissquote can block a payment but can never move the funds.** It holds one share only. That makes the wallet "software", not custody.
- **No seed words.** Every loss (phone, card, both, Swissquote itself) has a way back.
- **Swiss-bank safety.** Swissquote screens every payment (sanctions, limits), large payments need the card, and recoveries need video identification plus a waiting period.
- **Swissquote pays the network fee** ("gasless" payments): the client never needs extra coins for fees.
- **Travel Rule built in.** The wallet proves its ownership to Swissquote with a cryptographic signature (BIP-322), so transfers between the client's account and their own wallet are verified automatically.

Everything runs on **Bitcoin signet** (a public Bitcoin test network: same software, coins without value). Every flow has produced real transactions you can open in a block explorer.

---

## 2. The demo story click by click

Setup: `npm run demo` running, `npm run demo:reset` done. Tabs: phone A http://localhost:5001, phone B http://localhost:5002, Exit Tool http://localhost:5100. Card PIN `123456`.

### Step 1: Phone A, the home screen
**What the audience sees:** balance in CHF and sats, the address, "✓ Ownership verified by Swissquote (BIP-322)", recent activity.

**Underneath:** at wallet creation, the phone and the co-signer ran distributed key generation (4 message rounds over HTTP). Swissquote's share was created on Swissquote's server and has never left it. Right after creation, the wallet signed a BIP-322 ownership message written by Swissquote; Swissquote verified it and recorded "address X belongs to client Y" (this is the Travel Rule record). The balance is read from the blockchain through Blockstream's explorer (mempool.space takes over automatically if Blockstream rate-limits us).

### Step 2: Send CHF 10 to Ana Keller
**Clicks:** Send → contact *Ana Keller* → amount 10 (CHF) → the live preview shows *Network fee: Paid by Swissquote* → Review.

**The review screen shows:**
- amount in CHF and sats, recipient, *Network fee: Paid by Swissquote (… sats, you pay CHF 0.00)*, *Signed by: your phone + Swissquote*;
- **Checked before you sign:** recipient screened against sanctions lists; whether the recipient is verified by Swissquote, already paid before, or a first payment to a new address (warning); whether the payment is within the limits or needs the card;
- **What will happen:** "Ana Keller receives CHF 10.00. Your balance goes from … to …. The network fee is paid by Swissquote. Nothing else leaves your wallet."

**Clicks:** Confirm with Face ID (simulated: camera preview, no recognition) → *Payment sent* with a link to the explorer.

**Underneath:**
1. The phone asks Swissquote for a **fee quote**. Swissquote reserves one coin from its own fee wallet for this payment.
2. The phone builds the Bitcoin transaction: the client's coins + Swissquote's fee coin as inputs; Ana's amount, the client's change (exactly what is left) and Swissquote's change as outputs. The difference (the network fee) comes entirely out of Swissquote's coin.
3. For each of the client's inputs, the phone and the co-signer run **MPC signing** (DKLs23, 3 message rounds). Before contributing, the co-signer **rebuilds the hash to sign from the transaction itself** and applies its policy: wallet not frozen, no sanctioned recipient, daily limit, card threshold, counterpart is the phone. Swissquote's own change is not counted as a payment.
4. Only after co-signing the client's inputs does Swissquote **sign its fee input** (with its fee wallet key), within its caps and the client's daily quota.
5. The phone broadcasts the transaction to the Bitcoin network.

CHF 10 is about 11,800 sats at the demo's indicative rate (CHF 85,000 per BTC), below the card threshold (25,000 sats ≈ CHF 21 a day), so Face ID is enough. A payment of CHF 30 would need a card tap.

### Step 3: The sanctioned test entity
**Clicks:** Send → contact *Sanctioned test entity* → any amount → Review. The banner turns red and the check says "On a sanctions list. Swissquote will refuse this payment." Confirm anyway → *Swissquote refused*.

**Underneath:** the review screen is informed by Swissquote's `/screen` endpoint; the refusal comes from the co-signer's policy at signing time (`SANCTIONED`). The point to make: **the phone app is not trusted**. Even a modified app cannot get Swissquote's co-signature for a sanctioned recipient.

### Step 4: Phone B, an impostor tries to recover
**Clicks:** phone B → *I lost my phone · Recover my wallet* → tap card → video call → *As an impostor* → refused.

**Underneath:** recovery requires the recovery card on the new phone and a **video identification** (simulated: the demo button decides the outcome). A failed identification is refused and alerts the real client on every channel. The scenario the challenge names, a thief holding the stolen phone **and** the client's email, gets nowhere: email is a notification channel, never a key.

### Step 5: Phone B, the real client recovers
**Clicks:** *I lost my phone · Recover my wallet* → *Start call as the client* → countdown (20 s in the demo, 48 h in production) → choose a PIN for the new card → *Restore my wallet* → done: funds moved to a new wallet. Phone A now shows "This wallet was replaced after a recovery".

**Underneath:**
1. On a successful identification Swissquote **freezes the old wallet immediately** and starts the waiting period, alerting the client by app, email, SMS, web and phone (mocked alerts in the co-signer log). During the wait the real client can cancel a fraudulent recovery.
2. After the wait, the new phone and Swissquote create a **brand-new wallet** (new key, new shares, a new card share).
3. The **old card share + Swissquote** sign a **sweep** of all funds from the old address to the new one. In recovery mode the co-signer accepts **only the card** as counterpart (never the old phone share) and only signs a transaction whose every output goes to the new wallet.
4. The new wallet signs a new **ownership proof** (BIP-322) so the Travel Rule record follows the funds.

Why a new wallet and not just new shares? A thief who stole the phone keeps that old share forever. Re-sharing the same key would leave an address the thief's share still partly controls. Moving the funds makes the old shares open an empty address.

### Step 6 (optional): The Exit Tool
**Clicks:** http://localhost:5100 → pick the phone whose export to use (demo shortcut for "load the exported file") → card PIN → destination address → Prepare transaction → Sign locally and broadcast.

**Underneath:** the Exit Tool is an independent program (separate process, its own look, not Swissquote-branded). It holds the phone share and the card share, signs the sweep on the computer, and broadcasts through a public explorer. Its co-signer address is deliberately unreachable: it **cannot** contact Swissquote. This is how the client gets their money back if Swissquote is permanently gone, and it is also why Swissquote freezing a wallet is not custody: phone + card can always leave.

---

## 3. Components

| Component | What it does | Code | Real or mock |
|---|---|---|---|
| MPC protocol | 2-of-3 DKLs23 key generation, signing, key re-sharing | `@silencelaboratories/dkls-wasm-ll-node`; wire helpers in `core/shared/mpc.mjs` | Real (open-source library, unmodified) |
| Phone app | Holds Share 1, runs the phone and (during creation/recovery) card parties, wallet UI | `core/client/device.mjs` (logic), `core/client/app.mjs` + `public/index.html` (UI), one process per phone | Real logic; Face ID mocked |
| Swissquote co-signer | Holds Share 2 per wallet, policy, card challenges, recoveries, backup lock B, ownership records, fee wallet | `core/cosigner/server.mjs`, `policy.mjs`, `sponsor.mjs`; storage `core/cosigner/data/` | Real; video ID, sanctions provider, client login mocked |
| Recovery card | Guards Share 3 (released only after the PIN, 8 tries), signs Swissquote challenges with a P-256 key | `core/client/card.mjs` | **Mock**: a folder; a FIDO2 NFC card in production |
| Apple/Google passkey and cloud drive | Lock A of the backup (PRF output) and storage of the encrypted backup | `core/client/keychain.mjs`; folders `cloud/`, `keychain/` | **Mock**: folders |
| Double-locked backup | Encrypts Share 1 with keys from the passkey and from Swissquote | `core/shared/backup.mjs` | Real (HKDF, AES-256-GCM, HMAC from Node's crypto) |
| Ownership proof | BIP-322 "simple" signatures for P2WPKH | `core/shared/bip322.mjs` | Real (checked against the BIP's official test vectors) |
| Fee sponsoring | Swissquote's fee wallet pays the network fee | `core/cosigner/sponsor.mjs`, `build()` in `device.mjs` | Real on signet; the fee wallet is a single-key hot wallet in the demo |
| Screening | Sanctions, verified counterparties, first payment, limits, shown before signing | `/screen` in `server.mjs`; `cosigner/sanctions.json`, `cosigner/directory.json` | Real logic; lists are mocks |
| Bitcoin | P2WPKH addresses, BIP-143 sighashes, low-S signatures, Esplora API | `core/shared/bitcoin.mjs` (bitcoinjs-lib, noble) | Real, signet |
| Explorers | Blockstream first, mempool.space fallback, short cache | `core/shared/bitcoin.mjs` | Real |
| Exit Tool | Independent sweep with phone + card shares | `core/client/escape.mjs` + `public/escape.html` (:5100) | Real; the file export is simulated by picking a demo phone |
| Command line | Every flow without the UI | `core/client/wallet.mjs` | Real |
| Demo scripts | Start, reset (returns leftover funds, tops up the fee wallet), wipe | `core/scripts/` | Demo tooling |
| Tests | 19 automated tests | `core/test/`, `npm test` | Real |

**Process separation (a challenge requirement).** The co-signer runs as its own process with its own folder (`core/cosigner/data/wallets/<public key>/share.bin` and `state.json`). The phone processes never receive Share 2: they only exchange MPC protocol messages with the co-signer over HTTP. The phone and card shares live in separate folders (`core/client/demo/phone-a/`, `core/client/demo/card/`).

**No homemade cryptography.** All primitives come from established libraries: DKLs23 (Silence Laboratories), bitcoinjs-lib, @noble/curves and @noble/hashes, and Node's built-in crypto (scrypt for the mock card PIN, HKDF, HMAC, AES-256-GCM). BIP-322 is a standard transaction construction, verified against the specification's own test vectors.

---

## 4. Every flow in detail

### 4.1 Wallet creation (distributed key generation)
1. The client taps *Create my wallet* and *Tap card & create my wallet*, choosing a card PIN.
2. The mock card prepares a P-256 key pair and the PIN (committed only once Swissquote confirms, so a network failure leaves the card unchanged).
3. Keygen round 1–4 over HTTP (`/keygen/start`, `/round2`, `/round3`, `/finish`). The phone runs parties 0 (phone) and 2 (card); Swissquote runs party 1. Chain-code commitments are exchanged as the protocol requires.
4. Both sides check they derived the same public key. Share 1 is written to the phone folder, Share 3 to the card folder, Share 2 to the co-signer's folder. Swissquote registers the card's public key.
5. **Ownership proof** (section 4.6) is signed automatically.
6. A card that already belongs to a wallet is refused (`CARD_IN_USE`), as a real FIDO2 card would not silently be reused.

*Known window:* during creation the phone process holds Share 1 and Share 3 in memory at the same time (the card cannot run MPC itself). In production the card share is sealed to the card immediately and wiped from memory.

### 4.2 Payment (and the policy)
1. Fee quote from Swissquote (section 4.3); if none is available, the client pays the fee as usual.
2. The phone builds the transaction (P2WPKH, version 2), with a plain-language summary.
3. If the amount is above the card threshold, the phone first asks for a **card challenge** (`/card/challenge`, purpose `sign`, detail = the transaction id). The card checks its PIN and signs the challenge with its P-256 key; Swissquote verifies it against the key registered at creation (`/card/approve`) and marks this exact transaction as approved for 5 minutes. A challenge is single-use and expires after 2 minutes.
4. For each of the client's inputs: MPC signing (`/sign/start`, `/sign/finish`). The co-signer:
   - authenticates the session (prototype: bearer token; production: passkey);
   - **rebuilds the BIP-143 sighash itself** from the transaction and the input value;
   - applies `review()`: frozen → `FROZEN`; sanctioned output → `SANCTIONED`; spent today + this payment above the daily limit → `LIMIT`; above the card threshold without approval → `CARD_REQUIRED`; counterpart not the phone → `WRONG_PARTY`;
   - uses each pre-signature exactly once (reuse would expose the key).
5. The phone combines the signature, normalises it to low-S (Bitcoin's rule), verifies it with noble, and sets the witness.
6. Swissquote signs its fee input if sponsored; the phone broadcasts.

Limits default to 25,000 sats (card threshold) and 100,000 sats (daily limit) per day. In *Settings · Limits* the client can lower them at once, or raise them with a card tap bound to the new values, up to 1,000,000 sats. Swissquote records what was spent today and the payees (to flag first payments).

### 4.3 Gasless payments (fee sponsoring)
**Idea.** Bitcoin has no paymaster, but a transaction can have inputs from different owners. Swissquote adds one coin from its own fee wallet; that coin pays the fee. The client sends exactly the amount and keeps exactly the rest.

**Sequence.**
1. `/sponsor/quote` (preview: peek only; payment: reserve the coin for this wallet for 2 minutes). Swissquote returns the coin, its fee wallet address, the fee rate (capped), and whether to return its change as one or two coins (two when its coins are few and this one is large, so it can sponsor several clients at once).
2. The phone adds the fee input last and Swissquote's change output(s). Fee = fee rate × estimated size; Swissquote pays it (a client change below the dust limit is the only thing the client can lose to fees).
3. The co-signer recognises its reserved coin when co-signing the client's inputs, checks the sponsorship terms, and excludes its own change from the client's limits and sanctions checks.
4. `/sponsor/sign`: only for a transaction whose client inputs Swissquote has just co-signed; signs its own input (BIP-143, low-S), records the quota, marks the coin as used.

**Who pays.** Swissquote, from its own fee wallet, funded from the premium tier and trading revenue. The demo reset keeps it topped up from the treasury.

**Abuse prevention (all enforced server-side):**
- only wallets with a verified ownership proof (verified Swissquote clients);
- Swissquote signs last and only payments it already co-signed under the normal policy, so sponsoring never bypasses limits, card checks or sanctions;
- Swissquote's net outflow (its coin minus its change) must be ≤ 1,000 sats per payment, and the fee rate ≤ 2 sat/vB on signet (configurable);
- per wallet per day: at most 10 sponsored payments and 5,000 sats of fees;
- each fee coin is reserved for one wallet at a time and signed once; a coin signed for a payment that is never broadcast becomes usable again after 30 minutes, which only invalidates the old signed payment, so Swissquote can never pay twice for one coin;
- Swissquote's signature commits only its own coin and the full set of outputs (SIGHASH_ALL), so a client cannot redirect Swissquote's change.
If any of this fails, the client is told why ("not sponsored: …") and pays the fee as before.

**Evidence:** [`f70e0a95…959d`](https://blockstream.info/signet/tx/f70e0a9570a02b97ffb63d836d268e7cc092cb0c31841c9d2a11bf7a00d0959d) (client 53,449 in → 3,000 to Ana + 50,449 change; Swissquote paid the 480-sat fee) and [`6451b8a7…897b`](https://blockstream.info/signet/tx/6451b8a72ff7ecd1a8597bb6d05bdfef22db481015cb39d0e07f59ee331a897b) (change split into two coins).

**On EVM (design):** the same MPC key controls an EOA; a USDC transfer can be made gasless with an ERC-4337 smart account and a Swissquote paymaster, or with USDC's EIP-3009 `transferWithAuthorization` relayed by Swissquote. The same rules apply: verified clients, co-signed-only, per-client quotas.

### 4.4 Screening and the plain-language review (compliant interaction)
Before Face ID, the phone calls `/screen` with the recipient and amount. Swissquote answers:
- `sanctioned`: recipient on the sanctions list (mock list; production: a screening provider such as Chainalysis or Elliptic);
- `verified`: the recipient is in Swissquote's directory of verified counterparties (mock: the client's own Swissquote account deposit address);
- `knownPayee`: this wallet has paid the address before (flags first payments: the address-swap scam);
- limits: spent today, daily limit, card threshold, whether the card will be needed or the payment refused.
The review screen turns these into sentences and shows the effect on the balance ("What will happen"). The same rules are **enforced again** by the co-signer when signing; the screen only explains them in advance.

*Design for DeFi:* an approved-dApp list. For EVM contract calls, the co-signer decodes the calldata and co-signs only approved contracts and methods (for example a vetted DEX router's swap function), with a transaction simulation shown in plain language.

### 4.5 Freeze and unfreeze
- **Freeze** is easy: one button (in production also the emergency line, the website and automatic triggers such as a recovery attempt). It moves no money, so a false freeze is only an inconvenience.
- **Unfreeze** is hard: video identification **and** a card tap bound to the wallet. Refused while a recovery is in progress or for a retired wallet.
- A freeze stops Swissquote's co-signature only. Phone + card can still leave through the Exit Tool, which is exactly why the model is non-custodial.

### 4.6 Ownership proof (Travel Rule, BIP-322)
1. `/ownership/start`: Swissquote writes the message (client number, address, date, random nonce), computes the BIP-322 hash itself (a virtual transaction that spends nothing real), and starts an MPC signing session with the phone.
2. The phone computes the same hash from the message text (so it can only ever sign a virtual BIP-322 transaction, never a payment) and completes the signature.
3. `/ownership/verify`: Swissquote verifies the BIP-322 signature and records `{ clientId, address, message, signature, verifiedAt }`. Log line: `TRAVEL RULE record: <address> belongs to client SQ-…`.
4. Runs automatically after creation and after every recovery; also from the app (*Ownership proof*) or CLI (`wallet.mjs prove`).
A forged signature is refused (`PROOF_INVALID`). The construction passes the BIP-322 test vectors (message hashes, `to_spend` and `to_sign` transaction ids, and the specification's sample signature).

### 4.7 Lost or stolen phone → new wallet
Covered in demo step 5. Extra details: the recovery token only works after the waiting period; in recovery mode the co-signer refuses the phone party (`WRONG_PARTY`), refuses any output not going to the new wallet (`NOT_A_SWEEP`), and marks the old wallet `retired` once swept. Cancelling a recovery is possible during the wait (prototype: with the old phone's token; production: from the Swissquote web login or a phone call).

**Attacker who fools the video check** (deepfake) and waits: still needs the card. With only the phone share, the sweep is refused at the co-signer. Tested from the command line.

### 4.8 Lost card → same key, new card
*Lost your recovery card?* → video identification → waiting period → the phone and Swissquote **re-share the same key** (DKLs `initKeyRecovery` on both, `initLostShareRecovery` for the new card party). The address and balance do not change; the phone and co-signer shares are overwritten, so the lost card's share no longer combines with anything (automated test). The identification step matters: without it, a thief with an unlocked phone could enrol a card of their own and hold two shares.

### 4.9 Lost phone and card → the Apple/Google backup
**Setting it up** (*Back up to Apple/Google account*): the phone derives **lock A** from the client's Apple/Google passkey (WebAuthn PRF output; mock: a folder), asks Swissquote for **lock B** (a random key Swissquote keeps), encrypts Share 1 with AES-256-GCM under HKDF(lock A ‖ lock B), and stores the encrypted file in the client's own cloud drive (mock: a folder). Swissquote stores lock B and an **HMAC verifier** of lock A, never lock A itself.

**Recovering** (*I lost my card too · Restore from my Apple/Google account* on a new phone): sign in to the Apple/Google account (passkey and file sync back) → video identification → **7-day wait** (40 s demo) → the phone proves lock A to Swissquote by sending the HMAC proof → Swissquote releases lock B → the backup opens → Share 1 + Swissquote sweep the funds into a new wallet with a new card.

**Why 7 days and not 48 h:** a thief holding the *unlocked* phone may also hold the synced passkey. The longer wait, with alerts on every channel, gives the real client time to react. Attempts are limited: 5 wrong proofs cancel the recovery, 10 per wallet lock the backup.

**Trade-off (disclosed):** Apple/Google and Swissquote *together* could open the backup, for example under a court order. That is already true of any wallet running on their phones. The backup is optional; a client who does not want it keeps the card route. There is nothing to write down (the 6-word phrase option was removed on purpose: too hard for clients).

**Evidence:** [`9b970345…d6a9`](https://blockstream.info/signet/tx/9b9703453997f8bac31ce9ac40bac4c67f5cf93fea35ec1caa6322fb80d8d6a9).

### 4.10 Swissquote gone → the Exit Tool
See demo step 6. In production: the app has an offline "Export for escape" (Face ID), the Exit Tool is open source with reproducible builds and published from day one, and the card talks to it directly over NFC or USB (no dependency on the swissquote.com domain, to which passkeys are bound). **Evidence:** [`4419a6e8…dde7`](https://blockstream.info/signet/tx/4419a6e8747bed34cac75e368ae8a5aff6833062f260f80a32603a1900e2dde7).

**Only unrecoverable case:** losing the phone and the card, without the backup, at a time when Swissquote no longer exists.

---

## 5. Security model

### 5.1 Who holds what
| Party | Holds | Can do alone |
|---|---|---|
| Client's phone | Share 1 | Nothing (needs Swissquote or the card) |
| Swissquote | Share 2, lock B of the backup, its fee wallet | Refuse to co-sign (block); never move client funds |
| Recovery card | Share 3 (behind PIN) | Nothing |
| Apple/Google | Passkey (lock A), encrypted backup file | Nothing (needs lock B) |

### 5.2 Attacker table
| Attacker | Has | Outcome |
|---|---|---|
| Swissquote, or a hacker inside its co-signer | 1 share | Cannot sign; at most blocks payments (and the client still exits with phone + card) |
| Swissquote + any partner | No partner holds a share | Cannot sign |
| Phone thief (phone locked) | Share 1 behind Face ID / passcode | Nothing; client freezes and recovers to a new wallet |
| Phone thief who knows the passcode | Share 1 + session | Payments limited by the co-signer (card above CHF 21/day, refused above CHF 85/day, sanctions); client freezes, recovers, funds move to a new wallet |
| Thief with phone + email | Share 1 + email | Recovery refused at video ID; a fooled video ID still fails at the sweep (card required) |
| Card finder | Share 3 behind a PIN with 8 tries | Nothing; client replaces the card (same address) |
| Phone + card stolen together | 2 shares, but behind Face ID/passcode and the card PIN | Needs both secrets; client freezes Swissquote's route and uses the backup to move funds to a new wallet; residual risk in a coercion scenario (see 5.4) |
| Apple/Google account hacker | Passkey + encrypted backup | Needs lock B: video ID + 7-day wait with alerts |
| Malicious app update | Could exfiltrate Share 1 | Mitigation: open source, reproducible builds, audits; still needs a second share |
| Phone OS vendor under compulsion + Swissquote | Share 1 + Share 2 | Residual risk of every mobile wallet; long-term fix: Share 1 on dedicated hardware |

### 5.3 Design rules we followed
1. Swissquote alone holds 1 of 3: it can block, never move.
2. No third party ever holds a signing share.
3. If a share may be in someone else's hands → move funds to a **new wallet**. If a share was only **lost** → re-share the same key.
4. Freezing is easy; unfreezing is hard.
5. The server never trusts the phone: it rebuilds what it signs and enforces the policy itself.
6. A card key is registered only at creation, recovery or a verified replacement.
7. Every recovery path that does not need a client-only secret has a longer wait and is disclosed.

### 5.4 Honest residual risks
- **Two shares on one device, briefly**: during creation, recovery and escape the phone (or Exit Tool) holds two shares in memory. Kept short; production seals Share 3 to the card at once.
- **Coercion** (someone forces the client to unlock phone and card): limits and card thresholds cap the damage of Swissquote's route; the exit route is not limited. The production Taproot design (WORKFLOW §15) adds an on-chain delay to the route that bypasses Swissquote.
- **The app publisher** (Swissquote) could ship a malicious update: open source and reproducible builds are required for production.
- **Library licence**: DKLs23 is licensed for non-commercial use; launch needs a commercial licence or another audited library.

---

## 6. Legal reasoning (Switzerland)

*Simplified engineering reasoning, not legal advice.*

**Custody.** Under Swiss practice, what decides custody is whether the provider can dispose of the assets. Swissquote holds 1 of 3 shares and cannot sign alone; no partner holds a share; the client can always move the funds without Swissquote (phone + card). Swissquote can only *refuse* to co-sign. Blocking is not disposing, so the wallet is closer to software (a co-signing service with compliance checks) than to custody, and the crypto would not sit on Swissquote's balance sheet as custody assets. The fee wallet is Swissquote's own money; it never touches client funds.

**The grey zone the challenge names (shared control with a partner).** Our design has no partner with a share. The optional backup involves Apple/Google (lock A) and Swissquote (lock B); neither can open it alone, and the file belongs to the client. We disclose that both together could open it (e.g. under a court order) and let the client skip it.

**Travel Rule (FINMA Guidance 02/2019 and AMLO).** A Swiss institution may only send crypto to, or receive it from, an external (self-hosted) wallet after verifying who controls it. Our wallet makes this automatic:
- the wallet is created inside the client's authenticated, KYC-verified Swissquote session;
- it signs a **BIP-322 ownership proof** written by Swissquote (client number, address, date, nonce), which Swissquote verifies and stores; since Swissquote cannot sign alone, a valid signature proves the client participated;
- after every recovery the new address proves ownership again, and the old one is retired;
- transfers between the client's Swissquote account and their own wallet (the *My Swissquote account* contact) are therefore same-owner transfers with proof on file.

**Payments to third parties: is Swissquote the sending institution?** We argue no: the client initiates, decides and broadcasts; Swissquote neither holds the funds nor can move them, it adds a co-signature after screening, comparable to a security and compliance check. We flag this openly as the open question. If a regulator disagreed, Swissquote already holds what it would need: the owner record, screening results and refusals for sanctioned recipients, and it could attach originator data to outgoing transfers to VASPs.

**Data protection (revFADP).** Swissquote stores per wallet: its share, the public key, limits, spending of the day, payees (last 200 addresses) and the ownership record. No biometrics leave the phone (Face ID is local). Video identification would be done by a licensed provider under FINMA's video-identification circular.

**Consumer clarity.** The app labels every mock as DEMO, shows who signs, who pays the fee and what each check found before the client confirms.

---

## 7. Business case and assumptions

**Value for clients:** self-custody without seed words, a human recovery path, Swiss-bank screening, no fees to think about, and their coins one tap from their trading account.

**Value for Swissquote:**
| Lever | Mechanism |
|---|---|
| Retention | Clients who want self-custody no longer need to leave; withdrawals to their own wallet and deposits back are one tap and Travel-Rule-clean |
| Revenue | Premium tier (higher limits, metal or second card, extended backup), small fees on approved swap/DeFi routes, trading revenue on assets that stay in the ecosystem |
| Lower costs | No custody capital, insurance or cold storage for assets Swissquote cannot move; ownership checks automatic instead of manual reviews |
| Acquisition | Self-custody users who want Swiss security and recovery |

**Illustrative numbers (assumptions, not Swissquote data):**
- 10,000 wallet users, 20% on a CHF 9/month premium tier → ≈ CHF 216,000 a year;
- CHF 50M of crypto kept in the ecosystem at 1% annual trading revenue → ≈ CHF 500,000 a year;
- sponsored fees: a sponsored payment is ≈ 240 vB; at normal mainnet levels (a few sat/vB) under CHF 1; 2 payments a month × 10,000 users × ≈ CHF 0.80 → ≈ CHF 190,000 a year, capped per client.
If asked, invite the judges to substitute their own figures; the structure (retention + premium + avoided custody cost) is the argument.

**Running costs to mention:** the co-signer service (HSM-backed in production), video identification per recovery (rare), sanctions screening per payment, card hardware (≈ CHF 20–40 per FIDO2 NFC card), the MPC library licence, and fee sponsoring.

---

## 8. Questions the bank may ask

### Custody and security
**Q: Can Swissquote, or a rogue employee, steal the client's funds?**
A: No. Swissquote holds one share of three; one share cannot produce a signature (we test this). A rogue employee with full access to the co-signer has exactly that one share. The fee wallet only ever adds Swissquote's own coins.

**Q: Can Swissquote freeze a client's funds, for example on a court order?**
A: Swissquote can refuse to co-sign, which stops the everyday route. It cannot seize or move the funds, and the client can still leave with phone + card. That is the line between a non-custodial wallet and custody. If seizure were legally required, it would have to be enforced against the client, as for any self-custody wallet.

**Q: What if Swissquote is hacked?**
A: The attacker gets Share 2 of every wallet: still one share each, not enough to sign. They could refuse service (clients exit with phone + card) or try to approve payments, but they would still need each client's phone or card. The fee wallet holds only a few days of fees.

**Q: Why not just let the client keep a seed phrase?**
A: Most Swissquote clients will not store 24 words safely, and a single leak is a total loss. Our wallet has no seed words at all; every loss has a recovery path with identification and a waiting period.

**Q: Why MPC and not a multisig?**
A: Bitcoin multisig works only on Bitcoin and reveals the policy on-chain; smart-contract wallets (ERC-4337, Safe) work only on EVM chains. MPC produces one ordinary signature from one key, so the same wallet works on Bitcoin and EVM chains, fees are the cheapest possible, and nobody can see on-chain that it is shared. The trade-off is that on-chain rules (timelocks) need extra work, which our Taproot production design adds.

**Q: Is DKLs23 secure? Did you write your own crypto?**
A: DKLs23 is a published, peer-reviewed threshold-ECDSA protocol (Doerner, Kondi, Lee, shelat). We use Silence Laboratories' open-source implementation unmodified. Everything else uses bitcoinjs-lib, noble and Node's crypto. We wrote no cryptographic primitives.

**Q: What does the server sign? Could a compromised phone trick it?**
A: The co-signer rebuilds the transaction hash itself from the full transaction and applies its policy before contributing. It never signs a hash supplied by the phone. Each pre-signature is used once.

**Q: What stops someone with my unlocked phone from emptying the wallet?**
A: The co-signer's limits: Face ID alone only up to the card threshold (CHF 21/day in the demo); above it the physical card and its PIN; above the daily limit (CHF 85/day in the demo) refused. The thief also cannot enrol their own card. The client freezes from any channel and recovers to a new wallet.

**Q: What if the recovery card is stolen?**
A: It is one share behind a PIN that blocks after 8 tries. The client reports it; after identification, phone + Swissquote re-share the key onto a new card and the stolen card's share becomes useless. The address does not change.

**Q: Isn't the phone + card exit route a weakness? Someone could force me to use it.**
A: It is the price of non-custody: if Swissquote could block it, Swissquote would be the custodian. We limit the risk: card kept at home (a street robbery yields only the phone), PIN on the card, and in production a duress PIN with a decoy wallet and a Taproot design that delays the route bypassing Swissquote by days on-chain.

### Recovery
**Q: How long does recovery take, and who is involved?**
A: Lost phone: the client, the card and Swissquote (video identification), 48 hours. Lost card: phone + Swissquote, 48 hours, same address. Both lost: Apple/Google account + Swissquote, 7 days. Swissquote gone: the client alone with phone + card and the Exit Tool, minutes.

**Q: Why wait 48 hours? Clients will hate that.**
A: Video identification can be fooled (deepfakes, social engineering). The wait, with alerts on every channel, lets the real client cancel a fraudulent recovery. The wallet is frozen during the wait, so nothing is lost. For small balances a shorter wait is possible (WORKFLOW §8).

**Q: Why move funds to a new wallet instead of reissuing the phone share?**
A: A stolen phone keeps its share forever. If we kept the same key, that old share would still be one of two needed. Moving the funds makes old shares open an empty address. For a lost card (no one else has it) we re-share the same key instead: cheaper and the address stays.

**Q: Can a thief with my phone and my email recover the wallet?**
A: No. Email is only a notification channel. The thief fails video identification; even if they fooled it, the recovery sweep needs the card, because in recovery mode Swissquote pairs only with the card, never with the old phone's share. We show the refusal live.

**Q: What if the client loses phone and card and has no backup?**
A: Then the funds are lost, as with any self-custody wallet that loses two of three factors. The app strongly suggests the Apple/Google backup for that reason.

**Q: What happens to funds sent to an old address after a recovery?**
A: Design: Swissquote monitors retired addresses and alerts; the client can sweep them with the old card + Swissquote. Not built in the prototype.

### Technology
**Q: Does it work for Ethereum and stablecoins?**
A: The key is the same curve (secp256k1), so the same wallet has an Ethereum address. The prototype implements Bitcoin; the EVM design uses an ERC-4337 account owned by the MPC key with a Swissquote paymaster for gasless USDC.

**Q: How do you do "gasless" on Bitcoin?**
A: Swissquote adds a coin from its own fee wallet to the client's transaction; that coin pays the whole fee. The client sends exactly the amount. Swissquote signs its coin only after it co-signed the client's part, within per-payment and per-day caps. It is live on signet.

**Q: Who pays the fees and how do you stop abuse?**
A: Swissquote pays, covered by the premium tier and trading revenue. Only verified clients (ownership proof on file), only payments Swissquote approved anyway, at most 1,000 sats per payment, 10 payments and 5,000 sats per day per wallet, capped fee rate, each fee coin used once. Over quota, the client pays the fee as normal.

**Q: What is real and what is mocked?**
A: Real: MPC key generation and signing, the separate co-signer with its own storage, the policy, card challenges, fee sponsoring, BIP-322 ownership proofs, the encrypted backup, the Exit Tool, all transactions on signet. Mocked and labelled DEMO: the card hardware, Face ID, video identification, the Apple/Google account and cloud drive, the sanctions provider, the client login (token instead of passkey).

**Q: Why signet and not testnet or mainnet?**
A: Signet is Bitcoin's stable public test network: real blocks and real transactions, coins without value, predictable blocks. The code also supports testnet (`NETWORK=testnet`); mainnet is a configuration change plus the production hardening listed in section 5.4.

**Q: How big is a key share? Can it go on-chain or on the card?**
A: A serialized DKLs share is about 247 KB. That rules out storing it on-chain. A FIDO2 card cannot run MPC; in production it seals Share 3 (the card's PRF secret encrypts it) and releases it after the PIN.

**Q: How did you test it?**
A: 19 automated tests (`npm test`: MPC pairs, single share refused, re-share, BIP-322 official vectors, policy rules, backup locks) plus every flow executed end to end on signet with real broadcasts; the transaction links are in the README.

**Q: What happens if the explorer is down or rate-limits you?**
A: Blockstream is primary, mempool.space takes over automatically (same API), reads are cached. In production Swissquote would run its own Bitcoin nodes.

### Compliance and legal
**Q: Is this custody under Swiss law?**
A: We argue not: Swissquote cannot dispose of the assets alone, no partner holds a share, and the client can always move the funds without Swissquote. Blocking is not disposing. See section 6.

**Q: How do you satisfy the Travel Rule for self-hosted wallets?**
A: Ownership is proven cryptographically: the wallet signs a BIP-322 message written by Swissquote, which Swissquote verifies and records against the client number. It is renewed after every recovery. Transfers between the client's account and their own wallet are therefore verified automatically.

**Q: When the client pays a third party, is Swissquote the sending institution?**
A: Our position: no; the client initiates and controls the transfer from their own wallet, Swissquote only co-signs after screening. We flag it as the open question. Either way Swissquote has the data: ownership record, screening results, refusals.

**Q: How do you screen sanctions?**
A: Before signing (shown to the client) and again when co-signing (enforced). The prototype uses a local list; production plugs in a provider (Chainalysis, Elliptic, TRM) for addresses and counterparties, with risk scores and thresholds.

**Q: Can the client use DeFi safely?**
A: Today: payments with screening, verified counterparties, first-payment warnings, card checks above a threshold and plain-language effects. Next: an approved-dApp list; the co-signer decodes contract calls and co-signs only approved contracts and methods, with a simulation shown before signing.

**Q: What about AML on incoming funds?**
A: Incoming transfers can be screened by monitoring the wallet's addresses (Swissquote knows them all through the ownership records); risky inflows can trigger review or a co-signing restriction, without ever moving the funds.

### Business and operations
**Q: Why would Swissquote offer a wallet it cannot control?**
A: Because clients who want self-custody leave today. This keeps them, their trading and their CHF conversions inside Swissquote, without the capital and insurance burden of custody, and with Travel Rule checks automated.

**Q: How does Swissquote make money?**
A: Retention of assets and trading, a premium tier, fees on approved swap and DeFi routes. Fee sponsoring is a cost covered by those.

**Q: What does it cost to run?**
A: The co-signer service (HSM-backed), sanctions screening per payment, video identification per recovery (rare), cards (≈ CHF 20–40 each), the MPC library licence, and sponsored fees (capped per client).

**Q: How would support work when a client calls?**
A: Support can freeze instantly, start a recovery (video identification), cancel a fraudulent one, and see alerts. Support can never move funds or see a full key: there is none.

**Q: How long to production?**
A: The custody model and flows are proven; production needs a real FIDO2 card integration, passkey login, a video-identification provider, a sanctions provider, an HSM-backed co-signer, a commercial MPC licence, an audit, and app store releases with reproducible builds.

### User experience
**Q: Can a non-technical client use this?**
A: The client sees CHF amounts, contact names, Face ID, and plain sentences ("Ana Keller receives CHF 10. Your balance goes from … to …. The network fee is paid by Swissquote."). No seed words, no fees to manage, and a card to keep at home like a passport.

**Q: What does the client need to remember?**
A: Their card PIN and where the card is. Nothing else.

**Q: What if they forget the card PIN?**
A: The card blocks after 8 wrong tries; it is then replaced like a lost card (identification, wait, re-share, same address).

### About the hackathon
**Q: Which AI tools did you use?**
A: Claude (Claude Code in the Claude desktop app) to explain the challenge, design and critique the custody and threat models, write and debug the code and tests, run the signet transactions and write the documents and deck. The team reviewed and directed every decision. (Team: add any other tools to the README table.)

**Q: What would you do with another week?**
A: A real FIDO2 NFC card, passkey login, the EVM gasless path, the approved-dApp list, the Taproot production design, and an external review of the co-signer.

---

## 9. Glossary

| Term | Meaning |
|---|---|
| Self-custody | The client controls the keys; no institution can move the funds alone |
| Private key | The secret that authorises spending; here it never exists in one piece |
| MPC / threshold signature | Several parties each hold a share of a key and sign together without ever assembling it; "2-of-3" = any two of three shares suffice |
| DKLs23 | The threshold-ECDSA protocol we use (published 2023), implemented by Silence Laboratories |
| DKG | Distributed key generation: the shares are created together so the full key never exists |
| Co-signer | Swissquote's server holding Share 2; it signs only when its policy allows |
| Signet | A public Bitcoin test network with real blocks and worthless coins |
| sats | Satoshis, 1/100,000,000 of a bitcoin |
| P2WPKH | The standard native SegWit address type (`tb1q…` on test networks) |
| Sighash (BIP-143) | The hash of the transaction that a signature commits to |
| Low-S | Bitcoin's rule that signatures use the smaller of two equivalent values |
| BIP-322 | A standard way to sign a message with a Bitcoin address, used here to prove ownership |
| Travel Rule | Rules requiring sender/receiver information on crypto transfers; in Switzerland banks must verify who owns a self-hosted wallet |
| FIDO2 / passkey | The standard behind hardware security keys and Apple/Google passkeys |
| PRF (WebAuthn) | A passkey feature that derives a secret key without revealing the passkey |
| Gasless / sponsored fee | The network fee is paid by someone other than the sender (here Swissquote) |
| Exit Tool | Our independent tool that moves the funds with phone + card if Swissquote is gone |
| Esplora | The open block-explorer API used by Blockstream and mempool.space |

---

## 10. Demo-day checklist and troubleshooting

**The evening before / the morning:**
1. `npm install` (once), `npm run demo`, then in a second terminal `npm run demo:reset`.
2. Check phone A shows a balance (a fresh funding transaction shows "pending" for about 10 minutes; it works while pending).
3. `npm test` (19 passing) if anyone asks.
4. Open tabs: 5001, 5002, 5100, the deck, the README evidence table.
5. Treasury balance: if low, refill `tb1qamhytefc99u4vq6r0utnvh4w560cn79cxqd0td` from a signet faucet and wait for 1 confirmation.

**During the pitch:**
- Use a phone hotspot if the venue Wi-Fi is shared (explorer rate limits are per public IP). mempool.space takes over automatically if Blockstream refuses.
- Do not restart the demo between steps; the recovery needs phone B to be empty (run `npm run demo:reset` before the pitch).
- If anything fails live, switch to the evidence slide: every step is already on-chain.

**Problems:**
| Symptom | Fix |
|---|---|
| "port in use" | An earlier demo is running: stop the `node` processes on 4000, 5001–5003, 5100 |
| "Too many requests" | Wait a minute, or use a hotspot; the fallback explorer should already be in use |
| Balance shows pending | Normal for ~10 minutes after a reset; payments still work |
| "Not sponsored: …" on the review | The fee wallet is busy or its quota is used up; the payment still works, the client pays the fee. Reset tops the fee wallet up |
| Card refuses the PIN | Demo PIN is `123456`; after 8 wrong tries the card is blocked: run `npm run demo:reset` |
| Phone A says "replaced" | A recovery already happened: `npm run demo:reset` |

---

## 11. What was built, in order

1. MPC spike: 3-party DKG and 2-party signing, single share refused (`spike/`).
2. Real MPC-signed transaction on signet, phone and co-signer as separate processes.
3. Co-signer with its own storage, DKG over HTTP, server-side sighash, policy (freeze, sanctions, daily limit).
4. Recovery: lost phone (card + Swissquote, video ID, wait, new wallet, sweep), attacker refused twice.
5. Lost card: re-share of the same key (DKLs key recovery).
6. Backup for phone + card lost: first with a 6-word phrase, then switched to Apple/Google passkey + Swissquote (team decision), and the phrase option removed (too hard for clients).
7. Card threshold, daily limits, Settings, card challenges bound to the transaction; unfreeze with video ID + card.
8. Phone app UI (Face ID and video call simulations, card-tap animation, CHF/sats), three demo phones, Exit Tool UI.
9. BIP-322 ownership proofs (Travel Rule), verified against the official test vectors, automatic after creation and recovery.
10. Fee sponsoring ("gasless"), with quotas and caps, split change for parallel sponsorship.
11. Pre-signing screening and the plain-language "What will happen" review; verified-counterparty directory; first-payment warnings.
12. Explorer fallback (mempool.space), lower fee caps for signet, demo reset that returns leftover funds and tops up the fee wallet.
13. 19 automated tests; end-to-end reruns on signet of every flow with the final code (Exit Tool UI included).
