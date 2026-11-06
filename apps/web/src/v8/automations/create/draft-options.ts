import type { Automation } from '@line-crm/shared';
import { AUTOMATION_DRAFT_ACTION_OPTIONS, AUTOMATION_DRAFT_TRIGGER_OPTIONS } from '@line-crm/shared';

/*
 * 「だれに」の条件は、一斉配信・シナリオと同じ共通部品で作る。
 * 以前この画面だけが「軸 + 自由入力」の独自形で、計算側（worker の
 * SegmentCondition）と違う形で保存されていた（AUTOMATION-04）。
 * 入力の形を正本へ揃えるため、`ConditionBuilder` をそのまま使う。
 */

// 下書きの作成・保存は `/automations` の権限キーが門（#942 N-351）。
// owner/admin は常に通り、権限キーを持つスタッフも通す。表示の判定は
// 共通アクションと同じフック1本に寄せる（サーバの認可が正本）。

/**
 * ルールを作る。Pencil ★管理画面 `Rv8Jv`（25-1-A つくる）。
 *
 * **画面名を本文に置かない。** 共通トップバーへ `usePageTitle` で渡す
 * （`docs/管理画面-common-rules.md` §1-1）。以前はトップバー・パンくず・本文の
 * h1 で「ルールを作る」が三重に出ていた。説明文（サブタイトル）も本文には
 * 置かず、右カラムの固有カードへ移した（§1-1、`side-cards.tsx`）。
 *
 * **保存は下部追従バーにしか置かない**（§1-6）。
 */

/**
 * 画面に出すきっかけ（#942 N-355: 共有の正本から全部描画する）。
 *
 * **実際に動くものだけを並べる。** 下書きunion
 * (`apps/worker/src/services/automation-drafts.ts` の
 * `AutomationDraftTriggerType`)と一致し、全部実行門で動く
 * (`apps/worker/src/services/automation-triggers.ts`)。
 * 管理画面は「実装されていない選択肢を表示しない」と決めている
 * （`docs/管理画面-requirements/管理画面-25-automation-requirements-draft.md` §4-2・§11）。
 * 以前は設計の6種だけで、残り4種は下書き編集でしか作れなかった。
 * 共有の正本（`AUTOMATION_DRAFT_TRIGGER_OPTIONS`）が全部持つので、
 * ここはそのまま描き、説明文だけこの画面で足す。
 */
export const EVENT_NOTES: Record<string, string> = {
  friend_add: '友だち追加のとき。ブロック解除では動きません。',
  message_received: '友だちからのトークが届いたとき。含まれる言葉で絞れます。',
  tag_change: '選んだタグが付いたとき・外れたときに動きます。下でどちらかを選びます。',
  form_submitted: '回答が保存されたとき。フォームを指定できます。',
  link_clicked: '計測リンクが押されたとき。リンクを指定できます。',
  calendar_booked: '予約が確定したとき。種類やメニューで絞れます。',
  datetime: '一度だけ。5分刻みで動き、対象の友だちを選びます。',
  daily: '毎日決まった時刻に、対象の友だちへ動きます。',
  weekly: '毎週決まった曜日・時刻に、対象の友だちへ動きます。',
  'ec.order.confirmed': 'EC連携で注文確定が記録された人に動きます。',
}

export const EVENTS: ReadonlyArray<{ value: Automation['eventType']; label: string; note: string }> =
  AUTOMATION_DRAFT_TRIGGER_OPTIONS.map((option) => ({
    value: option.value as Automation['eventType'],
    label: option.label,
    note: EVENT_NOTES[option.value] ?? '',
  }))

/**
 * #975 U061: きっかけを「人の動き」と「決めた時刻」に分け、
 * よく使う3件だけを最初に出す。残りは検索または「すべてを見る」で届く。
 */
/* 並びは共有の正本 `AUTOMATION_DRAFT_TRIGGER_OPTIONS` と同じ順を保つ。 */
export const TRIGGER_EVENT_GROUPS: ReadonlyArray<{ id: string; label: string; values: readonly string[] }> = [
  { id: 'people', label: '友だちやお客さんの動き', values: ['friend_add', 'message_received', 'tag_change', 'form_submitted', 'link_clicked', 'calendar_booked', ...AUTOMATION_DRAFT_TRIGGER_OPTIONS.filter(option => option.value.startsWith('restaurant.')).map(option => option.value)] },
  { id: 'schedule', label: '決めた時刻・曜日', values: ['datetime', 'daily', 'weekly'] },
  { id: 'ec', label: 'ECの出来事', values: ['ec.order.confirmed'] },
]

export const REPRESENTATIVE_TRIGGER_EVENTS: readonly string[] = ['friend_add', 'message_received', 'tag_change']

/** 言葉で絞れるきっかけ。ほかは本文を持たないので条件欄を出さない。 */
export const KEYWORD_EVENTS: ReadonlyArray<string> = ['message_received']

/**
 * 画面に出す「すること」(#734: 共有の正本から描画する)。
 *
 * 下書きunionの3処理と一致させる。`remove_tag` `send_webhook`
 * `switch_rich_menu` など実行側の残りは、下書きの口が受け付けない
 * (`action_unsupported`)ので出さない。
 */
export const ACTIONS: ReadonlyArray<{ value: string; label: string }> = [...AUTOMATION_DRAFT_ACTION_OPTIONS]

/*
 * この画面で中身を作れる「すること」。担当へ知らせる（notify_staff）は知らせのルールを
 * 選ぶ口がこの画面に無く、選ぶと文面の送信として保存されてしまう（管理画面 の器でも同じ）。
 * 作れるものだけを並べる。
 */
export const EDITABLE_ACTIONS = ACTIONS.filter((action) => action.value !== 'notify_staff')

/* 代表3件のカードの短い説明。ほかは EVENT_NOTES をそのまま出す。 */
export const TRIGGER_SHORT_NOTES: Record<string, string> = {
  friend_add: '友だち追加で動きます',
  message_received: '届いたトークの言葉で絞れます',
  tag_change: '選んだタグの付け外しで動きます',
}
