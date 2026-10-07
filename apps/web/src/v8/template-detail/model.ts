/*
 * ★V8 テンプレートの詳細で使う計算（画面から切り出して試験で確かめる）。
 * src/v8 からは @/app を読めないので、今の画面（app/templates）の
 * 決め事を写している。言い回しを変えるときは両方を見る。
 */
import type { api } from '@/lib/api'

/** 詳細口（GET /api/templates/:id）が返す1件分の形。 */
export type TemplateDetailData = Extract<
  Awaited<ReturnType<typeof api.templates.get>>,
  { success: true }
>['data']

export type TemplateUsage = NonNullable<TemplateDetailData['usedBy']>

export interface TemplateVersionItem {
  versionNumber: number
  status: 'in_use' | 'reserved' | 'past'
  messageType?: string
  messageContent: string
  carouselActions?: unknown | null
  carouselTapLimitMode?: string | null
  carouselTapLimitText?: string | null
  question?: unknown | null
  effectiveFrom: string | null
  createdAt: string
}

/*
 * D007/D008：success:true でも本文が無い応答がある（存在しない ID へ一覧形が返るなど）。
 * 名前・種類・本文の3つが文字列のときだけ中身として受け取る。利用先は無くてもよいが、
 * 有るときに表でない物が混じると数え上げで落ちるので、そのときは捨てる。
 */
export function isTemplateDetailData(data: unknown): data is TemplateDetailData {
  if (typeof data !== 'object' || data === null) return false
  const record = data as Record<string, unknown>
  if (typeof record.name !== 'string' || typeof record.messageType !== 'string' || typeof record.messageContent !== 'string') return false
  const usedBy = record.usedBy
  if (usedBy === undefined || usedBy === null) return true
  if (typeof usedBy !== 'object') return false
  const lists = usedBy as Record<string, unknown>
  for (const key of ['broadcasts', 'reminderEnrollments'] as const) {
    const value = lists[key]
    if (value !== undefined && !Array.isArray(value)) return false
  }
  for (const key of ['autoReplies', 'automations', 'scenarioSteps', 'reminderSteps', 'richMenuAreas', 'trackedLinks'] as const) {
    if (!Array.isArray(lists[key])) return false
  }
  return true
}

/** 種類の呼び方。LINE の作りの名前（flex など）は運用する人に通じないので言い換える。 */
const MESSAGE_TYPE_LABELS: Record<string, string> = {
  text: 'テキスト',
  image: '画像',
  flex: 'カード型',
  carousel: 'カルーセル',
  question: '質問',
}
export function messageTypeText(type: string): string {
  return MESSAGE_TYPE_LABELS[type] ?? 'その他'
}

/** 使っていないテンプレートを消す前の説明（今の画面と同じ言い回し）。 */
export function templateDeleteDescription(usageCount: number): string {
  if (usageCount > 0) {
    return `このテンプレートは${usageCount}箇所で使われています。使用中は削除できません。先に使用先を差し替えてください。すでに送ったメッセージは残ります。`
  }
  return 'どこからも使われていないので、他の画面の動きは止まりません。すでに送ったメッセージは残ります。この操作は取り消せません。'
}

function versionText(version: number | null | undefined): string {
  return version === null || version === undefined ? 'いまの版' : `版${version}で固定（変わらない）`
}

export function broadcastStatusText(status: string): string {
  if (status === 'scheduled') return '予約中'
  if (status === 'sending') return '送信中'
  if (status === 'sent') return '送信済み'
  return '下書き'
}

function enrollmentStatusText(status: string): string {
  if (status === 'active') return '送信待ち'
  if (status === 'cancelled') return '取消ずみ'
  return status
}

/** 本文の {名前} のような差し込みを拾う（同じ物は1つ）。 */
export function insertionNames(content: string): string[] {
  const found = new Set<string>()
  for (const match of content.matchAll(/\{([^{}]+)\}/g)) {
    const name = match[1]?.trim()
    if (name) found.add(name)
  }
  return [...found]
}

export interface UsageRow {
  key: string
  kind: string
  name: string
  /** 使っている版（いまの版／版Nで固定（変わらない））。 */
  version: string
  versionNumber: number | null
  /** 版を決めている（公開しても変わらない）。 */
  fixed: boolean
  status: string | null
  href: string | null
}

/** 使っている所の行。一斉配信・自動応答・シナリオ・リマインダ・リッチメニュー・流入リンク・旧オートメーションの順。 */
export function buildUsageRows(usage: TemplateUsage | null | undefined): UsageRow[] {
  if (!usage) return []
  const broadcasts = usage.broadcasts ?? []
  const enrollments = usage.reminderEnrollments ?? []
  return [
    ...broadcasts.map((u) => {
      const fixed = u.referenceMode === 'fixed' || u.templateVersionNumber !== null
      return {
        key: `broadcast-${u.broadcastId}`,
        kind: '一斉配信',
        name: u.title,
        version: fixed ? versionText(u.templateVersionNumber) : 'いまの版',
        versionNumber: fixed ? u.templateVersionNumber : null,
        fixed,
        status: broadcastStatusText(u.status),
        href: u.status === 'scheduled' ? `/broadcasts/reserved?id=${u.broadcastId}` : `/broadcasts/detail?id=${u.broadcastId}`,
      }
    }),
    ...usage.autoReplies.map((u) => ({
      key: `auto-reply-${u.id}`,
      kind: '自動応答',
      name: u.keyword,
      version: versionText(u.templateVersion ?? null),
      versionNumber: u.templateVersion ?? null,
      fixed: u.templateVersion !== null && u.templateVersion !== undefined,
      status: null,
      href: `/auto-replies/edit?id=${u.id}`,
    })),
    ...usage.scenarioSteps.map((u) => ({
      key: `scenario-step-${u.stepId}`,
      kind: 'シナリオ配信',
      name: `${u.scenarioName}・${u.stepOrder}通目`,
      version: versionText(u.templateVersion ?? null),
      versionNumber: u.templateVersion ?? null,
      fixed: u.templateVersion !== null && u.templateVersion !== undefined,
      status: null,
      href: `/scenarios/detail?id=${u.scenarioId}`,
    })),
    ...usage.reminderSteps.map((u) => ({
      key: `reminder-step-${u.reminderId}-${u.stepId}`,
      kind: 'リマインダ',
      name: u.reminderName,
      version: 'いまの版',
      versionNumber: null,
      fixed: false,
      status: null,
      href: `/reminders/edit?id=${u.reminderId}`,
    })),
    ...enrollments.map((u) => ({
      key: `reminder-enrollment-${u.enrollmentId}`,
      kind: 'リマインダ',
      name: u.reminderName,
      version: versionText(u.versionNumber),
      versionNumber: u.versionNumber,
      fixed: true,
      status: enrollmentStatusText(u.enrollmentStatus),
      href: `/reminders/detail?id=${u.reminderId}`,
    })),
    ...usage.richMenuAreas.map((u) => ({
      key: `rich-menu-${u.groupId}-${u.areaId}`,
      kind: 'リッチメニュー',
      name: `${u.groupName}・${u.pageName}${u.label ? `・${u.label}` : ''}`,
      version: 'いまの版',
      versionNumber: null,
      fixed: false,
      status: null,
      href: `/rich-menus/edit?id=${u.groupId}`,
    })),
    ...usage.trackedLinks.map((u) => ({
      key: `tracked-link-${u.id}`,
      kind: '流入リンク',
      name: u.name,
      version: 'いまの版',
      versionNumber: null,
      fixed: false,
      status: null,
      href: `/inflow-links/detail?id=${u.id}`,
    })),
    // 旧形式のオートメーションには開ける画面が無い。
    ...usage.automations.map((u) => ({
      key: `automation-${u.id}`,
      kind: 'オートメーション',
      name: u.name,
      version: 'いまの版',
      versionNumber: null,
      fixed: false,
      status: null,
      href: null,
    })),
  ]
}

/** 公開の窓の右の文字：版を決めた所は「予約中・版2のまま」、それ以外は状態だけ。 */
export function publishRowState(row: UsageRow): string {
  if (row.fixed && row.versionNumber !== null) return [row.status, `版${row.versionNumber}のまま`].filter(Boolean).join('・')
  return row.status ?? ''
}

/** 版の差（行ごと）。消えた行は「－」、増えた行は「＋」。同じ行は出さない。 */
export function lineChanges(before: string, after: string): Array<{ kind: 'removed' | 'added'; text: string }> {
  const beforeLines = before.split('\n').map((line) => line.trimEnd()).filter((line) => line !== '')
  const afterLines = after.split('\n').map((line) => line.trimEnd()).filter((line) => line !== '')
  const afterSet = new Set(afterLines)
  const beforeSet = new Set(beforeLines)
  return [
    ...beforeLines.filter((line) => !afterSet.has(line)).map((text) => ({ kind: 'removed' as const, text })),
    ...afterLines.filter((line) => !beforeSet.has(line)).map((text) => ({ kind: 'added' as const, text })),
  ]
}

/** 「8月21日 18:02」（日本時間）。年が違うときは年も出す。 */
export function shortStamp(value: string | null | undefined, now: Date = new Date()): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(date).map((p) => [p.type, p.value]),
  )
  const nowYear = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric' }).formatToParts(now).find((p) => p.type === 'year')?.value
  const head = parts.year !== nowYear ? `${parts.year}年` : ''
  return `${head}${parts.month}月${parts.day}日 ${parts.hour}:${parts.minute}`
}
