import { describe, expect, it } from 'vitest';
import { ExtensionHost } from '../electron/extensionHost';

describe('ExtensionHost', () => {
  it('rejects duplicate command registration for one extension', () => {
    const host = new ExtensionHost();
    host.registerRpcHandler('one', 'status', () => null);
    expect(() => host.registerRpcHandler('one', 'status', () => null)).toThrow('RPC handler already registered');
  });

  it('allows same command name under different extension IDs', async () => {
    const host = new ExtensionHost();
    host.registerRpcHandler('one', 'status', () => 1);
    host.registerRpcHandler('two', 'status', () => 2);
    await expect(host.invoke('one', 'status')).resolves.toBe(1);
    await expect(host.invoke('two', 'status')).resolves.toBe(2);
  });

  it('returns clear error for unknown extension or command', async () => {
    const host = new ExtensionHost();
    await expect(host.invoke('missing', 'status')).rejects.toThrow('Extension is not active: missing');
    host.registerRpcHandler('one', 'status', () => null);
    await expect(host.invoke('one', 'missing')).rejects.toThrow('Unknown extension RPC command: one/missing');
  });

  it('cleanup removes handlers', async () => {
    const host = new ExtensionHost();
    host.registerRpcHandler('one', 'status', () => 1);
    host.disposeAll();
    await expect(host.invoke('one', 'status')).rejects.toThrow('Extension is not active: one');
  });
});
