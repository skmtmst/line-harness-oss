'use client'

/*
 * ★V8 LINE通知 運用者へのお知らせ（板 u8xibp）。
 *
 * 並び（絵）：数のマス4つ → 宛先の帯 → 探す・並び → 表（お知らせ・きっかけ・受け取る人・送る時間・今日・状態・操作）。
 * 「CSVで書き出す」「運用者へのお知らせを作る」は板の頭の右（screen.tsx が置く）。書き出しの理由の窓はここが持つ。
 * 口・動き（公開・止める・自分にテスト・CSV の理由）は今の部品（app/line-notifications/operator-notification-rules.tsx）と同じ。
 */
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bell, CircleX, Send, Users } from 'lucide-react'
import { usePageTitle } from '@/components/shell/page-chrome'
import { RowMenu } from '@/components/shared/row-actions'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import KpiBand from '@/components/shared/kpi-band'
import KpiCard from '@/components/shared/kpi-card'
import ListState from '@/components/shared/list-state'
import SearchField from '@/components/shared/search-field'
import Select from '@/components/shared/select'
import { TextField } from '@/components/shared/text-field'
import ListRange from '@/components/ui/list-range'
import { ApiError, api, type OperatorNotificationRule } from '@/lib/api'
import { japaneseDetailOf } from '@/components/shared/api-error-message'
import { EVENT_OPTIONS } from '../../line-notifications/operator-words'
import styles from './screen.module.css'

type LoadState = 'loading' | 'ready' | 'error' | 'forbidden'
type DraftConditions = { recipientLabel?: string; scheduleLabel?: string }
type OperatorNotificationSummary = {
  total: number
  published: number
  stopped: number
  missingRecipients: number
  recipients: number
  acceptedToday: number
  excludedToday: number
}

function conditionsOf(rule: OperatorNotificationRule): DraftConditions {
  return rule.conditions as DraftConditions
}

/** 一覧に無いきっかけは自動で動かないので、名前を作らずに注意を出す（今の部品と同じ）。 */
function eventWords(eventType: string): string {
  return EVENT_OPTIONS.find((option) => option.value === eventType)?.label ?? '接続先を確認してください'
}

/** 行の補足は「重要度」。 */
function importanceWords(rule: OperatorNotificationRule): string {
  const importance = (rule.conditions as { importance?: unknown }).importance
  if (importance === 'important') return '重要度：重要'
  if (importance === 'urgent') return '重要度：緊急'
  return '重要度：ふつう'
}

export default function OperatorTab({ lineAccountId, canManage, exportOpen, onExportClose }: {
  lineAccountId: string | null
  canManage: boolean
  /** 板の頭の「CSVで書き出す」で開く理由の窓。 */
  exportOpen: boolean
  onExportClose: () => void
}) {
  usePageTitle('運用者へのお知らせ')
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [rules, setRules] = useState<OperatorNotificationRule[]>([])
  const [summary, setSummary] = useState<OperatorNotificationSummary | null>(null)
  const [state, setState] = useState<LoadState>('loading')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null)
  const [exportReason, setExportReason] = useState('')
  const [exportError, setExportError] = useState('')

  const load = useCallback(async () => {
    if (!lineAccountId) { setRules([]); setSummary(null); setState('ready'); return }
    setState('loading')
    try {
      const result = await api.lineNotifications.operatorRules.list(lineAccountId)
      if (!result.success) throw new Error('load failed')
      setRules(result.data.items)
      setSummary(result.data.summary)
      setState('ready')
    } catch (error) {
      setRules([])
      setSummary(null)
      setState(error instanceof ApiError && error.status === 403 ? 'forbidden' : 'error')
    }
  }, [lineAccountId])

  useEffect(() => { void load() }, [load])

  /* 絞り込みは検索だけ。並びは「よく届く順」（今日届いた数が多い順）。 */
  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('ja-JP')
    return rules
      .filter((rule) => !normalized || [rule.name, eventWords(rule.eventType), conditionsOf(rule).recipientLabel]
        .some((value) => value?.toLocaleLowerCase('ja-JP').includes(normalized)))
      .sort((a, b) => b.occurredToday - a.occurredToday)
  }, [query, rules])

  const run = async (rule: OperatorNotificationRule, action: () => Promise<unknown>, done: string, failed: string) => {
    if (!lineAccountId || busy) return
    setBusy(rule.id); setNotice(null)
    try {
      await action()
      setNotice({ text: done, error: false })
      await load()
    } catch (error) {
      setNotice({ text: japaneseDetailOf(error) || failed, error: true })
    } finally { setBusy(null) }
  }

  const testSend = async (rule: OperatorNotificationRule) => {
    if (!lineAccountId || busy) return
    setBusy(rule.id); setNotice(null)
    try {
      const result = await api.lineNotifications.operatorRules.test(rule.id, lineAccountId)
      if (!result.success) throw new Error(result.error)
      setNotice({ text: result.data.accepted > 0 ? '自分へのテスト送信を受け付けました。' : '受け取れる通知方法がありません。受信設定を確認してください。', error: result.data.accepted === 0 })
      await load()
    } catch (error) {
      setNotice({ text: japaneseDetailOf(error) || 'テスト送信できませんでした。', error: true })
    } finally { setBusy(null) }
  }

  const closeExport = () => { if (busy === 'csv') return; setExportError(''); onExportClose() }
  const exportCsv = async () => {
    if (!lineAccountId || busy) return
    if (!exportReason.trim()) { setExportError('書き出す理由を入れてください。'); return }
    setBusy('csv'); setNotice(null); setExportError('')
    try {
      const blob = await api.lineNotifications.operatorRules.exportCsv(lineAccountId, exportReason.trim())
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `operator-notifications-${new Date().toISOString().slice(0, 10)}.csv`
      anchor.click()
      URL.revokeObjectURL(url)
      setNotice({ text: '実行記録をCSVで書き出しました。', error: false })
      setExportReason('')
      onExportClose()
    } catch (error) {
      setExportError(japaneseDetailOf(error) || 'CSVを書き出せませんでした。')
    } finally { setBusy(null) }
  }

  const ready = state === 'ready'
  const listState = !lineAccountId ? 'account-required' : ready && rules.length === 0 ? 'empty' : ready && visible.length === 0 ? 'filtered-empty' : state

  return <>
    <KpiBand data-kpi-presentation="cards" gridClassName={`${styles.kpis} ${styles.opKpis}`} data-design="KPIs">
      <KpiCard presentation="card" icon={<Bell size={14} aria-hidden="true" />} title="出しているお知らせ" value={ready ? summary?.published ?? null : null} unit="件" detail={ready ? `止めている ${summary?.stopped ?? '—'}` : '—'} loading={state === 'loading'} />
      <KpiCard presentation="card" icon={<Send size={14} aria-hidden="true" />} title="今日届いた数" value={ready ? summary?.acceptedToday ?? null : null} unit="件" detail="お店の人へ" loading={state === 'loading'} />
      <KpiCard presentation="card" icon={<Users size={14} aria-hidden="true" />} title="受け取る人" value={ready ? summary?.recipients ?? null : null} unit="人" detail="LINEログイン済み" loading={state === 'loading'} />
      <KpiCard presentation="card" icon={<CircleX size={14} aria-hidden="true" />} title="届かなかった" value={ready ? summary?.excludedToday ?? null : null} unit="件" detail="LINE未ログインの人" loading={state === 'loading'} />
    </KpiBand>

    <p className={`${styles.infoBand} ${styles.opBand}`}>この画面の宛先はお店の人だけです。お客様へ送るものは「顧客へのお知らせ」で設定します。</p>

    <div className={styles.toolbar}>
      <div className={styles.opSearch}>
        <SearchField aria-label="お知らせを検索" placeholder="お知らせ名・きっかけで探す" value={query} onChange={setQuery} onClear={() => setQuery('')} />
      </div>
      <div className={styles.opSort}>
        <Select aria-label="並び順" value="frequent" onChange={() => undefined} options={[{ value: 'frequent', label: 'よく届く順' }]} />
      </div>
    </div>

    {notice ? <p role={notice.error ? 'alert' : 'status'} className={styles.minor}>{notice.text}</p> : null}

    <section className={styles.table} data-design-node="DpxOK" data-list-state={listState}>
      {!lineAccountId ? <ListState kind="empty" title="LINEアカウントを選択してください" description="選択したアカウントごとに分けて管理します。" />
        : state === 'loading' ? <ListState kind="loading" title="運用者へのお知らせを読み込んでいます" />
        : state === 'error' ? <ListState kind="error" title="運用者へのお知らせを表示できませんでした" onRetry={() => void load()} />
        : state === 'forbidden' ? <ListState kind="forbidden" />
        : rules.length === 0 ? <ListState kind="empty" title="運用者へのお知らせがまだありません" action={canManage ? <Button href="/line-notifications/operator/new" variant="primary">運用者へのお知らせを作る</Button> : undefined} />
        : visible.length === 0 ? <ListState kind="empty" emptyPreset="filtered" title="条件に合うお知らせはありません" description="検索語を変えてください。" action={<Button variant="secondary" onClick={() => setQuery('')}>検索を消す</Button>} />
        : <div role="table" aria-label="運用者へのお知らせ">
          <div role="rowgroup">
            <div role="row" className={`${styles.opRow} ${styles.headRow}`}>
              <span role="columnheader">お知らせ</span>
              <span role="columnheader">きっかけ</span>
              <span role="columnheader">受け取る人</span>
              <span role="columnheader">送る時間</span>
              <span role="columnheader" className={styles.opNum}>今日</span>
              <span role="columnheader">状態</span>
              <span role="columnheader">{canManage ? '操作' : ''}</span>
            </div>
          </div>
          <div role="rowgroup">
            {visible.map((rule) => {
              const published = rule.status === 'published'
              const recipients = conditionsOf(rule).recipientLabel ?? (rule.recipientCount > 0 ? `${rule.recipientCount}人` : '受け取れる人なし')
              const schedule = conditionsOf(rule).scheduleLabel ?? 'いつでも'
              return <div role="row" key={rule.id} className={styles.opRow}>
                <span role="cell" className={styles.opName}>
                  {/* 名前から編集画面へ。保存したお知らせを開き直して直せる。 */}
                  <Link href={`/line-notifications/operator/new?id=${encodeURIComponent(rule.id)}`} className={styles.opNameLink} title={rule.name}>{rule.name}</Link>
                  <span className={styles.opSub}>{importanceWords(rule)}</span>
                </span>
                <span role="cell" className={styles.cell} title={eventWords(rule.eventType)}>{eventWords(rule.eventType)}</span>
                <span role="cell" className={styles.cell} title={recipients}>{recipients}</span>
                <span role="cell" className={styles.cell} title={schedule}>{schedule}</span>
                <span role="cell" className={`${styles.opNum} ${rule.occurredToday > 0 ? styles.numStrong : styles.numFaint}`}>{rule.occurredToday > 0 ? `${rule.occurredToday}` : '—'}</span>
                <span role="cell"><span className={styles.status} data-tone={published ? 'good' : 'muted'}><span className={styles.dot} aria-hidden="true" />{published ? '出している' : '止めている'}</span></span>
                <span role="cell" className={styles.opActions}>
                  {canManage ? <>
                    <Button variant="secondary" onClick={() => void testSend(rule)} disabled={busy === rule.id}>自分にテスト</Button>
                    <RowMenu
                      label={`${rule.name}の操作`}
                      open={openMenuId === rule.id}
                      onOpenChange={(next) => setOpenMenuId(next ? rule.id : null)}
                      items={rule.status === 'draft'
                        ? [{ id: 'publish', label: '公開', disabled: busy === rule.id || rule.recipientCount === 0, disabledReason: rule.recipientCount === 0 ? '受け取る人を決めてください' : undefined, onSelect: () => { setOpenMenuId(null); void run(rule, () => api.lineNotifications.operatorRules.publish(rule.id, lineAccountId), `「${rule.name}」を公開しました。`, '公開できませんでした。') } }]
                        : [{ id: 'stop', label: '止める', disabled: busy === rule.id, onSelect: () => { setOpenMenuId(null); void run(rule, () => api.lineNotifications.operatorRules.stop(rule.id, lineAccountId), `「${rule.name}」を止めました。`, '停止できませんでした。') } }]}
                    />
                  </> : null}
                </span>
              </div>
            })}
          </div>
        </div>}
    </section>
    {ready && rules.length > 0 ? <ListRange total={summary?.total ?? rules.length} first={1} last={rules.length} /> : null}

    <ConfirmDialog
      open={exportOpen && canManage}
      title="CSVを書き出す理由"
      description="個人情報を含むため、確認した目的を記録します。"
      confirmLabel="書き出す"
      busy={busy === 'csv'}
      error={exportError || undefined}
      onConfirm={() => void exportCsv()}
      onCancel={closeExport}
    >
      <TextField aria-label="書き出す理由" value={exportReason} onChange={(event) => setExportReason(event.target.value)} placeholder="例：月次の運用確認" autoFocus />
    </ConfirmDialog>
  </>
}
