/*
 * 質問メッセージ（シナリオの分岐）。
 *
 * Lステップの「質問」タブにあたる。質問文と選択肢を出し、押された選択肢に
 * 応じてタグ・友だち情報・シナリオを動かす。
 *
 * 選択肢は Flex のボタンとして出す。テンプレートメッセージ（buttons）は
 * 選択肢が4つまでで、ラベルも短い。Flex なら数を増やせるうえ、押した跡を
 * 残す作りにもできる。
 *
 * 押されたことは postback で戻ってくる。data は `sq:<stepId>:<index>` の形。
 * LINE の postback data は300文字までなので、本文は入れずに参照だけ載せる。
 */
import type { Message } from '@line-crm/line-sdk'

/** 選択肢を押したあとの挙動。Lステップの「選択後の挙動」と同じ並び。 */
export type ChoiceBehavior =
  | 'none'
  | 'url'
  | 'tel'
  | 'add_friend'
  | 'mail'
  | 'form'
  | 'scenario'

export interface QuestionChoiceScenarioOp {
  op: 'start' | 'stop'
  scenarioId?: string | null
  /** start のとき、読んだことがある人をどこから始めるか。 */
  restart?: 'from_start' | 'from_read'
  /** いま読んでいるシナリオを控えて、あとで戻せるようにする。 */
  rememberPrevious?: boolean
}

export interface ScenarioQuestionChoice {
  /** ボタンに出る文字。LINE 側の都合で10文字を超えると途切れることがある。 */
  label: string
  behavior: ChoiceBehavior
  url?: string
  tel?: string
  email?: string
  formId?: string
  scenario?: QuestionChoiceScenarioOp
  /** 押したとき、友だちの発言として送られる文。空なら label が使われる。 */
  userMessage?: string
  /** 友だちの発言として出さない。 */
  hideUserMessage?: boolean
  /** 押したときに自動で返す文。 */
  reply?: string
  /** 2度目に押したときに返す文。空なら既定の文言。 */
  repeatReply?: string
  addTagIds?: string[]
  removeTagIds?: string[]
  field?: { fieldId: string; value: string }
}

export interface ScenarioQuestion {
  /** 前文。質問の前にテキストメッセージとして流れる。 */
  intro?: string
  /** 質問文。 */
  text: string
  /** PC版・通知欄に出る代替テキスト。 */
  altText?: string
  /** single なら1つ押したら他は押せない。multiple なら全部押せる。 */
  tapMode: 'single' | 'multiple'
  choices: ScenarioQuestionChoice[]
}

export const DEFAULT_REPEAT_REPLY = 'すでに押されています！'
export const QUESTION_POSTBACK_PREFIX = 'sq'

export function parseQuestion(raw: string | null | undefined): ScenarioQuestion | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as ScenarioQuestion
    if (!parsed || typeof parsed !== 'object') return null
    if (typeof parsed.text !== 'string' || parsed.text.trim() === '') return null
    if (!Array.isArray(parsed.choices) || parsed.choices.length === 0) return null
    return {
      ...parsed,
      tapMode: parsed.tapMode === 'multiple' ? 'multiple' : 'single',
    }
  } catch {
    return null
  }
}

export function buildQuestionPostbackData(stepId: string, choiceIndex: number): string {
  return `${QUESTION_POSTBACK_PREFIX}:${stepId}:${choiceIndex}`
}

export function parseQuestionPostback(
  data: string,
): { stepId: string; choiceIndex: number } | null {
  if (!data.startsWith(`${QUESTION_POSTBACK_PREFIX}:`)) return null
  const parts = data.split(':')
  if (parts.length !== 3) return null
  const choiceIndex = Number(parts[2])
  if (!Number.isInteger(choiceIndex) || choiceIndex < 0) return null
  if (!parts[1]) return null
  return { stepId: parts[1], choiceIndex }
}

/**
 * 選択肢のボタンにする action を組み立てる。
 *
 * 「シナリオを移動・停止」「何もしない」は postback にする。押されたことを
 * こちらで受けないと、タグ付けも返信もできないため。URL・電話・メールは
 * LINE 側で開かせたいので、それぞれの action を使う。
 *
 * ただし **押した記録は必ず欲しい**ので、URL などを開く場合も postback を
 * 併用したいところだが、LINE のボタンは action を1つしか持てない。
 * ここは「開く」を優先する。記録が要るときは、画面側で「何もしない」＋
 * 本文にURLを書く運用になる。
 */
function buildChoiceAction(
  choice: ScenarioQuestionChoice,
  stepId: string,
  index: number,
): Record<string, unknown> {
  const label = (choice.label || `選択肢${index + 1}`).slice(0, 20)

  switch (choice.behavior) {
    case 'url':
      if (choice.url) return { type: 'uri', label, uri: choice.url }
      break
    case 'tel':
      if (choice.tel) return { type: 'uri', label, uri: `tel:${choice.tel}` }
      break
    case 'mail':
      if (choice.email) return { type: 'uri', label, uri: `mailto:${choice.email}` }
      break
    case 'add_friend':
      if (choice.url) return { type: 'uri', label, uri: choice.url }
      break
    case 'form':
      if (choice.url) return { type: 'uri', label, uri: choice.url }
      break
    default:
      break
  }

  const action: Record<string, unknown> = {
    type: 'postback',
    label,
    data: buildQuestionPostbackData(stepId, index),
  }
  // 友だちの発言として出す文。空なら LINE 側が何も出さないので、
  // 押したことがトークに残らない。既定では選択肢の文字を出す。
  if (!choice.hideUserMessage) {
    action.displayText = (choice.userMessage || choice.label || '').slice(0, 300)
  }
  return action
}

/**
 * 質問を LINE のメッセージに組み立てる。
 *
 * 前文があれば、テキスト → 質問 の2通になる。Lステップも前文は別メッセージ
 * として流れると書いてあるので、そこに合わせる。
 */
export function buildQuestionMessages(
  question: ScenarioQuestion,
  stepId: string,
): Message[] {
  const messages: Message[] = []
  if (question.intro && question.intro.trim() !== '') {
    messages.push({ type: 'text', text: question.intro })
  }

  const buttons = question.choices.map((choice, index) => ({
    type: 'button',
    style: index === 0 ? 'primary' : 'secondary',
    height: 'sm',
    margin: index === 0 ? 'none' : 'sm',
    action: buildChoiceAction(choice, stepId, index),
  }))

  const bubble = {
    type: 'bubble',
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'md',
      contents: [
        { type: 'text', text: question.text, wrap: true, weight: 'bold', size: 'md' },
        { type: 'box', layout: 'vertical', margin: 'md', contents: buttons },
      ],
    },
  }

  messages.push({
    type: 'flex',
    altText: (question.altText || question.text || '質問').slice(0, 400),
    contents: bubble,
  } as unknown as Message)

  return messages
}

/**
 * 同じ選択肢がすでに押されているか。
 *
 * 押した記録は messages_log の incoming postback をそのまま使う。専用の表を
 * 足さないのは、記録の置き場所が2つに分かれると必ず片方だけ消える運用が
 * 起きるため。
 */
export async function hasAnsweredBefore(
  db: D1Database,
  friendId: string,
  stepId: string,
  choiceIndex: number | null,
): Promise<boolean> {
  const prefix =
    choiceIndex === null
      ? `${QUESTION_POSTBACK_PREFIX}:${stepId}:`
      : buildQuestionPostbackData(stepId, choiceIndex)
  const row = await db
    .prepare(
      `SELECT 1 AS ok FROM messages_log
        WHERE friend_id = ? AND direction = 'incoming' AND source = 'postback'
          AND content LIKE ?
        LIMIT 1`,
    )
    .bind(friendId, choiceIndex === null ? `${prefix}%` : prefix)
    .first<{ ok: number }>()
  return !!row
}
