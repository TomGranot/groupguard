#!/usr/bin/env node
import path from 'node:path';

import { createInitialConfig } from '../src/groupguard/operations.js';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const groupId = argument('--group');
if (!groupId) {
  console.error('Usage: pnpm groupguard:init -- --group <WhatsApp-group-JID>');
  process.exitCode = 1;
} else {
  try {
    const result = await createInitialConfig({ projectRoot: process.cwd(), groupId });
    console.log(`Created ${path.relative(process.cwd(), result.configPath)} with one allowlisted group.`);
    console.log('GroupGuard starts in observation mode. Edit the taxonomy and directory files, then run the doctor.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Could not initialize GroupGuard');
    process.exitCode = 1;
  }
}
