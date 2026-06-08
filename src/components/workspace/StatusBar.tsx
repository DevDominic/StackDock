import type { ReactNode } from 'react';
import type { GitStatus, Workspace } from '../../shared/types';

// Shared data + actions handed to every status-bar widget. Extend this as more
// signals become available (active terminal, language server, harness output…).
export interface StatusBarContext {
  git: GitStatus | null;
  workspace: Workspace;
  actions: {
    openGit(): void;
    revealFolder(): void;
  };
}

// A status-bar widget is just an id, a side, an order, and a render function.
// Built-ins live below; plugins / CLI harnesses (e.g. pi.dev) can register their
// own via registerStatusBarWidget() to surface custom status lines.
export interface StatusBarWidget {
  id: string;
  side: 'left' | 'right';
  order?: number;
  render(ctx: StatusBarContext): ReactNode;
}

const gitWidget: StatusBarWidget = {
  id: 'git',
  side: 'left',
  order: 10,
  render: ({ git, actions }) => {
    if (!git?.isRepo) return null;
    const ahead = git.ahead ?? 0;
    const behind = git.behind ?? 0;
    return (
      <button className="statusbar-item" onClick={actions.openGit} title={`${git.files.length} changed file(s) — open Source Control`}>
        <span className="statusbar-icon" aria-hidden>⎇</span>
        <span className="statusbar-branch">{git.branch ?? 'no branch'}</span>
        {behind > 0 ? <span className="statusbar-sync" title={`${behind} behind`}>↓{behind}</span> : null}
        {ahead > 0 ? <span className="statusbar-sync" title={`${ahead} ahead`}>↑{ahead}</span> : null}
        <span className="statusbar-dirty">{git.files.length}</span>
      </button>
    );
  },
};

const workspaceWidget: StatusBarWidget = {
  id: 'workspace',
  side: 'right',
  order: 10,
  render: ({ workspace, actions }) => (
    <button className="statusbar-item" onClick={actions.revealFolder} title={`${workspace.path} — reveal in file explorer`}>
      <span className="statusbar-icon" aria-hidden>📁</span>
      <span className="statusbar-ws-name">{workspace.name}</span>
      <span className="statusbar-ws-path muted">{workspace.path}</span>
    </button>
  ),
};

const builtinWidgets: StatusBarWidget[] = [gitWidget, workspaceWidget];
const externalWidgets: StatusBarWidget[] = [];

/** Register an additional status-bar widget (extension point for plugins / harnesses). */
export function registerStatusBarWidget(widget: StatusBarWidget) {
  const index = externalWidgets.findIndex((item) => item.id === widget.id);
  if (index >= 0) externalWidgets[index] = widget;
  else externalWidgets.push(widget);
}

function getStatusBarWidgets(): StatusBarWidget[] {
  return [...builtinWidgets, ...externalWidgets].sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}

interface Props {
  git: GitStatus | null;
  workspace: Workspace;
  actions: StatusBarContext['actions'];
}

export function StatusBar({ git, workspace, actions }: Props) {
  const ctx: StatusBarContext = { git, workspace, actions };
  const widgets = getStatusBarWidgets();
  const left = widgets.filter((widget) => widget.side === 'left');
  const right = widgets.filter((widget) => widget.side === 'right');
  return (
    <footer className="statusbar">
      <div className="statusbar-left">
        {left.map((widget) => {
          const node = widget.render(ctx);
          return node ? <span key={widget.id} className="statusbar-slot">{node}</span> : null;
        })}
      </div>
      <div className="statusbar-right">
        {right.map((widget) => {
          const node = widget.render(ctx);
          return node ? <span key={widget.id} className="statusbar-slot">{node}</span> : null;
        })}
      </div>
    </footer>
  );
}
