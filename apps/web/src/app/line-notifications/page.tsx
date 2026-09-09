'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import MergedTabs, { useMergedTab } from '@/components/layout/merged-tabs'
import NotificationRunList from '@/components/line-notifications/notification-run-list'
import OperatorNotificationRules from './operator-notification-rules'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import ListState from '@/components/shared/list-state'
import Pagination from '@/components/shared/pagination'
import {
  ApiError,
  api,
  type EcCommerceOverview,
  type EcNotificationSetting,
  type LineNotificationDefinition,
  type LineNotificationMetric,
} from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { canOpenCustomerNotificationKpi, customerNotificationKpis } from './customer-kpis'
import styles from './customer-notifications.module.css'

const customerFilters = [
  ['all', 'すべて'],
  ['enabled', '出している'],
  ['stopped', '止めている'],
  ['incomplete', '文面が未設定'],
] as const
type CustomerFilter = typeof customerFilters[number][0]
type CustomerLoadState = 'loading' | 'ready' | 'error' | 'forbidden'
const categories = [
  ['order', '注文'],
  ['payment', '銀行振込'],
  ['shipping', '発送'],
  ['support', 'キャンセル・返金'],
  ['subscription', '定期便'],
] as const
const CUSTOMER_PAGE_SIZE = 6

/**
 * 見出しの下に、**内部のイベントキーを出さない**。
 *
 * ここは `ec_order.confirmed` のような値をそのまま描き、全文を `title` にも
 * 入れていた。設計 `Q55bb` の言う「運用者に伝わる言葉」ではないし、
 * V6の「内部IDを画面に出さない」にも反する。
 * APIが返す区分は、運用者が分かる言葉へ置き換える。
 */
function categoryLabel(value: EcNotificationSetting['category']): string {
  return categories.find(([key]) => key === value)?.[1] ?? '区分なし'
}

/** 「いつ直したか」。取れないときは数を作らず `—`。 */
function formatUpdatedAt(iso: string | null | undefined): string {
  if (!iso) return '最終更新 —'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '最終更新 —'
  return `最終更新 ${date.toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })}`
}

function isIncomplete(setting: EcNotificationSetting): boolean {
  return !setting.title?.trim() || !setting.introText.trim() || !setting.outroText.trim()
}

function triggerLabel(setting: EcNotificationSetting): string {
  return `${setting.label}とき ／ EC連携から`
}

function timingLabel(setting: EcNotificationSetting): string {
  if (setting.category === 'subscription') return '設定した日時'
  return `${setting.label}らすぐ`
}

/**
 * N-338: 一覧の「送った数が多い順」は、行の「今日」列と同じ数で降順に並べる。
 *
 * 集計がまだ無い行は末尾へ寄せる。同数は受け取った設定順のまま
 *（`Array.prototype.sort` は安定）。
 */
function sortCustomerSettingsBySentCount(
  settings: EcNotificationSetting[],
  countOf: (eventType: string) => number | null,
): EcNotificationSetting[] {
  return [...settings].sort((a, b) => (countOf(b.eventType) ?? -1) - (countOf(a.eventType) ?? -1))
}

/** N-340: 編集中の下書きは入力欄の6項目だけを残す。出・止めの切替は即保存なので入れない。 */
type CustomerEditorDraft = Pick<
  EcNotificationSetting, 'title' | 'introText' | 'outroText' | 'buttonLabel' | 'buttonUrl' | 'imageUrl'
>

function pickCustomerDraft(setting: EcNotificationSetting): CustomerEditorDraft {
  return {
    title: setting.title,
    introText: setting.introText,
    outroText: setting.outroText,
    buttonLabel: setting.buttonLabel,
    buttonUrl: setting.buttonUrl,
    imageUrl: setting.imageUrl,
  }
}

function isSameCustomerDraft(setting: EcNotificationSetting, draft: CustomerEditorDraft): boolean {
  const current = pickCustomerDraft(setting)
  return (Object.keys(current) as (keyof CustomerEditorDraft)[]).every((key) => current[key] === draft[key])
}

/**
 * N-340: 保存・公開の応答が返った時点で「送った文面」と「いま画面にある文面」が
 * 同じかを見るための指紋。
 *
 * 保存は押した瞬間の写しを送る。押したあとも入力欄は動くので、応答が返るころには
 * 画面の文面が先へ進んでいることがある。写しと指紋が違えば、その保存は
 * 「いまの文面」を保存したものではない。端末の控えを消したり未保存の印を外すと、
 * 進んだぶんの入力が再読込で消える。
 */
function customerDraftFingerprint(draft: CustomerEditorDraft): string {
  return JSON.stringify([
    draft.title ?? '', draft.introText, draft.outroText,
    draft.buttonLabel, draft.buttonUrl, draft.imageUrl,
  ])
}

/**
 * N-340: 再読込で編集中身が消えないよう、端末内に下書きを置く。
 * 鍵にアカウントを入れる。別アカウントの切替で混ざらないため。
 */
function customerDraftKey(lineAccountId: string, eventType: string): string {
  return `line-notifications:draft:v1:${lineAccountId}:${eventType}`
}

function readStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null
    return window.localStorage
  } catch { return null }
}

function readCustomerDraft(lineAccountId: string, eventType: string): CustomerEditorDraft | null {
  const storage = readStorage()
  if (!storage) return null
  try {
    const raw = storage.getItem(customerDraftKey(lineAccountId, eventType))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<CustomerEditorDraft>
    if (typeof parsed.introText !== 'string' || typeof parsed.outroText !== 'string') return null
    return {
      title: typeof parsed.title === 'string' ? parsed.title : null,
      introText: parsed.introText,
      outroText: parsed.outroText,
      buttonLabel: typeof parsed.buttonLabel === 'string' ? parsed.buttonLabel : '',
      buttonUrl: typeof parsed.buttonUrl === 'string' ? parsed.buttonUrl : '',
      imageUrl: typeof parsed.imageUrl === 'string' ? parsed.imageUrl : '',
    }
  } catch { return null }
}

function writeCustomerDraft(lineAccountId: string, eventType: string, draft: CustomerEditorDraft): void {
  try { readStorage()?.setItem(customerDraftKey(lineAccountId, eventType), JSON.stringify(draft)) } catch { /* 端末に置けないときは警告だけで続ける */ }
}

function clearCustomerDraft(lineAccountId: string, eventType: string): void {
  try { readStorage()?.removeItem(customerDraftKey(lineAccountId, eventType)) } catch { /* 同上 */ }
}

/**
 * N-341: 運用者タブの件数。読み込み前は `—`、取れなかったときは
 * `取得失敗` と出し、0件・読み込み中と区別する。
 */
type OperatorTabState = 'loading' | 'ready' | 'error' | 'forbidden'

function operatorTabCountLabel(state: OperatorTabState, count: number | null): string {
  if (state === 'ready' && count !== null) return `${count}`
  if (state === 'loading') return '—'
  return '取得失敗'
}

/**
 * N-340: 保存・公開の呼び出し口。実APIと同じ非同期境界を持たせ、
 * 遅れて返った応答や逆順応答を試験で再現できるようにする。
 */
type CustomerMutationApi = {
  updateDraft: typeof api.lineNotifications.updateDraft
  publishDefinition: typeof api.lineNotifications.publishDefinition
  stopDefinition: typeof api.lineNotifications.stopDefinition
  updateSetting: typeof api.ecCommerce.updateSetting
}

/**
 * `stale` は「サーバへの反映は終わったが、画面はもう別のアカウントを見ている」状態。
 * このときは画面へ一切書かない。前のアカウントの応答で、いま見ている
 * アカウントの設定・定義・未保存の印を上書きしないため。
 *
 * `contentSaved` は、送った文面がサーバに入ったかどうか。
 *
 * `settleDraft` は「その保存をもって、端末の控えを消し、未保存の印を外し、
 * 戻し先を更新してよいか」。文面が入っていて、なおかつ応答の時点でも
 * 同じアカウントの同じ文面のままのときだけ真になる。保存中に足された入力や、
 * アカウントを往復したあとの再編集を、古い応答で消さないための錠。
 */
type CustomerMutationOutcome =
  | {
      kind: 'applied'
      definition: LineNotificationDefinition | null
      enabled: boolean
      tone: 'success' | 'error'
      message: string
      contentSaved: boolean
      settleDraft: boolean
    }
  | { kind: 'stale'; contentSaved: boolean; settleDraft: false }
  | { kind: 'failed'; message: string; contentSaved: boolean; settleDraft: false }

/**
 * 送った文面が、いまも画面の文面と同じアカウント・同じ中身で残っているか。
 *
 * `generation`/`currentGeneration` は同一アカウント内での読み直し
 * （再読み込みボタンなど）を見分ける。`forAccountId`/`currentAccountId` は
 * アカウント切替そのものを見分ける——`currentAccountId` は描画のたびに
 * 同期して更新される ref を指すので、切替後の load() が実際に走るより前の
 * 応答でも、ここだけで正しく古いと分かる（`loadGeneration` の発火待ちに
 * 頼らない）。
 */
type CustomerMutationGuard = {
  generation: number
  currentGeneration: () => number
  forAccountId: string
  currentAccountId: () => string | null
  sentFingerprint: string
  currentFingerprint: () => string | undefined
}

function isStale(guard: CustomerMutationGuard): boolean {
  return guard.generation !== guard.currentGeneration() || guard.forAccountId !== guard.currentAccountId()
}

function canSettleDraft(guard: CustomerMutationGuard, contentSaved: boolean): boolean {
  if (!contentSaved) return false
  if (isStale(guard)) return false
  return guard.currentFingerprint() === guard.sentFingerprint
}

/** 保存できたが画面の文面が先へ進んでいるときは、そのことを言い添える。 */
function savedNotice(base: string, settled: boolean): string {
  return settled ? base : `${base}そのあとに入力した分は、まだ保存していません。`
}

function customerDraftPayload(setting: EcNotificationSetting, definition: LineNotificationDefinition) {
  return {
    lineAccountId: definition.lineAccountId,
    expectedVersion: definition.version,
    name: setting.title || setting.label,
    category: definition.category,
    sourceEventType: definition.sourceEventType,
    draft: {
      ...definition.draft,
      title: setting.title,
      introText: setting.introText,
      outroText: setting.outroText,
      buttonLabel: setting.buttonLabel,
      buttonUrl: setting.buttonUrl,
      imageUrl: setting.imageUrl,
    },
  }
}

async function saveCustomerNotification(args: {
  api: CustomerMutationApi
  accountId: string
  setting: EcNotificationSetting
  definition: LineNotificationDefinition | null
  enabled: boolean
  guard: CustomerMutationGuard
}): Promise<CustomerMutationOutcome> {
  const { setting, definition, enabled, guard } = args
  try {
    if (definition && enabled === setting.isEnabled) {
      const result = await args.api.updateDraft(definition.id, customerDraftPayload(setting, definition))
      if (!result.success) throw new Error('save failed')
      if (isStale(guard)) return { kind: 'stale', contentSaved: true, settleDraft: false }
      const settleDraft = canSettleDraft(guard, true)
      return {
        kind: 'applied', definition: result.data, enabled, tone: 'success',
        message: savedNotice(`${setting.label}の下書きを保存しました。`, settleDraft),
        contentSaved: true, settleDraft,
      }
    }
    if (definition) {
      const result = enabled
        ? await args.api.publishDefinition(definition.id, { lineAccountId: definition.lineAccountId, expectedVersion: definition.version })
        : await args.api.stopDefinition(definition.id, { lineAccountId: definition.lineAccountId, expectedVersion: definition.version })
      if (!result.success) throw new Error('status failed')
      // 出す・止めるの切替は文面を送っていない。編集中の文面には触れない。
      if (isStale(guard)) return { kind: 'stale', contentSaved: false, settleDraft: false }
      return {
        kind: 'applied', definition: result.data, enabled, tone: 'success',
        message: `${setting.label}を保存しました。`, contentSaved: false, settleDraft: false,
      }
    }
    await args.api.updateSetting(args.accountId, setting.eventType, {
      // 見出しは呼び出し側で入力済みを確かめている。型の上の null だけをここで畳む。
      isEnabled: enabled, title: setting.title ?? '', introText: setting.introText, outroText: setting.outroText,
      buttonLabel: setting.buttonLabel, buttonUrl: setting.buttonUrl, imageUrl: setting.imageUrl,
    })
    if (isStale(guard)) return { kind: 'stale', contentSaved: true, settleDraft: false }
    const settleDraft = canSettleDraft(guard, true)
    return {
      kind: 'applied', definition: null, enabled, tone: 'success',
      message: savedNotice(`${setting.label}を保存しました。`, settleDraft),
      contentSaved: true, settleDraft,
    }
  } catch {
    if (isStale(guard)) return { kind: 'stale', contentSaved: false, settleDraft: false }
    return { kind: 'failed', message: `${setting.label}を保存できませんでした。`, contentSaved: false, settleDraft: false }
  }
}

/**
 * 公開は「いま編集している内容」を出すもの。
 * 先に下書きを保存し、その成功で返った版番号で公開する。
 *
 * 保存を挟まないと、編集中の内容を捨てて古い公開版をもう一度出したうえで
 * 端末の控えまで消してしまい、編集内容が失われる。保存できなければ公開しない。
 */
async function publishCustomerNotification(args: {
  api: CustomerMutationApi
  setting: EcNotificationSetting
  definition: LineNotificationDefinition
  guard: CustomerMutationGuard
}): Promise<CustomerMutationOutcome> {
  const { setting, definition, guard } = args
  let saved: LineNotificationDefinition
  try {
    const result = await args.api.updateDraft(definition.id, customerDraftPayload(setting, definition))
    if (!result.success) throw new Error('save before publish failed')
    saved = result.data
  } catch {
    if (isStale(guard)) return { kind: 'stale', contentSaved: false, settleDraft: false }
    return {
      kind: 'failed',
      message: `${setting.label}の下書きを保存できなかったため、公開していません。編集内容はそのまま残しています。`,
      contentSaved: false, settleDraft: false,
    }
  }
  try {
    const result = await args.api.publishDefinition(saved.id, { lineAccountId: saved.lineAccountId, expectedVersion: saved.version })
    if (!result.success) throw new Error('publish failed')
    if (isStale(guard)) return { kind: 'stale', contentSaved: true, settleDraft: false }
    const settleDraft = canSettleDraft(guard, true)
    return {
      kind: 'applied', definition: result.data, enabled: true, tone: settleDraft ? 'success' : 'error',
      message: savedNotice(`${setting.label}を公開しました。`, settleDraft),
      contentSaved: true, settleDraft,
    }
  } catch {
    // 下書きは入った。残っているのは公開だけ。
    if (isStale(guard)) return { kind: 'stale', contentSaved: true, settleDraft: false }
    const settleDraft = canSettleDraft(guard, true)
    return {
      kind: 'applied', definition: saved, enabled: setting.isEnabled, tone: 'error',
      message: savedNotice(`${setting.label}を公開できませんでした。編集内容は下書きとして保存済みです。もう一度公開を押してください。`, settleDraft),
      contentSaved: true, settleDraft,
    }
  }
}

const TABS = [
  { key: 'customer', label: '顧客へのお知らせ' },
  { key: 'operator', label: '運用者へのお知らせ' },
  { key: 'failures', label: '送れなかったもの' },
  { key: 'history', label: '記録' },
] as const

function Toggle({ setting, busy, onToggle }: { setting: EcNotificationSetting; busy: boolean; onToggle: () => void }) {
  return <button type="button" role="switch" aria-checked={setting.isEnabled} aria-label={`${setting.label}のお知らせを出す・止める`} disabled={busy} onClick={onToggle}
    className={`inline-flex h-7 w-12 shrink-0 items-center rounded-full p-1 transition-colors disabled:opacity-50 ${setting.isEnabled ? 'bg-accent' : 'bg-hairline'}`}>
    <span className={`h-5 w-5 rounded-full bg-canvas shadow-sm transition-transform ${setting.isEnabled ? 'translate-x-5' : ''}`} />
  </button>
}

function CardPreview({ setting }: { setting: EcNotificationSetting }) {
  return <div className="border-nen-border bg-nen-ivory overflow-hidden rounded-[24px] border shadow-lg">
    {setting.imageUrl && <img src={setting.imageUrl} alt="" className="aspect-[20/9] w-full object-cover" />}
    <div className="p-5">
      <div className="border-nen-gold-soft flex items-center gap-2 border-b pb-3">
        <span className="text-nen-gold font-serif text-xl font-bold">然</span>
        <span className="text-nen-green text-[10px] font-bold tracking-[.22em]">NEN</span>
        <span className="text-nen-label ml-auto text-[10px] font-semibold">LINE NOTIFICATION</span>
      </div>
      <h3 className="text-nen-green mt-4 text-xl font-bold leading-7">{setting.title}</h3>
      {setting.introText && <p className="text-nen-copy mt-3 whitespace-pre-wrap text-sm leading-6">{setting.introText}</p>}
      <div className="border-nen-gold-soft mt-4 space-y-3 border-t pt-4">
        {setting.fixedFields.slice(0, 5).map((field, index) => <div key={field}>
          <p className="text-nen-label text-[10px] font-bold">{field}</p>
          <p className="text-nen-ink mt-0.5 text-sm">{index === 0 ? 'NEN-TEST-001' : index === 1 ? '鹿肉ミンチ × 2' : '注文情報から自動表示'}</p>
        </div>)}
      </div>
      {setting.outroText && <p className="text-nen-muted mt-4 whitespace-pre-wrap text-xs leading-5">{setting.outroText}</p>}
      {setting.buttonLabel && <div className="bg-nen-green text-on-accent mt-5 rounded-xl px-4 py-3 text-center text-sm font-semibold">{setting.buttonLabel}</div>}
    </div>
  </div>
}

function CustomerNotificationEditor({
  setting,
  definition,
  busy,
  onChange,
  onClose,
  onPublish,
  onSave,
  onTestSend,
  notice,
  hasUnsaved,
}: {
  setting: EcNotificationSetting
  definition: LineNotificationDefinition | null
  busy: boolean
  onChange: (patch: Partial<EcNotificationSetting>) => void
  onClose: () => void
  onPublish: () => void
  onSave: () => void
  onTestSend: () => void
  notice: { tone: 'success' | 'error'; text: string } | null
  hasUnsaved: boolean
}) {
  return <main data-design-node="Q55bb" className="min-w-0 space-y-4 pb-48 sm:pb-24">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-xs font-semibold text-accent">LINE通知　›　お知らせの種類</p>
        <p className="mt-2 text-xl font-bold text-ink">「{setting.title?.trim() || setting.label}」を編集する</p>
        <p className="mt-1 text-xs text-ink-faint">{definition ? `公開版 ${definition.currentVersionNumber ? `v${definition.currentVersionNumber}` : 'なし'} ／ 編集中の下書き` : '公開中の内容を編集します。保存した内容は次の通知から使われます。'}</p>
        {hasUnsaved ? <p className="mt-1 text-xs font-semibold text-warning">未保存の変更があります</p> : null}
      </div>
      <Button onClick={onTestSend} disabled={busy}>自分にテスト送信</Button>
    </div>
    {notice && <div className={`rounded-control border px-4 py-3 text-sm ${notice.tone === 'success' ? 'border-success bg-success-bg text-success' : 'border-danger bg-danger-bg text-danger'}`}>{notice.text}</div>}

    {/* N-337: 狭い幅では見本を下に回す。390pxを無条件に横置きしない。 */}
    <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_390px]">
      <div className="min-w-0 space-y-4">
        <section className="rounded-card border border-hairline bg-canvas p-4">
          <h2 className="font-bold text-ink">いつ送りますか</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <div><p className="text-xs font-semibold text-ink-faint">きっかけ</p><p className="mt-1 rounded-control border border-hairline px-3 py-2.5 text-sm text-ink">{triggerLabel(setting)}</p></div>
            <div><p className="text-xs font-semibold text-ink-faint">送りかた</p><p className="mt-1 rounded-control border border-hairline px-3 py-2.5 text-sm text-ink">{timingLabel(setting)}</p></div>
            <div><p className="text-xs font-semibold text-ink-faint">送らない相手</p><p className="mt-1 rounded-control border border-hairline px-3 py-2.5 text-sm text-ink">なし（全員に送る）</p></div>
          </div>
        </section>

        <section className="rounded-card border border-hairline bg-canvas p-4">
          <h2 className="font-bold text-ink">送るもの</h2>
          <div className="mt-3 space-y-4">
            <label className="block text-sm font-semibold text-ink-secondary">通知の見出し<input value={setting.title ?? ''} maxLength={80} onChange={(event) => onChange({ title: event.target.value })} className="mt-1.5 w-full rounded-control border border-hairline bg-white px-3 py-2.5 font-normal text-ink" /></label>
            <label className="block text-sm font-semibold text-ink-secondary">ご案内文<textarea value={setting.introText} maxLength={800} rows={5} onChange={(event) => onChange({ introText: event.target.value })} className="mt-1.5 w-full rounded-control border border-hairline bg-white px-3 py-2.5 font-normal leading-6 text-ink" /></label>
            <div className="rounded-control border border-nen-border bg-nen-ivory p-4">
              <p className="text-sm font-bold text-nen-green">このお知らせで差し込める項目（EC連携から来ます）</p>
              <div className="mt-2 flex flex-wrap gap-2">{setting.fixedFields.map((field) => <span key={field} className="rounded-pill bg-canvas px-2.5 py-1 text-xs text-nen-chip ring-1 ring-nen-gold-soft">{field}</span>)}</div>
            </div>
            <label className="block text-sm font-semibold text-ink-secondary">結びの文章<textarea value={setting.outroText} maxLength={800} rows={3} onChange={(event) => onChange({ outroText: event.target.value })} className="mt-1.5 w-full rounded-control border border-hairline bg-white px-3 py-2.5 font-normal leading-6 text-ink" /></label>
          </div>
        </section>

        <section className="rounded-card border border-hairline bg-canvas p-4">
          <h2 className="font-bold text-ink">ボタン</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-semibold text-ink-secondary">ボタンの文字<input value={setting.buttonLabel} maxLength={20} onChange={(event) => onChange({ buttonLabel: event.target.value })} className="mt-1.5 w-full rounded-control border border-hairline bg-white px-3 py-2.5 font-normal" /></label>
            <label className="block text-sm font-semibold text-ink-secondary">押したときに開く先<input value={setting.buttonUrl} placeholder="注文情報のURLを使う場合は空欄" onChange={(event) => onChange({ buttonUrl: event.target.value })} className="mt-1.5 w-full rounded-control border border-hairline bg-white px-3 py-2.5 font-normal" /></label>
          </div>
          <label className="mt-3 block text-sm font-semibold text-ink-secondary">カード画像URL<input value={setting.imageUrl} placeholder="未設定の場合はロゴ中心のカード" onChange={(event) => onChange({ imageUrl: event.target.value })} className="mt-1.5 w-full rounded-control border border-hairline bg-white px-3 py-2.5 font-normal" /></label>
        </section>

        <section className="rounded-card border border-hairline bg-canvas p-4">
          <h2 className="font-bold text-ink">届かなかったときの決めごと</h2>
          <p className="mt-2 text-sm leading-6 text-ink-secondary">取引メールと対応済み記録は、送信台帳の接続後に設定できます。いまは受信箱から別の手だてで連絡してください。</p>
        </section>
      </div>

      <aside className="min-w-0 space-y-3">
        <section className="rounded-card border border-hairline bg-canvas p-4">
          <p className="mb-2 text-xs font-semibold text-ink-faint">高橋 直人さんにはこう届きます</p>
          <CardPreview setting={setting} />
        </section>
        <section className="rounded-card border border-warning bg-warning-bg p-4 text-sm text-warning">
          <h2 className="font-bold">これは「お知らせ」です</h2>
          <ul className="mt-2 space-y-2 leading-5"><li>配信を止めている人にも届きます</li><li>売り込みの文章は入れないでください</li><li>遅れると問い合わせが増えます</li></ul>
        </section>
        <section className="rounded-card border border-hairline bg-canvas p-4 text-sm">
          <h2 className="font-bold text-ink">つながる先</h2>
          <div className="mt-2 space-y-2 text-accent"><p>EC連携</p><p>共通情報</p><p>受信箱</p><p>NEN配信</p><p>外部連携</p></div>
        </section>
      </aside>
    </div>

    {/*
      * N-337: 固定フッターの主要操作。ボタンの文字は部品側で `nowrap` なので、
      * 375px級では並びを折り返さないと横にはみ出す。入れ物を `min-w-0` にし、
      * 操作列を `flex-wrap` で複数行に落とす。左右の余白も狭幅では詰める。
      */}
    <div data-design="editor-footer" className="fixed bottom-0 left-0 right-0 z-20 min-w-0 border-t border-hairline bg-canvas px-4 py-3 shadow-lg sm:px-6">
      <div className="ml-auto flex min-w-0 flex-wrap items-center justify-between gap-3" style={{ maxWidth: 1584 }}>
        <p className="min-w-0 text-xs text-ink-faint">{definition ? '下書きの保存だけでは公開中の内容は変わりません。確認後に公開してください。' : '出しています。保存すると、次のお知らせから新しい文面が使われます。'}</p>
        <div data-design="editor-footer-actions" className="flex min-w-0 flex-wrap justify-end gap-2"><Button onClick={onClose}>キャンセル</Button><Button onClick={onTestSend} disabled={busy}>自分にテスト送信</Button><Button onClick={onSave} disabled={busy}>{definition ? '下書きを保存' : 'お知らせを保存'}</Button>{definition ? <Button variant="primary" onClick={onPublish} disabled={busy}>顧客へのお知らせを公開</Button> : null}</div>
      </div>
    </div>
  </main>
}

function LineNotificationsPage() {
  const router = useRouter()
  const { selectedAccountId } = useAccount()
  /*
   * N-340: `loadGeneration` は load() の useEffect の中でしか進まない。
   * アカウント切替の描画コミットと、その useEffect が実際に発火する瞬間の
   * 間には隙間がある（渡された値が変わった描画そのものは同期的に終わるが、
   * useEffect は後回しになる）。保存・公開の応答がその隙間で返ると、
   * 世代はまだ古いままなのに画面はもう別アカウントを向いてしまっている。
   * ここは描画のたびに同期して合わせ、useEffect の発火を待たずに
   * 「いま向いているアカウント」を握っておく（保存応答の照合に使う）。
   */
  const selectedAccountRef = useRef(selectedAccountId)
  selectedAccountRef.current = selectedAccountId
  const tab = useMergedTab(TABS, 'tab', 'customer')
  const [settings, setSettings] = useState<EcNotificationSetting[]>([])
  const [overview, setOverview] = useState<EcCommerceOverview | null>(null)
  const [definitions, setDefinitions] = useState<LineNotificationDefinition[]>([])
  const [metrics, setMetrics] = useState<LineNotificationMetric[]>([])
  const [filter, setFilter] = useState<CustomerFilter>('all')
  const [customerPage, setCustomerPage] = useState(1)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [loadState, setLoadState] = useState<CustomerLoadState>('loading')
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false)
  // N-341: 運用者タブの件数は実データで出す。子部品とは別に親で取る。
  const [operatorCount, setOperatorCount] = useState<number | null>(null)
  const [operatorState, setOperatorState] = useState<OperatorTabState>('loading')
  // N-340: 保存していない編集のあるお知らせ。離脱警告と復元の目印。
  const [dirtyEvents, setDirtyEvents] = useState<readonly string[]>([])
  // N-340: 保存済みの姿。編集中に戻るときの戻し先。
  const lastSavedRef = useRef(new Map<string, EcNotificationSetting>())
  // N-340: いま画面にある文面の指紋。保存の応答が「いまの文面のものか」を見る。
  // 描画ではなく操作の中で見るので、state ではなく ref に置く。
  const editFingerprintRef = useRef(new Map<string, string>())
  const loadGeneration = useRef(0)

  const load = useCallback(async () => {
    const generation = loadGeneration.current + 1
    loadGeneration.current = generation
    setLoadState('loading')
    // アカウント切替中に前のアカウントの件数を残さない。
    setSettings([])
    setOverview(null)
    setDefinitions([])
    setMetrics([])
    setNotice(null)
    setCloseConfirmOpen(false)
    setOperatorCount(null)
    setOperatorState('loading')
    setDirtyEvents([])
    setBusy(null)
    lastSavedRef.current = new Map()
    editFingerprintRef.current = new Map()
    if (!selectedAccountId) {
      setLoadState('ready')
      return
    }
    // N-341: 運用者タブの件数だけ先に実数で取る。顧客タブの成否とは切り分ける。
    try {
      const operatorRes = await api.notifications.operatorRules.list(selectedAccountId)
      if (generation !== loadGeneration.current) return
      if (!operatorRes.success) throw new Error('operator count failed')
      setOperatorCount(operatorRes.data.summary.total)
      setOperatorState('ready')
    } catch (error) {
      if (generation !== loadGeneration.current) return
      setOperatorCount(null)
      setOperatorState(error instanceof ApiError && error.status === 403 ? 'forbidden' : 'error')
    }
    // 顧客タブだけが定義・集計を読む。運用者・記録タブは子部品が自前で取る（#509 軽1）。
    // 設定口は列車側で店別になったため、持ち回しはしない。
    const needCustomer = tab === 'customer'
    try {
      const [settingRes, overviewRes, definitionRes, metricRes] = await Promise.all([
        api.ecCommerce.settings(selectedAccountId), api.ecCommerce.overview(selectedAccountId),
        needCustomer
          ? api.lineNotifications.definitions(selectedAccountId).catch((error: unknown) => {
              if (error instanceof ApiError && error.status === 403) throw error
              return null
            })
          : Promise.resolve(null),
        needCustomer
          ? api.lineNotifications.metrics(selectedAccountId).catch((error: unknown) => {
              if (error instanceof ApiError && error.status === 403) throw error
              return null
            })
          : Promise.resolve(null),
      ])
      if (generation !== loadGeneration.current) return
      if (!settingRes.success || !overviewRes.success) throw new Error('load failed')
      const loadedDefinitions = definitionRes?.success ? definitionRes.data : []
      const loadedDefinitionByEvent = new Map(loadedDefinitions.map((definition) => [definition.sourceEventType, definition]))
      const mergedSettings = settingRes.data.map((setting) => {
        const definition = loadedDefinitionByEvent.get(setting.eventType)
        if (!definition) return setting
        const draftText = (key: string, fallback: string): string => typeof definition.draft[key] === 'string' ? definition.draft[key] as string : fallback
        const draftFields = Array.isArray(definition.draft.fixedFields)
          ? definition.draft.fixedFields.filter((value): value is string => typeof value === 'string')
          : setting.fixedFields
        return {
          ...setting,
          isEnabled: definition.status === 'published',
          title: draftText('title', definition.name),
          introText: draftText('introText', setting.introText),
          outroText: draftText('outroText', setting.outroText),
          buttonLabel: draftText('buttonLabel', setting.buttonLabel),
          buttonUrl: draftText('buttonUrl', setting.buttonUrl),
          imageUrl: draftText('imageUrl', setting.imageUrl),
          fixedFields: draftFields,
          updatedAt: definition.updatedAt,
        }
      })
      // N-340: 保存済みの姿を覚え、端末に残った下書きがあれば重ねる。
      lastSavedRef.current = new Map(mergedSettings.map((setting) => [setting.eventType, setting]))
      const restoredEvents: string[] = []
      const withDrafts = selectedAccountId ? mergedSettings.map((setting) => {
        const draft = readCustomerDraft(selectedAccountId, setting.eventType)
        if (!draft) return setting
        if (isSameCustomerDraft(setting, draft)) {
          clearCustomerDraft(selectedAccountId, setting.eventType)
          return setting
        }
        restoredEvents.push(setting.eventType)
        return { ...setting, ...draft }
      }) : mergedSettings
      editFingerprintRef.current = new Map(withDrafts.map((setting) =>
        [setting.eventType, customerDraftFingerprint(pickCustomerDraft(setting))]))
      setSettings(withDrafts)
      setOverview(overviewRes.data)
      setDefinitions(loadedDefinitions)
      setMetrics(metricRes?.success ? metricRes.data.items : [])
      setExpanded((current) => withDrafts.some((setting) => setting.eventType === current) ? current : null)
      if (restoredEvents.length > 0) {
        setDirtyEvents(restoredEvents)
        setNotice({ tone: 'success', text: `未保存の編集を${restoredEvents.length}件復元しました。確認して保存してください。` })
      }
      setLoadState('ready')
    } catch (error) {
      if (generation === loadGeneration.current) {
        setLoadState(error instanceof ApiError && error.status === 403 ? 'forbidden' : 'error')
        setNotice({ tone: 'error', text: 'LINE通知の設定を読み込めませんでした。' })
      }
    }
  }, [selectedAccountId, tab])
  useEffect(() => { void load() }, [load])

  // N-338: 行の「今日」列と同じ数で多い順に並べ、説明文と一致させる。
  const sentCountOf = useCallback((eventType: string): number | null =>
    overview?.byType.find((item) => item.eventType === eventType)?.count ?? null, [overview])
  const visible = useMemo(() => sortCustomerSettingsBySentCount(settings.filter((setting) => {
    if (filter === 'enabled') return setting.isEnabled
    if (filter === 'stopped') return !setting.isEnabled
    if (filter === 'incomplete') return isIncomplete(setting)
    return true
  }), sentCountOf), [filter, settings, sentCountOf])
  const customerPageCount = Math.max(1, Math.ceil(visible.length / CUSTOMER_PAGE_SIZE))
  const visiblePage = visible.slice((customerPage - 1) * CUSTOMER_PAGE_SIZE, customerPage * CUSTOMER_PAGE_SIZE)
  const expandedSetting = settings.find((setting) => setting.eventType === expanded) ?? null
  const definitionByEvent = useMemo(() => new Map(definitions.map((definition) => [definition.sourceEventType, definition])), [definitions])
  const metricByEvent = useMemo(() => {
    const definitionById = new Map(definitions.map((definition) => [definition.id, definition.sourceEventType]))
    return new Map(metrics.flatMap((metric) => {
      const eventType = definitionById.get(metric.definitionId)
      return eventType ? [[eventType, metric] as const] : []
    }))
  }, [definitions, metrics])
  const filterCount = (value: CustomerFilter): number => {
    if (value === 'enabled') return settings.filter((setting) => setting.isEnabled).length
    if (value === 'stopped') return settings.filter((setting) => !setting.isEnabled).length
    if (value === 'incomplete') return settings.filter(isIncomplete).length
    return settings.length
  }
  const sentBreakdown = overview?.byType.slice(0, 3).map((item) => `${item.label} ${item.count}`).join('・') ?? ''
  const kpis = customerNotificationKpis({
    ready: loadState === 'ready' && overview !== null,
    settingsCount: settings.length,
    enabledCount: settings.filter((setting) => setting.isEnabled).length,
    sentToday: overview?.last24h ?? null,
    sentBreakdown,
    failed: overview?.failed ?? null,
  })
  const tabsWithCounts = TABS.map((item) => {
    if (item.key === 'customer') return { ...item, label: `${item.label} ${loadState === 'ready' ? settings.length : '—'}` }
    // N-341: 運用者タブの件数は実データ。取れなかったときは「取得失敗」と区別する。
    if (item.key === 'operator') return { ...item, label: `${item.label} ${operatorTabCountLabel(operatorState, operatorCount)}` }
    if (item.key === 'failures') return { ...item, label: `${item.label} ${overview?.failed ?? '—'}` }
    return item
  })
  const update = (eventType: string, patch: Partial<EcNotificationSetting>) => setSettings((current) => current.map((setting) => setting.eventType === eventType ? { ...setting, ...patch } : setting))
  // N-340: 入力のたびに端末へ下書きを置き、未保存の印を付ける。
  const edit = (eventType: string, patch: Partial<EcNotificationSetting>) => {
    const current = settings.find((setting) => setting.eventType === eventType)
    if (current) {
      const draft = pickCustomerDraft({ ...current, ...patch })
      if (selectedAccountId) writeCustomerDraft(selectedAccountId, eventType, draft)
      // 保存中でも入力は続けられる。1打ごとに指紋を進め、飛んでいる保存を古いものにする。
      editFingerprintRef.current.set(eventType, customerDraftFingerprint(draft))
    }
    update(eventType, patch)
    setDirtyEvents((prev) => prev.includes(eventType) ? prev : [...prev, eventType])
  }
  // N-340: 編集中に戻るとき、未保存があれば警告し、閉じるなら保存済みへ戻す。
  const closeEditor = (setting: EcNotificationSetting) => {
    if (!dirtyEvents.includes(setting.eventType)) { setExpanded(null); return }
    setCloseConfirmOpen(true)
  }
  const discardEditorChanges = (setting: EcNotificationSetting) => {
    const saved = lastSavedRef.current.get(setting.eventType)
    if (saved) {
      update(setting.eventType, { ...saved })
      editFingerprintRef.current.set(setting.eventType, customerDraftFingerprint(pickCustomerDraft(saved)))
    }
    if (selectedAccountId) clearCustomerDraft(selectedAccountId, setting.eventType)
    setDirtyEvents((prev) => prev.filter((value) => value !== setting.eventType))
    setCloseConfirmOpen(false)
    setExpanded(null)
  }
  // N-340: 未保存のまま再読込・タブを閉じるときは警告する。
  useEffect(() => {
    if (dirtyEvents.length === 0) return
    const handler = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirtyEvents.length])

  /*
   * N-340/N-341: 応答が返った時点で、まだ同じアカウントを見ているときだけ画面へ書く。
   * 端末の控えを消す・未保存の印を外すのは、送った文面がそのまま画面に残っている
   * ときだけ（`settleDraft`）。保存中に足された入力を消さないため。
   */
  const mutationApi: CustomerMutationApi = {
    updateDraft: api.lineNotifications.updateDraft,
    publishDefinition: api.lineNotifications.publishDefinition,
    stopDefinition: api.lineNotifications.stopDefinition,
    updateSetting: api.ecCommerce.updateSetting,
  }
  const guardFor = (setting: EcNotificationSetting): CustomerMutationGuard => ({
    generation: loadGeneration.current,
    currentGeneration: () => loadGeneration.current,
    forAccountId: selectedAccountId ?? '',
    currentAccountId: () => selectedAccountRef.current,
    sentFingerprint: customerDraftFingerprint(pickCustomerDraft(setting)),
    currentFingerprint: () => editFingerprintRef.current.get(setting.eventType),
  })
  const applyOutcome = (
    accountId: string,
    setting: EcNotificationSetting,
    generation: number,
    outcome: CustomerMutationOutcome,
  ) => {
    if (outcome.settleDraft) {
      // 送った文面がそのまま画面に残っている。ここで初めて「保存済み」にする。
      clearCustomerDraft(accountId, setting.eventType)
      lastSavedRef.current.set(setting.eventType, { ...setting, isEnabled: outcome.enabled })
      setDirtyEvents((prev) => prev.filter((value) => value !== setting.eventType))
    }
    if (outcome.kind === 'stale' || generation !== loadGeneration.current) return
    if (outcome.kind === 'failed') { setNotice({ tone: 'error', text: outcome.message }); return }
    const saved = outcome.definition
    if (saved) setDefinitions((current) => current.map((item) => item.id === saved.id ? saved : item))
    update(setting.eventType, { isEnabled: outcome.enabled })
    if (!outcome.contentSaved) {
      // 出す・止めるの切替は文面を送っていない。戻し先の出・止めだけを直し、文面は触らない。
      const previous = lastSavedRef.current.get(setting.eventType)
      if (previous) lastSavedRef.current.set(setting.eventType, { ...previous, isEnabled: outcome.enabled })
    }
    setNotice({ tone: outcome.tone, text: outcome.message })
  }

  const save = async (setting: EcNotificationSetting, enabled = setting.isEnabled) => {
    if (!setting.title?.trim()) { setNotice({ tone: 'error', text: '通知の見出しを入力してください。' }); return }
    if (!selectedAccountId) { setNotice({ tone: 'error', text: 'LINEアカウントを選択してください。' }); return }
    const accountId = selectedAccountId
    const guard = guardFor(setting)
    setBusy(setting.eventType)
    const outcome = await saveCustomerNotification({
      api: mutationApi,
      accountId,
      setting,
      definition: definitionByEvent.get(setting.eventType) ?? null,
      enabled,
      guard,
    })
    applyOutcome(accountId, setting, guard.generation, outcome)
    if (guard.generation === loadGeneration.current) setBusy(null)
  }

  const publish = async (setting: EcNotificationSetting) => {
    const definition = definitionByEvent.get(setting.eventType)
    if (!definition) return
    if (!selectedAccountId) { setNotice({ tone: 'error', text: 'LINEアカウントを選択してください。' }); return }
    const accountId = selectedAccountId
    const guard = guardFor(setting)
    setBusy(setting.eventType)
    const outcome = await publishCustomerNotification({ api: mutationApi, setting, definition, guard })
    applyOutcome(accountId, setting, guard.generation, outcome)
    if (guard.generation === loadGeneration.current) setBusy(null)
  }

  const testSend = async (setting: EcNotificationSetting) => {
    if (!selectedAccountId) { setNotice({ tone: 'error', text: 'LINEアカウントを選択してください。' }); return }
    const generation = loadGeneration.current
    setBusy(setting.eventType)
    try {
      const result = await api.ecCommerce.testSend({
        eventType: setting.eventType, accountId: selectedAccountId, title: setting.title || '',
        introText: setting.introText, outroText: setting.outroText, buttonLabel: setting.buttonLabel,
        buttonUrl: setting.buttonUrl, imageUrl: setting.imageUrl,
      })
      if (!result.success) throw new Error(result.error)
      // 別アカウントへ切り替わった後の応答は、いまの画面へ出さない。
      if (generation !== loadGeneration.current) return
      setNotice({ tone: 'success', text: `テスト受信者 ${result.data.sent}名へ送信しました。` })
    } catch {
      if (generation !== loadGeneration.current) return
      setNotice({ tone: 'error', text: 'テスト送信できませんでした。テスト受信者の設定をご確認ください。' })
    }
    finally { if (generation === loadGeneration.current) setBusy(null) }
  }

  return <>
    {expandedSetting === null ? <MergedTabs basePath="/line-notifications" tabs={tabsWithCounts} active={tab} defaultKey="customer" /> : null}
    {tab === 'failures' ? <NotificationRunList lineAccountId={selectedAccountId} mode="failures" /> : null}
    {tab === 'history' ? <NotificationRunList lineAccountId={selectedAccountId} mode="history" /> : null}
    {tab === 'operator' ? <OperatorNotificationRules lineAccountId={selectedAccountId} /> : null}
    {tab === 'customer' && expandedSetting ? <>
      <CustomerNotificationEditor
        setting={expandedSetting}
        definition={definitionByEvent.get(expandedSetting.eventType) ?? null}
        busy={busy === expandedSetting.eventType}
        onChange={(patch) => edit(expandedSetting.eventType, patch)}
        onClose={() => closeEditor(expandedSetting)}
        onPublish={() => void publish(expandedSetting)}
        onSave={() => void save(expandedSetting)}
        onTestSend={() => void testSend(expandedSetting)}
        notice={notice}
        hasUnsaved={dirtyEvents.includes(expandedSetting.eventType)}
      />
      <ConfirmDialog
        open={closeConfirmOpen}
        title="保存していない編集を破棄しますか？"
        description="破棄すると、入力中の内容は保存済みの内容へ戻ります。この操作は取り消せません。"
        confirmLabel="編集を破棄"
        cancelLabel="編集を続ける"
        destructive
        onConfirm={() => discardEditorChanges(expandedSetting)}
        onCancel={() => setCloseConfirmOpen(false)}
      />
    </> : null}
    {tab === 'customer' && !expandedSetting ? <main
      data-design-node="festr"
      data-list-state={loadState === 'ready' && settings.length === 0 ? 'empty' : loadState}
      className={styles.root}
    >
    <div data-design="KPIs" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {kpis.map((kpi) => {
        const { label, value, unit, note, href } = kpi
        const body = <>
          <p className="text-ink-faint text-xs">{label}</p>
          <p className="text-ink mt-1 text-2xl font-bold tabular-nums">
            {value === null ? '—' : value}
            {value === null ? null : <span className="text-ink-faint ml-1 text-xs font-normal">{unit}</span>}
          </p>
          <p className="text-ink-faint mt-0.5 text-xs">{note}</p>
        </>
        return <div key={label} className="bg-canvas rounded-card border-hairline border p-4">
          {body}
          {/* 0件のときは押し口を出さない。押しても何も無い。 */}
          {canOpenCustomerNotificationKpi(kpi) && href
            ? <Button onClick={() => router.replace(href)} className="mt-2">送れなかったものを見る</Button>
            : null}
        </div>
      })}
    </div>
    <div className="border-info bg-info-bg text-info rounded-control border px-4 py-3 text-sm leading-6">
      これは「お知らせ」であって「売り込みの配信」ではありません。顧客が配信を止めていても、取引に必要な連絡は届きます。
    </div>

    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="grid w-full max-w-[48rem] grid-cols-2 gap-2 lg:grid-cols-4" aria-label="お知らせの絞り込み">
        {customerFilters.map(([value, label]) => <button key={value} type="button" onClick={() => { setFilter(value); setCustomerPage(1) }} className={`${styles.category} ${filter === value ? styles.categoryCurrent : ''}`}><span>{label}</span><span className={styles.categoryCount}>{loadState === 'ready' ? filterCount(value) : '—'}</span></button>)}
      </div>
      <p className="text-xs text-ink-faint">送った数が多い順</p>
    </div>

    {notice && <div className={`rounded-control border px-4 py-3 text-sm ${notice.tone === 'success' ? 'border-success bg-success-bg text-success' : 'border-danger bg-danger-bg text-danger'}`}>{notice.text}</div>}

    <section className="min-w-0 overflow-hidden rounded-card border border-hairline bg-canvas">
      {loadState === 'loading' ? <ListState kind="loading" title="顧客へのお知らせを読み込んでいます" />
        : loadState === 'forbidden' ? <ListState kind="forbidden" />
        : loadState === 'error' ? <ListState kind="error" title="顧客へのお知らせを表示できませんでした" onRetry={() => void load()} />
        : settings.length === 0 ? <ListState kind="empty" title="顧客へのお知らせはまだありません" description="EC連携の取引イベントを接続すると、ここで種類ごとに管理できます。" />
        : visible.length === 0 ? <ListState kind="empty" title="条件に合うお知らせはありません" description="絞り込みを変えてください。" />
        : <>
        <div className="line-notification-v6-header">
          <span>お知らせ</span><span>いつ送るか</span><span>今日</span><span>この30日</span><span>LINE上で表示</span><span>操作</span>
        </div>
        {visiblePage.map((setting) => <article key={setting.eventType} className="border-b border-hairline last:border-b-0">
          <div className="line-notification-v6-row">
            <div className="min-w-0">
              <h2 className="truncate font-bold text-ink" title={setting.title?.trim() || setting.label}>{setting.title?.trim() || setting.label}</h2>
              <p className="mt-0.5 truncate text-xs text-ink-faint" title={triggerLabel(setting)}>{categoryLabel(setting.category)}・{triggerLabel(setting)}</p>
              <p className="mt-0.5 truncate text-xs text-ink-faint">{formatUpdatedAt(setting.updatedAt)}</p>
            </div>
            <span className="text-sm text-ink-secondary">{timingLabel(setting)}</span>
            <span className="text-sm tabular-nums text-ink-secondary">{overview?.byType.find((item) => item.eventType === setting.eventType)?.count ?? '—'}通</span>
            <span className="text-sm tabular-nums text-ink-secondary">{metricByEvent.get(setting.eventType)?.accepted.value ?? '—'}通</span>
            <span className="text-sm text-ink-faint">{(() => {
              const displayed = metricByEvent.get(setting.eventType)?.displayed
              if (!displayed || displayed.value === null) return displayed?.state === 'pending' ? '集計待ち' : '— 未取得'
              return `${displayed.value}人`
            })()}</span>
            <div className="flex items-center justify-end gap-2"><Toggle setting={setting} busy={busy === setting.eventType} onToggle={() => void save(setting, !setting.isEnabled)} /><span className={`whitespace-nowrap rounded-pill px-2 py-0.5 text-xs font-semibold ${setting.isEnabled ? 'bg-success-bg text-success' : 'bg-canvas-sunken text-ink-faint'}`}>{setting.isEnabled ? '出している' : '止めている'}</span><button type="button" onClick={() => setExpanded(expanded === setting.eventType ? null : setting.eventType)} className="line-notification-v6-row-action">{expanded === setting.eventType ? '編集を閉じる' : '内容を編集'}</button></div>
          </div>
        </article>)}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline px-4 py-3">
          <p className="text-xs text-ink-faint">お知らせの種類 {settings.length}つのうち {visiblePage.length}つを表示</p>
          <Pagination page={customerPage} pageCount={customerPageCount} onPageChange={setCustomerPage} ariaLabel="お知らせのページ送り" />
        </div>
        </>}
    </section>
    </main> : null}
  </>
}

/*
 * 試験からは実物の部品と実物の呼び出し口を使う。
 * 画面の hook を作り替えず、実APIと同じ非同期境界のまま
 * 逆順応答・保存失敗・狭幅の並びを確かめられるようにする。
 */
const LineNotificationsPageWithTestSupport = Object.assign(LineNotificationsPage, {
  __testing: {
    CustomerNotificationEditor,
    clearCustomerDraft,
    canSettleDraft,
    customerDraftFingerprint,
    customerDraftKey,
    isSameCustomerDraft,
    operatorTabCountLabel,
    pickCustomerDraft,
    publishCustomerNotification,
    readCustomerDraft,
    saveCustomerNotification,
    sortCustomerSettingsBySentCount,
    writeCustomerDraft,
  },
})

export default LineNotificationsPageWithTestSupport
