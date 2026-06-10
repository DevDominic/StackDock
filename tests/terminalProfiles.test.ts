import { describe, expect, it } from 'vitest';
import { resolveTerminalStartupCommand } from '../src/shared/terminalProfiles';

describe('terminal profile startup command precedence', () => {
  it('uses explicit command before profile and workspace commands', () => {
    expect(resolveTerminalStartupCommand({ explicitStartupCommand: 'npm run dev', profileStartupCommand: 'pi', workspaceStartupCommand: 'nvm use' })).toBe('npm run dev');
  });

  it('uses profile startup before workspace new-session command', () => {
    expect(resolveTerminalStartupCommand({ profileStartupCommand: 'pi', workspaceStartupCommand: 'nvm use' })).toBe('pi');
  });

  it('uses workspace command when profile startup is empty or missing', () => {
    expect(resolveTerminalStartupCommand({ profileStartupCommand: '   ', workspaceStartupCommand: 'nvm use' })).toBe('nvm use');
    expect(resolveTerminalStartupCommand({ workspaceStartupCommand: 'npm install' })).toBe('npm install');
  });

  it('treats empty and whitespace values as missing', () => {
    expect(resolveTerminalStartupCommand({ explicitStartupCommand: '', profileStartupCommand: '  ', workspaceStartupCommand: '\t' })).toBeUndefined();
  });
});
