'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import type { LineAccount } from '@line-crm/shared'
import { api, type UidMigrationItem, type UidMigrationRun } from '@/lib/api'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import PageHeader from '@/components/shared/page-header'
import SelectField from '@/components/shared/select-field'
import StatusBadge from '@/components/shared/status-badge'
import SummaryCard from '@/components/shared/summary-card'
import { TableHeadRow, Th } from '@/components/shared/table'

const STEPS = ['移行の登録', '対応表の取込', '事前確認', '要確認の判断', '本移行と照合'] as const

export function parseUidCsv(text: string) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim())
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map((value) => value.trim().toLowerCase())
  const oldIndex = headers.findIndex((value) => ['old_uid', '旧uid', '移行元uid'].includes(value))
  const newIndex = headers.findIndex((value) => ['new_uid', '新uid', '移行先uid'].includes(value))
  if (oldIndex < 0 || newIndex < 0) return []
  return lines.slice(1).map((line) => {
    const cells = line.split(',').map((value) => value.trim().replace(/^"|"$/g, ''))
    return { oldUid: cells[oldIndex] ?? '', newUid: cells[newIndex] || null, evidenceType: 'operator_csv' as const }
  }).filter((row) => row.oldUid)
}

const classLabel = { auto: '自動一致', review: '要確認', unmatched: '未一致', conflict: '競合' } as const

export default function AccountMigration() {
  const [accounts, setAccounts] = useState<LineAccount[]>([])
  const [runs, setRuns] = useState<UidMigrationRun[]>([])
  const [active, setActive] = useState<UidMigrationRun | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [fromAccountId, setFromAccountId] = useState('')
  const [toAccountId, setToAccountId] = useState('')
  const [purpose, setPurpose] = useState('友だち情報と配信停止状態を新しいアカウントへ引き継ぐ')
  const [file, setFile] = useState<File | null>(null)
  const [mappings, setMappings] = useState<ReturnType<typeof parseUidCsv>>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    setStatus('loading')
    try {
      const [accountResponse, runResponse] = await Promise.all([api.lineAccounts.list(), api.friendMigrations.list()])
      if (!accountResponse.success || !runResponse.success) throw new Error('load failed')
      setAccounts(accountResponse.data)
      setRuns(runResponse.data)
      setFromAccountId((value) => value || accountResponse.data[0]?.id || '')
      setToAccountId((value) => value || accountResponse.data[1]?.id || '')
      if (runResponse.data[0]) {
        const detail = await api.friendMigrations.get(runResponse.data[0].id)
        if (detail.success) setActive(detail.data)
      }
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }, [])

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
      const detail = await api.friendMigrations.get(response.data.id)
      if (!detail.success) throw new Error(detail.error)
      setActive(detail.data)
      setRuns((current) => [detail.data, ...current.filter((run) => run.id !== detail.data.id)])
      setMessage('テスト移行が完了しました。実データはまだ変更していません。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'テスト移行を実行できませんでした。')
    } finally {
      setBusy(false)
    }
  }

  const decide = async (item: UidMigrationItem, decision: 'link' | 'create' | 'exclude') => {
    if (!active) return
    setBusy(true)
    const response = await api.friendMigrations.decide(active.id, item.id, decision)
    const detail = response.success ? await api.friendMigrations.get(active.id) : null
    if (detail?.success) setActive(detail.data)
    else setMessage(response.success ? '結果を読み直せませんでした。' : response.error)
    setBusy(false)
  }

  const unresolved = active?.items?.filter((item) => item.decision === 'pending').length ?? null

  const execute = async () => {
    if (!active) return
    setBusy(true)
    const response = await api.friendMigrations.execute(active.id)
    if (response.success) {
      const detail = await api.friendMigrations.get(active.id)
      if (detail.success) setActive(detail.data)
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
      <PageHeader breadcrumb={[{ label: '友だち', href: '/friends' }, { label: 'UID移行' }]} title="UID移行"
        description="対応表を事前確認し、競合を判断してから安全に本移行します。"
        actions={<Button href="/friends/migrations">CSVで書き出す・取り込む</Button>} />

      <nav aria-label="友だち画面" className="border-hairline mb-4 flex gap-5 border-b text-sm">
        <Link href="/friends" className="text-ink-secondary pb-3">友だち一覧</Link>
        <Link href="/friends?tab=duplicates" className="text-ink-secondary pb-3">重複検出</Link>
        <Link href="/friends?tab=merged" className="text-ink-secondary pb-3">統合ユーザー</Link>
        <span className="border-action text-action border-b-2 pb-3 font-semibold">UID移行</span>
        <a href="#migration-history" className="text-ink-secondary pb-3">移行履歴</a>
      </nav>

      <div className="bg-canvas rounded-card border-hairline mb-4 grid grid-cols-5 border">
        {STEPS.map((step, index) => <div key={step} className="border-hairline border-r px-3 py-3 last:border-r-0">
          <p className="text-action text-xs font-bold">{index === 0 ? '✓' : index + 1}　STEP {index + 1}</p>
          <p className="text-ink mt-1 text-sm font-semibold">{step}</p>
        </div>)}
      </div>

      <div className="bg-success-soft text-success mb-4 rounded-control px-4 py-3 text-sm font-medium">本移行まで、既存ユーザー・配信・シナリオには影響しません。</div>
      <section className="bg-warning-bg border-warning mb-4 rounded-card border p-4">
        <h2 className="text-warning text-sm font-bold">別のLINEプロバイダーのUIDは、自動では対応づけできません。</h2>
        <p className="text-ink-secondary mt-1 text-xs leading-relaxed">プロバイダーが違うと同じ人でも別のUIDになり、LINE側に変換する仕組みがありません。確認済みの対応表を取り込み、利用目的・規約・同意も確認してください。</p>
      </section>

      <section className="bg-canvas rounded-card border-hairline mb-4 border p-4">
        <div className="grid gap-3 lg:grid-cols-3">
          <label className="text-ink-secondary text-xs font-semibold">移行元<SelectField aria-label="移行元アカウント" value={fromAccountId} onChange={(event) => setFromAccountId(event.target.value)} options={[{ value: '', label: '移行元アカウントを選択' }, ...accounts.map((account) => ({ value: account.id, label: account.name }))]} /></label>
          <label className="text-ink-secondary text-xs font-semibold">移行先<SelectField aria-label="移行先アカウント" value={toAccountId} onChange={(event) => setToAccountId(event.target.value)} options={[{ value: '', label: '移行先アカウントを選択' }, ...accounts.map((account) => ({ value: account.id, label: account.name }))]} /></label>
          <label className="text-ink-secondary text-xs font-semibold">利用目的<input value={purpose} onChange={(event) => setPurpose(event.target.value)} className="border-hairline rounded-control mt-1 h-9 w-full border px-3 text-sm" /></label>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="border-hairline rounded-control cursor-pointer border px-4 py-2 text-sm font-semibold">CSVをアップロード<input type="file" accept=".csv,text/csv" className="sr-only" onChange={async (event) => {
            const selected = event.target.files?.[0] ?? null; setFile(selected); setMappings(selected ? parseUidCsv(await selected.text()) : [])
          }} /></label>
          <span className="text-ink-secondary text-sm">{file ? `${file.name}（${mappings.length.toLocaleString()}行）` : 'ファイルは未選択です'}</span>
          <Button variant="primary" disabled={busy} onClick={() => void createDryRun()}>{busy ? '確認中…' : 'テスト移行を実行'}</Button>
        </div>
        {message && <p role="status" className="text-ink-secondary mt-3 text-sm">{message}</p>}
      </section>

      {active ? <>
        <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
          <SummaryCard variant="v6" title="読み込み" value={active.counts.total} unit="件" detail="対応表の全件" />
          <SummaryCard variant="v6" title="自動一致" value={active.counts.auto} unit="件" detail={active.counts.total ? `${Math.round(active.counts.auto / active.counts.total * 1000) / 10}%` : '0%'} />
          <SummaryCard variant="v6" title="要確認・競合" value={active.counts.review + active.counts.conflict} unit="件" detail="すべて判断が必要" />
          <SummaryCard variant="v6" title="未一致" value={active.counts.unmatched} unit="件" detail="新規作成または除外" />
        </div>
        <div className="bg-canvas rounded-card border-hairline mb-4 overflow-hidden border">
          <div className="border-hairline flex items-center justify-between border-b px-4 py-3"><div><h2 className="text-ink text-sm font-bold">テスト移行の状態</h2><p className="text-ink-faint text-xs">実データはまだ変更していません。</p></div><StatusBadge tone={active.status === 'ready' || active.status === 'completed' ? 'success' : 'warning'}>{active.status === 'completed' ? '本移行済み' : unresolved === 0 ? '確認完了' : `要確認 ${unresolved ?? '—'}件`}</StatusBadge></div>
          {(active.items?.length ?? 0) === 0 ? <ListState kind="empty" title="対応表に結果がありません" description="別のCSVを選んでテスト移行してください。" /> : <table className="w-full table-fixed">
            <thead><TableHeadRow><Th className="w-[18%]">旧UID</Th><Th className="w-[18%]">候補ユーザー</Th><Th className="w-[15%]">一致根拠</Th><Th>競合内容</Th><Th className="w-[12%]">判断</Th><Th className="w-[18%]">操作</Th></TableHeadRow></thead>
            <tbody>{active.items?.slice(0, 20).map((item) => <tr key={item.id} className="border-hairline border-t align-top">
              <td className="truncate px-4 py-3 text-sm" title={item.oldUid}>{item.oldUid}</td><td className="px-4 py-3 text-sm">{item.candidateName ?? '候補なし'}</td>
              <td className="px-4 py-3"><StatusBadge tone={item.classification === 'auto' ? 'success' : item.classification === 'unmatched' ? 'neutral' : 'warning'}>{classLabel[item.classification]}</StatusBadge></td>
              <td className="text-ink-secondary px-4 py-3 text-sm">{item.conflictReason ?? '—'}</td><td className="px-4 py-3 text-sm">{item.decision === 'pending' ? '要確認' : ({ link: '結び付ける', create: '新規作成', exclude: '除外' } as const)[item.decision]}</td>
              <td className="px-4 py-3"><div className="flex flex-wrap gap-2"><button disabled={busy} onClick={() => void decide(item, item.newUid ? 'link' : 'create')} className="text-action text-xs font-semibold hover:underline">移行内容を確認</button>{item.decision === 'pending' && <button disabled={busy} onClick={() => void decide(item, 'exclude')} className="text-ink-faint text-xs hover:underline">除外</button>}</div></td>
            </tr>)}</tbody>
          </table>}
        </div>
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3"><p className="text-ink-secondary text-sm">競合をすべて判断すると、本移行へ進めます。本移行は別のownerによる確認が必要です。</p><Button variant="primary" disabled={active.status !== 'ready' || busy} onClick={() => void execute()}>対応表を確定して次へ</Button></div>
      </> : <ListState kind="empty" title="テスト移行はまだありません" description="移行元・移行先と対応表を選び、まず確認だけ実行してください。" />}

      <section id="migration-history" className="bg-canvas rounded-card border-hairline border"><div className="border-hairline border-b px-4 py-3"><h2 className="text-ink text-sm font-bold">移行履歴</h2></div>{runs.length === 0 ? <ListState kind="empty" title="移行履歴はまだありません" /> : <div className="divide-hairline divide-y">{runs.map((run) => <button key={run.id} className="hover:bg-canvas-sunken flex w-full items-center justify-between px-4 py-3 text-left" onClick={async () => { const response = await api.friendMigrations.get(run.id); if (response.success) setActive(response.data) }}><span><span className="text-ink block text-sm font-medium">{run.purpose}</span><span className="text-ink-faint text-xs">{new Date(run.createdAt).toLocaleString('ja-JP')} ・ {run.counts.total.toLocaleString()}件</span></span><StatusBadge tone={run.status === 'completed' ? 'success' : 'neutral'}>{run.status === 'completed' ? '反映ずみ' : '確認中'}</StatusBadge></button>)}</div>}</section>
    </div>
  )
}
