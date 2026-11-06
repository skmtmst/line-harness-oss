import type { ScenarioQuestion } from '@/components/scenarios/question-editor'

/** 下書きの質問を配信する通へ混ぜない。通常のテンプレートはそのまま使える。 */
export function isSelectableScenarioTemplate(template: { question?: unknown; questionStatus?: string | null }): boolean {
  return !template.question || template.questionStatus === 'published'
}

/** 選んだ後の編集が元のテンプレートへ戻らないよう、選択肢の鍵ごと独立した控えにする。 */
export function cloneScenarioQuestion(question: ScenarioQuestion): ScenarioQuestion {
  return structuredClone(question)
}
