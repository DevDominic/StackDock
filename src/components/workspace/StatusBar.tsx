import type { ReactNode } from 'react';
import type { ExtensionStatusBarContribution } from '../../shared/types';
import type { NativeExtension, WorkspaceExtensionContext } from '../../extensions/extensionTypes';

interface Props {
  contributions: ExtensionStatusBarContribution[];
  ctx: WorkspaceExtensionContext;
  nativeExtensions: Map<string, NativeExtension>;
}

function renderContribution(contribution: ExtensionStatusBarContribution, ctx: WorkspaceExtensionContext, nativeExtensions: Map<string, NativeExtension>): ReactNode {
  const native = nativeExtensions.get(contribution.extensionId);
  if (contribution.native && native?.renderStatusBar) return native.renderStatusBar(contribution, ctx);
  if (contribution.label) return <span className="statusbar-item" title={contribution.tooltip}>{contribution.label}</span>;
  return null;
}

export function StatusBar({ contributions, ctx, nativeExtensions }: Props) {
  const left = contributions.filter((item) => item.side === 'left');
  const right = contributions.filter((item) => item.side === 'right');
  return (
    <footer className="statusbar">
      <div className="statusbar-left">
        {left.map((item) => {
          const node = renderContribution(item, ctx, nativeExtensions);
          return node ? <span key={item.id} className="statusbar-slot">{node}</span> : null;
        })}
      </div>
      <div className="statusbar-right">
        {right.map((item) => {
          const node = renderContribution(item, ctx, nativeExtensions);
          return node ? <span key={item.id} className="statusbar-slot">{node}</span> : null;
        })}
      </div>
    </footer>
  );
}
