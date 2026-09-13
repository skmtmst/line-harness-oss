'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import type { ApiResponse, LineAccount } from '@line-crm/shared'
import { api, fetchApi, type UidMigrationItem, type UidMigrationRun } from '@/lib/api'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import SelectField from '@/components/shared/select-field'
import StatusBadge from '@/components/shared/status-badge'
import SummaryCard from '@/components/shared/summary-card'
import { TableHeadRow, Th } from '@/components/shared/table'
import { usePageTitle } from '@/components/shell/page-chrome'

const STEPS = ['移行の登録', '対応表の取込', '事前確認', '要確認の判断', '本移行と照合'] as const

/**
 * CSVの1行を切り分ける。**引用符の中のカンマは区切りにしない。**
 * 単純な `split(',')` だと、名前やUIDにカンマが入った行で列がずれ、
 * 別人の結び付けになる。閉じていない引用符の行は `null` で返す。
 */
export function splitUidCsvLine(line: string): string[] | null {
  const cells: string[] = []
  let current = ''
  let quoted = false
  for (let index = 0; index < line.length; index++) {
    const char = line[index]
    if (quoted) {
      if (char === '"') {
        if (line[index + 1] === '"') { current += '"'; index++ }
        else quoted = false
      } else current += char
    } else if (char === '"' && current === '') {
      quoted = true
    } else if (char === ',') {
      cells.push(current); current = ''
    } else current += char
  }
  if (quoted) return null
  cells.push(current)
  return cells
}

export function parseUidCsv(text: string) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim())
  if (lines.length < 2) return []
  const headers = splitUidCsvLine(lines[0])?.map((value) => value.trim().toLowerCase()) ?? []
  const oldIndex = headers.findIndex((value) => ['old_uid', '旧uid', '移行元uid'].includes(value))
  const newIndex = headers.findIndex((value) => ['new_uid', '新uid', '移行先uid'].includes(value))
  if (oldIndex < 0 || newIndex < 0) return []
  const rows: Array<{ oldUid: string; newUid: string | null; evidenceType: 'operator_csv' }> = []
  for (const line of lines.slice(1)) {
    // **列の数が合わない行は読み飛ばす。** ずれたまま結び付けると別人になる。
    const cells = splitUidCsvLine(line)
    if (!cells || cells.length !== headers.length) continue
    const oldUid = cells[oldIndex].trim()
    if (!oldUid) continue
    rows.push({ oldUid, newUid: cells[newIndex].trim() || null, evidenceType: 'operator_csv' as const })
  }
  return rows
}

/** 対応表の1ページの行数。口側の既定とそろえる。 */
const ITEM_PAGE_SIZE = 20

const ITEM_CLASSIFICATIONS = ['auto', 'review', 'unmatched', 'conflict'] as const
type ItemClassification = (typeof ITEM_CLASSIFICATIONS)[number]

/** ページ送り・絞り込み付きの対応表。口が `itemTotal` 等を返さない古い応答にも耐える。 */
type UidMigrationDetail = UidMigrationRun & {
  itemTotal?: number
  itemLimit?: number
  itemOffset?: number
  unresolved?: number | null
}

const classLabel = { auto: '自動一致', review: '要確認', unmatched: '未一致', conflict: '競合' } as const

export default function AccountMigration() {
  usePageTitle('UID移行')
  const [accounts, setAccounts] = useState<LineAccount[]>([])
  const [runs, setRuns] = useState<UidMigrationRun[]>([])
  const [active, setActive] = useState<UidMigrationDetail | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [fromAccountId, setFromAccountId] = useState('')
  const [toAccountId, setToAccountId] = useState('')
  const [purpose, setPurpose] = useState('友だち情報と配信停止状態を新しいアカウントへ引き継ぐ')
  const [file, setFile] = useState<File | null>(null)
  const [mappings, setMappings] = useState<ReturnType<typeof parseUidCsv>>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [classification, setClassification] = useState<'' | ItemClassification>('')
  const [pendingOnly, setPendingOnly] = useState(false)

  /**
   * 対応表を1ページずつ読む。**全件は読まない。**
   * 数千行の対応表でも応答が重くならない。
   */
  const loadDetail = useCallback(async (
    runId: string,
    targetPage: number,
    targetClassification: '' | ItemClassification,
    targetPendingOnly: boolean,
  ): Promise<UidMigrationDetail | null> => {
    try {
      const params = new URLSearchParams({ limit: String(ITEM_PAGE_SIZE), offset: String(targetPage * ITEM_PAGE_SIZE) })
      if (targetClassification) params.set('classification', targetClassification)
      if (targetPendingOnly) params.set('pendingOnly', '1')
      const response = await fetchApi<ApiResponse<UidMigrationDetail>>(`/api/friends/migrations/${runId}?${params.toString()}`)
      if (!response.success) {
        setMessage(response.error)
        return null
      }
      setActive(response.data)
      return response.data
    } catch {
      setMessage('対応表を読み直せませんでした。')
      return null
    }
  }, [])

  const load = useCallback(async () => {
    setStatus('loading')
    try {
      const [accountResponse, runResponse] = await Promise.all([api.lineAccounts.list(), api.friendMigrations.list()])
      if (!accountResponse.success || !runResponse.success) throw new Error('load failed')
      setAccounts(accountResponse.data)
      setRuns(runResponse.data)
      setFromAccountId((value) => value || accountResponse.data[0]?.id || '')
      setToAccountId((value) => value || accountResponse.data[1]?.id || '')
      setPage(0)
      setClassification('')
      setPendingOnly(false)
      if (runResponse.data[0]) {
        await loadDetail(runResponse.data[0].id, 0, '', false)
      }
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }, [loadDetail])

  useEffect(() => { void load() }, [load])

  const createDryRun = async () => {
    if (!file || mappings.length === 0 || !fromAccountId || !toAccountId || !purpose.trim()) {
      setMessage('移行元・移行先・利用目的と、old_uid / new_uid 列を持つCSVを選んでください。')
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(await file.text()))
      const sourceChecksum = Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, '0')).join('')
      const response = await api.friendMigrations.dryRun({
        fromAccountId, toAccountId, purpose: purpose.trim(), sourceFilename: file.name, sourceChecksum, mappings,
      })
      if (!response.success) throw new Error(response.error)
      setPage(0)
      setClassification('')
      setPendingOnly(false)
      const detail = await loadDetail(response.data.id, 0, '', false)
      if (!detail) throw new Error('結果を読み直せませんでした。')
      setRuns((current) => [{ ...detail, items: undefined }, ...current.filter((run) => run.id !== detail.id)])
      setMessage('テスト移行が完了しました。実データはまだ変更していません。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'テスト移行を実行できませんでした。')
    } finally {
      setBusy(false)
    }
  }

  const decide = async (item: UidMigrationItem, decision: 'link' | 'exclude') => {
    if (!active) return
    setBusy(true)
    setMessage(null)
    const response = await api.friendMigrations.decide(active.id, item.id, decision)
    if (!response.success) {
      setMessage(response.error)
    } else {
      const detail = await loadDetail(active.id, page, classification, pendingOnly)
      // 絞り込みで今のページが空になったら1ページ戻る。
      if (detail && (detail.items?.length ?? 0) === 0 && page > 0) {
        setPage(page - 1)
        await loadDetail(active.id, page - 1, classification, pendingOnly)
      }
    }
    setBusy(false)
  }

  // 口が返す未判断数があればそれを使い、なければ表示中の行で数える。
  const unresolved = active?.unresolved ?? active?.items?.filter((item) => item.decision === 'pending').length ?? null

  const execute = async () => {
    if (!active) return
    setBusy(true)
    const response = await api.friendMigrations.execute(active.id)
    if (response.success) {
      await loadDetail(active.id, page, classification, pendingOnly)
      setMessage('本移行と照合が完了しました。必要な場合はこの履歴から切り戻せます。')
    } else {
      setMessage(response.error)
    }
    setBusy(false)
  }

  if (status === 'loading') return <ListState kind="loading" title="UID移行を読み込んでいます" description="移行履歴とアカウントを確認しています。" />
  if (status === 'error') return <ListState kind="error" title="UID移行を表示できませんでした" description="登録した移行履歴は消えていません。" action={<Button onClick={() => void load()}>再読み込み</Button>} />

  return (
    <div data-design-node="vtBCu">
      <nav aria-label="友だち画面" className="border-hairline mb-4 flex min-h-10 items-start gap-5 border-b text-sm">
        <Link href="/friends" className="text-ink-secondary pb-3">友だち一覧</Link>
        <Link href="/friends?tab=duplicates" className="text-ink-secondary pb-3">重複検出</Link>
        <Link href="/friends?tab=merged" className="text-ink-secondary pb-3">統合ユーザー</Link>
        <span className="border-action text-action border-b-2 pb-3 font-semibold">UID移行</span>
        <a href="#migration-history" className="text-ink-secondary pb-3">移行履歴</a>
        <Button href="/friends/migrations" className="ml-auto">CSVで書き出す・取り込む</Button>
      </nav>

      <div className="bg-canvas rounded-card border-hairline mb-4 grid grid-cols-5 border">
        {STEPS.map((step, index) => <div key={step} className="border-hairline border-r px-3 py-3 last:border-r-0">
          <p className="text-action text-xs font-bold">{index === 0 ? '✓' : index + 1}　STEP {index + 1}</p>
          <p className="text-ink mt-1 text-sm font-semibold">{step}</p>
        </div>)}
      </div>

      <div className="bg-success-bg text-success mb-4 rounded-control px-4 py-3 text-sm font-medium">本移行まで、既存ユーザー・配信・シナリオには影響しません。</div>
      <section className="bg-canvas rounded-card border-hairline mb-4 border p-4">
        <div className="grid gap-3 lg:grid-cols-3">
          <label className="text-ink-secondary text-xs font-semibold">移行元<SelectField aria-label="移行元アカウント" value={fromAccountId} onChange={(event) => setFromAccountId(event.target.value)} options={[{ value: '', label: '移行元アカウントを選択' }, ...accounts.map((account) => ({ value: account.id, label: account.name }))]} /></label>
          <label className="text-ink-secondary text-xs font-semibold">移行先<SelectField aria-label="移行先アカウント" value={toAccountId} onChange={(event) => setToAccountId(event.target.value)} options={[{ value: '', label: '移行先アカウントを選択' }, ...accounts.map((account) => ({ value: account.id, label: account.name }))]} /></label>
          <label className="text-ink-secondary text-xs font-semibold">利用目的<input value={purpose} onChange={(event) => setPurpose(event.target.value)} className="border-hairline rounded-control mt-1 h-9 w-full border px-3 text-sm" /></label>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="border-hairline rounded-control cursor-pointer border px-4 py-2 text-sm font-semibold">CSVをアップロード<input type="file" accept=".csv,text/csv" className="sr-only" onChange={async (event) => {
            const selected = event.target.files?.[0] ?? null
            setFile(selected)
            if (!selected) { setMappings([]); return }
            const text = await selected.text()
            const parsed = parseUidCsv(text)
            setMappings(parsed)
            const dataLines = Math.max(text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim()).length - 1, 0)
            setMessage(dataLines > parsed.length
              ? `対応表のうち ${dataLines - parsed.length} 行は読み取れなかったため除いています。列の数と引用符を確認してください。`
              : null)
          }} /></label>
          <span className="text-ink-secondary text-sm">{file ? `${file.name}（${mappings.length.toLocaleString()}行）` : 'ファイルは未選択です'}</span>
          <Button variant="primary" disabled={busy} onClick={() => void createDryRun()}>{busy ? '確認中…' : 'テスト移行を実行'}</Button>
        </div>
        {message && <p role="status" className="text-ink-secondary mt-3 text-sm">{message}</p>}
      </section>

      {active ? <ActiveMigration
        active={active}
        unresolved={unresolved}
        page={page}
        classification={classification}
        pendingOnly={pendingOnly}
        busy={busy}
        onDecide={(item, decision) => void decide(item, decision)}
        onExecute={() => void execute()}
        onFilterChange={(nextClassification, nextPendingOnly) => {
          setClassification(nextClassification)
          setPendingOnly(nextPendingOnly)
          setPage(0)
          void loadDetail(active.id, 0, nextClassification, nextPendingOnly)
        }}
        onPageChange={(nextPage) => {
          setPage(nextPage)
          void loadDetail(active.id, nextPage, classification, pendingOnly)
        }}
      /> : <ListState kind="empty" title="テスト移行はまだありません" description="移行元・移行先と対応表を選び、まず確認だけ実行してください。" />}

      <section id="migration-history" className="bg-canvas rounded-card border-hairline border"><div className="border-hairline border-b px-4 py-3"><h2 className="text-ink text-sm font-bold">移行履歴</h2></div>{runs.length === 0 ? <ListState kind="empty" title="移行履歴はまだありません" /> : <div className="divide-hairline divide-y">{runs.map((run) => <button key={run.id} className="hover:bg-canvas-sunken flex w-full items-center justify-between px-4 py-3 text-left" onClick={() => { setPage(0); setClassification(''); setPendingOnly(false); void loadDetail(run.id, 0, '', false) }}><span><span className="text-ink block text-sm font-medium">{run.purpose}</span><span className="text-ink-faint text-xs">{new Date(run.createdAt).toLocaleString('ja-JP')} ・ {run.counts.total.toLocaleString()}件</span></span><StatusBadge tone={run.status === 'completed' ? 'success' : 'neutral'}>{run.status === 'completed' ? '反映ずみ' : '確認中'}</StatusBadge></button>)}</div>}</section>
    </div>
  )
}

function ActiveMigration({
  active,
  unresolved,
  page,
  classification,
  pendingOnly,
  busy,
  onDecide,
  onExecute,
  onFilterChange,
  onPageChange,
}: {
  active: UidMigrationDetail
  unresolved: number | null
  page: number
  classification: '' | ItemClassification
  pendingOnly: boolean
  busy: boolean
  onDecide: (item: UidMigrationItem, decision: 'link' | 'exclude') => void
  onExecute: () => void
  onFilterChange: (classification: '' | ItemClassification, pendingOnly: boolean) => void
  onPageChange: (page: number) => void
}) {
  const total = active.itemTotal ?? active.items?.length ?? 0
  const showPager = page > 0 || total > ITEM_PAGE_SIZE
  const from = total === 0 ? 0 : page * ITEM_PAGE_SIZE + 1
  const to = Math.min((page + 1) * ITEM_PAGE_SIZE, total)
  return (<>
    <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
      <SummaryCard variant="v6" title="読み込み" value={active.counts.total} unit="件" detail="対応表の全件" />
      <SummaryCard variant="v6" title="自動一致" value={active.counts.auto} unit="件" detail={active.counts.total ? `${Math.round(active.counts.auto / active.counts.total * 1000) / 10}%` : '0%'} />
      <SummaryCard variant="v6" title="要確認・競合" value={active.counts.review + active.counts.conflict} unit="件" detail="すべて判断が必要" />
      <SummaryCard variant="v6" title="未一致" value={active.counts.unmatched} unit="件" detail="除外（新規作成は取り込みで）" />
    </div>
    <div className="bg-canvas rounded-card border-hairline mb-4 overflow-hidden border">
      <div className="border-hairline flex items-center justify-between border-b px-4 py-3"><div><h2 className="text-ink text-sm font-bold">テスト移行の状態</h2><p className="text-ink-faint text-xs">実データはまだ変更していません。</p></div><StatusBadge tone={active.status === 'ready' || active.status === 'completed' ? 'success' : 'warning'}>{active.status === 'completed' ? '本移行済み' : unresolved === 0 ? '確認完了' : `要確認 ${unresolved ?? '—'}件`}</StatusBadge></div>
      <div className="border-hairline flex flex-wrap items-center gap-3 border-b px-4 py-3">
        <SelectField aria-label="分類で絞り込む" value={classification} onChange={(event) => onFilterChange(event.target.value as '' | ItemClassification, pendingOnly)} options={[{ value: '', label: 'すべての分類' }, ...ITEM_CLASSIFICATIONS.map((value) => ({ value, label: classLabel[value] }))]} />
        <label className="text-ink-secondary flex cursor-pointer items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={pendingOnly} onChange={(event) => onFilterChange(classification, event.target.checked)} className="size-4" />未判断のみ</label>
        <span className="text-ink-faint ml-auto text-xs">全 {total.toLocaleString()} 件</span>
      </div>
      {(active.items?.length ?? 0) === 0 ? <ListState kind="empty" title="対応表に結果がありません" description="絞り込みを変えるか、別のCSVを選んでテスト移行してください。" /> : <table className="w-full table-fixed">
        <thead><TableHeadRow><Th className="w-1/6">旧UID</Th><Th className="w-1/6">候補ユーザー</Th><Th className="w-1/6">一致根拠</Th><Th>競合内容</Th><Th className="w-1/12">判断</Th><Th className="w-1/6">操作</Th></TableHeadRow></thead>
        <tbody>{active.items?.map((item) => <tr key={item.id} className="border-hairline border-t align-top">
          <td className="truncate px-4 py-3 text-sm" title={item.oldUid}>{item.oldUid}</td><td className="px-4 py-3 text-sm">{item.candidateName ?? '候補なし'}</td>
          <td className="px-4 py-3"><StatusBadge tone={item.classification === 'auto' ? 'success' : item.classification === 'unmatched' ? 'neutral' : 'warning'}>{classLabel[item.classification]}</StatusBadge></td>
          <td className="text-ink-secondary px-4 py-3 text-sm">{item.conflictReason ?? '—'}</td><td className="px-4 py-3 text-sm">{item.decision === 'pending' ? '要確認' : ({ link: '結び付ける', create: '新規作成', exclude: '除外' } as const)[item.decision]}</td>
          <td className="px-4 py-3"><div className="flex flex-wrap gap-2">{item.newUid
            ? <button disabled={busy} onClick={() => onDecide(item, 'link')} className="text-action text-xs font-semibold hover:underline">移行内容を確認</button>
            : <span className="text-ink-faint text-xs">一致先なし（新規作成は「CSVで書き出す・取り込む」で行ってください）</span>}{item.decision === 'pending' && <button disabled={busy} onClick={() => onDecide(item, 'exclude')} className="text-ink-faint text-xs hover:underline">除外</button>}</div></td>
        </tr>)}</tbody>
      </table>}
      {showPager && <div className="border-hairline flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
        <p className="text-ink-secondary text-xs">{from.toLocaleString()}–{to.toLocaleString()} 件目 / 全 {total.toLocaleString()} 件</p>
        <div className="flex gap-2">
          <Button type="button" disabled={busy || page === 0} onClick={() => onPageChange(page - 1)}>前へ</Button>
          <Button type="button" disabled={busy || to >= total} onClick={() => onPageChange(page + 1)}>次へ</Button>
        </div>
      </div>}
    </div>
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3"><p className="text-ink-secondary text-sm">競合をすべて判断すると、本移行へ進めます。本移行は別のownerによる確認が必要です。</p><Button variant="primary" disabled={active.status !== 'ready' || busy} onClick={onExecute}>対応表を確定して次へ</Button></div>
  </>)
}
