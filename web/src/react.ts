import { createContext, createElement, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Params, StringCast, PluralValue } from './types';

interface Ctx {
  client: StringCast;
  revision: number;
}

const StringCastContext = createContext<Ctx | null>(null);

export interface StringCastProviderProps {
  /** An instance from `createStringCast(...)`. Create it once, outside render. */
  client: StringCast;
  children?: ReactNode;
}

/** Makes `client` available to `useT()` / `useStringCast()` and re-renders consumers on every update. */
export function StringCastProvider({ client, children }: StringCastProviderProps) {
  const [revision, setRevision] = useState(0);
  useEffect(() => client.onUpdate(() => setRevision((r) => r + 1)), [client]);
  const value = useMemo(() => ({ client, revision }), [client, revision]);
  return createElement(StringCastContext.Provider, { value }, children);
}

function useCtx(): Ctx {
  const ctx = useContext(StringCastContext);
  if (!ctx) throw new Error('[stringcast] useT()/useStringCast() must be used inside <StringCastProvider>');
  return ctx;
}

export type TFunction = ((key: string, params?: Params, defaultValue?: string) => string) & {
  plural: (key: string, count: number, params?: Params, defaultValue?: string | PluralValue) => string;
  array: (key: string, defaultValue?: string[]) => string[];
  language: string | null;
};

/** Returns a `t` function (with `.plural`, `.array`, `.language`). Components re-render when translations or language change. */
export function useT(): TFunction {
  const { client, revision } = useCtx();
  return useMemo(() => {
    const t = ((key: string, params?: Params, def?: string) => client.t(key, params, def)) as TFunction;
    t.plural = (key, count, params, def) => client.plural(key, count, params, def);
    t.array = (key, def) => client.array(key, def);
    t.language = client.language;
    return t;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, revision]);
}

/** The underlying client (e.g. for `setLanguage`). */
export function useStringCast(): StringCast {
  return useCtx().client;
}
