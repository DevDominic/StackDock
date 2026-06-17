import type { WindowControlsConfig, WindowPlatform } from './types';

export function normalizeWindowPlatform(platform: string): WindowPlatform {
  if (platform === 'win32') return 'windows';
  if (platform === 'darwin') return 'macos';
  if (platform === 'linux') return 'linux';
  return 'other';
}

export function isWindows11OrNewer(platform: string, release: string): boolean {
  if (platform !== 'win32') return false;
  const build = Number(release.split('.')[2] ?? 0);
  return build >= 22000;
}

export function getWindowControlsConfig(platform: string, release: string): WindowControlsConfig {
  const normalizedPlatform = normalizeWindowPlatform(platform);
  if (isWindows11OrNewer(platform, release)) return { platform: 'windows', style: 'native', position: 'right', variant: 'windows' };
  if (normalizedPlatform === 'macos') return { platform: 'macos', style: 'custom', position: 'left', variant: 'macos' };
  if (normalizedPlatform === 'linux') return { platform: 'linux', style: 'native', position: 'right', variant: 'windows' };
  return { platform: normalizedPlatform, style: 'custom', position: 'right', variant: 'windows' };
}
