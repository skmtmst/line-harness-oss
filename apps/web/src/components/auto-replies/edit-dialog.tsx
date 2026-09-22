'use client'

import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import type { AutoReplyDraftInput, AutoReplyDraftVersion } from '@line-crm/shared'
import type { SegmentCondition } from '@/lib/segment-condition'
import ConditionBuilder from '@/components/shared/condition-builder'
import InlineActionList, { useActionOptions } from './inline-action-list'
import {
  emptyKeywordRule,
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
import { useOverlayFocus } from '@/components/shared/overlay-utils'
import {
  MESSAGE_KIND_WORDS,
  messageKindWord,
  responseTypeWord,
} from '@/app/auto-replies/auto-reply-words'

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
  /** このルールを評価する受信経路。既存データはLINE。 */
  receiveSources?: Array<'line' | 'email'>
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
  /** 一覧・詳細APIが返せる実行集計。取れない場合はnull。 */
  hits?: { period?: number; total?: number } | null
  /** 下書き保存の楽観ロックに使う現在の版。 */
  versionNumber?: number
  matchedLast28Days?: number | null
  conflictAttentionCount?: number | null
  receiveSourceCounts?: Array<{ source: string; count: number }> | null
  internalMemo?: string | null
  replyDelaySeconds?: number | null
  unmatchedAction?: Record<string, unknown> | null
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
  receiveSources?: Array<'line' | 'email'>
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
  hits?: { period?: number; total?: number } | null
  internalMemo?: string | null
  replyDelaySeconds?: number | null
  unmatchedAction?: Record<string, unknown> | null
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
    receiveSources: rule.receiveSources ?? ['line'],
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
    hits: rule.hits ?? null,
    internalMemo: rule.internalMemo ?? null,
    replyDelaySeconds: rule.replyDelaySeconds ?? null,
    unmatchedAction: rule.unmatchedAction ?? null,
  }
}

/** 版管理APIの下書きを、一覧編集と同じ入力モデルへ変換する。 */
export function toVersionDraft(
  version: AutoReplyDraftVersion,
  details: {
    isActive: boolean
    conflictAttentionCount: number | null
    receiveSourceCounts: Array<{ source: string; count: number }> | null
  },
): AutoReplyDraft {
  return {
    ...toDraft({
      id: version.autoReplyId,
      ...version.settings,
      isActive: details.isActive,
    }),
    versionNumber: version.versionNumber,
    matchedLast28Days: version.matchedLast28Days ?? null,
    conflictAttentionCount: details.conflictAttentionCount,
    receiveSourceCounts: details.receiveSourceCounts,
  }
}

/*
 * 対象にするメッセージの種類の呼び方は `auto-reply-words` に一本化した。
 * ここで別に持つと、片方だけ増えて「一覧では英語、編集では日本語」に
 * なる（#494 軽13）。知らない値は内部値を出さず「その他のメッセージ」。
 */

interface Props {
  draft: AutoReplyDraft
  templates: Array<{ id: string; name: string; messageType: string; messageContent: string }>
  onClose: () => void
  onSaved: () => void
  /** URLから開く編集画面では、設計どおりページ内に広く表示する。 */
  page?: boolean
  /** V6ページ表示では、1画面に1段だけ出す。一覧内の編集ダイアログは全項目を出す。 */
  step?: 'basic' | 'trigger' | 'response'
  onStepChange?: (step: 'basic' | 'trigger' | 'response') => void
}

type ResponseMode = 'silent' | 'template' | 'inline-text' | 'inline-flex' | 'inline-image'

function detectMode(d: AutoReplyDraft): ResponseMode {
  if (d.responseType === 'silent') return 'silent'
  if (d.templateId) return 'template'
  if (d.responseType === 'flex') return 'inline-flex'
  if (d.responseType === 'image') return 'inline-image'
  return 'inline-text'
}

/** LINE送信画像の中身。{originalContentUrl, previewImageUrl} の JSON。 */
interface LineImageContent {
  originalContentUrl: string
  previewImageUrl: string
}

/**
 * 画像返信の本文を読む。JSON で無い・URL が無いものは「画像未選択」として null。
 *
 * **本文欄の文字列を画像JSONとして保存できないようにするための関門。**
 * 画像の中身は ImageUploader が JSON で書き込む。直接書いたテキストが
 * 残っているときに画像形式で保存すると、送信側でテキストとして送られて
 * しまう（`buildMessage` は parse に失敗するとテキストへ落とす）。
 */
function readLineImageContent(content: string): LineImageContent | null {
  try {
    const parsed = JSON.parse(content) as {
      originalContentUrl?: unknown
      previewImageUrl?: unknown
    }
    if (typeof parsed.originalContentUrl === 'string' && parsed.originalContentUrl) {
      return {
        originalContentUrl: parsed.originalContentUrl,
        previewImageUrl:
          typeof parsed.previewImageUrl === 'string' && parsed.previewImageUrl
            ? parsed.previewImageUrl
            : parsed.originalContentUrl,
      }
    }
  } catch {
    /* JSON でなければ画像の中身ではない */
  }
  return null
}

/*
 * 選択肢ボタンの見た目（U076）。
 *
 * 明るい緑（#06c755）に白い小文字はコントラスト 2.26:1 で読めない。
 * 曜日チップと同じ「淡い緑＋濃い文字＋枠」に寄せ、太字と `aria-pressed` で
 * 色以外でも選択状態を伝える。未選択側も透明な枠を持たせて、
 * 選択時に寸法が動かないようにする。
 *
 * ※ className は各ボタンへ直接書く。関数へ逃がすと静的に読めない
 *   className（design-debt の未解決）として数えられる。
 */

export default function EditDialog({
  draft,
  templates,
  onClose,
  onSaved,
  page = false,
  step = 'basic',
  onStepChange,
}: Props) {
  const [keyword, setKeyword] = useState(draft.keyword)
  const [matchType, setMatchType] = useState<'exact' | 'contains'>(draft.matchType)
  const [mode, setMode] = useState<ResponseMode>(detectMode(draft))
  const [templateId, setTemplateId] = useState<string | null>(draft.templateId)
  const [responseContent, setResponseContent] = useState(draft.responseContent)
  const [isActive, setIsActive] = useState(draft.isActive)
  /* #975 U059: 390pxでプレビューが保存操作を遠ざけないよう、狭い幅では折り畳む。 */
  const [mobilePreviewOpen, setMobilePreviewOpen] = useState(false)
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
  const [receiveSources, setReceiveSources] = useState<Array<'line' | 'email'>>(
    draft.receiveSources?.length ? draft.receiveSources : ['line'],
  )
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
  const [internalMemo, setInternalMemo] = useState(draft.internalMemo ?? '')
  const [replyDelaySeconds, setReplyDelaySeconds] = useState(
    draft.replyDelaySeconds == null ? '0' : String(draft.replyDelaySeconds),
  )
  const [unmatchedMode, setUnmatchedMode] = useState<'none' | 'notify_operator'>(
    draft.unmatchedAction?.type === 'notify_operator' ? 'notify_operator' : 'none',
  )
  const [folders, setFolders] = useState<Array<{ id: string; name: string }>>([])
  const [foldersLoadState, setFoldersLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [foldersReloadToken, setFoldersReloadToken] = useState(0)
  const [actions, setActions] = useState<InlineAction[]>(() => readInlineActions(draft.actions))
  const [friendConditions, setFriendConditions] = useState<SegmentCondition | null>(
    (draft.friendConditions as SegmentCondition | null) ?? null,
  )
  const [friendConditionOpen, setFriendConditionOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // アクションで選ぶもの（タグ・友だち情報・対応マーク・シナリオ・共通情報）。
  const actionOptions = useActionOptions()
  // 一覧内で開く編集窓は共通のoverlay制御へ寄せる。Escape・Tab循環・背景
  // スクロール停止・閉じたあとのフォーカス復元を同じ作法にする。保存中の
  // 閉鎖抑止は closeDisabled に渡さずここで判定する。そうしないと保存状態の
  // 切替で共通hookがcleanupされ、開いた起点への復元先を失ってしまう。
  const closeOverlay = useCallback(() => {
    if (!saving) onClose()
  }, [onClose, saving])
  const dialogRef = useOverlayFocus(!page, closeOverlay)

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
    if (mode === 'template' && !templateId) { setError('テンプレートを選んでください'); return }
    if (mode === 'inline-text' && !responseContent.trim()) {
      setError('内容を入力してください'); return
    }
    if (mode === 'inline-flex') {
      if (!responseContent.trim()) { setError('カードの内容を入力してください'); return }
      try {
        JSON.parse(responseContent)
      } catch {
        // カード形式なのにJSONでない本文を保存すると、送信側がテキストへ落として
        // そのまま送ってしまう。ここで止める。
        setError('カードの内容をJSON形式で入力してください'); return
      }
    }
    if (mode === 'inline-image' && !readLineImageContent(responseContent)) {
      // テキストのまま画像形式で保存させない（画像選択部品がJSONを書く）。
      setError('返信する画像を選んでください'); return
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
        receiveSources: Array<'line' | 'email'>;
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
          messageKinds.length === 0 || messageKinds.length === MESSAGE_KIND_WORDS.length
            ? null
            : messageKinds,
        receiveSources,
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
      if (page && draft.id) {
        if (!draft.lineAccountId || draft.versionNumber == null) {
          throw new Error('下書きの版情報を確認できません。画面を読み直してください')
        }
        await api.autoReplies.saveDraft(draft.id, {
          ...body,
          lineAccountId: draft.lineAccountId,
          friendConditions: friendConditions as Record<string, unknown> | null,
          keywords: body.keywords as AutoReplyDraftInput['keywords'],
          responseHolidayRule: body.responseHolidayRule as 'ignore' | 'include' | 'exclude' | null,
          internalMemo: internalMemo.trim() || null,
          replyDelaySeconds: Number(replyDelaySeconds) || null,
          unmatchedAction: unmatchedMode === 'notify_operator'
            ? { type: 'notify_operator' }
            : null,
          expectedVersion: draft.versionNumber,
        })
      } else if (draft.id) {
        await api.autoReplies.update(draft.id, body)
      } else {
        // AUTOREPLY-08: 新規作成は常に止まった状態で保存する。チェックを
        // 付けて作る形にすると「オフで保存したのに動く」の逆が起きる。
        // 動かすのは保存後の再開・公開操作だけ。
        await api.autoReplies.create({ ...body, isActive: false })
      }
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました')
    }
    setSaving(false)
  }

  const showBasic = !page || step === 'basic'
  const showTrigger = !page || step === 'trigger'
  const showResponse = !page || step === 'response'
  const conditionWords = keywordRules.filter((item) => item.keyword.trim()).map((item) => item.keyword.trim())
  const conditionSummary = respondToAll
    ? 'すべての受信メッセージ'
    : conditionWords.length > 0
      ? `「${conditionWords.join('」「')}」を${keywordMatchMode === 'all' ? 'すべて含む' : 'いずれか含む'}`
      : 'キーワード未入力'
  const timeSummary = activeFrom || activeUntil
    ? `${activeFrom || '00:00'}〜${activeUntil || '24:00'}`
    : '営業時間内・外の両方'
  const responseSummary = mode === 'silent'
    ? '返信なし・後続処理のみ'
    : mode === 'template'
      ? 'テンプレート'
      : mode === 'inline-image'
        ? '画像'
        : mode === 'inline-flex'
          ? 'リッチメッセージ'
          : 'テキスト'
  const replyDelaySummary = Number(replyDelaySeconds) > 0
    ? `${Number(replyDelaySeconds)}秒後に返信`
    : 'すぐに返信'
  const unmatchedSummary = unmatchedMode === 'notify_operator' ? '担当者へ引き継ぎ' : '何もしない'
  const receiveCount = draft.receiveSourceCounts?.reduce((sum, item) => sum + item.count, 0) ?? null
  // プレビューは保存される内容と同じものを指す。テンプレートならその中身、
  // 画像なら選択したURLを出す（U001/U002）。
  const selectedTemplate =
    mode === 'template' ? templates.find((t) => t.id === templateId) ?? null : null
  const imageContent = mode === 'inline-image' ? readLineImageContent(responseContent) : null
  const flexContentIsJson = (() => {
    if (mode !== 'inline-flex' || !responseContent.trim()) return false
    try {
      JSON.parse(responseContent)
      return true
    } catch {
      return false
    }
  })()
  const moveTo = (next: 'basic' | 'trigger' | 'response') => onStepChange?.(next)
  const stickyActions = (
    <>
      {page ? (
        <>
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving ? '保存中...' : '下書き保存'}
          </Button>
          {step === 'basic' && <Button type="button" variant="primary" onClick={() => moveTo('trigger')}>反応条件へ</Button>}
          {step === 'trigger' && <Button type="button" variant="primary" onClick={() => moveTo('response')}>何を返すかへ</Button>}
          {step === 'response' && <Button href={`/auto-replies/publish?id=${draft.id ?? ''}`} variant="primary">競合を確認</Button>}
        </>
      ) : (
        <>
          <Button type="button" onClick={onClose}>キャンセル</Button>
          <Button type="button" variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? '保存中...' : '保存'}
          </Button>
        </>
      )}
    </>
  )

  return (
    <div
      className={page ? 'space-y-4' : 'fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4'}
      data-design-node={page ? step === 'basic' ? 'K7vg2' : step === 'trigger' ? 'nzWIX' : 'ivDoe' : undefined}
      role={page ? undefined : 'presentation'}
      onMouseDown={page ? undefined : (event) => {
        if (event.target === event.currentTarget) closeOverlay()
      }}
    >
      {/*
       * 手順表示（StepTrail）は edit/page.tsx が出す。
       * この窓は一覧のダイアログとページの両方で使うため、ここに置くと
       * 手順の無い一覧にも Steps の節が混入する。
       */}
      <div className={page ? 'grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_390px]' : ''}>
      <div
        ref={dialogRef}
        className={page ? 'bg-canvas rounded-card border-hairline w-full border' : 'max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white shadow-xl'}
        role={page ? undefined : 'dialog'}
        aria-modal={page ? undefined : true}
        aria-labelledby={page ? undefined : 'auto-reply-edit-dialog-title'}
        tabIndex={page ? undefined : -1}
      >
        <div className={`border-hairline border-b px-5 ${page ? 'py-3' : 'py-4'}`}>
          <h3 id={page ? undefined : 'auto-reply-edit-dialog-title'} className="text-base font-semibold">
            {page
              ? step === 'basic'
                ? '基本設定'
                : step === 'trigger'
                  ? 'どんなときに動くか'
                  : '何を返すか'
              : draft.id ? '自動応答編集' : '自動応答を作る'}
          </h3>
          <p className="text-ink-faint mt-1 text-xs leading-relaxed">
            {page
              ? step === 'basic'
                ? '名前と管理方法を決めて、反応条件へ進みます。'
                : step === 'trigger'
                  ? '受信した言葉・曜日・時間帯・相手を組み合わせます。'
                  : '返信内容と、応答した後に行う処理を設定します。'
              : '受け取ったメッセージに自動で返します。曜日や時間帯、友だちの条件で出し分けできます。'}
          </p>
        </div>
        <div className={page ? 'space-y-4 p-4' : 'space-y-4 p-5'}>
          {showBasic ? (
            <>
          <section className="space-y-4">
            {!page && <div>
              <h2 className="text-ink text-lg font-bold">基本設定</h2>
              <p className="text-ink-faint mt-1 text-xs">ルール名・フォルダ・優先順位を設定します。</p>
            </div>}

            <div className={page ? 'grid items-start gap-3 xl:grid-cols-4' : ''}>
            <label className={page ? 'block xl:col-span-2' : 'mb-3 block'}>
              <span className="text-ink-secondary text-xs">自動応答名</span>
              <span className="text-ink-faint block text-[11px]">
                {page
                  ? '一覧に出る名前です。友だちには見えません。'
                  : '一覧に出る名前です。友だちには見えません。空にすると、キーワードが名前の代わりに出ます。'}
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

            <div className={page ? '' : 'mb-3'}>
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
            <div className={page ? 'contents' : 'grid gap-3 md:grid-cols-2'}>
              <label className="block">
                <span className="text-ink-secondary text-xs">優先順位</span>
                <select
                  value={priority}
                  onChange={(event) => setPriority(event.target.value)}
                  className="border-hairline rounded-control mt-1 w-full border bg-canvas px-3 py-2 text-sm"
                >
                  {Array.from({ length: 14 }, (_, index) => index + 1).map((value) => (
                    <option key={value} value={value}>{value}（高いほど先に判定）</option>
                  ))}
                </select>
              </label>
              <label className={page ? 'block xl:col-span-4' : 'block'}>
                <span className="text-ink-secondary text-xs">社内メモ <span className="text-ink-faint">任意</span></span>
                <textarea
                  rows={page ? 1 : 2}
                  value={internalMemo}
                  onChange={(event) => setInternalMemo(event.target.value)}
                  maxLength={1000}
                  placeholder="運用上の補足を入力"
                  className="border-hairline rounded-control mt-1 w-full border px-3 py-2 text-sm"
                />
                <span className="text-ink-faint mt-1 block text-xs">友だちには表示されません</span>
              </label>
            </div>
            </div>
          </section>

          {page ? (
            <>
              <section className="rounded-card border border-hairline p-4">
                {/* 見出しを全幅で取り、操作は下段へ。横並びだと末尾1文字だけ折り返す（U053）。 */}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-ink text-lg font-bold">どんなときに動くか</h2>
                    <p className="text-ink-faint mt-1 text-xs">受信した言葉・時間帯・相手で絞ります。</p>
                  </div>
                  <Button type="button" className="shrink-0 self-start" onClick={() => moveTo('trigger')}>反応条件を開く</Button>
                </div>
                <dl className="mt-4 grid gap-3">
                  <div className="rounded-control bg-canvas-sunken p-3"><dt className="text-ink-faint text-xs">受信メッセージ</dt><dd className="text-ink mt-1 text-sm font-bold">{conditionSummary}</dd></div>
                  <div className="rounded-control bg-canvas-sunken p-3"><dt className="text-ink-faint text-xs">時間帯</dt><dd className="text-ink mt-1 text-sm font-bold">{timeSummary}</dd></div>
                </dl>
              </section>
              <section className="rounded-card border border-hairline p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div><h2 className="text-ink text-lg font-bold">ひな形から作る</h2><p className="text-ink-faint mt-1 text-xs">よく使う組み合わせです。選ぶと条件と返信がまとめて入ります。</p></div>
                  <Button href="/templates" className="shrink-0 self-start">ひな形を管理</Button>
                </div>
                <div className="mt-4 divide-y divide-hairline rounded-card border border-hairline">
                  {[
                    ['営業時間外の自動返信', '毎日 21:00〜09:00 に受信', 'テキスト返信＋担当者へ通知'],
                    ['予約変更の受付', '「予約変更」「日程変更」を含む', 'テンプレート送信＋対応マーク'],
                    ['よくある質問への回答', '「営業時間」「場所」「料金」を含む', '回答テンプレート＋タグ付与'],
                  ].map(([name, when, reply]) => (
                    <div key={name} className="grid items-center gap-3 px-4 py-3 text-sm lg:grid-cols-4">
                      <strong>{name}</strong><span className="text-ink-secondary">{when}</span><span className="text-ink-secondary">{reply}</span>
                      <Button type="button" onClick={() => { setRuleName(name); moveTo('trigger') }}>このひな形を使う</Button>
                    </div>
                  ))}
                </div>
              </section>
            </>
          ) : null}
            </>
          ) : null}

          {showTrigger ? (
            <>
          <section className="space-y-4">
            {!page && <div>
              <h2 className="text-ink text-lg font-bold">1. どのメッセージに反応するか</h2>
              <p className="text-ink-faint mt-1 text-xs">受信した言葉・曜日・時間帯・相手で絞ります。</p>
            </div>}
            <div className="mb-3 flex gap-2">
              <button
                type="button"
                aria-pressed={!respondToAll}
                onClick={() => setRespondToAll(false)}
                className={`rounded-control border px-3 py-1.5 text-xs ${!respondToAll ? 'border-accent bg-accent-soft text-ink font-bold' : 'border-transparent bg-canvas-sunken text-ink-secondary hover:bg-hairline'}`}
              >
                キーワードで応答
              </button>
              <button
                type="button"
                aria-pressed={respondToAll}
                onClick={() => setRespondToAll(true)}
                className={`rounded-control border px-3 py-1.5 text-xs ${respondToAll ? 'border-accent bg-accent-soft text-ink font-bold' : 'border-transparent bg-canvas-sunken text-ink-secondary hover:bg-hairline'}`}
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
              <div className="space-y-2">
                <label className="text-ink-secondary block text-xs">受信メッセージに含む言葉</label>
                {keywordRules.map((rule, index) => (
                  <div key={`keyword-${index}`} className="flex items-center gap-2">
                    {index > 0 && (
                      <span className="text-ink-faint w-10 shrink-0 text-center text-xs font-bold">
                        {keywordMatchMode === 'all' ? 'かつ' : 'または'}
                      </span>
                    )}
                    <input
                      type="text"
                      value={rule.keyword}
                      maxLength={200}
                      aria-label={`キーワード${index + 1}`}
                      onChange={(event) => {
                        const next = keywordRules.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, keyword: event.target.value } : item,
                        )
                        setKeywordRules(next)
                        if (index === 0) setKeyword(event.target.value)
                      }}
                      className="border-hairline rounded-control focus:ring-accent min-w-0 flex-1 border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
                      placeholder={index === 0 ? '例：予約変更' : 'キーワードを追加'}
                    />
                    {keywordRules.length > 1 && (
                      <Button
                        type="button"
                        aria-label={`キーワード${index + 1}を削除`}
                        onClick={() => {
                          const next = keywordRules.filter((_, itemIndex) => itemIndex !== index)
                          setKeywordRules(next)
                          setKeyword(next[0]?.keyword ?? '')
                        }}
                      >
                        削除
                      </Button>
                    )}
                  </div>
                ))}
                <Button
                  type="button"
                  onClick={() => setKeywordRules((current) => [...current, emptyKeywordRule()])}
                >
                  ＋ キーワードを追加
                </Button>
              </div>
            )}
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
                  aria-pressed={keywordMatchMode === o.value}
                  onClick={() => setKeywordMatchMode(o.value)}
                  className={`rounded-control border px-3 py-1.5 text-xs ${keywordMatchMode === o.value ? 'border-accent bg-accent-soft text-ink font-bold' : 'border-transparent bg-canvas-sunken text-ink-secondary hover:bg-hairline'}`}
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
                  type="button"
                  aria-pressed={matchType === mt}
                  onClick={() => setMatchType(mt)}
                  className={`rounded-control border px-3 py-1.5 text-xs ${matchType === mt ? 'border-accent bg-accent-soft text-ink font-bold' : 'border-transparent bg-canvas-sunken text-ink-secondary hover:bg-hairline'}`}
                >
                  {mt === 'exact' ? '完全一致' : '部分一致'}
                </button>
              ))}
            </div>
          </div>
          {/* 返す条件。キーワードが合っても、ここに当てはまらなければ返さない。 */}
          <div className="border-hairline space-y-3 rounded-lg border p-3">
            <p className="text-ink text-sm font-semibold">2. いつ・誰に反応するか</p>
            <p className="text-ink-faint text-xs">
              複数のキーワードは、下の「すべて必須／どれか1つ」でつなぎ方を決めます。
            </p>

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

            {!page && <div>
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
            </div>}

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
              {!page && <div>
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
              </div>}
            </div>
            <p className="text-ink-faint text-[11px] leading-relaxed">
              時間帯を空にすると、いつでも返します。22:00〜06:00 のように日をまたぐ指定もできます
              （開始を含み、終了は含みません）。<br />
              「連投を防ぐ」は、その相手へ自動応答を返してからこの分数のあいだ、どのルールでも返さない設定です。
            </p>
            {!page && <div>
              <p className="text-ink-faint mb-1.5 text-xs">対象にするメッセージ</p>
              <div className="flex flex-wrap gap-1.5">
                {MESSAGE_KIND_WORDS.map(({ key, label }) => {
                  const on = messageKinds.length === 0 || messageKinds.includes(key)
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() =>
                        setMessageKinds((prev) => {
                          // 何も選んでいない状態は「全部」を意味する。そこから
                          // 1つ外すには、いったん全部を入れてから外す。
                          const base = prev.length === 0 ? MESSAGE_KIND_WORDS.map((m) => m.key) : prev
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
            </div>}

            {page && (
              <fieldset className="block">
                <legend className="text-ink-faint mb-1 block text-xs">受信元</legend>
                <div className="flex flex-wrap gap-2">
                  {([['line', 'LINE'], ['email', 'メール']] as const).map(([source, label]) => {
                    const checked = receiveSources.includes(source)
                    return (
                      <label key={source} className="border-hairline rounded-control flex items-center gap-2 border px-3 py-2 text-sm">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => setReceiveSources((current) => {
                            if (checked) return current.length === 1 ? current : current.filter((item) => item !== source)
                            return [...current, source]
                          })}
                        />
                        {label}
                      </label>
                    )
                  })}
                </div>
              </fieldset>
            )}

            {page && (
              <div className="block">
                <span className="text-ink-faint mb-1 block text-xs">過去28日の受信種別</span>
                <div className="border-hairline rounded-control flex min-h-10 flex-wrap items-center gap-2 border px-3 py-2 text-sm">
                  {draft.receiveSourceCounts == null
                    ? <span className="text-ink-faint">—（未取得）</span>
                    : draft.receiveSourceCounts.length === 0
                      ? <span className="text-ink-faint">受信なし</span>
                      : draft.receiveSourceCounts.map((item) => (
                        <span key={item.source} className="bg-canvas-sunken rounded-pill px-2 py-1 text-xs">
                          {messageKindWord(item.source)} {item.count.toLocaleString()}件
                        </span>
                      ))}
                </div>
                <span className="text-ink-faint mt-1 block text-xs">実際の受信履歴から集計しています。</span>
              </div>
            )}

            {!page && <label className="flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                checked={skipWhenOperatorActive}
                onChange={(e) => setSkipWhenOperatorActive(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
              />
              <span className="text-ink-secondary text-xs">
                担当者が対応中のトークでは返さない
                <span className="text-ink-faint block text-[11px]">
                  「対応中」のときだけ止まり、対応中が解除されるとあらためて動きます。
                  未対応のまま放置されているトークには返します。
                  予約・支払いなどの自動通知は別の送信経路なので止まりません。
                </span>
              </span>
            </label>}

            {!page && <div>
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
            </div>}

            <div>
              <p className="text-ink-faint mb-1.5 text-xs">応答する相手</p>
              {page ? (
                <div className="rounded-control border-hairline border p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-ink text-sm font-semibold">このルールを使う友だち</p>
                      <p className="text-ink-faint mt-1 text-xs">{friendConditions ? '保存済みの友だち条件あり' : 'すべての友だち'}</p>
                    </div>
                    <Button type="button" onClick={() => setFriendConditionOpen((open) => !open)}>
                      {friendConditionOpen ? '条件を閉じる' : '条件を編集'}
                    </Button>
                  </div>
                  {friendConditionOpen && (
                    <div className="mt-4">
                      <ConditionBuilder
                        value={friendConditions}
                        onChange={setFriendConditions}
                        label="この応答を返す友だち"
                        showCount={false}
                      />
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <ConditionBuilder
                    value={friendConditions}
                    onChange={setFriendConditions}
                    label="この応答を返す友だち"
                    showCount={false}
                  />
                  <p className="text-ink-faint mt-1 text-xs">条件を入れないと、全員に応答します。</p>
                  <div className="bg-canvas-sunken mt-3 rounded-control p-3 text-xs">
                    <p className="text-ink font-medium">この条件に当たった受信</p>
                    <p className="text-ink-faint mt-1">過去28日の受信に、この条件をあてはめた結果です。これから来る受信の件数ではありません。</p>
                    <p className="text-ink-faint mt-2">標準互換15軸：名前・個別メモ・ステータスメッセージ・友だち登録日・タグ・友だち情報・シナリオ・イベント予約・カレンダー予約・共通情報・リマインダ・回答フォーム・最終反応日・その他・対応マーク</p>
                    <p className="text-ink-faint mt-1">この画面だけの6軸：担当者・流入経路・配信状況・予約状況・購入履歴・ブロック状態</p>
                  </div>
                </>
              )}
            </div>
          </div>
          </section>
            </>
          ) : null}

          {showResponse ? (
            <>
          <section className="space-y-4">
          <div>
            <p className={page ? 'sr-only' : 'text-ink mb-2 text-sm font-semibold'}>3. 何を返すか</p>
            <label className="text-ink-secondary mb-1 block text-xs">返し方</label>
            <div className="flex flex-wrap gap-2">
              {([
                { key: 'silent', label: '返信しない' },
                { key: 'template', label: 'テンプレートから' },
                { key: 'inline-text', label: 'この画面に直接書く' },
                { key: 'inline-flex', label: 'カードを直接作る' },
                { key: 'inline-image', label: '画像を直接選ぶ' },
              ] as const).map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={mode === key}
                  onClick={() => setMode(key)}
                  className={`rounded-control border px-3 py-1.5 text-xs ${mode === key ? 'border-accent bg-accent-soft text-ink font-bold' : 'border-transparent bg-canvas-sunken text-ink-secondary hover:bg-hairline'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {/*
           * 返し方ごとの編集部品は、ページ表示・ダイアログ表示で同じものを出す。
           * ページでは選択欄が !page の内側にあり、テンプレートも画像も
           * 選べないままだった（U001/U002）。
           */}
          {mode === 'template' && (
            <div className={page ? 'rounded-card border-hairline space-y-3 border bg-canvas-sunken p-3' : ''}>
              <label htmlFor="auto-reply-template" className="text-ink-secondary mb-1 block text-xs">テンプレート</label>
              <select
                id="auto-reply-template"
                value={templateId ?? ''}
                onChange={(e) => setTemplateId(e.target.value || null)}
                className="border-hairline rounded-control focus:ring-accent w-full border bg-canvas px-3 py-2 text-sm focus:ring-2 focus:outline-none"
              >
                <option value="">-- 選択 --</option>
                {flexTemplates.length > 0 && (
                  <optgroup label="カード">
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
                <p className="text-warning mt-1 text-xs">
                  テンプレートがありません。<a href="/templates" className="underline">/templates</a> で作成してください。
                </p>
              )}
            </div>
          )}
          {(mode === 'inline-text' || mode === 'inline-flex') && (
            <div className={page ? 'rounded-card border-hairline space-y-3 border bg-canvas-sunken p-3' : ''}>
              {/*
                U058: 返信文の欄を先に出す。差し込みボタンの帯を上に置くと、
                狭い画面で入力欄が段の下まで押し出される。書く場所を先に
                見せて、差し込みはその下にまとめる。
              */}
              <label className="block">
                <span className={page ? 'text-ink text-sm font-semibold' : 'text-ink-secondary mb-1 block text-xs'}>
                  {mode === 'inline-flex' ? 'カードの内容（JSON）' : page ? '返信メッセージ' : 'テキスト'}
                </span>
                <textarea
                  rows={mode === 'inline-flex' ? 8 : page ? 5 : 4}
                  value={responseContent}
                  maxLength={5000}
                  onChange={(e) => setResponseContent(e.target.value)}
                  placeholder={mode === 'inline-flex' ? '{"type":"bubble", ...}' : '返信する内容を入力'}
                  className={page
                    ? 'border-hairline rounded-control mt-2 w-full resize-y border bg-canvas px-3 py-3 text-sm leading-relaxed'
                    : 'border-hairline rounded-control focus:ring-accent mt-1 w-full resize-y border px-3 py-2 font-mono text-xs focus:ring-2 focus:outline-none'}
                />
              </label>
              {page && mode === 'inline-text' && (
                <div className="flex flex-wrap gap-2" aria-label="差し込み項目">
                  {['名前', '友だち情報', '共通情報', '回答フォーム', '配信日', 'その他'].map((label) => (
                    <Button
                      key={label}
                      type="button"
                      onClick={() => setResponseContent((current) => `${current}{{${label}}}`)}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              )}
              {mode === 'inline-flex' && (
                <p className="text-ink-faint text-xs leading-relaxed">
                  LINE のカード型メッセージ（Flex Message）の JSON を入力します。
                </p>
              )}
              {!page && mode === 'inline-text' && (
                <div className="mt-2 flex flex-wrap gap-2" aria-label="差し込み項目">
                  {['友だち名', '会社名', '担当者名', '予約日時'].map((label) => (
                    <Button
                      key={label}
                      type="button"
                      onClick={() => setResponseContent((current) => `${current}{{${label}}}`)}
                    >
                      ＋ {label}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          )}
          {mode === 'inline-image' && (
            <ImageUploader
              mode="line-image"
              value={
                imageContent
                  ? { mode: 'line-image' as const, ...imageContent }
                  : null
              }
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
          {page && mode === 'silent' && (
            <p className="rounded-card border-hairline border bg-canvas-sunken p-3 text-ink-faint text-xs leading-relaxed">
              返信はしません。応答したときに実行する処理だけを下で設定します。
            </p>
          )}
          {!page && <div>
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
          </div>}


          {/*
           * 応答したときに、あわせて行うこと。
           * ページ表示に置いていた見本の文章と処理の無い追加ボタンは、実設定と
           * 見分けが付かないので、ダイアログと同じ実編集部品へ結び付ける（U003）。
           */}
          <div className={page ? 'border-hairline rounded-card space-y-3 border p-4' : 'border-hairline space-y-3 rounded-lg border p-3'}>
            <div>
              <p className="text-ink text-sm font-semibold">
                {page ? '配信後のアクション' : '4. 応答したときに行うこと'}
              </p>
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

          {page && (
            <div className="border-hairline grid gap-3 rounded-card border p-4 md:grid-cols-2">
              <label className="block">
                <span className="text-ink-secondary text-xs">返信を待つ時間</span>
                <select
                  value={replyDelaySeconds}
                  onChange={(event) => setReplyDelaySeconds(event.target.value)}
                  className="border-hairline rounded-control mt-1 w-full border bg-canvas px-3 py-2 text-sm"
                >
                  <option value="0">すぐに返信</option>
                  <option value="10">10秒後</option>
                  <option value="30">30秒後</option>
                  <option value="60">1分後</option>
                  <option value="300">5分後</option>
                </select>
              </label>
              <label className="block">
                <span className="text-ink-secondary text-xs">同じ人への連続返信</span>
                <span className="mt-1 flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    max={10080}
                    value={cooldown}
                    onChange={(event) => setCooldown(event.target.value)}
                    className="border-hairline rounded-control w-24 border px-3 py-2 text-sm"
                    placeholder="なし"
                  />
                  <span className="text-ink-faint text-xs">分あける</span>
                </span>
              </label>
              <div className="md:col-span-2">
                <p className="text-ink-secondary text-xs">条件に当たらなかった場合</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button type="button" variant={unmatchedMode === 'notify_operator' ? 'primary' : undefined} onClick={() => setUnmatchedMode('notify_operator')}>
                    担当者へ引き継ぐ
                  </Button>
                  <Button type="button" variant={unmatchedMode === 'none' ? 'primary' : undefined} onClick={() => setUnmatchedMode('none')}>
                    何もしない
                  </Button>
                </div>
              </div>
              <div className="md:col-span-2">
                <label className="flex cursor-pointer items-start gap-2">
                  <input
                    type="checkbox"
                    checked={skipWhenOperatorActive}
                    onChange={(event) => setSkipWhenOperatorActive(event.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
                  />
                  <span className="text-ink-secondary text-xs">
                    担当者が対応中のトークでは返さない
                    <span className="text-ink-faint block text-xs">
                      「対応中」のときだけ止まり、対応中が解除されるとあらためて動きます。
                      未対応のまま放置されているトークには返します。
                      予約・支払いなどの自動通知は別の送信経路なので止まりません。
                    </span>
                  </span>
                </label>
              </div>
            </div>
          )}

          {draft.id ? (
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
              />
              <span className="text-ink-secondary text-xs">この応答をオンにする</span>
            </label>
          ) : (
            // AUTOREPLY-08: 新しい応答は止まった状態で保存される。
            // 有効化は一覧の「再開」や公開前の確認から、別の操作で行う。
            <p className="text-ink-faint text-xs">
              新しく作る応答は、止まった状態で保存されます。動かすには、保存したあと一覧の「再開」から有効にします。
            </p>
          )}
          </section>
            </>
          ) : null}
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
        {!page && <StickyBar className="mx-5 mb-4" actions={stickyActions} />}
      </div>
      {page && (
        /*
         * #975 U059: 390pxでは、長いプレビューの先に保存があるように見えない
         * よう、設定確認・プレビューはワンタップで開く折り畳みにする。
         * 保存は下部追従バーにあり、スクロールなしで届く。
         * 表示制御は共通部品へ渡せないため、外側の div で xl 以上を隠す。
         */
        <div className="xl:hidden">
          <Button
            variant="secondary"
            className="w-full"
            aria-expanded={mobilePreviewOpen}
            onClick={() => setMobilePreviewOpen((current) => !current)}
          >
            {mobilePreviewOpen ? '届く形と設定の確認を閉じる' : '届く形と設定の確認を見る'}
          </Button>
        </div>
      )}
      {page && (
        <aside className={`flex flex-col gap-3 xl:sticky xl:top-4 ${mobilePreviewOpen ? '' : 'max-xl:hidden'}`}>
          <div style={step === 'basic' ? { minHeight: 298 } : undefined} className={`bg-canvas rounded-card border-hairline border p-4 ${step === 'response' ? 'order-2' : 'order-1'}`}>
            <h3 className="text-ink text-sm font-semibold">
              {step === 'trigger' ? 'この条件の判定' : step === 'response' ? '返信の設定' : '設定内容'}
            </h3>
            <dl className="divide-hairline mt-3 divide-y text-xs">
              <div className="flex justify-between gap-3 py-3"><dt className="text-ink-faint">状態</dt><dd className="text-ink font-medium">{isActive ? '有効' : '停止中'}</dd></div>
              {step === 'basic' && (
                <>
                  <div className="flex justify-between gap-3 py-3"><dt className="text-ink-faint">優先順位</dt><dd className="text-ink font-medium">{priority || '未入力'}</dd></div>
                  <div className="flex justify-between gap-3 py-3"><dt className="text-ink-faint">過去28日の応答</dt><dd className="text-ink font-medium">{draft.matchedLast28Days == null ? '—（未取得）' : `${draft.matchedLast28Days}件`}</dd></div>
                  <div className="flex justify-between gap-3 py-3"><dt className="text-ink-faint">同時に当たるルール</dt><dd className="text-ink font-medium">{draft.conflictAttentionCount == null ? '—（未取得）' : draft.conflictAttentionCount === 0 ? 'なし' : `${draft.conflictAttentionCount}件`}</dd></div>
                </>
              )}
              {step === 'trigger' && (
                <>
                  <div className="py-3"><dt className="text-ink-faint">受信メッセージ</dt><dd className="text-ink mt-1 font-medium">{conditionSummary}</dd></div>
                  <div className="flex justify-between gap-3 py-3"><dt className="text-ink-faint">曜日・時間</dt><dd className="text-ink font-medium">{timeSummary}</dd></div>
                  <div className="flex justify-between gap-3 py-3"><dt className="text-ink-faint">相手</dt><dd className="text-ink font-medium">{friendConditions ? '条件あり' : 'すべての友だち'}</dd></div>
                  <div className="flex justify-between gap-3 py-3"><dt className="text-ink-faint">28日間の一致</dt><dd className="text-ink font-medium">{draft.matchedLast28Days == null ? '—（未取得）' : `${draft.matchedLast28Days}件`}</dd></div>
                </>
              )}
              {step === 'response' && (
                <>
                  <div className="flex justify-between gap-3 py-3"><dt className="text-ink-faint">返信</dt><dd className="text-ink font-medium">{responseSummary}</dd></div>
                  <div className="flex justify-between gap-3 py-3"><dt className="text-ink-faint">実行すること</dt><dd className="text-ink font-medium">{actions.length}件</dd></div>
                  <div className="flex justify-between gap-3 py-3"><dt className="text-ink-faint">連続返信</dt><dd className="text-ink font-medium">{cooldown ? `${cooldown}分あける` : '制限なし'}</dd></div>
                  <div className="flex justify-between gap-3 py-3"><dt className="text-ink-faint">待ち時間</dt><dd className="text-ink font-medium">{replyDelaySummary}</dd></div>
                  <div className="flex justify-between gap-3 py-3"><dt className="text-ink-faint">対応中のトーク</dt><dd className="text-ink font-medium">{skipWhenOperatorActive ? '返さない' : '返す'}</dd></div>
                  <div className="flex justify-between gap-3 py-3"><dt className="text-ink-faint">不一致時</dt><dd className="text-ink font-medium">{unmatchedSummary}</dd></div>
                </>
              )}
            </dl>
          </div>
          {step !== 'trigger' && (
            <div style={{ minHeight: 388 }} className={`bg-line-preview overflow-hidden rounded-card border-hairline border ${step === 'response' ? 'order-1' : 'order-2'}`}>
              <p className="text-on-accent py-4 text-center text-sm font-semibold">LINEプレビュー</p>
              <div className="bg-canvas mx-4 mb-4 rounded-card p-4 text-sm leading-relaxed text-ink">
                {mode === 'silent'
                  ? '返信はせず、設定したアクションだけを実行します。'
                  : mode === 'template'
                    ? selectedTemplate
                      ? selectedTemplate.messageType === 'text'
                        ? selectedTemplate.messageContent
                        : `テンプレート「${selectedTemplate.name}」（${responseTypeWord(selectedTemplate.messageType).label}）を送信します。`
                      : 'テンプレートを選ぶと、ここに内容が表示されます。'
                    : mode === 'inline-image'
                      ? imageContent
                        ? (
                          <img
                            src={imageContent.previewImageUrl}
                            alt="返信画像のプレビュー"
                            className="max-h-40 w-full rounded-control object-cover"
                          />
                        )
                        : '画像を選ぶと、ここに表示されます。'
                      : mode === 'inline-flex'
                        ? responseContent.trim()
                          ? flexContentIsJson
                            ? 'カード型メッセージを送信します。'
                            : 'JSON として読めません。このままでは保存できません。'
                          : 'カードの内容（JSON）を入力すると、ここに表示されます。'
                        : responseContent || '返信内容を入力すると、ここに表示されます。'}
              </div>
              {step === 'response' && (
                <div className="mx-4 mb-4 rounded-card bg-canvas p-3">
                  <p className="text-ink-faint text-micro">表示見本 — ボタン付きメッセージの見え方</p>
                  <div className="mt-2 space-y-1.5" aria-hidden="true">
                    {['予約を確認', '日程を変更', 'キャンセル'].map((label) => (
                      <p
                        key={label}
                        className="border-line-answer text-line-answer rounded-control border py-1.5 text-center text-xs font-bold"
                      >
                        {label}
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          <div className="order-3 bg-canvas rounded-card border-hairline border p-4 text-xs">
            <p className="text-ink font-semibold">{step === 'trigger' ? '過去28日の受信' : '動作の確認'}</p>
            {step === 'trigger' ? (
              <>
                <p className="text-ink mt-2 text-2xl font-bold tabular-nums">{draft.matchedLast28Days == null ? '—' : `${draft.matchedLast28Days.toLocaleString()}件`}</p>
                <p className="text-ink-faint mt-1 leading-relaxed">{receiveCount == null ? '受信総数は未取得です。' : `受信 ${receiveCount.toLocaleString()}件の実測集計です。`}</p>
                <p className="text-ink-faint mt-3 leading-relaxed">利用できる条件：タグ・友だち情報・シナリオ・予約・流入経路・対応状況など</p>
              </>
            ) : (
              <p className="text-ink-faint mt-2 leading-relaxed">
                保存後に「競合を確認」へ進むと、同時に当たるルールと実際に優先されるルールを確認できます。
              </p>
            )}
          </div>
        </aside>
      )}
      </div>
      {page && <StickyBar className="sticky bottom-0 z-20 col-span-full shadow-card" actions={stickyActions} />}
    </div>
  )
}
