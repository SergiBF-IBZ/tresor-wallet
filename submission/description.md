# Tresor: Swiss self-custody wallet

**Your keys. A Swiss safety net.** The self-custody wallet Swissquote could launch tomorrow: the client holds the keys, Swissquote can block a payment but never move the funds, and the wallet stays one tap from the Swissquote account.

Built for the **Swissquote Wallet Challenge** (EPFL Hackathon, October 2026). Working prototype on **Bitcoin signet** with real transactions; every simulated part is labelled DEMO.

## The problem
A Swissquote client who wants to hold their own crypto must withdraw it to an external wallet. Swissquote loses the assets and the trading, cannot verify who owns that wallet (FINMA Travel Rule), and the client is left alone with a seed phrase: lose it and the money is gone.

## How it works
One key, split into **three shares with MPC** (2-of-3 threshold ECDSA, DKLs23). Any two sign; the full key never exists.

| Share | Holder | Used for |
|---|---|---|
| 1 | Client's phone (Face ID) | Everyday payments, with Swissquote |
| 2 | Swissquote co-signer (separate process, own storage) | Screens and co-signs; can block, never move |
| 3 | Recovery card (NFC + PIN, kept at home) | Large payments, recovery, the exit |

## The six required topics
1. **Custody model:** MPC 2-of-3, compared with custodial, seed phrase, ERC-4337 and Shamir. Swissquote alone, or with any partner, cannot move funds.
2. **Architecture:** phone app, Swissquote co-signer, recovery card, cloud backup, independent Exit Tool, Bitcoin signet; real and mocked parts marked.
3. **Wallet creation:** distributed key generation over HTTP (Swissquote's share is born on its server), then a **BIP-322 ownership proof** links the address to the KYC-verified client.
4. **Authentication:** Face ID up to a daily card threshold; above it the recovery card + PIN approves that exact transaction; above the daily limit, refused.
5. **Recovery:** lost phone (card + Swissquote, video ID, 48 h wait, funds swept to a new wallet); lost card (same key re-shared, same address); both lost (Apple/Google passkey + Swissquote key, 7-day wait); Swissquote gone (phone + card in the independent Exit Tool). A thief with the phone and the email is refused twice.
6. **Business case:** retention of assets and trading, premium tier, routing fees, no custody capital; sponsored fees are a capped cost.

## Bonus topics
- **Gasless (live on signet):** Swissquote's fee wallet adds a coin to the client's payment and pays the whole network fee; the client sends exactly the amount. Abuse prevention: verified clients only, co-signed payments only, per-payment and per-day caps, each fee coin used once.
- **Compliant interaction (live):** before Face ID the client sees Swissquote's checks (sanctions, verified counterparty or first payment, limits) and "what will happen" to their balance; the co-signer enforces the same rules again.
- **Recovery that refuses an attacker** with the stolen phone and email.

## Legal (Switzerland, simplified)
Swissquote cannot dispose of the funds alone, so the wallet is closer to software than custody. Travel Rule ownership is proven cryptographically (BIP-322) at creation and after every recovery, so account-to-own-wallet transfers are verified automatically. Third-party payments: the client initiates and controls; we argue Swissquote is not the sending institution, and flag it openly.

## Proof
Real signet transactions for every flow: payment, gasless payment, lost-phone recovery, lost phone and card recovery, Exit Tool sweep (links in the README). 19 automated tests (`npm test`). No homemade cryptography: DKLs23 (Silence Laboratories), bitcoinjs-lib, noble, Node crypto.

## Run it
```bash
npm install
npm run demo        # co-signer :4000, phones :5001-5003, Exit Tool :5100
npm run demo:reset  # fund the demo wallet (first run creates a treasury to fill from a signet faucet)
npm test
```

## Built with
Node.js, @silencelaboratories/dkls-wasm-ll-node (MPC), bitcoinjs-lib, @noble/curves and @noble/hashes, Bitcoin signet via Blockstream / mempool.space Esplora. AI: Claude (Claude Code) for design critique, code, tests, documentation and the deck.

## Honest limits
The recovery card, Face ID, video identification, Apple/Google account and sanctions provider are simulated. The MPC library is licensed for non-commercial use. Next: a real FIDO2 card, passkey login, an EVM paymaster for USDC, an approved-dApp list and a Taproot design with on-chain timelocks.
