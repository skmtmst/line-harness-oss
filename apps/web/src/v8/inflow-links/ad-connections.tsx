'use client'

/*
 * ★V8 広告とのつなぎ（Pencil `FDBsG`・`/inflow-links?tab=connections`）。
 *
 * 2026-10-07 src/v8 に一から書いた（今の V8 は 13%）。頭は広告連携（qSTVR）と同じ形。
 * 本文（間14）：返すしくみの3枚 → 数の4枚（共通の数の帯）→ 成果地点と広告に返す名前の対応（F-21）→ 注。
 * 呼ぶ口：送信記録の30日の集計（今と同じ）・対応表 `GET /api/ad-platforms/mappings`（F-21）・
 * 結びつける `PUT /api/ad-platforms/mappings/:pointId`（owner・admin）。BEHAVIOR.md の「広告とのつなぎ」。
 */
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Clock, Eye, History, RotateCw, Send, XCircle } from 'lucide-react'
import type { AdEventMapping } from '@line-crm/shared'
import { api } from '@/lib/api'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import Button from '@/components/shared/button'
import KpiBand from '@/components/shared/kpi-band'
import KpiCard from '@/components/shared/kpi-card'
import ListState from '@/components/shared/list-state'
import Select from '@/components/shared/select'
import StatusBadge from '@/components/shared/status-badge'
import { adMappingReturns, groupAdMappings, useAdLogs, type AdMappingRow } from './ad-shared'
import adsStyles from './ads.module.css'
import styles from './ad-pages.module.css'

const STEPS = [
  { title: 'クリックの目印を持ち帰る', text: '広告から中継リンクを通った人の目印を残します。中継リンクを通らないと広告と結びつきません。' },
  { title: '成果が出たら順に送る', text: '成果地点で数えたら、待ち行列に入れてから広告へ送ります。' },
  { title: '同じ成果は2回送らない', text: 'やり直しても同じ目印を使います。広告側で2重に数えられません。' },
] as const

type MappingState = { kind: 'loading' } | { kind: 'ready'; rows: AdMappingRow[] } | { kind: 'error' }

export default function AdConnectionsV8() {
  usePageTitle('広告とのつなぎ')
  usePageCrumbs([
    { label: 'ホーム', href: '/' },
    { label: '流入と計測', href: '/inflow-links' },
  ])
  const role = useStaffRole()
  /* 結びつけ（PUT）は owner・admin。役割が読めるまでは出さない（押すと 403 になるため）。 */
  const manage = canManageRole(role)
  const readonly = role !== null && !manage
  const model = useAdLogs({ page: 1, status: 'all', query: '' })
  const accountId = model.selectedAccountId
  const [mapping, setMapping] = useState<MappingState>({ kind: 'loading' })
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [saveError, setSaveError] = useState('')
  const generationRef = useRef(0)

  const loadMappings = useCallback(async () => {
    const generation = ++generationRef.current
    if (!accountId) {
      setMapping({ kind: 'ready', rows: [] })
      return
    }
    setMapping({ kind: 'loading' })
    try {
      const res = await api.adPlatforms.mappings(accountId)
      if (generation !== generationRef.current) return
      setMapping(res.success ? { kind: 'ready', rows: groupAdMappings(res.data) } : { kind: 'error' })
    } catch {
      if (generation === generationRef.current) setMapping({ kind: 'error' })
    }
  }, [accountId])

  useEffect(() => {
    void loadMappings()
    return () => { generationRef.current += 1 }
  }, [loadMappings])

  /*
   * WEB041：前のアカウントで押した保存の結果で、今のアカウントの対応表を
   * 読み直さない（前のアカウントの古い読み直しが今の表を上書きする）。
   * 切り替えたら保存中・失敗の文も捨てる。
   */
  const accountRef = useRef(accountId)
  accountRef.current = accountId
  useEffect(() => {
    setSavingKey(null)
    setSaveError('')
  }, [accountId])

  /* 結びつけない ⇔ 自動で返す（口が出す自動の名前）。版が合わないと 409（ほかの人が先に変えた）。 */
  const saveMode = async (item: AdEventMapping, mode: 'auto' | 'off') => {
    if (!accountId || savingKey) return
    const key = `${item.pointId}:${item.provider}`
    const accountAtStart = accountId
    const moved = () => accountRef.current !== accountAtStart
    setSavingKey(key)
    setSaveError('')
    try {
      const res = await api.adPlatforms.saveMapping(item.pointId, {
        account_id: accountId,
        provider: item.provider,
        mode,
        expectedVersion: item.version,
      })
      if (moved()) return
      if (!res.success) setSaveError(res.error ?? '対応を保存できませんでした。読み直してからもう一度お試しください。')
      await loadMappings()
    } catch {
      if (moved()) return
      setSaveError('対応を保存できませんでした。通信状態を確かめて、もう一度お試しください。')
    } finally {
      if (!moved()) setSavingKey(null)
    }
  }

  const nameCell = (item: AdEventMapping | null, label: string) => {
    if (adMappingReturns(item)) return <span className={styles.cellText} title={item!.eventName ?? ''}>{item!.eventName}</span>
    if (item && manage && item.automaticEventName) {
      return (
        <Select
          aria-label={`${item.pointName}を${label}に返す名前`}
          value={item.mode === 'off' ? 'off' : 'auto'}
          width={180}
          disabled={savingKey !== null}
          onChange={(value) => void saveMode(item, value === 'auto' ? 'auto' : 'off')}
          options={[
            { value: 'off', label: '結びつけない' },
            { value: 'auto', label: `自動で返す（${item.automaticEventName}）` },
          ]}
        />
      )
    }
    return <span className={styles.cellFaint}>—</span>
  }

  if (!accountId) {
    return <ListState kind="empty" title="LINEアカウントを選択してください" description="選んだLINEアカウントの広告とのつなぎだけを表示します。" />
  }

  let table
  if (mapping.kind === 'loading') {
    table = <ListState kind="loading" title="対応表を読み込んでいます" />
  } else if (mapping.kind === 'error') {
    table = (
      <ListState
        kind="error"
        title="対応表を読み込めませんでした"
        description="対応は消えていません。読み直して、もう一度お試しください。"
        action={<Button onClick={() => void loadMappings()}>対応表を読み直す</Button>}
      />
    )
  } else if (mapping.rows.length === 0) {
    table = <ListState kind="empty" title="成果地点がまだありません" description="成果地点を作ると、ここで広告に返す名前を決められます。" />
  } else {
    table = (
      <div className={styles.table} role="table" aria-label="成果地点と、広告に返す名前の対応">
        <div className={styles.tableHead} role="row">
          <span className={styles.colPoint} role="columnheader">成果地点</span>
          <span className={styles.colName} role="columnheader">Google広告に返す名前</span>
          <span className={styles.colName} role="columnheader">Meta広告に返す名前</span>
          <span className={styles.colState} role="columnheader">状態</span>
        </div>
        {mapping.rows.map((row) => {
          const returns = adMappingReturns(row.google) || adMappingReturns(row.meta)
          return (
            <div key={row.pointId} className={styles.tableRow} role="row">
              <span className={styles.colPoint} role="cell"><span className={styles.cellText} title={row.pointName}>{row.pointName}</span></span>
              <span className={styles.colName} role="cell">{nameCell(row.google, 'Google広告')}</span>
              <span className={styles.colName} role="cell">{nameCell(row.meta, 'Meta広告')}</span>
              <span className={styles.colState} role="cell">
                <StatusBadge tone={returns ? 'success' : 'neutral'} size="compact">{returns ? '返している' : '返していない'}</StatusBadge>
              </span>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className={adsStyles.board} data-design-node="FDBsG">
      <header className={adsStyles.head}>
        <div className={adsStyles.headText}>
          <Link href="/inflow-links" className={adsStyles.backLink}><ArrowLeft size={14} aria-hidden="true" />流入と計測へ</Link>
          <h1 className={adsStyles.title}>広告とのつなぎ</h1>
          <p className={adsStyles.description}>LINE で出た成果を広告へ返し、広告の配信を賢くします。お客様の名前やメールアドレスは広告へ送りません。</p>
        </div>
        <Button href="/inflow-links?tab=connections&view=history"><History size={15} aria-hidden="true" />送信履歴を見る</Button>
      </header>
      <div className={adsStyles.body}>
        {readonly ? (
          <p className={adsStyles.viewerBand} role="status"><Eye size={16} aria-hidden="true" />閲覧のみで見ています。変える操作は管理者に頼んでください。</p>
        ) : null}
        <h2 className={adsStyles.sectionTitle}>返すしくみ</h2>
        <ol className={styles.steps} aria-label="返すしくみ">
          {STEPS.map((step, index) => (
            <li key={step.title} className={styles.step}>
              <span className={styles.stepHead}>
                <span className={styles.stepNum} aria-hidden="true">{index + 1}</span>
                <span className={styles.stepTitle}>{step.title}</span>
              </span>
              <span className={styles.stepText}>{step.text}</span>
            </li>
          ))}
        </ol>
        {model.failed ? (
          <ListState
            kind="error"
            title="広告への送信の数を表示できませんでした"
            description="送信の記録は消えていません。読み直して、もう一度お試しください。"
            action={<Button onClick={() => void model.reload()}>数を読み直す</Button>}
          />
        ) : (
          <KpiBand aria-label="広告への送信の概要">
            <KpiCard icon={<Send size={13} aria-hidden="true" />} title="送った件数" value={model.loading ? null : model.sentCount} unit="件" detail="この30日" />
            <KpiCard icon={<Clock size={13} aria-hidden="true" />} title="待っている" value={model.loading ? null : model.pendingCount} unit="件" detail="送信処理を待っています" />
            <KpiCard icon={<XCircle size={13} aria-hidden="true" />} title="断られた" value={model.loading ? null : model.failedCount} unit="件" detail="送信履歴で理由を見られます" />
            {/* やり直して成功の数を返す口が無いので「—」（0 にしない）。 */}
            <KpiCard icon={<RotateCw size={13} aria-hidden="true" />} title="やり直して成功" value={null} unit="" detail="自動でやり直し" />
          </KpiBand>
        )}
        <h2 className={adsStyles.sectionTitle}>成果地点と、広告に返す名前の対応</h2>
        {saveError ? <p className={adsStyles.error} role="alert">{saveError}</p> : null}
        {table}
        <p className={adsStyles.notice}>
          気をつけること：広告側で成果の名前を先に作ってから対応を決めてください。失敗した送信のやり直しは、送信履歴から行えます。
        </p>
      </div>
    </div>
  )
}
