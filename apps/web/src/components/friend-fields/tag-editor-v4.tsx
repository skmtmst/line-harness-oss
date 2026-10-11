'use client'

import { useEffect, useState } from 'react'
import { Coins, X } from 'lucide-react'
import type { Tag } from '@line-crm/shared'
import { api, type CommonActionResources, type TagDefinitionAction, type TagRetroactivePreview } from '@/lib/api'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import SegmentedControl from '@/components/shared/segmented'
import HelpTip from '@/components/shared/help-tip'
import Drawer from '@/components/shared/drawer'
import Select from '@/components/shared/select'
import { useOverlayFocus } from '@/components/shared/overlay-utils'
import { formatNumber } from '@/lib/format'
import { SaveErrorField } from '@/components/shared/save-form-errors'
import EntitySelect, { entityOptionMetadata } from '@/components/shared/entity-select'

export type LinkedAction = {
  id: string
  type: string
  label: string
  timing: string
  definition?: TagDefinitionAction
}

export type TagEditorValues = {
  name: string
  groupId: string
  isStarred: boolean
  linked: boolean
  rewardMiles: number
  referralRewardMiles: number
  multiplierBps: number | null
  multiplierPriority: number
  applyToExisting: boolean
  reapplyPolicy: 'first_only' | 'every_time'
  actions: LinkedAction[]
}

export type TagEditorInitialValues = Partial<Omit<TagEditorValues, 'actions'>> & {
  actions?: LinkedAction[]
}

export const ACTION_TYPES = [
  ['テキスト送信', 'テキスト送信'],
  ['テンプレート送信', 'テンプレート'],
  ['タグ追加', 'タグ'],
  ['タグ解除', 'タグ'],
  ['友だち情報更新', '友だち情報'],
  ['対応マーク変更', '対応'],
  ['シナリオ開始', 'シナリオ'],
  ['シナリオ停止', 'シナリオ'],
  ['リマインダ開始', 'リマインダ'],
  ['リマインダ解除', 'リマインダ'],
  ['リッチメニュー切替', 'リッチメニュー'],
  ['担当者通知', '通知'],
  ['マイル付与', 'マイル'],
] as const
export type TagEditorActionLabel = (typeof ACTION_TYPES)[number][0]

export const ACTION_DEFINITIONS: Record<(typeof ACTION_TYPES)[number][0], { actionType: string; resource?: keyof CommonActionResources; paramKey?: string }> = {
  'テキスト送信': { actionType: 'send_message' },
  'テンプレート送信': { actionType: 'send_message', resource: 'templates', paramKey: 'templateId' },
  'タグ追加': { actionType: 'add_tag', resource: 'tags', paramKey: 'tagId' },
  'タグ解除': { actionType: 'remove_tag', resource: 'tags', paramKey: 'tagId' },
  '友だち情報更新': { actionType: 'set_metadata', resource: 'friendFields', paramKey: 'fieldId' },
  '対応マーク変更': { actionType: 'set_support_mark', resource: 'supportMarks', paramKey: 'markId' },
  'シナリオ開始': { actionType: 'start_scenario', resource: 'scenarios', paramKey: 'scenarioId' },
  'シナリオ停止': { actionType: 'stop_scenario', resource: 'scenarios', paramKey: 'scenarioId' },
  'リマインダ開始': { actionType: 'start_reminder', resource: 'reminders', paramKey: 'reminderId' },
  'リマインダ解除': { actionType: 'stop_reminder', resource: 'reminders', paramKey: 'reminderId' },
  'リッチメニュー切替': { actionType: 'switch_rich_menu', resource: 'richMenus', paramKey: 'richMenuPageId' },
  '担当者通知': { actionType: 'notify_staff', resource: 'notificationRules', paramKey: 'notificationRuleId' },
  'マイル付与': { actionType: 'grant_mileage' },
}

const ACTION_PRESENTATION: Record<string, { label: string; category: string }> = Object.fromEntries(
  ACTION_TYPES.map(([label, category]) => [ACTION_DEFINITIONS[label].actionType, { label, category }]),
)

export function linkedActionFromDefinition(action: TagDefinitionAction, saved?: NonNullable<Tag['linkedActions']>[number]): LinkedAction {
  const presentation = ACTION_PRESENTATION[action.type] ?? { label: action.type, category: 'その他' }
  const delayMinutes = Number(action.params.delayMinutes ?? 0)
  const timing = delayMinutes <= 0 ? 'すぐに' : delayMinutes % 1440 === 0 ? `${delayMinutes / 1440}日後` : delayMinutes % 60 === 0 ? `${delayMinutes / 60}時間後` : `${delayMinutes}分後`
  const content = typeof action.params.content === 'string' ? action.params.content : null
  const amount = typeof action.params.amount === 'number' ? `${action.params.amount} mile` : null
  const detailedType = action.type === 'send_message' && content ? 'テキスト送信' : presentation.label
  return { id: action.id, type: detailedType, label: saved?.label ?? content ?? amount ?? presentation.label, timing: saved?.timing ?? timing, definition: action }
}

export function definitionsForSave(actions: LinkedAction[]): TagDefinitionAction[] {
  return actions.flatMap((action) => action.definition ? [{ ...action.definition, id: action.id }] : [])
}

const cardClass =
  'rounded-card border border-hairline bg-canvas p-5 shadow-card-surface'
const inputClass =
  'w-full rounded-control border border-hairline bg-canvas px-3 py-2 text-sm text-ink'

export function ActionDrawer({ accountId, suppliedResources, allowedActionTypes, onClose, onAdd, selectedAction, referenceState = false, hqV8 = false }: { accountId: string | null; suppliedResources?: CommonActionResources | null; allowedActionTypes?: readonly TagEditorActionLabel[]; onClose: () => void; onAdd: (action: LinkedAction, beforeId?: string) => void; selectedAction?: Pick<LinkedAction, 'id' | 'label'>; referenceState?: boolean; hqV8?: boolean }) {
  const [selected, setSelected] = useState<(typeof ACTION_TYPES)[number]>(referenceState ? ACTION_TYPES[1] : ACTION_TYPES[0])
  const [timing, setTiming] = useState<'immediate' | 'delay'>('immediate')
  const [delay, setDelay] = useState(referenceState ? '24' : '1')
  const [delayUnit, setDelayUnit] = useState<'minutes' | 'hours' | 'days'>(referenceState ? 'hours' : 'minutes')
  // 前へ追加する位置は、呼び出し元が最後に選んだ行に結ぶ。
  const [position, setPosition] = useState('last')
  const [message, setMessage] = useState('ご登録ありがとうございます。')
  const [amount, setAmount] = useState('100')
  const [resources, setResources] = useState<CommonActionResources | null>(suppliedResources ?? null)
  const [resourceId, setResourceId] = useState('')
  const definition = ACTION_DEFINITIONS[selected[0]]
  const choices = definition.resource
    ? (resources?.[definition.resource] as Array<{ id: string; name: string }> | undefined) ?? []
    : []
  const unavailable = selected[0] === '友だち情報更新' || (allowedActionTypes ? !allowedActionTypes.includes(selected[0]) : false)
  const needsResource = Boolean(definition.resource)

  useEffect(() => {
    if (suppliedResources !== undefined) { setResources(suppliedResources); return }
    if (!accountId) return
    let active = true
    void api.commonActions.resources(accountId, undefined, 'tag.added').then((res) => {
      if (active && res.success) setResources(res.data)
    })
    return () => { active = false }
  }, [accountId, suppliedResources])

  useEffect(() => { setResourceId('') }, [selected])

  const add = () => {
    const delayMinutes = timing === 'immediate' ? 0 : Math.max(1, Number(delay) || 1) * (delayUnit === 'minutes' ? 1 : delayUnit === 'hours' ? 60 : 1440)
    const params: Record<string, unknown> = { delayMinutes, cancelIfTagRemoved: true }
    if (selected[0] === 'テキスト送信') params.content = message.trim()
    else if (selected[0] === 'マイル付与') params.amount = Math.max(1, Number(amount) || 1)
    else if (definition.paramKey) params[definition.paramKey] = resourceId
    if (selected[0] === '担当者通知') params.message = message.trim()
    const resourceName = choices.find((item) => item.id === resourceId)?.name
    const label = selected[0] === 'テキスト送信' ? message.trim()
      : selected[0] === 'マイル付与' ? `${Math.max(1, Number(amount) || 1)} mile`
        : resourceName ?? selected[0]
    onAdd({ id: crypto.randomUUID(), type: selected[1], label, timing: timing === 'immediate' ? 'すぐに' : `${delay}${delayUnit === 'minutes' ? '分' : delayUnit === 'hours' ? '時間' : '日'}後`, definition: { id: crypto.randomUUID(), type: definition.actionType, params, onFailure: 'stop' } }, position === 'before' ? selectedAction?.id : undefined)
  }

  return (
    <Drawer
      designWidth={hqV8 ? 640 : undefined}
      open
      title="連動アクションを追加"
      description="タグが付いた直後に実行する処理を選びます。"
      onClose={onClose}
      footer={(
        <div className="flex justify-end gap-2">
          <Button variant="secondary" className="px-5 py-2.5 font-medium text-ink-secondary h-auto whitespace-normal" type="button" onClick={onClose}>キャンセル</Button>
          <Button variant="primary" className="px-5 py-2.5 font-bold border-0 h-auto whitespace-normal" type="button" disabled={unavailable || (needsResource && !resourceId) || ((selected[0] === 'テキスト送信' || selected[0] === '担当者通知') && !message.trim())} onClick={add}>
            このアクションを追加する
          </Button>
        </div>
      )}
    >
          <section>
            <h3 className="mb-3 text-sm font-bold text-ink">1. アクションの種類</h3>
            <div className={hqV8 ? 'grid grid-cols-2 gap-2.5 sm:grid-cols-3' : 'grid grid-cols-2 gap-2 sm:grid-cols-3'}>
              {ACTION_TYPES.map((action) => (
                <Button variant="secondary" className={(`rounded-control border px-3 ${hqV8 ? 'py-2.5 text-caption' : 'py-3 text-sm'} text-left font-medium ${allowedActionTypes && !allowedActionTypes.includes(action[0]) ? 'cursor-not-allowed border-hairline text-ink-faint opacity-55' : selected[0] === action[0] ? 'border-accent bg-accent-soft text-accent-deep' : 'border-hairline text-ink-secondary hover:bg-canvas-sunken'}`) + ' h-auto whitespace-normal'} key={action[0]} type="button" disabled={Boolean(allowedActionTypes && !allowedActionTypes.includes(action[0]))} onClick={() => setSelected(action)}>
                  {action[0]}
                </Button>
              ))}
            </div>
            {hqV8 ? <p className="mt-2 break-normal text-micro text-ink-faint">統括のひな形で使えるのは「テキスト送信」と「マイル付与」です。ほかは配った先の店で足します。</p> : null}
          </section>

          <section className={hqV8 ? 'mt-3 border-t border-hairline pt-3' : 'mt-7 border-t border-hairline pt-6'}>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-ink">2. 実行するタイミング
              <HelpTip label="実行するタイミングの説明">時間をあけて実行すると、その時間が経ってから実行されます。待機中にタグが外れた場合は実行されません。</HelpTip>
            </h3>
            <SaveErrorField names={["timing"]}><SegmentedControl
              aria-label="実行するタイミング"
              size="timing"
              options={[{ value: 'immediate', label: 'すぐに実行' }, { value: 'delay', label: '時間をあけて実行' }]}
              value={timing}
              onChange={setTiming}
            /></SaveErrorField>
            {timing === 'delay' ? (
              <div className="mt-3 flex items-center gap-2">
                <SaveErrorField names={["delay"]}><input aria-label="実行までの待ち時間" type="number" min={1} value={delay} onChange={(event) => setDelay(event.target.value)} className={`${inputClass} max-w-28`} /></SaveErrorField>
                <SaveErrorField names={["delayUnit","delay_unit"]}><Select
                  aria-label="遅延の単位"
                  value={delayUnit}
                  onChange={(value) => setDelayUnit(value as typeof delayUnit)}
                  options={[
                    { value: 'minutes', label: '分後' },
                    { value: 'hours', label: '時間後' },
                    { value: 'days', label: '日後' },
                  ]}
                /></SaveErrorField>
              </div>
            ) : null}
          </section>

          <section className="mt-7 border-t border-hairline pt-6">
            <h3 className="mb-3 text-sm font-bold text-ink">3. {selected[0]}の内容</h3>
            {selected[0] === 'テキスト送信' || selected[0] === '担当者通知' ? (
              <SaveErrorField names={["message"]}><textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={6} className={inputClass} /></SaveErrorField>
            ) : selected[0] === 'マイル付与' ? (
              <SaveErrorField names={["amount"]}><input type="number" min={1} value={amount} onChange={(event) => setAmount(event.target.value)} className={inputClass} aria-label="付与マイル" /></SaveErrorField>
            ) : (
              <><SaveErrorField names={["resourceId","resource_id"]}><EntitySelect clearable size="full" aria-label={`${selected[0]}に使う内容を選択`} placeholder={unavailable ? 'この種類は配布先で設定してください' : resources ? `${selected[1]}を選択` : '選択肢を読み込み中…'} value={resourceId} onChange={setResourceId} disabled={unavailable || !resources} loading={!unavailable && !resources} options={choices.map((choice) => ({ ...entityOptionMetadata(choice), value: choice.id, label: choice.name }))} className="w-full" /></SaveErrorField>{referenceState && selected[0] === 'テンプレート送信' && <div className="mt-3 rounded-control bg-canvas-sunken p-3 text-xs leading-5 text-ink-secondary"><span className="font-semibold">プレビュー</span><br />選んだテンプレートの公開版を送ります。</div>}</>
            )}
            <div className="mt-3 rounded-control border border-hairline bg-canvas-sunken p-3 text-xs leading-5 text-ink-secondary">
              <span className="font-semibold">実行内容の確認：</span> {selected[0]}を{timing === 'immediate' ? 'すぐに' : `${delay}${delayUnit === 'minutes' ? '分' : delayUnit === 'hours' ? '時間' : '日'}後に`}実行します。
            </div>
          </section>

          <section className="mt-7 border-t border-hairline pt-6">
            <label className="mb-1 block text-sm font-semibold text-ink">4. 追加する位置</label>
            <SaveErrorField names={["position"]}><Select
              aria-label="追加する位置"
              value={position}
              onChange={setPosition}
              options={[
                { value: 'last', label: 'いちばん最後に追加' },
                { value: 'before', label: '選択中のアクションの前', disabled: !selectedAction },
              ]}
              size="full"
            /></SaveErrorField>
          </section>
    </Drawer>
  )
}

/**
 * 遡及実行の確認窓（N-047）。
 *
 * 人数・合計マイルはサーバーが数えたもの（/retroactive-preview）を出す。
 * 画面で勝手に数えた値を見せると、実際に付与される対象と食い違う。
 * 確認ボタンはサーバーの計算が返ってくるまで押せない。実行時は
 * previewToken を保存APIへ渡し、サーバー側で対象の再計算と照合する。
 */
export function RetroactiveDialog({ values, count, tagId, accountId, onCancel, onSaveWithoutApplying, onSave, referenceState = false }: { values: TagEditorValues; count: number; tagId: string | null; accountId: string | null; onCancel: () => void; onSaveWithoutApplying: () => void; onSave: (previewToken: string) => void; referenceState?: boolean }) {
  const [accepted, setAccepted] = useState(referenceState)
  const [preview, setPreview] = useState<TagRetroactivePreview | null>(null)
  const [previewError, setPreviewError] = useState('')
  // alertdialog にも共通の約束を合わせる: Escapeで戻る・Tabは窓の中・
  // 閉じたら起点へ戻す・背面はスクロールしない。
  const panelRef = useOverlayFocus(true, onCancel)

  const fetchPreview = () => {
    if (!tagId || !accountId) return
    setPreviewError('')
    void api.tags.retroactivePreview(tagId, accountId, {
      self: values.rewardMiles,
      referrer: values.referralRewardMiles,
    }).then((res) => {
      if (res.success) setPreview(res.data)
      else setPreviewError(res.error || '対象を再計算できませんでした')
    }).catch(() => setPreviewError('対象を再計算できませんでした'))
  }

  useEffect(() => {
    // 固定表示（visual-qa）はAPIを呼ばず、設計確認用の固定数を出す。
    if (referenceState) return
    fetchPreview()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referenceState, tagId, accountId, values.rewardMiles, values.referralRewardMiles])

  const loading = !referenceState && !preview && !previewError
  const selfTargets = preview ? preview.selfTargets : count
  const referralTargets = preview ? preview.referralTargets : Math.min(count, 34)
  const rewardTotal = preview ? preview.selfMiles : selfTargets * values.rewardMiles
  const referralTotal = preview ? preview.referralMiles : referralTargets * values.referralRewardMiles
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-ink/35 p-4">
      <section ref={panelRef} className="relative w-full max-w-[670px] -translate-y-7 rounded-card border border-hairline bg-canvas p-7 shadow-overlay" role="alertdialog" aria-modal="true" aria-labelledby="tag-retroactive-title">
        <button type="button" onClick={onCancel} aria-label="閉じる" className="absolute right-4 top-4 rounded-mini p-1 text-ink-secondary hover:bg-canvas-sunken">
          <X aria-hidden="true" className="h-5 w-5" />
        </button>
        <span className="mb-4 flex h-10 w-10 items-center justify-center rounded-pill bg-warning-bg text-warning" aria-hidden="true">
          <Coins size={21} strokeWidth={2} />
        </span>
        <h2 id="tag-retroactive-title" className="text-xl font-bold text-ink">{selfTargets + referralTargets}人にさかのぼってマイルを積みますか？</h2>
        <p className="mt-2 text-sm leading-6 text-ink-secondary">「{values.name || 'このタグ'}」の変更を、いまこのタグが付いている人にも適用します。人数はサーバーで再計算した値です。</p>
        <div className="mt-4 overflow-hidden rounded-control border border-hairline">
          <dl className="divide-y divide-hairline text-sm">
            <div className="grid grid-cols-[1fr_165px_130px] px-4 py-2.5"><dt>本人マイル</dt><dd>+{values.rewardMiles} mile × {selfTargets}人{preview && preview.selfExcluded > 0 ? `（付与済み${preview.selfExcluded}人を除く）` : ''}</dd><dd className="text-right font-semibold text-success">+{formatNumber(rewardTotal)} mile</dd></div>
            <div className="grid grid-cols-[1fr_165px_130px] px-4 py-2.5"><dt>紹介者マイル</dt><dd>+{values.referralRewardMiles} mile × {referralTargets}人{preview && preview.referralExcluded > 0 ? `（付与済み${preview.referralExcluded}人を除く）` : ''}</dd><dd className="text-right font-semibold text-success">+{formatNumber(referralTotal)} mile</dd></div>
            <div className="grid grid-cols-[1fr_165px_130px] bg-success-bg/40 px-4 py-2.5 font-medium"><dt>合計</dt><dd>{selfTargets + referralTargets}人が対象</dd><dd className="text-right text-success">+{formatNumber((rewardTotal + referralTotal))} mile</dd></div>
            <div className="grid grid-cols-[1fr_165px_130px] px-4 py-2.5"><dt>倍率 {values.multiplierBps ? `${values.multiplierBps / 10000}倍` : 'なし'}</dt><dd>さかのぼりません</dd><dd className="text-right">次回付与から</dd></div>
            <div className="grid grid-cols-[1fr_165px_130px] px-4 py-2.5"><dt>連動アクションの送信</dt><dd>さかのぼって送りません</dd><dd className="text-right">送信0件</dd></div>
          </dl>
        </div>
        <div className="mt-3 rounded-control border border-danger/25 bg-danger-bg p-3 text-xs leading-5 text-danger">
          <p className="font-bold">この操作は取り消せません</p>
          <p>さかのぼって積んだマイルは自動では戻せません。取り消すにはマイル画面から手動で調整が必要です。</p>
        </div>
        {previewError && (
          <p role="alert" className="mt-3 rounded-control border border-danger/25 bg-danger-bg p-3 text-xs leading-5 text-danger">
            {previewError}
            <button type="button" onClick={fetchPreview} className="ml-2 font-semibold underline">再計算する</button>
          </p>
        )}
        <SaveErrorField names={["accepted"]}><Checkbox className="mt-3" checked={accepted} onCheckedChange={setAccepted}>人数と合計マイルを確認しました</Checkbox></SaveErrorField>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" className="px-4 py-2.5 font-medium text-ink-secondary h-auto whitespace-normal" type="button" onClick={onSaveWithoutApplying}>反映しないで保存する</Button>
          <Button variant="primary" className="px-4 py-2.5 font-bold border-0 h-auto whitespace-normal" type="button" disabled={!accepted || loading || Boolean(previewError)} onClick={() => onSave(preview?.previewToken ?? '')}>{loading ? '対象を計算中…' : 'さかのぼって反映して保存する'}</Button>
        </div>
        <p className="mt-3 whitespace-nowrap text-xs leading-4 text-ink-faint">新規作成のときはこのダイアログは出ません。まだ誰にもタグが付いていないため、送信やマイル付与も起きません。</p>
      </section>
    </div>
  )
}
