'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import type { LineAccount } from '@line-crm/shared'
import { api, ApiError, type FriendMigrationJob } from '@/lib/api'
import { describeApiFailure, japaneseDetailOf } from '@/components/shared/api-error-message'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import Disclosure from '@/components/shared/disclosure'
import Notice from '@/components/shared/notice'
import FileDropzone, { AttachmentRow } from '@/components/shared/file-drop'
import HelpTip from '@/components/shared/help-tip'
import ListState from '@/components/shared/list-state'
import PageHeader from '@/components/shared/page-header'
import { usePageTitle } from '@/components/shell/page-chrome'
import Select from '@/components/shared/select'
import StatusBadge from '@/components/shared/status-badge'
import KpiCard from '@/components/shared/kpi-card'
import ListRange from '@/components/ui/list-range'
import { TableHeadRow, Th } from '@/components/shared/table'
import { parseFriendCsv, type FriendImportRow } from './friend-csv'
import { formatDateTime, formatNumber } from '@/lib/format'

type ImportSummary = { add: number; update: number; unchanged: number; conflict: number; error: number }

const JOB_STATUS_LABELS: Record<string, string> = {
  completed: '反映ずみ', previewed: '確認まで', expired: '期限切れ', failed: '失敗',
}

// 取り込みファイルの上限（#496-22）。全文を画面のメモリへ読むため、
// 大きすぎるファイルは固まる前に断る。5000行の取り込み上限に対し十分な大きさ。
const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024

/** 選んだCSVの大きさを行に出すだけの短い表記。 */
function formatImportBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024) * 10) / 10}MB`
  return `${Math.max(1, Math.round(bytes / 1024))}KB`
}

export default function FriendMigrationsPage() {
  // ★V7: 画面の題は上の帯だけ。本文の PageHeader は説明だけ残し、見出しは帯と同じ言葉にして隠す。
  usePageTitle('UID・顧客データ移行')
  const [accounts, setAccounts] = useState<LineAccount[]>([])
  const [accountId, setAccountId] = useState('')
  const [jobs, setJobs] = useState<FriendMigrationJob[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'forbidden'>('loading')
  // M016：書き出し・取り込みは owner/admin 専用。押せる人かで案内を変える目安。
  const [role, setRole] = useState('')
  // R114: タグ・友だち情報と対応情報の書き出しは未接続のため、初期選択は
  // 実際に出る基本だけにする。選べるのに出ない状態を作らない。
  const [columns, setColumns] = useState<Array<'basic' | 'tags_fields' | 'support'>>(['basic'])
  // Shift_JIS書き出しはAPI未対応(#496-5)。対応までUTF-8固定で、選択肢は出さない。
  const encoding = 'utf-8' as const
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
    } catch (caught) {
      // M016：読み込み 403 は権限不足として分ける（押しても直らない再試行は出さない）。
      setStatus(caught instanceof ApiError && caught.status === 403 ? 'forbidden' : 'error')
    }
  }, [])

  useEffect(() => {
    void load()
    try {
      setRole(window.localStorage.getItem('lh_staff_role') ?? '')
    } catch {
      // ストレージが使えなくても画面は出せる
    }
  }, [load])

  /*
   * M016：操作の失敗は原文（`API error: NNN`・英語生文）のまま出さない。
   * 安全なサーバ文があればそのまま、無ければ共通の状態別案内へ渡す。
   */
  const MANAGE_FORBIDDEN = '書き出し・取り込みの操作はオーナーか管理者だけができます。必要なときはオーナーか管理者の方に操作してもらってください。'
  const operationFailureMessage = (caught: unknown, action: string): string =>
    japaneseDetailOf(caught) || describeApiFailure(caught, action, { forbidden: MANAGE_FORBIDDEN })
  // 役割が分かっていて owner/admin でないときだけ、ボタンの近くに理由を出す。
  const manageLocked = role !== '' && role !== 'owner' && role !== 'admin'

  const toggleColumn = (column: 'basic' | 'tags_fields' | 'support') => {
    setColumns((current) => current.includes(column) ? current.filter((value) => value !== column) : [...current, column])
  }

  const createExport = async () => {
    if (!accountId || columns.length === 0) { setMessage('対象と書き出す項目を選んでください。'); return }
    setBusy(true); setMessage(null)
    try {
      const response = await api.friendMigrations.createExport({ accountId, columns, encoding })
      if (!response.success) { setMessage(response.error); return }
      setExportResult(response.data)
      setMessage('書き出しを作りました。ダウンロードできる期間は7日です。')
      await load()
    } catch (error) { setMessage(operationFailureMessage(error, '書き出し')) }
    finally { setBusy(false) }
  }

  const onPickFile = async (selected: File | null) => {
    setSummary(null)
    if (!selected) { setFile(null); setRows([]); return }
    // 元バイトで重複判定の指紋を取る（再符号化した文の指紋では意味が薄れる、#496-22）。
    // UTF-8以外（Shift_JIS等）は文字化けするため、UTF-8の案内とセットで断る。
    if (selected.size > MAX_IMPORT_FILE_BYTES) {
      setFile(null); setRows([])
      setMessage('ファイルが大きすぎます（上限5MB）。分割するか、UTF-8で保存し直してください。')
      return
    }
    setFile(selected)
    try {
      setRows(parseFriendCsv(await selected.text()))
    } catch {
      setRows([])
      setMessage('CSVを読めませんでした。UTF-8のCSVを選んでください。')
    }
  }

  const previewImport = async () => {
    if (!accountId || !file || rows.length === 0) { setMessage('このシステムから書き出したCSVを選んでください。'); return }
    setBusy(true); setMessage(null)
    try {
      const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
      const sourceChecksum = Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, '0')).join('')
      const response = await api.friendMigrations.previewImport({ accountId, sourceFilename: file.name, sourceChecksum, rows })
      if (!response.success) { setMessage(response.error); return }
      setImportId(response.data.id); setSummary(response.data.result.summary)
      setMessage(response.data.duplicate ? '同じファイルの確認結果を表示しました。二重には反映しません。' : '確認だけ完了しました。まだ友だち情報は変更していません。')
      await load()
    } catch (error) { setMessage(operationFailureMessage(error, '確認')) }
    finally { setBusy(false) }
  }

  /*
   * M015：反映の失敗で画面が固まっていた（try/catch が無く、throw が
   * 未捕捉になり busy が戻らなかった）。失敗文を出して busy を戻し、
   * 履歴を読み直す。
   */
  const executeImport = async () => {
    if (!importId || busy) return
    setBusy(true)
    try {
      const response = await api.friendMigrations.executeImport(importId)
      setMessage(response.success ? `${response.data.applied ?? 0}件を反映しました。` : response.error)
    } catch (error) {
      setMessage(operationFailureMessage(error, '反映'))
    } finally {
      setBusy(false)
    }
    await load()
  }

  if (status === 'loading') return <ListState kind="loading" title="書き出し・取り込みを読み込んでいます" />
  if (status === 'forbidden') return <ListState kind="forbidden" title="書き出し・取り込みを見る権限がありません" description="見るには権限が要ります。オーナーか管理者の方に確認してください。" />
  if (status === 'error') return <ListState kind="error" title="書き出し・取り込みを表示できませんでした" description="履歴は消えていません。" action={<Button onClick={() => void load()}>再読み込み</Button>} />

  {/* カード同士の縦の間隔はこの親の gap-4（16px）だけで作る。子ごとの mb/mt は付けない。 */}
  return <div data-design-node="ux7of" className="flex flex-col gap-4">
    <PageHeader breadcrumb={[{ label: '友だち', href: '/friends' }, { label: 'UID・顧客データ移行' }]} title="UID・顧客データ移行"
      description="友だち情報をCSVで安全に書き出し、確認してから取り込みます。" />
    <nav aria-label="移行画面" className="border-hairline flex gap-6 border-b text-sm">
      <Link href="/accounts?tab=migration" className="text-ink-secondary pb-3">UIDの移行</Link>
      <span className="border-action text-action border-b-2 pb-3 font-semibold">CSVで書き出す・取り込む</span>
    </nav>
    <Notice tone="info" message="書き出しても友だちの情報は変わりません。取り込みは、まず確認だけを実行できます。" className="mb-4" />
    <Disclosure size="compact" title="取り込みの内訳の見方" hint="追加・更新など5区分" className="mb-4">
      <p className="text-sm">取り込みは「追加・更新・変更なし・競合・エラー」の内訳を先に見せます。反映後も、いつ誰が操作したかを履歴に残します。</p>
    </Disclosure>

    <div className="grid gap-4 xl:grid-cols-2">
      <section className="bg-canvas rounded-card border-hairline border p-4">
        <h2 className="text-ink text-base font-bold">CSVで書き出す</h2>
        <label className="text-ink-secondary mt-4 block text-xs font-semibold">対象<Select aria-label="書き出すLINEアカウント" value={accountId} onChange={(value) => setAccountId(value)} options={[{ value: '', label: 'アカウントを選択' }, ...accounts.map((account) => ({ value: account.id, label: account.name }))]} /></label>
        <fieldset className="mt-4 space-y-2"><legend className="text-ink-secondary mb-2 text-xs font-semibold">書き出す項目<HelpTip label="書き出す項目の説明">基本はLINEユーザーID・LINE表示名・本名・システム表示名・登録日の5列です。この5列はそのまま取り込めます。</HelpTip></legend>
          {([['basic', '基本（名前・LINEアカウント・登録日）', false], ['tags_fields', 'タグ・友だち情報', true], ['support', '対応状況・対応マーク・担当者', true]] as const).map(([value, label, unavailable]) => <Checkbox key={value} checked={columns.includes(value)} onCheckedChange={() => toggleColumn(value)} disabled={unavailable} description={unavailable ? 'まだ書き出せません' : undefined}>{label}</Checkbox>)}
        </fieldset>
        <p className="text-ink-secondary mt-2 text-xs">今書き出せるのは基本の5列だけです。タグ・友だち情報、対応情報は入りません。</p>
        <p className="text-ink-secondary mt-4 text-sm">文字コード： UTF-8</p><p className="text-ink-faint mt-1 text-xs">Shift_JISの書き出しはまだ使えません。今はUTF-8を選んでください。</p>
        <div className="mt-4 flex items-center gap-3"><Button variant="primary" disabled={busy} onClick={() => void createExport()}>書き出しを作る</Button>{exportResult && <a className="text-action text-sm font-semibold hover:underline" href={`${process.env.NEXT_PUBLIC_API_URL ?? ''}${exportResult.downloadUrl}`}>CSVをダウンロード（{exportResult.rowCount ?? '—'}件）</a>}</div>
        {manageLocked ? <p className="text-ink-secondary mt-2 text-xs">{MANAGE_FORBIDDEN}</p> : null}
        <p className="text-ink-faint mt-2 text-xs">件数が多いときは、できあがったらお知らせします。ダウンロードできる期間は7日です。</p>
      </section>

      <section className="bg-canvas rounded-card border-hairline border p-4">
        <h2 className="text-ink text-base font-bold">CSVを取り込む</h2>
        {/*
          確認・反映は1回ずつのAPI呼び出しで、途中の割合を測れない。
          実測できない進みは出さない（Progress は足さない）。
        */}
        <FileDropzone
          title="ここにCSVを置く"
          hint="このシステムから書き出したUTF-8のCSVは、そのまま取り込めます（上限5MB）"
          accept=".csv,text/csv"
          onFiles={(files) => void onPickFile(files[0] ?? null)}
          className="mt-4"
        />
        {file ? (
          <div className="mt-2">
            <AttachmentRow
              name={file.name}
              meta={`${formatNumber(rows.length)}行・${formatImportBytes(file.size)}`}
              onRemove={() => void onPickFile(null)}
            />
          </div>
        ) : null}
        <div className="mt-4 flex items-center gap-3"><Button variant="primary" disabled={busy} onClick={() => void previewImport()}>まず確認だけする</Button><span className="text-ink-faint text-xs">確認の結果を見てから反映</span></div>
        {manageLocked ? <p className="text-ink-secondary mt-2 text-xs">{MANAGE_FORBIDDEN}</p> : null}
        {summary && <><h3 className="text-ink mt-5 text-sm font-bold">確認の結果</h3><div className="mt-2 grid grid-cols-5 gap-2"><KpiCard variant="v6" title="追加" value={summary.add} unit="件" detail="" help="新しく登録する件数です" /><KpiCard variant="v6" title="更新" value={summary.update} unit="件" detail="" help="値を変更する件数です" /><KpiCard variant="v6" title="変更なし" value={summary.unchanged} unit="件" detail="" help="同じ内容の件数です" /><KpiCard variant="v6" title="競合" value={summary.conflict} unit="件" detail="判断が必要" /><KpiCard variant="v6" title="エラー" value={summary.error} unit="件" detail="直して再確認" /></div>{importId && <div className="mt-4"><Button disabled={summary.conflict + summary.error > 0 || busy} onClick={() => void executeImport()}>確認した内容を反映</Button></div>}</>}
        <p className="text-ink-faint mt-4 text-xs leading-relaxed">LINEのユーザーIDとLINEアカウントは、既存行の取り込みでは変わりません。同じファイルをもう一度入れても二重には反映しません。</p>
      </section>
    </div>
    {message && <p role="status" className="bg-action-soft text-action rounded-control px-4 py-3 text-sm">{message}</p>}

    <section className="bg-canvas rounded-card border-hairline overflow-hidden border"><div className="border-hairline border-b px-4 py-3"><h2 className="text-ink flex items-center gap-1 text-sm font-bold">書き出し・取り込みの履歴<HelpTip label="状態の札の意味">反映ずみは反映が終わったもの、確認までは確認待ち、期限切れは確認の期限が過ぎたものです。</HelpTip></h2></div>{jobs.length === 0 ? <ListState kind="empty" title="履歴はまだありません" description="書き出しまたは取り込みを実行すると、ここに残ります。" /> : <><table className="w-full"><thead><TableHeadRow>{/*
                  表の外側の余白は左右で同じにする。状態の札は中身の幅で固定し、
                  残りは本文の列で吸収する。
                */}<Th className="pl-5">日時</Th><Th>種類</Th><Th>対象</Th><Th>件数</Th><Th>実行した人</Th><Th className="w-28 pr-5">状態</Th></TableHeadRow></thead><tbody>{jobs.map((job) => <tr key={`${job.kind}-${job.id}`} className="border-hairline border-t"><td className="py-3 pr-4 pl-5 text-sm"><span className="block">{formatDateTime(job.created_at)}</span></td><td className="px-4 py-3 text-sm">{job.kind === 'export' ? '書き出し' : '取り込み'}</td><td className="px-4 py-3 text-sm">{accounts.find((account) => account.id === job.line_account_id)?.name ?? '—'}</td>{/*
                  m22d: 単位は見出しの「件数」が持つ。行ごとに「○件」と書くと、
                  同じ数が並んだだけで同じ件数が3回出る。一覧の件数は下の
                  ListRangeの1か所に出す。
                */}<td className="px-4 py-3 text-sm tabular-nums">{job.row_count ?? job.total_count ?? '—'}</td><td className="px-4 py-3 text-sm">{job.created_by_name}</td><td className="py-3 pr-5 pl-4"><StatusBadge tone={job.status === 'completed' ? 'success' : 'neutral'}>{JOB_STATUS_LABELS[job.status] ?? '確認中'}</StatusBadge>{/*
                  定期実行分も含め、完成していて期限内の書き出しは履歴から
                  そのまま落とせる（定期分は新しい表や配信経路を増やさず、
                  いまのダウンロード経路を使う）。
                */}{job.kind === 'export' && job.status === 'completed' && (!job.expires_at || job.expires_at > new Date().toISOString()) ? <a className="text-action mt-1 block text-xs font-semibold hover:underline" href={`${process.env.NEXT_PUBLIC_API_URL ?? ''}/api/friends/exports/${job.id}/download`}>CSVをダウンロード</a> : null}</td></tr>)}</tbody></table><div className="border-hairline border-t px-5 py-3">{/* m22d: 一覧の件数はこの1か所。行の数字の単位は見出しの「件数」。 */}<ListRange label="履歴" total={jobs.length} first={jobs.length === 0 ? 0 : 1} last={jobs.length} /></div></>}</section>
  </div>
}
