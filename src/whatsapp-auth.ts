/**
 * WhatsApp Authentication Script
 *
 * Run this during setup to authenticate with WhatsApp.
 * Uses pairing code by default (enter code on your phone).
 * Pass --qr flag to use QR code scanning instead.
 *
 * Usage:
 *   npx tsx src/whatsapp-auth.ts              # pairing code (default)
 *   npx tsx src/whatsapp-auth.ts --qr         # QR code
 */

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  makeCacheableSignalKeyStore,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import fs from 'fs';
import readline from 'readline';

const AUTH_DIR = './store/auth';
const useQR = process.argv.includes('--qr');

const logger = pino({
  level: 'warn',
});

function askQuestion(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function authenticate(): Promise<void> {
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  if (state.creds.registered) {
    console.log('✓ Already authenticated with WhatsApp');
    console.log('  To re-authenticate, delete the store/auth folder and run again.');
    process.exit(0);
  }

  console.log('Starting WhatsApp authentication...\n');

  const sock = makeWASocket({
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    printQRInTerminal: false,
    logger,
    browser: ['GroupGuard', 'Chrome', '1.0.0'],
  });

  // Request pairing code if not using QR mode
  if (!useQR && !state.creds.registered) {
    const phoneNumber = await askQuestion(
      'Enter your phone number (with country code, no + or spaces, e.g. 14155551234): ',
    );

    if (!/^\d{7,15}$/.test(phoneNumber)) {
      console.error('✗ Invalid phone number. Use digits only with country code (e.g. 14155551234)');
      process.exit(1);
    }

    // Small delay to let the socket connect before requesting pairing code
    await new Promise((resolve) => setTimeout(resolve, 3000));

    try {
      const code = await sock.requestPairingCode(phoneNumber);
      console.log(`\nYour pairing code: ${code}\n`);
      console.log('On your phone:');
      console.log('  1. Open WhatsApp');
      console.log('  2. Tap Settings → Linked Devices → Link a Device');
      console.log(`  3. Tap "Link with phone number instead"`);
      console.log(`  4. Enter the code: ${code}\n`);
      console.log('Waiting for confirmation...');
    } catch (err) {
      console.error('✗ Failed to request pairing code:', (err as Error).message);
      console.log('  Try again, or use --qr flag for QR code authentication.');
      process.exit(1);
    }
  }

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    // Only show QR code in QR mode
    if (qr && useQR) {
      console.log('Scan this QR code with WhatsApp:\n');
      console.log('  1. Open WhatsApp on your phone');
      console.log('  2. Tap Settings → Linked Devices → Link a Device');
      console.log('  3. Point your camera at the QR code below\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const reason = (lastDisconnect?.error as any)?.output?.statusCode;

      if (reason === DisconnectReason.loggedOut) {
        console.log('\n✗ Logged out. Delete store/auth and try again.');
        process.exit(1);
      } else {
        console.log('\n✗ Connection failed. Please try again.');
        process.exit(1);
      }
    }

    if (connection === 'open') {
      console.log('\n✓ Successfully authenticated with WhatsApp!');
      console.log('  Credentials saved to store/auth/');
      console.log('  You can now start GroupGuard.\n');

      setTimeout(() => process.exit(0), 1000);
    }
  });

  sock.ev.on('creds.update', saveCreds);
}

authenticate().catch((err) => {
  console.error('Authentication failed:', err.message);
  process.exit(1);
});
