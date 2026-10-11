// MOCK of the FIDO2 recovery card's authenticator. A real card generates its P-256 key inside
// the chip, checks the PIN itself and blocks after 8 wrong PINs; here a folder plays the chip.
// It only signs challenges from Swissquote (card taps); it never signs Bitcoin transactions.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { generateKeyPairSync, createPrivateKey, sign as ecSign, scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

const MAX_TRIES = 8;
const hashPin = (pin, salt) => scryptSync(String(pin), salt, 32);
const fail = (message, code, extra) => Object.assign(new Error(message), { code, ...extra });

export function openCard(cardDir) {
  const path = join(cardDir, 'authenticator.json');
  const load = () => JSON.parse(readFileSync(path));
  const save = s => { mkdirSync(cardDir, { recursive: true }); writeFileSync(path, JSON.stringify(s, null, 2)); };

  return {
    isActivated: () => existsSync(path),

    // Activation in two steps: prepare a new key pair and PIN, and only commit them to the card
    // once Swissquote has registered the public key. A failure in between leaves the card as it was.
    prepareActivation(pin) {
      if (!/^\d{6,8}$/.test(String(pin ?? ''))) throw fail('Choose a PIN of 6 to 8 digits.', 'BAD_PIN');
      const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
      const salt = randomBytes(16);
      const state = {
        privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
        publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
        pinSalt: salt.toString('base64'), pinHash: hashPin(pin, salt).toString('base64'), triesLeft: MAX_TRIES,
      };
      return { publicKey: state.publicKey, commit: () => save(state) };
    },

    // A card tap: checks the PIN, then signs the challenge with the card key.
    tap(pin, message) {
      if (!existsSync(path)) throw fail('No activated card detected.', 'NO_CARD');
      const s = load();
      if (s.triesLeft <= 0) throw fail('The card is blocked after too many wrong PINs. Order a new card.', 'CARD_BLOCKED');
      if (!timingSafeEqual(hashPin(pin ?? '', Buffer.from(s.pinSalt, 'base64')), Buffer.from(s.pinHash, 'base64'))) {
        s.triesLeft -= 1;
        save(s);
        throw fail(s.triesLeft > 0 ? `Wrong PIN. ${s.triesLeft} attempts left.` : 'Wrong PIN. The card is now blocked.',
          s.triesLeft > 0 ? 'WRONG_PIN' : 'CARD_BLOCKED', { triesLeft: s.triesLeft });
      }
      s.triesLeft = MAX_TRIES;
      save(s);
      const key = createPrivateKey({ key: Buffer.from(s.privateKey, 'base64'), format: 'der', type: 'pkcs8' });
      return ecSign('sha256', Buffer.from(message), key).toString('base64');
    },
  };
}
