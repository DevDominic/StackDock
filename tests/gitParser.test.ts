import { describe, expect, it } from 'vitest';
import { parseStatusLine } from '../extensions/builtin/git/main/gitParser';

describe('parseStatusLine', () => {
  it('parses unstaged modified', () => expect(parseStatusLine(' M README.md')).toMatchObject({ path: 'README.md', staged: false, unstaged: true, untracked: false }));
  it('parses staged modified', () => expect(parseStatusLine('M  README.md')).toMatchObject({ path: 'README.md', staged: true, unstaged: false, untracked: false }));
  it('parses added', () => expect(parseStatusLine('A  src/a.ts')).toMatchObject({ path: 'src/a.ts', staged: true, unstaged: false, untracked: false }));
  it('parses deleted', () => expect(parseStatusLine(' D old.txt')).toMatchObject({ path: 'old.txt', staged: false, unstaged: true, untracked: false }));
  it('parses rename', () => expect(parseStatusLine('R  old.txt -> new.txt')).toMatchObject({ path: 'new.txt', staged: true, unstaged: false, untracked: false, conflicted: false }));
  it('parses untracked', () => expect(parseStatusLine('?? new.txt')).toMatchObject({ path: 'new.txt', staged: false, unstaged: true, untracked: true, conflicted: false }));
  it('parses both modified conflict', () => expect(parseStatusLine('UU src/app.ts')).toMatchObject({ path: 'src/app.ts', staged: false, unstaged: true, untracked: false, conflicted: true, conflictStatus: 'UU' }));
  it('parses both added conflict', () => expect(parseStatusLine('AA src/app.ts')).toMatchObject({ conflicted: true, conflictStatus: 'AA' }));
  it('parses deleted by us conflict', () => expect(parseStatusLine('DU src/app.ts')).toMatchObject({ conflicted: true, conflictStatus: 'DU' }));
});
