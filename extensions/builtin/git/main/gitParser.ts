export interface ParsedGitFileStatus {
  path: string;
  indexStatus: string;
  worktreeStatus: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
}

export function parseStatusLine(line: string): ParsedGitFileStatus | null {
  if (line.startsWith('?? ')) {
    const filePath = line.slice(3).trim();
    return { path: filePath, indexStatus: '?', worktreeStatus: '?', staged: false, unstaged: true, untracked: true };
  }
  if (line.length < 4) return null;
  const indexStatus = line[0] ?? ' ';
  const worktreeStatus = line[1] ?? ' ';
  let filePath = line.slice(3).trim();
  if (filePath.includes(' -> ')) filePath = filePath.split(' -> ').pop() ?? filePath;
  return { path: filePath, indexStatus, worktreeStatus, staged: indexStatus !== ' ', unstaged: worktreeStatus !== ' ', untracked: false };
}
