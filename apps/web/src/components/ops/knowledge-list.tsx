'use client'

import { Search } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type OpsKnowledgeArticle } from '@/lib/api'
import { opsCall } from '@/components/ops/ops-ui'
import { KNOWLEDGE_ARTICLE_KINDS, KNOWLEDGE_KINDS, knowledgeArticleKind, knowledgeDate, knowledgeState } from '@/components/ops/knowledge-format'
import KnowledgeEditor from '@/components/ops/knowledge-editor'
import Button from '@/components/shared/button'
import Chip from '@/components/shared/chip'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import SelectField from '@/components/shared/select-field'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { TextField } from '@/components/shared/text-field'
import styles from '@/components/ops/knowledge.module.css'

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
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<OpsKnowledgeArticle | null>(null)
  const request = useRef(0)
  const load = useCallback(async () => {
    const current = ++request.current
    setLoaded(false); setError('')
    const res = await opsCall(api.ops.knowledge.list({ q, kind, articleKind, state, offset }))
    if (current !== request.current) return
    setLoaded(true)
    if (!res.success) { setError(res.error || '読み込めませんでした'); return }
    setRows(res.data); setTotal(res.total)
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
  return <div className={styles.page} data-design-node="csVox">
    <div className={styles.heading}><h2>ナレッジ一覧</h2></div>
    <div className={styles.filters}>
      <div className={styles.search}><Search aria-hidden="true" /><TextField aria-label="タイトル・質問・キーワードで検索"
        placeholder="タイトル・質問・キーワードで検索" value={q} onChange={e => { setQ(e.target.value); setOffset(0) }} maxLength={200} /></div>
      <SelectField aria-label="種類" className={styles.filter} value={kind} onChange={e => { setKind(e.target.value); setOffset(0) }}
        options={[{ value: '', label: '種類：すべて' }, ...KNOWLEDGE_KINDS]} />
      <SelectField data-design-node="aeKindFilter" aria-label="記事の種類" className={styles.articleKindFilter} value={articleKind}
        onChange={e => { setArticleKind(e.target.value); setOffset(0) }}
        options={[{ value: '', label: '記事：すべて' }, ...KNOWLEDGE_ARTICLE_KINDS]} />
      <SelectField aria-label="状態" className={styles.filter} value={state} onChange={e => { setState(e.target.value); setOffset(0) }}
        options={[{ value: '', label: '状態：すべて' }, { value: 'pending', label: '承認待ち' }, { value: 'approved', label: '承認済み' }, { value: 'needs_review', label: '要確認' }, { value: 'dismissed', label: '見送り' }]} />
      <span className={styles.count}>{loaded && !error ? `${total}件` : '—'}</span>
    </div>
    <NoteBar className={styles.note}>解決した問い合わせを自動確認し、根拠が揃ったものだけ下書きにします。AI の返信に使うのは承認済みの記事だけです。</NoteBar>
    {actionError && <p role="alert" className={styles.error}>{actionError}</p>}
    {!loaded ? <ListState kind="loading" /> : error ? <ListState kind="error" description={error} onRetry={() => void load()} /> : rows.length === 0
      ? <ListState kind="empty" emptyPreset="readonly" title="記事はありません" description="解決した問い合わせの確認結果がここに並びます。" />
      : <DataTable className={styles.table}>
        <colgroup><col /><col className={styles.kindColumn} /><col className={styles.articleKindColumn} /><col className={styles.stateColumn} /><col className={styles.numberColumn} /><col className={styles.helpfulColumn} /><col className={styles.dateColumn} /><col className={styles.actionsColumn} /></colgroup>
        <thead><TableHeadRow><Th>タイトル</Th><Th>種類</Th><Th data-design-node="aeKindHeader">記事の種類</Th><Th>状態</Th><Th>使われた回数</Th><Th>役に立った</Th><Th>更新日</Th><Th>操作</Th></TableHeadRow></thead>
        <tbody>{rows.map(article => {
          const label = knowledgeState(article)
          const articleKindLabel = knowledgeArticleKind(article.articleKind)
          const approved = label.label === '承認済み'
          return <Tr key={article.id}>
            <Td className={styles.titleCell} title={article.title}>{article.title}</Td>
            <Td>{KNOWLEDGE_KINDS.find(v => v.value === article.kind)?.label}</Td>
            <Td><Chip tone={articleKindLabel.tone} className={styles.articleKindChip}>{articleKindLabel.label}</Chip></Td>
            <Td><Chip tone={label.tone} className={styles.chip}>{label.label}</Chip></Td>
            <Td>{article.usedCount ? `${article.usedCount}回` : '—'}</Td>
            <Td>{article.helpfulCount ? `${article.helpfulCount}件` : '—'}</Td>
            <Td>{knowledgeDate(article.updatedAt)}</Td>
            <Td><div className={styles.rowActions}>
              <button type="button" disabled={busy} onClick={() => void open(article)}>{approved ? '直す' : label.label === '承認待ち' ? '内容を確認' : '理由を確認'}</button>
              {article.reviewState !== 'dismissed' && <button type="button" disabled={busy} onClick={() => void review(article, approved ? 'disable' : 'dismiss')}>{approved ? '無効にする' : '見送る'}</button>}
            </div></Td>
          </Tr>
        })}</tbody>
      </DataTable>}
    {loaded && !error && total > 50 && <nav className={styles.pagination} aria-label="ページ切り替え">
      <Button disabled={offset === 0} onClick={() => setOffset(v => Math.max(0, v - 50))}>前へ</Button>
      <span>{offset + 1}–{Math.min(offset + 50, total)} / {total}件</span>
      <Button disabled={offset + 50 >= total} onClick={() => setOffset(v => v + 50)}>次へ</Button>
    </nav>}
    {editing && <KnowledgeEditor key={editing.id} article={editing} onClose={() => setEditing(null)} onSaved={() => void load()} />}
  </div>
}
