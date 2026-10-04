'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { useAccount } from '@/contexts/account-context'
import MenuPortal from '@/components/shared/menu-portal'
import { useOverlayFocus } from '@/components/shared/overlay-utils'
import Button from '@/components/shared/button'
import { brandInitial } from '@/components/layout/brand-initial'

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
  const size = compact ? 'h-7 w-7 rounded-control text-xs' : 'h-9 w-9 rounded-control text-sm'
  if (account.pictureUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- LINE公式アカウントのCDN画像
    return <img src={account.pictureUrl} alt="" className={`${size} shrink-0 object-cover`} />
  }
  // 画像が無いときの頭文字は、そのアカウント名から出す。特定の利用者の
  // 名前を固定で書くと、別の利用者のアカウントにもその頭文字が出てしまう。
  return <span className={`flex ${size} shrink-0 items-center justify-center bg-accent-soft font-bold text-success`}>{brandInitial(accountLabel(account)) || 'm'}</span>
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
  // Escapeで閉じる・Tabは窓の中で回る・開いたら窓の中へフォーカス・
  // 閉じたら起点へ戻す・背面はスクロールしない（共通の約束）。
  const panelRef = useOverlayFocus(true, onClose)

  return <div className="fixed inset-0 z-[90] flex items-center justify-center bg-scrim p-4" role="dialog" aria-modal="true" aria-labelledby="account-switch-title" onClick={onClose}>
    <div ref={panelRef} className="w-full max-w-md rounded-card bg-canvas p-5 shadow-overlay" onClick={(event) => event.stopPropagation()}>
      <div className="flex items-start justify-between gap-4">
        <div><p className="text-xs font-semibold text-ink-faint">LINEアカウントを切り替え</p><h2 id="account-switch-title" className="mt-1 text-lg font-bold text-ink">このアカウントへ移動しますか？</h2></div>
        <button type="button" onClick={onClose} aria-label="閉じる" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-pill text-xl text-ink-faint hover:bg-canvas-sunken">×</button>
      </div>
      {current && <div className="mt-5 flex items-center gap-3 rounded-control bg-canvas-sunken px-4 py-3">
        <AccountMark account={current} />
        <div className="min-w-0 flex-1"><p className="text-micro text-ink-faint">現在表示中</p><p className="truncate text-sm font-semibold text-ink">{accountLabel(current)}</p></div>
      </div>}
      <div className="my-2 text-center text-lg text-ink-faint">↓</div>
      <div className="flex items-center gap-3 rounded-control border border-accent bg-accent-soft px-4 py-3">
        <AccountMark account={target} />
        <div className="min-w-0 flex-1"><p className="text-micro font-semibold text-success">移動先</p><p className="truncate text-sm font-bold text-ink">{accountLabel(target)}</p><p className="truncate text-micro text-ink-faint">{target.basicId || 'LINE ID取得中'}</p></div>
      </div>
      <p className="mt-4 text-xs leading-5 text-ink-secondary">移動すると、ダッシュボードや友だち・配信などの表示対象がこのLINE公式アカウントに切り替わります。</p>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" className="px-4 py-2.5 font-medium h-auto whitespace-normal" type="button" onClick={onClose}>キャンセル</Button>
        <Button variant="primary" className="px-4 py-2.5 border-0 h-auto whitespace-normal" type="button" onClick={onConfirm}>このアカウントへ移動</Button>
      </div>
    </div>
  </div>
}

export default function AccountSwitcher() {
  const { accounts, selectedAccount, setSelectedAccountId, loading, error, refreshing, refreshAccounts } = useAccount()
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState<AccountSwitchTarget | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const confirmSwitch = () => {
    if (!target) return
    setSelectedAccountId(target.id)
    setTarget(null)
    setOpen(false)
    window.location.assign('/')
  }

  return <>
    <div className="relative h-[118px] px-3 py-2.5" data-design-node="J33xq/V2WbXF">
      <p className="mb-2 text-micro font-normal text-ink-faint">現在のLINEアカウント</p>
      {loading ? (
        <div role="status" className="flex h-16 w-full items-center gap-1.5 rounded-card border border-hairline bg-canvas px-2 text-left opacity-60">
          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-ink">読み込み中…</span><span className="mt-0.5 block truncate text-xs text-ink-faint">LINE情報を確認中</span></span>
        </div>
      ) : error && !selectedAccount ? (
        // 一覧の取得失敗を「店舗が選ばれていません」に見せない（Issue #978）。
        <div role="alert" className="flex h-16 w-full items-center gap-1.5 rounded-card border border-hairline bg-canvas px-2 text-left">
          <span className="min-w-0 flex-1"><span className="block text-sm font-semibold leading-5 text-danger">読み込みに失敗しました</span><span className="mt-0.5 block truncate text-xs text-ink-faint">アカウント一覧を確認できません</span></span>
          <button type="button" onClick={() => { void refreshAccounts() }} disabled={refreshing} className="rounded-pill bg-accent-soft px-1 py-1 text-nano font-semibold text-accent-deep disabled:opacity-60">
            {refreshing ? '確認中' : '再読み込み'}
          </button>
        </div>
      ) : !selectedAccount ? (
        <Link href="/hq" className="flex h-16 w-full items-center gap-1.5 rounded-card border border-accent bg-canvas px-2 text-left">
          <span className="min-w-0 flex-1"><span className="block text-sm font-semibold leading-5 text-ink">店舗が選ばれていません</span><span className="mt-0.5 block truncate text-xs text-ink-faint">統括の店舗一覧から選択</span></span>
          <span className="rounded-pill bg-accent-soft px-1 py-1 text-nano font-semibold text-accent-deep">選択</span>
        </Link>
      ) : (
        <button ref={triggerRef} type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="flex h-16 w-full items-center gap-1.5 rounded-card border border-hairline bg-canvas px-2 text-left hover:border-accent">
          <AccountMark account={selectedAccount} compact />
          <span className="min-w-0 flex-1"><span className="block truncate text-label font-bold text-ink">{accountLabel(selectedAccount)}</span><span className="mt-0.5 block truncate text-nano text-ink-faint">{selectedAccount.plan?.label || selectedAccount.basicId || 'LINE情報を確認中'}</span></span>
          <span className="rounded-pill bg-accent-soft px-1.25 py-0.75 text-nano font-semibold text-accent-deep">表示中</span>
          <span className={`text-nano text-ink-faint transition-transform ${open ? 'rotate-180' : ''}`}>▼</span>
        </button>
      )}
      {open && <MenuPortal
        open={open}
        align="start"
        matchWidth
        getAnchor={() => triggerRef.current}
        onClose={() => setOpen(false)}
      >
        <div
          className="max-h-72 overflow-y-auto rounded-card border border-hairline bg-canvas p-2 shadow-float"
          // 最上層では absolute 指定を無効にする（位置は器が決める）。
          style={{ position: 'static', width: '100%' }}
        >
          <p className="px-2 pb-2 pt-1 text-nano font-semibold text-ink-faint">切り替えるアカウント</p>
          {accounts.map((account) => {
            const current = account.id === selectedAccount?.id
            return <button key={account.id} type="button" disabled={current} onClick={() => { setTarget(account); setOpen(false) }} className={`flex w-full items-center gap-2 rounded-control px-2 py-2 text-left ${current ? 'bg-accent-soft' : 'hover:bg-canvas-sunken'}`}>
              <AccountMark account={account} />
              <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-ink">{accountLabel(account)}</span><span className="block truncate text-nano text-ink-faint">{account.plan?.label || account.basicId || 'プラン取得中'}</span></span>
              <span className={`text-nano font-semibold ${current ? 'text-success' : 'text-action'}`}>{current ? '表示中' : '選択'}</span>
            </button>
          })}
        </div>
      </MenuPortal>}
    </div>
    {target && <AccountSwitchDialog current={selectedAccount} target={target} onClose={() => setTarget(null)} onConfirm={confirmSwitch} />}
  </>
}
