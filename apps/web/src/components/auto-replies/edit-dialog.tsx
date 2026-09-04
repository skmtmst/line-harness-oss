'use client'

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import type { SegmentCondition } from '@/lib/segment-condition'
import ConditionBuilder from '@/components/shared/condition-builder'
import InlineActionList, { useActionOptions } from './inline-action-list'
import {
  readKeywordRules,
  readInlineActions,
  toKeywordPayload,
  toActionPayload,
  WEEKDAY_LABELS,
  HOLIDAY_RULE_LABELS,
  type KeywordRuleDraft,
  type HolidayRuleValue,
  type InlineAction,
} from './draft-fields'
import ImageUploader from '@/components/shared/image-uploader'
import Button from '@/components/shared/button'
import StickyBar from '@/components/shared/sticky-bar'

export interface AutoReplyDraft {
  id?: string
  keyword: string
  matchType: 'exact' | 'contains'
  responseType: string
  responseContent: string
  templateId: string | null
  lineAccountId: string | null
  isActive: boolean
  /** JST の "HH:MM"。null で時間帯を問わない */
  activeFrom?: string | null
  activeUntil?: string | null
  /** この分数は同じ相手へ自動応答を返さない。null で抑制しない */
  cooldownMinutes?: number | null
  /** 担当者が対応中のトークでは返さない */
  skipWhenOperatorActive?: boolean
  /** 評価順。小さいほど先に見る */
  priority?: number
  /** 対象にするメッセージ種別。null / 空で全部 */
  messageKinds?: string[] | null
  /** 151: 応答したときに順に実行すること。 */
  actions?: unknown[] | null
  /** 151: 応答する曜日（0=日 … 6=土）。null / 空で曜日を問わない。 */
  responseWeekdays?: number[] | null
  /** 151: 祝日の扱い。 */
  responseHolidayRule?: string | null
  /** 151: 1人につき1回だけ応答する。 */
  oncePerFriend?: boolean
  /** 151: キーワードの複数行。null なら keyword / matchType を見る。 */
  keywords?: unknown[] | null
  /** 友だちの絞り込み（一斉配信・シナリオと同じ形）。 */
  friendConditions?: unknown | null
  /** 157: キーワードを問わず、届いたメッセージすべてに応答する。 */
  respondToAll?: boolean
  /** 158: 管理用の名前。空なら keyword を代わりに出す。 */
  name?: string | null
  /** 158: 'any'（どれか1つ）か 'all'（すべて）。 */
  keywordMatchMode?: 'any' | 'all'
  /** フォルダ。分けていなければ null。 */
  folderId?: string | null
}

/**
 * 保存してあるルールを、この窓が読む形にする。
 *
 * **1か所で作る。** 呼ぶ側がそれぞれ項目を並べ直していたので、
 * 一覧からの「編集」と `/auto-replies/edit?id=` で**中身が食い違って**いた。
 * URL から開いたほうは、曜日・アクション・キーワードの複数行・友だち条件を
 * 落としていた。**落ちた項目は、開いて保存した時点で消える。**
 *
 * `folderId` もここで必ず残す。#430 でフォルダ編集が入った後に
 * この変換で落とすと、開いて保存しただけで未分類へ移ってしまう。
 */
export function toDraft(rule: {
  id: string
  keyword: string
  matchType: 'exact' | 'contains'
  responseType: string
  responseContent: string
  templateId: string | null
  lineAccountId: string | null
  isActive: boolean
  activeFrom?: string | null
  activeUntil?: string | null
  cooldownMinutes?: number | null
  skipWhenOperatorActive?: boolean
  priority: number
  messageKinds?: string[] | null
  actions?: unknown[] | null
  responseWeekdays?: number[] | null
  responseHolidayRule?: string | null
  oncePerFriend?: boolean
  keywords?: unknown[] | null
  friendConditions?: unknown | null
  respondToAll?: boolean
  name?: string | null
  keywordMatchMode?: string
  folderId?: string | null
}): AutoReplyDraft {
  return {
    id: rule.id,
    keyword: rule.keyword,
    matchType: rule.matchType,
    responseType: rule.responseType,
    responseContent: rule.responseContent,
    templateId: rule.templateId,
    lineAccountId: rule.lineAccountId,
    isActive: rule.isActive,
    activeFrom: rule.activeFrom ?? null,
    activeUntil: rule.activeUntil ?? null,
    cooldownMinutes: rule.cooldownMinutes ?? null,
    skipWhenOperatorActive: rule.skipWhenOperatorActive ?? false,
    priority: rule.priority,
    messageKinds: rule.messageKinds ?? null,
    actions: rule.actions ?? null,
    responseWeekdays: rule.responseWeekdays ?? null,
    responseHolidayRule: rule.responseHolidayRule ?? null,
    oncePerFriend: rule.oncePerFriend ?? false,
    keywords: rule.keywords ?? null,
    friendConditions: rule.friendConditions ?? null,
    respondToAll: rule.respondToAll ?? false,
    name: rule.name ?? null,
    keywordMatchMode: rule.keywordMatchMode === 'all' ? 'all' : 'any',
    folderId: rule.folderId ?? null,
  }
}

/** 画面に出すメッセージ種別。LINE から届くもののうち、実務で使うものだけ。 */
const MESSAGE_KIND_LABELS: Array<{ key: string; label: string }> = [
  { key: 'text', label: 'テキスト' },
  { key: 'image', label: '画像' },
  { key: 'video', label: '動画' },
  { key: 'audio', label: '音声' },
  { key: 'file', label: 'ファイル' },
  { key: 'location', label: '位置情報' },
  { key: 'sticker', label: 'スタンプ' },
  { key: 'postback', label: 'ボタンのタップ' },
]

interface Props {
  draft: AutoReplyDraft
  templates: Array<{ id: string; name: string; messageType: string; messageContent: string }>
  onClose: () => void
  onSaved: () => void
}

type ResponseMode = 'silent' | 'template' | 'inline-text' | 'inline-flex' | 'inline-image'

function detectMode(d: AutoReplyDraft): ResponseMode {
  if (d.responseType === 'silent') return 'silent'
  if (d.templateId) return 'template'
  if (d.responseType === 'flex') return 'inline-flex'
  if (d.responseType === 'image') return 'inline-image'
  return 'inline-text'
}

export default function EditDialog({ draft, templates, onClose, onSaved }: Props) {
  const [keyword, setKeyword] = useState(draft.keyword)
  const [matchType, setMatchType] = useState<'exact' | 'contains'>(draft.matchType)
  const [mode, setMode] = useState<ResponseMode>(detectMode(draft))
  const [templateId, setTemplateId] = useState<string | null>(draft.templateId)
  const [responseContent, setResponseContent] = useState(draft.responseContent)
  const [isActive, setIsActive] = useState(draft.isActive)
  const [activeFrom, setActiveFrom] = useState(draft.activeFrom ?? '')
  const [activeUntil, setActiveUntil] = useState(draft.activeUntil ?? '')
  const [cooldown, setCooldown] = useState(
    draft.cooldownMinutes == null ? '' : String(draft.cooldownMinutes),
  )
  const [skipWhenOperatorActive, setSkipWhenOperatorActive] = useState(
    draft.skipWhenOperatorActive ?? false,
  )
  const [priority, setPriority] = useState(String(draft.priority ?? 0))
  const [messageKinds, setMessageKinds] = useState<string[]>(draft.messageKinds ?? [])
  const [keywordRules, setKeywordRules] = useState<KeywordRuleDraft[]>(() =>
    readKeywordRules(draft),
  )
  const [weekdays, setWeekdays] = useState<number[]>(draft.responseWeekdays ?? [])
  const [holidayRule, setHolidayRule] = useState<HolidayRuleValue>(
    (draft.responseHolidayRule as HolidayRuleValue) ?? 'ignore',
  )
  const [oncePerFriend, setOncePerFriend] = useState(draft.oncePerFriend ?? false)
  const [respondToAll, setRespondToAll] = useState(draft.respondToAll ?? false)
  const [ruleName, setRuleName] = useState(draft.name ?? '')
  const [keywordMatchMode, setKeywordMatchMode] = useState<'any' | 'all'>(
    draft.keywordMatchMode ?? 'any',
  )
  const [folderId, setFolderId] = useState(draft.folderId ?? '')
  const [folders, setFolders] = useState<Array<{ id: string; name: string }>>([])
  const [foldersLoadState, setFoldersLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [foldersReloadToken, setFoldersReloadToken] = useState(0)
  const [actions, setActions] = useState<InlineAction[]>(() => readInlineActions(draft.actions))
  const [friendConditions, setFriendConditions] = useState<SegmentCondition | null>(
    (draft.friendConditions as SegmentCondition | null) ?? null,
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // アクションで選ぶもの（タグ・友だち情報・対応マーク・シナリオ・共通情報）。
  const actionOptions = useActionOptions()

  useEffect(() => {
    let active = true
    setFolders([])
    setFoldersLoadState('loading')
    void api.folders.list('auto_reply')
      .then((res) => {
        if (!active) return
        if (res.success && Array.isArray(res.data)) {
          setFolders(res.data.map((f) => ({ id: f.id, name: f.name })))
          setFoldersLoadState('ready')
        } else {
          setFoldersLoadState('error')
        }
      })
      .catch(() => {
        if (active) setFoldersLoadState('error')
      })
    return () => {
      active = false
    }
  }, [foldersReloadToken])

  const flexTemplates = templates.filter((t) => t.messageType === 'flex')
  const textTemplates = templates.filter((t) => t.messageType === 'text')
  const imageTemplates = templates.filter((t) => t.messageType === 'image')

  const handleSave = async () => {
    // 一律で応答するならキーワードは要らない。
    if (!respondToAll && !keyword.trim()) {
      setError('キーワードを入力してください')
      return
    }
    if (mode === 'template' && !templateId) { setError('template を選んでください'); return }
    if ((mode === 'inline-text' || mode === 'inline-flex' || mode === 'inline-image') && !responseContent.trim()) {
      setError('内容を入力してください'); return
    }
    setError('')
    setSaving(true)
    try {
      const body: {
        keyword: string;
        matchType: 'exact' | 'contains';
        responseType: string;
        responseContent: string;
        templateId: string | null;
        lineAccountId: string | null;
        isActive: boolean;
        activeFrom: string | null;
        activeUntil: string | null;
        cooldownMinutes: number | null;
        skipWhenOperatorActive: boolean;
        priority: number;
        messageKinds: string[] | null;
        actions: unknown[] | null;
        responseWeekdays: number[] | null;
        responseHolidayRule: string | null;
        oncePerFriend: boolean;
        keywords: unknown[] | null;
        friendConditions: unknown | null;
        respondToAll: boolean;
        name: string | null;
        keywordMatchMode: 'any' | 'all';
        folderId: string | null;
      } = {
        keyword,
        matchType,
        responseType:
          mode === 'silent' ? 'silent'
          : mode === 'inline-flex' ? 'flex'
          : mode === 'inline-image' ? 'image'
          : mode === 'template' ? 'text' /* placeholder, override below if template found */
          : 'text',
        // template mode でも response_content / response_type を残す。template が
        // 削除された (ON DELETE SET NULL) ときの inline fallback として機能する。
        responseContent: mode === 'silent' ? '' : responseContent,
        templateId: mode === 'template' ? templateId : null,
        lineAccountId: draft.lineAccountId,
        isActive,
        activeFrom: activeFrom || null,
        activeUntil: activeUntil || null,
        cooldownMinutes: cooldown.trim() === '' ? null : Number(cooldown),
        skipWhenOperatorActive,
        priority: Number(priority) || 0,
        // 全部選ぶことと、1つも選ばないことは同じ意味。null に寄せる。
        messageKinds:
          messageKinds.length === 0 || messageKinds.length === MESSAGE_KIND_LABELS.length
            ? null
            : messageKinds,
        actions: actions.length > 0 ? actions.map(toActionPayload) : null,
        // 全部の曜日を選ぶことと、1つも選ばないことは同じ意味。null に寄せる。
        responseWeekdays: weekdays.length === 0 || weekdays.length === 7 ? null : weekdays,
        responseHolidayRule: holidayRule === 'ignore' ? null : holidayRule,
        oncePerFriend,
        // 1行だけで、中身が上の「キーワード」と同じなら、複数行として持たない。
        keywords: keywordRules.length > 0 ? keywordRules.map(toKeywordPayload) : null,
        friendConditions,
        respondToAll,
        name: ruleName.trim() || null,
        keywordMatchMode,
        folderId: folderId || null,
      }
      if (mode === 'template' && templateId) {
        const tpl = templates.find((t) => t.id === templateId)
        if (tpl) {
          body.responseType = tpl.messageType
          // template が削除された (ON DELETE SET NULL) ときの inline fallback として
          // 現時点の template content をスナップショット保存する。これがないと
          // template 削除後に webhook が空メッセージ送信になる。
          body.responseContent = tpl.messageContent
        }
      }
      if (draft.id) {
        await api.autoReplies.update(draft.id, body)
      } else {
        await api.autoReplies.create(body)
      }
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました')
    }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-4 border-b">
          <h3 className="text-base font-semibold">{draft.id ? '自動応答編集' : '自動応答を作る'}</h3>
          <p className="text-ink-faint mt-1 text-xs leading-relaxed">
            受け取ったメッセージに自動で返します。曜日や時間帯、友だちの条件で出し分けできます。
          </p>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <p className="text-ink mb-2 text-sm font-semibold">1. どのメッセージに反応するか</p>

            <label className="mb-3 block">
              <span className="text-ink-secondary text-xs">自動応答名</span>
              <span className="text-ink-faint block text-[11px]">
                一覧に出る名前です。友だちには見えません。空にすると、キーワードが名前の
                代わりに出ます。
              </span>
              <input
                type="text"
                value={ruleName}
                onChange={(e) => setRuleName(e.target.value)}
                maxLength={250}
                placeholder="例：営業時間外の案内"
                className="border-hairline rounded-control focus:ring-accent mt-1 w-full border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
              />
            </label>

            <div className="mb-3">
              <label htmlFor="auto-reply-folder" className="text-ink-secondary text-xs">
                フォルダ
              </label>
              <div className="mt-1 flex items-center gap-2">
                <select
                  id="auto-reply-folder"
                  value={folderId}
                  onChange={(e) => setFolderId(e.target.value)}
                  disabled={foldersLoadState !== 'ready'}
                  className="border-hairline rounded-control focus:ring-accent w-full border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
                >
                  <option value="">
                    {foldersLoadState === 'loading'
                      ? 'フォルダを読み込み中'
                      : foldersLoadState === 'error'
                        ? 'フォルダを読み込めませんでした'
                        : '未分類'}
                  </option>
                  {folderId && !folders.some((folder) => folder.id === folderId) && (
                    <option value={folderId}>
                      {foldersLoadState === 'ready'
                        ? '現在のフォルダ（一覧にありません）'
                        : '現在のフォルダ（名前を確認できません）'}
                    </option>
                  )}
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
                {foldersLoadState === 'error' && (
                  <Button onClick={() => setFoldersReloadToken((value) => value + 1)}>
                    再読み込み
                  </Button>
                )}
              </div>
              {foldersLoadState === 'error' && (
                <span className="text-danger mt-1 block text-xs">
                  フォルダを確認できないため、選択を変更できません。再読み込みしてください。
                </span>
              )}
            </div>

            <div className="mb-3 flex gap-2">
              <button
                type="button"
                onClick={() => setRespondToAll(false)}
                className={`rounded-control px-3 py-1.5 text-xs ${!respondToAll ? 'bg-accent text-on-accent' : 'bg-canvas-sunken text-ink-secondary hover:bg-hairline'}`}
              >
                キーワードで応答
              </button>
              <button
                type="button"
                onClick={() => setRespondToAll(true)}
                className={`rounded-control px-3 py-1.5 text-xs ${respondToAll ? 'bg-accent text-on-accent' : 'bg-canvas-sunken text-ink-secondary hover:bg-hairline'}`}
              >
                一律で応答
              </button>
            </div>

            {respondToAll ? (
              <p className="text-ink-faint text-xs leading-relaxed">
                届いたメッセージすべてに応答します。「営業時間外はこれを返す」のような使い方を
                想定しています。曜日・時間帯・友だちの条件は、このあとで見ます。
                <span className="mt-1 block">
                  評価順が同じときは、キーワードのあるルールを先に見ます。一律のルールが
                  先に当たって、ほかが動かなくなることはありません。
                </span>
              </p>
            ) : (
              <>
                <label className="text-ink-secondary mb-1 block text-xs">キーワード</label>
                <input
                  type="text"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  className="border-hairline rounded-control focus:ring-accent w-full border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
                  placeholder="例: コスト比較"
                />
              </>
            )}
          </div>
          <div className={respondToAll ? 'hidden' : ''}>
            <label className="text-ink-secondary mb-1 block text-xs">
              キーワードが複数あるとき
            </label>
            <div className="mb-3 flex gap-2">
              {(
                [
                  { value: 'any' as const, label: 'どれか1つに当たれば返す' },
                  { value: 'all' as const, label: 'すべて当たったときだけ返す' },
                ]
              ).map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setKeywordMatchMode(o.value)}
                  className={`rounded-control px-3 py-1.5 text-xs ${keywordMatchMode === o.value ? 'bg-accent text-on-accent' : 'bg-canvas-sunken text-ink-secondary hover:bg-hairline'}`}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <p className="text-ink-faint mb-3 text-[11px] leading-relaxed">
              「すべて」は絞り込みに使います。「予約」と「キャンセル」の両方が入った文にだけ
              返す、という形です。片方だけの問い合わせには返しません。
            </p>

            <label className="text-ink-secondary mb-1 block text-xs">一致のしかた</label>
            <div className="flex gap-2">
              {(['exact', 'contains'] as const).map((mt) => (
                <button
                  key={mt}
                  onClick={() => setMatchType(mt)}
                  className={`rounded-control px-3 py-1.5 text-xs ${matchType === mt ? 'bg-accent text-on-accent' : 'bg-canvas-sunken text-ink-secondary hover:bg-hairline'}`}
                >
                  {mt === 'exact' ? '完全一致' : '部分一致'}
                </button>
              ))}
            </div>
          </div>
          {/* 返す条件。キーワードが合っても、ここに当てはまらなければ返さない。 */}
          <div className="border-hairline space-y-3 rounded-lg border p-3">
            <p className="text-ink text-sm font-semibold">2. いつ・誰に反応するか</p>

            <div>
              <p className="text-ink-faint mb-1.5 text-xs">応答する曜日</p>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAY_LABELS.map((label, day) => {
                  const on = weekdays.length === 0 || weekdays.includes(day)
                  return (
                    <button
                      key={day}
                      type="button"
                      aria-pressed={on}
                      onClick={() => {
                        // 何も選ばない＝すべての曜日。最初の1つを押したときは
                        // 「その曜日だけ」にする（全部入りから1つ外す、ではない）。
                        if (weekdays.length === 0) {
                          setWeekdays([day])
                          return
                        }
                        const next = weekdays.includes(day)
                          ? weekdays.filter((d) => d !== day)
                          : [...weekdays, day].sort((a, b) => a - b)
                        setWeekdays(next)
                      }}
                      className={`rounded-control border px-2.5 py-1 text-xs transition-colors ${
                        on
                          ? 'border-accent bg-accent-soft text-ink'
                          : 'border-hairline text-ink-faint'
                      }`}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
              <p className="text-ink-faint mt-1 text-[11px]">
                {weekdays.length === 0
                  ? 'すべての曜日で応答します。'
                  : `${weekdays.map((d) => WEEKDAY_LABELS[d]).join('・')}曜だけ応答します。`}
              </p>
            </div>

            <div>
              <p className="text-ink-faint mb-1.5 text-xs">祝日</p>
              <div className="space-y-1">
                {HOLIDAY_RULE_LABELS.map((option) => (
                  <label key={option.value} className="flex cursor-pointer items-start gap-2">
                    <input
                      type="radio"
                      name="ar-holiday"
                      checked={holidayRule === option.value}
                      onChange={() => setHolidayRule(option.value)}
                      className="mt-0.5"
                    />
                    <span className="text-sm">
                      {option.label}
                      <span className="text-ink-faint block text-[11px]">{option.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label htmlFor="ar-from" className="text-ink-faint mb-1 block text-xs">
                  時間帯（JST）
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    id="ar-from"
                    type="time"
                    value={activeFrom}
                    onChange={(e) => setActiveFrom(e.target.value)}
                    className="border-hairline rounded-control border px-2 py-1.5 text-sm"
                  />
                  <span className="text-ink-faint text-xs">〜</span>
                  <input
                    aria-label="時間帯の終わり"
                    type="time"
                    value={activeUntil}
                    onChange={(e) => setActiveUntil(e.target.value)}
                    className="border-hairline rounded-control border px-2 py-1.5 text-sm"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="ar-cooldown" className="text-ink-faint mb-1 block text-xs">
                  連投を防ぐ
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    id="ar-cooldown"
                    type="number"
                    min={0}
                    max={10080}
                    step={1}
                    placeholder="なし"
                    value={cooldown}
                    onChange={(e) => setCooldown(e.target.value)}
                    className="border-hairline rounded-control w-24 border px-2 py-1.5 text-sm tabular-nums"
                  />
                  <span className="text-ink-faint text-xs">分</span>
                </div>
              </div>
            </div>
            <p className="text-ink-faint text-[11px] leading-relaxed">
              時間帯を空にすると、いつでも返します。22:00〜06:00 のように日をまたぐ指定もできます
              （開始を含み、終了は含みません）。<br />
              「連投を防ぐ」は、その相手へ自動応答を返してからこの分数のあいだ、どのルールでも返さない設定です。
            </p>
            <div>
              <p className="text-ink-faint mb-1.5 text-xs">対象にするメッセージ</p>
              <div className="flex flex-wrap gap-1.5">
                {MESSAGE_KIND_LABELS.map(({ key, label }) => {
                  const on = messageKinds.length === 0 || messageKinds.includes(key)
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() =>
                        setMessageKinds((prev) => {
                          // 何も選んでいない状態は「全部」を意味する。そこから
                          // 1つ外すには、いったん全部を入れてから外す。
                          const base = prev.length === 0 ? MESSAGE_KIND_LABELS.map((m) => m.key) : prev
                          return base.includes(key)
                            ? base.filter((k) => k !== key)
                            : [...base, key]
                        })
                      }
                      className={`rounded-pill px-2.5 py-1 text-xs transition-colors ${
                        on
                          ? 'bg-accent-deep text-on-accent'
                          : 'bg-canvas-sunken text-ink-secondary hover:bg-hairline'
                      }`}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
              <p className="text-ink-faint mt-1 text-[11px]">
                すべて選んだ状態と、1つも選ばない状態は同じ意味です（種別で絞りません）。
              </p>
            </div>

            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                checked={skipWhenOperatorActive}
                onChange={(e) => setSkipWhenOperatorActive(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
              />
              <span className="text-ink-secondary text-xs">
                担当者が対応中のトークでは返さない
                <span className="text-ink-faint block text-[11px]">
                  「対応中」のときだけ止まります。未対応のまま放置されているトークには返します。
                </span>
              </span>
            </label>

            <div>
              <p className="text-ink-faint mb-1.5 text-xs">応答する回数</p>
              <div className="space-y-1">
                <label className="flex cursor-pointer items-start gap-2">
                  <input
                    type="radio"
                    name="ar-once"
                    checked={!oncePerFriend}
                    onChange={() => setOncePerFriend(false)}
                    className="mt-0.5"
                  />
                  <span className="text-sm">何度でも応答する</span>
                </label>
                <label className="flex cursor-pointer items-start gap-2">
                  <input
                    type="radio"
                    name="ar-once"
                    checked={oncePerFriend}
                    onChange={() => setOncePerFriend(true)}
                    className="mt-0.5"
                  />
                  <span className="text-sm">
                    1人につき1回だけ応答する
                    <span className="text-ink-faint block text-[11px]">
                      このルールで一度応答した人には、以後どのキーワードでも応答しません。
                      上の「連投を防ぐ」は時間をあけるだけですが、こちらは二度と応答しません。
                    </span>
                  </span>
                </label>
              </div>
            </div>

            <div>
              <p className="text-ink-faint mb-1.5 text-xs">応答する相手</p>
              <ConditionBuilder
                value={friendConditions}
                onChange={setFriendConditions}
                label="この応答を返す友だち"
                showCount={false}
              />
              <p className="text-ink-faint mt-1 text-[11px]">
                条件を入れないと、全員に応答します。
              </p>
            </div>
          </div>
          <div>
            <p className="text-ink mb-2 text-sm font-semibold">3. 何を返すか</p>
            <label className="text-ink-secondary mb-1 block text-xs">返し方</label>
            <div className="flex flex-wrap gap-2">
              {([
                { key: 'silent', label: '返信しない' },
                { key: 'template', label: 'テンプレートから' },
                { key: 'inline-text', label: 'この画面に直接書く' },
                { key: 'inline-flex', label: 'Flex（JSONを直接書く）' },
                { key: 'inline-image', label: '画像（JSONを直接書く）' },
              ] as const).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setMode(key)}
                  className={`rounded-control px-3 py-1.5 text-xs ${mode === key ? 'bg-accent text-on-accent' : 'bg-canvas-sunken text-ink-secondary hover:bg-hairline'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {mode === 'template' && (
            <div>
              <label className="text-ink-secondary mb-1 block text-xs">テンプレート</label>
              <select
                value={templateId ?? ''}
                onChange={(e) => setTemplateId(e.target.value || null)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                <option value="">-- 選択 --</option>
                {flexTemplates.length > 0 && (
                  <optgroup label="Flex">
                    {flexTemplates.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </optgroup>
                )}
                {textTemplates.length > 0 && (
                  <optgroup label="テキスト">
                    {textTemplates.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </optgroup>
                )}
                {imageTemplates.length > 0 && (
                  <optgroup label="画像">
                    {imageTemplates.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </optgroup>
                )}
              </select>
              {templates.length === 0 && (
                <p className="text-[11px] text-amber-600 mt-1">
                  テンプレートがありません。<a href="/templates" className="underline">/templates</a> で作成してください。
                </p>
              )}
            </div>
          )}
          {(mode === 'inline-text' || mode === 'inline-flex') && (
            <div>
              <label className="block text-xs text-gray-600 mb-1">
                {mode === 'inline-flex' ? 'Flex JSON' : 'テキスト'}
              </label>
              <textarea
                rows={mode === 'inline-flex' ? 8 : 4}
                value={responseContent}
                onChange={(e) => setResponseContent(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-green-500 resize-y"
              />
            </div>
          )}
          {mode === 'inline-image' && (
            <ImageUploader
              mode="line-image"
              value={(() => {
                try {
                  const parsed = JSON.parse(responseContent) as { originalContentUrl?: string; previewImageUrl?: string }
                  if (parsed.originalContentUrl) {
                    return {
                      mode: 'line-image' as const,
                      originalContentUrl: parsed.originalContentUrl,
                      previewImageUrl: parsed.previewImageUrl ?? parsed.originalContentUrl,
                    }
                  }
                } catch { /* ignore */ }
                return null
              })()}
              onChange={(v) => {
                if (v?.mode === 'line-image') {
                  setResponseContent(JSON.stringify({
                    originalContentUrl: v.originalContentUrl,
                    previewImageUrl: v.previewImageUrl,
                  }))
                } else {
                  setResponseContent('')
                }
              }}
              label="返信画像"
            />
          )}
          <div>
            <label htmlFor="ar-priority" className="text-ink-faint mb-1 block text-xs">
              評価順
            </label>
            <input
              id="ar-priority"
              type="number"
              min={-9999}
              max={9999}
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="border-hairline rounded-control w-24 border px-2 py-1.5 text-sm tabular-nums"
            />
            <p className="text-ink-faint mt-1 text-[11px] leading-relaxed">
              小さいほど先に見ます。上から順に見て、最初に当てはまった1つだけが動きます。
              間に挿し込めるよう、10・20・30 のように間を空けておくと後で楽です。
            </p>
          </div>


          {/* 応答したときに、あわせて行うこと */}
          <div className="border-hairline space-y-3 rounded-lg border p-3">
            <div>
              <p className="text-ink text-sm font-semibold">4. 応答したときに行うこと</p>
              <p className="text-ink-faint mt-0.5 text-xs leading-relaxed">
                並べた順に実行します。タグを付けてから、そのタグを条件にした次の動きを置く、
                という書き方ができます。
              </p>
            </div>
            <InlineActionList
              actions={actions}
              onChange={setActions}
              tags={actionOptions.tags}
              fields={actionOptions.fields}
              marks={actionOptions.marks}
              scenarios={actionOptions.scenarios}
              vars={actionOptions.vars}
            />
          </div>

          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
            />
            <span className="text-ink-secondary text-xs">この応答をオンにする</span>
          </label>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
        <StickyBar
          className="mx-5 mb-4"
          actions={(
            <>
              <button onClick={onClose} className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-md">キャンセル</button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="bg-accent-deep text-on-accent hover:brightness-92 rounded-control px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
              >
                {saving ? '保存中...' : '保存'}
              </button>
            </>
          )}
        />
      </div>
    </div>
  )
}
