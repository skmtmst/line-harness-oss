import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { getLiffId } from '../lib/liff-auth.js';
import { api } from '../lib/api.js';
import {
  DEFAULT_LOOK,
  lookStyleVars,
  resolveLook,
  type LiffLook,
} from '../lib/liff-look.js';
import { logFailure } from '../lib/user-message.js';

// 店の見た目は画面ごとに読み直さない。最初に取れた値をモジュールに持つ
// (LiffHeader の店名と同じ構え)。型を替えるときは管理画面 (M3) で変え、
// LIFF を開き直すと新しい見た目になる。
const cachedLooks = new Map<string, LiffLook>();
const inflightLooks = new Map<string, Promise<LiffLook>>();
function currentLiffId(): string {
  try { return getLiffId(); } catch { return ''; }
}
function loadLook(key: string): Promise<LiffLook> {
  const cached = cachedLooks.get(key);
  if (cached) return Promise.resolve(cached);
  const pending = inflightLooks.get(key);
  if (pending) return pending;
  const request = api.customerLook().then(r => {
    const next = resolveLook(r.data.settings);
    cachedLooks.set(key, next);
    return next;
  }).catch(e => {
    logFailure('liff-look', e);
    return {...DEFAULT_LOOK};
  }).finally(() => { inflightLooks.delete(key); });
  inflightLooks.set(key, request);
  return request;
}

/**
 * 予約の画面の包み (M2)。店の見た目 (5つの型＋店の色) を data-liff-theme と
 * CSS 変数で下へ渡す。読めるまでは今の見た目 (⑤) で出し、読めたら替える。
 * 回答フォームは公開 API の個別設定が内側で優先される。
 */
export default function LiffLookScope({
  className,
  designNode,
  children,
}: {
  className?: string;
  /** 板の絵と突き合わせる札 (元々根に付いていたものだけ受け渡す)。 */
  designNode?: string;
  children: ReactNode;
}) {
  const key = currentLiffId();
  const [look, setLook] = useState<LiffLook | null>(cachedLooks.get(key) ?? null);

  useEffect(() => {
    const cached = cachedLooks.get(key);
    setLook(cached ?? null);
    if (cached) return;
    let alive = true;
    void loadLook(key).then((next) => {
      if (alive) setLook(next);
    });
    return () => {
      alive = false;
    };
  }, [key]);

  const active = look ?? DEFAULT_LOOK;
  return (
    <div
      data-liff-theme={active.theme}
      data-design-node={designNode}
      className={className}
      style={lookStyleVars(active) as CSSProperties}
    >
      {children}
    </div>
  );
}
