'use client'

import { useId } from 'react'
import { X } from 'lucide-react'
import type { SupportMarkArchiveImpact, SupportMarkListItem } from '@/lib/api'
import Button from '@/components/shared/button'
import { useOverlayFocus } from '@/components/shared/overlay-utils'
import Notice from '@/components/shared/notice'
import { SaveErrorField } from '@/components/shared/save-form-errors'
import EntitySelect, { entityOptionMetadata } from '@/components/shared/entity-select'

type MarkRow = SupportMarkListItem

export function autoRuleLabel(mark: MarkRow): string {
  if (mark.automationRules.length > 0) return mark.automationRules.map((rule) => rule.name).join('・')
  return mark.autoOnInbound ? '受信時' : '—'
}

export const DISPLAY_TARGET_LABELS: Record<NonNullable<MarkRow['displayTargets']>[number], string> = {
  inbox: '受信箱', friend_list: '友だち一覧', friend_detail: '友だち詳細', dashboard: 'ダッシュボード', broadcast: '一斉配信', automation: 'オートメーション',
}

/**
 * どこから呼ばれているか（設計 `rIhbN` の右から2列目）。
 *
 * **友だちの人数はここに混ぜない。** 隣の「使用中」列と同じ数がもう一度出て、
 * しかも `友だち8` と単位が落ちるため、8人なのか8件なのか読めなかった。
 * この列は配信・シナリオなど**設定側からの参照だけ**を数える。
 *
 * `usedIn` が無いのは「参照0」ではなく**まだ取れていない**状態。0件と
 * 言い切ると、消してよいマークだと読めてしまうので `—` を出す。
 */
export function usageLabel(mark: MarkRow): string {
  const display = mark.displayTargets?.map((target) => DISPLAY_TARGET_LABELS[target]) ?? []
  const usedIn = mark.usedIn
  const parts: string[] = []
  if (usedIn?.broadcasts) parts.push(`配信${usedIn.broadcasts}件`)
  if (usedIn?.scenarios) parts.push(`シナリオ${usedIn.scenarios}件`)
  if (usedIn?.autoReplies) parts.push(`自動応答${usedIn.autoReplies}件`)
  if (usedIn?.savedSearches) parts.push(`保存検索${usedIn.savedSearches}件`)
  if (usedIn?.automations) parts.push(`自動化${usedIn.automations}件`)
  return [...display, ...parts].length ? [...display, ...parts].join('・') : mark.usedIn === undefined ? '—' : 'なし'
}

export function referenceCount(mark: MarkRow): number {
  return (mark.usedIn?.broadcasts ?? 0)
    + (mark.usedIn?.scenarios ?? 0)
    + (mark.usedIn?.autoReplies ?? 0)
    + (mark.usedIn?.savedSearches ?? 0)
    + (mark.usedIn?.automations ?? 0)
}

export function isUsed(mark: MarkRow): boolean {
  return mark.friendCount > 0 || referenceCount(mark) > 0
}

export function ArchiveMarkDialog({ mark, impact, replacementMarkId, loading, saving, error, onReplacement, onCancel, onConfirm }: {
  mark: MarkRow
  impact: SupportMarkArchiveImpact | null
  replacementMarkId: string
  loading: boolean
  saving: boolean
  error: string
  onReplacement: (id: string) => void
  onCancel: () => void
  onConfirm: () => void
}) {
  const dialogRef = useOverlayFocus(true, onCancel, saving)
  /* ★V8 の小窓 `fy5dz` の題・実行ボタン・案内を使う。 */

  /* R138横展開: 確認窓の名前として見出しを読ませる。 */
  const titleId = useId()
  const selected = impact?.replacementOptions.find((option) => option.id === replacementMarkId)
  /*
    ATTR-17: 以前は画面上端から margin-top:310px に固定しており、
    390×600 のような縦の短い画面ではボタンが画面外に出た。
    画面の中に収め、中身が溢れたらダイアログの内側だけをスクロールする。
    見出しと操作ボタンは常に見えたままにする。
  */
  /*
   * R180: 使っている友だちが0人のときは置換先なしで保管できる。
   * 以前は0人でも置換先が必須で、独自マーク1件だけのアカウントでは
   * 候補が空（共有は除外・自身も除外）になり保管実行を押せなかった。
   * 友だちがいるときに候補が無い・保管できないときは理由と次の操作を出す。
   */
  const friendCount = impact?.friendCount ?? 0
  const needsReplacement = friendCount > 0
  const noCandidates = needsReplacement && (impact?.replacementOptions.length ?? 0) === 0
  const blockReason = !impact
    ? ''
    : !impact.canArchive
      ? (mark.isDefault
        ? '初期値のマークは保管できません。先に別のマークを初期値にしてください。'
        : mark.isInherited
          ? '共有のマークは保管できません。'
          : '使用先があるため保管できません。使用先を外してから保管してください。')
      : noCandidates
        ? '置き換え先にできる対応マークがありません。先に新しい対応マークを作ってください。'
        : ''
  const canConfirm = !loading && !saving && Boolean(impact?.canArchive) && (!needsReplacement || Boolean(replacementMarkId))
  return (
    <div ref={dialogRef} className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-ink/45 p-4">
      <section data-design-node="fy5dz" data-design-part="archive-position" className="flex max-h-[calc(100dvh-2rem)] w-full max-w-xl flex-col overflow-hidden rounded-card border border-hairline bg-canvas shadow-overlay" role="alertdialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="flex items-start justify-between gap-3 p-4 pb-0">
          <div>
            <h2 id={titleId} className="text-lg font-bold text-ink">{`「${mark.name}」を保管しますか`}</h2>
            <p className="mt-2 text-xs leading-5 text-ink-secondary">{(needsReplacement ? `いま ${friendCount} 人に付いています。保管すると、この ${friendCount} 人は下で選んだマークへ置き換え、履歴に残します。` : '使っている友だちはいないので、そのまま保管できます。')}</p>
          </div>
          <button type="button" onClick={onCancel} disabled={saving} aria-label="閉じる" className="rounded-mini p-1 text-ink-secondary hover:bg-canvas-sunken disabled:opacity-50">
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-1 pt-3">
          {loading ? <p className="rounded-control bg-surface-soft p-3 text-sm text-ink-faint">影響を確認しています…</p> : impact && needsReplacement ? (
            <div>
              <label className="block text-sm font-semibold text-ink">置き換え先
                <SaveErrorField names={["replacementMarkId","replacement_mark_id"]}><EntitySelect
                  aria-label="置き換え先"
                  value={replacementMarkId}
                  onChange={onReplacement}
                  options={[{ value: '', label: '選んでください' }, ...impact.replacementOptions.map((option) => ({ ...entityOptionMetadata(option), value: option.id, label: `${option.name}${option.isDefault ? '（初期値）' : ''}` }))]}
                  size="full"
                  className="mt-1.5"
                /></SaveErrorField>
              </label>
              {selected ? <p className="mt-2 text-xs text-ink-faint">{impact.friendCount}人を「{selected.name}」へ置き換えます。</p> : null}
            </div>
          ) : null}
          {<p className="mt-4 text-xs leading-5 text-ink-faint">初期値のマーク・共有しているマーク・自動のきまりで使っているマークは保管できません。</p>}
          {blockReason ? <p className="mt-4 rounded-control bg-canvas-sunken p-3 text-xs leading-5 text-ink-secondary">{blockReason}</p> : null}
          {error ? <Notice tone="danger" className="mt-4">{error}</Notice> : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-hairline p-4"><Button onClick={onCancel} disabled={saving}>キャンセル</Button><Button variant="primary" className="h-9 px-4 font-bold border-0 whitespace-normal" type="button" onClick={onConfirm} disabled={!canConfirm}>{saving ? '保管中…' : needsReplacement ? '置き換えて保管する' : '保管する'}</Button></div>
      </section>
    </div>
  )
}
