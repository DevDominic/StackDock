import type { ExtensionManifest, ExtensionTerminalCommandHookContribution, StackDockSettings, TerminalProfile } from '../src/shared/types';
import type { TerminalCommandHookContext, TerminalCommandIntegration } from '../electron/terminalIntegration';
import { getLoadedExtensionManifests } from '../electron/extensionService';
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

function renderHookTemplate(template: string, command: string, ctx: TerminalCommandHookContext) {
  return template.replace(/\$\{(command|restoreId|cwd|name)\}/g, (_match, key: string) => {
    if (key === 'command') return command;
    if (key === 'restoreId') return ctx.restoreId;
    if (key === 'cwd') return ctx.cwd;
    if (key === 'name') return ctx.name ?? '';
    return '';
  });
}

function createDeclarativeTerminalIntegration(manifest: ExtensionManifest, hook: ExtensionTerminalCommandHookContribution): TerminalCommandIntegration {
  return {
    id: `${manifest.id}.${hook.id}`,
    beforeShellCommand(command, ctx) {
      if (hook.sources && !hook.sources.includes(ctx.source)) return undefined;
      if (!new RegExp(hook.match).test(command)) return undefined;
      const append = renderHookTemplate(hook.appendArgs, command, ctx).trim();
      return { command: append ? `${command.trim()} ${append}` : command };
    },
  };
}

export function getEnabledTerminalIntegrations(settings: StackDockSettings): TerminalCommandIntegration[] {
  const integrations: TerminalCommandIntegration[] = [
    ...(extensionEnabled(settings, piExtensionManifest.id, piExtensionManifest.defaultEnabled === true) ? [createPiTerminalIntegration(settings)] : []),
  ];
  for (const manifest of getLoadedExtensionManifests()) {
    if (manifest.source !== 'local') continue;
    if (!extensionEnabled(settings, manifest.id, manifest.defaultEnabled === true)) continue;
    for (const hook of manifest.contributes?.terminalCommandHooks ?? []) integrations.push(createDeclarativeTerminalIntegration(manifest, hook));
  }
  return integrations;
}
