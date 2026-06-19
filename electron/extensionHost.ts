import path from 'path';
import { pathToFileURL } from 'url';
import type { ExtensionManifest } from '../src/shared/types';

export type ExtensionRpcHandler = (...args: unknown[]) => unknown | Promise<unknown>;
export interface ExtensionMainContext {
  extensionId: string;
  manifest: ExtensionManifest;
  subscriptions: Array<{ dispose(): void }>;
  rpc: { handle(command: string, handler: ExtensionRpcHandler): void };
  workspaceTrust: { requireTrusted(reason: string): void };
}

export interface ExtensionMainModule {
  activateMain?(ctx: ExtensionMainContext): void | Promise<void>;
}

export class ExtensionHost {
  private handlers = new Map<string, ExtensionRpcHandler>();
  private active = new Set<string>();
  private subscriptions = new Map<string, Array<{ dispose(): void }>>();

  async activateBundledExtensions(manifests: ExtensionManifest[]) {
    this.disposeAll();
    for (const manifest of manifests) {
      if (manifest.source !== 'bundled' || !manifest.main) continue;
      await this.activateBundledExtension(manifest);
    }
  }

  registerRpcHandler(extensionId: string, command: string, handler: ExtensionRpcHandler) {
    if (!extensionId.trim()) throw new Error('extensionId must be non-empty');
    if (!command.trim()) throw new Error('command must be non-empty');
    const key = this.key(extensionId, command);
    if (this.handlers.has(key)) throw new Error(`RPC handler already registered: ${extensionId}/${command}`);
    this.handlers.set(key, handler);
    this.active.add(extensionId);
  }

  async invoke(extensionId: string, command: string, args: unknown[] = []) {
    if (!this.active.has(extensionId)) throw new Error(`Extension is not active: ${extensionId}`);
    const handler = this.handlers.get(this.key(extensionId, command));
    if (!handler) throw new Error(`Unknown extension RPC command: ${extensionId}/${command}`);
    return handler(...args);
  }

  disposeAll() {
    for (const [extensionId, subscriptions] of this.subscriptions) {
      for (const subscription of subscriptions.splice(0)) subscription.dispose();
      for (const key of [...this.handlers.keys()]) if (key.startsWith(`${extensionId}:`)) this.handlers.delete(key);
    }
    this.subscriptions.clear();
    this.handlers.clear();
    this.active.clear();
  }

  private async activateBundledExtension(manifest: ExtensionManifest) {
    const modulePath = this.resolveMainModulePath(manifest);
    const mod = await import(modulePath) as ExtensionMainModule;
    if (!mod.activateMain) return;
    const subscriptions: Array<{ dispose(): void }> = [];
    this.subscriptions.set(manifest.id, subscriptions);
    const ctx: ExtensionMainContext = {
      extensionId: manifest.id,
      manifest,
      subscriptions,
      rpc: { handle: (command, handler) => this.registerRpcHandler(manifest.id, command, handler) },
      workspaceTrust: { requireTrusted: () => undefined },
    };
    await mod.activateMain(ctx);
    this.active.add(manifest.id);
  }

  private resolveMainModulePath(manifest: ExtensionManifest) {
    if (!manifest.packagePath || !manifest.main) throw new Error(`Missing main entry for ${manifest.id}`);
    const entry = manifest.main.replace(/^\.\//, '');
    const distRoot = path.resolve(__dirname, '..');
    const packagePath = path.resolve(manifest.packagePath);
    const relativeToDist = path.relative(distRoot, packagePath);
    const compiledRoot = !relativeToDist.startsWith('..') && !path.isAbsolute(relativeToDist)
      ? packagePath
      : path.resolve(distRoot, path.relative(process.cwd(), packagePath));
    return pathToFileURL(path.join(compiledRoot, `${entry}.js`)).href;
  }

  private key(extensionId: string, command: string) {
    return `${extensionId}:${command}`;
  }
}
