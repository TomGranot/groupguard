import fs from 'fs';
import path from 'path';
import readline from 'readline';
import makeWASocket, {
  DisconnectReason,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import pino from 'pino';

import { DATA_DIR, GROUPS_DIR, STORE_DIR } from './config.js';
import { createSafeGroup, parseRegisteredGroups } from './group-config.js';
import { RegisteredGroup } from './types.js';
import { loadJson, saveJson } from './utils.js';

const logger = pino({ level: 'silent' });

function ask(question: string): Promise<string> {
  const input = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    input.question(question, (answer) => {
      input.close();
      resolve(answer.trim());
    });
  });
}

function parseSelection(answer: string, count: number): number[] {
  if (answer.toLowerCase() === 'all') return Array.from({ length: count }, (_, index) => index);
  if (!answer) return [];

  const selected = new Set<number>();
  for (const part of answer.split(',')) {
    const token = part.trim();
    if (/^\d+$/.test(token)) {
      selected.add(Number(token) - 1);
      continue;
    }

    const range = token.match(/^(\d+)-(\d+)$/);
    if (!range) throw new Error(`Invalid selection: ${token}`);
    const start = Number(range[1]);
    const end = Number(range[2]);
    if (start > end) throw new Error(`Invalid range: ${token}`);
    for (let value = start; value <= end; value += 1) selected.add(value - 1);
  }

  const indexes = [...selected];
  if (indexes.some((index) => index < 0 || index >= count)) {
    throw new Error(`Choose numbers between 1 and ${count}`);
  }
  return indexes;
}

function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'whatsapp-group';
}

function uniqueFolder(name: string, groups: Record<string, RegisteredGroup>): string {
  const used = new Set(['main', 'global', ...Object.values(groups).map((group) => group.folder)]);
  const base = slugify(name);
  if (!used.has(base)) return base;
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error(`Could not create a unique folder for ${name}`);
}

async function waitForConnection(socket: ReturnType<typeof makeWASocket>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out connecting to WhatsApp')), 30_000);
    socket.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        clearTimeout(timer);
        reject(new Error('Authentication expired. Run npm run auth first.'));
      } else if (connection === 'open') {
        clearTimeout(timer);
        resolve();
      } else if (connection === 'close') {
        clearTimeout(timer);
        const reason = (lastDisconnect?.error as any)?.output?.statusCode;
        const detail = reason === DisconnectReason.loggedOut ? 'WhatsApp logged out' : 'Connection closed';
        reject(new Error(`${detail}. Run npm run auth and try again.`));
      }
    });
  });
}

async function main(): Promise<void> {
  if (!process.stdin.isTTY) {
    throw new Error('Group selection needs an interactive terminal');
  }

  const authDir = path.join(STORE_DIR, 'auth');
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  if (!state.creds.registered) throw new Error('WhatsApp is not linked. Run npm run auth first.');

  console.log('\nConnecting to WhatsApp to read your groups...');
  const socket = makeWASocket({
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    printQRInTerminal: false,
    logger,
    browser: ['GroupGuard Setup', 'Chrome', '1.0.0'],
  });
  socket.ev.on('creds.update', saveCreds);
  await waitForConnection(socket);

  const available = Object.entries(await socket.groupFetchAllParticipating())
    .map(([jid, metadata]) => ({ jid, name: metadata.subject || jid }))
    .sort((left, right) => left.name.localeCompare(right.name));

  if (available.length === 0) throw new Error('No WhatsApp groups were found for this account.');

  const configPath = path.join(DATA_DIR, 'registered_groups.json');
  const parsed = parseRegisteredGroups(loadJson<unknown>(configPath, {}));
  if (parsed.errors.length > 0) {
    throw new Error(`Fix registered_groups.json before continuing:\n${parsed.errors.join('\n')}`);
  }
  const groups = parsed.groups;

  console.log('\nChoose the groups GroupGuard should observe:\n');
  available.forEach((group, index) => {
    const status = groups[group.jid] ? ' (already added)' : '';
    console.log(`  ${index + 1}. ${group.name}${status}`);
  });
  console.log('\nEnter numbers such as 1,3-5, type all, or press Enter to make no changes.');
  const indexes = parseSelection(await ask('Groups: '), available.length);

  let added = 0;
  for (const index of indexes) {
    const selected = available[index];
    if (groups[selected.jid]) continue;
    const folder = uniqueFolder(selected.name, groups);
    groups[selected.jid] = createSafeGroup(selected.name, folder);
    fs.mkdirSync(path.join(GROUPS_DIR, folder, 'logs'), { recursive: true, mode: 0o700 });
    added += 1;
  }

  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  saveJson(configPath, groups);
  fs.chmodSync(configPath, 0o600);

  console.log(`\nSaved ${Object.keys(groups).length} group(s); ${added} added.`);
  console.log('New groups start in observation mode with only the no-spam guard enabled.');
  console.log('No message will be deleted until you unlock enforcement outside WhatsApp.\n');
  setTimeout(() => process.exit(0), 100);
}

main().catch((error) => {
  console.error(`\nGroup setup failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
