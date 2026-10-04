'use client'

import Select from '@/components/shared/select'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import type { Automation } from '@line-crm/shared'
import { AUTOMATION_DRAFT_ACTION_OPTIONS, AUTOMATION_DRAFT_TRIGGER_OPTIONS } from '@line-crm/shared'
import {
  api, ApiError, type AutomationDraftAction, type AutomationDraftCommonActionVersionDetail,
  type AutomationDraftDetail,
} from '@/lib/api'
import Link from 'next/link'
import StickyBar from '@/components/shared/sticky-bar'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import { TextArea, TextField } from '@/components/shared/text-field'
import DateTimeField, { TimeField } from '@/components/shared/date-time-field'
import { RequiredBadge } from '@/components/shared/form-controls'
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
import { isoToJstDatetimeLocal } from '@/components/automations/automation-datetime'
import styles from '../automations-v8.module.css'
import Button from '@/components/shared/button'
import {
  friendNamesOf,
  normalizeFriendIds,
  normalizeWeekdays,
  weekdayNames,
} from './trigger-helpers'
import { WeekdaySelect } from './weekday-select'
import { FriendMultiSelect } from './friend-multi-select'
import { formatNumber, formatTime } from '@/lib/format'

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
  /*
   * R491: 公開まで済んだら 'published' で控える。戻ったときに未公開の
   * 下書きと受け取って作り直し、稼働ルールを2件にしないため。
   */
  saveOutcome: 'idle' | 'saved' | 'failed' | 'published'
  /** 公開済みのときだけ、元のルールの番号。 */
  publishedDefinitionId: string | null
  previewCount: number | null
  /* AUTOMATION-03: 人数の確認は保存とは別の成否。失敗したことだけ控える。 */
  previewFailed: boolean
  /** R488: 受け付けた1人テストの実行。戻ったときは要求IDで読み直す。 */
  testRun: TestRunRecord | null
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
  publishedDefinitionId: null,
  previewCount: null,
  previewFailed: false,
  testRun: null,
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

/**
 * きっかけの詳しい設定を、保存で送る形へ直す。 */
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
    return { at: local ? new Date(`${local}:00+09:00`).toISOString() : '', friendIds: normalizeFriendIds(triggerConfig.friendIds) }
  }
  if (eventType === 'daily' || eventType === 'weekly') return {
    time: String(triggerConfig.time ?? ''),
    friendIds: normalizeFriendIds(triggerConfig.friendIds),
    ...(eventType === 'weekly' ? { weekdays: normalizeWeekdays(triggerConfig.weekdays) } : {}),
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

/** ISOの日時を、画面の datetime-local（日本時間）の文字へ戻す。実体は共有（R482）。 */
const isoToDatetimeLocal = isoToJstDatetimeLocal

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
  /* R21・R22: 曜日と対象の友だちは配列で持つ。古い文字列の控えも正規化する。 */
  const friendNames = friendNamesOf(config as Record<string, unknown>)
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
        return { at: isoToDatetimeLocal(String(config.at ?? '')), friendIds: normalizeFriendIds(config.friendIds), friendNames }
      case 'daily':
        return { time: String(config.time ?? ''), friendIds: normalizeFriendIds(config.friendIds), friendNames }
      case 'weekly':
        return {
          time: String(config.time ?? ''),
          friendIds: normalizeFriendIds(config.friendIds),
          friendNames,
          weekdays: normalizeWeekdays(config.weekdays),
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
  formatTime(time)

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
  /**
   * R487: 確認画面で出した共通アクションの版の一式。実行要求に添え、
   * Worker が確認後の利用版切り替えを 409 で止める照合に使う。
   */
  commonActionExpectations: Array<{ stepId: string; commonActionId: string; versionId: string }>
  /**
   * R484: この確認だけの要求キー。応答が失われたあとの再試行も同じ鍵で
   * 呼び、Worker は2件目の実行を作らず初回を返す。確認を開くたびに振る。
   */
  operationKey: string
}

/**
 * R488: 受け付けた1人テストの実行。状態は日本語で出し、同じ実行の
 * 結果へ飛べるように実行IDを持つ。新規実行と結果確認を混同させない。
 */
interface TestRunRecord {
  runId: string
  /** Worker が返したままの状態（queued/waiting/success/...）。 */
  status: string
  accountId: string
  at: number
}

/** 1人テストの実行状態を日本語で出す（R488：生の `waiting` は出さない）。 */
const TEST_RUN_STATUS_LABEL: Record<string, string> = {
  queued: '受け付け済み',
  running: '動いています',
  waiting: '待機中',
  success: '終わりました',
  partial: '一部だけ終わりました',
  // 失敗の文は立て直し方まで書く（error-copy-recovery-contract）。次の手は下の「実行の結果を見る」。
  failed: '失敗しました。実行の結果を見てください。',
  cancelled: '取りやめました',
  skipped_condition: '条件に外れて動きませんでした',
  busy: '混み合っています',
}

const testRunStatusLabel = (status: string): string => TEST_RUN_STATUS_LABEL[status] ?? '確認中'

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
    <div className="space-y-2">
      <label className={styles.fieldLabel} htmlFor={id}>
        {title}<RequiredBadge />
      </label>
      <div className="space-y-2">
        <Select
          id={id}
          value={value}
          disabled={tagsLoading || tagsFailed}
          onChange={(value) => onPick(value)}
          aria-label={selectLabel}
          size="standard"
          options={[
            { value: '', label: '— 選んでください —' },
            ...options.map((option) => ({ value: option.value, label: option.label })),
          ]}
        />
        {tagsLoading ? <p className={styles.footnote}>読み込んでいます</p> : null}
        {tagsFailed ? (
          <p className={styles.footnote}>
            {failedNote}
          </p>
        ) : null}
      </div>
    </div>
  )
}

/*
 * ★V8-B ルールを作る（板 `M4torY`・競合 `tJqST`）と
 * 下書きを仕上げる（板 `J1VA8`）。
 *
 * v7（page.tsx の器）とは別の器。データの口・動きは v7 と同じ
 * （きっかけ・条件・処理・下書き保存・公開・1人テスト・人数・再開）。
 * 競合（tJqST）は v7 の文言に加え、帯と比べる窓を持つ。
 * 変える操作は器の外（共通の部品・API）へ触らない。
 * v7 を直す必要が出たら page.tsx 側も同じ判断を入れる。
 *
 * `chrome: 'create'` は白紙の作成、`'draft'` は下書きの仕上げ
 * （下書き番号を外から受け、見本への戻り道と案内を持つ）。
 */
export function NewAutomationV8({
  draftId,
  chrome,
}: {
  draftId?: string
  chrome: 'create' | 'draft'
}) {
  usePageTitle(chrome === 'draft' ? '下書きを仕上げる' : 'ルールを作る')
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
  const [resumeTarget, setResumeTarget] = useState<string | null | undefined>(draftId ?? undefined)
  const [resumeStatus, setResumeStatus] = useState<'none' | 'loading' | 'ready' | 'failed'>('none')
  /*
   * R532: 再開の読み込みが失敗した理由。通信断・対象なし・権限なしで
   * 案内を分け、通信断では同じ下書きの再試行だけを出し、保存は止める。
   */
  const [resumeErrorKind, setResumeErrorKind] = useState<'gone' | 'forbidden' | 'network' | null>(null)
  /* R532: 「もう一度読み込む」で再開の読み込みを走らせ直す番号。 */
  const [resumeRetry, setResumeRetry] = useState(0)
  /* このアカウントに前に保存した下書きがある、という案内にだけ使う控え。 */
  const [storedDraftHint, setStoredDraftHint] = useState<StoredDraft | null>(null)
  /* DETAIL-15: 未保存・保存中・保存済み・保存後の変更・失敗を1つの状態から出す。 */
  const [saveOutcome, setSaveOutcome] = useState<'idle' | 'saved' | 'failed' | 'published'>('idle')
  /* R491: 公開済みで戻ったとき、元のルールへ案内するための番号。 */
  const [publishedRuleId, setPublishedRuleId] = useState<string | null>(null)
  /*
   * 競合（板 `tJqST`）：保存しようとしたら、ほかの人が先に同じ下書きを
   * 保存していた。自分の入力は残したまま、帯で知らせる。
   * 誰が・いつ保存したかは口が返さないため、帯の文言は相手を名指ししない。
   * 比べる窓は、自分のいまの入力と、取り直した保存済みの内容を並べる。
   */
  const [conflict, setConflict] = useState<null | {
    draftId: string
    serverVersionId: string
    serverName: string
    serverEventLabel: string
    serverActionCount: number
  }>(null)
  const [compareOpen, setCompareOpen] = useState(false)
  /* R488: 受け付けた1人テストの実行。 */
  const [testRun, setTestRun] = useState<TestRunRecord | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [savedFingerprint, setSavedFingerprint] = useState<string | null>(null)
  // 画面の描き直しを待たずに二重押しを止める鍵（N-357・N-358）。
  const saveRunningRef = useRef(false)
  const testRunningRef = useRef(false)
  const prepareRunningRef = useRef(false)
  /*
   * R485: 送信前の読み取り待ちに取消の番号を持たせる。「やめる」を押すと
   * 番号が進み、遅れて返った読み取りは送信へ進まない。
   */
  const testTicketRef = useRef(0)
  /*
   * R491: 公開待ちの応答を要求の世代で照合する。アカウントごとに保存の
   * 番号を振り、切替後に届いた古い応答で画面を戻さない。
   */
  const saveTicketRef = useRef<Record<string, number>>({})
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
    publishedDefinitionId: publishedRuleId,
    previewCount,
    previewFailed,
    testRun,
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
    setPublishedRuleId(snapshot.publishedDefinitionId)
    setPreviewCount(snapshot.previewCount)
    setPreviewFailed(snapshot.previewFailed)
    setTestRun(snapshot.testRun)
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
  /* 下書きの仕上げでは番号を `?id=` で持つ。再開の読み直しは番号だけ見る。 */
  const resumeBase = chrome === 'draft' ? '/automations/drafts' : '/automations/new'
  const syncResumeUrl = (targetId: string | null, mode: 'push' | 'replace' = 'replace') => {
    const url = chrome === 'draft'
      ? (targetId ? `${resumeBase}?id=${encodeURIComponent(targetId)}` : resumeBase)
      : (targetId ? `${resumeBase}?draft=${encodeURIComponent(targetId)}` : resumeBase)
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
    const readLocation = () => {
      const params = new URLSearchParams(window.location.search)
      setResumeTarget(params.get('draft') ?? params.get('id'))
    }
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
      // R488・第145回: 受け付けた実行があれば状態を読み直す。待機が
      // 終わっていれば、その結果に戻る。公開済みの控えは元ルールへ案内する。
      if (stashed.testRun && selectedAccountId) void refreshTestRun(stashed.testRun, selectedAccountId)
      if (stashed.saveOutcome === 'published' && stashed.publishedDefinitionId) {
        setNotice('この内容はすでに公開済みです。一覧で確認できます。')
      }
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
   * R532: 読めない下書きは理由を出して保存を止める。通信断では同じ
   * 下書きの再試行だけを出し、対象なし・権限なしでは白紙への作り直しを
   * 明示の選択にする。失敗中に別の新規下書きは作らない。
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
    setResumeErrorKind(null)
    setError('')
    setNotice('')
    api.automations
      .getDraft(draftId, accountId)
      .then((res) => {
        if (cancelled || selectedAccountRef.current !== accountId) return
        if (!res.success) {
          setResumeStatus('failed')
          setResumeErrorKind('gone')
          setError(
            '指定された下書きは読み込めませんでした。削除されたか、ほかのアカウントの下書きの可能性があります。',
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
          publishedDefinitionId: null,
          previewCount: null,
          previewFailed: false,
          testRun: null,
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
      .catch((caught: unknown) => {
        if (cancelled || selectedAccountRef.current !== accountId) return
        setResumeStatus('failed')
        // R532: 失敗の理由を分ける。通信断では同じ下書きの再試行を出し、
        // 対象なし・権限なしでは白紙への作り直しを選ばせる。
        if (caught instanceof ApiError && caught.status === 404) {
          setResumeErrorKind('gone')
          setError('指定された下書きは見つかりませんでした。削除された可能性があります。')
        } else if (caught instanceof ApiError && caught.status === 403) {
          setResumeErrorKind('forbidden')
          setError('指定された下書きを開く権限がありません。')
        } else {
          setResumeErrorKind('network')
          setError('下書きを読み込めませんでした。通信状態を確かめて、もう一度お試しください。')
        }
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccountId, resumeTarget, resumeRetry])

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
   * 共通アクションの版の中身を、確認画面向けの一文へたたむ（R486）。
   * 入れ子の呼び出しは `commonActionVersions` 地図を辿って版番号まで出す。
   * 中身を確かめられない枝があれば `unresolved` を立て、送信へ進めない。
   */
  const describeCommonActionSteps = (
    steps: AutomationDraftCommonActionVersionDetail['actions'],
    versions: AutomationDraftDetail['commonActionVersions'],
    depth: number,
    unresolved: { flag: boolean },
  ): string => {
    if (depth > 5) {
      unresolved.flag = true
      return '中身を確認できません'
    }
    const parts = steps.map((step) => {
      const params = step.params ?? {}
      if (step.type === 'send_message') return `メッセージ「${String(params.content ?? '')}」を送る`
      if (step.type === 'add_tag' || step.type === 'remove_tag') {
        const tagId = String(params.tagId ?? '')
        const tagName = tags.find((tag) => tag.id === tagId)?.name ?? tagId
        return step.type === 'add_tag' ? `タグ「${tagName}」を付ける` : `タグ「${tagName}」を外す`
      }
      if (step.type === 'wait') {
        const minutes = String(params.durationMinutes ?? params.minutes ?? '')
        return `${minutes}分待つ`
      }
      if (step.type === 'start_scenario' || step.type === 'stop_scenario' || step.type === 'resume_scenario') {
        const scenarioId = String(params.scenarioId ?? '')
        const scenarioName = scenarios.find((item) => item.id === scenarioId)?.name ?? scenarioId
        if (step.type === 'stop_scenario') return `シナリオ「${scenarioName}」を止める`
        if (step.type === 'resume_scenario') return `シナリオ「${scenarioName}」を再開する`
        return `シナリオ「${scenarioName}」を始める`
      }
      if (step.type === 'send_webhook') return 'Webhookへ送る'
      if (step.type === 'set_metadata') return '友だち情報を更新する'
      if (step.type === 'switch_rich_menu' || step.type === 'remove_rich_menu') return 'リッチメニューを切り替える'
      if (step.type === 'common_action') {
        const versionId = String(params.commonActionVersionId ?? '')
        const version = versionId ? versions[versionId] : undefined
        if (!version) {
          unresolved.flag = true
          return '共通アクション（使う版を確認できません）'
        }
        return `共通アクション「${version.name}」第${version.versionNumber}版（${describeCommonActionSteps(version.actions, versions, depth + 1, unresolved)}）`
      }
      if (step.type === 'branch') return '条件で分かれる'
      return '設定した処理を実行'
    })
    return parts.length > 0 ? parts.join('、') : '処理なし'
  }

  /**
   * 確認に出す「実際に送られる中身」（N-358）。
   *
   * **画面の入力からは作らない。** サーバーが持っている下書きから作る。
   * 入力中で未保存の文面が確認へ混ざると、見た内容と送る内容がずれる。
   *
   * R486: 共通アクションは名前だけでなく、確認時に固定される版の番号と
   * その中身（本文）まで出す。版や中身が解決できない処理が1件でも
   * あれば `unconfirmed` を立て、送信は受け付けない。
   */
  const describeDraftActions = (
    list: AutomationDraftAction[],
    refs: AutomationDraftDetail['commonActionRefs'],
    versions: AutomationDraftDetail['commonActionVersions'],
  ): { contents: string[]; effects: string[]; unconfirmed: boolean } => {
    const unresolved = { flag: false }
    const contents = list.map((step) => {
      if (step.type === 'send_message') return `メッセージ「${String(step.params.content ?? '')}」`
      if (step.type === 'add_tag') {
        const tagId = String(step.params.tagId ?? '')
        return `タグ「${tags.find((tag) => tag.id === tagId)?.name ?? tagId}」を付ける`
      }
      if (step.type === 'common_action') {
        const ref = refs.find((item) => item.stepId === step.id)
        const name = ref?.name
          ?? commonActions.find((item) => item.id === ref?.commonActionId)?.name
          ?? ref?.commonActionId ?? '共通アクション'
        if (!ref?.versionId) {
          unresolved.flag = true
          return `共通アクション「${name}」（使う版を確認できません）`
        }
        const version = versions[ref.versionId]
        if (!version) {
          unresolved.flag = true
          return `共通アクション「${name}」第${ref.versionNumber ?? '?'}版（中身を確認できません）`
        }
        return `共通アクション「${version.name}」第${version.versionNumber}版：${describeCommonActionSteps(version.actions, versions, 1, unresolved)}`
      }
      return `シナリオ「${String(step.params.scenarioId ?? '')}」を始める`
    })
    return {
      contents,
      effects: [
        list.some((step) => step.type === 'send_message') ? 'メッセージが相手に届きます' : null,
        list.some((step) => step.type === 'add_tag') ? 'タグが相手に付きます' : null,
        list.some((step) => step.type === 'start_scenario') ? 'シナリオが相手に始まります' : null,
        list.some((step) => step.type === 'common_action') ? '共通アクションの処理が相手に動きます' : null,
      ].filter((item): item is string => item !== null),
      unconfirmed: unresolved.flag,
    }
  }

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

  /*
   * R22: 読み込んだ下書きの対象（IDだけ）へ名前を付け直す。
   * 保存にはIDだけを送り、名前は表示専用（`friendNames`）として持つ。
   * 指紋・保存の中身には名前を入れないので、付け直しで「変更あり」にはならない。
   */
  useEffect(() => {
    if (!selectedAccountId) return
    const ids = normalizeFriendIds(triggerConfig.friendIds)
    const names = friendNamesOf(triggerConfig)
    const missing = ids.filter((id) => !names[id])
    if (missing.length === 0) return
    let cancelled = false
    void Promise.all(
      missing.map((id) =>
        api.friends
          .get(id, { includeSubmissions: false })
          .then((response) => {
            if (!response.success) return { id, name: id }
            const label = (response.data as { displayName?: unknown }).displayName
            return { id, name: typeof label === 'string' && label ? label : id }
          })
          .catch(() => ({ id, name: id })),
      ),
    ).then((resolved) => {
      if (cancelled || resolved.length === 0) return
      const found: Record<string, string> = {}
      for (const item of resolved) found[item.id] = item.name
      setTriggerConfig((current) => ({ ...current, friendNames: { ...friendNamesOf(current), ...found } }))
    })
    return () => {
      cancelled = true
    }
  }, [selectedAccountId, triggerConfig.friendIds, triggerConfig.friendNames])

  // #519 軽 + #942 N-355: 共有の選択肢すべてを描く。設定の要約もそれぞれ持つ。
  const weeklyDays = eventType === 'weekly' ? normalizeWeekdays(triggerConfig.weekdays) : []
  const triggerConfigSummary = eventType === 'datetime'
    ? String(triggerConfig.at ?? '日時を指定')
    : eventType === 'weekly'
      ? `毎週${weekdayNames(weeklyDays) || '曜日を選ぶ'} ${String(triggerConfig.time ?? '時刻を指定')}`
      : eventType === 'daily'
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
    if (eventType === 'weekly' && normalizeWeekdays(triggerConfig.weekdays).length === 0) return '曜日を1つ以上選んでください'
    if ((eventType === 'datetime' || eventType === 'daily' || eventType === 'weekly')
      && normalizeFriendIds(triggerConfig.friendIds).length === 0) return '対象の友だちを選んでください'
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
    /*
     * R532: 再開の読み込みに失敗したまま保存させない。Aの更新も新規作成も
     * 実行されない。再試行でAを読めた後だけ保存でき、明示の作り直しでだけ
     * 白紙に戻る。
     */
    if (resumeTarget && resumeStatus === 'failed') {
      return resumeErrorKind === 'network'
        ? '下書きを読み込めませんでした。下の「下書きをもう一度読み込む」で取り直してから保存してください'
        : '指定された下書きを開けません。下の案内から読み直すか、白紙から作り直してください'
    }
    return null
  }, [canManage, resumeStatus, resumeTarget, resumeErrorKind])

  /*
   * R532: 失敗した再開の読み込みを、同じ下書きでもう一度だけ走らせる。
   * 読んだ組み合わせの記録を消して番号を進めるので、効果が取り直される。
   */
  const retryResume = () => {
    resumedKeyRef.current = null
    setResumeRetry((n) => n + 1)
  }

  /*
   * R532: 白紙からの作り直し（明示の選択）。URLの指定を外して再開をやめ、
   * この後保存したら別の新規下書きとして作る。失敗中の自動的な新規作成はしない。
   */
  const restartFresh = () => {
    syncResumeUrl(null)
    setResumeTarget(null)
    setResumeStatus('none')
    setResumeErrorKind(null)
    setError('')
    setNotice('')
  }

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
          : saveOutcome === 'published'
            ? '公開しました。一覧で確認できます'
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

  /**
   * R490: 下書きが消えていたら、公開済みの定義として残っているか照合する。
   * 公開の応答が失われたあとの再試行で、新しい下書きを作る前に呼ぶ。
   * 公開済み（動いている・止めている）が見つかれば true。
   */
  const reconcilePublishedDraft = async (accountId: string, draftId: string): Promise<boolean> => {
    try {
      const list = await api.automations.list({ accountId })
      if (!list.success) return false
      const found = list.data.find((item) => item.id === draftId)
      return !!found && (found.status === 'active' || found.status === 'stopped')
    } catch {
      return false
    }
  }

  /*
   * 競合（tJqST）の記録。保存済みのいまの内容を取り直し、
   * 自分の入力は残したまま帯で知らせる。比べる窓の材料にもする。
   */
  const recordConflict = async (targetDraftId: string, targetAccountId: string): Promise<boolean> => {
    try {
      const server = await api.automations.getDraft(targetDraftId, targetAccountId)
      if (!server.success) return false
      if (selectedAccountRef.current !== targetAccountId) return false
      const eventLabel = AUTOMATION_DRAFT_TRIGGER_OPTIONS.find(
        (option) => option.value === server.data.eventType,
      )?.label ?? server.data.eventType
      setConflict({
        draftId: targetDraftId,
        serverVersionId: server.data.draftVersionId,
        serverName: server.data.name,
        serverEventLabel: eventLabel,
        serverActionCount: server.data.actions.length,
      })
      return true
    } catch {
      return false
    }
  }

  /*
   * 競合のあと、保存されている内容で入力を置き換える。
   * 自分の未保存の入力は消えるので、比べる窓から選ぶのが先。
   */
  const reloadServerDraft = async () => {
    if (!conflict || !selectedAccountId) return
    const accountId = selectedAccountId
    try {
      const res = await api.automations.getDraft(conflict.draftId, accountId)
      if (!res.success) throw new Error(res.error)
      if (selectedAccountRef.current !== accountId) return
      const restored = draftDetailToForm(res.data)
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
      bindAccountDraft(accountId, { id: res.data.id, draftVersionId: res.data.draftVersionId })
      writeStoredDraft(accountId, { id: res.data.id, draftVersionId: res.data.draftVersionId })
      setConflict(null)
      setCompareOpen(false)
      setSaveOutcome('saved')
      setError('')
      setNotice('最新の内容を読み込みました。表示は保存されている内容です。')
    } catch {
      if (selectedAccountRef.current === accountId) {
        setError('最新の内容を読み込めませんでした。通信状態を確かめて、もう一度お試しください。')
      }
    }
  }

  const save = async (activate: boolean, force = false) => {
    // N-357: 連打で下書きが2つできないよう、描き直しより先に鍵をかける。
    if (saveRunningRef.current) return
    if (saving || blockedReason) return
    /* 比べてから保存：競合の版を承知の上で上書きする。 */
    const forcedVersion = force ? conflict?.serverVersionId : undefined
    setConflict(null)
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
    /*
     * R491: すでに公開済みの内容をそのまま「つくって動かす」と、
     * 同じ稼働ルールが2件になる。変えていないなら一覧へ案内し、
     * 変えた後なら新しいルールとして作る（明示的な作り直し）。
     */
    if (saveOutcome === 'published' && publishedRuleId && savedFingerprint === fingerprint) {
      setError('この内容はすでに公開済みです。一覧で確認してください。')
      setNotice('')
      router.push(`/automations?highlight=${publishedRuleId}`)
      return
    }
    // R491: 公開待ちの応答を要求の世代で照合するための番号。
    const saveTicket = (saveTicketRef.current[accountId ?? ''] ?? 0) + 1
    if (accountId) saveTicketRef.current[accountId] = saveTicket
    // R490: 公開の POST まで進んだか。再試行の案内と照合に使う。
    let publishAttempted = false
    let publishDraftId: string | null = null
    // R490: 照合は catch からも触るので、try の外で持つ。
    let draft: StoredDraft | null = null
    try {
      if (!accountId) throw new Error('LINE公式アカウントを選んでください')
      /*
       * DETAIL-13/14: 更新するのは「いま選んでいるアカウントに結び付いた
       * 下書き」だけ。画面の記憶ではなくアカウント別の控えを見るので、
       * 前に保存した別の下書きや、別の店の下書きを上書きすることはない。
       * 結び付いていなければ新しい下書きを作る（新規作成＝新規ID）。
       */
      draft = draftByAccountRef.current[accountId] ?? null
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
        expectedDraftVersionId: forcedVersion ?? draft.draftVersionId,
        ...payload,
      })
      if (!res.success) throw new Error(res.error)
      /*
       * 保存すると中身が変わるので、版の札も新しくなる。取り直してから
       * 見込み人数と公開へ渡す。古い札のままだと Worker に弾かれる（それが正しい）。
       *
       * R489: 公開するのは「自分の保存が作った版」だけ。保存と読み直しの
       * 間に別の人が保存すると、読み直しが返すのはその人の版になる。
       * 版の札には中身の指紋が入っているので、札が違う＝中身が違う。
       * そのまま使うと自分が確認していない内容を公開してしまうため、
       * 409 と同じ扱いで止めて、双方の入力を残して案内する。
       */
      const saved = await api.automations.getDraft(draft.id, accountId)
      if (!saved.success) throw new Error(saved.error)
      /*
       * R489・tJqST: 承知の上書き（force）でなければ、ほかの人の保存と
       * 重なったら帯で知らせる。自分の入力は残す。
       */
      if (!forcedVersion && saved.data.draftVersionId !== res.data.draftVersionId) {
        if (await recordConflict(draft.id, accountId)) return
        throw new ApiError(
          409,
          'ほかの人が同じ下書きを保存しました。内容を確かめてから、もう一度お試しください',
          'version_conflict',
        )
      }
      draft = { id: draft.id, draftVersionId: res.data.draftVersionId }
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
        publishedDefinitionId: null,
        // 保存し直したら前の1人テストの結果は古い内容のもの。残さない。
        testRun: null,
      }
      bindAccountDraft(accountId, draft)
      if (selectedAccountRef.current === accountId) {
        setSavedAt(savedTime)
        setSavedFingerprint(fingerprint)
        setSaveOutcome('saved')
        setPublishedRuleId(null)
        setTestRun(null)
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
      /*
       * R483: 新規作成の下書きは状態が draft のはず。読み取り後の停止・再開を
       * 読んだ時点の状態で上書きしないよう、見た状態を条件に入れる。
       */
      publishAttempted = true
      publishDraftId = draft.id
      const published = await api.automations.publishDraft(draft.id, accountId, draft.draftVersionId, true, 'draft')
      if (!published.success) throw new Error(published.error)
      // 公開したら下書きは無くなるので控えも捨てる。
      clearStoredDraft(accountId)
      bindAccountDraft(accountId, null)
      if (selectedAccountRef.current === accountId
        && saveTicketRef.current[accountId] === saveTicket) {
        router.push(`/automations?highlight=${draft.id}`)
      } else {
        /*
         * R491: 別の店を見ている間に公開が済んだ。控えを「公開済み」にして、
         * 戻ったときに未公開の下書きと受け取って作り直さないようにする。
         * 古い番号の応答（世代が違う）は何も書かない。
         */
        if (saveTicketRef.current[accountId] === saveTicket) {
          const stashed = formStashRef.current[accountId]
          if (stashed) {
            stashed.savedDraft = null
            stashed.saveOutcome = 'published'
            stashed.publishedDefinitionId = draft.id
          }
        }
      }
    } catch (caught) {
      /*
       * tJqST: 版の重なり（409）は帯で知らせる。結び付き・控えは捨てず、
       * 自分の入力のまま比べ直せるようにする。消えた下書き（404）だけ
       * 従来どおり控えを捨てて作り直す。
       */
      if (
        draft && accountId
        && caught instanceof ApiError
        && (caught.status === 409 || caught.code === 'version_conflict')
      ) {
        if (await recordConflict(draft.id, accountId)) {
          if (selectedAccountRef.current === accountId) {
            setSaveOutcome('failed')
            setError('')
          }
          return
        }
      }
      // 下書き自体が無くなっていたら控えを捨て、次は作り直す（N-357）。
      if (
        caught instanceof ApiError &&
        (caught.status === 404 || caught.status === 409 || caught.code === 'not_found' || caught.code === 'version_conflict')
      ) {
        /*
         * R490: 動かし始める操作で下書きが404/409のときは、公開済みか先に
         * 照合する。公開の応答が失われたあとの再試行では、更新の404が
         * 公開済みの合図になる。公開済みなら作り直さず元のルールへ案内し、
         * 稼働ルールを2件にしない。
         */
        if (activate && draft && accountId) {
          const reconciled = await reconcilePublishedDraft(accountId, draft.id)
          if (reconciled) {
            clearStoredDraft(accountId)
            bindAccountDraft(accountId, null)
            const stashed = formStashRef.current[accountId]
            if (stashed) {
              stashed.savedDraft = null
              stashed.saveOutcome = 'published'
              stashed.publishedDefinitionId = draft.id
              stashed.savedAt = null
            }
            if (selectedAccountRef.current === accountId) {
              setSaveOutcome('published')
              setPublishedRuleId(draft.id)
              setResumeTarget(null)
              syncResumeUrl(null)
              setNotice('すでに公開されています。一覧で確認できます。')
              router.push(`/automations?highlight=${draft.id}`)
            }
            saveRunningRef.current = false
            setSaving(false)
            return
          }
        }
        if (accountId) {
          clearStoredDraft(accountId)
          bindAccountDraft(accountId, null)
          const stashed = formStashRef.current[accountId]
          if (stashed) {
            stashed.saveOutcome = 'idle'
            stashed.savedFingerprint = null
            stashed.savedAt = null
            stashed.publishedDefinitionId = null
            stashed.previewCount = null
            stashed.previewFailed = false
          }
        }
        if (selectedAccountRef.current === accountId) {
          setSaveOutcome('idle')
          setSavedFingerprint(null)
          setSavedAt(null)
          setPublishedRuleId(null)
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
        /*
         * R490: 公開の POST まで進んだ後の通信切れは、成功か失敗か分からない。
         * 同じ操作を繰り返す前に一覧で公開済みか確かめるよう案内する。
         */
        if (activate && publishAttempted && publishDraftId
          && !(caught instanceof ApiError && (caught.status === 404 || caught.status === 409))) {
          setError('通信が切れて結果が分かりませんでした。公開されているか一覧で確認してから、もう一度お試しください。')
        } else {
          setError(
            caught instanceof ApiError || caught instanceof Error
              ? caught.message
              : '保存できませんでした',
          )
        }
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
      const refs = detail.data.commonActionRefs ?? []
      const described = describeDraftActions(
        detail.data.actions, refs, detail.data.commonActionVersions ?? {},
      )
      /*
       * R486: 使う版・中身が確かめられない共通アクションがあるときは
       * 確認画面を開かない。「見ていないものを送る」を防ぐ。
       */
      if (described.unconfirmed || refs.some((ref) => !ref.versionId)) {
        setError('共通アクションの内容を確認できませんでした。編集を開き直して確かめてから、もう一度試してください')
        return
      }
      setTestConfirmation({
        accountId,
        draftId: draft.id,
        draftVersionId: detail.data.draftVersionId,
        fingerprint: draftFingerprint(detail.data),
        actionsFingerprint: canonicalJson(detail.data.actions),
        friendId,
        contents: described.contents,
        effects: described.effects,
        // R487: 確認時に見せた版の一式。実行前の照合へそのまま渡す。
        commonActionExpectations: refs.map((ref) => ({
          stepId: ref.stepId,
          commonActionId: ref.commonActionId,
          versionId: ref.versionId ?? '',
        })),
        // R484: 確認を開くたびに新しい鍵。同じ確認の再試行だけが同じ鍵。
        operationKey: newOperationKey(),
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
  /**
   * R488: 受け付けた実行の状態を読み直す。待機が終わっていれば終わった
   * 状態に変わる。店が替わっていたら書かない。
   */
  const refreshTestRun = async (record: TestRunRecord, accountId: string): Promise<void> => {
    try {
      const detail = await api.automations.getRun(record.runId)
      if (!detail.success) return
      if (selectedAccountRef.current !== accountId) return
      const next = { ...record, status: detail.data.status }
      setTestRun((current) => current && current.runId === record.runId ? next : current)
      const stashed = formStashRef.current[accountId]
      if (stashed?.testRun?.runId === record.runId) stashed.testRun = next
    } catch {
      // 読み直しの失敗は黙る。古い状態のまま残し、押せばまた読める。
    }
  }

  const runOnePersonTest = async () => {
    const pending = testConfirmation
    if (!pending || testRunningRef.current) return
    testRunningRef.current = true
    // R485: 送信前の読み取りに番号を付ける。「やめる」で番号が進んだら、
    // 遅れて返っても送信へ進まない。
    const ticket = testTicketRef.current + 1
    testTicketRef.current = ticket
    setTesting(true)
    setError('')
    const sameAccount = () => selectedAccountRef.current === pending.accountId
    try {
      const latest = await api.automations.getDraft(pending.draftId, pending.accountId)
      if (!latest.success) throw new Error(latest.error)
      /*
       * R487: 下書きの版と中身に加え、確認した共通アクションの版も
       * いま解決されるものと照合する。束の切り替えは版の札を変えないので、
       * ここで先に気づけば Worker へ送る前に止められる（最後の砦は Worker）。
       */
      const latestRefs = latest.data.commonActionRefs ?? []
      const commonActionsUnchanged = latestRefs.length === pending.commonActionExpectations.length
        && pending.commonActionExpectations.every((expected) => {
          const current = latestRefs.find((ref) => ref.stepId === expected.stepId)
          return current?.commonActionId === expected.commonActionId
            && current?.versionId === expected.versionId
        })
      if (
        latest.data.draftVersionId !== pending.draftVersionId
        || draftFingerprint(latest.data) !== pending.fingerprint
        || !commonActionsUnchanged
      ) {
        if (sameAccount()) {
          setTestConfirmation(null)
          setError('確認したあとに下書きが変わりました。送っていません。もう一度、送る内容を確認してください')
        }
        return
      }
      // R485: 読み取り待ちに「やめる」を押されていたら送らない。
      if (ticket !== testTicketRef.current) return
      const result = await api.automations.test(
        pending.draftId, pending.accountId, pending.friendId, pending.draftVersionId,
        pending.operationKey, pending.commonActionExpectations,
      )
      if (!result.success) throw new Error(result.error)
      if (!sameAccount()) {
        /*
         * 第145回: 待っている間に店を替えたら、前の店の成否をこの画面へ
         * 書かない。ただし実行は要求IDで読み直せるよう控える。
         */
        const stashed = formStashRef.current[pending.accountId]
        if (stashed) {
          stashed.testRun = {
            runId: result.data.runId, status: result.data.status,
            accountId: pending.accountId, at: Date.now(),
          }
        }
        return
      }
      setTestConfirmation(null)
      const record: TestRunRecord = {
        runId: result.data.runId, status: result.data.status,
        accountId: pending.accountId, at: Date.now(),
      }
      setTestRun(record)
      const stashed = formStashRef.current[pending.accountId]
      if (stashed) stashed.testRun = record
      setNotice(`1人テストを受け付けました（${testRunStatusLabel(result.data.status)}）。結果は下の実行から確認できます。`)
    } catch (caught) {
      // 待っている間に店を替えたら、前の店の成否をこの画面へ書かない。
      if (!sameAccount()) return
      // R485: 取りやめた後の失敗は出さない。送っていないので黙って閉じる。
      if (ticket !== testTicketRef.current) {
        setTestConfirmation(null)
        return
      }
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
    if (chrome === 'draft') {
      router.push(`${resumeBase}?id=${encodeURIComponent(storedDraftHint.id)}`)
    } else {
      router.push(`${resumeBase}?draft=${encodeURIComponent(storedDraftHint.id)}`)
    }
    setResumeTarget(storedDraftHint.id)
  }

  // `?draft=` を読み終わるまで描かない。一瞬だけ空の新規画面が出て、
  // そのまま保存で以前の下書きを上書きする事故を防ぐ。
  if (resumeTarget === undefined) return null

  const nodeId = chrome === 'draft' ? 'J1VA8' : 'M4torY'
  const backHref = chrome === 'draft' ? '/automations?tab=templates' : '/automations'
  const backLabel = chrome === 'draft' ? '← 見本へ' : '← オートメーションへ'
  const headDescription = chrome === 'draft'
    ? '見本に実データは入っていません。このアカウントで使うタグやシナリオを選び、下書きとして保存します。'
    : 'きっかけ・だれに・何をするかを決めます。1人で試してから動かすと、まちがいを防げます。'
  /* 版の番号：M4torY は付けず、J1VA8 だけ「1. / 2. / 3.」を付ける。 */
  const stepNo = (n: number) => (chrome === 'draft' ? `${n}. ` : '')
  /* つながる先：選んだ処理が指す名前を、読み込んだ選択肢から引く。 */
  const usedTagNames = actions
    .filter((row) => row.type === 'add_tag' && row.tagId)
    .map((row) => tags.find((tag) => tag.id === row.tagId)?.name ?? '選んだタグ')
  const usedScenarioNames = actions
    .filter((row) => row.type === 'start_scenario' && row.scenarioId)
    .map((row) => scenarios.find((item) => item.id === row.scenarioId)?.name ?? '選んだシナリオ')
  const usedCommonActionNames = actions
    .filter((row) => row.type === 'common_action' && row.commonActionId)
    .map((row) => commonActions.find((item) => item.id === row.commonActionId)?.name ?? '選んだ共通アクション')

  return (
    <div data-design-node={nodeId}>
      <div className={styles.head}>
        <div className={styles.headText}>
          <Link href={backHref} className={styles.backLink}>{backLabel}</Link>
          <h1 className={styles.headTitle}>{chrome === 'draft' ? '下書きを仕上げる' : 'ルールを作る'}</h1>
          <p className={styles.headDescription}>{headDescription}</p>
        </div>
      </div>

      {chrome === 'draft' ? (
        <p className={styles.infoBand} role="note">
          見本から作った下書きです。タグとテンプレートを、このアカウントのものに選び直してください。
        </p>
      ) : null}

      {/*
        tJqST: ほかの人が先に保存していた。自分の入力は残したまま、
        このまま保存すると相手の変更が消えることを帯で知らせる。
      */}
      {conflict ? (
        <div className={styles.conflictBand} role="alert">
          <p className={styles.conflictTitle}>ほかの人がこの下書きを保存しました</p>
          <p className={styles.footnote}>このまま保存すると、相手の変更が消えます。先に内容を比べてください。</p>
          <div className={styles.toolbar}>
            <Button variant="secondary" size="compact" onClick={() => setCompareOpen(true)}>違いを比べる</Button>
            <Button variant="secondary" size="compact" onClick={() => void reloadServerDraft()}>最新を読み込んで続ける</Button>
          </div>
        </div>
      ) : null}

      {storedDraftHint && !savedDraft && resumeTarget === null && chrome === 'create' ? (
        <div className={styles.infoBand} role="note">
          <span>前にこのアカウントで保存した下書きがあります。このまま入力すると、別の新しいルールになります。</span>
          <Button variant="secondary" size="compact" onClick={openStoredDraft}>
            保存した下書きを開く
          </Button>
        </div>
      ) : null}

      <div className={styles.columns}>
        <div className={styles.main}>
          <section className={styles.formCard} aria-label="名前">
            <h2 className={styles.formTitle}>{stepNo(1)}名前</h2>
            <p className={styles.footnote}>一覧で見分けるための名前。お客さまには見えません</p>
            <label className={styles.fieldLabel} htmlFor="v8-rule-name">
              名前
              <TextField
                id="v8-rule-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="例：「予約」と送られたら担当へ知らせる"
                maxLength={120}
              />
            </label>
          </section>

          <section className={styles.formCard} aria-label="どんなときに動かしますか">
            <h2 className={styles.formTitle}>{stepNo(2)}どんなときに動かしますか</h2>
            <div>
              <TextField
                aria-label="きっかけを探す"
                type="search"
                value={eventQuery}
                onChange={(e) => setEventQuery(e.target.value)}
                placeholder="きっかけを言葉で探す（例：予約・タグ・時刻）"
              />
            </div>
            {triggerEventGroups.map((group) => group.events.length === 0 ? null : (
              <div key={group.id}>
                <p className={styles.groupLabel}>{group.label}</p>
                <div className={styles.triggerGrid}>
                  {group.events.map((event) => (
                    <button
                      key={event.value}
                      type="button"
                      className={eventType === event.value ? `${styles.triggerCard} ${styles.triggerCardSelected}` : styles.triggerCard}
                      aria-pressed={eventType === event.value}
                      onClick={() => setEventType(event.value)}
                    >
                      <span className={styles.triggerName}>{event.label}</span>
                      <span className={styles.triggerNote}>{event.note}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {matchedEvents && matchedEvents.length === 0 ? (
              <p className={styles.footnote}>合うきっかけがありません。言葉を変えるか、すべてのきっかけから選んでください。</p>
            ) : null}
            {!normalizedEventQuery && !expandedEvents ? (
              <div>
                <Button variant="secondary" size="compact" onClick={() => setShowAllEvents(true)}>
                  ほかのきっかけもすべて見る（あと{EVENTS.length - REPRESENTATIVE_TRIGGER_EVENTS.length}件）
                </Button>
              </div>
            ) : null}

            {['tag_change', 'form_submitted', 'link_clicked', 'calendar_booked', 'datetime', 'daily', 'weekly'].includes(eventType) ? (
              <div className={styles.subBox}>
                <p className={styles.groupLabel}>きっかけの詳しい設定</p>
                <div className={styles.formGrid}>
                  {eventType === 'tag_change' ? <Select aria-label="きっかけのタグ" value={String(triggerConfig.tagId ?? '')} onChange={(value) => setTriggerConfig({ ...triggerConfig, tagId: value })} options={[{ value: '', label: 'どのタグか選ぶ' }, ...tags.map((tag) => ({ value: tag.id, label: tag.name }))]} size="standard" /> : null}
                  {eventType === 'tag_change' ? <Select aria-label="付いたとき・外れたとき" value={String(triggerConfig.action ?? 'add')} onChange={(value) => setTriggerConfig({ ...triggerConfig, action: value })} options={[{ value: 'add', label: '付いたとき' }, { value: 'remove', label: '外れたとき' }]} size="standard" /> : null}
                  {eventType === 'form_submitted' ? <TextField aria-label="回答フォーム" placeholder="フォームID（空欄ならすべて）" value={String(triggerConfig.formId ?? '')} onChange={(e) => setTriggerConfig({ formId: e.target.value })} /> : null}
                  {eventType === 'link_clicked' ? <TextField aria-label="計測リンク" placeholder="計測リンクID（空欄ならすべて）" value={String(triggerConfig.trackedLinkId ?? '')} onChange={(e) => setTriggerConfig({ trackedLinkId: e.target.value })} /> : null}
                  {eventType === 'calendar_booked' ? <Select aria-label="予約の種類" value={String(triggerConfig.bookingType ?? '')} onChange={(value) => setTriggerConfig({ ...triggerConfig, bookingType: value })} options={[{ value: '', label: 'すべての予約' }, { value: 'salon', label: 'サロン予約' }, { value: 'event', label: 'イベント予約' }]} size="standard" /> : null}
                  {eventType === 'calendar_booked' && triggerConfig.bookingType !== 'event' ? <TextField aria-label="予約メニュー" placeholder="メニューID（空欄ならすべて）" value={String(triggerConfig.menuId ?? '')} onChange={(e) => setTriggerConfig({ menuId: e.target.value })} /> : null}
                  {eventType === 'calendar_booked' && triggerConfig.bookingType === 'event' ? <TextField aria-label="対象イベント" placeholder="イベントID（空欄ならすべて）" value={String(triggerConfig.eventId ?? '')} onChange={(e) => setTriggerConfig({ eventId: e.target.value })} /> : null}
                  {eventType === 'datetime' ? <DateTimeField aria-label="実行日時" value={String(triggerConfig.at ?? '')} onChange={(v) => setTriggerConfig({ ...triggerConfig, at: v })} /> : null}
                  {eventType === 'weekly' ? (
                    <WeekdaySelect
                      value={triggerConfig.weekdays as ReadonlyArray<number>}
                      time={String(triggerConfig.time ?? '')}
                      onChange={(days) => setTriggerConfig({ ...triggerConfig, weekdays: days })}
                    />
                  ) : null}
                  {eventType === 'daily' || eventType === 'weekly' ? <TimeField aria-label="実行時刻" step={300} value={String(triggerConfig.time ?? '')} onChange={(v) => setTriggerConfig({ ...triggerConfig, time: v })} /> : null}
                  {eventType === 'datetime' || eventType === 'daily' || eventType === 'weekly' ? (
                    <FriendMultiSelect
                      accountId={selectedAccountId ?? null}
                      selectedIds={normalizeFriendIds(triggerConfig.friendIds)}
                      names={friendNamesOf(triggerConfig)}
                      onChange={(ids, nextNames) => setTriggerConfig({ ...triggerConfig, friendIds: ids, friendNames: nextNames })}
                    />
                  ) : null}
                </div>
                <p className={styles.footnote}>{triggerConfigSummary}。保存後も設定を確認できます。</p>
              </div>
            ) : null}
          </section>

          <section className={styles.formCard} aria-label="だれに動かしますか">
            <h2 className={styles.formTitle}>{stepNo(2)}だれに動かしますか</h2>
            <p className={styles.footnote}>条件を付けないと、きっかけに当てはまった人全員に動きます。</p>
            {usesKeyword ? (
              <label className={styles.fieldLabel} htmlFor="v8-rule-keyword">
                含まれる言葉
                <TextField
                  id="v8-rule-keyword"
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                  placeholder="例：予約"
                  maxLength={100}
                />
              </label>
            ) : null}
            {usesKeyword && keyword.trim() ? (
              <p className={styles.footnote}>空欄なら、どんな内容でも動きます。</p>
            ) : null}
            <div className={styles.pillRow} aria-label="いまの条件">
              {usesKeyword && keyword.trim() ? (
                <span className={styles.pillStatic}>「{keyword.trim()}」を含む</span>
              ) : null}
              {conditionSummaries.map((text, index) => (
                <span key={`${index}-${text}`} className={styles.pillStatic}>{text}</span>
              ))}
              {!((usesKeyword && keyword.trim()) || conditionSummaries.length > 0) ? (
                <span className={styles.pillStatic}>条件なし</span>
              ) : null}
            </div>
            {conditionUnreadable ? (
              <div className={styles.subBox} role="alert">
                <p className={styles.formTitle}>保存されていた条件は読めませんでした</p>
                <p className={styles.footnote}>
                  以前の画面が別の形で保存した条件です。このままでは人数を数えられないため、保存できません。
                  以前の条件を外してもよければ、下のボタンから付け直せます。
                </p>
                <div>
                  <Button variant="secondary" size="compact" onClick={() => setConditionUnreadable(false)}>
                    以前の条件を外して付け直す
                  </Button>
                </div>
              </div>
            ) : (
              <div>
                <ConditionBuilder
                  value={condition}
                  onChange={setCondition}
                  label="このルールで動かす相手"
                  showCount={false}
                />
                <p className={styles.footnote}>標準互換（15軸）。一斉配信やシナリオと同じ条件です。</p>
              </div>
            )}
          </section>

          <section className={styles.formCard} aria-label="何をするか">
            <h2 className={styles.formTitle}>{stepNo(3)}何をするか</h2>
            <p className={styles.footnote}>上から順に動きます</p>
            <ol className={styles.actionList}>
              {actions.map((row, index) => (
                <li key={row.key} className={styles.actionRow}>
                  <span className={styles.actionNum}>{index + 1}</span>
                  <div className={styles.actionBody}>
                    <label className={styles.fieldLabel} htmlFor={`v8-action-${row.key}`}>
                      {actionRowTitle(row.type)}
                      <Select
                        id={`v8-action-${row.key}`}
                        aria-label="すること"
                        value={row.type}
                        onChange={(value) => updateAction(row.key, { type: value as ActionType })}
                        options={ACTIONS.map((action) => ({ value: action.value, label: action.label }))}
                        size="standard"
                      />
                    </label>
                    {row.type === 'add_tag' ? (
                      <V8ResourcePickRow
                        title="付けるタグ"
                        id={`v8-tag-${row.key}`}
                        selectLabel="自動化で付けるタグ"
                        value={row.tagId}
                        onPick={(value) => updateAction(row.key, { tagId: value })}
                        options={tags.map((tag) => ({ value: tag.id, label: tag.name }))}
                        loading={tagsLoading}
                        failed={tagsFailed}
                        failedNote="タグを読み込めませんでした。画面を再読み込みしてください。"
                      />
                    ) : row.type === 'start_scenario' ? (
                      <V8ResourcePickRow
                        title="始めるシナリオ"
                        id={`v8-scenario-${row.key}`}
                        selectLabel="自動化で始めるシナリオ"
                        value={row.scenarioId}
                        onPick={(value) => updateAction(row.key, { scenarioId: value })}
                        options={scenarios.map((scenario) => ({ value: scenario.id, label: scenario.name }))}
                        loading={tagsLoading}
                        failed={tagsFailed}
                        failedNote="シナリオを読み込めませんでした。画面を再読み込みしてください。"
                      />
                    ) : row.type === 'common_action' ? (
                      <V8ResourcePickRow
                        title="使う共通アクション"
                        id={`v8-common-action-${row.key}`}
                        selectLabel="自動化で使う共通アクション"
                        value={row.commonActionId}
                        onPick={(value) => updateAction(row.key, { commonActionId: value })}
                        options={commonActions.map((item) => ({ value: item.id, label: item.name }))}
                        loading={tagsLoading}
                        failed={tagsFailed}
                        failedNote="共通アクションを読み込めませんでした。画面を再読み込みしてください。"
                      />
                    ) : (
                      <label className={styles.fieldLabel} htmlFor={`v8-message-${row.key}`}>
                        送る文面
                        <TextArea
                          id={`v8-message-${row.key}`}
                          value={row.message}
                          onChange={(event) => updateAction(row.key, { message: event.target.value })}
                        />
                      </label>
                    )}
                    <p className={styles.footnote}>
                      失敗したとき：現在はここで止まります。「次の処理へ進む」は実行基盤の接続後に選べます。
                    </p>
                  </div>
                  <button
                    type="button"
                    className={styles.miniMenuButton}
                    aria-label={`${index + 1}つめの処理の操作`}
                    disabled={actions.length === 1}
                    onClick={() => setActions((current) => current.filter((item) => item.key !== row.key))}
                    title={actions.length === 1 ? '最後の1つは消せません' : 'この動きを削除する'}
                  >
                    …
                  </button>
                </li>
              ))}
            </ol>
            <div className={styles.toolbar}>
              <Button variant="secondary" size="compact" onClick={() => setActions((current) => [...current, newActionDraft()])}>
                ＋ することを足す
              </Button>
            </div>
          </section>

          {error ? <p className={styles.stepError} role="alert">{error}</p> : null}
          {resumeTarget && resumeStatus === 'failed' ? (
            <div className={styles.toolbar}>
              <Button variant="secondary" size="compact" onClick={retryResume}>
                下書きをもう一度読み込む
              </Button>
              {resumeErrorKind !== 'network' ? (
                <Button variant="secondary" size="compact" onClick={restartFresh}>
                  白紙から作り直す
                </Button>
              ) : null}
            </div>
          ) : null}
          {notice ? <p className={styles.footnote} role="status">{notice}</p> : null}
          {canManage === false ? (
            <p className={styles.stepError} role="alert">
              操作する権限がありません。オーナーか管理者に依頼してください。
            </p>
          ) : null}
        </div>

        <aside className={styles.rail} aria-label="決めごとの確認">
          <section className={styles.formCard}>
            <h2 className={styles.formTitle}>いまの決めごとを文章にすると</h2>
            <p className={styles.footnote}>
              {selectedEvent.label}、{targetSummary}{actionSummary || '処理を実行します'}。
            </p>
            <p className={styles.footnote}>
              「こうなったら、こうする」を決めておくと、あとは自動で動きます。
              この文章のとおりに動きます。おかしいと感じたら、左の3つを見直してください。
            </p>
          </section>

          <section className={styles.formCard}>
            <h2 className={styles.formTitle}>当てはまりそうな人数</h2>
            <dl className={styles.kvList}>
              <div className={styles.kvRow}>
                <dt className={styles.kvKey}>人数</dt>
                <dd className={styles.kvValue}>{previewCount === null ? '—' : `${formatNumber(previewCount)}人`}</dd>
              </div>
            </dl>
            <p className={styles.footnote}>
              {previewFailed
                ? '人数を数えられませんでした。下書きは保存されています。'
                : previewCount === null
                  ? '下書きを保存すると、いまの条件で数えます。'
                  : '保存した条件を、選択中のLINEアカウントで数えた結果です。'}
            </p>
            {previewFailed && savedDraft && selectedAccountId ? (
              <div>
                <Button
                  variant="secondary"
                  size="compact"
                  disabled={previewRefreshing}
                  onClick={() => void refreshAudiencePreview(selectedAccountId, savedDraft)} busy={previewRefreshing} busyLabel="数え直しています">人数をもう一度数える
                </Button>
              </div>
            ) : null}
            <div className={styles.formGrid}>
              <TextField aria-label="1人テストの友だちID" value={testFriendId} onChange={(event) => setTestFriendId(event.target.value)} placeholder="試す友だちID" />
              <div>
                <Button
                  variant="secondary"
                  size="compact"
                  onClick={() => void askOnePersonTest()}
                  disabled={saving || testing || preparingTest || !savedDraft || !testFriendId.trim()} busy={preparingTest} busyLabel="確認中...">1人で試す
                </Button>
              </div>
              <p className={styles.footnote}>保存した時点の内容で試します。変えた後は保存し直してから試してください。</p>
            </div>
            {testConfirmation ? (
              <div className={styles.subBox} role="dialog" aria-label="1人テストの確認">
                <p className={styles.formTitle}>送る前に確認してください</p>
                <p className={styles.footnote}>送り先：{testConfirmation.friendId}</p>
                <div className={styles.footnote}>
                  <p>送る内容：</p>
                  <ul className={styles.noteList}>
                    {testConfirmation.contents.map((content, index) => <li key={`${index}-${content}`}>{content}</li>)}
                  </ul>
                </div>
                <p className={styles.footnote}>起きること：{testConfirmation.effects.join('、')}。取り消せません。</p>
                {canonicalJson(draftActions()) !== testConfirmation.actionsFingerprint ? (
                  <p className={styles.footnote}>画面の入力は、ここに出ている内容と違います。送られるのは、保存済みのこの内容です。</p>
                ) : null}
                <div className={styles.toolbar}>
                  <Button
                    variant="secondary"
                    size="compact"
                    onClick={() => {
                      testTicketRef.current += 1
                      setTestConfirmation(null)
                    }}
                  >
                    キャンセル
                  </Button>
                  <Button
                    variant="primary"
                    size="compact"
                    disabled={testing}
                    onClick={() => void runOnePersonTest()} busy={testing} busyLabel="送信中...">この内容で送る
                  </Button>
                </div>
              </div>
            ) : null}
            {testRun ? (
              <div className={styles.subBox} aria-label="1人テストの実行">
                <p className={styles.formTitle}>試した実行：{testRunStatusLabel(testRun.status)}</p>
                <div className={styles.toolbar}>
                  <Button
                    variant="secondary"
                    size="compact"
                    onClick={() => router.push(`/automations/runs?run=${encodeURIComponent(testRun.runId)}`)}
                  >
                    実行の結果を見る
                  </Button>
                  <Button
                    variant="secondary"
                    size="compact"
                    disabled={testing}
                    onClick={() => void refreshTestRun(testRun, testRun.accountId)}
                  >
                    結果を読み直す
                  </Button>
                </div>
              </div>
            ) : null}
            {saveOutcome === 'published' && publishedRuleId ? (
              <div className={styles.subBox} aria-label="公開済みの案内">
                <p className={styles.formTitle}>この内容はすでに公開済みです</p>
                <div className={styles.toolbar}>
                  <Button
                    variant="secondary"
                    size="compact"
                    onClick={() => router.push(`/automations?highlight=${publishedRuleId}`)}
                  >
                    公開したルールを見る
                  </Button>
                </div>
              </div>
            ) : null}
          </section>

          <section className={styles.formCard}>
            <h2 className={styles.formTitle}>気をつけること</h2>
            <ul className={styles.noteList}>
              <li>
                同じきっかけのルールが2つあると、両方動きます
                {hasSameTrigger ? '（同じきっかけのルールが他にもあります。一覧で確かめてください）' : ''}
              </li>
              <li>止めると、そのあとのきっかけでは動きません</li>
              <li>友だちになったときは、ブロック解除では動きません</li>
            </ul>
          </section>

          <section className={styles.formCard}>
            <h2 className={styles.formTitle}>つながる先</h2>
            <dl className={styles.kvList}>
              <div className={styles.kvRow}>
                <dt className={styles.kvKey}>タグ</dt>
                <dd className={styles.kvValue}>{usedTagNames.length > 0 ? usedTagNames.join('、') : 'なし'}</dd>
              </div>
              <div className={styles.kvRow}>
                <dt className={styles.kvKey}>シナリオ</dt>
                <dd className={styles.kvValue}>{usedScenarioNames.length > 0 ? usedScenarioNames.join('、') : 'なし'}</dd>
              </div>
              <div className={styles.kvRow}>
                <dt className={styles.kvKey}>共通アクション</dt>
                <dd className={styles.kvValue}>{usedCommonActionNames.length > 0 ? usedCommonActionNames.join('、') : 'なし'}</dd>
              </div>
            </dl>
          </section>
        </aside>
      </div>

      <StickyBar
        status={saveStatusText}
        actions={(
          <>
            <Button href={chrome === 'draft' ? '/automations?tab=templates' : '/automations'}>キャンセル</Button>
            <Button
              variant="secondary"
              disabled={saving || Boolean(blockedReason)}
              onClick={() => void save(false)}
            >
              下書きを保存する
            </Button>
            {conflict ? (
              <Button variant="primary" onClick={() => setCompareOpen(true)}>
                比べてから保存
              </Button>
            ) : (
              <Button
                variant="primary"
                disabled={saving || Boolean(blockedReason)}
                busy={saving}
                busyLabel="作成中..."
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
              </Button>
            )}
          </>
        )}
      />

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
        <dl className={styles.kvList}>
          <div className={styles.kvRow}>
            <dt className={styles.kvKey}>名前</dt>
            <dd className={styles.kvValue}>{name.trim()}</dd>
          </div>
          <div className={styles.kvRow}>
            <dt className={styles.kvKey}>きっかけ</dt>
            <dd className={styles.kvValue}>{selectedEvent.label}（{triggerConfigSummary}）</dd>
          </div>
          <div className={styles.kvRow}>
            <dt className={styles.kvKey}>だれに</dt>
            <dd className={styles.kvValue}>
              {targetSummary}
              {previewCount !== null ? ` 見込み ${formatNumber(previewCount)}人` : ''}
            </dd>
          </div>
          <div className={styles.kvRow}>
            <dt className={styles.kvKey}>すること</dt>
            <dd className={styles.kvValue}>{actionSummary || '未設定'}</dd>
          </div>
          <div className={styles.kvRow}>
            <dt className={styles.kvKey}>最初に動くのは</dt>
            <dd className={styles.kvValue}>
              {['datetime', 'daily', 'weekly'].includes(eventType)
                ? `次の決めた時刻（${triggerConfigSummary}）`
                : '次にきっかけが起きたとき'}
            </dd>
          </div>
        </dl>
        <p className={styles.footnote}>
          止め方：動かし始めたあとも「オートメーション」の一覧からいつでも止められます。先に確かめたい場合は「下書きに保存」して、1人で試すこともできます。
        </p>
      </ConfirmDialog>

      {/*
        tJqST の比べる窓。左に自分のいまの入力、右に保存されている内容。
        保存されている内容で続けるか、自分の内容で上書きするかを選ぶ。
      */}
      <Dialog
        open={compareOpen && Boolean(conflict)}
        title="内容を比べる"
        description="左があなたのいまの入力、右が保存されている内容です。"
        confirmLabel="この内容で保存する"
        cancelLabel="閉じる"
        busy={saving}
        onCancel={() => setCompareOpen(false)}
        onConfirm={() => {
          setCompareOpen(false)
          void save(false, true)
        }}
      >
        {conflict ? (
          <div>
            <div className={styles.detailGrid}>
              <section className={styles.detailCell}>
                <p className={styles.detailLabel}>あなたの入力</p>
                <p className={styles.detailValue}>{name.trim() || '（名前なし）'}</p>
                <p className={styles.footnote}>{selectedEvent.label}</p>
                <p className={styles.footnote}>{actionSummary || '処理未設定'}</p>
              </section>
              <section className={styles.detailCell}>
                <p className={styles.detailLabel}>保存されている内容</p>
                <p className={styles.detailValue}>{conflict.serverName || '（名前なし）'}</p>
                <p className={styles.footnote}>{conflict.serverEventLabel}</p>
                <p className={styles.footnote}>処理 {conflict.serverActionCount}件</p>
              </section>
            </div>
            <p className={styles.footnote}>
              「この内容で保存する」と、相手の変更はあなたの内容で上書きされます。
              相手の内容で続けるときは、窓を閉じて「最新を読み込んで続ける」を押してください。
            </p>
          </div>
        ) : null}
      </Dialog>
    </div>
  )
}

/* することの行の見出し（行の種類が変わっても番号は動かない）。 */
function actionRowTitle(type: string): string {
  if (type === 'add_tag') return 'タグを付ける'
  if (type === 'start_scenario') return 'シナリオを始める'
  if (type === 'common_action') return '共通アクションを使う'
  return 'メッセージを送る'
}

/* きっかけ・処理で使う選択肢の行（v7 の ResourcePickRow と同じ口）。 */
function V8ResourcePickRow(props: {
  title: string
  id: string
  selectLabel: string
  value: string
  onPick: (value: string) => void
  options: Array<{ value: string; label: string }>
  loading: boolean
  failed: boolean
  failedNote: string
}) {
  const { title, id, selectLabel, value, onPick, options, loading, failed, failedNote } = props
  return (
    <div className={styles.formGrid}>
      <label className={styles.fieldLabel} htmlFor={id}>
        {title}
        <Select
          id={id}
          value={value}
          disabled={loading || failed}
          onChange={(picked) => onPick(picked)}
          aria-label={selectLabel}
          size="standard"
          options={[
            { value: '', label: '— 選んでください —' },
            ...options.map((option) => ({ value: option.value, label: option.label })),
          ]}
        />
      </label>
      {loading ? <p className={styles.footnote}>読み込んでいます</p> : null}
      {failed ? <p className={styles.footnote}>{failedNote}</p> : null}
    </div>
  )
}
