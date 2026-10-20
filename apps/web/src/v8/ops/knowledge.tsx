'use client'
import { BadgeCheck, CircleHelp, Clock, ThumbsUp } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type OpsKnowledgeArticle } from '@/lib/api'
import { opsCall } from '@/components/ops/ops-ui'
import { KNOWLEDGE_ARTICLE_KINDS, KNOWLEDGE_KINDS, knowledgeState, knowledgeArticleKind } from '@/components/ops/knowledge-format'
import { describeApiFailure, isForbiddenOrRateLimited } from '@/components/shared/api-error-message'
import KpiCard from '@/components/shared/kpi-card'
import KpiBand from '@/components/shared/kpi-band'
import ListState from '@/components/shared/list-state'
import Pagination from '@/components/shared/pagination'
import ListRange from '@/components/ui/list-range'
import { OpsListPage, OpsListToolbar } from './list-page'
import { DataTable, TableHeadRow, Th, Td, Tr, NameCell, RowNameButton, ActionCell } from '@/components/shared/table'
import TruncatedText from '@/components/shared/truncated-text'
import { RowActions } from '@/components/shared/row-actions'
import Select from '@/components/shared/select'
import StatusBadge, { type StatusBadgeTone } from '@/components/shared/status-badge'
import KnowledgeArticleV8 from './knowledge-article'
import { formatDate as polishFormatDate } from '@/lib/format'
import { emptyValue } from '@/components/shared/empty-value'
import { SaveErrorField } from '@/components/shared/save-form-errors'
import Notice from '@/components/shared/notice'

/**
 * 運営のナレッジ V8（絵の記事 ）。
 *
 * 動きは 管理画面（components/ops/knowledge-list）と同じ口：検索・種類・状態・記事の種類で
 * /api/ops/knowledge を読み、50件ずつ送る。「開く」で記事の画面（下書きの確認・承認）。
 * 見送る・無効にするは記事の画面から行う。
 */

const PAGE = 50

const STATE_TONE: Record<string, StatusBadgeTone> = { 承認済み: 'success', 承認待ち: 'info', 要確認: 'warning', 見送り: 'neutral' }

function loadDescription(err: unknown): string | undefined {
  if (isForbiddenOrRateLimited(err)) return undefined
  if (err instanceof TypeError) return '通信できませんでした。ネットワークを確認してもう一度お試しください'
  return describeApiFailure(err, '読み込み', { scope: 'hq' })
}

/** 表の「種類」は短い名前で出す（使い方について → 使い方）。 */
function shortKind(kind: string): string {
  const label = KNOWLEDGE_KINDS.find((v) => v.value === kind)?.label ?? emptyValue('unknown')
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
    <OpsListPage boardId="h114s" title="ナレッジ" help="解決した問い合わせを自動確認し、根拠が揃ったものだけ下書きにします。AI の返信に使うのは承認済みの記事だけです。"
        stats={<KpiBand aria-label="このページの記事の状況">
          <KpiCard presentation="cell" icon={<BadgeCheck size={13} aria-hidden="true" />} title="承認済み" value={count((row) => knowledgeState(row).label === '承認済み')} unit="件" detail="AI の返信に使う" help={pageHelp} loading={!loaded} />
          <KpiCard presentation="cell" icon={<Clock size={13} aria-hidden="true" />} title="承認待ち" value={count((row) => row.reviewState === 'pending')} unit="件" detail="根拠が揃った下書き" help={pageHelp} loading={!loaded} />
          <KpiCard presentation="cell" icon={<CircleHelp size={13} aria-hidden="true" />} title="要確認" value={count((row) => row.reviewState === 'needs_review')} unit="件" detail="運営の回答がない" help={pageHelp} loading={!loaded} />
          <KpiCard presentation="cell" icon={<ThumbsUp size={13} aria-hidden="true" />} title="使われた回数" value={ready ? rows.reduce((sum, row) => sum + row.usedCount, 0) : null} unit="回" detail={ready ? `役に立った ${rows.reduce((sum, row) => sum + row.helpfulCount, 0)}` : emptyValue('unknown')} help="このページの記事の累計です。" loading={!loaded} />
        </KpiBand>}
        toolbar={<OpsListToolbar
          search={{ value: q, onChange: (value) => { setQ(value); setOffset(0) }, placeholder: 'タイトル・質問・キーワードで探す' }}
          filters={<>
            <SaveErrorField names={["kind"]}><Select size="content" aria-label="種類" value={kind} onChange={(value) => { setKind(value); setOffset(0) }} options={[{ value: '', label: '種類：すべて' }, ...KNOWLEDGE_KINDS]} /></SaveErrorField>
            <SaveErrorField names={["state"]}><Select size="content" aria-label="状態" label="状態" value={state} onChange={(value) => { setState(value); setOffset(0) }} options={[{ value: '', label: 'すべて' }, { value: 'pending', label: '承認待ち' }, { value: 'approved', label: '承認済み' }, { value: 'needs_review', label: '要確認' }, { value: 'dismissed', label: '見送り' }]} /></SaveErrorField>
            <SaveErrorField names={["articleKind", "article_kind"]}><Select size="content" aria-label="記事の種類" value={articleKind} onChange={(value) => { setArticleKind(value); setOffset(0) }} options={[{ value: '', label: '記事：すべて' }, ...KNOWLEDGE_ARTICLE_KINDS]} /></SaveErrorField>
          </>}
          trailing={ready ? <ListRange total={total} first={total ? offset + 1 : 0} last={Math.min(offset + rows.length, total)} /> : emptyValue('unknown')}
        />}
        pagination={ready && total > 0 ? <Pagination page={Math.floor(offset / PAGE) + 1} pageCount={Math.ceil(total / PAGE)} onPageChange={(next) => setOffset((next - 1) * PAGE)} /> : null}
      >
        {actionError ? <Notice tone="danger">{actionError}</Notice> : null}
        {!loaded && rows.length === 0 ? <ListState permissionScope="hq" kind="loading" />
          : error ? <ListState permissionScope="hq" kind="error" description={loadDescription(error)} error={error ?? undefined} onRetry={() => void load()} />
          : rows.length === 0 ? <ListState permissionScope="hq" kind="empty" emptyPreset="readonly" title="記事はありません" description="解決した問い合わせの確認結果がここに並びます。" />
          : <DataTable aria-label="ナレッジの記事" columnSizing="content">
            <thead><TableHeadRow>
              <Th grow>タイトル</Th><Th>種類</Th><Th>状態</Th><Th align="right">使われた回数</Th><Th align="right">役に立った</Th><Th>更新日</Th><Th>操作</Th>
            </TableHeadRow></thead>
            <tbody>{rows.map((article) => {
              const label = knowledgeState(article).label
              return <Tr key={article.id} onOpen={() => { if (!busy) void open(article) }}>
                <NameCell grow name={<RowNameButton disabled={busy} title={busy ? '記事を読み込んでいます' : article.title} aria-label={`「${article.title}」を開く`} onClick={() => void open(article)}><TruncatedText value={article.title} /></RowNameButton>} />
                <Td title={knowledgeArticleKind(article.articleKind).label}>{shortKind(article.kind)}</Td>
                <Td><StatusBadge tone={STATE_TONE[label] ?? 'neutral'}>{label}</StatusBadge></Td>
                <Td align="right" data-list-number>{article.usedCount}</Td>
                <Td align="right" data-list-number>{article.helpfulCount}</Td>
                <Td data-list-date-time>{shortDate(article.updatedAt)}</Td>
                <ActionCell><RowActions subjectName={article.title} menuItems={[{ id: 'open', label: '開く', disabled: busy, disabledReason: '記事を読み込んでいます', onSelect: () => void open(article) }]} /></ActionCell>
              </Tr>
            })}</tbody>
          </DataTable>}
    </OpsListPage>
  )
}

function shortDate(value: string): string {
  return polishFormatDate(value, { style: 'list-day', fallback: '—' })
}
