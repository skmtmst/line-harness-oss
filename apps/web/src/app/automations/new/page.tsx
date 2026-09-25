'use client'

import SelectField from '@/components/shared/select-field'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import type { Automation } from '@line-crm/shared'
import { AUTOMATION_DRAFT_ACTION_OPTIONS, AUTOMATION_DRAFT_TRIGGER_OPTIONS } from '@line-crm/shared'
import { api, ApiError, type AutomationDraftAction, type AutomationDraftDetail } from '@/lib/api'
import Breadcrumb from '@/components/shared/breadcrumb'
import StickyBar from '@/components/shared/sticky-bar'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { TextArea, TextField } from '@/components/shared/text-field'
import DateTimeField, { TimeField } from '@/components/shared/date-time-field'
import { RequiredBadge } from '@/components/shared/form-controls'
import { CareCard, FeatureLinkCard } from '@/components/shared/side-cards'
import { usePageTitle } from '@/components/shell/page-chrome'
import { useAccount } from '@/contexts/account-context'
/*
 * 「だれに」の条件は、一斉配信・シナリオと同じ共通部品で作る。
 * 以前この画面だけが「軸 + 自由入力」の独自形で、計算側（worker の
 * SegmentCondition）と違う形で保存されていた（AUTOMATION-04）。
 * 入力の形を正本へ揃えるため、`ConditionBuilder` をそのまま使う。
 */
import ConditionBuilder, {
  isEmptyCondition,
  isRuleComplete,
  pruneCondition,
  type SegmentCondition,
  type SegmentRule,
} from '@/components/shared/condition-builder'
// 下書きの作成・保存は `/automations` の権限キーが門（#942 N-351）。
// owner/admin は常に通り、権限キーを持つスタッフも通す。表示の判定は
// 共通アクションと同じフック1本に寄せる（サーバの認可が正本）。
import { useCanManageCommonActions } from '@/components/automations/use-common-action-permission'
import styles from './new-automation.module.css'
import Button from '@/components/shared/button'

/**
 * ルールを作る。Pencil ★V6 `Rv8Jv`（25-1-A つくる）。
 *
 * **画面名を本文に置かない。** 共通トップバーへ `usePageTitle` で渡す
 * （`docs/v6-common-rules.md` §1-1）。以前はトップバー・パンくず・本文の
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
 * V6は「実装されていない選択肢を表示しない」と決めている
 * （`docs/v6-requirements/v6-25-automation-requirements-draft.md` §4-2・§11）。
 * 以前は設計の6種だけで、残り4種は下書き編集でしか作れなかった。
 * 共有の正本（`AUTOMATION_DRAFT_TRIGGER_OPTIONS`）が全部持つので、
 * ここはそのまま描き、説明文だけこの画面で足す。
 */
const EVENT_NOTES: Record<string, string> = {
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

const EVENTS: ReadonlyArray<{ value: Automation['eventType']; label: string; note: string }> =
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
const TRIGGER_EVENT_GROUPS: ReadonlyArray<{ id: string; label: string; values: readonly string[] }> = [
  { id: 'people', label: '友だちやお客さんの動き', values: ['friend_add', 'message_received', 'tag_change', 'form_submitted', 'link_clicked', 'calendar_booked'] },
  { id: 'schedule', label: '決めた時刻・曜日', values: ['datetime', 'daily', 'weekly'] },
  { id: 'ec', label: 'ECの出来事', values: ['ec.order.confirmed'] },
]
const REPRESENTATIVE_TRIGGER_EVENTS: readonly string[] = ['friend_add', 'message_received', 'tag_change']

/** 言葉で絞れるきっかけ。ほかは本文を持たないので条件欄を出さない。 */
const KEYWORD_EVENTS: ReadonlyArray<string> = ['message_received']

/**
 * 「だれに」の条件の1行を、状況メモへ書く（AUTOMATION-02）。
 *
 * **保存に送るのと同じ条件**から作るので、「条件なし」と出しながら実は
 * 絞り込んでいた、というずれは起きない。言い方は条件部品
 * （condition-builder.tsx）の選択肢に揃える。
 */
function describeConditionRule(
  rule: SegmentRule,
  lookups: {
    tags: ReadonlyArray<{ id: string; name: string }>
    scenarios: ReadonlyArray<{ id: string; name: string }>
  },
): string {
  const v = rule.value as Record<string, unknown>
  const tagName = (id: string) => lookups.tags.find((tag) => tag.id === id)?.name ?? (id || 'タグ')
  const scenarioName = (id: string) =>
    lookups.scenarios.find((item) => item.id === id)?.name ?? (id || 'シナリオ')
  const dateRange = (label: string): string => {
    const from = typeof v?.from === 'string' && v.from ? v.from : ''
    const to = typeof v?.to === 'string' && v.to ? v.to : ''
    if (from && to) return `${label}が${from}〜${to}の人`
    if (from) return `${label}が${from}以降の人`
    if (to) return `${label}が${to}までの人`
    return `${label}で絞る人`
  }
  switch (rule.type) {
    case 'tag_exists':
      return `タグ「${tagName(String(rule.value ?? ''))}」を持っている人`
    case 'tag_not_exists':
      return `タグ「${tagName(String(rule.value ?? ''))}」を持っていない人`
    case 'tag_all':
      return '選んだタグをすべて持っている人'
    case 'tag_not_all':
      return '選んだタグをすべて持っている人を除く'
    case 'is_following':
      return rule.value === false ? 'ブロック中の人' : '友だち中の人'
    case 'is_hidden':
      return rule.value === true ? '非表示の人' : '表示中の人'
    case 'name': {
      const text = typeof v?.text === 'string' ? v.text.trim() : ''
      return text ? `名前に「${text}」を含む人` : '名前で絞る人'
    }
    case 'private_memo': {
      const text = typeof rule.value === 'string' ? rule.value.trim() : ''
      return text ? `個別メモに「${text}」を含む人` : '個別メモで絞る人'
    }
    case 'status_message': {
      const text = typeof rule.value === 'string' ? rule.value.trim() : ''
      return text ? `ステータスメッセージに「${text}」を含む人` : 'ステータスメッセージで絞る人'
    }
    case 'registered_at':
      return dateRange('友だち登録日')
    case 'last_reaction_at':
      return dateRange('最終反応日')
    case 'support_mark': {
      const count = Array.isArray(v?.markIds) ? v.markIds.length : 0
      return v?.exclude === true
        ? `選んだ対応マーク（${count}件）の人を除く`
        : `対応マーク（${count}件）の人`
    }
    case 'friend_field':
      return '友だち情報で絞る人'
    case 'scenario_subscribed': {
      const id = typeof rule.value === 'string' ? rule.value : ''
      return id ? `シナリオ「${scenarioName(id)}」を購読中の人` : 'いずれかのシナリオを購読中の人'
    }
    case 'scenario_state': {
      const id = typeof v?.scenarioId === 'string' ? v.scenarioId : ''
      const states: Record<string, string> = {
        subscribed: 'を購読中',
        not_subscribed: 'を購読していない',
        completed: 'を読み終えた',
        ever: 'を1度でも購読した',
      }
      return `シナリオ「${scenarioName(id)}」${states[String(v?.state ?? 'subscribed')] ?? 'を購読中'}の人`
    }
    case 'form_answered':
      return typeof rule.value === 'string' && rule.value
        ? '選んだフォームに回答した人'
        : 'いずれかのフォームに回答した人'
    case 'reaction_state': {
      const labels: Record<string, string> = {
        reply_or_postback: '返信・応答のある人',
        reply: '返信のある人',
        postback: 'ボタン応答のみの人',
        none: '返信・応答の無い人',
      }
      return labels[String(rule.value)] ?? '反応状態で絞る人'
    }
    case 'score_range': {
      const min = typeof v?.min === 'number' ? v.min : null
      const max = typeof v?.max === 'number' ? v.max : null
      if (min !== null && max !== null) return `行動スコア${min}〜${max}の人`
      if (min !== null) return `行動スコア${min}以上の人`
      if (max !== null) return `行動スコア${max}以下の人`
      return '行動スコアで絞る人'
    }
    default:
      return '条件を付けた人'
  }
}

/** 条件の木に入っている全ルール（要約用に平らにする）。 */
const collectConditionRules = (condition: SegmentCondition | null): SegmentRule[] =>
  !condition
    ? []
    : [...condition.rules, ...(condition.groups ?? []).flatMap(collectConditionRules)]

/**
 * 保存されていた条件を、この画面の編集の形へ戻す。
 *
 * 以前の保存口は「軸 + 自由入力」の独自形で、名前なら文字列のまま
 * 保存されていた（計算側は `{ text, targets }` を期待する）。その古い形は
 * **「読めない条件」として区別する**——黙って条件なしへ戻すと、知らない
 * うちに全員へ届くルールに変わってしまう（AUTOMATION-04）。
 */
const storedConditionToForm = (
  raw: unknown,
): { condition: SegmentCondition | null; unreadable: boolean } => {
  if (raw === null || raw === undefined) return { condition: null, unreadable: false }
  if (typeof raw !== 'object' || Array.isArray(raw)) return { condition: null, unreadable: true }
  if (Object.keys(raw as Record<string, unknown>).length === 0) {
    return { condition: null, unreadable: false }
  }
  const candidate = raw as Partial<SegmentCondition>
  if ((candidate.operator !== 'AND' && candidate.operator !== 'OR') || !Array.isArray(candidate.rules)) {
    return { condition: null, unreadable: true }
  }
  const nodeUsable = (node: SegmentCondition): boolean =>
    node.rules.every(
      (rule) => Boolean(rule) && typeof rule === 'object' && typeof rule.type === 'string' && isRuleComplete(rule),
    ) && (node.groups ?? []).every(nodeUsable)
  if (!nodeUsable(candidate as SegmentCondition)) return { condition: null, unreadable: true }
  return { condition: candidate as SegmentCondition, unreadable: false }
}

/**
 * 画面に出す「すること」(#734: 共有の正本から描画する)。
 *
 * 下書きunionの3処理と一致させる。`remove_tag` `send_webhook`
 * `switch_rich_menu` など実行側の残りは、下書きの口が受け付けない
 * (`action_unsupported`)ので出さない。
 */
const ACTIONS: ReadonlyArray<{ value: string; label: string }> = [...AUTOMATION_DRAFT_ACTION_OPTIONS]

type ActionType = string

interface ActionDraft {
  /** 行を取り違えないための、画面の中だけの番号。 */
  key: number
  type: ActionType
  tagId: string
  message: string
  scenarioId: string
  /** #942 N-356: 共通アクションを呼ぶときの選択。 */
  commonActionId: string
}

let actionKeySeed = 0
const newActionDraft = (): ActionDraft => ({
  key: ++actionKeySeed,
  type: 'add_tag',
  tagId: '',
  message: '',
  scenarioId: '',
  commonActionId: '',
})

/**
 * 「この新規作成の操作」を識別する鍵（DETAIL-13）。
 *
 * 1回の作成操作に1つだけ振り、同じ操作の再試行（ダブルクリック・保存の
 * やり直し・通信の再送）だけが同じ鍵を使う。Worker はこの鍵から下書きの
 * id を決めるので、別の新規作成は必ず別の鍵＝別の下書きになる。
 * 前の下書きへ勝手に戻る道を、画面とサーバーの両方で塞ぐ。
 */
const newOperationKey = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 18)}`

/**
 * 作りかけの下書きの控え（N-357 → DETAIL-13）。
 *
 * 保存した下書きの番号は画面の記憶（`savedDraft`）にしか無かったので、
 * 再読込や「戻る」で消え、保存のたびに新しい下書きが増えていた。
 * ブラウザに控えておき、同じ店のときだけ再利用する。
 *
 * **ただし控えは「再開の案内」にだけ使う。** 以前はこの番号だけを戻して
 * 名前・条件・処理は初期値のままだったため、一覧から新規へ来た利用者が
 * 空の画面へ打った内容で、以前の下書きをまるごと上書きしていた
 * （DETAIL-13）。いまは
 *
 *   - 新規作成（`/automations/new`）…… 必ず新しい下書きを作る
 *   - 再開（`/automations/new?draft=<番号>`）…… 番号と中身・版を
 *     一緒に読み込み、読み終わるまで保存できない
 *
 * の2導線に分ける。保存に成功したらURLへ番号を載せるので、再読込・
 * 「戻る」でも同じ下書きの**中身ごと**戻る。
 */
const DRAFT_STORAGE_KEY = 'lh-automation-new-draft-v1'

interface StoredDraft {
  id: string
  draftVersionId: string
}

type StoredDrafts = Record<string, StoredDraft>

const isStoredDraft = (value: unknown): value is StoredDraft => {
  if (!value || typeof value !== 'object') return false
  const draft = value as Partial<StoredDraft>
  return typeof draft.id === 'string' && typeof draft.draftVersionId === 'string'
}

const readStoredDrafts = (): StoredDrafts => {
  try {
    const raw = sessionStorage.getItem(DRAFT_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}

    // 以前の1店舗分だけの控えも読み、次の保存で店舗別の形へ移す。
    const legacy = parsed as Partial<StoredDraft> & { accountId?: unknown }
    const legacyAccountId = legacy.accountId
    if (typeof legacyAccountId === 'string' && isStoredDraft(legacy)) {
      return { [legacyAccountId]: { id: legacy.id, draftVersionId: legacy.draftVersionId } }
    }

    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, StoredDraft] => isStoredDraft(entry[1])),
    )
  } catch {
    return {}
  }
}

const readStoredDraft = (accountId: string): StoredDraft | null =>
  readStoredDrafts()[accountId] ?? null

const writeStoredDraft = (accountId: string, draft: StoredDraft): void => {
  try {
    sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({
      ...readStoredDrafts(),
      [accountId]: draft,
    }))
  } catch {
    // 控えが書けなくても保存自体は続ける。次は作り直しになるだけ。
  }
}

const clearStoredDraft = (accountId: string): void => {
  try {
    const drafts = readStoredDrafts()
    delete drafts[accountId]
    if (Object.keys(drafts).length === 0) sessionStorage.removeItem(DRAFT_STORAGE_KEY)
    else sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(drafts))
  } catch {
    // 消せなくても害はない。
  }
}

/**
 * 中身をそのまま表す文字列（N-358）。
 *
 * 鍵の並び順を固定するので、**同じ中身なら必ず同じ文字列**になる。
 */
const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value === undefined ? null : value)
}

/**
 * 1人テストで実際に動く部分の指紋（N-358）。
 *
 * **版の番号だけでは「確認したときと同じ中身か」を判定できない。**
 * `apps/worker/src/services/automation-drafts.ts` の `updateAutomationDraft` は
 * `automation_versions` の**同じ行を書き換える**ので、下書きを何度更新しても
 * `draftVersionId` は変わらない。別のタブで書き換えられた後でも、古い確認画面が
 * 持っている版の番号はそのまま通ってしまい、`runAutomationTest` はそのとき
 * DBにある新しい中身を送る。だから中身そのものを指紋にして確認へ結びつける。
 *
 * 名前と説明は送信結果を変えないので入れない。
 */
const draftFingerprint = (
  draft: Pick<AutomationDraftDetail, 'eventType' | 'triggerConfig' | 'conditions' | 'actions'>,
): string => canonicalJson({
  eventType: draft.eventType,
  triggerConfig: draft.triggerConfig,
  conditions: draft.conditions,
  actions: draft.actions,
})

/**
 * 画面に入力されている内容の一式（DETAIL-14）。
 *
 * **入力はアカウントに結び付ける。** 店を切り替えても前の店の文面が
 * 残ったままだと、切り替え先の店の下書きとしてA店の内容を保存できて
 * しまう。切り替え時に前のアカウント分を控え（`formStashRef`）へ退け、
 * 切り替え先の控え（なければ初期値）を読み直す。
 */
interface FormSnapshot {
  name: string
  eventType: string
  keyword: string
  /**
   * 「だれに」の条件。保存・人数・要約の3か所が同じこれを見る
   * （AUTOMATION-02/04）。形は worker の SegmentCondition と同じ。
   */
  condition: SegmentCondition | null
  /** 読んだ下書きの条件が古い形で読めなかったとき true。付け直すまで保存しない。 */
  conditionUnreadable: boolean
  triggerConfig: Record<string, unknown>
  actions: ActionDraft[]
  testFriendId: string
  /** このアカウントに結び付いた下書き。無ければ次の保存は新規作成。 */
  savedDraft: StoredDraft | null
  /* DETAIL-15: 保存の状態は控えごと持ち、切り替えても正しく戻る。 */
  savedAt: number | null
  savedFingerprint: string | null
  saveOutcome: 'idle' | 'saved' | 'failed'
  previewCount: number | null
  /* AUTOMATION-03: 人数の確認は保存とは別の成否。失敗したことだけ控える。 */
  previewFailed: boolean
}

const blankFormSnapshot = (): FormSnapshot => ({
  name: '',
  eventType: EVENTS[0].value,
  keyword: '',
  condition: null,
  conditionUnreadable: false,
  triggerConfig: {},
  actions: [newActionDraft()],
  testFriendId: '',
  savedDraft: null,
  savedAt: null,
  savedFingerprint: null,
  saveOutcome: 'idle',
  previewCount: null,
  previewFailed: false,
})

/** 何か入力されているか。空のまま切り替えただけなら控えを残さない。 */
const formSnapshotHasContent = (snapshot: FormSnapshot): boolean =>
  Boolean(
    snapshot.name.trim()
      || snapshot.keyword.trim()
      || !isEmptyCondition(snapshot.condition)
      || snapshot.conditionUnreadable
      || snapshot.testFriendId.trim()
      || snapshot.eventType !== EVENTS[0].value
      || Object.keys(snapshot.triggerConfig).length > 0
      || snapshot.actions.length > 1
      || snapshot.actions.some(
        (row) => row.type !== 'add_tag' || row.tagId || row.message.trim() || row.scenarioId || row.commonActionId,
      ),
  )

/** 「すること」1行を、保存で送る形へ直す。指紋とも同じ形を使う。 */
const actionDraftToPayload = (row: ActionDraft, index: number): AutomationDraftAction => (
  row.type === 'add_tag'
    ? { id: `step-${index + 1}`, type: 'add_tag' as const, params: { tagId: row.tagId }, onFailure: 'stop' as const }
    : row.type === 'start_scenario'
      ? { id: `step-${index + 1}`, type: 'start_scenario' as const, params: { scenarioId: row.scenarioId }, onFailure: 'stop' as const }
      : row.type === 'common_action'
        ? { id: `step-${index + 1}`, type: 'common_action' as const, params: { commonActionId: row.commonActionId }, onFailure: 'stop' as const }
        : {
            id: `step-${index + 1}`,
            type: 'send_message' as const,
            params: { messageType: 'text', content: row.message.trim() },
            onFailure: 'stop' as const,
          }
)

/**
 * 「だれに」の条件を、保存で送る形へ直す（AUTOMATION-04）。
 *
 * 書きかけの行（タグを選ぶ前など）は落とす。一斉配信・シナリオと同じ
 * `pruneCondition` を使うので、保存される形は計算側の正本と一致する。
 * 条件が実質無ければ `{}`（＝絞り込みなし）を送る。
 */
const conditionPayload = (condition: SegmentCondition | null): Record<string, unknown> =>
  (pruneCondition(condition) ?? {}) as Record<string, unknown>

/** きっかけの詳しい設定を、保存で送る形へ直す。 */
const normalizeTriggerConfigFor = (
  eventType: AutomationDraftDetail['eventType'],
  triggerConfig: Record<string, unknown>,
  keyword: string,
): Record<string, unknown> => {
  if (eventType === 'message_received') return keyword.trim() ? { keyword: keyword.trim() } : {}
  if (eventType === 'tag_change') return {
    tagId: String(triggerConfig.tagId ?? ''),
    action: triggerConfig.action === 'remove' ? 'remove' : 'add',
  }
  if (eventType === 'datetime') {
    const local = String(triggerConfig.at ?? '')
    return { at: local ? new Date(`${local}:00+09:00`).toISOString() : '', friendIds: String(triggerConfig.friendIds ?? '').split(',').map((id) => id.trim()).filter(Boolean) }
  }
  if (eventType === 'daily' || eventType === 'weekly') return {
    time: String(triggerConfig.time ?? ''),
    friendIds: String(triggerConfig.friendIds ?? '').split(',').map((id) => id.trim()).filter(Boolean),
    ...(eventType === 'weekly' ? { weekdays: String(triggerConfig.weekdays ?? '').split(',').map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6) } : {}),
  }
  if (eventType === 'link_clicked') {
    const trackedLinkId = String(triggerConfig.trackedLinkId ?? '').trim()
    return trackedLinkId ? { trackedLinkId } : {}
  }
  if (eventType === 'calendar_booked') {
    const bookingType = String(triggerConfig.bookingType ?? '')
    const menuId = String(triggerConfig.menuId ?? '').trim()
    const eventId = String(triggerConfig.eventId ?? '').trim()
    return {
      ...(bookingType === 'salon' || bookingType === 'event' ? { bookingType } : {}),
      ...(menuId ? { menuId } : {}),
      ...(eventId ? { eventId } : {}),
    }
  }
  return triggerConfig
}

/**
 * 保存ボタンで送る中身そのものの指紋（DETAIL-15）。
 *
 * 「保存したあとに変えたか」は版の番号ではなく、送る中身の一致で見る。
 * 読み込んだ下書き・保存に成功した内容と同じ形で作るので、画面を往復しても
 * 値が同じなら「変更あり」とは出ない。
 */
const draftPayloadFingerprint = (form: {
  name: string
  eventType: string
  keyword: string
  condition: SegmentCondition | null
  triggerConfig: Record<string, unknown>
  actions: ActionDraft[]
}): string => canonicalJson({
  name: form.name.trim(),
  eventType: form.eventType,
  triggerConfig: normalizeTriggerConfigFor(
    form.eventType as AutomationDraftDetail['eventType'], form.triggerConfig, form.keyword,
  ),
  conditions: conditionPayload(form.condition),
  actions: form.actions.map(actionDraftToPayload),
})

/** ISOの日時を、画面の datetime-local（日本時間）の文字へ戻す。 */
const isoToDatetimeLocal = (iso: string): string => {
  const time = Date.parse(iso)
  if (!Number.isFinite(time)) return ''
  // 保存時は `${local}:00+09:00` として送っているので、戻すときも日本時間基準。
  return new Date(time + 9 * 60 * 60 * 1000).toISOString().slice(0, 16)
}

/**
 * 保存済みの下書きを、この画面の入力の形へ戻す（DETAIL-13の再開）。
 *
 * 番号だけを戻すのは**しない**。以前はそれで空の画面から上書きしていた。
 * 再開では名前・きっかけ・条件・することまで全部戻し、保存は読み終わってから。
 */
const draftDetailToForm = (detail: AutomationDraftDetail): {
  name: string
  eventType: string
  keyword: string
  condition: SegmentCondition | null
  conditionUnreadable: boolean
  triggerConfig: Record<string, unknown>
  actions: ActionDraft[]
} => {
  const storedCondition = storedConditionToForm(detail.conditions)
  const config = detail.triggerConfig ?? {}
  const joinIds = (value: unknown) =>
    Array.isArray(value) ? value.map((item) => String(item)).join(',') : ''
  const triggerConfig = ((): Record<string, unknown> => {
    switch (detail.eventType) {
      case 'tag_change':
        return {
          tagId: String(config.tagId ?? ''),
          action: config.action === 'remove' ? 'remove' : 'add',
        }
      case 'form_submitted':
        return { formId: String(config.formId ?? '') }
      case 'link_clicked':
        return { trackedLinkId: String(config.trackedLinkId ?? '') }
      case 'calendar_booked':
        return {
          bookingType: String(config.bookingType ?? ''),
          menuId: String(config.menuId ?? ''),
          eventId: String(config.eventId ?? ''),
        }
      case 'datetime':
        return { at: isoToDatetimeLocal(String(config.at ?? '')), friendIds: joinIds(config.friendIds) }
      case 'daily':
        return { time: String(config.time ?? ''), friendIds: joinIds(config.friendIds) }
      case 'weekly':
        return {
          time: String(config.time ?? ''),
          friendIds: joinIds(config.friendIds),
          weekdays: Array.isArray(config.weekdays) ? config.weekdays.map((day) => String(day)).join(',') : '',
        }
      default:
        return {}
    }
  })()
  const actions: ActionDraft[] = detail.actions.length === 0
    ? [newActionDraft()]
    : detail.actions.map((step) => ({
        key: ++actionKeySeed,
        type: step.type,
        tagId: String(step.params.tagId ?? ''),
        message: String(step.params.content ?? ''),
        scenarioId: String(step.params.scenarioId ?? ''),
        commonActionId: String(step.params.commonActionId ?? ''),
      }))
  return {
    name: detail.name,
    eventType: detail.eventType,
    keyword: detail.eventType === 'message_received' ? String(config.keyword ?? '') : '',
    condition: storedCondition.condition,
    conditionUnreadable: storedCondition.unreadable,
    triggerConfig,
    actions,
  }
}

/** 保存した時刻の表示（DETAIL-15）。分まであれば「いつ保存したか」は読める。 */
const formatClock = (time: number): string =>
  new Date(time).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })

/**
 * 「この内容で送る」と押したときに送る中身を、押す前に固めた控え（N-358）。
 *
 * 画面の状態ではなく**この控えだけ**を送信に使う。送る直前にサーバーの
 * いまの中身と突き合わせ、1文字でも違えば送らずに 409 として扱う。
 */
interface TestConfirmation {
  accountId: string
  draftId: string
  draftVersionId: string
  fingerprint: string
  /** 画面の入力とのずれを出すためだけの、すること部分の指紋。 */
  actionsFingerprint: string
  friendId: string
  contents: string[]
  effects: string[]
}

/**
 * タグ・シナリオの選択行(#734: 借金を増やさないため1つにまとめた)。
 *
 * 2つの行は見出し・選択肢・文言だけが違い、骨組みは同じ。複写すると
 * 借金計数(`unresolved-classname`)が増えて試験が赤くなるため、部品化する。
 */
function ResourcePickRow(props: {
  title: string
  id: string
  selectLabel: string
  value: string
  onPick: (value: string) => void
  options: Array<{ value: string; label: string }>
  tagsLoading: boolean
  tagsFailed: boolean
  failedNote: string
}) {
  const { title, id, selectLabel, value, onPick, options, tagsLoading, tagsFailed, failedNote } = props
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {title}<RequiredBadge />
      </label>
      <div className={styles.field}>
        <SelectField
          id={id}
          value={value}
          disabled={tagsLoading || tagsFailed}
          onChange={(event) => onPick(event.target.value)}
          aria-label={selectLabel}
          className={styles.select}
          options={[
            { value: '', label: '— 選んでください —' },
            ...options.map((option) => ({ value: option.value, label: option.label })),
          ]}
        />
        {tagsLoading ? <p className={styles.note}>読み込んでいます</p> : null}
        {tagsFailed ? (
          <p className={styles.note}>
            {failedNote}
          </p>
        ) : null}
      </div>
    </div>
  )
}

export default function NewAutomationPage() {
  usePageTitle('ルールを作る')
  const router = useRouter()
  const { selectedAccountId } = useAccount()
  const canManage = useCanManageCommonActions()
  const [name, setName] = useState('')
  const [eventType, setEventType] = useState<string>(EVENTS[0].value)
  /* #975 U061: 10件を一度に並べない。代表＋絞り込み＋「すべてを見る」。 */
  const [eventQuery, setEventQuery] = useState('')
  const [showAllEvents, setShowAllEvents] = useState(false)
  const [keyword, setKeyword] = useState('')
  /*
   * 「だれに」の条件。形は worker の SegmentCondition と同じ——
   * 独自形で保存すると計算側とずれるので、共通部品の値をそのまま持つ。
   */
  const [condition, setCondition] = useState<SegmentCondition | null>(null)
  /* 読んだ下書きの条件が古い形で読めなかった。付け直すまで保存しない。 */
  const [conditionUnreadable, setConditionUnreadable] = useState(false)
  const [triggerConfig, setTriggerConfig] = useState<Record<string, unknown>>({})
  const [savedDraft, setSavedDraft] = useState<StoredDraft | null>(null)
  const [previewCount, setPreviewCount] = useState<number | null>(null)
  /* AUTOMATION-03: 人数の確認は保存とは別の成否として持つ。 */
  const [previewFailed, setPreviewFailed] = useState(false)
  const [previewRefreshing, setPreviewRefreshing] = useState(false)
  const [testFriendId, setTestFriendId] = useState('')
  const [actions, setActions] = useState<ActionDraft[]>([newActionDraft()])
  const [tags, setTags] = useState<Array<{ id: string; name: string }>>([])
  const [tagsLoading, setTagsLoading] = useState(true)
  const [tagsFailed, setTagsFailed] = useState(false)
  const [scenarios, setScenarios] = useState<Array<{ id: string; name: string }>>([])
  const [commonActions, setCommonActions] = useState<Array<{ id: string; name: string }>>([])
  const [saving, setSaving] = useState(false)
  /* #975 U073: 作成（下書き保存）と動かし始めることを分け、動かす前に内容を確認する。 */
  const [activateConfirmOpen, setActivateConfirmOpen] = useState(false)
  const [testing, setTesting] = useState(false)
  const [preparingTest, setPreparingTest] = useState(false)
  const [testConfirmation, setTestConfirmation] = useState<TestConfirmation | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [existingAutomations, setExistingAutomations] = useState<Automation[]>([])
  /*
   * DETAIL-13: 「再開」は `?draft=<番号>` で明示した下書きだけ。
   * `undefined` はURLをまだ読んでいない（読み終わるまで画面を出さない）。
   */
  const [resumeTarget, setResumeTarget] = useState<string | null | undefined>(undefined)
  const [resumeStatus, setResumeStatus] = useState<'none' | 'loading' | 'ready' | 'failed'>('none')
  /* このアカウントに前に保存した下書きがある、という案内にだけ使う控え。 */
  const [storedDraftHint, setStoredDraftHint] = useState<StoredDraft | null>(null)
  /* DETAIL-15: 未保存・保存中・保存済み・保存後の変更・失敗を1つの状態から出す。 */
  const [saveOutcome, setSaveOutcome] = useState<'idle' | 'saved' | 'failed'>('idle')
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [savedFingerprint, setSavedFingerprint] = useState<string | null>(null)
  // 画面の描き直しを待たずに二重押しを止める鍵（N-357・N-358）。
  const saveRunningRef = useRef(false)
  const testRunningRef = useRef(false)
  const prepareRunningRef = useRef(false)
  const selectedAccountRef = useRef(selectedAccountId)
  selectedAccountRef.current = selectedAccountId
  /*
   * DETAIL-14: アカウントごとの入力の控えと、そのアカウントに結び付いた
   * 下書き。切り替えのたびに預け・戻し、保存はこの控えにある下書きだけを
   * 更新する（＝いま選んでいるアカウントのものだけ）。
   */
  const formStashRef = useRef<Record<string, FormSnapshot>>({})
  const draftByAccountRef = useRef<Record<string, StoredDraft>>({})
  /*
   * DETAIL-13: まだ下書きが結び付いていない作成操作の冪等鍵（アカウントごと）。
   * 作り直しのたびに振り直すと再試行が別の下書きを増やしてしまうので、
   * 鍵は下書きが結び付くまで持ち回る。結び付いたら捨てる——その次に
   * 作り直しが走るのは別の新規作成だから。
   */
  const createOpKeyRef = useRef<Record<string, string>>({})
  const previousAccountRef = useRef(selectedAccountId)
  /* 切り替えの直後はURLがまだ前のアカウントの下書きを指している。 */
  const accountSwitchPendingRef = useRef(false)
  /* 再開の読み込みを二度走らせないための、読んだ組み合わせの記録。 */
  const resumedKeyRef = useRef<string | null>(null)
  /* 再開・復元で eventType を戻すとき、入力のリセットを1回だけ止める。 */
  const suppressTriggerResetRef = useRef(false)

  /** いま画面に出ている入力一式を、そのアカウントの控えとして取り出す。 */
  const captureFormSnapshot = (): FormSnapshot => ({
    name,
    eventType,
    keyword,
    condition,
    conditionUnreadable,
    triggerConfig,
    actions,
    testFriendId,
    savedDraft,
    savedAt,
    savedFingerprint,
    saveOutcome,
    previewCount,
    previewFailed,
  })

  /** 控えを画面へ戻す。eventType の切替で詳細設定が消えないよう印を付ける。 */
  const applyFormSnapshot = (snapshot: FormSnapshot) => {
    if (snapshot.eventType !== eventType) suppressTriggerResetRef.current = true
    setName(snapshot.name)
    setEventType(snapshot.eventType)
    setKeyword(snapshot.keyword)
    setCondition(snapshot.condition)
    setConditionUnreadable(snapshot.conditionUnreadable)
    setTriggerConfig(snapshot.triggerConfig)
    setActions(snapshot.actions)
    setTestFriendId(snapshot.testFriendId)
    setSavedDraft(snapshot.savedDraft)
    setSavedAt(snapshot.savedAt)
    setSavedFingerprint(snapshot.savedFingerprint)
    setSaveOutcome(snapshot.saveOutcome)
    setPreviewCount(snapshot.previewCount)
    setPreviewFailed(snapshot.previewFailed)
  }

  /*
   * 「このアカウントに結び付いた下書き」を記録する。保存が走っている途中で
   * 店が切り替わっても、記録は始めたときの店のものへ入るので、表示中の
   * 画面を別の店の下書きに結び付けることはない（DETAIL-14）。
   */
  const bindAccountDraft = (accountId: string, draft: StoredDraft | null) => {
    if (draft) draftByAccountRef.current[accountId] = draft
    else delete draftByAccountRef.current[accountId]
    /*
     * 下書きの結び付きが確定したら作成操作の鍵は役目を終える。
     * 次に作り直しが走るのは別の新規作成なので、新しい鍵を振る。
     */
    delete createOpKeyRef.current[accountId]
    const stashed = formStashRef.current[accountId]
    if (stashed) stashed.savedDraft = draft
    if (selectedAccountRef.current === accountId) setSavedDraft(draft)
  }

  /*
   * URLの `?draft=` を、この画面が覚えている再開先と揃える。
   * 再読込・「戻る」で同じ下書きへ戻るための唯一の入口（DETAIL-13）。
   * URLの書き換えだけを担当し、再開要求そのものは `setResumeRequest` が持つ。
   */
  const syncResumeUrl = (draftId: string | null, mode: 'push' | 'replace' = 'replace') => {
    const url = draftId ? `/automations/new?draft=${encodeURIComponent(draftId)}` : '/automations/new'
    if (mode === 'push') history.pushState(null, '', url)
    else history.replaceState(null, '', url)
  }

  useEffect(() => {
    let cancelled = false
    setTagsLoading(true)
    setTagsFailed(false)
    if (!selectedAccountId) {
      setTags([])
      setScenarios([])
      setTagsLoading(false)
      return
    }
    api.automations
      .draftResources(selectedAccountId)
      .then((res) => {
        if (cancelled) return
        if (res.success) {
          setTags(res.data.tags)
          setScenarios(res.data.scenarios)
          setCommonActions(res.data.commonActions ?? [])
        } else setTagsFailed(true)
      })
      .catch(() => {
        if (!cancelled) setTagsFailed(true)
      })
      .finally(() => {
        if (!cancelled) setTagsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedAccountId])

  // 「同じきっかけ」の注意はこの店の分だけ見れば足りる（#519 軽）。
  // 未選択のときは全件に戻さず空にして、他店の名前で脅かさない。
  useEffect(() => {
    let cancelled = false
    if (!selectedAccountId) {
      setExistingAutomations([])
      return () => {
        cancelled = true
      }
    }
    api.automations.list({ accountId: selectedAccountId })
      .then((response) => {
        if (!cancelled && response.success) setExistingAutomations(response.data)
      })
      .catch(() => {
        if (!cancelled) setExistingAutomations([])
      })
    return () => {
      cancelled = true
    }
  }, [selectedAccountId])

  /*
   * DETAIL-13: `?draft=` の読み取りは画面が開いてから1回。
   * 戻る・進むでURLが変わったときも読み直す（popstate）。
   * 控え（sessionStorage）は「前に保存した下書きがあります」と案内する
   * ためだけに読み、番号を黙って画面へ結び付けることはしない。
   */
  useEffect(() => {
    const readLocation = () =>
      setResumeTarget(new URLSearchParams(window.location.search).get('draft'))
    readLocation()
    setStoredDraftHint(
      selectedAccountRef.current ? readStoredDraft(selectedAccountRef.current) : null,
    )
    window.addEventListener('popstate', readLocation)
    return () => window.removeEventListener('popstate', readLocation)
  }, [])

  /*
   * DETAIL-14: アカウントを切り替えたら、入力ごと切り替える。
   *
   * 前のアカウントの入力はそのアカウントの控えとして残し（戻れば復元）、
   * 切り替え先は控えか初期値を読み直す。前の店の文面が残ったまま
   * 別の店の下書きとして保存されることはない。
   * 走っている途中の保存・1人テストは、返ってきても自分の店でなければ
   * 何も書かない（`selectedAccountRef` で見張る）。
   */
  useEffect(() => {
    const previous = previousAccountRef.current
    previousAccountRef.current = selectedAccountId
    if (previous === selectedAccountId) return

    if (previous === null) {
      // 初めて店が決まっただけ。URLの `?draft=` はこの店のものとして読む。
      setStoredDraftHint(selectedAccountId ? readStoredDraft(selectedAccountId) : null)
      return
    }

    accountSwitchPendingRef.current = true
    setError('')
    setTestConfirmation(null)

    const snapshot = captureFormSnapshot()
    if (formSnapshotHasContent(snapshot) || snapshot.savedDraft) {
      formStashRef.current[previous] = snapshot
    }

    const stashed = selectedAccountId ? formStashRef.current[selectedAccountId] : undefined
    setStoredDraftHint(selectedAccountId ? readStoredDraft(selectedAccountId) : null)
    if (stashed) {
      if (stashed.savedDraft && selectedAccountId) draftByAccountRef.current[selectedAccountId] = stashed.savedDraft
      applyFormSnapshot(stashed)
      // URLの再開先も切り替え先の下書き（または無し）へ置き換える。
      const nextTarget = stashed.savedDraft?.id ?? null
      setResumeTarget(nextTarget)
      syncResumeUrl(nextTarget)
      setNotice('切り替える前にこのアカウントで入力していた内容を戻しました。')
    } else {
      applyFormSnapshot(blankFormSnapshot())
      setResumeTarget(null)
      syncResumeUrl(null)
      if (selectedAccountId) {
        setNotice('LINEアカウントを切り替えました。前のアカウントで入力していた内容は、そのアカウントを選び直すと戻ります。')
      } else {
        setNotice('')
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccountId])

  /*
   * DETAIL-13: `?draft=` で示された下書きは、番号・中身・版を一緒に読む。
   * 読み終わるまで保存はできない（blockedReason で止める）。
   * 読めない下書き（削除済み・別の店のもの）は、理由を出して新規に戻す。
   */
  useEffect(() => {
    if (accountSwitchPendingRef.current) {
      /*
       * 切り替えの直後のURLはまだ前のアカウントの下書きを指している。
       * 切り替え側のeffectが正しい番号（または無し）へ置き換えるので、
       * ここでは何もしない。
       */
      accountSwitchPendingRef.current = false
      return
    }
    if (!selectedAccountId || resumeTarget === undefined) return
    if (resumeTarget === null) {
      setResumeStatus('none')
      return
    }
    const key = `${selectedAccountId}:${resumeTarget}`
    if (resumedKeyRef.current === key) return
    /*
     * そのアカウントの控えがすでにこの下書きを持っているなら読み直さない
     * （A→B→A と往復しても、未保存の入力を消さないため）。
     */
    if (draftByAccountRef.current[selectedAccountId]?.id === resumeTarget) {
      resumedKeyRef.current = key
      setResumeStatus('ready')
      return
    }
    resumedKeyRef.current = key
    const accountId = selectedAccountId
    const draftId = resumeTarget
    let cancelled = false
    setResumeStatus('loading')
    setError('')
    setNotice('')
    api.automations
      .getDraft(draftId, accountId)
      .then((res) => {
        if (cancelled || selectedAccountRef.current !== accountId) return
        if (!res.success) {
          setResumeStatus('failed')
          setError(
            '指定された下書きは読み込めませんでした。削除されたか、ほかのアカウントの下書きの可能性があります。このまま入力すると新しいルールになります。',
          )
          return
        }
        const restored = draftDetailToForm(res.data)
        const draft = { id: res.data.id, draftVersionId: res.data.draftVersionId }
        if (restored.eventType !== eventType) suppressTriggerResetRef.current = true
        setName(restored.name)
        setEventType(restored.eventType)
        setKeyword(restored.keyword)
        setCondition(restored.condition)
        setConditionUnreadable(restored.conditionUnreadable)
        setTriggerConfig(restored.triggerConfig)
        setActions(restored.actions)
        setPreviewFailed(false)
        const fingerprint = draftPayloadFingerprint(restored)
        setSavedFingerprint(fingerprint)
        setSaveOutcome('saved')
        setSavedAt(null)
        bindAccountDraft(accountId, draft)
        writeStoredDraft(accountId, draft)
        setStoredDraftHint(null)
        formStashRef.current[accountId] = {
          ...restored,
          testFriendId: '',
          savedDraft: draft,
          savedAt: null,
          savedFingerprint: fingerprint,
          saveOutcome: 'saved',
          previewCount: null,
          previewFailed: false,
        }
        setResumeStatus('ready')
        setNotice('保存した下書きを読み込みました。続きを直せます。')
        if (restored.conditionUnreadable) {
          /*
           * 古い保存口が残した読めない条件。黙って「条件なし」へ戻すと
           * 全員へ届くルールに変わるので、付け直しを頼むまで保存させない
           * （AUTOMATION-04）。
           */
          setError('保存されていた「だれに」の条件は古い形のため読めませんでした。下の案内にしたがって付け直してください。')
        }
      })
      .catch(() => {
        if (cancelled || selectedAccountRef.current !== accountId) return
        setResumeStatus('failed')
        setError('下書きを読み込めませんでした。通信状態を確かめて、もう一度お試しください。')
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccountId, resumeTarget])

  const selectedEvent = EVENTS.find((event) => event.value === eventType) ?? EVENTS[0]
  const usesKeyword = KEYWORD_EVENTS.includes(eventType)
  /* #975 U061: 検索中は一致したものだけ。それ以外は代表3件、選択中が代表外なら全件を出す。 */
  const normalizedEventQuery = eventQuery.trim().toLowerCase()
  const matchedEvents = normalizedEventQuery
    ? EVENTS.filter((event) => `${event.label} ${event.note}`.toLowerCase().includes(normalizedEventQuery))
    : null
  const expandedEvents = showAllEvents || !REPRESENTATIVE_TRIGGER_EVENTS.includes(eventType)
  const triggerEventGroups = matchedEvents
    ? [{ id: 'search', label: `「${eventQuery.trim()}」に合うきっかけ`, events: matchedEvents }]
    : TRIGGER_EVENT_GROUPS.map((group) => ({
        ...group,
        events: group.values
          .filter((value) => expandedEvents || REPRESENTATIVE_TRIGGER_EVENTS.includes(value))
          .map((value) => EVENTS.find((event) => event.value === value))
          .filter((event): event is (typeof EVENTS)[number] => Boolean(event)),
      }))
  const hasSameTrigger = existingAutomations.some((item) => item.eventType === selectedEvent.value)
  /*
   * AUTOMATION-02: 要約は「保存に送る条件」と同じものから作る。
   * 名前の条件など、言葉以外の条件が要約から落ちて「条件なし」に
   * 見えていたので、pruneCondition（保存と同じ取捨）の結果をそのまま
   * 文章にする。
   */
  const usableCondition = pruneCondition(condition)
  const conditionSummaries = collectConditionRules(usableCondition).map(
    (rule) => describeConditionRule(rule, { tags, scenarios }),
  )
  const triggerAudience = usesKeyword && keyword.trim()
    ? `「${keyword.trim()}」を含む内容を送った人`
    : 'きっかけに当てはまった人'
  const targetSummary = conditionUnreadable
    ? `${triggerAudience}に（以前保存した条件は読めませんでした）`
    : conditionSummaries.length > 0
      ? `${triggerAudience}のうち、${conditionSummaries.join('・')}に`
      : `${triggerAudience}に`
  const actionSummary = actions.map((row) => {
    if (row.type === 'add_tag') {
      const tagName = tags.find((tag) => tag.id === row.tagId)?.name
      return tagName ? `タグ「${tagName}」を付ける` : '選んだタグを付ける'
    }
    if (row.type === 'common_action') {
      const commonActionName = commonActions.find((item) => item.id === row.commonActionId)?.name
      return commonActionName ? `共通アクション「${commonActionName}」を実行` : '共通アクションを実行'
    }
    if (row.type === 'start_scenario') {
      const scenarioName = scenarios.find((item) => item.id === row.scenarioId)?.name
      return scenarioName ? `シナリオ「${scenarioName}」を始める` : 'シナリオを始める'
    }
    return row.message.trim() ? '入力したメッセージを送る' : 'メッセージを送る'
  }).join('、')

  /** 保存で送る「すること」。確認画面とのずれを見るときも同じ形を使う。 */
  const draftActions = (): AutomationDraftAction[] => actions.map((row, index) =>
    actionDraftToPayload(row, index))

  /**
   * 確認に出す「実際に送られる中身」（N-358）。
   *
   * **画面の入力からは作らない。** サーバーが持っている下書きから作る。
   * 入力中で未保存の文面が確認へ混ざると、見た内容と送る内容がずれる。
   */
  const describeDraftActions = (list: AutomationDraftAction[]): { contents: string[]; effects: string[] } => ({
    contents: list.map((step) => {
      if (step.type === 'send_message') return `メッセージ「${String(step.params.content ?? '')}」`
      if (step.type === 'add_tag') {
        const tagId = String(step.params.tagId ?? '')
        return `タグ「${tags.find((tag) => tag.id === tagId)?.name ?? tagId}」を付ける`
      }
      if (step.type === 'common_action') {
        const commonActionId = String(step.params.commonActionId ?? '')
        return `共通アクション「${commonActions.find((item) => item.id === commonActionId)?.name ?? commonActionId}」を実行`
      }
      return `シナリオ「${String(step.params.scenarioId ?? '')}」を始める`
    }),
    effects: [
      list.some((step) => step.type === 'send_message') ? 'メッセージが相手に届きます' : null,
      list.some((step) => step.type === 'add_tag') ? 'タグが相手に付きます' : null,
      list.some((step) => step.type === 'start_scenario') ? 'シナリオが相手に始まります' : null,
      list.some((step) => step.type === 'common_action') ? '共通アクションの処理が相手に動きます' : null,
    ].filter((item): item is string => item !== null),
  })

  useEffect(() => {
    /*
     * 再開・控えの復元で eventType と詳細設定を一緒に戻したときは、
     * この切替で詳細設定を空にしない（戻した直後に消えてしまう）。
     */
    if (suppressTriggerResetRef.current) {
      suppressTriggerResetRef.current = false
      return
    }
    setTriggerConfig({})
  }, [eventType])

  // #519 軽 + #942 N-355: 共有の選択肢すべてを描く。設定の要約もそれぞれ持つ。
  const triggerConfigSummary = eventType === 'datetime'
    ? String(triggerConfig.at ?? '日時を指定')
    : eventType === 'daily' || eventType === 'weekly'
      ? String(triggerConfig.time ?? '時刻を指定')
      : eventType === 'form_submitted'
        ? String(triggerConfig.formId ?? 'すべてのフォーム')
        : eventType === 'link_clicked'
          ? String(triggerConfig.trackedLinkId ?? 'すべての計測リンク')
          : eventType === 'calendar_booked'
            ? String(triggerConfig.bookingType === 'salon' ? 'サロン予約' : triggerConfig.bookingType === 'event' ? 'イベント予約' : 'すべての予約')
            : ''

  const draftEventType: AutomationDraftDetail['eventType'] =
    selectedEvent.value as AutomationDraftDetail['eventType']
  const normalizedTriggerConfig = () =>
    normalizeTriggerConfigFor(draftEventType, triggerConfig, keyword)

  const updateAction = (key: number, patch: Partial<ActionDraft>) =>
    setActions((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)))

  const validate = (): string | null => {
    if (!name.trim()) return 'ルール名を入力してください'
    /*
     * 古い形で保存された条件を読めなかった下書きは、付け直すまで保存させない。
     * そのまま保存すると、読めなかった条件が黙って消えて全員へ届くルールに
     * 変わってしまう（AUTOMATION-04）。
     */
    if (conditionUnreadable) {
      return '保存されていた「だれに」の条件を付け直してください（読めない古い形のままでは保存できません）'
    }
    // 時刻・日時のきっかけは対象の友だちが必須（サーバの検証と同じ条件）。
    if (eventType === 'datetime' && !String(triggerConfig.at ?? '').trim()) return '実行日時を入力してください'
    if ((eventType === 'daily' || eventType === 'weekly') && !String(triggerConfig.time ?? '').trim()) return '実行時刻を入力してください'
    if (eventType === 'weekly' && !String(triggerConfig.weekdays ?? '').trim()) return '曜日を入力してください'
    if ((eventType === 'datetime' || eventType === 'daily' || eventType === 'weekly')
      && !String(triggerConfig.friendIds ?? '').trim()) return '対象の友だちを入力してください'
    if (actions.length === 0) return 'することを1つ以上決めてください'
    for (const row of actions) {
      if (row.type === 'add_tag' && !row.tagId) return '付けるタグを選んでください'
      if (row.type === 'start_scenario' && !row.scenarioId) return '始めるシナリオを選んでください'
      if (row.type === 'common_action' && !row.commonActionId) return '使う共通アクションを選んでください'
      if (row.type === 'send_message' && !row.message.trim()) return '送る文面を入力してください'
    }
    return null
  }

  /**
   * 保存を押せない理由。
   *
   * **押せるのに何も起きないボタンを置かない。** 権限が無いときは押せない形に
   * したうえで、理由を本文にも出す。
   */
  const blockedReason = useMemo(() => {
    if (canManage === null) return '権限を確認しています'
    if (!canManage) return '操作する権限がありません'
    // DETAIL-13: 再開した下書きは、中身を読み終わるまで保存できない。
    if (resumeStatus === 'loading') return '下書きを読み込んでいます'
    return null
  }, [canManage, resumeStatus])

  /*
   * DETAIL-15: 保存の状態は1本。未保存・保存中・保存済み・保存後の変更・
   * 失敗をここだけから出すので、「保存しました」と「まだ保存していません」が
   * 同時に出ることはない。
   */
  const currentFingerprint = draftPayloadFingerprint({
    name,
    eventType: draftEventType,
    keyword,
    condition,
    triggerConfig,
    actions,
  })
  const dirtySinceSave = savedFingerprint !== null && savedFingerprint !== currentFingerprint
  const saveStatusText = saving
    ? '保存しています'
    : blockedReason ?? (
        saveOutcome === 'failed'
          ? '保存できませんでした。入力した内容は残っています'
          : saveOutcome === 'saved'
            ? [
                dirtySinceSave
                  ? '保存したあとに内容を変更しています'
                  : `下書きに保存しました${savedAt === null ? '' : `（${formatClock(savedAt)}）`}`,
                // AUTOMATION-03: 人数の確認の失敗は、保存の結果とは別に添える。
                previewFailed ? '人数の確認に失敗しました。通信を確かめて、もう一度お試しください。' : null,
              ].filter((part): part is string => part !== null).join('・')
            : 'まだ保存していません')

  /**
   * 保存した版の見込み人数を数え直す（AUTOMATION-03）。
   *
   * **保存とは別の成否を持つ。** 以前は保存と同じ try の中で待っていた
   * ため、人数の取得が失敗すると「保存できませんでした」と出て、
   * 保存済みの下書きが失敗扱いになっていた。ここで失敗しても下書きは
   * 残っているので、「人数をもう一度数える」で保存した版へだけ再び
   * 問い合わせられる（新しい下書きは作らない）。途中で店が替わっても
   * 前の店へは書かない。
   */
  const refreshAudiencePreview = async (accountId: string, draft: StoredDraft) => {
    const stashedNow = formStashRef.current[accountId]
    if (stashedNow) stashedNow.previewFailed = false
    if (selectedAccountRef.current === accountId) {
      setPreviewRefreshing(true)
      setPreviewFailed(false)
    }
    try {
      const preview = await api.automations.audiencePreview(draft.id, accountId, draft.draftVersionId)
      if (!preview.success) throw new Error(preview.error)
      const stashed = formStashRef.current[accountId]
      if (stashed) {
        stashed.previewCount = preview.data.matched
        stashed.previewFailed = false
      }
      if (selectedAccountRef.current === accountId) {
        setPreviewCount(preview.data.matched)
        setPreviewFailed(false)
      }
    } catch {
      const stashed = formStashRef.current[accountId]
      if (stashed) stashed.previewFailed = true
      if (selectedAccountRef.current === accountId) setPreviewFailed(true)
    } finally {
      if (selectedAccountRef.current === accountId) setPreviewRefreshing(false)
    }
  }

  const save = async (activate: boolean) => {
    // N-357: 連打で下書きが2つできないよう、描き直しより先に鍵をかける。
    if (saveRunningRef.current) return
    if (saving || blockedReason) return
    const invalid = validate()
    if (invalid) {
      setError(invalid)
      setNotice('')
      return
    }
    saveRunningRef.current = true
    setSaving(true)
    setError('')
    setNotice('')
    const accountId = selectedAccountId
    /*
     * 保存直前に「送る中身」と「そのアカウントの入力一式」を固める。
     * 非同期の途中で店が切り替わっても、送る店・送る中身は押した時点のもの。
     */
    const payload = {
      name: name.trim(),
      eventType: draftEventType,
      triggerConfig: normalizedTriggerConfig(),
      conditions: conditionPayload(condition),
      // すること（アクション）は { type, params } の形で持つ。
      // params の中身は type ごとに違う。
      actions: draftActions(),
    }
    const fingerprint = canonicalJson(payload)
    const formAtSave = captureFormSnapshot()
    try {
      if (!accountId) throw new Error('LINE公式アカウントを選んでください')
      /*
       * DETAIL-13/14: 更新するのは「いま選んでいるアカウントに結び付いた
       * 下書き」だけ。画面の記憶ではなくアカウント別の控えを見るので、
       * 前に保存した別の下書きや、別の店の下書きを上書きすることはない。
       * 結び付いていなければ新しい下書きを作る（新規作成＝新規ID）。
       */
      let draft = draftByAccountRef.current[accountId] ?? null
      if (!draft) {
        /*
         * DETAIL-13: 作成操作の冪等鍵。まだ下書きが無い保存のたびに振り直すと、
         * 作成に成功したあと更新で失敗→やり直し、のとき別の下書きが増える。
         * 同じ操作の再試行は同じ鍵で呼ぶので、サーバーは同じ下書きを返す。
         * 別の新規作成（一覧からの再入場・公開後の再作成）は別の鍵になる。
         */
        const operationKey = createOpKeyRef.current[accountId]
          ?? (createOpKeyRef.current[accountId] = newOperationKey())
        const created = await api.automations.createDraftFromTemplate(
          'received-message-tag', accountId, operationKey,
        )
        if (!created.success) throw new Error(created.error)
        draft = created.data
        writeStoredDraft(accountId, draft)
      }
      const res = await api.automations.updateDraft(draft.id, accountId, {
        expectedDraftVersionId: draft.draftVersionId,
        ...payload,
      })
      if (!res.success) throw new Error(res.error)
      // 保存すると中身が変わるので、版の札も新しくなる。取り直してから
      // 見込み人数と公開へ渡す。古い札のままだと Worker に弾かれる（それが正しい）。
      const saved = await api.automations.getDraft(draft.id, accountId)
      if (!saved.success) throw new Error(saved.error)
      draft = { id: draft.id, draftVersionId: saved.data.draftVersionId }
      writeStoredDraft(accountId, draft)
      const savedTime = Date.now()
      /*
       * 結果の書き込みは「保存を始めたアカウント」の控えへ。いま画面に
       * 出しているのが別のアカウントでも、そのアカウントへ戻ったときに
       * 保存済みの状態（版・時刻・指紋）がそのまま戻る。
       */
      formStashRef.current[accountId] = {
        ...formAtSave,
        savedDraft: draft,
        savedAt: savedTime,
        savedFingerprint: fingerprint,
        saveOutcome: 'saved',
      }
      bindAccountDraft(accountId, draft)
      if (selectedAccountRef.current === accountId) {
        setSavedAt(savedTime)
        setSavedFingerprint(fingerprint)
        setSaveOutcome('saved')
        setStoredDraftHint(null)
        // 再読込・「戻る」でこの下書きへ戻れるよう、URLへ番号を載せる。
        // 再開では番号と中身・版を一緒に読むので、空の画面からの
        // 上書きにはならない（DETAIL-13）。「戻る」で新規画面へ戻れるよう
        // 履歴には積む。
        setResumeTarget(draft.id)
        syncResumeUrl(draft.id, 'push')
      }
      /*
       * AUTOMATION-03: 人数の確認は「保存」の外で行う。ここまで来た時点で
       * 下書きは保存済みなので、人数の失敗を保存の失敗へ混ぜない。
       * 待たずに進める（失敗は previewFailed で別に出る）。
       */
      void refreshAudiencePreview(accountId, draft)
      if (!activate) {
        if (selectedAccountRef.current === accountId) {
          setNotice('下書きに保存しました。見込み人数を確認して、1人で試せます。')
        }
        return
      }
      const published = await api.automations.publishDraft(draft.id, accountId, draft.draftVersionId, true)
      if (!published.success) throw new Error(published.error)
      // 公開したら下書きは無くなるので控えも捨てる。
      clearStoredDraft(accountId)
      bindAccountDraft(accountId, null)
      if (selectedAccountRef.current === accountId) router.push(`/automations?highlight=${draft.id}`)
    } catch (caught) {
      // 下書き自体が無くなっていたら控えを捨て、次は作り直す（N-357）。
      if (
        caught instanceof ApiError &&
        (caught.status === 404 || caught.status === 409 || caught.code === 'not_found' || caught.code === 'version_conflict')
      ) {
        if (accountId) {
          clearStoredDraft(accountId)
          bindAccountDraft(accountId, null)
          const stashed = formStashRef.current[accountId]
          if (stashed) {
            stashed.saveOutcome = 'idle'
            stashed.savedFingerprint = null
            stashed.savedAt = null
            stashed.previewCount = null
            stashed.previewFailed = false
          }
        }
        if (selectedAccountRef.current === accountId) {
          setSaveOutcome('idle')
          setSavedFingerprint(null)
          setSavedAt(null)
          setPreviewCount(null)
          setPreviewFailed(false)
          // 消えた下書きの番号をURLに残さない。残すと再読込のたびに
          // 「読み込めません」が出てしまう。
          setResumeTarget(null)
          syncResumeUrl(null)
        }
      } else if (accountId) {
        const stashed = formStashRef.current[accountId]
        if (stashed) stashed.saveOutcome = 'failed'
      }
      if (selectedAccountRef.current === accountId) {
        setSaveOutcome('failed')
        setError(
          caught instanceof ApiError || caught instanceof Error
            ? caught.message
            : '保存できませんでした',
        )
      }
    } finally {
      saveRunningRef.current = false
      setSaving(false)
    }
  }

  /**
   * N-358: 1人テストは2段階にする。
   *
   * 以前はIDを入れて押すとすぐ本番送信していた。送り先・送る内容・
   * 起きることを見せてから送る。**見せる中身はサーバーから取り直す**ので、
   * 画面に残っている古い記憶や未保存の入力は確認へ混ざらない。
   */
  const askOnePersonTest = async () => {
    const accountId = selectedAccountId
    const friendId = testFriendId.trim()
    const draft = savedDraft
    if (!draft || !accountId) {
      setError('実際に送る内容を確認するため、先に下書きを保存してください')
      return
    }
    if (!friendId) {
      setError('試す友だちのIDを入力してください')
      return
    }
    if (prepareRunningRef.current) return
    prepareRunningRef.current = true
    setPreparingTest(true)
    setError('')
    setNotice('')
    try {
      const detail = await api.automations.getDraft(draft.id, accountId)
      if (!detail.success) throw new Error(detail.error)
      // 別のタブで作り直されていたら、こちらの控えも新しい版へ合わせる。
      if (detail.data.draftVersionId !== draft.draftVersionId) {
        const refreshed = { id: draft.id, draftVersionId: detail.data.draftVersionId }
        writeStoredDraft(accountId, refreshed)
        bindAccountDraft(accountId, refreshed)
      }
      if (selectedAccountRef.current !== accountId) return
      const described = describeDraftActions(detail.data.actions)
      setTestConfirmation({
        accountId,
        draftId: draft.id,
        draftVersionId: detail.data.draftVersionId,
        fingerprint: draftFingerprint(detail.data),
        actionsFingerprint: canonicalJson(detail.data.actions),
        friendId,
        contents: described.contents,
        effects: described.effects,
      })
    } catch (caught) {
      if (selectedAccountRef.current !== accountId) return
      setError(
        caught instanceof ApiError || caught instanceof Error
          ? caught.message
          : '送る内容を確認できませんでした',
      )
    } finally {
      prepareRunningRef.current = false
      setPreparingTest(false)
    }
  }

  /**
   * 確認した中身だけを送る（N-358）。
   *
   * 送る直前にサーバーのいまの中身を取り直し、確認したときの指紋と
   * **1文字でも違えば送らない**。
   *
   * ここでの突き合わせは、利用者へ先に知らせるためのもの。**最後の砦は
   * Worker 側**にある。`api.automations.test` へ渡す `versionId` は
   * `getDraft` が返した札（`<版の行のid>.<中身の指紋>`）そのままで、Worker は
   * 実行記録を作る前にこの指紋と DB の中身を突き合わせ、違えば 409 で返す。
   * 画面側の突き合わせを外しても実送信は起きない（逆変異で確認済み）。
   */
  const runOnePersonTest = async () => {
    const pending = testConfirmation
    if (!pending || testRunningRef.current) return
    testRunningRef.current = true
    setTesting(true)
    setError('')
    const sameAccount = () => selectedAccountRef.current === pending.accountId
    try {
      const latest = await api.automations.getDraft(pending.draftId, pending.accountId)
      if (!latest.success) throw new Error(latest.error)
      if (
        latest.data.draftVersionId !== pending.draftVersionId
        || draftFingerprint(latest.data) !== pending.fingerprint
      ) {
        if (sameAccount()) {
          setTestConfirmation(null)
          setError('確認したあとに下書きが変わりました。送っていません。もう一度、送る内容を確認してください')
        }
        return
      }
      const result = await api.automations.test(
        pending.draftId, pending.accountId, pending.friendId, pending.draftVersionId,
      )
      if (!result.success) throw new Error(result.error)
      if (!sameAccount()) return
      setTestConfirmation(null)
      setNotice(`1人テストを受け付けました（状態: ${result.data.status}）`)
    } catch (caught) {
      // 待っている間に店を替えたら、前の店の成否をこの画面へ書かない。
      if (!sameAccount()) return
      // Worker が「確認したときと違う」と返したときも、画面側で気づいたときと
      // 同じ扱いにする。古い確認を開いたままにしない。
      if (caught instanceof ApiError && (caught.status === 409 || caught.code === 'version_conflict')) {
        setTestConfirmation(null)
      }
      setError(
        caught instanceof ApiError || caught instanceof Error
          ? caught.message
          : '1人テストを実行できませんでした',
      )
    } finally {
      testRunningRef.current = false
      setTesting(false)
    }
  }

  /**
   * DETAIL-13の再開入口。新規作成はいつも新しい下書きを作るが、
   * 前に保存した下書きがあるなら「開く」ことをここで選べる。
   */
  const openStoredDraft = () => {
    if (!storedDraftHint || !selectedAccountId) return
    // 再開は「明示した下書き番号」。URLへ載せて読み込みに行く。
    router.push(`/automations/new?draft=${encodeURIComponent(storedDraftHint.id)}`)
    setResumeTarget(storedDraftHint.id)
  }

  // `?draft=` を読み終わるまで描かない。一瞬だけ空の新規画面が出て、
  // そのまま保存で以前の下書きを上書きする事故を防ぐ。
  if (resumeTarget === undefined) return null

  return (
    <div data-design-node="Rv8Jv">
      <div data-design="Crumb">
        <Breadcrumb
          items={[{ label: 'オートメーション', href: '/automations' }, { label: 'ルールを作る' }]}
        />
      </div>

      {storedDraftHint && !savedDraft && resumeTarget === null ? (
        <div
          className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-control border border-info bg-info-bg px-4 py-3 text-sm font-medium text-info"
          role="note"
        >
          <span>
            前にこのアカウントで保存した下書きがあります。このまま入力すると、別の新しいルールになります。
          </span>
          <Button variant="secondary" onClick={openStoredDraft}>
            保存した下書きを開く
          </Button>
        </div>
      ) : null}

      <div className="mb-3 grid grid-cols-3 gap-3 rounded-card border border-hairline bg-canvas px-5 py-4" aria-label="いまの決めごと">
        <SummaryStep number={1} label="きっかけ" value={selectedEvent.label} />
        <SummaryStep number={2} label="だれに" value={targetSummary} />
        <SummaryStep number={3} label="すること" value={actionSummary || '処理を選んでください'} active />
      </div>

      <div data-design="Body" className={styles.body}>
        <div data-design="Left" className={styles.stack}>
          <Step
            step={1}
            done={Boolean(name.trim())}
            title="どんなときに動かしますか"
            note="何が起きたら動かすか。ここで選んだ出来事が起きた人だけが対象になります。"
          >
            {/* #975 U061: 10件を最初から並べない。検索→代表3件→「すべてを見る」の順で絞る。 */}
            <div className="mb-3">
              <TextField
                aria-label="きっかけを探す"
                type="search"
                value={eventQuery}
                onChange={(e) => setEventQuery(e.target.value)}
                placeholder="きっかけを言葉で探す（例: 予約・タグ・時刻）"
              />
            </div>
            {triggerEventGroups.map((group) =>
              group.events.length === 0 ? null : (
                <div key={group.id} className="mb-3">
                  <p className="mb-2 text-xs font-bold text-ink-faint">{group.label}</p>
                  <div className="grid grid-cols-2 gap-3 xl:grid-cols-6">
                    {group.events.map((event) => (
                      <button
                        key={event.value}
                        type="button"
                        className={`${styles.eventCard} ${eventType === event.value ? styles.eventCardSelected : ''}`}
                        onClick={() => setEventType(event.value)}
                      >
                        <span className="text-sm font-bold text-ink">{event.label}</span>
                        <span className="line-clamp-2 text-xs leading-5 text-ink-faint">{event.note}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ),
            )}
            {matchedEvents && matchedEvents.length === 0 ? (
              <p className="mb-3 text-xs text-ink-faint">合うきっかけがありません。言葉を変えるか、すべてのきっかけから選んでください。</p>
            ) : null}
            {!normalizedEventQuery && !expandedEvents ? (
              <Button variant="secondary" onClick={() => setShowAllEvents(true)}>
                ほかのきっかけもすべて見る（あと{EVENTS.length - REPRESENTATIVE_TRIGGER_EVENTS.length}件）
              </Button>
            ) : null}

            <div className="mt-4 grid items-center gap-3 lg:grid-cols-3">
              <label className={styles.label} htmlFor="au-name">
                名前（あとで見分けるため）<RequiredBadge />
                <span className="mt-1 block text-xs font-normal text-ink-faint">どのルールか。一覧に表示される名前です。</span>
              </label>
              <div className="lg:col-span-2">
                <TextField
                  id="au-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="例: 「予約」と送られたらタグを付ける"
                  maxLength={120}
                />
              </div>
            </div>

            {['tag_change', 'form_submitted', 'link_clicked', 'calendar_booked', 'datetime', 'daily', 'weekly'].includes(eventType) ? (
              <div className="mt-4 rounded-control border border-hairline bg-canvas-sunken p-3">
                <p className="text-xs font-semibold text-ink-secondary">きっかけの詳しい設定</p>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  {eventType === 'tag_change' ? <SelectField aria-label="きっかけのタグ" value={String(triggerConfig.tagId ?? '')} onChange={(e) => setTriggerConfig({ ...triggerConfig, tagId: e.target.value })} options={[{ value: '', label: 'どのタグか選ぶ' }, ...tags.map((tag) => ({ value: tag.id, label: tag.name }))]} className={styles.select} /> : null}
                  {eventType === 'tag_change' ? <SelectField aria-label="付いたとき・外れたとき" value={String(triggerConfig.action ?? 'add')} onChange={(e) => setTriggerConfig({ ...triggerConfig, action: e.target.value })} options={[{ value: 'add', label: '付いたとき' }, { value: 'remove', label: '外れたとき' }]} className={styles.select} /> : null}
                  {eventType === 'form_submitted' ? <TextField aria-label="回答フォーム" placeholder="フォームID（空欄ならすべて）" value={String(triggerConfig.formId ?? '')} onChange={(e) => setTriggerConfig({ formId: e.target.value })} /> : null}
                  {eventType === 'link_clicked' ? <TextField aria-label="計測リンク" placeholder="計測リンクID（空欄ならすべて）" value={String(triggerConfig.trackedLinkId ?? '')} onChange={(e) => setTriggerConfig({ trackedLinkId: e.target.value })} /> : null}
                  {eventType === 'calendar_booked' ? <SelectField aria-label="予約の種類" value={String(triggerConfig.bookingType ?? '')} onChange={(e) => setTriggerConfig({ ...triggerConfig, bookingType: e.target.value })} options={[{ value: '', label: 'すべての予約' }, { value: 'salon', label: 'サロン予約' }, { value: 'event', label: 'イベント予約' }]} className={styles.select} /> : null}
                  {eventType === 'calendar_booked' && triggerConfig.bookingType !== 'event' ? <TextField aria-label="予約メニュー" placeholder="メニューID（空欄ならすべて）" value={String(triggerConfig.menuId ?? '')} onChange={(e) => setTriggerConfig({ ...triggerConfig, menuId: e.target.value })} /> : null}
                  {eventType === 'calendar_booked' && triggerConfig.bookingType === 'event' ? <TextField aria-label="対象イベント" placeholder="イベントID（空欄ならすべて）" value={String(triggerConfig.eventId ?? '')} onChange={(e) => setTriggerConfig({ ...triggerConfig, eventId: e.target.value })} /> : null}
                  {eventType === 'datetime' ? <DateTimeField aria-label="実行日時" value={String(triggerConfig.at ?? '')} onChange={(v) => setTriggerConfig({ ...triggerConfig, at: v })} /> : null}
                  {eventType === 'daily' || eventType === 'weekly' ? <TimeField aria-label="実行時刻" step={300} value={String(triggerConfig.time ?? '')} onChange={(v) => setTriggerConfig({ ...triggerConfig, time: v })} /> : null}
                  {eventType === 'weekly' ? <TextField aria-label="曜日" placeholder="曜日番号（例: 1,3 は月・水）" value={String(triggerConfig.weekdays ?? '')} onChange={(e) => setTriggerConfig({ ...triggerConfig, weekdays: e.target.value })} /> : null}
                  {eventType === 'datetime' || eventType === 'daily' || eventType === 'weekly' ? <TextField aria-label="対象の友だち" placeholder="友だちID（複数はカンマ区切り、最大100人）" value={String(triggerConfig.friendIds ?? '')} onChange={(e) => setTriggerConfig({ ...triggerConfig, friendIds: e.target.value })} /> : null}
                </div>
                <p className="mt-2 text-xs text-ink-faint">{triggerConfigSummary}。保存後も設定を確認できます。</p>
              </div>
            ) : null}
          </Step>

          <Step
            step={2}
            done
            title="だれに動かしますか"
            note="条件を付けないと、きっかけに当てはまった人全員に動きます。"
          >
            {usesKeyword ? (
              <div className={styles.field}>
                <label className={styles.label} htmlFor="au-keyword">
                  条件（含まれる言葉）
                </label>
                <div className={styles.field}>
                  <TextField
                    id="au-keyword"
                    value={keyword}
                    onChange={(event) => setKeyword(event.target.value)}
                    placeholder="例: 予約"
                    maxLength={100}
                  />
                  <p className={styles.note}>空欄なら、どんな内容でも動きます。</p>
                </div>
              </div>
            ) : null}
            {/* AUTOMATION-02: 要約と同じ条件から作った札。条件が本当に無いときだけ「条件なし」。 */}
            <div className="mt-3 flex flex-wrap gap-2">
              {usesKeyword && keyword.trim() ? (
                <span className="inline-flex min-h-9 items-center rounded-full border border-hairline bg-canvas px-3 text-xs font-bold text-ink-secondary">「{keyword.trim()}」を含む</span>
              ) : null}
              {conditionSummaries.map((text, index) => (
                <span
                  key={`${index}-${text}`}
                  className="inline-flex min-h-9 items-center rounded-full border border-hairline bg-canvas px-3 text-xs font-bold text-ink-secondary"
                >
                  {text}
                </span>
              ))}
              {!((usesKeyword && keyword.trim()) || conditionSummaries.length > 0) ? (
                <span className="inline-flex min-h-9 items-center rounded-full border border-hairline bg-canvas px-3 text-xs font-bold text-ink-secondary">条件なし</span>
              ) : null}
            </div>
            {conditionUnreadable ? (
              /*
               * 古い保存口が残した読めない条件（AUTOMATION-04）。
               * 消すことも付け直すことも本人が決める。いきなり新しい条件へ
               * 置き換える操作だけ用意し、中身を黙って書き換えない。
               */
              <div className="mt-3 rounded-control border border-hairline bg-canvas-sunken px-4 py-3" role="alert">
                <p className="text-sm font-bold text-ink">保存されていた条件は読めませんでした</p>
                <p className="mt-1 text-xs leading-5 text-ink-secondary">
                  以前の画面が別の形で保存した条件です。このままでは人数を数えられないため、保存できません。
                  以前の条件を外してもよければ、下のボタンから付け直せます。
                </p>
                <div className="mt-2">
                  <Button variant="secondary" onClick={() => setConditionUnreadable(false)}>
                    以前の条件を外して付け直す
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mt-3">
                <ConditionBuilder
                  value={condition}
                  onChange={setCondition}
                  label="このルールで動かす相手"
                  showCount={false}
                />
                <p className="mt-2 text-xs text-ink-faint">標準互換（15軸）。一斉配信やシナリオと同じ条件です。</p>
              </div>
            )}
            <p className="mt-3 text-xs font-bold text-info">いまの条件に当てはまる友だち　保存後に見込み人数を確認できます。</p>
          </Step>

          <Step step={3} done={actions.length > 0} title="何をするか" note="上から順に実行します。">
            <div className={styles.rows}>
              {actions.map((row, index) => (
                <div key={row.key} className={styles.group}>
                  <div className={styles.rowHead}>
                    <span className={styles.rowName}>{index + 1}つめ</span>
                    <button
                      type="button"
                      className={styles.rowAction}
                      disabled={actions.length === 1}
                      onClick={() =>
                        setActions((current) => current.filter((item) => item.key !== row.key))
                      }
                    >
                      この動きを消す
                    </button>
                  </div>

                  {/*
                    「すること」と対象の設定は狭い幅では縦に並べる（#973 U023）。
                    2列のままだと390pxで処理名・タグ名が読めないほど潰れる。
                  */}
                  <div className="grid gap-3 lg:grid-cols-2">
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor={`au-action-${row.key}`}>
                      すること<RequiredBadge />
                    </label>
                    <div className={styles.field}>
                      <SelectField
                        id={`au-action-${row.key}`}
                        value={row.type}
                        onChange={(event) =>
                          updateAction(row.key, { type: event.target.value as ActionType })
                        }
                        options={ACTIONS.map((action) => ({ value: action.value, label: action.label }))}
                        className={styles.select}
                      />
                    </div>
                  </div>

                  {row.type === 'add_tag' ? (
                    <ResourcePickRow
                      title="付けるタグ"
                      id={`au-tag-${row.key}`}
                      selectLabel="自動化で付けるタグ"
                      value={row.tagId}
                      onPick={(value) => updateAction(row.key, { tagId: value })}
                      options={tags.map((tag) => ({ value: tag.id, label: tag.name }))}
                      tagsLoading={tagsLoading}
                      tagsFailed={tagsFailed}
                      failedNote="タグを読み込めませんでした。画面を再読み込みしてください。"
                    />
                  ) : row.type === 'start_scenario' ? (
                    <ResourcePickRow
                      title="始めるシナリオ"
                      id={`au-scenario-${row.key}`}
                      selectLabel="自動化で始めるシナリオ"
                      value={row.scenarioId}
                      onPick={(value) => updateAction(row.key, { scenarioId: value })}
                      options={scenarios.map((scenario) => ({ value: scenario.id, label: scenario.name }))}
                      tagsLoading={tagsLoading}
                      tagsFailed={tagsFailed}
                      failedNote="シナリオを読み込めませんでした。画面を再読み込みしてください。"
                    />
                  ) : row.type === 'common_action' ? (
                    <ResourcePickRow
                      title="使う共通アクション"
                      id={`au-common-action-${row.key}`}
                      selectLabel="自動化で使う共通アクション"
                      value={row.commonActionId}
                      onPick={(value) => updateAction(row.key, { commonActionId: value })}
                      options={commonActions.map((item) => ({ value: item.id, label: item.name }))}
                      tagsLoading={tagsLoading}
                      tagsFailed={tagsFailed}
                      failedNote="共通アクションを読み込めませんでした。画面を再読み込みしてください。"
                    />
                  ) : (
                    <div className={styles.field}>
                      <label className={styles.label} htmlFor={`au-message-${row.key}`}>
                        送る文面<RequiredBadge />
                      </label>
                      <div className={styles.field}>
                        <TextArea
                          id={`au-message-${row.key}`}
                          value={row.message}
                          onChange={(event) =>
                            updateAction(row.key, { message: event.target.value })
                          }
                          className={styles.textareaTall}
                        />
                        <p className={styles.note}>差し込みが使えます（例: {'{{name}}'}さん）。</p>
                      </div>
                    </div>
                  )}
                  </div>
                  <p>
                    失敗したとき: 現在はここで止まります。「次の処理へ進む」は実行基盤の接続後に選べます。
                  </p>
                </div>
              ))}
            </div>

            <div className={styles.field}>
              <button
                type="button"
                className={`${styles.action} ${styles.actionSecondary} ${styles.addAction}`}
                onClick={() => setActions((current) => [...current, newActionDraft()])}
              >
                動きを追加
              </button>
            </div>
          </Step>

          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
          {notice ? <p className={styles.note}>{notice}</p> : null}
          {canManage === false ? (
            <p className={styles.error} role="alert">
              操作する権限がありません。オーナーか管理者に依頼してください。
            </p>
          ) : null}
        </div>

        <div data-design="Right" className={styles.stack}>
          <section className={styles.sideCard}>
            <h2 className={styles.sideTitle}>いまの決めごとを文章にすると</h2>
            <p>
              {selectedEvent.label}、{targetSummary}{actionSummary || '処理を実行します'}。
            </p>
            <p className={styles.sideMissingNote}>
              「こうなったら、こうする」を決めておくと、あとは自動で動きます。<br />
              この文章のとおりに動きます。おかしいと感じたら、上の3つを見直してください。
            </p>
          </section>

          <section className={styles.sideCard}>
            <h2 className={styles.sideTitle}>当てはまりそうな人数</h2>
            <p className={styles.sideMissingValue}>{previewCount === null ? '—' : `${previewCount.toLocaleString('ja-JP')}人`}</p>
            <p className={styles.sideMissingNote}>
              {/* AUTOMATION-03: 人数の失敗は保存の失敗ではない。下書きは残っている。 */}
              {previewFailed
                ? '人数を数えられませんでした。下書きは保存されています。'
                : previewCount === null
                  ? '下書きを保存すると、いまの条件で数えます。'
                  : '保存した条件を、選択中のLINEアカウントで数えた結果です。'}
            </p>
            {previewFailed && savedDraft && selectedAccountId ? (
              <div className="mt-2">
                <Button
                  variant="secondary"
                  disabled={previewRefreshing}
                  onClick={() => void refreshAudiencePreview(selectedAccountId, savedDraft)}
                >
                  {previewRefreshing ? '数え直しています' : '人数をもう一度数える'}
                </Button>
              </div>
            ) : null}
            <div className="mt-3 space-y-2">
              <TextField aria-label="1人テストの友だちID" value={testFriendId} onChange={(event) => setTestFriendId(event.target.value)} placeholder="試す友だちID" />
              <Button
                onClick={() => void askOnePersonTest()}
                disabled={saving || testing || preparingTest || !savedDraft || !testFriendId.trim()}
              >
                {preparingTest ? '確認中...' : '1人で試す'}
              </Button>
              <p className="mt-1 text-xs font-medium leading-relaxed text-ink-faint">保存した時点の内容で試します。変えた後は保存し直してから試してください。</p>
            </div>
            {testConfirmation ? (
              <div className="mt-3 space-y-2 rounded-control border border-hairline bg-canvas-sunken p-3" role="dialog" aria-label="1人テストの確認">
                <p className="text-xs font-bold text-ink">送る前に確認してください</p>
                <p className="text-xs leading-5 text-ink-secondary">送り先：{testConfirmation.friendId}</p>
                <div className="text-xs leading-5 text-ink-secondary">
                  <p>送る内容：</p>
                  <ul className="list-disc pl-5">
                    {testConfirmation.contents.map((content, index) => <li key={`${index}-${content}`}>{content}</li>)}
                  </ul>
                </div>
                <p className="text-xs leading-5 text-ink-secondary">起きること：{testConfirmation.effects.join('、')}。取り消せません。</p>
                {canonicalJson(draftActions()) !== testConfirmation.actionsFingerprint ? (
                  <p className="text-xs font-bold leading-5 text-ink">画面の入力は、ここに出ている内容と違います。送られるのは、保存済みのこの内容です。</p>
                ) : null}
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => setTestConfirmation(null)}
                  >
                    やめる
                  </Button>
                  <Button
                    variant="primary"
                    disabled={testing}
                    onClick={() => void runOnePersonTest()}
                  >
                    {testing ? '送信中...' : 'この内容で送る'}
                  </Button>
                </div>
              </div>
            ) : null}
          </section>

          <FeatureLinkCard
            items={[
              { label: '友だち属性', note: '付けるタグはここで作ります', href: '/tags' },
              { label: 'テンプレート', note: '送る文面の型を用意できます', href: '/templates' },
              { label: '共通アクション', note: '同じ処理を使い回せます', href: '/common-actions' },
            ]}
          />

          <CareCard
            items={[
              {
                head: '下書きで確認してから動かせます',
                note: '下書きを保存すると、見込み人数と1人テストを確認できます。',
              },
              {
                head: '同じきっかけのルールは両方動きます',
                note: hasSameTrigger
                  ? '同じきっかけのルールが他にもあります。一覧で確かめてください。'
                  : '一覧で、同じきっかけのルールが他にないか確かめてください。',
              },
              {
                head: '作る前に起きたことにはさかのぼりません',
                note: '過去のメッセージや友だち追加では動きません。',
              },
            ]}
          />
        </div>
      </div>

      <StickyBar
        className={styles.stickyBar}
        status={saveStatusText}
        actions={
          <>
            <button
              type="button"
              className={`${styles.action} ${styles.actionSecondary}`}
              onClick={() => router.push('/automations')}
            >
              キャンセル
            </button>
            <button
              type="button"
              className={`${styles.action} ${styles.actionSecondary}`}
              disabled={saving || Boolean(blockedReason)}
              onClick={() => void save(false)}
            >
              下書きに保存
            </button>
            <button
              type="button"
              className={`${styles.action} ${styles.actionPrimary}`}
              disabled={saving || Boolean(blockedReason)}
              onClick={() => {
                const invalid = validate()
                if (invalid) {
                  setError(invalid)
                  setNotice('')
                  return
                }
                setActivateConfirmOpen(true)
              }}
            >
              {saving ? '作成中...' : 'つくって動かす'}
            </button>
          </>
        }
      />

      {/* #975 U073: 動かし始める前に、対象・きっかけ・最初の実行・止め方を読み合わせる。 */}
      <ConfirmDialog
        open={activateConfirmOpen}
        title="この内容で動かし始めますか"
        description="下書きを保存して、そのまま動かし始めます。内容を確認してください。"
        confirmLabel="保存して動かし始める"
        cancelLabel="戻って直す"
        busy={saving}
        onConfirm={() => {
          setActivateConfirmOpen(false)
          void save(true)
        }}
        onCancel={() => setActivateConfirmOpen(false)}
      >
        <dl className="space-y-2 text-sm">
          <div>
            <dt className="text-xs font-bold text-ink-faint">名前</dt>
            <dd className="font-semibold text-ink">{name.trim()}</dd>
          </div>
          <div>
            <dt className="text-xs font-bold text-ink-faint">きっかけ</dt>
            <dd className="text-ink">{selectedEvent.label}（{triggerConfigSummary}）</dd>
          </div>
          <div>
            <dt className="text-xs font-bold text-ink-faint">だれに</dt>
            <dd className="text-ink">
              {targetSummary}
              {previewCount !== null ? ` 見込み ${previewCount.toLocaleString('ja-JP')}人` : ''}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-bold text-ink-faint">すること</dt>
            <dd className="text-ink">{actionSummary || '未設定'}</dd>
          </div>
          <div>
            <dt className="text-xs font-bold text-ink-faint">最初に動くのは</dt>
            <dd className="text-ink">
              {['datetime', 'daily', 'weekly'].includes(eventType)
                ? `次の決めた時刻（${triggerConfigSummary}）`
                : '次にきっかけが起きたとき'}
            </dd>
          </div>
        </dl>
        <p className="mt-3 rounded-control bg-canvas-sunken px-3 py-2 text-xs text-ink-secondary">
          止め方：動かし始めたあとも「オートメーション」の一覧からいつでも止められます。先に確かめたい場合は「下書きに保存」して、1人で試すこともできます。
        </p>
      </ConfirmDialog>
    </div>
  )
}

/**
 * 決めごとの帯。番号バッジ 26×26・丸・12px・700（設計 `Rv8Jv`）。
 *
 * 本文に「1.」と書くのと違い、番号が段の頭に立つ。上から順に埋めれば終わる、
 * と分かるための番号なので、見出しを並べるのとは意味が違う。
 */
function Step({
  step,
  done,
  title,
  note,
  children,
}: {
  step: number
  done: boolean
  title: string
  note: string
  children: ReactNode
}) {
  return (
    <section className={styles.card}>
      <div className={styles.step}>
        <span className={`${styles.stepBadge} ${done ? '' : styles.stepBadgeIdle}`}>{step}</span>
        <div>
          <h2 className={styles.stepTitle}>{title}</h2>
          <p className={styles.stepNote}>{note}</p>
        </div>
      </div>
      <div className={styles.field}>{children}</div>
    </section>
  )
}

function SummaryStep({ number, label, value, active = false }: { number: number; label: string; value: string; active?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className={`${styles.stepBadge} ${active ? '' : styles.stepBadgeIdle}`}>{number}</span>
      <span className="flex min-w-0 flex-col"><small className="text-xs font-bold text-ink-faint">{label}</small><strong className="truncate text-sm text-ink" title={value}>{value}</strong></span>
    </div>
  )
}
