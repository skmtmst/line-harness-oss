'use client'

/**
 * STEP3「公開のしかた」の入力値。
 *
 * datetime-local の生の文字列のまま持つ（送信時に JST→UTC へ直す）。
 * 下書き本体ではなく「予約・公開に使う入力」なので、下書き署名とは別の
 * 基準（publishBaseline）と比べて未保存かを決める。
 */
export type PublishPlanInput = {
  mode: 'now' | 'scheduled' | 'period'
  startsAt: string
  endsAt: string
  restoreGroupId: string
}

/** 公開入力の初期値。「いますぐ出す」・日時なし・戻し先なし。 */
export const DEFAULT_PUBLISH_PLAN: PublishPlanInput = {
  mode: 'now',
  startsAt: '',
  endsAt: '',
  restoreGroupId: '',
}

/*
 * 公開入力の下書き置き場。
 *
 * サーバーの下書き（rich_menu_groups の更新payload）には公開予定の欄が
 * 無いので、ブラウザの localStorage にメニューIDごとで持つ。再読込や
 * タブの閉じ開きで消えないようになり、別メニューの下書きとも混ざらない。
 * 使えない環境（プライベートモード等）では黙って何もしない。画面は
 * localStorage が無くても従来どおり動く。
 */
const storageKeyOf = (groupId: string) => `lh_rich_menu_publish_plan_${groupId}`

/** 読み取った値が公開入力の形かだけを見る。形違い・壊れたJSONは「下書きなし」。 */
function isPublishPlanInput(value: unknown): value is PublishPlanInput {
  if (!value || typeof value !== 'object') return false
  const plan = value as Record<string, unknown>
  return (plan.mode === 'now' || plan.mode === 'scheduled' || plan.mode === 'period')
    && typeof plan.startsAt === 'string'
    && typeof plan.endsAt === 'string'
    && typeof plan.restoreGroupId === 'string'
}

/** そのメニューの公開入力の下書きを読む。無ければ null。 */
export function loadPublishPlanDraft(groupId: string): PublishPlanInput | null {
  try {
    const raw = localStorage.getItem(storageKeyOf(groupId))
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return isPublishPlanInput(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * 公開入力の下書きを書く。初期値と同じなら書かずに消す
 * （「いますぐ出す」に戻した下書きを残さない）。
 */
export function savePublishPlanDraft(groupId: string, plan: PublishPlanInput): void {
  try {
    if (JSON.stringify(plan) === JSON.stringify(DEFAULT_PUBLISH_PLAN)) {
      localStorage.removeItem(storageKeyOf(groupId))
      return
    }
    localStorage.setItem(storageKeyOf(groupId), JSON.stringify(plan))
  } catch {
    // localStorage unavailable
  }
}

/** そのメニューの公開入力の下書きを消す。明示破棄・公開成功・予約成功で使う。 */
export function clearPublishPlanDraft(groupId: string): void {
  try {
    localStorage.removeItem(storageKeyOf(groupId))
  } catch {
    // localStorage unavailable
  }
}
