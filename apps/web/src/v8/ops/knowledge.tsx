'use client'

import { BadgeCheck, CircleHelp, Clock, MessageSquareText } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type OpsKnowledgeArticle } from '@/lib/api'
import { opsCall } from '@/components/ops/ops-ui'
import { opsEnvironmentLabel } from '@/components/ops/ops-env-bar'
import { KNOWLEDGE_ARTICLE_KINDS, KNOWLEDGE_KINDS, knowledgeDate, knowledgeState } from '@/components/ops/knowledge-format'
import { isForbiddenOrRateLimited } from '@/components/shared/api-error-message'
import Button from '@/components/shared/button'
import KpiCard from '@/components/shared/kpi-card'
import kpiStyles from '@/components/shared/kpi-card.module.css'
import ListState from '@/components/shared/list-state'
import Pagination from '@/components/shared/pagination'
import ListRange from '@/components/ui/list-range'
import SearchField from '@/components/shared/search-field'
import Select from '@/components/shared/select'
import StatusBadge, { type StatusBadgeTone } from '@/components/shared/status-badge'
import { OpsHead } from './shell'
import KnowledgeArticleV8 from './knowledge-article'
import parts from './parts.module.css'
import styles from './knowledge.module.css'

/**
 * 運営のナレッジ V8（絵 `h114s`・記事 `R5ckwJ`）。
 *
 * 動きは v7（components/ops/knowledge-list）と同じ口：検索・種類・状態・記事の種類で
 * /api/ops/knowledge を読み、50件ずつ送る。「開く」で記事の画面（下書きの確認・承認）。
 * 見送る・無効にするは記事の画面から行う。
 */

const PAGE = 50

const STATE_TONE: Record<string, StatusBadgeTone> = { 承認済み: 'success', 承認待ち: 'info', 要確認: 'warning', 見送り: 'neutral' }

function loadDescription(err: unknown): string | undefined {
  if (isForbiddenOrRateLimited(err)) return undefined
  if (err instanceof TypeError) return '通信できませんでした。ネットワークを確認してもう一度お試しください'
  if (err instanceof Error && err.message && !/^API error: /.test(err.message)) return err.message
  return undefined
}

/** 表の「種類」は短い名前で出す（使い方について → 使い方）。 */
function shortKind(kind: string): string {
  const label = KNOWLEDGE_KINDS.find((v) => v.value === kind)?.label ?? '—'
  return label.replace(/について$/, '').replace('料金・契約', '料金・請求')
}

export default function OpsKnowledgeV8() {
  const [rows, setRows] = useState<OpsKnowledgeArticle[]>([])
  const [total, setTotal] = useState(0)
  const [q, setQ] = useState('')
  const [kind, setKind] = useState('')
  const [articleKind, setArticleKind] = useState('')
  const [state, setState] = useState('')
  const [offset, setOffset] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [actionError, setActionError] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<OpsKnowledgeArticle | null>(null)
  const request = useRef(0)

  const load = useCallback(async () => {
    const current = ++request.current
    setLoaded(false); setError(null)
    try {
      const res = await api.ops.knowledge.list({ q, kind, articleKind, state, offset })
      if (current !== request.current) return
      if (!res.success) { setLoaded(true); setError(new Error(res.error || '読み込めませんでした')); return }
      setLoaded(true)
      setRows(res.data); setTotal(res.total)
    } catch (caught) {
      if (current !== request.current) return
      setLoaded(true)
      setError(caught)
    }
  }, [q, kind, articleKind, state, offset])

  useEffect(() => {
    const timer = setTimeout(() => void load(), 150)
    return () => { clearTimeout(timer); request.current += 1 }
  }, [load])

  const open = async (article: OpsKnowledgeArticle) => {
    setBusy(true); setActionError('')
    const res = await opsCall(api.ops.knowledge.article(article.id))
    setBusy(false)
    if (!res.success) { setActionError(res.error || '読み込めませんでした'); return }
    setEditing(res.data)
  }

  if (editing) {
    return <KnowledgeArticleV8 key={editing.id} article={editing} onClose={() => setEditing(null)} onSaved={() => void load()} />
  }

  const ready = loaded && !error
  const count = (fn: (row: OpsKnowledgeArticle) => boolean) => (ready ? rows.filter(fn).length : null)
  const pageHelp = 'このページの件数です。全件の集計ではありません。'

  return (
    <div data-design-node="h114s">
      <OpsHead
        title="ナレッジ"
        description="解決した問い合わせを自動確認し、根拠が揃ったものだけ下書きにします。AI の返信に使うのは承認済みの記事だけです。"
        environment={opsEnvironmentLabel(process.env.NEXT_PUBLIC_API_URL)}
      />
      <div className={parts.stack}>
        <div className={`${parts.kpis} ${kpiStyles.strip}`} aria-label="このページの記事の状況">
          <KpiCard presentation="cell" icon={<BadgeCheck size={13} aria-hidden="true" />} title="承認済み" value={count((row) => knowledgeState(row).label === '承認済み')} unit="件" detail="AI の返信に使う" help={pageHelp} loading={!loaded} />
          <KpiCard presentation="cell" icon={<Clock size={13} aria-hidden="true" />} title="承認待ち" value={count((row) => row.reviewState === 'pending')} unit="件" detail="根拠が揃った下書き" help={pageHelp} loading={!loaded} />
          <KpiCard presentation="cell" icon={<CircleHelp size={13} aria-hidden="true" />} title="要確認" value={count((row) => row.reviewState === 'needs_review')} unit="件" detail="運営の回答がない" help={pageHelp} loading={!loaded} />
          <KpiCard presentation="cell" icon={<MessageSquareText size={13} aria-hidden="true" />} title="使われた回数" value={ready ? rows.reduce((sum, row) => sum + row.usedCount, 0) : null} unit="回" detail={ready ? `役に立った ${rows.reduce((sum, row) => sum + row.helpfulCount, 0)}` : '—'} help="このページの記事の累計です。" loading={!loaded} />
        </div>

        <div className={styles.tools}>
          <div className={styles.search}>
            <SearchField value={q} onChange={(value) => { setQ(value); setOffset(0) }} placeholder="タイトル・質問・キーワードで検索" aria-label="タイトル・質問・キーワードで検索" />
          </div>
          <div className={styles.select}>
            <Select aria-label="種類" value={kind} onChange={(value) => { setKind(value); setOffset(0) }} options={[{ value: '', label: '種類：すべて' }, ...KNOWLEDGE_KINDS]} />
          </div>
          <div className={styles.select}>
            <Select aria-label="状態" value={state} onChange={(value) => { setState(value); setOffset(0) }} options={[{ value: '', label: '状態：すべて' }, { value: 'pending', label: '承認待ち' }, { value: 'approved', label: '承認済み' }, { value: 'needs_review', label: '要確認' }, { value: 'dismissed', label: '見送り' }]} />
          </div>
          <div className={styles.select}>
            <Select aria-label="記事の種類" value={articleKind} onChange={(value) => { setArticleKind(value); setOffset(0) }} options={[{ value: '', label: '記事：すべて' }, ...KNOWLEDGE_ARTICLE_KINDS]} />
          </div>
          <span className={styles.spacer} />
          <span className={styles.count}>{ready && total > 0 ? <ListRange total={total} first={offset + 1} last={Math.min(offset + rows.length, total)} /> : ready ? '0件' : '—'}</span>
        </div>

        {actionError ? <p role="alert" className={parts.alert}>{actionError}</p> : null}

        {!loaded && rows.length === 0 ? (
          <ListState kind="loading" />
        ) : error ? (
          <div className={parts.panel}>
            <ListState kind="error" description={loadDescription(error)} error={error ?? undefined} onRetry={() => void load()} />
          </div>
        ) : rows.length === 0 ? (
          <div className={parts.panel}>
            <ListState kind="empty" emptyPreset="readonly" title="記事はありません" description="解決した問い合わせの確認結果がここに並びます。" />
          </div>
        ) : (
          <div className={parts.mini} role="table" aria-label="ナレッジの記事">
            <div className={parts.miniHead} role="row">
              <span className={parts.grow} role="columnheader">タイトル</span>
              <span className={`${parts.fixed} ${styles.colKind}`} role="columnheader">種類</span>
              <span className={`${parts.fixed} ${styles.colKind}`} role="columnheader">状態</span>
              <span className={`${parts.num} ${styles.colKind}`} role="columnheader">使われた回数</span>
              <span className={`${parts.num} ${styles.colShort}`} role="columnheader">役に立った</span>
              <span className={`${parts.fixed} ${styles.colShort}`} role="columnheader">更新日</span>
              <span className={`${parts.fixed} ${styles.colShort}`} role="columnheader">操作</span>
            </div>
            {rows.map((article) => {
              const label = knowledgeState(article).label
              return (
                <div key={article.id} className={`${parts.miniRow} ${styles.row}`} role="row">
                  <span className={parts.grow} role="cell" title={article.title}>{article.title}</span>
                  <span className={`${parts.fixed} ${styles.colKind}`} role="cell">{shortKind(article.kind)}</span>
                  <span className={`${parts.fixed} ${styles.colKind}`} role="cell"><StatusBadge tone={STATE_TONE[label] ?? 'neutral'}>{label}</StatusBadge></span>
                  <span className={`${parts.num} ${styles.colKind}`} role="cell">{article.usedCount ? article.usedCount : '—'}</span>
                  <span className={`${parts.num} ${styles.colShort}`} role="cell">{article.helpfulCount ? article.helpfulCount : '—'}</span>
                  <span className={`${parts.fixed} ${styles.colShort}`} role="cell">{shortDate(article.updatedAt)}</span>
                  <span className={`${parts.fixed} ${styles.colShort}`} role="cell">
                    <Button disabled={busy} onClick={() => void open(article)} aria-label={`「${article.title}」を開く`}>開く</Button>
                  </span>
                </div>
              )
            })}
          </div>
        )}
        {ready && total > PAGE ? (
          <Pagination page={Math.floor(offset / PAGE) + 1} pageCount={Math.ceil(total / PAGE)} onPageChange={(next) => setOffset((next - 1) * PAGE)} />
        ) : null}
      </div>
    </div>
  )
}

/** 10/1 の形（年は出さない）。読めない日付は —。 */
function shortDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return knowledgeDate(value)
  return date.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' })
}
