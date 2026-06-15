import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

type ToastType = 'info' | 'error' | 'success';
interface Toast { id: string; message: ReactNode; type: ToastType; onClick?: () => void; }
interface ToastOptions { onClick?: () => void; }
const ToastContext = createContext<{ showToast(message: ReactNode, type?: ToastType, options?: ToastOptions): void } | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const value = useMemo(() => ({ showToast(message: ReactNode, type: ToastType = 'info', options?: ToastOptions) {
    const id = crypto.randomUUID();
    setToasts((current) => [...current, { id, message, type, onClick: options?.onClick }]);
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 4000);
  } }), []);
  return <ToastContext.Provider value={value}>{children}<div className="toast-stack">{toasts.map((toast) => <div key={toast.id} className={`toast ${toast.type}${toast.onClick ? ' clickable' : ''}`} onClick={toast.onClick}><span>{toast.message}</span><button className="ghost" onClick={(event) => { event.stopPropagation(); setToasts((current) => current.filter((item) => item.id !== toast.id)); }}>×</button></div>)}</div></ToastContext.Provider>;
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
