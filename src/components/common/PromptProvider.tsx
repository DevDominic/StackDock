import { createContext, useCallback, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';

type PromptKind = 'confirm' | 'input';

interface BasePromptOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  icon?: string;
}

interface ConfirmPromptOptions extends BasePromptOptions {}

interface InputPromptOptions extends BasePromptOptions {
  defaultValue?: string;
  placeholder?: string;
}

interface PromptRequest<T> {
  id: string;
  kind: PromptKind;
  options: ConfirmPromptOptions | InputPromptOptions;
  resolve(value: T): void;
}

interface PromptContextValue {
  confirm(options: ConfirmPromptOptions | string): Promise<boolean>;
  input(options: InputPromptOptions | string, defaultValue?: string): Promise<string | null>;
}

const PromptContext = createContext<PromptContextValue | null>(null);

function normalizeConfirm(options: ConfirmPromptOptions | string): ConfirmPromptOptions {
  if (typeof options === 'string') return { title: options };
  return options;
}

function normalizeInput(options: InputPromptOptions | string, defaultValue?: string): InputPromptOptions {
  if (typeof options === 'string') return { title: options, defaultValue };
  return options;
}

export function usePromptDialog() {
  const context = useContext(PromptContext);
  if (!context) throw new Error('usePromptDialog must be used inside PromptProvider');
  return context;
}

export function PromptProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<PromptRequest<boolean | string | null>[]>([]);
  const active = queue[0] ?? null;
  const inputRef = useRef<HTMLInputElement | null>(null);

  const enqueue = useCallback(<T,>(kind: PromptKind, options: ConfirmPromptOptions | InputPromptOptions) => new Promise<T>((resolve) => {
    setQueue((current) => [...current, { id: crypto.randomUUID(), kind, options, resolve: resolve as PromptRequest<boolean | string | null>['resolve'] }]);
  }), []);

  const confirm = useCallback((options: ConfirmPromptOptions | string) => enqueue<boolean>('confirm', normalizeConfirm(options)), [enqueue]);
  const input = useCallback((options: InputPromptOptions | string, defaultValue?: string) => enqueue<string | null>('input', normalizeInput(options, defaultValue)), [enqueue]);

  const close = useCallback((value: boolean | string | null) => {
    setQueue((current) => {
      const [request, ...rest] = current;
      request?.resolve(value);
      return rest;
    });
  }, []);

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(active.kind === 'confirm' ? false : null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, close]);

  useEffect(() => {
    if (active?.kind === 'input') inputRef.current?.focus();
  }, [active]);

  return (
    <PromptContext.Provider value={{ confirm, input }}>
      {children}
      {active ? <PromptDialog request={active} inputRef={inputRef} onClose={close} /> : null}
    </PromptContext.Provider>
  );
}

function PromptDialog({ request, inputRef, onClose }: { request: PromptRequest<boolean | string | null>; inputRef: React.RefObject<HTMLInputElement>; onClose(value: boolean | string | null): void }) {
  const options = request.options;
  const [value, setValue] = useState(request.kind === 'input' ? (options as InputPromptOptions).defaultValue ?? '' : '');
  const lines = options.message?.split('\n').filter((line) => line.length) ?? [];
  const confirmLabel = options.confirmLabel ?? (request.kind === 'input' ? 'Submit' : 'Confirm');
  const cancelLabel = options.cancelLabel ?? 'Cancel';
  const icon = options.icon ?? (options.danger ? '!' : request.kind === 'input' ? '✎' : '?');

  function submit(event: FormEvent) {
    event.preventDefault();
    if (request.kind === 'input') onClose(value);
    else onClose(true);
  }

  return (
    <div className="modal-backdrop prompt-backdrop" onMouseDown={() => onClose(request.kind === 'confirm' ? false : null)}>
      <form className={`prompt-dialog${options.danger ? ' danger' : ''}`} role="dialog" aria-modal="true" aria-labelledby="prompt-title" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
        <div className="prompt-dialog-head">
          <span className="prompt-dialog-icon" aria-hidden>{icon}</span>
          <div>
            <h3 id="prompt-title">{options.title}</h3>
            {lines.length ? <div className="prompt-dialog-message">{lines.map((line) => <p key={line}>{line}</p>)}</div> : null}
          </div>
        </div>
        {request.kind === 'input' ? (
          <input ref={inputRef} value={value} onChange={(event) => setValue(event.target.value)} placeholder={(options as InputPromptOptions).placeholder} />
        ) : null}
        <div className="modal-actions prompt-dialog-actions">
          <button type="button" className="ghost" onClick={() => onClose(request.kind === 'confirm' ? false : null)}>{cancelLabel}</button>
          <button type="submit" className={options.danger ? 'primary danger-action' : 'primary'} autoFocus={request.kind === 'confirm'}>{confirmLabel}</button>
        </div>
      </form>
    </div>
  );
}
