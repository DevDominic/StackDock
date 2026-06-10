export interface TerminalStartupCommandInput {
  explicitStartupCommand?: string;
  profileStartupCommand?: string;
  workspaceStartupCommand?: string;
}

function nonEmpty(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function resolveTerminalStartupCommand(input: TerminalStartupCommandInput): string | undefined {
  return nonEmpty(input.explicitStartupCommand)
    ?? nonEmpty(input.profileStartupCommand)
    ?? nonEmpty(input.workspaceStartupCommand);
}
