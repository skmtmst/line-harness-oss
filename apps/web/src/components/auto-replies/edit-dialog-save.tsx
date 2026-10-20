'use client'

import { readLineImageContent } from './edit-dialog-model'



import { MESSAGE_KIND_WORDS } from '@/v8/auto-replies/public/auto-reply-words/index'
import { api,ApiError,describeSaveFailure } from '@/lib/api'
import { findConditionDraftIssue,type SegmentCondition } from '@/lib/segment-condition'
import type { AutoReplyDraftInput } from '@line-crm/shared'
import { validateFlexContent } from '@line-crm/shared'
import type { Dispatch,SetStateAction } from 'react'
import {
toActionPayload,
toKeywordPayload,
type HolidayRuleValue,
type InlineAction,
type KeywordRuleDraft
} from './draft-fields'
import { AutoReplyDraft,ResponseMode } from './edit-dialog-model'

type SaveAutoReplyDialogContext = {
  actions: InlineAction[]
  activeFrom: string
  activeUntil: string
  cooldown: string
  createKey: string
  draft: AutoReplyDraft
  folderId: string
  friendConditions: SegmentCondition | null
  holidayRule: HolidayRuleValue
  internalMemo: string
  isActive: boolean
  keyword: string
  keywordMatchMode: "any" | "all"
  keywordRules: KeywordRuleDraft[]
  matchType: "exact" | "contains"
  messageKinds: string[]
  mode: ResponseMode
  oncePerFriend: boolean
  onSaved: () => void
  page: boolean
  priority: string
  receiveSources: ("email" | "line")[]
  replyDelaySeconds: string
  respondToAll: boolean
  responseContent: string
  ruleName: string
  setConflictInfo: Dispatch<SetStateAction<{ keyword: string; responseContent: string; } | null>>
  setDraftSaved: Dispatch<SetStateAction<boolean>>
  setError: Dispatch<SetStateAction<string>>
  setSaving: Dispatch<SetStateAction<boolean>>
  skipWhenOperatorActive: boolean
  templateId: string | null
  templates: { id: string; name: string; messageType: string; messageContent: string; }[]
  unmatchedMode: "none" | "notify_operator"
  weekdays: number[]
}

export async function saveAutoReplyDialog({ actions, activeFrom, activeUntil, cooldown, createKey, draft, folderId, friendConditions, holidayRule, internalMemo, isActive, keyword, keywordMatchMode, keywordRules, matchType, messageKinds, mode, oncePerFriend, onSaved, page, priority, receiveSources, replyDelaySeconds, respondToAll, responseContent, ruleName, setConflictInfo, setDraftSaved, setError, setSaving, skipWhenOperatorActive, templateId, templates, unmatchedMode, weekdays }: SaveAutoReplyDialogContext) {
    /*
     * R29: 空の行は送らない（送るとAPIが400で断る）。
     * 先頭の keyword / matchType は行と同じものを送る。判定側が読むのは
     * 行のほうなので、ここが食い違うと選んだ当て方で動かない。
     */
    const effectiveRules = keywordRules.filter((rule) => rule.keyword.trim() !== '')
    const firstKeyword = effectiveRules[0]?.keyword.trim() ?? ''
    // 一律で応答するならキーワードは要らない。
    if (!respondToAll && !firstKeyword) {
      setError('キーワードを入力してください')
      return
    }
    /*
     * R200: 「連投を防ぐ」は送る前に欄の名前と許容範囲で止める。
     * 保存口も同じ文言で断るが、ここで先に止めると往復しない。
     */
    if (cooldown.trim() !== '') {
      const cooldownValue = Number(cooldown)
      if (!Number.isInteger(cooldownValue) || cooldownValue < 0 || cooldownValue > 10080) {
        setError('「連投を防ぐ」は0〜10080の整数（分）で入力してください')
        return
      }
    }
    if (mode === 'template' && !templateId) { setError('テンプレートを選んでください'); return }
    if (mode === 'inline-text' && !responseContent.trim()) {
      setError('内容を入力してください'); return
    }
    if (mode === 'inline-flex') {
      if (!responseContent.trim()) { setError('カードの内容を入力してください'); return }
      // R201: JSONとして読めるだけでは足りない。`{}` のような構造のない内容は
      // 送信時に落ちるだけなので、保存の側で止める（保存口も同じ判定）。
      const flexError = validateFlexContent('flex', responseContent)
      if (flexError) { setError(flexError); return }
    }
    if (mode === 'inline-image' && !readLineImageContent(responseContent)) {
      // テキストのまま画像形式で保存させない（画像選択部品がJSONを書く）。
      setError('返信する画像を選んでください'); return
    }
    /*
     * R243: 空の「いずれか」のかたまり・未完成の行がある下書きは保存しない。
     * そのまま送ると「絞り込みなし」へ黙って落ちる。編集中の表示は消さず、
     * 不足の案内だけ出してAPI要求は0にする（page/listどちらの保存口もここ）。
     * 素の空（null）は「絞り込みなし」として有効なので通す。
     */
    const conditionIssue = findConditionDraftIssue(friendConditions)
    if (conditionIssue) { setError(conditionIssue); return }
    setError('')
    setConflictInfo(null)
    setDraftSaved(false)
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
        internalMemo: string | null;
      } = {
        keyword: firstKeyword || keyword,
        matchType: effectiveRules[0]?.matchType ?? matchType,
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
        keywords: effectiveRules.length > 0 ? effectiveRules.map(toKeywordPayload) : null,
        friendConditions,
        respondToAll,
        name: ruleName.trim() || null,
        keywordMatchMode,
        folderId: folderId || null,
        // 新規作成・一覧の編集のどちらの保存口でも送る。ここに入れないと
        // 入力したメモが保存要求に乗らず、再び開いたとき空になる（AUTOREPLY-09）。
        internalMemo: internalMemo.trim() || null,
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
        const updated = await api.autoReplies.update(draft.id, body)
        if (updated.success && updated.data?.draftSaved) {
          // m26c R569: 稼働中は無変更で下書きへ載った。閉じずに公開フローへ案内する。
          setDraftSaved(true)
          setSaving(false)
          return
        }
      } else {
        // AUTOREPLY-08: 新規作成は常に止まった状態で保存する。チェックを
        // 付けて作る形にすると「オフで保存したのに動く」の逆が起きる。
        // 動かすのは保存後の再開・公開操作だけ。
        await api.autoReplies.create({ ...body, isActive: false }, createKey)
      }
      onSaved()
    } catch (e) {
      // m26c R551: 競合は入力を保持したまま、先行内容との比較と読み直しを出す。
      if (e instanceof ApiError && e.status === 409) {
        const data = e.data as {
          currentVersion?: number
          current?: { keyword?: string; responseContent?: string }
        } | null
        setError(e.message || 'ほかの変更が先に保存されました。最新の状態を読み直してください')
        if (data?.current) {
          setConflictInfo({
            keyword: typeof data.current.keyword === 'string' ? data.current.keyword : '',
            responseContent:
              typeof data.current.responseContent === 'string' ? data.current.responseContent : '',
          })
        }
      } else {
        // R570: 409以外は既存 WRITE-01 の案内に寄せる。素の内部文
        //（`API error: 500` など）は出さない。入力は保持したまま。
        setError(describeSaveFailure(e))
      }
    }
    setSaving(false)
  }
