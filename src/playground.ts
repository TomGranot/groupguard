import { PlaygroundConfig } from './types.js';

export type PlaygroundCommand =
  | 'help'
  | 'try-no-links'
  | 'try-no-spam'
  | 'try-keyword'
  | 'protect';

export interface PlaygroundReply {
  command: PlaygroundCommand;
  text: string | null;
  outcome: 'served' | 'cooldown' | 'group-budget';
}

function normalize(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('en-US');
}

export function parsePlaygroundCommand(text: string, trigger: string): PlaygroundCommand | null {
  if (text.length === 0 || text.length > 80) return null;

  const normalizedText = normalize(text).replace(/\s+/g, ' ');
  const normalizedTrigger = normalize(trigger);
  const commands = new Map<string, PlaygroundCommand>([
    [`${normalizedTrigger} help`, 'help'],
    [`${normalizedTrigger} demo`, 'help'],
    [`${normalizedTrigger} try no-links`, 'try-no-links'],
    [`${normalizedTrigger} try no-spam`, 'try-no-spam'],
    [`${normalizedTrigger} try keyword`, 'try-keyword'],
    [`${normalizedTrigger} protect my group`, 'protect'],
  ]);
  return commands.get(normalizedText) || null;
}

function responseFor(command: PlaygroundCommand, trigger: string, setupUrl: string): string {
  switch (command) {
    case 'help':
      return [
        'GroupGuard Playground',
        `• ${trigger} try no-links`,
        `• ${trigger} try no-spam`,
        `• ${trigger} try keyword`,
        `• ${trigger} protect my group`,
        'This demo uses fixed commands. It never runs AI or sends private messages.',
      ].join('\n');
    case 'try-no-links':
      return [
        'Test result: BLOCKED by no-links.',
        'A new GroupGuard installation logs this in observation mode first. The admin can unlock deletion after reviewing the log.',
        `Next: ${trigger} protect my group`,
      ].join('\n');
    case 'try-no-spam':
      return [
        'Test result: the sixth message inside 10 seconds would be BLOCKED by no-spam.',
        'GroupGuard tracks each sender separately and caps account actions before it deletes anything.',
        `Next: ${trigger} protect my group`,
      ].join('\n');
    case 'try-keyword':
      return [
        'Test result: keyword-filter can block an admin-defined word list.',
        'Plain keywords are the safe default. Raw regular expressions need a local operator opt-in.',
        `Next: ${trigger} protect my group`,
      ].join('\n');
    case 'protect':
      return [
        'Protect your group with the safety-first setup:',
        setupUrl,
        'It starts in observation mode and needs no Docker or AI key.',
      ].join('\n');
  }
}

/**
 * Public demo responder with a per-sender cool-down. It accepts a small exact
 * command set and never passes visitor content to an agent or dynamic tool.
 */
export class PlaygroundResponder {
  private readonly lastResponseAt = new Map<string, number>();
  private readonly groupResponses = new Map<string, number[]>();

  respond(input: {
    chatJid: string;
    senderJid: string;
    text: string;
    trigger: string;
    config: PlaygroundConfig;
    now?: number;
  }): PlaygroundReply | null {
    const command = parsePlaygroundCommand(input.text, input.trigger);
    if (!command) return null;

    const now = input.now ?? Date.now();
    const key = `${input.chatJid}:${input.senderJid}`;
    const lastResponse = this.lastResponseAt.get(key) || 0;
    if (now - lastResponse < input.config.cooldownSeconds * 1_000) {
      return { command, text: null, outcome: 'cooldown' };
    }

    const windowStart = now - 60_000;
    const recentResponses = (this.groupResponses.get(input.chatJid) || [])
      .filter((timestamp) => timestamp > windowStart);
    if (recentResponses.length >= input.config.maxResponsesPerMinute) {
      this.groupResponses.set(input.chatJid, recentResponses);
      return { command, text: null, outcome: 'group-budget' };
    }

    this.lastResponseAt.set(key, now);
    if (this.lastResponseAt.size > 5_000) {
      const oldestKey = this.lastResponseAt.keys().next().value;
      if (oldestKey) this.lastResponseAt.delete(oldestKey);
    }
    recentResponses.push(now);
    this.groupResponses.set(input.chatJid, recentResponses);
    return {
      command,
      text: responseFor(command, input.trigger, input.config.setupUrl),
      outcome: 'served',
    };
  }
}
