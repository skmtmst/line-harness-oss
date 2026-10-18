import { useEffect, useRef } from 'react';

/** 読み取り用。表示中だけ、前の要求の終了から同じ間隔で読む。失敗時は手動確認へ。 */
export function useVisiblePolling(read: () => Promise<boolean>, active: boolean, intervalMs: number) {
  const latest = useRef(read);
  latest.current = read;
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    let inFlight = false;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const visible = () => document.visibilityState !== 'hidden';
    function schedule() {
      clearTimeout(timer);
      if (!disposed && !stopped && !inFlight && visible()) timer = setTimeout(() => { void tick(); }, intervalMs);
    }
    async function tick() {
      if (disposed || inFlight || !visible()) return;
      inFlight = true;
      try { stopped = !(await latest.current()); }
      catch { stopped = true; }
      finally { inFlight = false; schedule(); }
    }
    function onVisibility() {
      clearTimeout(timer);
      if (visible()) schedule();
    }
    schedule();
    document.addEventListener('visibilitychange', onVisibility);
    return () => { disposed = true; clearTimeout(timer); document.removeEventListener('visibilitychange', onVisibility); };
  }, [active, intervalMs]);
}
