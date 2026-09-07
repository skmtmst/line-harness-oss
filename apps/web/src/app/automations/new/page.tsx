'use client'

import SelectField from '@/components/shared/select-field'
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import type { Automation, AutomationAction, Tag } from '@line-crm/shared'
import { api, ApiError } from '@/lib/api'
import Breadcrumb from '@/components/shared/breadcrumb'
import StickyBar from '@/components/shared/sticky-bar'
import { TextArea, TextField } from '@/components/shared/text-field'
import { CareCard, FeatureLinkCard } from '@/components/shared/side-cards'
import { usePageTitle } from '@/components/shell/page-chrome'
// APIの owner/admin 制約は共通アクションと同じ（`requireRole('owner','admin')`）。
// 同じ判定を2つ持つと、片方だけ直したときに画面ごとに食い違う。
import { useCanManageCommonActions } from '@/components/automations/use-common-action-permission'
import styles from './new-automation.module.css'

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
    note: '付け外しのどちらでも動きます。付いたときだけに限る条件は、まだ選べません。',
  },
  {
    value: 'postback_received',
    label: 'メニューやボタンが押されたとき',
    note: 'リッチメニューや選択肢を押したとき。含まれる言葉で絞れます。',
  },
]

/** 言葉で絞れるきっかけ。ほかは本文を持たないので条件欄を出さない。 */
const KEYWORD_EVENTS: ReadonlyArray<string> = ['message_received', 'postback_received']

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

export default function NewAutomationPage() {
  usePageTitle('ルールを作る')
  const router = useRouter()
  const canManage = useCanManageCommonActions()
  const [name, setName] = useState('')
  const [eventType, setEventType] = useState<string>(EVENTS[0].value)
  const [keyword, setKeyword] = useState('')
  const [conditionType, setConditionType] = useState<(typeof CONDITION_AXES)[number][0] | ''>('')
  const [conditionValue, setConditionValue] = useState('')
  const [actions, setActions] = useState<ActionDraft[]>([newActionDraft()])
  const [tags, setTags] = useState<Tag[]>([])
  const [tagsLoading, setTagsLoading] = useState(true)
  const [tagsFailed, setTagsFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [existingAutomations, setExistingAutomations] = useState<Automation[]>([])

  useEffect(() => {
    let cancelled = false
    setTagsLoading(true)
    setTagsFailed(false)
    api.tags
      .list()
      .then((res) => {
        if (cancelled) return
        if (res.success) setTags(res.data)
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
  }, [])

  useEffect(() => {
    let cancelled = false
    api.automations.list({})
      .then((response) => {
        if (!cancelled && response.success) setExistingAutomations(response.data)
      })
      .catch(() => {
        if (!cancelled) setExistingAutomations([])
      })
    return () => {
      cancelled = true
    }
  }, [])

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

  const save = async (andAnother: boolean) => {
    if (saving || blockedReason) return
    const invalid = validate()
    if (invalid) {
      setError(invalid)
      setNotice('')
      return
    }
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const res = await api.automations.create({
        name: name.trim(),
        eventType: selectedEvent.value,
        conditions: {
          ...(usesKeyword && keyword.trim() ? { keyword: keyword.trim() } : {}),
          ...(conditionType && conditionValue.trim() ? { operator: 'AND', rules: [{ type: conditionType, value: conditionType === 'is_following' || conditionType === 'is_hidden' ? conditionValue.trim() === 'true' : conditionValue.trim() }] } : {}),
        },
        // すること（アクション）は { type, params } の形で持つ。
        // params の中身は type ごとに違う。
        actions: actions.map(
          (row): AutomationAction =>
            row.type === 'add_tag'
              ? { type: 'add_tag', params: { tagId: row.tagId } }
              : {
                  type: 'send_message',
                  params: { messageType: 'text', messageContent: row.message.trim() },
                },
        ),
      })
      if (!res.success) throw new Error(res.error)
      if (andAnother) {
        setName('')
        setKeyword('')
        setActions([newActionDraft()])
        setNotice('保存しました。続けて作れます。')
        return
      }
      // 作った行を一覧で目立たせる。どこに増えたのか探させない。
      router.push(`/automations?highlight=${res.data.id}`)
    } catch (caught) {
      setError(
        caught instanceof ApiError || caught instanceof Error
          ? caught.message
          : '保存できませんでした',
      )
    } finally {
      setSaving(false)
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
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
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
            <p className={styles.sideMissingValue}>—</p>
            <p className={styles.sideMissingNote}>
              まだ繋がっていません。見込み人数を数える口が接続されると表示されます。
            </p>
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
                head: 'この画面から作ると有効になります',
                note: '下書き保存の口は未接続です。作成前に文面とタグを確かめてください。',
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
              onClick={() => void save(true)}
            >
              有効にして続けて作る
            </button>
            <button
              type="button"
              className={`${styles.action} ${styles.actionPrimary}`}
              disabled={saving || Boolean(blockedReason)}
              onClick={() => void save(false)}
            >
              {saving ? '作成中...' : '作成して有効にする'}
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
