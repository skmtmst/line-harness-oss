import type { TapExtras } from '@line-crm/shared'
export type ResearchFormat = 'single' | 'multiple' | 'free'

export interface ResearchQuestion { key: string; text: string; format: ResearchFormat; required: boolean; choices: string[]; choiceTapExtras?: TapExtras[] }

export const visualQuestions = (): ResearchQuestion[] => [
  { key: 'vq-1', text: '来月も定期便を続けたいと思いますか？', format: 'single', required: true, choices: ['続けたい', 'どちらともいえない', '止めたい'], choiceTapExtras: [{}, {}, { scoreChange: 10 }] },
  { key: 'vq-2', text: 'よく使っている商品を教えてください', format: 'multiple', required: false, choices: ['フード', 'おやつ', 'ケア用品'] },
  { key: 'vq-3', text: '改善してほしいところがあれば教えてください', format: 'free', required: false, choices: [] },
]

export function assetInitial(payload: Record<string, unknown>) {
  const str = (value: unknown) => (typeof value === 'string' ? value : '')
  const num = (value: unknown, fallback: string) => (typeof value === 'number' && Number.isFinite(value) ? String(value) : fallback)
  const questions = Array.isArray(payload.questions)
    ? payload.questions.flatMap((item): ResearchQuestion[] => {
      if (!item || typeof item !== 'object') return []
      const q = item as Record<string, unknown>
      const format: ResearchFormat = q.format === 'multiple' || q.format === 'free' ? q.format : 'single'
      return [{ key: crypto.randomUUID(), text: str(q.text), format, choiceTapExtras: Array.isArray(q.choiceTapExtras) ? q.choiceTapExtras as TapExtras[] : [], required: q.required !== false, choices: Array.isArray(q.choices) ? q.choices.map(str) : [] }]
    })
    : []
  return {
    tapExtras: payload.tapExtras as TapExtras | undefined,
    description: str(payload.description),
    couponTitle: str(payload.title),
    imageUrl: str(payload.imageUrl),
    couponOnce: payload.oncePerFriend === false ? 'unlimited' as const : 'once' as const,
    couponVisibility: payload.visibility === 'link' ? 'link' as const : 'friends' as const,
    lottery: payload.lottery === true,
    lotteryRate: num(payload.lotteryRate, '20'),
    winnerLimit: num(payload.winnerLimit, '500'),
    startsAt: str(payload.startsAt),
    endsAt: str(payload.endsAt),
    questions,
  }
}
