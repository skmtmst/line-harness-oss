import type { BroadcastPreflight } from '@/lib/api'
import { TARGET_MODES, type TargetMode } from '@/lib/broadcast-audience'
import { audienceSummary } from '@/lib/broadcast-summary'
import { formatDateTime, formatNumber } from '@/lib/format'
import type { SegmentCondition } from '@/lib/segment-condition'

type NamedItem = { id: string; name: string }
type BroadcastPreflightSummaryInput = {
  preflight: BroadcastPreflight | null
  targetMode: TargetMode
  tags: readonly NamedItem[]
  tagId: string
  scenarios: readonly NamedItem[]
  scenariosStatus: 'idle' | 'loading' | 'ready' | 'error'
  audience: SegmentCondition | null
  excludeTagId: string
  sendMode: 'now' | 'scheduled' | 'optimal'
  scheduledDate: string
  scheduledTime: string
  spreadMinutes: string
  testPassed: boolean
  previewConfirmed: boolean
}

/**
 * 確認画面・確認窓・プレビューに共通の表示モデル。
 * 入力に対応する事前確認結果だけを受け取り、未取得を0件や利用可能へ置き換えない。
 * 通信・保存・送信の判定は行わない。
 */
export function broadcastPreflightSummary({ preflight, targetMode, tags, tagId, scenarios, scenariosStatus, audience, excludeTagId, sendMode, scheduledDate, scheduledTime, spreadMinutes, testPassed, previewConfirmed }: BroadcastPreflightSummaryInput) {
  const audienceCount = preflight?.audienceCount ?? null
  /** 対象画面の人数も、事前確認が返した同じ確定値だけを使う。 */
  const audienceDisplayCount = audienceCount
  const targetModeLabel = TARGET_MODES.find((mode) => mode.value === targetMode)?.label ?? '未設定'
  /*
   * 最終確認・事前確認の「対象」は一覧・詳細と同じ
   * audienceSummary の文面にする。「全有効友だち」とだけ出すと、
   * シナリオで絞った配信も全員向けに見える。
   * シナリオ名は候補を読み終えたときだけ名前で出す。未読込のまま
   * resolver を渡すと「シナリオ（削除済み）」と誤表示する。
   */
  const confirmAudienceLabel = (() => {
    const getTagName = (id: string) => tags.find((tag) => tag.id === id)?.name ?? null
    const getScenarioName = (id: string) => scenarios.find((item) => item.id === id)?.name ?? null
    if (targetMode === 'all') return '友だち全員'
    if (targetMode === 'tag') {
      if (!tagId) return targetModeLabel
      const name = getTagName(tagId)
      return name ? `タグ：${name}` : 'タグ（削除済み）'
    }
    return audienceSummary(
      { targetType: 'segment', segmentConditions: audience },
      getTagName,
      scenariosStatus === 'ready' ? getScenarioName : undefined,
    )
  })()
  /*
    除外の人数と理由。**数としての口がまだ無い応答もある。**
    `preflight.warnings` に「ブロック中の友だち 42人を除いています」のような
    文が来ることはあるので、あればその文を出し、無ければ `—` にする。
    **0人と書かない。**「除外なし」と「数えられない」は別のこと。
    理由はある分だけ並べる（ブロック・非表示・宛先不明・重複）。
  */
  const countedExclusionNote = preflight?.exclusions
    ? (() => {
        const ex = preflight.exclusions
        const parts = [
          ex.blocked > 0 ? `ブロック ${formatNumber(ex.blocked)}人` : null,
          ex.hidden > 0 ? `非表示 ${formatNumber(ex.hidden)}人` : null,
          ex.missingDestination > 0 ? `宛先不明 ${formatNumber(ex.missingDestination)}人` : null,
          ex.duplicate > 0 ? `重複 ${formatNumber(ex.duplicate)}人` : null,
        ].filter((part): part is string => part !== null)
        return parts.length > 0 ? `${parts.join('・')}を除外` : '除外なし'
      })()
    : preflight?.warnings?.find((w) => w.message.includes('除いて'))?.message ?? null
  const exclusionNote = excludeTagId
    ? `タグ「${tags.find((tag) => tag.id === excludeTagId)?.name ?? '選択したタグ'}」を除く ・ ${countedExclusionNote === '除外なし' ? 'その他の除外なし' : countedExclusionNote ?? '除外人数は未取得'}`
    : countedExclusionNote
  const quota = preflight?.quota ?? null
  const quotaInsufficient = quota?.state === 'insufficient'
  /*
   * 送信枠の見え方。取れない・足りない・足りるを分け、**取得前は0扱いしない**。
   * 最終確認（画面内と窓）の両方がここを見る。
   */
  const quotaNote = quota === null
    ? null
    : quota.state === 'unavailable'
      ? '確認できませんでした'
      : quota.state === 'insufficient'
        ? `不足しています（残り ${formatNumber(quota.remaining)} / ${formatNumber(quota.monthlyLimit)}通）`
        : `残り ${formatNumber(quota.remaining)} / ${formatNumber(quota.monthlyLimit)}通（この配信で ${formatNumber(quota.planned)}通を使用）`
  /** 対象の人数を数えた時刻。応答の evaluatedAt をJSTで出す。 */
  const evaluatedAtLabel = preflight?.audience?.evaluatedAt
    ? formatDateTime(preflight.audience.evaluatedAt)
    : null
  /** 把握できる重複配信。同じ時刻の前後1時間に入っている別の予約。 */
  const concurrentBroadcasts = preflight?.concurrentBroadcasts ?? []
  const scheduledLabel = sendMode === 'scheduled' && scheduledDate
    ? `${scheduledDate.replace(/-/g, '/')} ${scheduledTime}${Number(spreadMinutes) > 0 ? `（${spreadMinutes}分かけて配信）` : ''}`
    : null
  // 今すぐ送ると予約を分け、確定前に小窓で対象と本文を読み合わせる。
  const sendWhenLabel = scheduledLabel ?? (sendMode === 'now' ? '今すぐ（確認してから送信）' : null)
  const unconfirmedCount = preflight
    ? (preflight.warnings ?? []).filter((w) => w.level === 'warning').length
      + (testPassed ? 0 : 1)
      + (previewConfirmed ? 0 : 1)
    : null

  return { audienceCount, audienceDisplayCount, confirmAudienceLabel, exclusionNote, quota, quotaInsufficient, quotaNote, evaluatedAtLabel, concurrentBroadcasts, scheduledLabel, sendWhenLabel, unconfirmedCount }
}
