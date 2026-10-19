import { RectangleVertical, RectangleHorizontal } from 'lucide-react'
import { RICH_MENU_DIMENSIONS } from '@line-crm/shared'
/*
 * ★V8 リッチメニューを作る（作る①〜④のウィザード）。
 *
 * Pencil の正本：
 *   ① 形と画像  / ② ボタンの動き  / ③ 誰に出すか  / ④ 公開
 *
 * 立て付け：
 * - 「次へ：ボタンの動き」で下書き（rich_menu_groups）を作る。手順②以降は
 *   保存済みページに対して画像アップロード・公開前確認がそのまま使える。
 * - 形（大きさ・面の分けかた・タブ数）は作成 API だけが受け付ける。
 *   下書きができたあと手順①へ戻ると、それらは読み取り専用になる。
 * - 公開・予約・実機確認・照合の運用ロジックは編集画面（edit/）と同じ
 *   部品・関数を使い回し、別実装にしない。
 */

/* ---------- 手順 ---------- */

export const STEP_KEYS = ['shape', 'buttons', 'audience', 'publish'] as const

export type StepKey = (typeof STEP_KEYS)[number]

export const STEP_LABEL: Record<StepKey, string> = {
  shape: '形と画像',
  buttons: 'ボタンの動き',
  audience: '誰に出すか',
  publish: '公開',
}

export const NEXT_LABEL: Record<Exclude<StepKey, 'publish'>, string> = {
  shape: '次へ：ボタンの動き',
  buttons: '次へ：誰に出すか',
  audience: '次へ：公開',
}

/** 統括のひな形（host）の手順の名前。複数のアカウントへ配る画面なので③④が店と違う。 */
export const HQ_STEP_LABEL: Record<StepKey, string> = {
  shape: '形と画像',
  buttons: 'ボタンの動き',
  audience: '配る先',
  publish: '確かめて配る',
}

export const HQ_NEXT_LABEL: Record<Exclude<StepKey, 'publish'>, string> = {
  shape: '次へ：ボタンの動き',
  buttons: '次へ：配る先',
  audience: '次へ：確かめて配る',
}

/* ---------- 面の見本（作る①「面の分け方」。Pencil では大きい側が7つ） ---------- */

export const V8_LAYOUT_KEYS: Record<'large' | 'compact', string[]> = {
  large: [
    'large-full',
    'large-1x2-v',
    'large-1x2-h',
    'large-1plus2',
    'large-2x2',
    'large-2plus1',
    'large-2x3',
  ],
  compact: ['compact-full', 'compact-2x1', 'compact-3x1', 'compact-4x1'],
}

/** Pencil の札に合わせた短い名前。 */
export const V8_LAYOUT_LABEL: Record<string, string> = {
  'large-full': '1面',
  'large-1x2-v': '上下2面',
  'large-1x2-h': '左右2面',
  'large-1plus2': '上1・下2',
  'large-2x2': '4面',
  'large-2plus1': '上2・下1',
  'large-2x3': '6面',
  'compact-full': '1面',
  'compact-2x1': '左右2面',
  'compact-3x1': '横3面',
  'compact-4x1': '横4面',
}

export const SIZE_OPTIONS: Array<{
  value: 'large' | 'compact'
  label: string
  dims: string
  hint: string
  /* 板 ：絵の印は形の印（大＝縦長・小＝横長）。札の印にしない。 */
  icon: typeof RectangleVertical
}> = [
  {
    value: 'large',
    label: '大きい',
    dims: `${RICH_MENU_DIMENSIONS.large.width}×${RICH_MENU_DIMENSIONS.large.height}`,
    hint: '画面をしっかり使う。ボタン6つまで',
    icon: RectangleVertical,
  },
  {
    value: 'compact',
    label: '小さい',
    dims: `${RICH_MENU_DIMENSIONS.compact.width}×${RICH_MENU_DIMENSIONS.compact.height}`,
    hint: 'トークが隠れにくい。横に並べる',
    icon: RectangleHorizontal,
  },
]

export const TAB_COUNT_OPTIONS = [
  { value: '0', label: 'なし' },
  { value: '1', label: '2つ' },
  { value: '2', label: '3つ' },
]

export const SIZE_LABEL: Record<'large' | 'compact', string> = {
  large: `${RICH_MENU_DIMENSIONS.large.width}×${RICH_MENU_DIMENSIONS.large.height}`,
  compact: `${RICH_MENU_DIMENSIONS.compact.width}×${RICH_MENU_DIMENSIONS.compact.height}`,
}
