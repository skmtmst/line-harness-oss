import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '../lib/api.js';
import { getLiffId, getLineUserId } from '../lib/liff-auth.js';
import { customerWords, parseCustomerStyle, type CustomerStyle } from '../lib/customer-style.js';
import LiffHeader from './ui/liff-header.js';
import LoadErrorView from './load-error-view.js';
import LoadingView from './loading-view.js';

export const CustomerStyleContext = createContext<CustomerStyle | null>(null);
export const useCustomerStyle = () => useContext(CustomerStyleContext);
export const useCustomerWords = () => customerWords(useCustomerStyle());

function identityKey() {
  return `${getLiffId()}:${getLineUserId()}`;
}

/** 所属・本人が替わった瞬間に子を破棄。前の店の語や入力を次の店へ持ち越さない。 */
export default function CustomerStyleScope({ children, required = true }: { children: ReactNode; required?: boolean }) {
  return <StyleLoader key={identityKey()} required={required}>{children}</StyleLoader>;
}

function StyleLoader({ children, required }: { children: ReactNode; required: boolean }) {
  const [style, setStyle] = useState<CustomerStyle | null>(null);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let alive = true;
    setStyle(null); setFailed(false);
    void api.liffConfig().then((r) => {
      if (!r.success || !r.data.accountId) throw new Error('customer_account_unavailable');
      const next = parseCustomerStyle(r.data.style);
      if (alive) setStyle(next);
    }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [reload]);
  if (!style && required) return <>
    <LiffHeader title="ご案内" />
    <main className="mx-auto w-full max-w-md px-4 py-4">
      {failed ? <LoadErrorView onRetry={() => setReload((n) => n + 1)} /> : <LoadingView />}
    </main>
  </>;
  return <CustomerStyleContext.Provider value={style}>{children}</CustomerStyleContext.Provider>;
}
