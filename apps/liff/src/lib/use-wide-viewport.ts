import { useEffect, useState } from 'react';

/**
 * 幅 414px 以上かどうか（★V8 の 414 幅の板 `xvtSz`・`uZqMA`・`wPfqW` 用）。
 *
 * 375 幅と 414 幅で中身は同じ。板 ID だけを替える
 * （畳み込みは CSS が担う）。問い合わせが無い環境
 * （試験など）では 375 扱い（false）のままにする。
 */
export function useWideViewport(): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(min-width: 414px)');
    setWide(query.matches);
    if (typeof query.addEventListener !== 'function') return;
    const onChange = (event: MediaQueryListEvent) => setWide(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return wide;
}
