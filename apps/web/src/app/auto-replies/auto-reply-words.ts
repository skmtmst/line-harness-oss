/**
 * 自動応答の一覧に出す言葉を、1か所にまとめる。
 *
 * 一覧には `silent` `flex` `image` `text` `(inline)` のような**保存してある
 * ままの値**と、`line_account_id` `automation rule` のような**作った側の
 * 呼び方**がそのまま出ていた。運用する人はこの言葉を知らないので、
 * 「このルールは何をするのか」が画面から読めない。
 *
 * さらに、テンプレートやアカウントの名前が引けないときに **ID の頭だけを
 * 出していた**（`(未知 a1b2c3)` `lineAccountId.slice(0, 8)`）。
 * 断片は運用の役に立たないうえ、画面写真や問い合わせに載って外へ出る。
 * **IDは断片も画面に出さない。**
 *
 * ここは React を持たない素の関数だけにしてある。画面を組み立てなくても
 * 言い換えの表だけを試験でき、次に同じ値が増えたときの直し場所も1つで済む。
 */

/** 適用アカウント欄が持つ3つの状態。API がこの3つで返す。 */
export type EffectiveStatus = 'reply' | 'silent' | 'not_applicable'

/** 返信の中身をどこから取るか。API がこの2つ（または未設定）で返す。 */
export type EffectiveVia = 'inline' | 'automation' | null

/** 一覧そのものを出せるかどうか。 */
export type LoadState = 'loading' | 'ready' | 'error' | 'forbidden'

/** 短い見出しと、その場で読める説明。説明は `title` や補足行に出す。 */
export interface Word {
  label: string
  note: string
}

/**
 * 何を返すルールか。
 *
 * `silent` は「返信の中身が入っていない」状態のこと。止まっているのでも
 * 壊れているのでもないので、**何が起きるか**をそのまま書く。
 */
export function responseTypeWord(responseType: string): Word {
  switch (responseType) {
    case 'silent':
      return {
        label: '返信しない',
        note: '返信は送りません。設定した後続処理がある場合は実行します',
      }
    case 'text':
      return { label: 'テキスト', note: '文章を送ります' }
    case 'image':
      return { label: '画像', note: '画像を送ります' }
    case 'flex':
      return { label: 'カード', note: '画像やボタンを並べたカードを送ります' }
    default:
      /*
       * 知らない値をそのまま出さない。出すと画面に内部の値が復活する。
       * 「開けば分かる」ところまで案内して終わる。
       */
      return {
        label: '未対応の返し方',
        note: 'この一覧では中身を表示できません。設定を開いて確認してください',
      }
  }
}

/** キーワードの見かた。`包含` は作った側の言い方なので使わない。 */
export function matchTypeWord(matchType: 'exact' | 'contains'): string {
  return matchType === 'exact' ? '完全一致' : '部分一致'
}

/**
 * どこに書いた本文を送るか。
 *
 * `(inline)` は「テンプレートを使わず、この設定の中に直接書いてある」の
 * 意味だった。`(未知 xxxxxx)` は参照先が引けなかったときに ID の頭6文字を
 * 出していたもの。**どちらも運用者の言葉に置き換え、IDは出さない。**
 */
export function templateWord(
  templateId: string | null,
  templateName: string | null | undefined,
  templateListAvailable = true,
): Word & { linked: boolean } {
  if (!templateId) {
    return {
      label: 'この設定に直接入力',
      note: 'テンプレートを使わず、この自動応答に書いた本文を送ります',
      linked: false,
    }
  }
  if (templateName) {
    return { label: templateName, note: 'テンプレートの本文を送ります', linked: true }
  }
  if (!templateListAvailable) {
    return {
      label: 'テンプレートを確認できません',
      note: 'テンプレートの一覧を読み込めませんでした。再読み込みしてください',
      linked: false,
    }
  }
  return {
    label: 'テンプレートを表示できません',
    note: '選んであるテンプレートが削除されたか、見る権限がありません。設定を開いて選び直してください',
    linked: false,
  }
}

/** 適用アカウントの札に出す印。文字は同じ札のアカウント名が持つ。 */
export function effectiveAccountWord(
  status: EffectiveStatus,
  via: EffectiveVia,
): { mark: string; note: string } {
  if (status === 'not_applicable') {
    return {
      mark: '',
      note: 'このアカウントでは動きません。別のアカウント専用の設定です',
    }
  }
  if (status === 'reply') {
    return via === 'automation'
      ? {
          mark: '✓',
          note: 'このアカウントで返信します。返信の中身は、つないである別の設定から送ります',
        }
      : {
          mark: '✓',
          note: 'このアカウントで返信します。返信の中身は、この自動応答に書いてあります',
        }
  }
  return {
    mark: '⚠',
    note: 'このアカウントでは返信しません。設定した後続処理がある場合は実行します',
  }
}

/**
 * 名前を引けなかったアカウント。
 *
 * ここで ID の頭8文字を出していた。**断片では誰も見分けられない**うえ、
 * 画面写真に載って外へ出る。何が起きているかだけを書く。
 */
export const UNNAMED_ACCOUNT: Word = {
  label: '表示できないアカウント',
  note: 'いまのログインでは、このLINEアカウントの名前を確認できません',
}

/** 適用アカウント欄の凡例。札の見た目と1対1で並べる。 */
export const EFFECTIVE_LEGEND: ReadonlyArray<{
  status: EffectiveStatus
  mark: string
  text: string
}> = [
  {
    status: 'reply',
    mark: '✓',
    text: 'このアカウントで返信します。⚙ が付いているものは、返信の中身をつないである別の設定から送ります。',
  },
  {
    status: 'silent',
    mark: '⚠',
    text: 'このアカウントでは返信しません。設定した後続処理がある場合は実行します。',
  },
  {
    status: 'not_applicable',
    mark: '',
    text: 'このアカウントでは動きません。別のアカウント専用の設定です。',
  },
]

/** 応答したときに行うこと。設定を開かずに何をするルールか読めるようにする。 */
const ACTION_WORDS: Record<string, string> = {
  tag: 'タグ',
  friend_field: '友だち情報',
  support_mark: '対応マーク',
  scenario: 'シナリオ',
  common_var: '共通情報',
}

export function actionWord(actionType: string): string {
  // 知らない値をそのまま出すと、画面に内部の値が復活する。
  return ACTION_WORDS[actionType] ?? 'その他の処理'
}

/**
 * 対象にするメッセージの種類。
 *
 * 一覧の絞り込み札と編集画面の選択肢で同じ表を使う。別々に持つと、
 * 片方だけ増えて「一覧では英語、編集では日本語」になる。
 */
export const MESSAGE_KIND_WORDS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'text', label: 'テキスト' },
  { key: 'image', label: '画像' },
  { key: 'video', label: '動画' },
  { key: 'audio', label: '音声' },
  { key: 'file', label: 'ファイル' },
  { key: 'location', label: '位置情報' },
  { key: 'sticker', label: 'スタンプ' },
  { key: 'postback', label: 'ボタンのタップ' },
]

export function messageKindWord(kind: string): string {
  return MESSAGE_KIND_WORDS.find((m) => m.key === kind)?.label ?? 'その他のメッセージ'
}

/**
 * 一覧を出せないときの言い方。
 *
 * 「読み込んでいます」「読み込めませんでした」「見る権限がありません」を
 * **混ぜない**。混ぜると、まだ読んでいる途中なのか、権限が無いのか、
 * 通信が切れたのかが読み分けられない。
 */
export const LOAD_STATE_WORDS: Record<Exclude<LoadState, 'ready'>, Word> = {
  loading: { label: '読み込んでいます', note: 'このまま少しお待ちください。' },
  error: {
    label: '読み込めませんでした',
    note: '通信状態を確認して、もう一度読み込んでください。',
  },
  forbidden: {
    label: '見る権限がありません',
    note: '自動応答を見るには権限が要ります。オーナーか管理者に追加を依頼してください。',
  },
}

/** 操作できないときの言い方。見る権限とは別に持つ。 */
export const NO_WRITE_PERMISSION: Word = {
  label: '操作する権限がありません',
  note: '自動応答を削除するには権限が要ります。オーナーか管理者に依頼してください。',
}

/**
 * 数えられていないときに `0` と書かない。
 *
 * 読み込めていないのに `0件` と出すと、**本当に0件だったのと見分けが
 * つかない**。実際の0だけが `0件` を名乗る。
 */
export function metricWord(state: LoadState, value: number | null): string {
  /*
    **`null` は「読めたが数えられなかった」。** 一覧は読めていても、
    ヒット数を持たないルールが1つでもあると合計は足りない。足りない数を
    そのまま出すと、**実測より小さい数を実測として読ませる**ことになる。
  */
  return state === 'ready' && value !== null ? String(value) : '—'
}

/** 遅れて返った別アカウント・前世代の取得結果を画面へ入れない。 */
export function isCurrentAutoReplyLoad(
  requestAccountId: string | null,
  currentAccountId: string | null,
  requestGeneration: number,
  currentGeneration: number,
): boolean {
  return requestAccountId === currentAccountId && requestGeneration === currentGeneration
}

/** アカウント切替直後の1描画でも、前アカウントの一覧を見せない。 */
export function visibleAutoReplyLoadState(
  state: LoadState,
  loadedAccountId: string | null | undefined,
  selectedAccountId: string | null,
): LoadState {
  return loadedAccountId === selectedAccountId ? state : 'loading'
}
