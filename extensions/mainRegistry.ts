import type { StackDockSettings, TerminalProfile } from '../src/shared/types';
import type { TerminalCommandIntegration } from '../electron/terminalIntegration';
import { piExtensionManifest } from './builtin/pi/manifest';
import { createPiTerminalIntegration, piTerminalProfile } from './builtin/pi/main/terminalIntegration';

function extensionEnabled(settings: StackDockSettings, extensionId: string, defaultEnabled = false) {
  let enabled = defaultEnabled;
  if (settings.extensions.enabled.includes(extensionId)) enabled = true;
  if (settings.extensions.disabled.includes(extensionId)) enabled = false;
  return enabled;
}

export function getBundledTerminalProfiles(): TerminalProfile[] {
  return [piTerminalProfile];
}

export function getEnabledTerminalIntegrations(settings: StackDockSettings): TerminalCommandIntegration[] {
  return [
    ...(extensionEnabled(settings, piExtensionManifest.id, piExtensionManifest.defaultEnabled === true) ? [createPiTerminalIntegration(settings)] : []),
  ];
}
