import fs from 'fs/promises';
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

    expect(env.STACKDOCK_BRIDGE_PORT).toMatch(/^\d+$/);
    expect(env.STACKDOCK_BRIDGE_TOKEN).toBeTruthy();
    expect(env.STACKDOCK_SESSION_ID).toBe('session-1');

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

  it('writes a standalone Plannotator helper script that posts to StackDock and falls back safely', async () => {
    await startBrowserBridge();

    const env = getBridgeEnv('session-1');
    const helperScript = await fs.readFile(env.PLANNOTATOR_BROWSER, 'utf8');

    expect(helperScript).toContain('/open-url');

    if (process.platform === 'win32') {
      expect(helperScript).toContain('MSXML2.ServerXMLHTTP.6.0');
      expect(helperScript).toContain('STACKDOCK_BRIDGE_PORT');
      expect(helperScript).toContain('STACKDOCK_BRIDGE_TOKEN');
      expect(helperScript).toContain('STACKDOCK_SESSION_ID');
      expect(helperScript).toContain('rundll32 url.dll,FileProtocolHandler');
    } else {
      expect(helperScript).toMatch(/^#!\/bin\/sh/);
      expect(helperScript).toMatch(/xdg-open|open/);
    }
  });
});
