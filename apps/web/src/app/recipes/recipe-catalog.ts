import type { FeatureKey } from '@/lib/feature-settings'

/**
 * レシピの正本。設計 ★V6 34-2「レシピ一覧」（`y0P0Qx`）の 3 本。
 *
 * **レシピは実行基盤を持たない静的な見本**（要件 v6-34 §7-1）。
 * だから一覧の中身はサーバに置かず、ここを正本にする。
 * 変わるのは「必要な機能が入っているか」と「これまで何回作られたか」だけで、
 * 前者は機能設定から引ける。後者は数える口がまだ無い（→ 台帳 #134）。
 */

export interface RecipeRequirement {
  label: string
  /**
   * 機能設定の鍵。**`null` は「切れない機能」**（友だち属性など）。
   * 鍵が無いことと、機能がオフなことを混ぜない。
   */
  feature: FeatureKey | null
}

/** 作られるものの 1 行。**状態は必ず「下書き」。** */
export interface RecipeItem {
  /** 種類。タグ・友だち追加時のルール・シナリオ・テンプレートなど。 */
  kind: string
  /** 作られるものの名前。 */
  name: string
  /** どう使われるか。 */
  note: string
}

export interface Recipe {
  id: string
  name: string
  /** 何のためのレシピか。1行。 */
  purpose: string
  /** 作られるもの。設計の1行をそのまま持つ。 */
  creates: string
  /** 全部でいくつ作られるか。内訳が決まっていなければ null。 */
  itemCount: number | null
  /**
   * 作られるものの内訳。
   *
   * **決まっていないものを埋めない。** 設計 ★V6 34-3（`D5UaX`）が
   * 内訳まで描いているのは「新規登録 7日間フォロー」だけで、
   * ほかは要件 §7-2 にある分までしか決まっていない。
   * 無いものは `null` にして、画面で「まだ決まっていません」と言う。
   */
  items: ReadonlyArray<RecipeItem> | null
  /** 内訳に出しきれなかった残り。設計の「ほか 11件（…）」の行。 */
  itemsRest: string | null
  requirements: ReadonlyArray<RecipeRequirement>
}

const FRIEND_ATTRIBUTES: RecipeRequirement = { label: '友だち属性', feature: null }

export const RECIPES: ReadonlyArray<Recipe> = [
  {
    id: 'signup-7day-follow',
    name: '新規登録 7日間フォロー',
    purpose: '友だちが増えたあと、7日かけて関係を作ります。',
    creates: 'タグ1つ、友だち追加時のルール1本、シナリオ7通、テンプレート7本',
    itemCount: 16,
    items: [
      { kind: 'タグ', name: '新規', note: '友だち追加時のルールから付きます' },
      {
        kind: '友だち追加時のルール',
        name: 'はじめて',
        note: 'タグを付けて、シナリオを開始します',
      },
      {
        kind: 'シナリオ',
        name: '新規登録 7日間フォロー',
        note: '7通。0日目・1日目・3日目・5日目・7日目・質問1通・完了時のタグ付け',
      },
      {
        kind: 'テンプレート',
        name: '1通目 はじめまして ほか6本',
        note: '本文は見本です。会社名などは共通情報から入ります',
      },
      { kind: 'タグ', name: 'フォロー完了', note: 'シナリオを最後まで受け取った人に付きます' },
    ],
    itemsRest: 'ほか 11件（テンプレート6本、シナリオの各通の設定5件）',
    requirements: [
      FRIEND_ATTRIBUTES,
      { label: '友だち追加時の配信', feature: 'friend_add_routing' },
      { label: 'シナリオ配信', feature: 'scenarios' },
      { label: 'テンプレート', feature: 'templates' },
    ],
  },
  {
    id: 'booking-reminder',
    name: '予約のリマインド',
    purpose: '前日と当日に、予約を思い出してもらいます。',
    creates: 'タグ1つ、リマインダ2本、テンプレート2本',
    itemCount: 5,
    items: [
      { kind: 'タグ', name: '予約あり', note: '予約が確定した人に付きます' },
      { kind: 'リマインダ', name: '予約前日 18:00', note: '起点は予約日時。前日に知らせます' },
      { kind: 'リマインダ', name: '当日 9:00', note: '起点は予約日時。当日の朝に知らせます' },
      {
        kind: 'テンプレート',
        name: '前日のお知らせ ほか1本',
        note: '本文は見本です。会社名などは共通情報から入ります',
      },
    ],
    itemsRest: null,
    requirements: [
      FRIEND_ATTRIBUTES,
      { label: 'リマインダ', feature: 'reminders' },
      { label: 'テンプレート', feature: 'templates' },
    ],
  },
  {
    id: 'webinar-guide',
    name: 'ウェビナーの案内と当日',
    purpose: '申し込みから当日の入室まで、順に案内します。',
    creates: 'タグ2つ、ウェビナー1件、リマインダ3本、テンプレート4本',
    itemCount: 10,
    // 内訳がどの正本にも無い。設計 34-3 が描いているのは 7日間フォローだけで、
    // 要件 §7-2 の 3 本目は別のレシピ（問い合わせ自動応答）。**埋めずに空けておく。**
    items: null,
    itemsRest: null,
    requirements: [
      FRIEND_ATTRIBUTES,
      { label: 'ウェビナー', feature: 'webinars' },
      { label: 'リマインダ', feature: 'reminders' },
      { label: 'テンプレート', feature: 'templates' },
    ],
  },
]

/** 機能が入っているか。**鍵の無い機能は、いつでも入っている。** */
export function requirementIsOn(
  requirement: RecipeRequirement,
  features: Record<string, boolean>,
): boolean {
  if (requirement.feature === null) return true
  return features[requirement.feature] === true
}

/** オフの機能の名前。空なら全部入っている。 */
export function missingFeatures(
  recipe: Recipe,
  features: Record<string, boolean>,
): string[] {
  return recipe.requirements.filter((r) => !requirementIsOn(r, features)).map((r) => r.label)
}

export type RecipeActionState = 'ready' | 'needs-feature' | 'no-api'

export interface RecipeAction {
  state: RecipeActionState
  label: string
  /** 押せないときの理由。押せるときは null。 */
  reason: string | null
  href: string | null
}

/**
 * 「このレシピで作る」の出し方。
 *
 * **押せない理由を 2 つに分ける。**
 * 機能がオフなのは運用者が直せる。口が無いのは直せない。
 * 同じ灰色のボタンにすると、直せるものまで諦めさせてしまう。
 */
export function recipeAction(
  recipe: Recipe,
  features: Record<string, boolean>,
  cloneApiReady: boolean,
): RecipeAction {
  const missing = missingFeatures(recipe, features)
  if (missing.length > 0) {
    return {
      state: 'needs-feature',
      label: '機能をオンにしてから',
      reason: `「機能設定」で${missing.join('と')}をオンにすると使えます`,
      href: null,
    }
  }
  if (!cloneApiReady) {
    return {
      state: 'no-api',
      label: 'まだ作れません',
      reason: 'レシピから作る仕組みがまだ入っていません。中身は先に見られます。',
      href: null,
    }
  }
  return {
    state: 'ready',
    label: 'このレシピで作る',
    reason: null,
    href: `/recipes/clone?id=${encodeURIComponent(recipe.id)}`,
  }
}

/**
 * これまで何回作られたか。
 *
 * **数える口がまだ無い。**（要件 §10 の `GET /api/recipes` が未実装、台帳 #134）
 * 0 回と書くと「誰も使っていない」という別の意味になるので、
 * 数の代わりに「まだ数えられない」と言う。
 */
export const CLONE_COUNT_UNAVAILABLE = 'これまで何回作られたかは、まだ数えられません'

/** あたまに付ける文字を足した名前。空文字のときは何も足さない。 */
export function prefixedName(prefix: string, name: string): string {
  const head = prefix.trim()
  return head ? `${head} ${name}` : name
}

/**
 * 必要な機能のまとめ。設計 `D5UaX` の「すべてオンなので、このまま作れます。」の行。
 * オフがあるときは、どれをオンにすればよいかまで言う。
 */
export function featureSummary(recipe: Recipe, features: Record<string, boolean>): string {
  const missing = missingFeatures(recipe, features)
  if (missing.length === 0) return 'すべてオンなので、機能の面では作れます。'
  return `${missing.join('と')}がオフです。「機能設定」でオンにすると使えます。`
}

/** 下の帯のボタンの文字。件数が決まっていないときは件数を言わない。 */
export function createButtonLabel(recipe: Recipe): string {
  return recipe.itemCount != null ? `${recipe.itemCount}件を下書きで作る` : '下書きで作る'
}

/**
 * 複製できない理由。**「準備中」ではなく、何が無いかを言う。**
 * `POST /api/recipes/{id}/clone` がまだ無い（台帳 #134）。
 */
export const CLONE_UNAVAILABLE_NOTE =
  'まとめて下書きを作る仕組みが、まだ入っていません。いまは作られるものを見るところまでです。'

/** 内訳が正本に無いときの言い方。**0件と書かない。** */
export const ITEMS_UNDECIDED_NOTE =
  '作られるものの内訳が、まだ決まっていません。決まりしだいここに出ます。'

/** 右カラムの「気をつけること」。設計 `D5UaX` の 3 行。 */
export const CARE_ITEMS = [
  {
    head: '本文は見本です。',
    note: '会社名や差し込みは、共通情報とテンプレートの決まりから入ります。',
  },
  {
    head: '同じレシピを何度も作れます。',
    note: '名前が重なるので、あたまに付ける文字を使うと迷いません。',
  },
  {
    head: '作る先のアカウントを間違えると、別のアカウントに下書きができます。',
    note: '公開前に気づけますが、作る前に確かめてください。',
  },
] as const
