'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useAccount } from '@/contexts/account-context'

export interface AccountSwitchTarget {
  id: string
  name: string
  displayName?: string
  basicId?: string | null
  pictureUrl?: string | null
  plan?: { label: string; monthlyMessageLimit: number | null }
}

function accountLabel(account: AccountSwitchTarget) {
  return account.displayName || account.name
}

function AccountMark({ account, compact = false }: { account: AccountSwitchTarget; compact?: boolean }) {
  const size = compact ? 'h-7 w-7 rounded-lg text-xs' : 'h-9 w-9 rounded-control text-sm'
  if (account.pictureUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- LINE公式アカウントのCDN画像
    return <img src={account.pictureUrl} alt="" className={`${size} shrink-0 object-cover`} />
  }
  return <span className={`flex ${size} shrink-0 items-center justify-center bg-accent-soft font-bold text-success`}>然</span>
}

export function AccountSwitchDialog({
  current,
  target,
  onClose,
  onConfirm,
}: {
  current: AccountSwitchTarget | null
  target: AccountSwitchTarget
  onClose: () => void
  onConfirm: () => void
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true" aria-labelledby="account-switch-title" onClick={onClose}>
    <div className="w-full max-w-md rounded-card bg-canvas p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
      <div className="flex items-start justify-between gap-4">
        <div><p className="text-xs font-semibold text-accent">LINEアカウントを切り替え</p><h2 id="account-switch-title" className="mt-1 text-lg font-bold text-ink">このアカウントへ移動しますか？</h2></div>
        <button type="button" onClick={onClose} aria-label="閉じる" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xl text-ink-faint hover:bg-canvas-sunken">×</button>
      </div>
      {current && <div className="mt-5 flex items-center gap-3 rounded-control bg-canvas-sunken px-4 py-3">
        <AccountMark account={current} />
        <div className="min-w-0 flex-1"><p className="text-[11px] text-ink-faint">現在表示中</p><p className="truncate text-sm font-semibold text-ink">{accountLabel(current)}</p></div>
      </div>}
      <div className="my-2 text-center text-lg text-ink-faint">↓</div>
      <div className="flex items-center gap-3 rounded-control border border-accent bg-accent-soft px-4 py-3">
        <AccountMark account={target} />
        <div className="min-w-0 flex-1"><p className="text-[11px] font-semibold text-success">移動先</p><p className="truncate text-sm font-bold text-ink">{accountLabel(target)}</p><p className="truncate text-[11px] text-ink-faint">{target.basicId || 'LINE ID取得中'}</p></div>
      </div>
      <p className="mt-4 text-xs leading-5 text-ink-secondary">移動すると、ダッシュボードや友だち・配信などの表示対象がこのLINE公式アカウントに切り替わります。</p>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-control border border-hairline px-4 py-2.5 text-sm font-medium text-ink hover:bg-canvas-sunken">キャンセル</button>
        <button type="button" onClick={onConfirm} className="rounded-control bg-accent-deep px-4 py-2.5 text-sm font-semibold text-on-accent hover:brightness-92">このアカウントへ移動</button>
      </div>
    </div>
  </div>
}

export default function AccountSwitcher() {
  const { accounts, selectedAccount, setSelectedAccountId, loading } = useAccount()
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState<AccountSwitchTarget | null>(null)

  const confirmSwitch = () => {
    if (!target) return
    setSelectedAccountId(target.id)
    setTarget(null)
    setOpen(false)
    window.location.assign('/')
  }

  return <>
    <div className="relative h-[118px] px-3 py-2.5" data-design-node="J33xq/V2WbXF">
      <p className="mb-2 text-[11px] font-normal text-ink-faint">現在のLINEアカウント</p>
      {loading ? (
        <div role="status" className="flex h-16 w-full items-center gap-1.5 rounded-xl border border-hairline bg-canvas px-2 text-left opacity-60">
          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold text-ink">読み込み中…</span><span className="mt-0.5 block truncate text-xs text-ink-faint">LINE情報を確認中</span></span>
        </div>
      ) : !selectedAccount ? (
        <Link href="/hq" className="flex h-16 w-full items-center gap-1.5 rounded-xl border border-accent bg-canvas px-2 text-left">
          <span className="min-w-0 flex-1"><span className="block text-sm font-bold leading-5 text-ink">店舗が選ばれていません</span><span className="mt-0.5 block truncate text-xs text-ink-faint">統括の店舗一覧から選択</span></span>
          <span className="rounded-pill bg-accent-soft px-1 py-1 text-nano font-semibold text-accent">選択</span>
        </Link>
      ) : (
        <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="flex h-16 w-full items-center gap-1.5 rounded-xl border border-hairline bg-canvas px-2 text-left hover:border-accent">
          <AccountMark account={selectedAccount} compact />
          <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-bold text-ink">{accountLabel(selectedAccount)}</span><span className="mt-0.5 block truncate text-[10px] text-ink-faint">{selectedAccount.plan?.label || selectedAccount.basicId || 'LINE情報を確認中'}</span></span>
          <span className="rounded-pill bg-accent-soft px-1.25 py-0.75 text-nano font-semibold text-accent">表示中</span>
          <span className={`text-[10px] text-ink-faint transition-transform ${open ? 'rotate-180' : ''}`}>▼</span>
        </button>
      )}
      {open && <div className="absolute left-0 right-0 top-full z-30 mt-2 max-h-72 overflow-y-auto rounded-card border border-hairline bg-canvas p-2 shadow-xl">
        <p className="px-2 pb-2 pt-1 text-[10px] font-semibold text-ink-faint">切り替えるアカウント</p>
        {accounts.map((account) => {
          const current = account.id === selectedAccount?.id
          return <button key={account.id} type="button" disabled={current} onClick={() => { setTarget(account); setOpen(false) }} className={`flex w-full items-center gap-2 rounded-control px-2 py-2 text-left ${current ? 'bg-accent-soft' : 'hover:bg-canvas-sunken'}`}>
            <AccountMark account={account} />
            <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-ink">{accountLabel(account)}</span><span className="block truncate text-[10px] text-ink-faint">{account.plan?.label || account.basicId || 'プラン取得中'}</span></span>
            <span className={`text-[10px] font-semibold ${current ? 'text-success' : 'text-accent'}`}>{current ? '表示中' : '選択'}</span>
          </button>
        })}
      </div>}
    </div>
    {target && <AccountSwitchDialog current={selectedAccount} target={target} onClose={() => setTarget(null)} onConfirm={confirmSwitch} />}
  </>
}
