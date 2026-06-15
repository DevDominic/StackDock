import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => 'C:\\Users\\domin\\AppData\\Roaming' },
  shell: { openExternal: vi.fn() },
  BrowserWindow: class {},
}));

import { getBridgeEnv, startBrowserBridge, stopBrowserBridge } from '../electron/browserBridge';

afterEach(async () => {
  await stopBrowserBridge();
});

describe('browser bridge env', () => {
  it('gives Plannotator an executable helper path without inline arguments', async () => {
    await startBrowserBridge();

    const env = getBridgeEnv('session-1');

    if (process.platform === 'win32') {
      expect(env.PLANNOTATOR_BROWSER).toMatch(/open-url\.vbs$/);
      expect(env.BROWSER).toMatch(/open-url\.cmd$/);
      expect(env.PLANNOTATOR_BROWSER).not.toBe(env.BROWSER);
    } else {
      expect(env.PLANNOTATOR_BROWSER).toBe(env.BROWSER);
      expect(env.PLANNOTATOR_BROWSER).toMatch(/open-url\.sh$/);
    }
    expect(env.PLANNOTATOR_BROWSER).not.toContain('wscript.exe');
    expect(env.PLANNOTATOR_BROWSER).not.toContain('//B');
    expect(env.PLANNOTATOR_BROWSER).not.toContain('//Nologo');
  });
});
