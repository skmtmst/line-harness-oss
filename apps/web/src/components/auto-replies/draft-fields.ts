import type { ScenarioActionType } from '@/lib/api'

/**
 * 自動応答の編集で扱う、151 で増えた設定の形。
 *
 * 保存する JSON と、画面で持つ形の変換をここに集める。ダイアログ側に置くと、
 * 読むときと書くときで別々に書き直すことになり、片方だけ直したときに食い違う。
 */

export type HolidayRuleValue = 'ignore' | 'include' | 'exclude'

export const HOLIDAY_RULE_LABELS: { value: HolidayRuleValue; label: string; hint: string }[] = [
  { value: 'ignore', label: '祝日は考えない', hint: '選んだ曜日だけで決めます' },
  {
    value: 'include',
    label: '祝日にも応答する',
    hint: '選んだ曜日に加えて、祝日も応答します',
  },
  {
    value: 'exclude',
    label: '祝日は応答しない',
    hint: '選んだ曜日でも、その日が祝日なら応答しません',
  },
]

export const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']

/** キーワード1行ぶん（画面で持つ形）。 */
export interface KeywordRuleDraft {
  keyword: string
  matchType: 'exact' | 'contains'
  /** 受け取った文がこの字数に満たなければ当てない。空なら見ない。 */
  minLength: string
  /** 大文字小文字・全角半角を区別するか。 */
  caseSensitive: boolean
}

export function emptyKeywordRule(): KeywordRuleDraft {
  return { keyword: '', matchType: 'exact', minLength: '', caseSensitive: true }
}

/**
 * 保存されている `keywords` を画面の形に読む。
 *
 * 未設定なら、これまでの1行（keyword / matchType）を1行目として出す。
 * 画面から見ると「もともと1行あって、行を足せる」形になる。
 */
export function readKeywordRules(draft: {
  keyword: string
  matchType: 'exact' | 'contains'
  keywords?: unknown[] | null
}): KeywordRuleDraft[] {
  const stored = draft.keywords
  if (Array.isArray(stored) && stored.length > 0) {
    const rules = stored.flatMap((item): KeywordRuleDraft[] => {
      if (!item || typeof item !== 'object') return []
      const r = item as Record<string, unknown>
      if (typeof r.keyword !== 'string') return []
      return [
        {
          keyword: r.keyword,
          matchType: r.matchType === 'contains' ? 'contains' : 'exact',
          minLength: typeof r.minLength === 'number' ? String(r.minLength) : '',
          caseSensitive: r.caseSensitive !== false,
        },
      ]
    })
    if (rules.length > 0) return rules
  }
  return [
    {
      keyword: draft.keyword,
      matchType: draft.matchType,
      minLength: '',
      caseSensitive: true,
    },
  ]
}

export function toKeywordPayload(rule: KeywordRuleDraft): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    keyword: rule.keyword,
    matchType: rule.matchType,
  }
  const minLength = Number(rule.minLength)
  if (rule.minLength.trim() !== '' && Number.isInteger(minLength) && minLength > 0) {
    payload.minLength = minLength
  }
  if (!rule.caseSensitive) payload.caseSensitive = false
  return payload
}

/** 応答したときに実行すること1つぶん（画面で持つ形）。 */
export interface InlineAction {
  /** 画面で並べ替えるための一時的な id。保存しない。 */
  key: string
  actionType: ScenarioActionType
  config: unknown
}

let actionKeySeq = 0
export function newActionKey(): string {
  actionKeySeq += 1
  return `action-${actionKeySeq}`
}

export function readInlineActions(stored: unknown[] | null | undefined): InlineAction[] {
  if (!Array.isArray(stored)) return []
  return stored.flatMap((item): InlineAction[] => {
    if (!item || typeof item !== 'object') return []
    const r = item as Record<string, unknown>
    const actionType = r.actionType ?? r.action_type
    if (typeof actionType !== 'string') return []
    const raw = r.config ?? r.config_json
    let config: unknown = raw
    if (typeof raw === 'string') {
      try {
        config = JSON.parse(raw)
      } catch {
        config = {}
      }
    }
    return [{ key: newActionKey(), actionType: actionType as ScenarioActionType, config }]
  })
}

export function toActionPayload(action: InlineAction): Record<string, unknown> {
  return { actionType: action.actionType, config: action.config ?? {} }
}
