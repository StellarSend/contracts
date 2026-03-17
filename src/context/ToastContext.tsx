'use client';
import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import styles from './ToastContext.module.css';

type ToastType = 'success' | 'error' | 'info' | 'warning';

interface Toast { id: string; message: string; type: ToastType; }

interface ToastCtx {
  success: (msg: string) => void;
  error:   (msg: string) => void;
  info:    (msg: string) => void;
}

const Ctx = createContext<ToastCtx | null>(null);
let counter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const add = useCallback((message: string, type: ToastType) => {
    const id = `t-${++counter}`;
    setToasts(ts => [...ts, { id, message, type }]);
    setTimeout(() => setToasts(ts => ts.filter(t => t.id !== id)), 4000);
  }, []);

  return (
    <Ctx.Provider value={{
      success: m => add(m, 'success'),
      error:   m => add(m, 'error'),
      info:    m => add(m, 'info'),
    }}>
      {children}
      <div className={styles.container} aria-live="polite">
        {toasts.map(t => (
          <div key={t.id} className={`${styles.toast} ${styles[t.type]}`}>
            {t.message}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useToast must be inside ToastProvider');
  return ctx;
};
