import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { EntryRouteCouponReceived } from '@line-crm/shared';
import { api } from '../lib/api.js';
import LiffLookScope from '../components/LiffLookScope.js';
import LiffHeader from '../components/ui/LiffHeader.js';
import Card from '../components/ui/Card.js';
import Button from '../components/ui/Button.js';
import BottomBar from '../components/ui/BottomBar.js';
import ConfirmDialog from '../components/ui/ConfirmDialog.js';
import LoadingView from '../components/LoadingView.js';

export default function EntryRouteCoupon() {
  const [search] = useSearchParams();
  const ref = search.get('couponRef') ?? '';
  const [coupon, setCoupon] = useState<EntryRouteCouponReceived | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const requestId = useRef<string | null>(null);
  const saving = useRef(false);
  const activeRef = useRef(ref);
  activeRef.current = ref;
  useEffect(() => {
    let current = true;
    setLoading(true); setCoupon(null); setError(''); setConfirm(false); requestId.current = null;
    void api.entryRouteCoupon.receive(ref).then((received) => { if (current) setCoupon(received); })
      .catch(() => { if (current) setError('このクーポンは現在受け取れません。友だち追加の直後は、少し待って読み直してください。'); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [ref, attempt]);
  const max = coupon?.payload.maxUsesPerFriend ?? (coupon?.payload.oncePerFriend === false ? null : 1);
  const used = coupon && typeof max === 'number' && coupon.usedCount >= max;
  const useCoupon = async () => {
    if (!coupon || saving.current) return;
    saving.current = true; setBusy(true); setError('');
    requestId.current ??= crypto.randomUUID();
    try {
      await api.entryRouteCoupon.use(coupon.receiptId, requestId.current);
      setCoupon((current) => current?.receiptId === coupon.receiptId ? { ...current, usedCount: current.usedCount + 1 } : current);
      if (activeRef.current === ref) { requestId.current = null; setConfirm(false); }
    } catch {
      if (activeRef.current === ref) setError('使用を記録できませんでした。お店の方と確認して、もう一度お試しください。');
    } finally { saving.current = false; setBusy(false); }
  };
  return <LiffLookScope className="min-h-screen bg-canvas">
    <LiffHeader title="クーポン" />
    <main className="mx-auto w-full max-w-md space-y-4 px-4 pt-6 pb-40">
      {loading ? <LoadingView /> : coupon ? <>
        <Card className="space-y-3 p-4">
          <h1 className="text-xl font-bold text-ink">{coupon.name}</h1>
          <p className="text-sm text-ink">{String(coupon.payload.description ?? '')}</p>
          <p className="text-sm text-ink-secondary">{`利用期間：${String(coupon.payload.startsAt ?? '')} 〜 ${String(coupon.payload.endsAt ?? '')}`}</p>
          <p className="text-sm text-ink-secondary">お会計のときに、この画面をお店の方に見せてください。</p>
        </Card>
        <p className="text-sm text-ink-secondary">1人1回だけ受け取れます。読み直しても同じクーポンを表示します。</p>
        {coupon.usedCount > 0 ? <p role="status" className="text-sm text-ink">{used ? 'このクーポンは使用済みです' : `${coupon.usedCount}回使用しました`}</p> : null}
      </> : <h1 className="text-lg font-bold text-ink">クーポンを受け取れませんでした</h1>}
      {error && !confirm ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
    </main>
    {!loading ? <BottomBar>
      {coupon && !used ? <Button onClick={() => setConfirm(true)}>クーポンを使う</Button> : null}
      {!coupon ? <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>もう一度読み込む</Button> : null}
    </BottomBar> : null}
    <ConfirmDialog open={confirm} title="クーポンを使いますか？" description="お店の方に確認してから押してください。使用した記録は元に戻せません。"
      confirmLabel="使用を確定" busy={busy} error={error || undefined} onConfirm={() => void useCoupon()} onCancel={() => { if (!busy) { setConfirm(false); setError(''); } }} />
  </LiffLookScope>;
}
