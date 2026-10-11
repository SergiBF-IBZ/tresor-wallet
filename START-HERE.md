# Start here

Hackathon project for the **Swissquote Wallet Challenge**: a self-custody wallet whose key is split into 3 parts with MPC (phone, Swissquote co-signer, recovery card). Any 2 parts can sign; Swissquote alone can block a payment but never move funds. Everything runs on **Bitcoin signet** (a test network: the coins have no value).

## 1. Install (5 minutes)

You need **Node.js 20 or newer** (tested with Node 24).

```bash
npm install
npm run demo
```

Keep that terminal open. It starts five local processes:

| Address | What it is |
|---|---|
| http://localhost:5001 | Phone A: the client's phone (recovery card PIN **123456**) |
| http://localhost:5002 | Phone B: the same client's new phone, for *Recover my wallet* |
| http://localhost:5003 | Phone C: a different client with a blank card, for *Create my wallet* |
| http://localhost:5100 | Exit Tool: independent tool that moves the funds if Swissquote disappears |
| http://localhost:4000 | Swissquote co-signer (server only, no page) |

## 2. Get test coins (first time only)

The demo funds phone A from a "treasury" wallet. A fresh copy has none, so in a **second terminal**:

```bash
npm run demo:reset
```

1. The first run creates the treasury and prints its address (`tb1q…`).
2. Paste that address into a signet faucet, for example https://signet257.bublina.eu.org.
3. Wait until the faucet payment has **1 confirmation** (about 10 minutes). You can check it at `https://blockstream.info/signet/address/<treasury address>`.
4. Run `npm run demo:reset` again: phone A gets a new wallet funded from the treasury; phones B and C are emptied.

Run `npm run demo:reset` again whenever you want to restart the demo from the beginning.

## 3. The 2-minute demo

1. **Phone A** (:5001): the balance and "Ownership verified by Swissquote (BIP-322)" → **Send** CHF 10 to *Ana Keller* → the review shows *Network fee: Paid by Swissquote*, the checks Swissquote ran (sanctions, recipient, limits) and *What will happen* → **Confirm with Face ID** (signed by phone + Swissquote).
2. Try *Sanctioned test entity*: the review turns red, and confirming is refused by Swissquote.
3. **Phone B** (:5002): **I lost my phone · Recover my wallet** → **As an impostor** (refused) → start again with **Start call as the client** → wait for the countdown → enter a new card PIN → funds are swept into a new wallet.
4. **Phone A** now shows that its wallet was replaced.
5. Optional: the **Exit Tool** (:5100) moves funds with phone + card only, no Swissquote server.

More flows: *Back up to Apple/Google account* (then on phone B: *I lost my card too*), *Lost your recovery card?*, *Ownership proof*, *Settings · Limits*, the *My Swissquote account* contact.

Everything simulated (recovery card, Face ID, video call, Apple/Google account, sanctions provider) is labelled **DEMO** in the app.

To check the code: `npm test` runs 19 automated tests in a few seconds.

## 4. Documents

- **README.md**: the submission: the 6 required topics, what is real and what is mocked, on-chain evidence.
- **GUIDE.md**: everything that was built, how each flow works, and answers to the questions the bank is likely to ask.
- **WORKFLOW.md**: the full design, threat model, limitations and build status.
- **pitch/**: the 5-minute script (`SPEAKER-NOTES.md`) and an offline copy of the deck (`deck.html`).
- **NOTICE.md**: licence notice of the MPC library (non-commercial use only).
- **CLAUDE.md**: project context for Claude Code, if you continue with it.

## 5. Troubleshooting

- **"port in use"** when starting: an earlier demo is still running. Stop the `node` processes on ports 4000, 5001–5003 and 5100.
- **"Too many requests"**: the public explorer (Blockstream) allows about 700 requests per hour per internet connection. Wait, or use a phone hotspot.
- **Balance shows "pending"**: the funding transaction is not confirmed yet; wait about 10 minutes.
- **The treasury is nearly empty**: refill it from a faucet (step 2) before the next reset.
- Run the commands from the project root (or from `core/`).

The folders `core/client/demo/` and `core/cosigner/data/` are created when you run the demo and hold **key shares** (of worthless test coins). Do not publish them.
