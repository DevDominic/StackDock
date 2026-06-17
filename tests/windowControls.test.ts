import { describe, expect, it } from 'vitest';
import { getWindowControlsConfig, normalizeWindowPlatform } from '../src/shared/windowControls';

describe('window controls platform helpers', () => {
  it('normalizes known Electron platforms', () => {
    expect(normalizeWindowPlatform('win32')).toBe('windows');
    expect(normalizeWindowPlatform('darwin')).toBe('macos');
    expect(normalizeWindowPlatform('linux')).toBe('linux');
    expect(normalizeWindowPlatform('sunos')).toBe('other');
  });

  it('uses native right-side Windows controls on Windows 11 or newer', () => {
    expect(getWindowControlsConfig('win32', '10.0.22631')).toEqual({ platform: 'windows', style: 'native', position: 'right', variant: 'windows' });
  });

  it('uses custom right-side Windows controls on older Windows', () => {
    expect(getWindowControlsConfig('win32', '10.0.19045')).toEqual({ platform: 'windows', style: 'custom', position: 'right', variant: 'windows' });
  });

  it('uses custom left-side traffic-light controls on macOS', () => {
    expect(getWindowControlsConfig('darwin', '23.0.0')).toEqual({ platform: 'macos', style: 'custom', position: 'left', variant: 'macos' });
  });

  it('uses native Linux controls so desktop environments draw matching window buttons', () => {
    expect(getWindowControlsConfig('linux', '6.8.0')).toEqual({ platform: 'linux', style: 'native', position: 'right', variant: 'windows' });
  });

  it('uses custom right-side controls on unknown platforms', () => {
    expect(getWindowControlsConfig('freebsd', '14.0')).toEqual({ platform: 'other', style: 'custom', position: 'right', variant: 'windows' });
  });
});
