# Pitch script (5 minutes + live demo)

The deck: https://claude.ai/artifact/Phi1TiNUejNtNqet9111UR (19 slides, the last one an appendix with app screenshots; speaker notes are also inside each slide). It is private to the account that created it: share it from the page's Share menu, and download a PDF or PowerPoint copy (Share › Export) to present offline.

Timing assumes 5 minutes of talk plus about 2 minutes of live demo. If the slot is shorter, skip the slides marked *(optional)* and keep them for questions.

| # | Slide | Time | What to say |
|---|---|---|---|
| 1 | Your keys. A Swiss safety net. | 0:15 | "Swissquote clients who want to hold their own crypto have to leave today. We built the wallet that lets them hold their own keys without leaving, and without the risk of losing everything." |
| 2 | The problem | 0:25 | Buy at Swissquote → withdraw to an external wallet → assets, trading and relationship leave. FINMA's Travel Rule means the bank cannot even verify who owns that wallet. The client is left with 24 words to protect alone. |
| 3 | Our answer | 0:30 | One key split in three with MPC: phone, Swissquote, a recovery card. Any two sign. Phone + Swissquote every day; card + Swissquote for recovery; phone + card if Swissquote is gone. Swissquote can block, never move. No seed words. Swissquote pays the fees. |
| 4 | Live demo | 2:00 | Follow the six steps on the slide (details in the slide's notes and in GUIDE.md §2). If the network fails, jump to slide 16. |
| 5 | Why MPC | 0:25 | Judge every model by "who can move the money". Custodial = Swissquote; seed = 24 words; ERC-4337 = no Bitcoin; Shamir = seed rebuilt, Swissquote + partner could restore. MPC: multi-chain, no seed, Swissquote only blocks. |
| 6 | Threat model | 0:25 | The four questions of the challenge, answered. One honest caveat: the optional backup can be opened by Apple/Google and Swissquote together; disclosed and skippable. |
| 7 | Architecture *(optional)* | 0:20 | Separate processes, separate storage. The phone never sees Share 2; the co-signer rebuilds what it signs. Solid = real, dashed = mock. |
| 8 | Creation and identity | 0:20 | Share 2 is born on Swissquote's server. The wallet then signs a BIP-322 ownership proof: that is the Travel Rule record, automatic. |
| 9 | Authentication | 0:20 | Face ID up to CHF 21 a day, card + PIN above, refused above CHF 85; plain-language review; a thief cannot enrol a card. |
| 10 | Recovery | 0:30 | Every loss has a way back, thieves don't: new wallet when a share may be stolen, same key when it was only lost. Phone + email thief refused twice. |
| 11 | Exit | 0:15 | The funds were never at Swissquote. Phone + card + the independent Exit Tool, tested with real funds. |
| 12 | Gasless | 0:25 | Swissquote's fee wallet adds a coin that pays the fee; the client sends exactly the amount. Abuse controls: verified clients, co-signed only, caps, quotas, each coin once. Live on signet. |
| 13 | Compliant interaction | 0:20 | Checks shown before Face ID, enforced again by Swissquote; a tampered app gains nothing. Next: approved-dApp list for DeFi. |
| 14 | Legal | 0:25 | Closer to software than custody; Travel Rule automatic; third-party payments: we argue Swissquote is not the sending institution, flagged openly. |
| 15 | Business | 0:25 | Retention, premium tier, lower custody cost. Figures are illustrative. |
| 16 | Proof *(optional)* | 0:10 | Every step is a real signet transaction; 19 automated tests; no homemade crypto. |
| 17 | Honest limits *(optional)* | 0:15 | Say them before the judges do. |
| 18 | Close | 0:10 | "Self-custody without leaving Swissquote. Thank you." |

## Before going on stage
- `npm run demo` and `npm run demo:reset` done; phone A shows a balance.
- Tabs open: http://localhost:5001, http://localhost:5002, http://localhost:5100, the deck, the README.
- Phone hotspot ready. Card PIN `123456`.
- Team names are on slides 1 and 18 (Team Two of Three · Sergi Boned & Arnau Ferrer).

## Three sentences to remember
1. "Swissquote can block a payment, but it can never move the client's money."
2. "Every loss has a way back, with identification and a waiting period, and the thief who steals the phone and the email is refused twice."
3. "The client never sees a seed word or a network fee, and Swissquote never carries custody."
