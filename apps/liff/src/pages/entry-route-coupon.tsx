import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { EntryRouteCouponReceived } from '@line-crm/shared';
import { api } from '../lib/api.js';
import { LiffApiError } from '../lib/api-error.js';
import LiffLookScope from '../components/liff-look-scope.js';
import LiffHeader from '../components/ui/liff-header.js';
import Card from '../components/ui/card.js';
import Button from '../components/ui/button/index.js';
import BottomBar from '../components/ui/bottom-bar.js';
import ConfirmDialog from '../components/ui/confirm-dialog.js';
import LoadingView from '../components/loading-view.js';

const partialUseMessage = 'クーポンの使用を記録しました。使用後の処理に失敗したため、お店に確認してください';
const replayUseMessage = 'クーポンの使用は記録済みです。使用後の処理の結果は確認できません。お店に確認してください。';
const couponUseReasons = new Set(['このクーポンは使えません', 'クーポンの設定を確認してください', 'まだクーポンの利用期間ではありません', 'クーポンの期限が切れています', 'このクーポンは使える回数に達しています']);
function couponUseError(error: unknown): string {
  if (error instanceof LiffApiError && error.status === 409 && couponUseReasons.has(error.message)) return error.message;
  if (error instanceof LiffApiError && error.status === 401) return '使用結果を確認できませんでした。お店の方と確認し、LINEから画面を開き直してください。';
  return '使用結果を確認できませんでした。お店の方と確認してから、もう一度お試しください。';
}

export default function EntryRouteCoupon() {
  const [search] = useSearchParams();
  const ref = search.get('couponRef') ?? '';
  const [coupon, setCoupon] = useState<EntryRouteCouponReceived | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const resultScope = useMemo(() => ({ ref, attempt }), [ref, attempt]);
  const activeResultScope = useRef(resultScope);
  activeResultScope.current = resultScope;
  const [result, setResult] = useState<{ scope: object; receiptId: string; message: string; failed: boolean } | null>(null);
  const requestId = useRef<string | null>(null);
  const saving = useRef(false);
  const activeRef = useRef(ref);
  activeRef.current = ref;
  useEffect(() => {
    let current = true;
    setLoading(true); setCoupon(null); setError(''); setResult(null); setConfirm(false); requestId.current = null;
    void api.entryRouteCoupon.receive(ref).then((received) => { if (current) setCoupon(received); })
      .catch(() => { if (current) setError('このクーポンは現在受け取れません。友だち追加の直後は、少し待って読み直してください。'); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [ref, attempt]);
  const max = coupon?.payload.maxUsesPerFriend ?? (coupon?.payload.oncePerFriend === false ? null : 1);
  const used = coupon && typeof max === 'number' && coupon.usedCount >= max;
  const currentResult = result?.scope === resultScope && result.receiptId === coupon?.receiptId ? result : null;
  const displayError = currentResult?.failed ? currentResult.message : error;
  const handleUseCoupon = async () => {
    if (!coupon || saving.current) return;
    saving.current = true; setBusy(true); setError(''); setResult(null);
    requestId.current ??= crypto.randomUUID();
    try {
      const outcome = await api.entryRouteCoupon.use(coupon.receiptId, requestId.current);
      if (activeResultScope.current === resultScope) setResult({ scope: resultScope, receiptId: coupon.receiptId,
        message: outcome?.message === partialUseMessage ? partialUseMessage : outcome?.replayed === true ? replayUseMessage : 'クーポンの使用を記録しました', failed: false });
      setCoupon((current) => current?.receiptId === coupon.receiptId ? { ...current, usedCount: current.usedCount + 1 } : current);
      if (activeRef.current === ref) { requestId.current = null; setConfirm(false); }
    } catch (error) {
      if (activeResultScope.current === resultScope) setResult({ scope: resultScope, receiptId: coupon.receiptId, message: couponUseError(error), failed: true });
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
      {currentResult && !currentResult.failed ? <p role="status" className="text-sm text-ink">{currentResult.message}</p> : null}
      {displayError && !confirm ? <p role="alert" className="text-sm text-danger">{displayError}</p> : null}
    </main>
    {!loading ? <BottomBar>
      {coupon && !used ? <Button onClick={() => setConfirm(true)}>クーポンを使う</Button> : null}
      {!coupon ? <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>もう一度読み込む</Button> : null}
    </BottomBar> : null}
    <ConfirmDialog open={confirm} title="クーポンを使いますか？" description="お店の方に確認してから押してください。使用した記録は元に戻せません。"
      confirmLabel="使用を確定" busy={busy} error={displayError || undefined} onConfirm={() => void handleUseCoupon()} onCancel={() => { if (!busy) { setConfirm(false); setError(''); setResult(null); } }} />
  </LiffLookScope>;
}
