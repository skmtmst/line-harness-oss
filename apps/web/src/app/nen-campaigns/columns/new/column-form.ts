import type { NenColumnCreateInput } from '@/lib/api'

/**
 * NENコラムの下書き作成（設計 `ymXJK` 21-1-E／契約 #618）。
 *
 * **記事の本文はここに保存しない。** 正本はEC側にあり、この画面が作るのは
 * 「外部記事へのリンクを持つ下書き」だけ。本文の入力欄を置くと、
 * どちらが正本なのか分からなくなる。
 */

export const TITLE_MAX = 120
export const CATEGORY_MAX = 40
export const EXCERPT_MAX = 200

export type ColumnDraft = {
  title: string
  category: string
  excerpt: string
  articleUrl: string
  imageUrl: string
  publishedAt: string
}

export const EMPTY_DRAFT: ColumnDraft = {
  title: '', category: '', excerpt: '', articleUrl: '', imageUrl: '', publishedAt: '',
}

/** HTTPSだけ。httpや相対URLは、押したときにLINE側で開けない。 */
function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

export type FieldError = { field: keyof ColumnDraft; message: string }

/**
 * 送る前に画面で確かめる。
 *
 * **Workerの検査を置き換えない。** ここで通してもWorkerが断ることはある。
 * 押してから断られるより、打っている最中に気づけるほうが早いだけ。
 */
export function validateDraft(draft: ColumnDraft): FieldError[] {
  const errors: FieldError[] = []
  const title = draft.title.trim()
  if (title.length === 0 || title.length > TITLE_MAX) {
    errors.push({ field: 'title', message: `題名を1〜${TITLE_MAX}文字で入力してください。` })
  }
  if (!isHttpsUrl(draft.articleUrl.trim())) {
    errors.push({ field: 'articleUrl', message: 'HTTPSの記事URLを入力してください。' })
  }
  if (draft.imageUrl.trim() && !isHttpsUrl(draft.imageUrl.trim())) {
    errors.push({ field: 'imageUrl', message: '画像URLはHTTPSで入力してください。' })
  }
  if (draft.category.trim().length > CATEGORY_MAX) {
    errors.push({ field: 'category', message: `分類を${CATEGORY_MAX}文字以内にしてください。` })
  }
  if (draft.excerpt.trim().length > EXCERPT_MAX) {
    errors.push({ field: 'excerpt', message: `概要を${EXCERPT_MAX}文字以内にしてください。` })
  }
  return errors
}

/**
 * 送る形にする。
 *
 * **`publishedAt` が空でも今日を補わない。** 補うと、書いただけのものが
 * 公開済みとして扱われる。空は「下書きのまま」。
 * `body` `slug` `externalId` `lineAccountId` は送らない（送ると400になる）。
 */
export function toCreateInput(draft: ColumnDraft): NenColumnCreateInput {
  const optional = (value: string) => (value.trim() ? value.trim() : undefined)
  return {
    title: draft.title.trim(),
    ...(optional(draft.category) ? { category: draft.category.trim() } : {}),
    ...(optional(draft.excerpt) ? { excerpt: draft.excerpt.trim() } : {}),
    articleUrl: draft.articleUrl.trim(),
    imageUrl: optional(draft.imageUrl) ?? null,
    publishedAt: optional(draft.publishedAt) ?? null,
  }
}

const CODE_MESSAGE: Record<string, string> = {
  title_invalid: '題名を1〜120文字で入力してください。',
  article_url_invalid: 'HTTPSの記事URLを入力してください。',
  image_url_invalid: '画像URLはHTTPSで入力してください。',
  category_too_long: '分類を指定の文字数以内にしてください。',
  excerpt_too_long: '概要を指定の文字数以内にしてください。',
  published_at_invalid: '公開日時をタイムゾーン付きで入力してください。',
  payload_too_large: '入力内容が大きすぎます。本文は入力せず、外部記事のURLを指定してください。',
  column_already_exists: '同じ記事のコラムがすでにあります。一覧を読み直してください。',
  column_create_failed: '下書きを保存できませんでした。時間をおいて、もう一度お試しください。',
  request_invalid: '送れない項目が含まれていました。入力を確認してください。',
}

export type Failure = {
  /** 権限不足と入力の誤りと保存失敗を混ぜない。読む人が次にすることが違う。 */
  kind: 'forbidden' | 'input' | 'conflict' | 'failure'
  message: string
}

/**
 * Workerの合図を、画面の言葉にする。
 *
 * **知らない合図をそのまま出さない。** `column_create_failed` のような
 * 英語の記号が画面に出ると、何をすればよいのか分からない。
 *
 * **409で「どのアカウントの記事と重なったか」は言わない。** 契約も返さない。
 * 別のアカウントに何があるかを画面で推測しない。
 */
export function failureOf(input: { status?: number; code?: string }): Failure {
  if (input.status === 403) {
    return {
      kind: 'forbidden',
      message: 'このアカウントでコラムを保存する権限がありません。管理者にご確認ください。',
    }
  }
  if (input.status === 409) {
    return { kind: 'conflict', message: CODE_MESSAGE.column_already_exists }
  }
  const known = input.code ? CODE_MESSAGE[input.code] : undefined
  if (input.status === 400 || input.status === 413) {
    return { kind: 'input', message: known ?? CODE_MESSAGE.request_invalid }
  }
  return { kind: 'failure', message: known ?? CODE_MESSAGE.column_create_failed }
}

/** 送ってよいか。入力の誤りが1つでもあれば送らない。 */
export function canSubmit(input: { draft: ColumnDraft; busy: boolean }): boolean {
  if (input.busy) return false
  return validateDraft(input.draft).length === 0
}
