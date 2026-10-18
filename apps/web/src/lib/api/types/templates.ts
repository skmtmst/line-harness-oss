/** 質問テンプレート。シナリオの質問と同じ契約を使う。 */
export type TemplateQuestion = {
  intro?: string
  text: string
  altText?: string
  tapMode: 'single' | 'multiple'
  choices: Array<{
    label: string
    behavior: 'none' | 'url' | 'tel' | 'add_friend' | 'mail' | 'form' | 'scenario'
    url?: string
    tel?: string
    email?: string
    formId?: string
    scenario?: { op: 'start' | 'stop'; scenarioId?: string | null; restart?: 'from_start' | 'from_read'; rememberPrevious?: boolean }
    userMessage?: string
    hideUserMessage?: boolean
    reply?: string
    repeatReply?: string
    addTagIds?: string[]
    scoreChange?: number | null
    removeTagIds?: string[]
    field?: { fieldId: string; value: string }
  }>
}
