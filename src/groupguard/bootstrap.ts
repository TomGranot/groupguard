import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { log } from '../log.js';
import { loadGroupGuardConfig, type GroupGuardConfig } from './config.js';
import { AtomicDirectoryStore, parseTaxonomy } from './directory/data.js';
import { OllamaCategoryClassifier } from './directory/ollama-classifier.js';
import { DirectoryResponder } from './directory/responder.js';
import { AccountSafetyController, EffectLedger } from './reliability/effects.js';
import { GroupGuardRuntime, type GroupGuardEvent, type GroupGuardRuntimeResult } from './runtime.js';

type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface GroupGuardServiceOptions {
  projectRoot: string;
  configPath: string;
  enforcementEnabled: boolean;
  sendMessage: (groupId: string, text: string) => Promise<string | undefined>;
  deleteMessage: (event: GroupGuardEvent) => Promise<void>;
  resolveAdminState: (event: GroupGuardEvent) => Promise<{ verified: boolean; senderIsAdmin: boolean }>;
  fetchImpl?: FetchImplementation;
}

function localPath(projectRoot: string, value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(projectRoot, value);
}

function sourcePath(projectRoot: string, value: string): string {
  return /^https?:\/\//iu.test(value) ? value : localPath(projectRoot, value);
}

export class GroupGuardService {
  readonly allowedGroups: ReadonlySet<string>;
  private readonly ledger: EffectLedger;
  private readonly runtime: GroupGuardRuntime;
  private readonly directoryStore: AtomicDirectoryStore | undefined;
  private readonly classifier: OllamaCategoryClassifier | undefined;
  private readonly refreshTimer: NodeJS.Timeout | undefined;
  private responder: DirectoryResponder | undefined;

  private constructor(
    config: GroupGuardConfig,
    ledger: EffectLedger,
    runtime: GroupGuardRuntime,
    store: AtomicDirectoryStore | undefined,
    classifier: OllamaCategoryClassifier | undefined,
    refreshTimer: NodeJS.Timeout | undefined,
    responder: DirectoryResponder | undefined,
  ) {
    this.allowedGroups = new Set(Object.keys(config.groups));
    this.ledger = ledger;
    this.runtime = runtime;
    this.directoryStore = store;
    this.classifier = classifier;
    this.refreshTimer = refreshTimer;
    this.responder = responder;
  }

  static async create(options: GroupGuardServiceOptions): Promise<GroupGuardService> {
    const config = await loadGroupGuardConfig(localPath(options.projectRoot, options.configPath));
    const ledgerPath = path.join(options.projectRoot, 'data', 'groupguard', 'effects.db');
    await mkdir(path.dirname(ledgerPath), { recursive: true });
    const ledger = new EffectLedger(ledgerPath);
    let store: AtomicDirectoryStore | undefined;
    let classifier: OllamaCategoryClassifier | undefined;
    let responder: DirectoryResponder | undefined;
    let refreshTimer: NodeJS.Timeout | undefined;

    if (config.directory) {
      const taxonomy = parseTaxonomy(
        JSON.parse(await readFile(localPath(options.projectRoot, config.directory.taxonomyPath), 'utf8')) as unknown,
      );
      classifier = new OllamaCategoryClassifier({
        baseUrl: config.directory.ollamaBaseUrl,
        model: config.directory.model,
        keepAlive: config.directory.keepAlive,
        fetchImpl: options.fetchImpl,
      });
      store = new AtomicDirectoryStore({
        source: sourcePath(options.projectRoot, config.directory.source),
        cachePath: localPath(options.projectRoot, config.directory.cachePath),
        taxonomy,
        fetchImpl: options.fetchImpl,
      });
      await store.loadCache();
      try {
        await store.refresh();
      } catch (error) {
        log.warn('GroupGuard directory refresh failed; keeping last valid snapshot', { error });
      }
      const current = store.current();
      if (current) {
        responder = new DirectoryResponder({
          taxonomy,
          snapshot: current,
          classifier,
          minimumConfidence: config.directory.minimumConfidence,
        });
      }
      await classifier.prewarm();
      const refresh = async () => {
        try {
          const snapshot = await store!.refresh();
          responder = new DirectoryResponder({
            taxonomy,
            snapshot,
            classifier: classifier!,
            minimumConfidence: config.directory!.minimumConfidence,
          });
          await classifier!.prewarm();
          log.info('GroupGuard directory snapshot refreshed', {
            version: snapshot.version,
            providerCount: snapshot.providers.length,
          });
        } catch (error) {
          log.warn('GroupGuard directory refresh failed; keeping last valid snapshot', { error });
        }
      };
      refreshTimer = setInterval(() => void refresh(), config.directory.refreshHours * 60 * 60_000);
      refreshTimer.unref();
    }

    const serviceReference: { current?: GroupGuardService } = {};
    const runtime = new GroupGuardRuntime({
      config,
      ledger,
      safety: new AccountSafetyController(config.accountSafety),
      directoryResponder: () => serviceReference.current?.responder,
      sendMessage: options.sendMessage,
      deleteMessage: options.deleteMessage,
      resolveAdminState: options.resolveAdminState,
      enforcementEnabled: options.enforcementEnabled,
    });
    const service = new GroupGuardService(config, ledger, runtime, store, classifier, refreshTimer, responder);
    serviceReference.current = service;
    return service;
  }

  handle(event: GroupGuardEvent): Promise<GroupGuardRuntimeResult> {
    return this.runtime.handle(event);
  }

  async health(): Promise<{
    configuredGroups: number;
    directoryReady: boolean;
    qwenReady: boolean;
    directoryVersion: string | null;
  }> {
    const qwenReady = this.classifier ? await this.classifier.prewarm() : true;
    return {
      configuredGroups: this.allowedGroups.size,
      directoryReady: !this.directoryStore || Boolean(this.directoryStore.current()),
      qwenReady,
      directoryVersion: this.directoryStore?.current()?.version ?? null,
    };
  }

  close(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.ledger.close();
  }
}
