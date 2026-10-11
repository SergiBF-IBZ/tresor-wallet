// Starts the demo processes: the Swissquote co-signer and three phones.
//   co-signer → http://localhost:4000   (recovery wait shortened to 20 s)
//   phone A   → http://localhost:5001
//   phone B   → http://localhost:5002
//   phone C   → http://localhost:5003   (a different client with a blank card: onboarding)
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const core = fileURLToPath(new URL('..', import.meta.url));
const demo = `${core}client/demo/`;

const processes = [
  { name: 'cosigner', script: 'cosigner/server.mjs', env: {
    RECOVERY_DELAY_SECONDS: process.env.RECOVERY_DELAY_SECONDS ?? '20',
    BACKUP_RECOVERY_DELAY_SECONDS: process.env.BACKUP_RECOVERY_DELAY_SECONDS ?? '40',
  } },
  // Phones A and B belong to the same client: they share the card, the cloud drive and the
  // Apple/Google account, so B can play "the new phone" in a recovery.
  { name: 'phone-a ', script: 'client/app.mjs', env: { APP_PORT: '5001', CLIENT_DATA: `${demo}phone-a`, CARD_DATA: `${demo}card`, CLOUD_DATA: `${demo}cloud`, KEYCHAIN_DATA: `${demo}keychain` } },
  { name: 'phone-b ', script: 'client/app.mjs', env: { APP_PORT: '5002', CLIENT_DATA: `${demo}phone-b`, CARD_DATA: `${demo}card`, CLOUD_DATA: `${demo}cloud`, KEYCHAIN_DATA: `${demo}keychain` } },
  // Independent open-source escape tool: never talks to the co-signer.
  { name: 'escape  ', script: 'client/escape.mjs', env: { ESCAPE_PORT: '5100' } },
  // Phone C is a different client with a blank card of their own: use it to show onboarding.
  { name: 'phone-c ', script: 'client/app.mjs', env: { APP_PORT: '5003', CLIENT_DATA: `${demo}phone-c`, CARD_DATA: `${demo}client-c/card`, CLOUD_DATA: `${demo}client-c/cloud`, KEYCHAIN_DATA: `${demo}client-c/keychain` } },
];

const children = processes.map(({ name, script, env }) => {
  const child = spawn(process.execPath, [script], { cwd: core, env: { ...process.env, ...env } });
  const print = data => data.toString().trimEnd().split('\n').forEach(line => console.log(`[${name}] ${line}`));
  child.stdout.on('data', print);
  child.stderr.on('data', print);
  child.on('exit', code => console.log(`[${name}] exited (${code})`));
  return child;
});

const stop = () => { children.forEach(c => c.kill()); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
