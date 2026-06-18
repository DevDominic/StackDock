export interface ParsedGitFileStatus {
  path: string;
  indexStatus: string;
  worktreeStatus: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  conflicted: boolean;
  conflictStatus?: string;
}

const unmergedStatusCodes = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);

export function parseStatusLine(line: string): ParsedGitFileStatus | null {
  if (line.startsWith('?? ')) {
    const filePath = line.slice(3).trim();
    return { path: filePath, indexStatus: '?', worktreeStatus: '?', staged: false, unstaged: true, untracked: true, conflicted: false };
  }
  if (line.length < 4) return null;
  const indexStatus = line[0] ?? ' ';
  const worktreeStatus = line[1] ?? ' ';
  const statusCode = `${indexStatus}${worktreeStatus}`;
  let filePath = line.slice(3).trim();
  if (filePath.includes(' -> ')) filePath = filePath.split(' -> ').pop() ?? filePath;
  if (unmergedStatusCodes.has(statusCode)) return { path: filePath, indexStatus, worktreeStatus, staged: false, unstaged: true, untracked: false, conflicted: true, conflictStatus: statusCode };
  return { path: filePath, indexStatus, worktreeStatus, staged: indexStatus !== ' ', unstaged: worktreeStatus !== ' ', untracked: false, conflicted: false };
}
