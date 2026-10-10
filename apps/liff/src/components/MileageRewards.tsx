import { useEffect, useRef, useState } from 'react';
import { affiliateSelfApi, type Redemption, type Reward } from '../lib/affiliate-self-api.js';
import Button from './ui/Button.js';
import Card from './ui/Card.js';
import ConfirmDialog from './ui/ConfirmDialog.js';
import { FormTextControl } from './forms/controls.js';

export default function MileageRewards({ onChanged }: { onChanged: () => Promise<void> }) {
  const [data, setData] = useState<{ rewards: Reward[]; availableMiles: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Reward | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const keys = useRef(new Map<string, string>());
  const [error, setError] = useState('');
  const [result, setResult] = useState<Redemption | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let alive = true;
    setFailed(false);
    affiliateSelfApi.rewards().then(r => { if (alive) setData(r); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [reload]);
  async function redeem() {
    if (!picked || busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    if (!keys.current.has(picked.id)) keys.current.set(picked.id, crypto.randomUUID());
    try {
      const response = await affiliateSelfApi.redeem(picked.id, keys.current.get(picked.id)!);
      keys.current.delete(picked.id);
      setResult(response); setPicked(null); setOpen(false); setReload(n => n + 1);
      // 交換成立後の残高取得の失敗を、交換失敗として再実行させない。
      try { await onChanged(); } catch { setError('残高を読み直せませんでした。画面を開き直してください。'); }
    } catch (e) {
      setError(e instanceof Error ? e.message : '交換できませんでした');
    } finally { busyRef.current = false; setBusy(false); }
  }
  return <section aria-label="マイルを使う" className="space-y-3">
    <h2 className="text-sm font-bold text-ink">マイルを使う</h2>
    {failed ? <><p role="alert" className="text-sm text-danger">使い道を読み込めませんでした</p><Button variant="secondary" onClick={() => setReload(n => n + 1)}>もう一度読み込む</Button></> : <Button variant="secondary" disabled={!data} onClick={() => { setOpen(true); setError(''); }}>使い道を選ぶ</Button>}
    {error && !picked && <p role="alert" className="text-sm text-danger">{error}</p>}
    {result && <Card className="space-y-2 p-4">
      <p role="status">{result.status === 'succeeded' ? `${result.rewardName}に交換しました` : result.message || '交換を受け付けました。特典のお届けを確認しています。'}</p>
      {result.customerMessage && <p>{result.customerMessage}</p>}
      {result.rewardCode && <p className="break-all">交換コード：{result.rewardCode}</p>}
    </Card>}
    <ConfirmDialog open={open && !picked} title="マイルの使い道を選ぶ" description={`使えるマイル：${data?.availableMiles.toLocaleString() ?? '—'}`} cancelLabel="閉じる" onCancel={() => setOpen(false)}>
      <label className="mt-3 block text-sm">名前で探す<FormTextControl block={{ id: 'reward-search', kind: 'input', type: 'text', name: 'reward-search', label: '名前で探す' }} value={query} onChange={setQuery} /></label>
      <ul className="mt-3 max-h-80 space-y-3 overflow-y-auto">
        {data?.rewards.filter(r => r.name.includes(query)).map(reward => <li key={reward.id}>
          <Card className="space-y-2 p-3">
            {reward.imageUrl && <img src={reward.imageUrl} alt="" className="h-24 w-full object-contain" />}
            <h3 className="text-sm font-bold">{reward.name}</h3><p className="text-sm">{reward.description}</p>
            <p className="text-sm">{reward.currentVersion?.requiredMiles.toLocaleString() ?? '—'}マイル</p>
            {reward.canRedeem ? <Button variant="secondary" onClick={() => { setError(''); setPicked(reward); }}>これを選ぶ</Button> : <p className="text-xs text-ink-secondary">{reward.unavailableReason}</p>}
          </Card>
        </li>)}
      </ul>
      {data?.rewards.length === 0 && <p className="mt-3 text-sm">現在交換できる使い道はありません</p>}
    </ConfirmDialog>
    <ConfirmDialog open={!!picked} title={`「${picked?.name ?? ''}」に交換しますか？`} description={`${picked?.currentVersion?.requiredMiles.toLocaleString() ?? '—'}マイルを使います。`} confirmLabel="交換する" cancelLabel="キャンセル" busy={busy} error={error} onConfirm={() => void redeem()} onCancel={() => { setPicked(null); setError(''); }} />
  </section>;
}
