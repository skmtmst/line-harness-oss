import { FEATURE_IDS, type FeatureId } from '@line-crm/shared'

/**
 * 「はじめの設定」で選ぶ、使う機能の初期セット（IDEA-31）。
 *
 * 業種・担当業務に合うまとまりを1つ選ぶと、そのセットだけが左のメニューと
 * 管理画面に出る。**選ぶのは「初期セット」であって個別の機能ではない**ので、
 * 全機能を1つずつ理解しなくても初回設定を進められる。あとから機能設定
 * （/settings）で1つずつ変えられる。
 *
 * プリセットは「どの機能を表示するか」の完全な一覧を持つ。
 * 部分適用にすると「何が残るか」を利用者が計算しなければならず、
 * 初期案内としては失敗する。
 */

/** 順路（段3・段4）と案内そのものに必要な機能。どのセットでも必ず残す。 */
const GUIDANCE_FEATURES = [
  'friend_add_routing',
  'scenarios',
  'templates',
] as const satisfies readonly FeatureId[]

/**
 * 初期セットの定義。
 *
 * - `enables` に挙げた機能だけをオンにし、それ以外の切り替え可能な機能は
 *   オフにする。`enables` に無い機能は「既定でオフ」ではなく「このセットでは
 *   オフ」になる。
 * - メニューの並び順・区分の順・保存済みの名前は一切触らない（適用時に
 *   sidebarItemOrder を送らない）。
 * - `restaurant_test` は検証用機能のためどのセットにも含めない。
 *   環境で有効な場合でも、初期案内の選択肢にはしない。
 */
export interface FeaturePreset {
  id: 'starter' | 'booking' | 'all'
  label: string
  /** どんな業種・担当業務に合うかを1文で。 */
  audience: string
  /** このセットでオンにする機能の完全な一覧。 */
  enables: readonly FeatureId[]
}

const STARTER_FEATURES: readonly FeatureId[] = [
  ...GUIDANCE_FEATURES,
  'broadcasts',
  'auto_replies',
  'media',
  'common_vars',
  'friend_fields',
  'support_marks',
  'saved_searches',
]

export const FEATURE_PRESETS: readonly FeaturePreset[] = [
  {
    id: 'starter',
    label: 'まず必要なものだけ',
    audience: 'はじめて使うときや、担当業務がまだ決まっていないとき。はじめの設定で使う機能と配信の基本だけを表示します。',
    enables: STARTER_FEATURES,
  },
  {
    id: 'booking',
    label: '予約・来店・イベント業務がある',
    audience: '店舗の予約やイベントの受付を使うとき。「まず必要なものだけ」に、予約・イベント・フォーム・リッチメニュー・流入計測・分析を足します。',
    enables: [
      ...STARTER_FEATURES,
      'booking',
      'events',
      'reminders',
      'forms',
      'rich_menus',
      'inflow_tracking',
      'site_tracking',
      'analytics',
    ],
  },
  {
    id: 'all',
    label: '全部の機能を使う',
    audience: 'あとから絞るとき。自動化や外部連携を含む全部の機能を表示します（検証用機能を除く）。',
    enables: FEATURE_IDS.filter((id) => id !== 'restaurant_test'),
  },
]

/** セットを保存用のオン・オフ表にする。カタログの全機能を必ず網羅する。 */
export function presetFeatureMap(preset: FeaturePreset): Record<FeatureId, boolean> {
  const on = new Set<FeatureId>(preset.enables)
  return Object.fromEntries(FEATURE_IDS.map((id) => [id, on.has(id)])) as Record<FeatureId, boolean>
}

/** いまの設定から見て、このセットを適用するとオフになる機能。 */
export function presetTurnsOff(
  preset: FeaturePreset,
  currentFeatures: Record<string, boolean>,
): FeatureId[] {
  const on = new Set<FeatureId>(preset.enables)
  return FEATURE_IDS.filter((id) => currentFeatures[id] === true && !on.has(id))
}

/** いまの設定から見て、このセットを適用するとオンになる機能。 */
export function presetTurnsOn(
  preset: FeaturePreset,
  currentFeatures: Record<string, boolean>,
): FeatureId[] {
  const on = new Set<FeatureId>(preset.enables)
  return FEATURE_IDS.filter((id) => currentFeatures[id] !== true && on.has(id))
}

/** 変更理由。保存と同じ単位で監査へ残る既存の決まりに合わせる。 */
export function presetApplyReason(preset: FeaturePreset): string {
  return `はじめの設定で初期セット「${preset.label}」を適用`
}

/**
 * この画面で初期セットを選べるか。
 *
 * **保存済みの設定（version > 0）があるときは選ばせない。** 既存の設定を
 * 初期セットで置き換えることは「リセット」になるため、変更は必ず
 * 機能設定の画面で行う。権限が無い人には picker ではなく案内だけを出す。
 */
export type FeatureSetEntry =
  | { kind: 'picker' }
  | { kind: 'configured' }
  | { kind: 'forbidden' }

export function featureSetEntry(input: { forbidden: boolean; version: number }): FeatureSetEntry {
  if (input.forbidden) return { kind: 'forbidden' }
  if (input.version > 0) return { kind: 'configured' }
  return { kind: 'picker' }
}

/**
 * 「非表示」と「実行停止」の違いの説明。
 *
 * 機能をオフにしても公開中のページや動いている配信は止まらず、
 * 「隠したのに止まった」「隠したから全部止まった」と誤認しないための文。
 * 機能設定画面の案内文と同じ言い方にそろえる。
 */
export const FEATURE_SET_NOTES: readonly string[] = [
  'オフにした機能は、左のメニューと管理画面から消えます。作ったデータは消えず、あとからオンに戻せます。',
  '公開中のフォームや予約ページ、すでに動いている配信・予約は、オフにするだけでは止まりません。止めるときは、その機能の画面で止めます。',
  '予約済み・実行待ちの処理が残っている機能をオフにするときは、保存の前に影響の確認が出ます。この画面で適用できないときは、機能設定から行ってください。',
  '障害時にすべての送信を止める操作は「運用状態」で行います。ここの選択は緊急停止ではありません。',
]

export const FEATURE_SET_LABELS = {
  heading: '使う機能の初期セット',
  intro:
    '業種・担当業務に合うセットを1つ選ぶと、そのセットの機能だけが左のメニューに出ます。適用してもメニューの並び順や名前は変わりません。あとから機能設定で1つずつ変えられます。',
  apply: 'このセットで始める',
  applying: '適用中…',
  noAccount: '先に上部でLINEアカウントを選んでください。',
  forbidden:
    '機能の初期セットは、オーナーか管理者が選びます。あとから機能設定で変えられます。',
  configured:
    'このアカウントでは機能の設定がすでに保存されています。ここで初期セットを適用すると上書きになるため、この画面からは適用しません。変えるときは機能設定から行えます。',
  openSettings: '機能設定を開く',
  loadError: '機能の設定を読み込めませんでした。',
  retry: '読み直す',
  applied: (label: string) =>
    `初期セット「${label}」を適用しました。左のメニューが選んだ機能だけになりました。あとから機能設定で変えられます。`,
  impactBlocked:
    '動いている配信・予約・実行待ちの処理があるため、この画面では適用できません。機能設定で影響の一覧を確認してから変更してください。',
  conflict:
    'ほかの管理者が先に設定を変更しました。最新の状態を読み直したので、内容を確認してもう一度選んでください。',
  saveError: '初期セットを適用できませんでした。通信状態を確認して、もう一度お試しください。',
} as const
