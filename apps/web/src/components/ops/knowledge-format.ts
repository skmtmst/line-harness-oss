import type { OpsKnowledgeArticle, OpsKnowledgeArticleKind } from '@/lib/api'

export const KNOWLEDGE_KINDS = [
  { value: 'usage', label: '使い方について' }, { value: 'bug', label: '不具合' },
  { value: 'billing', label: '料金・契約について' }, { value: 'feature', label: '機能のご要望' },
  { value: 'other', label: 'その他' },
]
export const KNOWLEDGE_ARTICLE_KINDS: Array<{ value: OpsKnowledgeArticleKind; label: string }> = [
  { value: 'verified', label: '解決確認済み' },
  { value: 'answer_example', label: '回答例（お客様の確認なし）' },
]
export function knowledgeArticleKind(kind: OpsKnowledgeArticleKind) {
  return kind === 'verified'
    ? { label: '解決確認済み', tone: 'ok' as const }
    : { label: '回答例（お客様の確認なし）', tone: 'info' as const }
}
export function knowledgeState(article: OpsKnowledgeArticle) {
  if (!article.sourceCurrent) return { label: '要確認', tone: 'neutral' as const }
  if (article.reviewState === 'approved' && article.status === 'active') return { label: '承認済み', tone: 'ok' as const }
  if (article.reviewState === 'pending') return { label: '承認待ち', tone: 'info' as const }
  return { label: article.reviewState === 'dismissed' ? '見送り' : '要確認', tone: 'neutral' as const }
}
export function knowledgeDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? '—' : new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Tokyo',
  }).format(date)
}

export function knowledgeTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? '—' : new Intl.DateTimeFormat('ja-JP', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo',
  }).format(date)
}
