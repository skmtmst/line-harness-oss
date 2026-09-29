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
 * 押されたことは postback で戻ってくる。data は公開版に固定された通を指す
 * `sq:2:<版ID>:<通番>:<index>` の形（旧形の `sq:<下書き通ID>:<index>` も
 * 読める）。LINE の postback data は300文字までなので、本文は入れずに参照
 * だけ載せる。
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

/**
 * 押されたボタンがどの通のものかを指す参照。
 *
 * - `version` … 公開版に固定された通（`<版ID>:<通番>`）。**新しく送る質問は
 *   必ずこちら。** 押されたときに版の写しだけを読めるので、公開後の編集が
 *   旧版の購読へ混入しない。下書きの通を消しても押し口が死なない。
 * - `live` … 下書き（scenario_steps.id）。この変更より前に送った質問が
 *   まだトークに残っているので、読めるようにしておく。
 */
export type QuestionStepRef =
  | { kind: 'version'; stepId: string }
  | { kind: 'live'; stepId: string }

/** 版所有の通IDが混ざる前の形（`sq:<下書き通ID>:<番号>`）と区別する目印。 */
const VERSION_POSTBACK_MARK = '2'

export function toQuestionStepRef(ref: QuestionStepRef | string): QuestionStepRef {
  return typeof ref === 'string' ? { kind: 'live', stepId: ref } : ref
}

/**
 * postback の data を作る。
 *
 * 版所有の通IDは `<版ID>:<通番>` でコロンを含む。そのまま並べると
 * `sq:<版ID>:<通番>:<番号>` になり、区切りの数が形によって変わる。
 * 先頭に目印を1つ置き、読むときは**右端の1つだけ**を番号として切る。
 * こうすると通IDの形が変わっても解釈が揺れない。
 */
export function buildQuestionPostbackData(
  ref: QuestionStepRef | string,
  choiceIndex: number,
): string {
  const target = toQuestionStepRef(ref)
  if (target.kind === 'version') {
    return `${QUESTION_POSTBACK_PREFIX}:${VERSION_POSTBACK_MARK}:${target.stepId}:${choiceIndex}`
  }
  return `${QUESTION_POSTBACK_PREFIX}:${target.stepId}:${choiceIndex}`
}

/** 同じ通の押下をまとめて数えるための前置き（末尾の番号を落とした形）。 */
export function buildQuestionPostbackPrefix(ref: QuestionStepRef | string): string {
  const target = toQuestionStepRef(ref)
  if (target.kind === 'version') {
    return `${QUESTION_POSTBACK_PREFIX}:${VERSION_POSTBACK_MARK}:${target.stepId}:`
  }
  return `${QUESTION_POSTBACK_PREFIX}:${target.stepId}:`
}

export function parseQuestionPostback(
  data: string,
): { kind: 'version' | 'live'; stepId: string; choiceIndex: number } | null {
  const head = `${QUESTION_POSTBACK_PREFIX}:`
  if (!data.startsWith(head)) return null
  const rest = data.slice(head.length)
  const at = rest.lastIndexOf(':')
  if (at <= 0 || at === rest.length - 1) return null
  const choiceIndex = Number(rest.slice(at + 1))
  if (!Number.isInteger(choiceIndex) || choiceIndex < 0) return null
  const body = rest.slice(0, at)
  if (!body) return null

  const versionHead = `${VERSION_POSTBACK_MARK}:`
  if (body.startsWith(versionHead)) {
    const stepId = body.slice(versionHead.length)
    // 版所有の通IDは `<版ID>:<通番>`。区切りが無い形は受け取らない。
    if (!stepId || !stepId.includes(':')) return null
    return { kind: 'version', stepId, choiceIndex }
  }
  // 旧形。下書きの通IDにコロンは入らない。
  if (body.includes(':')) return null
  return { kind: 'live', stepId: body, choiceIndex }
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
  ref: QuestionStepRef,
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
    data: buildQuestionPostbackData(ref, index),
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
  step: QuestionStepRef | string,
): Message[] {
  const ref = toQuestionStepRef(step)
  const messages: Message[] = []
  if (question.intro && question.intro.trim() !== '') {
    messages.push({ type: 'text', text: question.intro })
  }

  const buttons = question.choices.map((choice, index) => ({
    type: 'button',
    style: index === 0 ? 'primary' : 'secondary',
    height: 'sm',
    margin: index === 0 ? 'none' : 'sm',
    action: buildChoiceAction(choice, ref, index),
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
  step: QuestionStepRef | string,
  choiceIndex: number | null,
  /**
   * 同じ通を指す別の形。版へ移す前に押されたぶん（`sq:<下書き通ID>:...`）を
   * 2度目と数えるために渡す。渡さないと、公開版へ移した瞬間に全員の
   * 「1度目」が戻ってしまう。
   */
  alsoMatch?: QuestionStepRef | string | null,
): Promise<boolean> {
  const refs = [toQuestionStepRef(step)]
  if (alsoMatch) refs.push(toQuestionStepRef(alsoMatch))

  for (const ref of refs) {
    const pattern =
      choiceIndex === null
        ? `${buildQuestionPostbackPrefix(ref)}%`
        : buildQuestionPostbackData(ref, choiceIndex)
    const row = await db
      .prepare(
        `SELECT 1 AS ok FROM messages_log
          WHERE friend_id = ? AND direction = 'incoming' AND source = 'postback'
            AND content LIKE ?
          LIMIT 1`,
      )
      .bind(friendId, pattern)
      .first<{ ok: number }>()
    if (row) return true
  }
  return false
}
