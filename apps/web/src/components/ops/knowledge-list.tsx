'use client'

import KpiCard from '@/components/shared/kpi-card'
import '@/app/ops/readonly-v8.css'
import PageHeader from '@/components/shared/page-header'
import HelpTip from '@/components/shared/help-tip'
import Disclosure from '@/components/shared/disclosure'
import v8 from '@/app/ops/knowledge/knowledge-v8.module.css'
import { Search } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type OpsKnowledgeArticle } from '@/lib/api'
import { opsCall } from '@/components/ops/ops-ui'
import { isForbiddenOrRateLimited } from '@/components/shared/api-error-message'
import { KNOWLEDGE_ARTICLE_KINDS, KNOWLEDGE_KINDS, knowledgeArticleKind, knowledgeDate, knowledgeState } from '@/components/ops/knowledge-format'
import KnowledgeEditor from '@/components/ops/knowledge-editor'
import Button from '@/components/shared/button'
import Chip from '@/components/shared/chip'
import ListState from '@/components/shared/list-state'
import Select from '@/components/shared/select'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import Pagination from '@/components/shared/pagination'
import ListRange from '@/components/ui/list-range'
import { TextField } from '@/components/shared/text-field'
import Notice from '@/components/shared/notice'
import styles from '@/components/ops/knowledge.module.css'

/*
 * 読み込み失敗の説明。403・429 は説明を渡さず、ListState が捕まえた失敗から
 * 共通の1枚（権限の案内・待ち案内）を作る。それ以外は捕まえた言葉をそのまま
 * 出す（通信断の「通信できませんでした」など）。
 */
function loadDescription(err: unknown): string | undefined {
  if (isForbiddenOrRateLimited(err)) return undefined
  if (err instanceof TypeError) return '通信できませんでした。ネットワークを確認してもう一度お試しください'
  if (err instanceof Error && err.message && !/^API error: /.test(err.message)) return err.message
  return undefined
}

/** Canonical V6 37-11 list, shared with the review/edit feature parts. */
export default function KnowledgeList() {
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
      // M040：捕まえた失敗をそのまま残す。ListState が 403 は権限の案内
      // （再試行なし）・429 は待ち案内に切り替える。
      if (current !== request.current) return
      setLoaded(true)
      setError(caught)
    }
  }, [q, kind, articleKind, state, offset])
  useEffect(() => {
    const timer = setTimeout(() => void load(), 150)
    return () => { clearTimeout(timer); request.current += 1 }
  }, [load])
  const review = async (article: OpsKnowledgeArticle, action: 'dismiss' | 'disable') => {
    setBusy(true); setActionError('')
    const res = await opsCall(api.ops.knowledge.review(article.id, { version: article.version, action }))
    setBusy(false)
    if (!res.success) { setActionError(res.error || '変更できませんでした'); return }
    void load()
  }
  const open = async (article: OpsKnowledgeArticle) => {
    setBusy(true); setActionError('')
    const res = await opsCall(api.ops.knowledge.article(article.id))
    setBusy(false)
    if (!res.success) { setActionError(res.error || '読み込めませんでした'); return }
    setEditing(res.data)
  }
  if (editing) return <KnowledgeEditor key={editing.id} article={editing} fullPage onClose={() => setEditing(null)} onSaved={() => void load()} />
  return <div className={`${styles.page} ${v8.page}`} data-design-node="h114s">
    <PageHeader breadcrumb={[]} title="ナレッジ" description="解決した問い合わせを自動確認し、根拠が揃ったものだけ下書きにします。AI の返信に使うのは承認済みの記事だけです。" />
    <div className={v8.metrics} aria-label="このページの記事の状況">
      <KpiCard variant="v6" title="承認済み" value={loaded && !error ? rows.filter(row => knowledgeState(row).label === '承認済み').length : null} unit="件" detail="AI の返信に使う" help="このページの件数です。全件の集計ではありません。" loading={!loaded} />
      <KpiCard variant="v6" title="承認待ち" value={loaded && !error ? rows.filter(row => row.reviewState === 'pending').length : null} unit="件" detail="根拠が揃った下書き" help="このページの件数です。全件の集計ではありません。" loading={!loaded} />
      <KpiCard variant="v6" title="要確認" value={loaded && !error ? rows.filter(row => row.reviewState === 'needs_review').length : null} unit="件" detail="運営の回答がない" help="このページの件数です。全件の集計ではありません。" loading={!loaded} />
      <KpiCard variant="v6" title="使われた回数" value={loaded && !error ? rows.reduce((sum, row) => sum + row.usedCount, 0) : null} unit="回" detail="" help="このページの記事の累計です。今月の集計は読み込めません。" loading={!loaded} />
    </div>
    <div className={styles.filters}>
      <div className={styles.search}><Search aria-hidden="true" /><TextField aria-label="タイトル・質問・キーワードで検索"
        placeholder="タイトル・質問・キーワードで検索" value={q} onChange={e => { setQ(e.target.value); setOffset(0) }} maxLength={200} /></div>
      <Select aria-label="種類" className={styles.filter} value={kind} onChange={value => { setKind(value); setOffset(0) }}
        options={[{ value: '', label: '種類：すべて' }, ...KNOWLEDGE_KINDS]} />
      <Select aria-label="状態" className={styles.filter} value={state} onChange={value => { setState(value); setOffset(0) }}
        options={[{ value: '', label: '状態：すべて' }, { value: 'pending', label: '承認待ち' }, { value: 'approved', label: '承認済み' }, { value: 'needs_review', label: '要確認' }, { value: 'dismissed', label: '見送り' }]} />
      <span className={styles.count}>{loaded && !error ? `${total}件` : '—'}</span>
    </div>
    <Disclosure title="記事の種類で絞り込む" size="compact">      <span data-design-node="aeKindFilter"><Select aria-label="記事の種類" className={styles.articleKindFilter} value={articleKind}
        onChange={value => { setArticleKind(value); setOffset(0) }}
        options={[{ value: '', label: '記事：すべて' }, ...KNOWLEDGE_ARTICLE_KINDS]} /></span>
</Disclosure>
    {actionError && <p role="alert" className={styles.error}>{actionError}</p>}
    {!loaded ? <ListState kind="loading" /> : error ? <ListState kind="error" description={loadDescription(error)} error={error ?? undefined} onRetry={() => void load()} /> : rows.length === 0
      ? <ListState kind="empty" emptyPreset="readonly" title="記事はありません" description="解決した問い合わせの確認結果がここに並びます。" />
      : <DataTable className={styles.table}>
        <colgroup><col /><col className={styles.kindColumn} /><col className={styles.stateColumn} /><col className={styles.numberColumn} /><col className={styles.helpfulColumn} /><col className={styles.dateColumn} /><col className={styles.actionsColumn} /></colgroup>
        <thead><TableHeadRow><Th>タイトル</Th><Th>種類</Th><Th>状態</Th><Th align="right">使われた回数</Th><Th align="right">役に立った</Th><Th>更新日</Th><Th>操作</Th></TableHeadRow></thead>
        <tbody>{rows.map(article => {
          const label = knowledgeState(article)
          const articleKindLabel = knowledgeArticleKind(article.articleKind)
          const approved = label.label === '承認済み'
          return <Tr key={article.id}>
            <Td className={styles.titleCell}><div className="flex min-w-0 items-center gap-2"><span className="block truncate" title={article.title}>{article.title}</span><HelpTip label={`${article.title}の記事の種類`}>{articleKindLabel.label}</HelpTip></div></Td>
            <Td data-label="種類">{KNOWLEDGE_KINDS.find(v => v.value === article.kind)?.label}</Td>
            <Td data-label="状態"><Chip tone={label.tone} className={styles.chip}>{label.label}</Chip></Td>
            <Td data-label="使われた回数" align="right">{article.usedCount ? `${article.usedCount}回` : '—'}</Td>
            <Td data-label="役に立った" align="right">{article.helpfulCount ? `${article.helpfulCount}件` : '—'}</Td>
            <Td data-label="更新日">{knowledgeDate(article.updatedAt)}</Td>
            <Td><div className={styles.rowActions}>
              <Button disabled={busy} onClick={() => void open(article)}>開く</Button>
              {article.reviewState !== 'dismissed' && <button type="button" disabled={busy} onClick={() => void review(article, approved ? 'disable' : 'dismiss')}>{approved ? '無効にする' : '見送る'}</button>}
            </div></Td>
          </Tr>
        })}</tbody>
      </DataTable>}
    {loaded && !error && total > 0 && total > 0 && <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
      <ListRange total={total} first={offset + 1} last={Math.min(offset + rows.length, total)} />
      <Pagination page={Math.floor(offset / 50) + 1} pageCount={Math.ceil(total / 50)} onPageChange={(next) => setOffset((next - 1) * 50)} />
    </div>}
  </div>
}
