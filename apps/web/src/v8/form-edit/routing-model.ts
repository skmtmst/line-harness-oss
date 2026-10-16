import type { FormBlock, FormInputBlock } from '@line-crm/shared'
import type { FormRouting, RoutingRule, RoutingTarget } from '@/lib/api-gap2'
import { isChoiceType } from './model'

/*
 * 答えで予約の行き先を分ける（B6-1・BGoRL）の決まり。
 * 条件に使えるのは 1 つ選ぶ・いくつでも選ぶ・プルダウンの質問（自由記述は当て方がぶれるので使えない）。
 * 上から順に最初に当たった行。最後の「どれにも当たらないとき」は消せず、メニューを選ぶまで保存できない。行は 50 まで。
 */
export const MAX_ROUTING_ROWS = 50
export const emptyTarget = (): RoutingTarget => ({ menuId: '', staffGroupId: null, staffId: null, meetingMode: null })
export const emptyRouting = (): FormRouting => ({ enabled: false, rules: [], fallback: emptyTarget() })

/** 条件に使える質問（予約ブロックより前・同じフォームの選ぶ質問）。 */
export function routingQuestions(blocks: FormBlock[]): FormInputBlock[] {
  return blocks.filter((b): b is FormInputBlock => b.kind === 'input' && isChoiceType(b.type) && (b.choices?.length ?? 0) > 0)
}
export const hasBookingBlock = (blocks: FormBlock[]) => blocks.some((b) => b.kind === 'input' && b.type === 'booking')
export const choiceModeLabel = (type: string) => (type === 'radio' ? '1 つ選ぶ' : type === 'checkbox' ? 'いくつでも選ぶ' : 'プルダウン')

export function newRule(questionId: string, answer: string): RoutingRule {
  return { id: `rr-${Math.random().toString(36).slice(2, 10)}`, conditions: [{ questionId, op: 'is', value: answer }], target: emptyTarget() }
}
const answerOf = (rule: RoutingRule) => (rule.conditions[0]?.value as string | undefined) ?? ''
export const ruleAnswer = answerOf

/** 上から順に最初に当たった行の番号。当たらなければ -1（＝どれにも当たらない）。 */
export function matchRule(routing: FormRouting, questionId: string, answers: string[]): number {
  return routing.rules.findIndex((rule) => rule.conditions.every((c) => c.questionId === questionId && answers.includes(String(c.value))))
}

/** 保存の前の確かめ。誤りの行（0 始まり・fallback は rules.length）と文を返す。 */
export function routingError(routing: FormRouting | undefined): { row: number; message: string } | null {
  if (!routing?.enabled) return null
  if (routing.rules.length > MAX_ROUTING_ROWS) return { row: MAX_ROUTING_ROWS, message: `行き先は ${MAX_ROUTING_ROWS} 行までです。` }
  const bad = routing.rules.findIndex((rule) => !rule.target.menuId)
  if (bad >= 0) return { row: bad, message: `${bad + 1} 行目の出すメニューを選んでください。` }
  if (!routing.fallback.menuId) return { row: routing.rules.length, message: '「どれにも当たらないとき」の出すメニューを選んでください。' }
  return null
}

/** 回答フォームの版の JSON に載せる決まり。型（shared）が来るまで layout の routing として持つ。 */
export const routingOf = (layout: unknown): FormRouting | undefined => (layout as { routing?: FormRouting }).routing
