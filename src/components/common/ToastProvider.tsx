import { createContext, useContext, useMemo, useState } from 'react';

type ToastType = 'info' | 'error' | 'success';
interface Toast { id: string; message: string; type: ToastType; }
const ToastContext = createContext<{ showToast(message: string, type?: ToastType): void } | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const value = useMemo(() => ({ showToast(message: string, type: ToastType = 'info') {
    const id = crypto.randomUUID();
    setToasts((current) => [...current, { id, message, type }]);
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 4000);
  } }), []);
  return <ToastContext.Provider value={value}>{children}<div className="toast-stack">{toasts.map((toast) => <div key={toast.id} className={`toast ${toast.type}`}><span>{toast.message}</span><button className="ghost" onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))}>×</button></div>)}</div></ToastContext.Provider>;
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
