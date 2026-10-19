'use client'

import type { AutoReplyDraftVersion } from '@line-crm/shared'


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

/**
 * R28: 窓の中で見せる順番の手がかり。一覧が評価順に並べた中での位置と、
 * 先に見るルールの名前だけを持つ。数字の入力は持たない。
 */
export interface AutoReplyOrderHint {
  /** 評価順での1始まりの位置。新規・不明なら null。 */
  position: number | null
  /** 同じ並びの件数。不明なら null。 */
  total: number | null
  /** このルールより先に見るルール（近い3件まで）。 */
  earlier: Array<{ id: string; name: string }>
  /** 先に見るルールの全部の件数。 */
  earlierTotal: number
}

export interface Props {
  draft: AutoReplyDraft
  templates: Array<{ id: string; name: string; messageType: string; messageContent: string }>
  onClose: () => void
  onSaved: () => void
  /** URLから開く編集画面では、設計どおりページ内に広く表示する。 */
  page?: boolean
  /** 管理画面ページ表示では、1画面に1段だけ出す。一覧内の編集ダイアログは全項目を出す。 */
  step?: 'basic' | 'trigger' | 'response'
  onStepChange?: (step: 'basic' | 'trigger' | 'response') => void
  /** 一覧から開いたときに渡す順番の手がかり。URL編集では未指定。 */
  orderHint?: AutoReplyOrderHint | null
}

export type ResponseMode = 'silent' | 'template' | 'inline-text' | 'inline-flex' | 'inline-image'

export function detectMode(d: AutoReplyDraft): ResponseMode {
  if (d.responseType === 'silent') return 'silent'
  if (d.templateId) return 'template'
  if (d.responseType === 'flex') return 'inline-flex'
  if (d.responseType === 'image') return 'inline-image'
  return 'inline-text'
}

/** LINE送信画像の中身。{originalContentUrl, previewImageUrl} の JSON。 */
export interface LineImageContent {
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
export function readLineImageContent(content: string): LineImageContent | null {
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
