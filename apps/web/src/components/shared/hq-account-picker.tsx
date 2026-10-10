'use client'

/*
 * 統括の「配るアカウントを選ぶ」窓（dJZ7Q の右・B-133）。まとめて選ぶ窓に、アカウントのフォルダ
 * （統括のアカウント一覧と同じフォルダ・色の丸）を入れる。配れるアカウントの集合は呼ぶ側の権限付き API の行。
 * 確定するまで呼ぶ側の宛先は変えない。
 */
import { useEffect, useMemo, useState, type ReactNode, type Ref } from 'react'
import { Building2 } from 'lucide-react'
import type { Folder } from '@line-crm/shared'
import { api } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import { describePicked, EntityMultiPickerDialog, EntityPickerField, EntityPickerSummary, type EntityPickerFolder, type EntityPickerItem } from './entity-picker'

export type HqAccountMembership = { folderId: string | null; folder: Folder | null }
export type HqAccountFolders = { folders: Folder[]; membership: Map<string, HqAccountMembership> | null; failed: boolean }

/** 統括のアカウント一覧と同じ口でフォルダと所属を読む。未取得は未分類として扱わない（membership=null）。 */
export function useHqAccountFolders(enabled: boolean): HqAccountFolders {
  const [folders, setFolders] = useState<Folder[]>([])
  const [membership, setMembership] = useState<Map<string, HqAccountMembership> | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!enabled) return
    let current = true
    setFailed(false)
    void Promise.resolve().then(() => Promise.all([api.lineAccounts.list(), api.lineAccountFolders.list()])).then(([accounts, response]) => {
      if (!accounts?.success || !response?.success) throw new Error('アカウントのフォルダを読み込めませんでした。')
      if (!current) return
      const rows = [...response.data.folders].sort((a, b) => a.displayOrder - b.displayOrder)
      const byId = new Map(rows.map((folder) => [folder.id, folder]))
      setFolders(rows)
      setMembership(new Map(accounts.data.map((account) => [account.id, {
        folderId: account.folderId ?? null,
        folder: account.folderId ? byId.get(account.folderId) ?? account.folder ?? null : null,
      }])))
    }).catch(() => { if (current) { setFailed(true); setMembership(null) } })
    return () => { current = false }
  }, [enabled])
  return { folders, membership, failed }
}

export type HqAccountLike = { id: string; name: string; folderId?: string | null; friendCount?: number | null; keywords?: string }

/** アカウントを窓の候補へ。所属を読めないときはフォルダを付けない（未分類と嘘をつかない）。 */
export function toHqAccountItems(accounts: ReadonlyArray<HqAccountLike>, data: Pick<HqAccountFolders, 'membership'> | null, meta?: (account: HqAccountLike) => string | undefined, disabled?: (account: HqAccountLike) => boolean): EntityPickerItem[] {
  return accounts.map((account) => {
    const member = data?.membership?.get(account.id)
    const folderId = member ? member.folderId : account.folderId !== undefined && data?.membership ? account.folderId ?? null : undefined
    return {
      id: account.id,
      name: account.name,
      folderId,
      meta: meta ? meta(account) : account.friendCount === undefined ? undefined : `友だち ${account.friendCount == null ? '—' : formatNumber(account.friendCount)}`,
      disabled: disabled?.(account) ?? false,
      keywords: account.keywords,
    }
  })
}

export function toPickerFolders(folders: Folder[]): EntityPickerFolder[] {
  return folders.map((folder) => ({ id: folder.id, name: folder.name, color: folder.color ?? null }))
}

/** 「渋谷エリア 2・テスト 1」の形。フォルダを読めないときは名前を並べる。 */
export function summarizeByFolder(items: EntityPickerItem[], folders: EntityPickerFolder[]) {
  if (!items.some((item) => item.folderId !== undefined)) return items.map((item) => item.name).join('・')
  const counts = new Map<string, number>()
  for (const item of items) {
    const name = item.folderId ? folders.find((folder) => folder.id === item.folderId)?.name ?? '—' : '未分類'
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return [...counts].map(([name, count]) => `${name} ${count}`).join('・')
}

type DialogProps = {
  title?: string
  description?: string
  accounts: ReadonlyArray<HqAccountLike>
  data: HqAccountFolders
  initialIds: string[]
  meta?: (account: HqAccountLike) => string | undefined
  disabledIds?: ReadonlyArray<string>
  rowExtra?: (item: EntityPickerItem) => ReactNode
  readOnly?: boolean
  busy?: boolean
  error?: string
  allowEmpty?: boolean
  initialFolder?: string
  onConfirm: (ids: string[]) => void
  onCancel: () => void
}

/** 配るアカウントを選ぶ窓（まとめて選ぶ・アカウントのフォルダ）。 */
export function HqAccountPickerDialog({ title = '配るアカウントを選ぶ', description, accounts, data, initialIds, meta, disabledIds, rowExtra, readOnly, busy, error, allowEmpty, initialFolder, onConfirm, onCancel }: DialogProps) {
  const items = useMemo(() => toHqAccountItems(accounts, data, meta, disabledIds ? (account) => disabledIds.includes(account.id) : undefined), [accounts, data, meta, disabledIds])
  return <EntityMultiPickerDialog title={title} description={description} unit="アカウント" items={items} folders={toPickerFolders(data.folders)} foldersFailed={data.failed}
    initialIds={initialIds} searchPlaceholder="名前で探す" rowExtra={rowExtra} readOnly={readOnly} busy={busy} error={error} allowEmpty={allowEmpty} initialFolder={initialFolder}
    createHref="/hq/accounts" createLabel="アカウントを足す" onConfirm={onConfirm} onCancel={onCancel} />
}

/** 配るアカウントの欄（「3 アカウント 渋谷エリア 2・テスト 1 ［変える］」）。 */
export function HqAccountPickerField({ label = '配るアカウント', title, description, accounts, value, onChange, meta, disabledIds, rowExtra, disabled, readOnly, allowEmpty = true, buttonRef, id }: {
  label?: string
  title?: string
  description?: string
  accounts: ReadonlyArray<HqAccountLike>
  value: string[]
  onChange: (ids: string[]) => void
  meta?: (account: HqAccountLike) => string | undefined
  disabledIds?: ReadonlyArray<string>
  rowExtra?: (item: EntityPickerItem) => ReactNode
  disabled?: boolean
  readOnly?: boolean
  allowEmpty?: boolean
  buttonRef?: Ref<HTMLButtonElement>
  id?: string
}) {
  const data = useHqAccountFolders(true)
  const [open, setOpen] = useState(false)
  const items = useMemo(() => toHqAccountItems(accounts, data, meta, disabledIds ? (account) => disabledIds.includes(account.id) : undefined), [accounts, data, meta, disabledIds])
  const folders = useMemo(() => toPickerFolders(data.folders), [data.folders])
  const picked = describePicked(items, folders, value, 'アカウント', (chosen) => summarizeByFolder(chosen, folders))
  return <>
    <EntityPickerSummary label={label} noun={label} icon={Building2} name={picked.name} meta={picked.meta} disabled={disabled} readOnly={readOnly} id={id} buttonRef={buttonRef} onOpen={() => setOpen(true)} />
    {open ? <HqAccountPickerDialog title={title ?? `${label}を選ぶ`} description={description} accounts={accounts} data={data} initialIds={value} meta={meta} disabledIds={disabledIds} rowExtra={rowExtra}
      readOnly={readOnly} allowEmpty={allowEmpty} onCancel={() => setOpen(false)} onConfirm={(ids) => { onChange(ids); setOpen(false) }} /> : null}
  </>
}

/** 1つのアカウントを選ぶ欄（問い合わせの関係する店舗・テストを送るアカウント）。 */
export function HqAccountSelectField({ label, accounts, value, onChange, clearable = false, disabled, readOnly, id, placeholder }: {
  label: string
  accounts: ReadonlyArray<HqAccountLike>
  value: string
  onChange: (id: string) => void
  clearable?: boolean
  disabled?: boolean
  readOnly?: boolean
  id?: string
  placeholder?: string
}) {
  const data = useHqAccountFolders(true)
  const items = useMemo(() => toHqAccountItems(accounts, data), [accounts, data])
  return <EntityPickerField label={label} noun={label} icon={Building2} items={items} folders={toPickerFolders(data.folders)} foldersFailed={data.failed}
    value={value} onChange={onChange} clearable={clearable} disabled={disabled} readOnly={readOnly} id={id} placeholder={placeholder} title={`${label}を選ぶ`} />
}
