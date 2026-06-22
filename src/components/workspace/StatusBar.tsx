import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ExtensionStatusBarContribution } from '../../shared/types';
import type { NativeExtension, WorkspaceExtensionContext } from '../../extensions/extensionTypes';
import { ExtensionFrame } from '../../extensions/ExtensionFrame';

interface Props {
  contributions: ExtensionStatusBarContribution[];
  ctx: WorkspaceExtensionContext;
  nativeExtensions: Map<string, NativeExtension>;
}

function LocalStatusBarContribution({ contribution, ctx }: { contribution: ExtensionStatusBarContribution; ctx: WorkspaceExtensionContext }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!contribution.entry) return <span className="statusbar-item" title={contribution.tooltip}>{contribution.label}</span>;
  return (
    <span className="statusbar-popover-host" ref={ref}>
      <button className="statusbar-item" type="button" title={contribution.tooltip} onClick={() => setOpen((value) => !value)}>
        {contribution.label ?? contribution.id}
      </button>
      {open ? (
        <div className={`statusbar-popover ${contribution.side === 'right' ? 'align-right' : 'align-left'}`}>
          <ExtensionFrame contribution={contribution} ctx={ctx} className="statusbar-extension-frame" />
        </div>
      ) : null}
    </span>
  );
}

function renderContribution(contribution: ExtensionStatusBarContribution, ctx: WorkspaceExtensionContext, nativeExtensions: Map<string, NativeExtension>): ReactNode {
  const native = nativeExtensions.get(contribution.extensionId);
  if (contribution.native && native?.renderStatusBar) return native.renderStatusBar(contribution, ctx);
  if (contribution.label || contribution.entry) return <LocalStatusBarContribution contribution={contribution} ctx={ctx} />;
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
