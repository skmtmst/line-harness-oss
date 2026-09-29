'use client'

import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import type { LineAccount } from '@line-crm/shared'
import { api } from '@/lib/api'
import ActionMenu, { type ActionMenuItem } from '@/components/shared/action-menu'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import Notice from '@/components/shared/notice'
import { MoreAction } from '@/components/shared/row-actions'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'

type AccountItem = LineAccount & { displayName?: string; basicId?: string | null }
const ACCOUNT_DRAG_TYPE = 'application/x-line-account-id'

export default function AccountOrdering() {
  const [accounts, setAccounts] = useState<AccountItem[]>([])
  const [savedParents, setSavedParents] = useState(new Map<string, string | null>())
  const [draftRootIds, setDraftRootIds] = useState<Set<string>>(() => new Set())
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const draggedIdRef = useRef<string | null>(null)
  /** 移動先メニューを開いているカード。ドラッグを使わない操作経路（R191）。 */
  const [moveMenuFor, setMoveMenuFor] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    const response = await api.lineAccounts.list()
    if (response.success) {
      const items = response.data as AccountItem[]
      setAccounts(items)
      setSavedParents(new Map(items.map((item) => [item.id, item.parentLineAccountId ?? null])))
      setDraftRootIds(new Set())
      setError('')
    } else setError(response.error)
    setLoading(false)
  }
  useEffect(() => { void load() }, [])

  const childrenByParent = useMemo(() => {
    const map = new Map<string, AccountItem[]>()
    for (const account of accounts) {
      if (!account.parentLineAccountId) continue
      map.set(account.parentLineAccountId, [...(map.get(account.parentLineAccountId) ?? []), account])
    }
    return map
  }, [accounts])
  const roots = accounts.filter((account) => !account.parentLineAccountId)
  const unassigned = roots.filter((account) => !(childrenByParent.get(account.id)?.length) && !draftRootIds.has(account.id))
  const hierarchyRoots = roots.filter((account) => childrenByParent.get(account.id)?.length || draftRootIds.has(account.id))
  const changed = accounts.filter((account) => savedParents.get(account.id) !== (account.parentLineAccountId ?? null))

  /*
   * 未保存の構成変更がある間、画面を離れる操作を止める共通の番兵（DETAIL-04系）。
   * 左メニュー・アカウント詳細などのリンク・戻る操作・再読込を同じ確認対話へ寄せる。
   */
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty: changed.length > 0, busy: saving })

  const startDrag = (event: DragEvent<HTMLElement>, accountId: string) => {
    draggedIdRef.current = accountId
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData(ACCOUNT_DRAG_TYPE, accountId)
    event.dataTransfer.setData('text/plain', accountId)
    setDraggedId(accountId)
    setError('')
  }

  const finishDrag = () => {
    draggedIdRef.current = null
    setDraggedId(null)
  }

  const droppedAccountId = (event: DragEvent<HTMLElement>) =>
    event.dataTransfer.getData(ACCOUNT_DRAG_TYPE) ||
    event.dataTransfer.getData('text/plain') ||
    draggedIdRef.current

  /** 動かすアカウントを根として数えた、ぶら下がる部分木の深さ。循環は打ち切る。 */
  const subtreeDepth = (id: string, seen = new Set<string>()): number => {
    if (seen.has(id)) return 99
    const nextSeen = new Set(seen).add(id)
    const children = childrenByParent.get(id) ?? []
    return 1 + Math.max(0, ...children.map((child) => subtreeDepth(child.id, nextSeen)))
  }

  /**
   * `accountId` を `parentId` の下へ置くと問題になる理由を返す。問題なければ null。
   * ドラッグの `place` と、移動先メニューの「押せない理由」の両方が使う。
   */
  const moveError = (parentId: string | null, accountId: string): string | null => {
    if (accountId === parentId) return '同じアカウントの下には置けません'
    const parent = parentId ? accounts.find((item) => item.id === parentId) : null
    const ancestorIds = new Set<string>()
    let cursor = parent
    let targetDepth = 1
    while (cursor) {
      if (cursor.id === accountId || ancestorIds.has(cursor.id)) {
        return 'アカウント構成を循環させることはできません'
      }
      ancestorIds.add(cursor.id)
      cursor = cursor.parentLineAccountId ? accounts.find((item) => item.id === cursor?.parentLineAccountId) : undefined
      targetDepth += 1
    }
    if (parent && targetDepth + subtreeDepth(accountId) - 1 > 3) {
      return 'アカウント構成は親・子・孫の3階層までです'
    }
    return null
  }

  const place = (parentLineAccountId: string | null, accountId: string | null) => {
    // 自分自身へのドロップはドラッグ中の誤操作として黙って無視する。
    if (!accountId || accountId === parentLineAccountId || saving) return
    const blocked = moveError(parentLineAccountId, accountId)
    if (blocked) {
      setError(blocked)
      return
    }

    setAccounts((items) => items.map((item) => item.id === accountId ? { ...item, parentLineAccountId } : item))
    setDraftRootIds((current) => {
      const next = new Set(current)
      if (parentLineAccountId === null) next.add(accountId)
      else next.delete(accountId)
      return next
    })
    draggedIdRef.current = null
    setDraggedId(null)
    setError('')
  }

  const dropOn = (event: DragEvent<HTMLElement>, parentLineAccountId: string | null) => {
    event.preventDefault()
    event.stopPropagation()
    place(parentLineAccountId, droppedAccountId(event))
  }

  const save = async () => {
    if (changed.length === 0 || saving) return
    setSaving(true)
    setError('')
    const response = await api.lineAccounts.updateHierarchy(
      changed.map((item) => ({ id: item.id, parentLineAccountId: item.parentLineAccountId ?? null })),
    )
    if (response.success) await load()
    else setError(response.error)
    setSaving(false)
  }

  const cancelChanges = () => {
    setAccounts((items) => items.map((item) => ({ ...item, parentLineAccountId: savedParents.get(item.id) ?? null })))
    setDraftRootIds(new Set())
    finishDrag()
    setMoveMenuFor(null)
    setError('')
  }

  /** 階層の中での深さ。最上位が0、「子」が1、「孫」が2。循環があっても打ち切る。 */
  const depthOf = (account: AccountItem): number => {
    let depth = 0
    const seen = new Set<string>([account.id])
    let cursor = account.parentLineAccountId ? accounts.find((item) => item.id === account.parentLineAccountId) : undefined
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id)
      depth += 1
      cursor = cursor.parentLineAccountId ? accounts.find((item) => item.id === cursor?.parentLineAccountId) : undefined
    }
    return depth
  }

  /**
   * R191: ドラッグを使わずキーボードやクリックだけで同じ配置をする入口。
   * 各カードの「…」から開き、行き先を選ぶ。置けない行き先は理由つきで
   * 押せない形にし、循環や階層上限の決まりがその場で分かるようにする。
   */
  const moveMenuItems = (account: AccountItem): ActionMenuItem[] => {
    const label = (item: AccountItem) => item.displayName || item.name
    const items: ActionMenuItem[] = [{
      id: '__root',
      label: '最上位（親）にする',
      description: 'ほかのアカウントの下には置きません',
      onSelect: () => place(null, account.id),
    }]
    let firstTarget = true
    for (const target of accounts) {
      if (target.id === account.id) continue
      const reason = moveError(target.id, account.id)
      const targetDepth = depthOf(target)
      items.push({
        id: target.id,
        label: `「${label(target)}」の子にする`,
        description: targetDepth === 0
          ? '全体では「子」の位置になります'
          : targetDepth === 1
            ? '全体では「孫」の位置になります'
            : undefined,
        sectionBefore: firstTarget ? 'ほかのアカウントの下に置く' : undefined,
        disabled: reason !== null,
        disabledReason: reason ?? undefined,
        onSelect: () => place(target.id, account.id),
      })
      firstTarget = false
    }
    return items
  }

  /** カードの「…」ボタンと移動先メニュー。カード全体はdivなので操作はボタンに寄せる。 */
  const moveMenu = (account: AccountItem) => {
    const name = account.displayName || account.name
    return (
      <span className="relative ml-auto flex shrink-0 items-center">
        <MoreAction
          label={`${name}の移動先を選ぶ`}
          aria-expanded={moveMenuFor === account.id}
          onClick={() => setMoveMenuFor((current) => (current === account.id ? null : account.id))}
        />
        <ActionMenu
          open={moveMenuFor === account.id}
          ariaLabel={`${name}の移動先`}
          onClose={() => setMoveMenuFor(null)}
          items={moveMenuItems(account)}
        />
      </span>
    )
  }

  const node = (account: AccountItem, depth: number): ReactNode => {
    const children = childrenByParent.get(account.id) ?? []
    const depthLabel = depth === 0 ? '親' : depth === 1 ? '子' : '孫'
    return <div key={account.id} className={depth > 0 ? 'ml-8' : ''}>
      <div
        data-account-id={account.id}
        draggable={!saving}
        onDragStart={(event) => startDrag(event, account.id)}
        onDragEnd={finishDrag}
        onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move' }}
        onDrop={(event) => dropOn(event, account.id)}
        className={`mb-2 flex min-h-14 cursor-grab items-center gap-3 rounded-control border px-4 py-3 transition-colors ${depth === 0 ? 'border-accent bg-accent-soft' : depth === 1 ? 'border-info bg-info-bg' : 'border-hairline bg-canvas'} ${draggedId === account.id ? 'opacity-45' : ''}`}
      >
        <span className="text-ink-faint">⠇</span><span className={`flex h-7 w-7 items-center justify-center rounded-control text-sm ${depth === 0 ? 'bg-canvas text-success' : depth === 1 ? 'bg-canvas text-accent-deep' : 'bg-accent-soft text-success'}`}>▧</span>
        <div className="min-w-0 flex-1"><p className="truncate whitespace-nowrap text-sm font-semibold text-ink" title={account.displayName || account.name}>{account.displayName || account.name}</p><p className="truncate whitespace-nowrap text-[11px] text-ink-faint">{account.basicId || (depth === 0 ? '親・LINE公式アカウント' : `上位LINEの${depthLabel}`)}</p></div>
        {depth === 0 && <span className="text-[10px] text-ink-faint">ログイン時の表示<br/><b className="text-success">権限ON：子・孫のLINEを表示</b></span>}
        {depth > 0 && <><span className={`flex h-6 w-6 items-center justify-center rounded-pill text-[10px] ${depth === 1 ? 'bg-canvas text-accent-deep' : 'bg-accent-soft text-success'}`}>{depthLabel}</span><span className={`whitespace-nowrap text-[10px] font-medium ${depth === 1 ? 'text-accent-deep' : 'text-ink-faint'}`}>{depth === 1 ? '権限ON：孫を管理' : '自分のみ'}</span></>}
        {moveMenu(account)}
      </div>
      {children.map((child) => node(child, depth + 1))}
      {depth < 2 && <DropLine onDrop={(event) => dropOn(event, account.id)} label={depth === 0 ? 'ここへLINEアカウントをドロップすると「子」になります' : 'ここへLINEアカウントをドロップすると「孫」になります'} dragging={Boolean(draggedId)} />}
    </div>
  }

  return <section className="mt-6 border-t border-hairline pt-6" aria-labelledby="account-ordering-title">
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div><h2 id="account-ordering-title" className="font-bold text-ink">LINEアカウントの並び替え</h2><p className="mt-1 text-xs text-ink-secondary">登録済みアカウントをドラッグするか、カードの「…」から移動先を選んで、親・子・孫の順に整理します。</p></div>
      <button onClick={() => void save()} disabled={changed.length === 0 || saving} className="cursor-pointer whitespace-nowrap rounded-control bg-accent-deep px-4 py-2 text-sm font-medium text-on-accent disabled:cursor-not-allowed disabled:bg-hairline">▣ {saving ? '保存中…' : '並びを保存'}</button>
    </div>
    <Notice tone="info" className="mb-4">⚓ 登録済みのLINEアカウントをドラッグ＆ドロップ、またはカードの「…」→移動先の選択で、親・子・孫の3階層まで紐付けます。下位階層を表示・操作できるのは「他アカウント権限」がONの管理者だけです。</Notice>
    {error && <Notice tone="danger" className="mb-4">{error}</Notice>}
    <div className="grid items-start gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
      <section className="rounded-card border border-warning bg-warning-bg p-4"><div className="flex items-center justify-between"><h2 className="text-sm font-semibold text-warning">▧ 未設定のLINEアカウント</h2><span className="rounded-pill bg-canvas px-2 py-1 text-xs font-semibold text-warning">{unassigned.length}件</span></div><p className="mt-2 text-[11px] leading-5 text-ink-secondary">まだ親・子・孫に紐づいていません。カードを中央へドラッグするか、「…」から移動先を選びます。</p><div className="mt-3 space-y-2">{loading ? <p className="text-xs text-ink-faint">読み込み中…</p> : unassigned.length === 0 ? <p className="rounded-control bg-canvas px-3 py-4 text-center text-xs text-ink-faint">未設定はありません</p> : unassigned.map((account) => <div key={account.id} data-account-id={account.id} draggable={!saving} onDragStart={(event) => startDrag(event, account.id)} onDragEnd={finishDrag} className={`flex cursor-grab items-center gap-2 rounded-control border border-hairline bg-canvas px-3 py-3 ${draggedId === account.id ? 'opacity-45' : ''}`}><span className="text-ink-faint">⠇</span><span className="text-success">▧</span><div className="min-w-0"><p className="truncate whitespace-nowrap text-xs font-semibold">{account.displayName || account.name}</p><p className="text-[10px] text-ink-faint">階層未設定</p></div><span className="ml-auto text-[10px] font-semibold text-success">未設定</span>{moveMenu(account)}</div>)}</div></section>
      <section className="rounded-card border border-hairline bg-canvas p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold text-ink">LINEアカウント階層を編集</h2><p className="mt-1 text-xs text-ink-faint">登録済みのLINE公式アカウントを移動して、親・子・孫を設定します。</p></div>{changed.length > 0 && <span className="rounded-pill bg-warning-bg px-3 py-1 text-xs font-semibold text-warning">◉ 未保存の変更 {changed.length}件</span>}</div><div className="mt-4">{loading ? <p className="py-12 text-center text-sm text-ink-faint">読み込み中…</p> : hierarchyRoots.length === 0 ? <div data-hierarchy-root-drop onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move' }} onDrop={(event) => dropOn(event, null)} className={`rounded-control border border-dashed border-info bg-info-bg px-5 py-14 text-center text-sm text-info transition-shadow ${draggedId ? 'ring-2 ring-info/20' : ''}`}>{draggedId ? 'ここで離すと親候補として配置します' : '左のLINEアカウントをここへドロップして構成を作ります'}</div> : hierarchyRoots.map((account) => node(account, 0))}</div><DropLine onDrop={(event) => dropOn(event, null)} label="親LINEの直下へドロップすると「親」になります" blue dragging={Boolean(draggedId)} /><p className="mt-3 rounded-control bg-accent-soft px-4 py-3 text-xs font-semibold text-success">◉ 親・子・孫はすべてLINE公式アカウントです。「他アカウント権限」がONのユーザーだけが、担当LINEより下の階層を表示・操作できます。</p>{changed.length > 0 && <div className="mt-4 flex justify-end gap-2"><button onClick={cancelChanges} className="rounded-control border border-hairline px-4 py-2 text-sm">変更を取り消す</button><button onClick={() => void save()} disabled={saving} className="rounded-control bg-accent-deep px-4 py-2 text-sm font-semibold text-on-accent">▣ 構成を保存</button></div>}</section>
    </div>
    <UnsavedLeaveDialog open={leaveTarget !== null} subject="アカウント構成への変更" onConfirm={confirmLeave} onCancel={cancelLeave} />
  </section>
}

function DropLine({ onDrop, label, blue = false, dragging = false }: { onDrop: (event: DragEvent<HTMLDivElement>) => void; label: string; blue?: boolean; dragging?: boolean }) {
  return <div onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move' }} onDrop={onDrop} className={`mb-2 rounded-control border border-dashed px-3 py-2 text-center text-[10px] font-medium transition-shadow ${dragging ? 'ring-2 ring-info/20' : ''} ${blue ? 'border-info bg-info-bg text-info' : 'border-accent/30 bg-accent-soft text-success'}`}>↓ {label}</div>
}
