'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import type { LineAccount } from '@line-crm/shared'
import { api, type FriendMigrationJob } from '@/lib/api'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import PageHeader from '@/components/shared/page-header'
import SelectField from '@/components/shared/select-field'
import StatusBadge from '@/components/shared/status-badge'
import SummaryCard from '@/components/shared/summary-card'
import { TableHeadRow, Th } from '@/components/shared/table'
import { parseFriendCsv, type FriendImportRow } from './friend-csv'

type ImportSummary = { add: number; update: number; unchanged: number; conflict: number; error: number }

const JOB_STATUS_LABELS: Record<string, string> = {
  completed: '反映ずみ', previewed: '確認まで', expired: '期限切れ', failed: '失敗',
}

export default function FriendMigrationsPage() {
  const [accounts, setAccounts] = useState<LineAccount[]>([])
  const [accountId, setAccountId] = useState('')
  const [jobs, setJobs] = useState<FriendMigrationJob[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [columns, setColumns] = useState<Array<'basic' | 'tags_fields' | 'support'>>(['basic', 'tags_fields'])
  const [encoding, setEncoding] = useState<'utf-8' | 'shift_jis'>('utf-8')
  const [exportResult, setExportResult] = useState<{ rowCount: number | null; downloadUrl: string } | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [rows, setRows] = useState<FriendImportRow[]>([])
  const [importId, setImportId] = useState<string | null>(null)
  const [summary, setSummary] = useState<ImportSummary | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    setStatus('loading')
    try {
      const [accountResponse, jobResponse] = await Promise.all([api.lineAccounts.list(), api.friendMigrations.jobs()])
      if (!accountResponse.success || !jobResponse.success) throw new Error('load failed')
      setAccounts(accountResponse.data)
      setAccountId((value) => value || accountResponse.data[0]?.id || '')
      setJobs(jobResponse.data)
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const toggleColumn = (column: 'basic' | 'tags_fields' | 'support') => {
    setColumns((current) => current.includes(column) ? current.filter((value) => value !== column) : [...current, column])
  }

  const createExport = async () => {
    if (!accountId || columns.length === 0) { setMessage('対象と書き出す項目を選んでください。'); return }
    setBusy(true); setMessage(null)
    try {
      const response = await api.friendMigrations.createExport({ accountId, columns, encoding })
      if (!response.success) throw new Error(response.error)
      setExportResult(response.data)
      setMessage('書き出しを作りました。ダウンロードできる期間は7日です。')
      await load()
    } catch (error) { setMessage(error instanceof Error ? error.message : '書き出しを作れませんでした。') }
    finally { setBusy(false) }
  }

  const previewImport = async () => {
    if (!accountId || !file || rows.length === 0) { setMessage('このシステムから書き出したCSVを選んでください。'); return }
    setBusy(true); setMessage(null)
    try {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(await file.text()))
      const sourceChecksum = Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, '0')).join('')
      const response = await api.friendMigrations.previewImport({ accountId, sourceFilename: file.name, sourceChecksum, rows })
      if (!response.success) throw new Error(response.error)
      setImportId(response.data.id); setSummary(response.data.result.summary)
      setMessage(response.data.duplicate ? '同じファイルの確認結果を表示しました。二重には反映しません。' : '確認だけ完了しました。まだ友だち情報は変更していません。')
      await load()
    } catch (error) { setMessage(error instanceof Error ? error.message : '取り込みを確認できませんでした。') }
    finally { setBusy(false) }
  }

  if (status === 'loading') return <ListState kind="loading" title="書き出し・取り込みを読み込んでいます" />
  if (status === 'error') return <ListState kind="error" title="書き出し・取り込みを表示できませんでした" description="履歴は消えていません。" action={<Button onClick={() => void load()}>再読み込み</Button>} />

  return <div data-design-node="ux7of">
    <PageHeader breadcrumb={[{ label: '友だち', href: '/friends' }, { label: 'UID・顧客データ移行' }]} title="UID・顧客データ移行"
      description="友だち情報をCSVで安全に書き出し、確認してから取り込みます。" />
    <nav aria-label="移行画面" className="border-hairline mb-4 flex gap-6 border-b text-sm">
      <Link href="/accounts?tab=migration" className="text-ink-secondary pb-3">UIDの移行</Link>
      <span className="border-action text-action border-b-2 pb-3 font-semibold">CSVで書き出す・取り込む</span>
    </nav>
    <div className="bg-success-bg text-success mb-4 rounded-control px-4 py-3 text-sm">書き出しても友だちの情報は変わりません。取り込みは、まず確認だけを実行できます。</div>
    <p className="text-ink-secondary mb-4 text-sm">取り込みは「追加・更新・変更なし・競合・エラー」の内訳を先に見せます。反映後も、いつ誰が操作したかを履歴に残します。</p>

    <div className="grid gap-4 xl:grid-cols-2">
      <section className="bg-canvas rounded-card border-hairline border p-4">
        <h2 className="text-ink text-base font-bold">CSVで書き出す</h2>
        <label className="text-ink-secondary mt-4 block text-xs font-semibold">対象<SelectField aria-label="書き出すLINEアカウント" value={accountId} onChange={(event) => setAccountId(event.target.value)} options={[{ value: '', label: 'アカウントを選択' }, ...accounts.map((account) => ({ value: account.id, label: account.name }))]} /></label>
        <fieldset className="mt-4 space-y-2"><legend className="text-ink-secondary mb-2 text-xs font-semibold">書き出す項目</legend>
          {([['basic', '基本（名前・LINEアカウント・登録日）'], ['tags_fields', 'タグ・友だち情報'], ['support', '対応状況・対応マーク・担当者']] as const).map(([value, label]) => <label key={value} className="text-ink flex items-center gap-2 text-sm"><input type="checkbox" checked={columns.includes(value)} onChange={() => toggleColumn(value)} />{label}</label>)}
        </fieldset>
        <p className="text-ink-faint mt-2 text-xs">電話番号やメールなどの個人情報は、見る権限がある人だけ選べます。</p>
        <fieldset className="mt-4 flex gap-4"><legend className="text-ink-secondary mb-2 text-xs font-semibold">文字コード</legend><label className="text-sm"><input type="radio" checked={encoding === 'utf-8'} onChange={() => setEncoding('utf-8')} /> UTF-8（おすすめ）</label><label className="text-sm"><input type="radio" checked={encoding === 'shift_jis'} onChange={() => setEncoding('shift_jis')} /> Shift_JIS</label></fieldset>
        <div className="mt-4 flex items-center gap-3"><Button variant="primary" disabled={busy} onClick={() => void createExport()}>書き出しを作る</Button>{exportResult && <a className="text-action text-sm font-semibold hover:underline" href={`${process.env.NEXT_PUBLIC_API_URL ?? ''}${exportResult.downloadUrl}`}>CSVをダウンロード（{exportResult.rowCount ?? '—'}件）</a>}</div>
        <p className="text-ink-faint mt-2 text-xs">件数が多いときは、できあがったらお知らせします。ダウンロードできる期間は7日です。</p>
      </section>

      <section className="bg-canvas rounded-card border-hairline border p-4">
        <h2 className="text-ink text-base font-bold">CSVを取り込む</h2>
        <div className="border-hairline bg-canvas-sunken mt-4 rounded-card border border-dashed p-6 text-center"><p className="text-ink text-sm font-medium">ここにCSVを置くか、ファイルを選んでください。</p><p className="text-ink-faint mt-1 text-xs">このシステムから書き出したCSVは、そのまま取り込めます。</p><label className="border-hairline bg-canvas rounded-control mt-3 inline-block cursor-pointer border px-4 py-2 text-sm font-semibold">ファイルを選ぶ<input type="file" accept=".csv,text/csv" className="sr-only" onChange={async (event) => { const selected = event.target.files?.[0] ?? null; setFile(selected); setRows(selected ? parseFriendCsv(await selected.text()) : []); setSummary(null) }} /></label>{file && <p className="text-ink-secondary mt-2 text-sm">{file.name}（{rows.length.toLocaleString()}行）</p>}</div>
        <div className="mt-4 flex items-center gap-3"><Button variant="primary" disabled={busy} onClick={() => void previewImport()}>まず確認だけする</Button><span className="text-ink-faint text-xs">確認の結果を見てから反映</span></div>
        {summary && <><h3 className="text-ink mt-5 text-sm font-bold">確認の結果</h3><div className="mt-2 grid grid-cols-5 gap-2"><SummaryCard variant="v6" title="追加" value={summary.add} unit="件" detail="新しく登録" /><SummaryCard variant="v6" title="更新" value={summary.update} unit="件" detail="値を変更" /><SummaryCard variant="v6" title="変更なし" value={summary.unchanged} unit="件" detail="同じ内容" /><SummaryCard variant="v6" title="競合" value={summary.conflict} unit="件" detail="判断が必要" /><SummaryCard variant="v6" title="エラー" value={summary.error} unit="件" detail="直して再確認" /></div>{importId && <div className="mt-4"><Button disabled={summary.conflict + summary.error > 0 || busy} onClick={async () => { setBusy(true); const response = await api.friendMigrations.executeImport(importId); setMessage(response.success ? `${response.data.applied ?? 0}件を反映しました。` : response.error); setBusy(false); await load() }}>確認した内容を反映</Button></div>}</>}
        <p className="text-ink-faint mt-4 text-xs leading-relaxed">LINEのユーザーIDとLINEアカウントは、既存行の取り込みでは変わりません。同じファイルをもう一度入れても二重には反映しません。</p>
      </section>
    </div>
    {message && <p role="status" className="bg-action-soft text-action mt-4 rounded-control px-4 py-3 text-sm">{message}</p>}

    <section className="bg-canvas rounded-card border-hairline mt-4 overflow-hidden border"><div className="border-hairline border-b px-4 py-3"><h2 className="text-ink text-sm font-bold">書き出し・取り込みの履歴</h2></div>{jobs.length === 0 ? <ListState kind="empty" title="履歴はまだありません" description="書き出しまたは取り込みを実行すると、ここに残ります。" /> : <table className="w-full"><thead><TableHeadRow><Th>日時</Th><Th>種類</Th><Th>対象</Th><Th>件数</Th><Th>実行した人</Th><Th>状態</Th></TableHeadRow></thead><tbody>{jobs.map((job) => <tr key={`${job.kind}-${job.id}`} className="border-hairline border-t"><td className="px-4 py-3 text-sm">{new Date(job.created_at).toLocaleString('ja-JP')}</td><td className="px-4 py-3 text-sm">{job.kind === 'export' ? '書き出し' : '取り込み'}</td><td className="px-4 py-3 text-sm">{accounts.find((account) => account.id === job.line_account_id)?.name ?? '—'}</td><td className="px-4 py-3 text-sm">{job.row_count ?? job.total_count ?? '—'}件</td><td className="px-4 py-3 text-sm">{job.created_by_name}</td><td className="px-4 py-3"><StatusBadge tone={job.status === 'completed' ? 'success' : 'neutral'}>{JOB_STATUS_LABELS[job.status] ?? '確認中'}</StatusBadge></td></tr>)}</tbody></table>}</section>
  </div>
}
