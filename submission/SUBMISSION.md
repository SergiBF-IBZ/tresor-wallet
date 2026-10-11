# DoraHacks submission: copy-paste sheet

Everything to fill in the "Create a new Build and submit" form, step by step. Files referenced here are in this folder.

## Names

**Project (Build) name:** `Tresor: Swiss self-custody wallet`
"Tresor" is the German and French word for a safe; the product is a vault the client holds, with a Swiss safety net.

Alternatives if you prefer: `Tresor` (short), `Trio Wallet`, `KeyTrio`, `Two-of-Three Wallet`.

**Team name:** `Two of Three`
It is the wallet's rule (any two of three shares sign) and it works for a team.

Alternatives: `Threshold`, `Signet Society`, `Share Holders`.

If you rename the project, keep the app UI as "Swissquote Wallet": it is the wallet Swissquote would launch; "Tresor" is the build's name on DoraHacks.

---

## Step 1 · Profile

| Field | What to enter |
|---|---|
| Build (project) name * | `Tresor: Swiss self-custody wallet` |
| Build logo * | Upload `logo-480.png` (480 × 480 PNG, 19 KB). Source: `logo.svg` |
| Vision * | See below (pick the length that fits the field) |
| Category * | **Crypto / Web3** |
| GitHub/Gitlab/Bitbucket * | Your repository URL (see "GitHub repository" below) |
| Project website (optional) | Leave empty, or the deck link once shared: https://claude.ai/artifact/Phi1TiNUejNtNqet9111UR |
| Demo video (optional) | Your YouTube link (see "Demo video" below; unlisted is fine) |
| Social links * (at least one) | A team member's LinkedIn or X profile, or the team's X account. You must provide these; nothing to invent here |

**Vision (short, 1 sentence):**
> Self-custody that keeps clients at Swissquote: the client holds the keys, Swissquote can block but never move the funds, and every loss has a way back.

**Vision (medium, if the field allows a paragraph):**
> Today a Swissquote client who wants to hold their own crypto has to withdraw it to an external wallet, leave the bank's ecosystem and guard a seed phrase alone. Tresor splits one key into three shares with MPC (phone, Swissquote co-signer, recovery card); any two sign. Swissquote can block a payment but never move the funds, so it is software, not custody. No seed words, Swissquote pays the network fees, the Travel Rule ownership check is automatic, and every loss (phone, card, both, even Swissquote itself) has a recovery path that refuses thieves.

---

## Step 2 · Details

The description field usually takes Markdown: paste the whole of `description.md`. If there are separate fields:

| Field | What to enter |
|---|---|
| Tagline / short description | `2-of-3 MPC self-custody wallet for Swiss bank clients: no seed words, gasless, Travel-Rule ready, real Bitcoin signet transactions.` |
| Tracks / bounties | **Swissquote Wallet Challenge** |
| Tech stack / tags | `MPC`, `Threshold ECDSA`, `DKLs23`, `Bitcoin`, `Signet`, `BIP-322`, `Self-custody`, `Travel Rule`, `Gasless`, `Node.js`, `FIDO2` |
| Bonus topics tackled | Gasless transactions (Bitcoin fee sponsoring, live) and compliant interaction (screening + plain-language simulation, live); recovery that refuses an attacker with phone + email |
| AI tools used | Claude (Claude Code): design critique, code, tests, signet runs, docs, deck. Add any other tools you used |

---

## Step 3 · Team

Team **Two of Three**: Sergi Boned and Arnau Ferrer. Add each member with their DoraHacks account.

## Step 4 · Contact

A team member's email and/or Telegram/Discord. Use your own details; nothing is pre-filled here.

## Step 5 · Submission

Choose the **Swissquote Wallet Challenge** track and submit. Before submitting, check:
- [ ] The repository is public (or shared with the judges) and the README renders, including the screenshots
- [x] Team names on slides 1 and 18 of the deck (Sergi Boned, Arnau Ferrer)
- [ ] The deck is shared (Share menu) if you link it, or a PDF export is attached/linked
- [ ] README "AI tools used" table completed
- [ ] Demo video link works (if you add one)

---

## GitHub repository

The project folder is not a Git repository yet. To publish it (from the project root):

```bash
git init
git add .
git commit -m "Tresor: Swiss self-custody wallet (EPFL Hackathon 2026)"
```

Then create an empty repository on GitHub (for example `tresor-wallet`) and follow GitHub's "push an existing repository" commands.

The `.gitignore` files already exclude `node_modules/`, all key shares (`core/client/demo/`), the co-signer state (`core/cosigner/data/`, which also holds Swissquote's fee-wallet key), the Spanish transcript and notes (`chat/`, `EMPIEZA-AQUI.md`) and zip files. Double-check with `git status` before the first commit that none of those are listed.

## Demo video (optional, recommended)

2 minutes, screen recording of the browser with voice-over. Script:

1. (0:00) Phone A: "This is the client's wallet. Swissquote has verified it belongs to the client: that is the Travel Rule check, done automatically."
2. (0:15) Send CHF 10 to Ana: show *Paid by Swissquote*, the three checks and *What will happen*, confirm with Face ID, open the transaction in the explorer.
3. (0:45) Send to the sanctioned test entity: the review is red; confirm; Swissquote refuses.
4. (1:00) Phone B: "I lost my phone": impostor refused; then the real client, 20-second wait, new card PIN, funds swept to a new wallet; phone A now says replaced.
5. (1:40) Exit Tool: phone + card move the funds with no Swissquote server.
6. (1:55) "Swissquote can block, never move. No seed words, fees paid, every loss has a way back."

Upload to YouTube as unlisted and paste the link: DoraHacks embeds YouTube links.
