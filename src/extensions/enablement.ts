import type { ExtensionManifest, ExtensionStatusBarContribution, ExtensionViewContribution, StackDockSettings, WorkspaceExtensionState } from '../shared/types';
import type { WorkspaceExtensionContext } from './extensionTypes';

export function resolveEnabledExtensions(manifests: ExtensionManifest[], settings?: StackDockSettings | null, workspace?: WorkspaceExtensionState): ExtensionManifest[] {
  return manifests.filter((manifest) => {
    let enabled = manifest.defaultEnabled === true;
    if (settings?.extensions.enabled.includes(manifest.id)) enabled = true;
    if (settings?.extensions.disabled.includes(manifest.id)) enabled = false;
    if (workspace?.enabled?.includes(manifest.id)) enabled = true;
    if (workspace?.disabled?.includes(manifest.id)) enabled = false;
    return enabled;
  });
}

function matchesWhen(when: 'always' | 'gitRepo' | 'headlessActive' | undefined, ctx: WorkspaceExtensionContext) {
  return !when || when === 'always' || (when === 'gitRepo' && ctx.isRepo) || (when === 'headlessActive' && ctx.headlessRuns.length > 0);
}

export function getEnabledViewContributions(manifests: ExtensionManifest[], location: ExtensionViewContribution['location'], ctx: WorkspaceExtensionContext): ExtensionViewContribution[] {
  return manifests.flatMap((manifest) => manifest.contributes?.views ?? []).filter((view) => view.location === location && matchesWhen(view.when, ctx)).sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}

export function getEnabledStatusBarContributions(manifests: ExtensionManifest[], ctx: WorkspaceExtensionContext): ExtensionStatusBarContribution[] {
  return manifests.flatMap((manifest) => manifest.contributes?.statusBar ?? []).filter((item) => matchesWhen(item.when, ctx)).sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}
