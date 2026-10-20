'use client'

import type { AccountStyle } from '@line-crm/shared'

/*
 * はじめの質問と初期セットの決まりを画面から切り離した表。
 * 絵：修正案 DIHFx の列 VHp7p（xxpM9・RZW83・lS1Gh・rJ36f・oKSsG・Bdfxm）。
 * 口：組4（`lib/api/helpers/styles.ts` の styleApi）。質問のキーは口の `questionKeys`
 * （image/booking/approval/payment/reminders/stamps/coupons/tickets/outcome/content）だけ。口に無い質問は置かない（未定は入れない）。
 *
 * - どの質問にも「あとで設定する」「手動で設定する」がある（ 追記）。あとで＝何も入れない・
 *   はじめにやることに残る。手動＝その設定の画面へ案内する。
 * - おすすめの答えは業種ごとに先に選んでおく（飛ばしても困らない）。
 * - どの質問にも「あとから変えられます（どこで）」を出す。
 */

export type IconKey =
  | 'utensils' | 'scissors' | 'messages' | 'graduation' | 'bag' | 'grid'
  | 'sparkles' | 'image' | 'folder' | 'download' | 'hourglass' | 'settings'
  | 'circleCheck' | 'userCheck' | 'store' | 'card' | 'split' | 'calendarCheck' | 'clock' | 'bell' | 'bellOff'
  | 'stamp' | 'ticket' | 'ban' | 'users' | 'user' | 'file'

/** 1問の選択肢。value は画面の値（'true'/'false' は口へ真偽で送る）。 */
export type Choice = {
  value: string; icon: IconKey; label: string; note: string
  /** 口へ送る値が画面の値と違うとき（承認の「manual」は「手動で設定する」と同じ値になるので画面では分ける）。 */
  apiValue?: string
}

export type Question = {
  /** 口の質問キー。 */
  key: string
  /** 左の一覧と進みの右に出す短い名前。 */
  short: string
  title: string
  description: string
  choices: Choice[]
  /** スタイルごとのおすすめ（無ければ最初の選択肢）。 */
  recommended?: Partial<Record<AccountStyle, string>>
  /** 「あとから変えられます（ここ）。」のの中。 */
  where: string
  /** 手動で設定するときに開く画面と、そのカードの説明。 */
  manualHref: string
  manualNote: string
  /** 選んだ答えに付ける帯（お支払いの Stripe の案内など）。 */
  info?: string
  /** あとで設定したとき、はじめにやること・最後の一覧に出す文。 */
  todo: { title: string; note: string; action: string }
  /** 最後の一覧「入れなかった物」の説明。無ければ todo.note。 */
  skipped?: string
  /** 最後の一覧「入れなかった物」の題。無ければ short。 */
  skippedTitle?: string
  /** 設定の画面がまだ無いときの機能の名前。押すと準備中の窓。 */
  preparing?: string
  /**
   * 口（組4）がまだこの質問のキーを受け付けない。答えは画面の中だけで持ち、保存しない（札「準備中」）。
   * 口が受け付けたら、ここを外して API_QUESTION_KEYS に足すだけでつながる。
   */
  pendingApi?: boolean
}
