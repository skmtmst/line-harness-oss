'use client'

import SelectField from '@/components/shared/select-field'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import type { Automation } from '@line-crm/shared'
import { api, ApiError, type AutomationDraftAction, type AutomationDraftDetail } from '@/lib/api'
import Breadcrumb from '@/components/shared/breadcrumb'
import StickyBar from '@/components/shared/sticky-bar'
import { TextArea, TextField } from '@/components/shared/text-field'
import { CareCard, FeatureLinkCard } from '@/components/shared/side-cards'
import { usePageTitle } from '@/components/shell/page-chrome'
import { useAccount } from '@/contexts/account-context'
// APIの owner/admin 制約は共通アクションと同じ（`requireRole('owner','admin')`）。
// 同じ判定を2つ持つと、片方だけ直したときに画面ごとに食い違う。
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
 * 画面に出すきっかけ。
 *
 * **実際に発火するものだけを並べる。** `apps/worker/src/services/event-bus.ts`
 * の `fireEvent` 呼び出し元と、`processAutomations` の完全一致で決まる。
 * 以前ここには `friend_added` `tag_added` `form_submitted` `link_clicked` が
 * 並んでいたが、どれも `AutomationEventType` に無い値で、保存はできても
 * 一度も動かない。V6は「実装されていない選択肢を表示しない」と決めている
 * （`docs/v6-requirements/v6-25-automation-requirements-draft.md` §4-2・§11）。
 */
const EVENTS: ReadonlyArray<{ value: Automation['eventType']; label: string; note: string }> = [
  {
    value: 'message_received',
    label: 'メッセージを受け取ったとき',
    note: '友だちからのトークが届いたとき。含まれる言葉で絞れます。',
  },
  {
    value: 'friend_add',
    label: '友だちになったとき',
    note: '友だち追加のとき。ブロック解除では動きません。',
  },
  {
    value: 'tag_change',
    label: 'タグが付いた・外れたとき',
    note: '選んだタグが付いたとき・外れたときに動きます。下でどちらかを選びます。',
  },
  { value: 'form_submitted', label: 'フォームに回答したとき', note: '回答が保存されたとき。フォームを指定できます。' },
  { value: 'ec.order.confirmed', label: '注文が確定したとき', note: 'EC連携で注文確定が記録された人に動きます。' },
  { value: 'datetime', label: '決めた時刻になったとき', note: '一度だけ・毎日・毎週から選び、5分刻みで動きます。' },
]

/** 言葉で絞れるきっかけ。ほかは本文を持たないので条件欄を出さない。 */
const KEYWORD_EVENTS: ReadonlyArray<string> = ['message_received']

const CONDITION_AXES = [
  ['tag_exists', 'タグを持っている'], ['tag_not_exists', 'タグを持っていない'],
  ['is_following', '友だち状態'], ['name', '名前'], ['private_memo', '個人メモ'],
  ['status_message', 'ステータスメッセージ'], ['registered_at', '登録日'],
  ['support_mark', '対応マーク'], ['is_hidden', '非表示状態'], ['friend_field', '友だち情報欄'],
  ['scenario_subscribed', 'シナリオ購読'], ['scenario_state', 'シナリオ状態'],
  ['form_answered', 'フォーム回答'], ['last_reaction_at', '最終反応日'], ['score_range', '行動スコア'],
] as const

/**
 * 画面に出す「すること」。
 *
 * `executeAction` が実行できるもののうち、選ぶ一覧をこの画面が読めるものだけ。
 * `start_scenario` `remove_tag` `send_webhook` `switch_rich_menu` は実行側には
 * あるが、選択肢（シナリオ・Webhook・リッチメニュー）を読んでいないので、
 * 出しても選べない。読む口を足すときに一緒に増やす。
 */
const ACTIONS = [
  { value: 'add_tag', label: 'タグを付ける' },
  { value: 'send_message', label: 'メッセージを送る' },
] as const

type ActionType = (typeof ACTIONS)[number]['value']

interface ActionDraft {
  /** 行を取り違えないための、画面の中だけの番号。 */
  key: number
  type: ActionType
  tagId: string
  message: string
}

let actionKeySeed = 0
const newActionDraft = (): ActionDraft => ({
  key: ++actionKeySeed,
  type: 'add_tag',
  tagId: '',
  message: '',
})

/**
 * 作りかけの下書きの控え（N-357）。
 *
 * 保存した下書きの番号は画面の記憶（`savedDraft`）にしか無かったので、
 * 再読込や「戻る」で消え、保存のたびに新しい下書きが増えていた。
 * ブラウザに控えておき、同じ店のときだけ再利用する。
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

export default function NewAutomationPage() {
  usePageTitle('ルールを作る')
  const router = useRouter()
  const { selectedAccountId } = useAccount()
  const canManage = useCanManageCommonActions()
  const [name, setName] = useState('')
  const [eventType, setEventType] = useState<string>(EVENTS[0].value)
  const [keyword, setKeyword] = useState('')
  const [conditionType, setConditionType] = useState<(typeof CONDITION_AXES)[number][0] | ''>('')
  const [conditionValue, setConditionValue] = useState('')
  const [triggerConfig, setTriggerConfig] = useState<Record<string, unknown>>({})
  const [scheduleType, setScheduleType] = useState<'datetime' | 'daily' | 'weekly'>('datetime')
  const [savedDraft, setSavedDraft] = useState<StoredDraft | null>(null)
  const [previewCount, setPreviewCount] = useState<number | null>(null)
  const [testFriendId, setTestFriendId] = useState('')
  const [actions, setActions] = useState<ActionDraft[]>([newActionDraft()])
  const [tags, setTags] = useState<Array<{ id: string; name: string }>>([])
  const [tagsLoading, setTagsLoading] = useState(true)
  const [tagsFailed, setTagsFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [preparingTest, setPreparingTest] = useState(false)
  const [testConfirmation, setTestConfirmation] = useState<TestConfirmation | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [existingAutomations, setExistingAutomations] = useState<Automation[]>([])
  // 画面の描き直しを待たずに二重押しを止める鍵（N-357・N-358）。
  const saveRunningRef = useRef(false)
  const testRunningRef = useRef(false)
  const prepareRunningRef = useRef(false)
  const selectedAccountRef = useRef(selectedAccountId)
  selectedAccountRef.current = selectedAccountId

  useEffect(() => {
    let cancelled = false
    setTagsLoading(true)
    setTagsFailed(false)
    if (!selectedAccountId) {
      setTags([])
      setTagsLoading(false)
      return
    }
    api.automations
      .draftResources(selectedAccountId)
      .then((res) => {
        if (cancelled) return
        if (res.success) setTags(res.data.tags)
        else setTagsFailed(true)
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

  // N-357: 再読込・「戻る」でも同じ下書きを使い回す。店が替わったら
  // 別の店の下書きを触らないよう、控えが一致するときだけ引き継ぐ。
  // 店を替えたら、前の店の確認・結果・見込み人数は残さない（N-358）。
  // 走っている途中の保存・1人テストは、返ってきても自分の店でなければ
  // 何も書かない（`selectedAccountRef` で見張る）。
  useEffect(() => {
    setPreviewCount(null)
    setError('')
    setNotice('')
    setTestConfirmation(null)
    setSavedDraft(selectedAccountId ? readStoredDraft(selectedAccountId) : null)
  }, [selectedAccountId])

  const selectedEvent = EVENTS.find((event) => event.value === eventType) ?? EVENTS[0]
  const usesKeyword = KEYWORD_EVENTS.includes(eventType)
  const hasSameTrigger = existingAutomations.some((item) => item.eventType === selectedEvent.value)
  const targetSummary = usesKeyword && keyword.trim()
    ? `「${keyword.trim()}」を含む内容を送った人に`
    : 'きっかけに当てはまった人に'
  const actionSummary = actions.map((row) => {
    if (row.type === 'add_tag') {
      const tagName = tags.find((tag) => tag.id === row.tagId)?.name
      return tagName ? `タグ「${tagName}」を付ける` : '選んだタグを付ける'
    }
    return row.message.trim() ? '入力したメッセージを送る' : 'メッセージを送る'
  }).join('、')

  /** 保存で送る「すること」。確認画面とのずれを見るときも同じ形を使う。 */
  const draftActions = (): AutomationDraftAction[] => actions.map((row, index) => (
    row.type === 'add_tag'
      ? { id: `step-${index + 1}`, type: 'add_tag' as const, params: { tagId: row.tagId }, onFailure: 'stop' as const }
      : {
          id: `step-${index + 1}`,
          type: 'send_message' as const,
          params: { messageType: 'text', content: row.message.trim() },
          onFailure: 'stop' as const,
        }
  ))

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
      return `シナリオ「${String(step.params.scenarioId ?? '')}」を始める`
    }),
    effects: [
      list.some((step) => step.type === 'send_message') ? 'メッセージが相手に届きます' : null,
      list.some((step) => step.type === 'add_tag') ? 'タグが相手に付きます' : null,
      list.some((step) => step.type === 'start_scenario') ? 'シナリオが相手に始まります' : null,
    ].filter((item): item is string => item !== null),
  })

  useEffect(() => {
    setTriggerConfig({})
  }, [eventType])

  // #519 軽: EVENTS から選べないきっかけの分岐は持たない。追加時に足す。
  const triggerConfigSummary = eventType === 'datetime'
    ? String(triggerConfig.at ?? '日時を指定')
    : eventType === 'daily' || eventType === 'weekly'
      ? String(triggerConfig.time ?? '時刻を指定')
      : eventType === 'form_submitted'
        ? String(triggerConfig.formId ?? 'すべてのフォーム')
        : ''

  const draftEventType: AutomationDraftDetail['eventType'] = eventType === 'datetime'
    ? scheduleType
    : selectedEvent.value as AutomationDraftDetail['eventType']
  const normalizedTriggerConfig = () => {
    if (draftEventType === 'message_received') return keyword.trim() ? { keyword: keyword.trim() } : {}
    if (draftEventType === 'tag_change') return {
      tagId: String(triggerConfig.tagId ?? ''),
      action: triggerConfig.action === 'remove' ? 'remove' : 'add',
    }
    if (draftEventType === 'datetime') {
      const local = String(triggerConfig.at ?? '')
      return { at: local ? new Date(`${local}:00+09:00`).toISOString() : '', friendIds: String(triggerConfig.friendIds ?? '').split(',').map((id) => id.trim()).filter(Boolean) }
    }
    if (draftEventType === 'daily' || draftEventType === 'weekly') return {
      time: String(triggerConfig.time ?? ''),
      friendIds: String(triggerConfig.friendIds ?? '').split(',').map((id) => id.trim()).filter(Boolean),
      ...(draftEventType === 'weekly' ? { weekdays: String(triggerConfig.weekdays ?? '').split(',').map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6) } : {}),
    }
    return triggerConfig
  }

  const updateAction = (key: number, patch: Partial<ActionDraft>) =>
    setActions((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)))

  const validate = (): string | null => {
    if (!name.trim()) return 'ルール名を入力してください'
    if (actions.length === 0) return 'することを1つ以上決めてください'
    for (const row of actions) {
      if (row.type === 'add_tag' && !row.tagId) return '付けるタグを選んでください'
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
    return null
  }, [canManage])

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
    try {
      if (!accountId) throw new Error('LINE公式アカウントを選んでください')
      let draft = savedDraft
      if (!draft) {
        // N-357: 再読込・「戻る」で記憶が消えていても、控えがあれば同じ下書きへ。
        draft = readStoredDraft(accountId)
      }
      if (!draft) {
        const created = await api.automations.createDraftFromTemplate('received-message-tag', accountId)
        if (!created.success) throw new Error(created.error)
        draft = created.data
        writeStoredDraft(accountId, draft)
      }
      const conditions = {
        ...(conditionType && conditionValue.trim() ? { operator: 'AND' as const, rules: [{ type: conditionType, value: conditionType === 'is_following' || conditionType === 'is_hidden' ? conditionValue.trim() === 'true' : conditionValue.trim() }] } : {}),
      }
      const res = await api.automations.updateDraft(draft.id, accountId, {
        expectedDraftVersionId: draft.draftVersionId,
        name: name.trim(),
        eventType: draftEventType,
        triggerConfig: normalizedTriggerConfig(),
        conditions,
        // すること（アクション）は { type, params } の形で持つ。
        // params の中身は type ごとに違う。
        actions: draftActions(),
      })
      if (!res.success) throw new Error(res.error)
      writeStoredDraft(accountId, draft)
      if (selectedAccountRef.current === accountId) setSavedDraft(draft)
      const preview = await api.automations.audiencePreview(draft.id, accountId, draft.draftVersionId)
      if (preview.success && selectedAccountRef.current === accountId) setPreviewCount(preview.data.matched)
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
      if (selectedAccountRef.current === accountId) router.push(`/automations?highlight=${draft.id}`)
    } catch (caught) {
      // 下書き自体が無くなっていたら控えを捨て、次は作り直す（N-357）。
      if (
        caught instanceof ApiError &&
        (caught.status === 404 || caught.status === 409 || caught.code === 'not_found' || caught.code === 'version_conflict')
      ) {
        if (accountId) clearStoredDraft(accountId)
        if (selectedAccountRef.current === accountId) setSavedDraft(null)
      }
      if (selectedAccountRef.current === accountId) {
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
        if (selectedAccountRef.current === accountId) setSavedDraft(refreshed)
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
   * **1文字でも違えば送らない**。別のタブで書き換えられていても、
   * 見せた内容と違うものが相手へ届くことはない。
   *
   * 取り直してから送るまでのごく短い間に書き換えられる可能性までは、
   * 画面側だけでは消せない（Worker に「この指紋のときだけ送る」口が無い）。
   * その口ができたら、この突き合わせをそちらへ渡す。
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

  return (
    <div data-design-node="Rv8Jv">
      <div data-design="Crumb">
        <Breadcrumb
          items={[{ label: 'オートメーション', href: '/automations' }, { label: 'ルールを作る' }]}
        />
      </div>

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
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-6">
              {EVENTS.map((event) => (
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

            <div className="mt-4 grid items-center gap-3 lg:grid-cols-3">
              <label className={styles.label} htmlFor="au-name">
                名前（あとで見分けるため）<span className={styles.required}>必須</span>
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

            {eventType === 'tag_change' || eventType === 'form_submitted' || eventType === 'datetime' ? (
              <div className="mt-4 rounded-control border border-hairline bg-canvas-sunken p-3">
                <p className="text-xs font-semibold text-ink-secondary">きっかけの詳しい設定</p>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  {eventType === 'tag_change' ? <SelectField aria-label="きっかけのタグ" value={String(triggerConfig.tagId ?? '')} onChange={(e) => setTriggerConfig({ ...triggerConfig, tagId: e.target.value })} options={[{ value: '', label: 'どのタグか選ぶ' }, ...tags.map((tag) => ({ value: tag.id, label: tag.name }))]} className={styles.select} /> : null}
                  {eventType === 'tag_change' ? <SelectField aria-label="付いたとき・外れたとき" value={String(triggerConfig.action ?? 'add')} onChange={(e) => setTriggerConfig({ ...triggerConfig, action: e.target.value })} options={[{ value: 'add', label: '付いたとき' }, { value: 'remove', label: '外れたとき' }]} className={styles.select} /> : null}
                  {eventType === 'form_submitted' ? <TextField aria-label="回答フォーム" placeholder="フォームID（空欄ならすべて）" value={String(triggerConfig.formId ?? '')} onChange={(e) => setTriggerConfig({ formId: e.target.value })} /> : null}
                  {eventType === 'datetime' ? <SelectField aria-label="時刻の繰り返し" value={scheduleType} onChange={(e) => setScheduleType(e.target.value as typeof scheduleType)} options={[{ value: 'datetime', label: '一度だけ' }, { value: 'daily', label: '毎日' }, { value: 'weekly', label: '毎週' }]} className={styles.select} /> : null}
                  {eventType === 'datetime' && scheduleType === 'datetime' ? <TextField aria-label="実行日時" type="datetime-local" value={String(triggerConfig.at ?? '')} onChange={(e) => setTriggerConfig({ ...triggerConfig, at: e.target.value })} /> : null}
                  {eventType === 'datetime' && scheduleType !== 'datetime' ? <TextField aria-label="実行時刻" type="time" step={300} value={String(triggerConfig.time ?? '')} onChange={(e) => setTriggerConfig({ ...triggerConfig, time: e.target.value })} /> : null}
                  {eventType === 'datetime' && scheduleType === 'weekly' ? <TextField aria-label="曜日" placeholder="曜日番号（例: 1,3 は月・水）" value={String(triggerConfig.weekdays ?? '')} onChange={(e) => setTriggerConfig({ ...triggerConfig, weekdays: e.target.value })} /> : null}
                  {eventType === 'datetime' ? <TextField aria-label="対象の友だち" placeholder="友だちID（複数はカンマ区切り、最大100人）" value={String(triggerConfig.friendIds ?? '')} onChange={(e) => setTriggerConfig({ ...triggerConfig, friendIds: e.target.value })} /> : null}
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
            <div className="mt-3 flex flex-wrap gap-2">
              {usesKeyword && keyword.trim() ? <span className="inline-flex min-h-9 items-center rounded-full border border-hairline bg-canvas px-3 text-xs font-bold text-ink-secondary">「{keyword.trim()}」を含む</span> : <span className="inline-flex min-h-9 items-center rounded-full border border-hairline bg-canvas px-3 text-xs font-bold text-ink-secondary">条件なし</span>}
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <SelectField aria-label="条件の軸" value={conditionType} onChange={(event) => setConditionType(event.target.value as typeof conditionType)} options={[{ value: '', label: '条件の軸を選ぶ' }, ...CONDITION_AXES.map(([value, label]) => ({ value, label }))]} className={styles.select} />
                <TextField aria-label="条件の値" value={conditionValue} onChange={(event) => setConditionValue(event.target.value)} placeholder="値を入力" />
                <span className="text-ink-faint self-center text-xs">15軸</span>
              </div>
            </div>
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

                  <div className="grid grid-cols-2 gap-3">
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor={`au-action-${row.key}`}>
                      すること<span className={styles.required}>必須</span>
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
                    <div className={styles.field}>
                      <label className={styles.label} htmlFor={`au-tag-${row.key}`}>
                        付けるタグ<span className={styles.required}>必須</span>
                      </label>
                      <div className={styles.field}>
                        <SelectField
                          id={`au-tag-${row.key}`}
                          value={row.tagId}
                          disabled={tagsLoading || tagsFailed}
                          onChange={(event) => updateAction(row.key, { tagId: event.target.value })}
                          aria-label="自動化で付けるタグ"
                          className={styles.select}
                          options={[
                            { value: '', label: '— 選んでください —' },
                            ...tags.map((tag) => ({ value: tag.id, label: tag.name })),
                          ]}
                        />
                        {tagsLoading ? <p className={styles.note}>読み込んでいます</p> : null}
                        {tagsFailed ? (
                          <p className={styles.note}>
                            タグを読み込めませんでした。画面を再読み込みしてください。
                          </p>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <div className={styles.field}>
                      <label className={styles.label} htmlFor={`au-message-${row.key}`}>
                        送る文面<span className={styles.required}>必須</span>
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
              {previewCount === null ? '下書きを保存すると、いまの条件で数えます。' : '保存した条件を、選択中のLINEアカウントで数えた結果です。'}
            </p>
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
        status={saving ? '保存しています' : (blockedReason ?? 'まだ保存していません')}
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
              onClick={() => void save(true)}
            >
              {saving ? '作成中...' : 'つくって動かす'}
            </button>
          </>
        }
      />
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
