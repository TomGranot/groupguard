#!/usr/bin/env node
import { setEnforcementMode } from '../src/groupguard/operations.js';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const groupId = argument('--group');
const mode = process.argv.includes('--enable') ? 'enable' : process.argv.includes('--observe') ? 'observe' : undefined;
if (!groupId || !mode) {
  console.error('Usage: pnpm groupguard:enforcement -- --group <WhatsApp-group-JID> (--observe | --enable)');
  process.exitCode = 1;
} else {
  try {
    const result = await setEnforcementMode({ projectRoot: process.cwd(), groupId, mode });
    console.log(
      result.mode === 'enabled' ? 'Moderation enforcement enabled.' : 'Observation mode enabled; the timer restarted.',
    );
    console.log('Restart GroupGuard to apply the change.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Could not change enforcement mode');
    process.exitCode = 1;
  }
}
