/*
 * G2 AI の要約・返信案と Q&A の自動応答（要件 G2 §3 の口）。
 * 口は Codex の Worker が作る途中のため、画面側にだけ置く（lib/api* は Codex の持ち物）。
 * 形は要件 §3「データと API の形（案）」どおり。Worker ができたら lib へ移す。
 */
import { fetchApi, type StepUpPurpose } from '@/lib/api'

type Result<T> = { success: true; data: T }
const e = encodeURIComponent
const account = (path: string, id: string) => `${path}${path.includes('?') ? '&' : '?'}account_id=${e(id)}`
const json = (method: string, body: unknown, headers?: Record<string, string>) => ({ method, body: JSON.stringify(body), ...(headers ? { headers } : {}) })

/** AI の段（店ごと）。off＝使っていない（初期）・draft_only＝返信案だけ・auto_qa＝Q&A で自動で答える・suspended＝止まっている。 */
export type AiMode = 'off' | 'draft_only' | 'auto_qa' | 'suspended'

export interface AiSettings {
  mode: AiMode
  /** 止まっている理由（提供元の障害・月の上限）。止まっていないときは null。 */
  suspendedReason: 'provider' | 'monthly_limit' | null
  /** 公開中の Q&A の件数（自動で答えるを選べるかの判断と窓の文に使う）。 */
  publishedQaCount: number
  /** 確かめ待ち（下書き）の件数。窓の「確かめ待ちの 1 件は使いません」に使う。 */
  draftQaCount: number
  version: number
}

export type QaStatus = 'draft' | 'published' | 'stopped'

export interface QaEntry {
  id: string
  questions: string[]
  answerText: string
  status: QaStatus
  source: 'manual' | 'import_pdf' | 'import_web' | 'from_log'
  useCount: number
  version: number
  updatedAt: string
}

export interface QaPage { items: QaEntry[]; total: number }

export interface ChatSummary { lines: string[]; generatedAt: string; basedOnMessageId: string | null; messageCount?: number }
export interface DraftSource { type: 'qa' | 'past_reply'; id: string; title: string }
export interface ChatDraft { text: string; sources: DraftSource[]; generatedAt: string }

export type AnswerAction = 'answered' | 'handed_off' | 'customer_asked_human'
export interface AiAnswerLog {
  id: string
  createdAt: string
  chatId: string
  friendId: string
  friendName: string
  questionText: string
  action: AnswerAction
  handoffReason: string | null
  qaEntryId: string | null
  qaTitle: string | null
  qaVersion: number | null
}
export interface AiAnswerLogDetail extends AiAnswerLog {
  answerText: string | null
  /** 元の Q&A の今の様子。消されていれば null。 */
  qa: { id: string; title: string; status: QaStatus; useCount: number; updatedAt: string; version: number; currentAnswerText: string } | null
  /** そのあとの会話の短い説明（伏せた形）。 */
  afterNote: string | null
}
export interface AiAnswerSummary { answered: number; handedOff: number; askedAgainRate: number | null }
export interface AiAnswerLogPage { items: AiAnswerLog[]; total: number; summary: AiAnswerSummary }

export interface AiTestResult { qaTitle: string | null; handoffReason: string | null }

/** 本人確認の目的。lib/api の StepUpPurpose に Codex が足すまで、画面側で名前だけ決める。 */
export const AI_SETTINGS_STEP_UP = 'ai.settings' as StepUpPurpose

export const aiReplyApi = {
  settings: (accountId: string) => fetchApi<Result<AiSettings>>(account('/api/ai-settings', accountId)),
  saveSettings: (accountId: string, input: { mode: AiMode; expectedVersion: number; reason?: string }, stepUpToken?: string) =>
    fetchApi<Result<AiSettings>>(account('/api/ai-settings', accountId), json('PUT', input, stepUpToken ? { 'X-Step-Up-Token': stepUpToken } : undefined)),
  test: (accountId: string, question: string) => fetchApi<Result<AiTestResult>>(account('/api/ai-settings/test', accountId), json('POST', { question })),
  summary: (chatId: string, refresh = false) => fetchApi<Result<ChatSummary>>(`/api/chats/${e(chatId)}/ai/summary`, json('POST', { refresh })),
  draft: (chatId: string) => fetchApi<Result<ChatDraft>>(`/api/chats/${e(chatId)}/ai/draft`, json('POST', {})),
  listQa: (accountId: string, query: { q?: string; status?: QaStatus | ''; page: number; limit: number }) => {
    const q = new URLSearchParams({ page: String(query.page), limit: String(query.limit) })
    if (query.q) q.set('q', query.q)
    if (query.status) q.set('status', query.status)
    return fetchApi<Result<QaPage>>(account(`/api/qa-entries?${q}`, accountId))
  },
  createQa: (accountId: string, input: { questions: string[]; answerText: string }) => fetchApi<Result<QaEntry>>(account('/api/qa-entries', accountId), json('POST', input)),
  updateQa: (accountId: string, id: string, input: { questions: string[]; answerText: string; expectedVersion: number }) => fetchApi<Result<QaEntry>>(account(`/api/qa-entries/${e(id)}`, accountId), json('PUT', input)),
  publishQa: (accountId: string, id: string, expectedVersion: number) => fetchApi<Result<QaEntry>>(account(`/api/qa-entries/${e(id)}/publish`, accountId), json('POST', { expectedVersion })),
  stopQa: (accountId: string, id: string, expectedVersion: number) => fetchApi<Result<QaEntry>>(account(`/api/qa-entries/${e(id)}/stop`, accountId), json('POST', { expectedVersion })),
  deleteQa: (accountId: string, id: string, expectedVersion: number) => fetchApi<Result<{ deleted: true }>>(account(`/api/qa-entries/${e(id)}`, accountId), json('DELETE', { expectedVersion })),
  importQa: (accountId: string, input: { kind: 'web'; url: string }) => fetchApi<Result<{ jobId: string }>>(account('/api/qa-entries/import', accountId), json('POST', input)),
  logs: (accountId: string, query: { action?: AnswerAction | ''; days: number; page: number; limit: number }) => {
    const q = new URLSearchParams({ days: String(query.days), page: String(query.page), limit: String(query.limit) })
    if (query.action) q.set('action', query.action)
    return fetchApi<Result<AiAnswerLogPage>>(account(`/api/ai-answer-logs?${q}`, accountId))
  },
  log: (accountId: string, id: string) => fetchApi<Result<AiAnswerLogDetail>>(account(`/api/ai-answer-logs/${e(id)}`, accountId)),
}
