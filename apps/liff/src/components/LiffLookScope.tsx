import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
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
let cachedLook: LiffLook | null = null;
let inflight: Promise<LiffLook> | null = null;

function loadLook(): Promise<LiffLook> {
  if (cachedLook) return Promise.resolve(cachedLook);
  if (!inflight) {
    inflight = api
      .bookingSettings()
      .then((r) => {
        cachedLook = resolveLook(r);
        return cachedLook;
      })
      .catch((e) => {
        logFailure('liff-look', e);
        // 設定が読めなくても止めない。今の見た目 (⑤) のまま出す。
        cachedLook = { ...DEFAULT_LOOK };
        return cachedLook;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/**
 * 予約の画面の包み (M2)。店の見た目 (5つの型＋店の色) を data-liff-theme と
 * CSS 変数で下へ渡す。読めるまでは今の見た目 (⑤) で出し、読めたら替える。
 * 回答フォームは M5 が型を当てるので、ここでは包まない。
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
  const [look, setLook] = useState<LiffLook | null>(cachedLook);

  useEffect(() => {
    if (cachedLook) return;
    let alive = true;
    void loadLook().then((next) => {
      if (alive) setLook(next);
    });
    return () => {
      alive = false;
    };
  }, []);

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
