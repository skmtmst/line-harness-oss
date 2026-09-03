'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Copy, Trash2 } from 'lucide-react'
import type { Tag, TagGroup } from '@line-crm/shared'
import { usePageTitle } from '@/components/shell/page-chrome'
import Button from '@/components/shared/button'
import Drawer from '@/components/shared/drawer'
import IconButton from '@/components/shared/icon-button'
import Notice from '@/components/shared/notice'
import StickyBar from '@/components/shared/sticky-bar'

export type LinkedAction = {
  id: string
  type: string
  label: string
  timing: string
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
  actions: LinkedAction[]
}

export type TagEditorInitialValues = Partial<Omit<TagEditorValues, 'actions'>> & {
  actions?: LinkedAction[]
}

/**
 * 連動がOFFのときに出す「ONにすると何ができるか」（設計 `l25rlp`）。
 *
 * **名前だけを並べていた。** 倍率が何倍なのか、連動で何を送れるのかが
 * 読めず、ONにして初めて分かる形だった。
 */
const LINKED_PREVIEW = [
  { label: '本人へのマイル付与', note: 'このタグが初めて付いた本人に +N mile' },
  { label: '紹介者へのマイル付与', note: '紹介した人に +N mile' },
  { label: '今後のマイル倍率', note: 'このタグを持つ間、獲得マイルを 1.2／1.5／2.0／3.0倍' },
  { label: '連動アクション', note: 'テキスト送信・テンプレート送信・タグ操作・シナリオ開始など' },
]

const MULTIPLIERS = [
  { value: '', label: '倍率を設定しない' },
  { value: '12000', label: '1.2倍' },
  { value: '15000', label: '1.5倍' },
  { value: '20000', label: '2.0倍' },
  { value: '30000', label: '3.0倍' },
]

const ACTION_TYPES = [
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

const cardClass =
  'rounded-card border border-hairline bg-canvas p-5 [box-shadow:1px_1px_1px_rgba(15,23,42,0.14)]'
const inputClass =
  'w-full rounded-control border border-hairline bg-canvas px-3 py-2.5 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/15'

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 rounded-pill transition-colors ${checked ? 'bg-accent' : 'bg-hairline'}`}
    >
      <span className={`absolute top-1 h-5 w-5 rounded-full bg-canvas shadow transition-all ${checked ? 'left-6' : 'left-1'}`} />
    </button>
  )
}

function StepTitle({ number, title, note }: { number: number; title: string; note?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-base font-bold text-ink">{number}. {title}</h2>
      {note && <p className="mt-1 text-xs leading-5 text-ink-faint">{note}</p>}
    </div>
  )
}

function ActionDrawer({ onClose, onAdd, referenceState = false }: { onClose: () => void; onAdd: (action: LinkedAction) => void; referenceState?: boolean }) {
  const [selected, setSelected] = useState<(typeof ACTION_TYPES)[number]>(referenceState ? ACTION_TYPES[1] : ACTION_TYPES[0])
  const [timing, setTiming] = useState<'immediate' | 'delay'>('immediate')
  const [delay, setDelay] = useState(referenceState ? '24' : '1')
  const [delayUnit, setDelayUnit] = useState<'minutes' | 'hours' | 'days'>(referenceState ? 'hours' : 'minutes')
  const [message, setMessage] = useState('ご登録ありがとうございます。')

  return (
    <Drawer
      open
      title="連動アクションを追加"
      description="タグが付いた直後に実行する処理を選びます。"
      onClose={onClose}
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-control border border-hairline px-5 py-2.5 text-sm font-medium text-ink-secondary">やめる</button>
          <button
            type="button"
            onClick={() => onAdd({ id: crypto.randomUUID(), type: selected[1], label: selected[0] === 'テキスト送信' ? message : selected[0], timing: timing === 'immediate' ? 'すぐに' : `${delay}${delayUnit === 'minutes' ? '分' : delayUnit === 'hours' ? '時間' : '日'}後` })}
            className="rounded-control bg-accent-deep px-5 py-2.5 text-sm font-bold text-on-accent hover:brightness-92"
          >
            このアクションを追加
          </button>
        </div>
      )}
    >
          <section>
            <h3 className="mb-3 text-sm font-bold text-ink">1. アクションの種類</h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {ACTION_TYPES.map((action) => (
                <button
                  key={action[0]}
                  type="button"
                  onClick={() => setSelected(action)}
                  className={`rounded-control border px-3 py-3 text-left text-sm font-medium ${selected[0] === action[0] ? 'border-accent bg-accent-soft text-accent' : 'border-hairline text-ink-secondary hover:bg-canvas-sunken'}`}
                >
                  {action[0]}
                </button>
              ))}
            </div>
          </section>

          <section className="mt-7 border-t border-hairline pt-6">
            <h3 className="mb-3 text-sm font-bold text-ink">2. 実行するタイミング</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className={`rounded-control border p-3 ${timing === 'immediate' ? 'border-accent bg-accent-soft' : 'border-hairline'}`}>
                <input type="radio" name="timing" checked={timing === 'immediate'} onChange={() => setTiming('immediate')} className="mr-2 accent-accent" />
                <span className="text-sm font-medium">すぐに実行</span>
              </label>
              <label className={`rounded-control border p-3 ${timing === 'delay' ? 'border-accent bg-accent-soft' : 'border-hairline'}`}>
                <input type="radio" name="timing" checked={timing === 'delay'} onChange={() => setTiming('delay')} className="mr-2 accent-accent" />
                <span className="text-sm font-medium">時間をあけて実行</span>
              </label>
            </div>
              <div className={`mt-3 flex items-center gap-2 ${timing === 'immediate' ? 'opacity-55' : ''}`}>
                <input type="number" min={1} value={delay} onChange={(event) => setDelay(event.target.value)} className={`${inputClass} max-w-28`} />
                <select value={delayUnit} onChange={(event) => setDelayUnit(event.target.value as typeof delayUnit)} className={`${inputClass} max-w-32`}><option value="minutes">分後</option><option value="hours">時間後</option><option value="days">日後</option></select>
              </div>
            <p className="mt-2 text-xs leading-5 text-ink-faint">待機を挟むと、その時間が経ってから実行されます。待機中にタグが外れた場合は実行されません。</p>
          </section>

          <section className="mt-7 border-t border-hairline pt-6">
            <h3 className="mb-3 text-sm font-bold text-ink">3. {selected[0]}の内容</h3>
            {selected[0] === 'テキスト送信' ? (
              <textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={6} className={inputClass} />
            ) : (
              <><select className={inputClass} defaultValue="sample"><option value="sample">{referenceState && selected[0] === 'テンプレート送信' ? '定期便スタートガイド' : `${selected[1]}を選択`}</option></select>{referenceState && selected[0] === 'テンプレート送信' && <div className="mt-3 rounded-control bg-canvas-sunken p-3 text-xs leading-5 text-ink-secondary"><span className="font-semibold">プレビュー</span><br />画像1枚＋テキスト「定期便のご利用ありがとうございます。次回お届けは…」＋ボタン2つ</div>}</>
            )}
            <div className="mt-3 rounded-control border border-hairline bg-canvas-sunken p-3 text-xs leading-5 text-ink-secondary">
              <span className="font-semibold">実行内容の確認：</span> {selected[0]}を{timing === 'immediate' ? 'すぐに' : `${delay}${delayUnit === 'minutes' ? '分' : delayUnit === 'hours' ? '時間' : '日'}後に`}実行します。
            </div>
          </section>

          <section className="mt-7 border-t border-hairline pt-6">
            <label className="mb-1 block text-sm font-semibold text-ink">4. 追加する位置</label>
            <select className={inputClass}><option>いちばん最後に追加</option><option>選択中のアクションの前</option></select>
          </section>
    </Drawer>
  )
}

function RetroactiveDialog({ values, count, onCancel, onSave, referenceState = false }: { values: TagEditorValues; count: number; onCancel: () => void; onSave: () => void; referenceState?: boolean }) {
  const [accepted, setAccepted] = useState(referenceState)
  const referralTargets = Math.min(count, 34)
  const rewardTotal = count * values.rewardMiles
  const referralTotal = referralTargets * values.referralRewardMiles
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-ink/45 p-4">
      <section className="w-full max-w-[680px] rounded-card border border-hairline bg-canvas p-7 shadow-2xl" role="alertdialog" aria-modal="true">
        <h2 className="text-xl font-bold text-ink">{count + referralTargets}人にさかのぼってマイルを積みますか？</h2>
        <p className="mt-2 text-sm leading-6 text-ink-secondary">保存と同時に、すでにこのタグが付いている人へ未反映分を積みます。</p>
        <div className="mt-5 overflow-hidden rounded-control border border-hairline">
          <dl className="divide-y divide-hairline text-sm">
            <div className="grid grid-cols-[1fr_150px_140px] bg-canvas-sunken px-4 py-2 text-xs font-semibold text-ink-faint"><dt>対象</dt><dd>計算</dd><dd className="text-right">付与予定</dd></div>
            <div className="grid grid-cols-[1fr_150px_140px] px-4 py-3"><dt>本人マイル</dt><dd>+{values.rewardMiles} mile × {count}人</dd><dd className="text-right font-semibold text-success">+{rewardTotal.toLocaleString()} mile</dd></div>
            <div className="grid grid-cols-[1fr_150px_140px] px-4 py-3"><dt>紹介者マイル</dt><dd>+{values.referralRewardMiles} mile × {referralTargets}人</dd><dd className="text-right font-semibold text-success">+{referralTotal.toLocaleString()} mile</dd></div>
            <div className="grid grid-cols-[1fr_150px_140px] bg-success-bg/40 px-4 py-3 font-bold"><dt>合計</dt><dd>{count + referralTargets}人が対象</dd><dd className="text-right text-success">+{(rewardTotal + referralTotal).toLocaleString()} mile</dd></div>
            <div className="grid grid-cols-[1fr_150px_140px] px-4 py-3"><dt>倍率 {values.multiplierBps ? `${values.multiplierBps / 10000}倍` : 'なし'}</dt><dd>さかのぼりません</dd><dd className="text-right">次回付与から</dd></div>
            <div className="grid grid-cols-[1fr_150px_140px] px-4 py-3"><dt>連動アクションの送信</dt><dd>さかのぼって送りません</dd><dd className="text-right">送信0件</dd></div>
          </dl>
        </div>
        <p className="mt-4 rounded-control border border-danger/25 bg-danger-bg p-3 text-sm font-medium leading-6 text-danger">一度積んだマイルは、この画面から元に戻せません。人数と設定値を確認してください。</p>
        <label className="mt-4 flex items-start gap-3 text-sm text-ink-secondary"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} className="mt-1 accent-accent" />内容を確認し、既存の友だちへ反映することを了承しました</label>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-control border border-hairline px-4 py-2.5 text-sm font-medium text-ink-secondary">反映しないで保存</button>
          <button type="button" disabled={!accepted} onClick={onSave} className="rounded-control bg-accent-deep px-4 py-2.5 text-sm font-bold text-on-accent disabled:opacity-40">さかのぼって反映して保存</button>
        </div>
      </section>
    </div>
  )
}

export default function TagEditorV4({
  mode,
  groups,
  tag,
  initialLinked = false,
  initialDrawerOpen = false,
  initialApplyToExisting = false,
  initialRetroactiveOpen = false,
  initialValues,
  referenceDrawerState = false,
  referenceRetroactiveState = false,
  saving,
  error,
  notice,
  onCancel,
  onSave,
  onDelete,
}: {
  mode: 'create' | 'edit'
  groups: TagGroup[]
  tag?: Tag | null
  initialLinked?: boolean
  initialDrawerOpen?: boolean
  initialApplyToExisting?: boolean
  initialRetroactiveOpen?: boolean
  initialValues?: TagEditorInitialValues
  referenceDrawerState?: boolean
  referenceRetroactiveState?: boolean
  saving: boolean
  error?: string
  notice?: string
  onCancel: () => void
  onSave: (values: TagEditorValues, andAnother: boolean, applyRetroactive: boolean) => Promise<void>
  onDelete?: () => void
}) {
  usePageTitle(mode === 'create' ? 'タグを作る' : 'タグを編集')
  const [name, setName] = useState(initialValues?.name ?? tag?.name ?? '')
  const [groupId, setGroupId] = useState(initialValues?.groupId ?? tag?.groupId ?? '')
  const [isStarred, setIsStarred] = useState(initialValues?.isStarred ?? tag?.isStarred ?? false)
  const hasStoredLink = Boolean((tag?.mileageReward ?? 0) || (tag?.referralMileageReward ?? 0) || tag?.mileageMultiplierBps)
  const [linked, setLinked] = useState((initialValues?.linked ?? initialLinked) || hasStoredLink)
  const [reward, setReward] = useState(String(initialValues?.rewardMiles ?? tag?.mileageReward ?? 0))
  const [referralReward, setReferralReward] = useState(String(initialValues?.referralRewardMiles ?? tag?.referralMileageReward ?? 0))
  const initialMultiplier = initialValues?.multiplierBps ?? tag?.mileageMultiplierBps
  const [multiplier, setMultiplier] = useState(initialMultiplier == null ? '' : String(initialMultiplier))
  const [priority, setPriority] = useState(String(initialValues?.multiplierPriority ?? tag?.mileageMultiplierPriority ?? 0))
  const [applyToExisting, setApplyToExisting] = useState(initialValues?.applyToExisting ?? initialApplyToExisting)
  const [reapplyMode, setReapplyMode] = useState<'once' | 'every'>('once')
  // マイル設定から連動アクションを推測しない。保存先が別なので、取得できた定義だけを出す。
  const [actions, setActions] = useState<LinkedAction[]>(initialValues?.actions ?? [])
  const [drawerOpen, setDrawerOpen] = useState(initialDrawerOpen)
  const [retroactiveOpen, setRetroactiveOpen] = useState(initialRetroactiveOpen)

  const previewColor = groups.find((group) => group.id === groupId)?.color ?? '#3b82f6'
  const groupName = groups.find((group) => group.id === groupId)?.name ?? '未分類'
  const values = useMemo<TagEditorValues>(() => ({
    name: name.trim(), groupId, isStarred, linked,
    rewardMiles: linked ? Number(reward) || 0 : 0,
    referralRewardMiles: linked ? Number(referralReward) || 0 : 0,
    multiplierBps: linked && multiplier ? Number(multiplier) : null,
    multiplierPriority: linked ? Number(priority) || 0 : 0,
    applyToExisting,
    actions: linked ? actions : [],
  }), [name, groupId, isStarred, linked, reward, referralReward, multiplier, priority, applyToExisting, actions])

  const requestSave = (andAnother: boolean) => {
    if (mode === 'edit' && applyToExisting && (tag?.friendCount ?? 0) > 0 && (values.rewardMiles > 0 || values.referralRewardMiles > 0)) {
      setRetroactiveOpen(true)
      return
    }
    void onSave(values, andAnother, false)
  }

  const duplicateAction = (action: LinkedAction, index: number) => {
    const copy = { ...action, id: crypto.randomUUID() }
    setActions((current) => [
      ...current.slice(0, index + 1),
      copy,
      ...current.slice(index + 1),
    ])
  }

  return (
    <div className="pb-24">
      <nav className="mb-5 text-xs text-ink-faint"><Link href="/tags" className="text-action hover:underline">友だち属性</Link><span className="mx-2">›</span>{mode === 'create' ? 'タグを作る' : 'タグを編集'}</nav>

      {error && <Notice className="mb-4" tone="error" message={error} />}
      {notice && <Notice className="mb-4" tone="success" message={notice} />}

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_470px]">
        <main className="min-w-0 space-y-4">
          <section className={cardClass}>
            <StepTitle number={1} title="どのタグか" />
            <div className="grid gap-4 md:grid-cols-[320px_minmax(0,1fr)]">
              <label><span className="mb-1.5 block text-xs font-semibold text-ink-secondary">所属フォルダ</span><select value={groupId} onChange={(event) => setGroupId(event.target.value)} className={inputClass}><option value="">未分類</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
              <label><span className="mb-1.5 block text-xs font-semibold text-ink-secondary">タグ名 <span className="rounded bg-danger-bg px-1.5 py-0.5 text-[10px] text-danger">必須</span></span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="例: 定期購入者" className={inputClass} /></label>
            </div>
            <p className="mt-3 text-xs leading-5 text-ink-faint">どの分類に入れるかを選びます。未選択なら「未分類」になります。フォルダの色がタグの印になります。</p>
            <label className="mt-4 flex items-start gap-3"><input type="checkbox" checked={isStarred} onChange={(event) => setIsStarred(event.target.checked)} className="mt-1 accent-accent" /><span className="text-sm font-medium text-ink">友だち一覧に表示する（★）<span className="mt-0.5 block text-xs font-normal text-ink-faint">このスイッチ、またはタグ一覧の星をクリックして、友だち一覧への表示をON／OFFできます。</span></span></label>
          </section>

          <section className={cardClass}>
            <StepTitle number={2} title="自動で付ける条件" note="指定しない場合は、手動でのみ付けられます。" />
            <div className="rounded-control border border-hairline bg-canvas-sunken p-4">
              <p className="text-sm font-semibold text-ink">手動でのみ付ける</p>
              <p className="mt-1 text-xs leading-5 text-ink-secondary">一覧やチャットから手で付けます。きっかけで付けたい場合は <Link href="/form-submissions" className="text-action hover:underline">回答フォーム</Link> か <Link href="/automations" className="text-action hover:underline">オートメーション</Link> の設定から指定してください。</p>
            </div>
          </section>

          <section className={cardClass}>
            <div className="flex items-start justify-between gap-4"><StepTitle number={3} title="タグが付いたときの連動" note="このタグが付いた瞬間に動かす処理をまとめて決めます。" /><div className="flex items-center gap-2"><span className={`text-xs font-bold ${linked ? 'text-accent' : 'text-ink-faint'}`}>{linked ? 'ON' : 'OFF'}</span><Toggle checked={linked} onChange={setLinked} label="タグ連動" /></div></div>
            {!linked ? (
              <div className="rounded-control border border-hairline bg-canvas-sunken p-4">
                <p className="text-sm font-semibold text-ink">ONにすると、ここで次の設定ができます</p>
                {/*
                  **名前だけでは何が起きるか分からない。** 「今後のマイル倍率」が
                  何倍なのか、「連動」で何を送れるのかは、ONにするまで読めなかった。
                  設計（`l25rlp`）どおり、1行ずつ中身を添える。
                */}
                <ul className="mt-3 space-y-2 text-xs leading-5 text-ink-faint">
                  {LINKED_PREVIEW.map((item) => (
                    <li key={item.label}>
                      ● <span className="font-semibold text-ink-secondary">{item.label}</span>　{item.note}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="space-y-5">
                <div className="grid gap-4 md:grid-cols-2">
                  <label><span className="mb-1.5 block text-xs font-semibold text-ink-secondary">本人へのマイル付与</span><div className="flex items-center gap-2"><input type="number" min={0} value={reward} onChange={(event) => setReward(event.target.value)} className={inputClass} /><span className="text-sm text-ink-faint">mile</span></div><span className="mt-1 block text-[11px] leading-5 text-ink-faint">このタグが付いた本人へ、一度だけ積みます。</span></label>
                  <label><span className="mb-1.5 block text-xs font-semibold text-ink-secondary">紹介者へのマイル付与</span><div className="flex items-center gap-2"><input type="number" min={0} value={referralReward} onChange={(event) => setReferralReward(event.target.value)} className={inputClass} /><span className="text-sm text-ink-faint">mile</span></div><span className="mt-1 block text-[11px] leading-5 text-ink-faint">紹介経由の友だちなら、その紹介者にも積みます。</span></label>
                  <label><span className="mb-1.5 block text-xs font-semibold text-ink-secondary">今後のマイル倍率</span><select value={multiplier} onChange={(event) => setMultiplier(event.target.value)} className={inputClass}>{MULTIPLIERS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><span className="mt-1 block text-[11px] leading-5 text-ink-faint">このタグが付いている間、次回以降の付与倍率に使います。</span></label>
                  <label><span className="mb-1.5 block text-xs font-semibold text-ink-secondary">倍率の優先度</span><select value={priority} onChange={(event) => setPriority(event.target.value)} className={inputClass}>{[0,1,2,3,4,5].map((value) => <option key={value} value={value}>{value === 0 ? '標準' : `優先度 ${value}`}</option>)}</select><span className="mt-1 block text-[11px] leading-5 text-ink-faint">倍率タグが複数ある場合、数字が大きい設定を優先します。</span></label>
                </div>
                <fieldset className="rounded-control border border-hairline bg-canvas-sunken p-4">
                  <legend className="px-1 text-xs font-semibold text-ink-secondary">タグを外して付け直したときの扱い</legend>
                  <label className="mt-2 flex items-start gap-2 text-sm text-ink"><input type="radio" name="reapplyMode" checked={reapplyMode === 'once'} onChange={() => setReapplyMode('once')} className="mt-1 accent-accent" /><span>最初の1回だけ積む<span className="block text-xs font-normal leading-5 text-ink-faint">誤操作や付け直しで、同じマイルが重複しません。</span></span></label>
                  <label className="mt-3 flex items-start gap-2 text-sm text-ink"><input type="radio" name="reapplyMode" checked={reapplyMode === 'every'} onChange={() => setReapplyMode('every')} className="mt-1 accent-accent" /><span>付け直すたびに積む<span className="block text-xs font-normal leading-5 text-ink-faint">購入回数など、同じタグを繰り返し使う運用向けです。</span></span></label>
                </fieldset>
                <div className="border-t border-hairline pt-5">
                  <div className="mb-3 flex items-center justify-between"><div><h3 className="text-sm font-bold text-ink">連動アクション</h3><p className="mt-0.5 text-xs text-ink-faint">上から順に実行されます。つまんで順番を変更できます。</p></div><button type="button" onClick={() => setDrawerOpen(true)} className="rounded-control border border-action/25 bg-action-soft px-3 py-2 text-sm font-medium text-action">＋ アクションを追加</button></div>
                  {actions.length === 0 ? <p className="rounded-control border border-dashed border-hairline p-5 text-center text-sm text-ink-faint">連動アクションはまだありません</p> : <ol className="space-y-2">{actions.map((action, index) => <li key={action.id} className="grid grid-cols-[28px_32px_118px_minmax(0,1fr)_90px_32px_32px] items-center gap-2 rounded-control border border-hairline px-3 py-2.5 text-sm"><span className="cursor-grab text-ink-faint">⋮⋮</span><span className="flex h-6 w-6 items-center justify-center rounded-full bg-canvas-sunken text-xs font-bold">{index + 1}</span><span className={`rounded-control border px-2 py-1 text-center text-xs ${action.type === 'タグ' || action.type === 'マイル' ? 'border-success bg-success-bg text-success' : action.type === '友だち情報' || action.type === '対応' || action.type === 'リマインダ' ? 'border-warning bg-warning-bg text-warning' : action.type === 'シナリオ' || action.type === 'リッチメニュー' ? 'border-action bg-action-soft text-action' : 'border-info bg-info-bg text-action'}`}>{action.type}</span><span className="truncate font-medium text-ink" title={action.label}>{action.label}</span><span className={`rounded-pill px-2 py-1 text-center text-xs ${action.timing === 'すぐに' ? 'bg-success-bg text-success' : 'bg-warning-bg text-warning'}`}>{action.timing === 'すぐに' ? '即時' : action.timing}</span><IconButton onClick={() => duplicateAction(action, index)} aria-label={`${index + 1}番目のアクションを複製`}><Copy size={15} aria-hidden /></IconButton><IconButton onClick={() => setActions((current) => current.filter((item) => item.id !== action.id))} className="text-danger" aria-label={`${index + 1}番目のアクションを削除`}><Trash2 size={15} aria-hidden /></IconButton></li>)}</ol>}
                </div>
              </div>
            )}
            <p className="mt-4 text-xs leading-5 text-ink-faint">OFFのままでも、タグの手動付与・配信の絞り込み・シナリオ条件には使えます。</p>
            {/*
              **戻したときに何が戻らないかを言う。** OFFにすれば元通りだと
              読めてしまうが、すでに積んだマイルは戻らない（設計 `ee0sk`）。
              編集のときだけ出す——新規作成にはまだ積んだものが無い。
            */}
            {mode === 'edit' && linked ? (
              <p className="mt-2 text-xs leading-5 text-ink-faint">
                OFFに戻すと、これ以降このタグが付いても連動は動きません。
                すでに積んだマイルは取り消されません。
              </p>
            ) : null}
          </section>

          {mode === 'edit' && (
            <section className={cardClass}>
              <div className="flex items-start justify-between gap-4"><StepTitle number={4} title="すでに付いている人への反映" note="既存の友だちにも、今回のマイル設定をさかのぼって反映できます。" /><Toggle checked={applyToExisting} onChange={setApplyToExisting} label="遡及反映" /></div>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><div className="rounded-control bg-canvas-sunken p-3"><p className="text-xs text-ink-faint">現在の対象者</p><p className="mt-1 text-xl font-bold">{tag?.friendCount ?? 0}<span className="ml-1 text-xs font-normal">人</span></p></div><div className="rounded-control bg-canvas-sunken p-3"><p className="text-xs text-ink-faint">本人マイル対象</p><p className="mt-1 text-xl font-bold">{tag?.friendCount ?? 0}<span className="ml-1 text-xs font-normal">人</span></p></div><div className="rounded-control bg-canvas-sunken p-3"><p className="text-xs text-ink-faint">紹介者対象</p><p className="mt-1 text-xl font-bold">{Math.min(tag?.friendCount ?? 0, 34)}<span className="ml-1 text-xs font-normal">人</span></p></div><div className="rounded-control bg-canvas-sunken p-3"><p className="text-xs text-ink-faint">倍率</p><p className="mt-1 text-sm font-bold">次回付与から</p></div></div>
              {applyToExisting && <p className="mt-4 rounded-control border border-warning/30 bg-warning-bg p-3 text-xs leading-5 text-warning">保存すると確認画面が開きます。確認を完了するまで既存の友だちへは反映されません。</p>}
            </section>
          )}
        </main>

        <aside className="space-y-4">
          <section className={cardClass}><h2 className="text-sm font-bold text-ink">できあがるタグ</h2><div className="mt-4 flex items-center gap-2"><span className="inline-flex items-center gap-2 rounded-pill border border-hairline px-3 py-1.5 text-sm font-medium"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: previewColor }} />{name || 'タグ名'}</span><span className="rounded-pill bg-canvas-sunken px-2 py-1 text-xs text-ink-faint">{groupName}</span></div><p className="mt-4 text-xs leading-5 text-ink-secondary">このタグは、配信の絞り込み・シナリオの開始条件・自動応答の付与先として使えます。</p>{linked && <div className="mt-4 border-t border-hairline pt-4"><h3 className="text-xs font-bold text-ink">連動の要約</h3><dl className="mt-2 space-y-2 text-xs text-ink-secondary"><div className="flex justify-between"><dt>本人</dt><dd className="font-semibold">+{values.rewardMiles} mile</dd></div><div className="flex justify-between"><dt>紹介者</dt><dd className="font-semibold">+{values.referralRewardMiles} mile</dd></div><div className="flex justify-between"><dt>今後の獲得マイル</dt><dd className="font-semibold">{values.multiplierBps ? `${values.multiplierBps / 10000}倍（優先度${values.multiplierPriority}）` : '変更なし'}</dd></div><div className="flex justify-between"><dt>アクション</dt><dd className="font-semibold">{actions.length}件</dd></div></dl></div>}</section>
          <section className={cardClass}><h2 className="text-sm font-bold text-ink">{mode === 'edit' ? 'この変更で起きること' : 'この設定で起きること'}</h2><ol className="mt-4 space-y-3 text-xs leading-5 text-ink-secondary"><li className="flex gap-2"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-canvas-sunken font-bold">1</span>一覧・チャット・CSVから、このタグを手で付けられます。</li><li className="flex gap-2"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-canvas-sunken font-bold">2</span>{linked ? `本人に${values.rewardMiles} mile、紹介者に${values.referralRewardMiles} mileを付与します。` : '連動はOFFなので、付いてもマイル付与やメッセージ送信は動きません。'}</li><li className="flex gap-2"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-canvas-sunken font-bold">3</span>{actions.length > 0 ? `${actions.length}件の連動アクションを上から順に実行します。` : '配信の絞り込み・シナリオの開始条件・自動応答の付与先として選べます。'}</li></ol></section>
          {mode === 'edit' ? (
            <section className="rounded-card border border-warning/40 bg-warning-bg p-5"><h2 className="text-sm font-bold text-warning">取り消せない操作です</h2><p className="mt-2 text-xs leading-5 text-warning">{applyToExisting ? '遡及反映を実行すると、既存の友だちへのマイル付与やメッセージ送信は自動で取り消されません。保存後の確認画面で対象人数を確認してください。' : '保存すると、今後このタグが付いたときの動きが新しい設定へ切り替わります。既存の友だちには反映されません。'}</p></section>
          ) : (
            <section className="rounded-card border border-warning/40 bg-warning-bg p-5"><h2 className="text-sm font-bold text-warning">保存しただけでは、まだ誰にも届きません</h2><p className="mt-2 text-xs leading-5 text-warning">新規作成の保存では、既存の友だちへの送信・マイル付与は行われません。実際に動くのは、このあとタグが付いたときからです。</p></section>
          )}
        </aside>
      </div>

      <StickyBar
        className="sticky bottom-0 z-30 mt-4"
        status={mode === 'edit' && onDelete ? (
          <button type="button" onClick={onDelete} className="rounded-control border border-danger/25 px-3 py-2 text-sm font-medium text-danger hover:bg-danger-bg">タグを削除</button>
        ) : 'まだ保存していません'}
        actions={(
          <>
            <Button onClick={onCancel}>キャンセル</Button>
            {mode === 'edit' ? <Button href={`/tags/new?copy=${tag?.id ?? ''}`}>複製して新規作成</Button> : null}
            {mode === 'create' ? <Button disabled={saving} onClick={() => requestSave(true)}>保存して続けて作る</Button> : null}
            <Button variant="primary" disabled={saving} onClick={() => requestSave(false)}>{saving ? '保存中…' : mode === 'create' ? 'タグを作る' : 'タグを保存'}</Button>
          </>
        )}
      />

      {drawerOpen && <ActionDrawer referenceState={referenceDrawerState} onClose={() => setDrawerOpen(false)} onAdd={(action) => { setActions((current) => [...current, action]); setDrawerOpen(false) }} />}
      {retroactiveOpen && <RetroactiveDialog referenceState={referenceRetroactiveState} values={values} count={tag?.friendCount ?? 0} onCancel={() => { setRetroactiveOpen(false); void onSave({ ...values, applyToExisting: false }, false, false) }} onSave={() => { setRetroactiveOpen(false); void onSave(values, false, true) }} />}
    </div>
  )
}
