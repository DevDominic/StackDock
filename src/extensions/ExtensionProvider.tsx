import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import type { ExtensionListResult } from '../shared/types';
import type { NativeExtension } from './extensionTypes';
import { getNativeExtensions } from './registry';

interface ExtensionProviderValue extends ExtensionListResult { nativeExtensions: Map<string, NativeExtension>; reloadExtensions(): Promise<void>; }
const ExtensionContext = createContext<ExtensionProviderValue | null>(null);

export function ExtensionProvider({ children }: { children: ReactNode }) {
  const [result, setResult] = useState<ExtensionListResult>({ extensions: getNativeExtensions().map((item) => item.manifest), errors: [] });
  const native = useMemo(() => new Map(getNativeExtensions().map((item) => [item.manifest.id, item])), []);
  async function reloadExtensions() { setResult(await api.extensions.list()); }
  useEffect(() => { void reloadExtensions(); }, []);
  return <ExtensionContext.Provider value={{ ...result, nativeExtensions: native, reloadExtensions }}>{children}</ExtensionContext.Provider>;
}

export function useExtensions() {
  const ctx = useContext(ExtensionContext);
  if (!ctx) throw new Error('useExtensions must be used inside ExtensionProvider');
  return ctx;
}
