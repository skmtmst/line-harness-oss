'use client'

import { X } from 'lucide-react'
import SelectField from '@/components/shared/select-field'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import type {
  CommonVar,
  CommonVarChangeImpact,
  CommonVarDeleteImpact,
  CommonVarSchedule,
  Folder,
} from '@line-crm/shared'
import { api, ApiError, type CommonVarDetail } from '@/lib/api'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import FeatureGate from '@/components/feature-gate'
import { VAR_TYPE_LABELS, commonVarValueError, formatStamp } from '@/lib/common-vars'
import { useAccount } from '@/contexts/account-context'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { NOT_AVAILABLE, STATE_TEXT } from '@/components/shared/not-connected'
import { checkedAtText, placeholderText } from '../delete-impact'
import Button from '@/components/shared/button'
import { RequiredBadge } from '@/components/shared/form-controls'
import ListState from '@/components/shared/list-state'
import StickyBar from '@/components/shared/sticky-bar'
import TargetMissing from '@/components/shared/target-missing'
import {
  blockingErrors,
  changeSummaryText,
  historicalText,
  isChangeItem,
  reflectionScopeText,
  reflectionTimingText,
  reviewWarnings,
  hiddenText,
  immediateItems,
  impactStateFromError,
  impactStateText,
  saveErrorText,
  scheduleErrorText,
  type ChangeImpactState,
} from '../change-impact'
import ImpactReview from '../impact-review'

/**
 * 共通情報の編集。
 *
 * Lステップの「共通情報編集」と同じ形。名前・フォルダ・値を直し、下に
 * 「更新スケジュール」の表を置く。種別は登録後に変えられないので、
 * 直せない印を付けて出すだけにする。
 */

/** 「いま」より前は予約できない。入れた瞬間に当たって、予約に見えない。 */
function jstNowLocalInput(): { date: string; time: string } {
  const jst = new Date(Date.now() + 9 * 3600_000).toISOString()
  return { date: jst.slice(0, 10), time: jst.slice(11, 16) }
}

function utcToJstLocalInput(value: string | null): string {
  if (!value) return ''
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) return ''
  return new Date(parsed.getTime() + 9 * 3600_000).toISOString().slice(0, 16)
}

function EditCommonVarInner() {
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const latestAccountRef = useRef(selectedAccountId)
  latestAccountRef.current = selectedAccountId
  const router = useRouter()
  const params = useSearchParams()
  const id = params.get('id') ?? ''

  const [item, setItem] = useState<CommonVarDetail | null>(null)
  const [folders, setFolders] = useState<Folder[]>([])
  const [schedules, setSchedules] = useState<CommonVarSchedule[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  /** 取得の失敗の内訳（保存・入力の失敗とは分ける）。 */
  const [loadFailure, setLoadFailure] = useState<'missing' | 'error' | null>(null)
  const [saved, setSaved] = useState(false)
  const [showImpactReview, setShowImpactReview] = useState(false)

  const [name, setName] = useState('')
  const [folderId, setFolderId] = useState('')
  const [value, setValue] = useState('')
  const [memo, setMemo] = useState('')
  const [validFrom, setValidFrom] = useState('')
  const [validUntil, setValidUntil] = useState('')
  const [expiryBehavior, setExpiryBehavior] = useState<'stop' | 'fallback'>('stop')
  const [fallbackValue, setFallbackValue] = useState('')

  /** 予約を足す窓。開いていない間は null。 */
  const [draft, setDraft] = useState<{ date: string; time: string; value: string } | null>(null)

  /**
   * 変える前の影響確認（設計 `uNBlA`）。
   *
   * 本体の読み込みとは別に持つ。使用先が読めなくても、名前や値の編集は
   * 続けられるべきだからである。**読めなかったことを0か所として描かない。**
   */
  const [impact, setImpact] = useState<CommonVarDeleteImpact | CommonVarChangeImpact | null>(null)
  const [impactState, setImpactState] = useState<ChangeImpactState>('loading')

  /*
    値を変えていないあいだは使用先台帳（`delete-impact`）だけを読む。
    **変えた時点で変更前確認（`impact-preview`）へ切り替える。**
    変えていないのに保存後の文を問い合わせても、いまの文と同じものが
    返るだけで、読む人には差が見えない。
  */
  const loadImpact = useCallback(async (
    varId: string,
    accountId: string,
    nextValue?: string,
    expectedVersion?: number,
  ) => {
    setImpactState('loading')
    try {
      const res = nextValue === undefined
        ? await api.commonVars.deleteImpact(varId, accountId)
        : await api.commonVars.impactPreview(varId, accountId, nextValue, expectedVersion)
      if (accountId !== latestAccountRef.current) return
      if (!res.success) {
        setImpact(null)
        setImpactState('error')
        return
      }
      setImpact(res.data)
      setImpactState('ready')
    } catch (e) {
      if (accountId !== latestAccountRef.current) return
      setImpact(null)
      setImpactState(impactStateFromError(e))
    }
  }, [])

  /**
   * 入力のたびに問い合わせない。**打っている途中の文で「空になります」と
   * 出ると、消して打ち直しているだけの人を止めてしまう。** 手が止まって
   * から引く。
   */
  useEffect(() => {
    if (!item || !selectedAccountId) return
    const nextValue = value === item.value ? undefined : value
    const timer = setTimeout(() => {
      void loadImpact(item.id, selectedAccountId, nextValue, item.version)
    }, 400)
    return () => clearTimeout(timer)
  }, [item, selectedAccountId, value, loadImpact])

  /*
    保存を止める理由。**読めていないときは止めない。** 影響を確かめ
    られなかったことを理由に保存を塞ぐと、口が落ちているあいだ誰も
    値を直せなくなる。
  */
  const blocked = impact && 'canSave' in impact && impactState === 'ready'
    ? blockingErrors(impact)
    : []
  const visibleImpactItems = impact ? immediateItems(impact) : []
  const previewUsage = visibleImpactItems[0]
  const usageGroups = useMemo(() => {
    if (!impact) return []
    const groups = new Map<string, { kind: keyof typeof impact.byKind; kindLabel: string; names: string[] }>()
    for (const usage of immediateItems(impact)) {
      const current = groups.get(usage.kind)
      if (current) current.names.push(usage.name)
      else groups.set(usage.kind, { kind: usage.kind, kindLabel: usage.kindLabel, names: [usage.name] })
    }
    return [...groups.values()].map((group) => ({
      ...group,
      count: impact.byKind[group.kind] ?? group.names.length,
    }))
  }, [impact])

  const load = useCallback(async () => {
    if (!id) {
      setLoading(false)
      setError('')
      setLoadFailure(null)
      return
    }
    const accountAtRequest = selectedAccountId
    if (!accountAtRequest) {
      setItem(null)
      setLoading(false)
      setError(accountLoading ? '' : 'LINEアカウントを選択してください')
      setLoadFailure(null)
      return
    }
    setLoading(true)
    setError('')
    setLoadFailure(null)
    try {
      const [detail, folderList, scheduleList] = await Promise.all([
        api.commonVars.detail(id, accountAtRequest),
        api.folders.list('common_var'),
        api.commonVars.schedules(id, accountAtRequest),
      ])
      if (accountAtRequest !== latestAccountRef.current) return
      if (folderList.success) setFolders(folderList.data)
      if (scheduleList.success) setSchedules(scheduleList.data)
      const found = detail.success ? detail.data : undefined
      if (!found) {
        setError('この共通情報は見つかりませんでした')
        setLoadFailure('missing')
        return
      }
      setItem(found)
      setName(found.name)
      setFolderId(found.folderId ?? '')
      setValue(found.value)
      setMemo(found.memo)
      setValidFrom(utcToJstLocalInput(found.validFrom))
      setValidUntil(utcToJstLocalInput(found.validUntil))
      setExpiryBehavior(found.expiryBehavior ?? 'stop')
      setFallbackValue(found.fallbackValue ?? '')
    } catch (caught) {
      if (accountAtRequest !== latestAccountRef.current) return
      if (caught instanceof ApiError && caught.status === 404) {
        setError('この共通情報は見つかりませんでした')
        setLoadFailure('missing')
      } else {
        setError('読み込みに失敗しました。もう一度読み込んでください。')
        setLoadFailure('error')
      }
    } finally {
      if (accountAtRequest === latestAccountRef.current) setLoading(false)
    }
  }, [accountLoading, id, selectedAccountId])

  useEffect(() => {
    void load()
  }, [load])

  /**
   * 保存が競合したとき、**入力を残したまま**いま保存されている版へ合わせる
   * （IDEA-14）。
   *
   * `load()` は名前・値・メモまで初期化するので、競合のたびに打ち直しに
   * なり、同時編集で入力が消える。ここでは詳細と予約だけを取り直して
   * `item`（版・いまの値・履歴・使用先）を最新へ進め、入力欄は触らない。
   * 409応答の `currentVersion` を先に入れておくと、取り直しに失敗しても
   * 次の保存で新しい版を名乗れる。
   */
  const refreshBaseline = async (varId: string, accountId: string, err?: ApiError) => {
    const body = err?.data as { currentVersion?: unknown } | undefined
    if (typeof body?.currentVersion === 'number' && Number.isInteger(body.currentVersion)) {
      const currentVersion = body.currentVersion
      setItem((prev) => (prev ? { ...prev, version: currentVersion } : prev))
    }
    try {
      const [detail, scheduleList] = await Promise.all([
        api.commonVars.detail(varId, accountId),
        api.commonVars.schedules(varId, accountId),
      ])
      if (accountId !== latestAccountRef.current) return
      if (scheduleList.success) setSchedules(scheduleList.data)
      if (detail.success) setItem(detail.data)
    } catch {
      // 読み直せなくても入力は残る。版が古いままの次の保存は同じ文で断る。
    }
  }

  const save = async () => {
    if (!item || saving || !selectedAccountId) return
    const accountAtRequest = selectedAccountId
    if (!name.trim()) {
      setError('共通情報名を入力してください')
      return
    }
    // VAR-06: 新規画面と同じ型検査を保存前に行い、理由を出して欄へ戻す。
    const valueError = commonVarValueError(item.type, value)
    if (valueError) {
      setError(valueError)
      document.getElementById('cv-value')?.focus()
      return
    }
    if (validFrom && validUntil && validFrom >= validUntil) {
      setError('有効終了は有効開始より後にしてください')
      return
    }
    if (expiryBehavior === 'fallback') {
      if (!fallbackValue) {
        setError('期限切れ時に使う代替値を入力してください')
        document.getElementById('cv-fallback-value')?.focus()
        return
      }
      const fallbackError = commonVarValueError(item.type, fallbackValue, '代替値')
      if (fallbackError) {
        setError(fallbackError)
        document.getElementById('cv-fallback-value')?.focus()
        return
      }
    }
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      // N-185: 保存の直前に影響を確認し、その確認値を添えて送る。確認なしの
      // 保存は口が428で止める。確認口が落ちているときは送らず待ってもらう。
      let preview: Awaited<ReturnType<typeof api.commonVars.impactPreview>> | null = null
      try {
        preview = await api.commonVars.impactPreview(item.id, accountAtRequest, value, item.version)
      } catch {
        preview = null
      }
      if (accountAtRequest !== latestAccountRef.current) return
      if (!preview || !preview.success) {
        setError('影響を確認できませんでした。しばらく待って保存し直してください')
        return
      }
      const res = await api.commonVars.update(item.id, accountAtRequest, {
        name: name.trim(),
        value,
        memo,
        folderId: folderId || null,
        expectedVersion: item.version,
        impactProof: preview.data.impactProof,
        validFrom: validFrom || null,
        validUntil: validUntil || null,
        expiryBehavior,
        fallbackValue: expiryBehavior === 'fallback' ? fallbackValue : null,
      })
      if (accountAtRequest !== latestAccountRef.current) return
      if (!res.success) {
        setError(res.error)
        return
      }
      setSaved(true)
      setShowImpactReview(false)
      void load()
    } catch (e) {
      // `fetchApi` は2xx以外を投げる。ここで一言にまとめてしまうと、
      // 権限が無いのか対象が消えたのかが運用者に届かない。
      // 428・409（確認切れ・競合）では入力を消さない。いま保存されている
      // 版だけを取り直し、打ち込んだ内容はそのまま残す（IDEA-14）。
      // 確認画面を開いていたまま古い写しを見続けないよう畳む。
      if (e instanceof ApiError && (e.status === 428 || e.status === 409)) {
        if (accountAtRequest !== latestAccountRef.current) return
        setShowImpactReview(false)
        setError(saveErrorText(e))
        void refreshBaseline(item.id, accountAtRequest, e)
        return
      }
      setError(saveErrorText(e))
    } finally {
      setSaving(false)
    }
  }

  /*
   * 削除の確認。**ブラウザの `confirm()` は使わない。**
   *
   * もとの文言は「テンプレートに {{var.…}} が残っていると、その部分が
   * 空になります」だった。**残っているかどうかを言っていなかった。**
   * 一覧側（設計 `yPkWe`）と同じように、押した時点で使用先を読んでから見せる。
   *
   * **押した時点のLINEアカウントを窓に固定する。** ヘッダから切り替えられる
   * 画面なので、切り替わったあとにそのまま消すと、いま見ていないアカウントの
   * ものを消すことになる。切り替わったら窓は消さず、選び直してもらう。
   */
  const [deleteTarget, setDeleteTarget] = useState<{ item: CommonVar; accountId: string } | null>(null)
  const [deletePhase, setDeletePhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [deleteImpact, setDeleteImpact] = useState<CommonVarDeleteImpact | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const deleteAccountSwitched = deleteTarget !== null && deleteTarget.accountId !== selectedAccountId

  /*
   * 保存していない変更を持ったまま画面の外へ出る操作を止める（VAR-01 監査）。
   * リッチメニュー・ウェビナーと同じ `useUnsavedGuard`＋確認ダイアログの形。
   * 読み込んだ値と同じに戻したとき・保存して再読込したあとは dirty が外れる。
   * 更新予約の入力窓（draft）を開いている途中も、まだ登録されていない入力
   * として数える。消す操作の確認中や削除の送信は別の窓が出ているので、
   * busy には保存・削除の双方を入れて処理中の移動を止める。
   */
  const dirty = item !== null && (
    name !== item.name ||
    folderId !== (item.folderId ?? '') ||
    value !== item.value ||
    memo !== item.memo ||
    validFrom !== utcToJstLocalInput(item.validFrom) ||
    validUntil !== utcToJstLocalInput(item.validUntil) ||
    expiryBehavior !== (item.expiryBehavior ?? 'stop') ||
    fallbackValue !== (item.fallbackValue ?? '') ||
    draft !== null
  )
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({
    dirty,
    busy: saving || deleting,
  })
  /*
   * 離脱の確認はどの画面状態にいても出す。影響確認の一覧へ切り替えた表示
   * （ImpactReview）は別ツリーへ早期 return するため、要素化して両方の
   * 経路へ差し込む。片方だけに置くと dirty 中のリンクが黙って止まり、
   * 「保存せずに移動」を選ぶ手段がなくなる。
   */
  const leaveConfirmDialog = (
    <ConfirmDialog
      open={leaveTarget !== null}
      title="保存していない変更があります"
      description="このまま移動すると、共通情報への変更は失われます。保存せずに移動しますか？"
      confirmLabel="保存せずに移動"
      cancelLabel="編集を続ける"
      onConfirm={confirmLeave}
      onCancel={cancelLeave}
    />
  )

  const openDelete = async () => {
    if (!item || !selectedAccountId) return
    const target = { item, accountId: selectedAccountId }
    setDeleteTarget(target)
    setDeleteImpact(null)
    setDeleteError('')
    setDeletePhase('loading')
    try {
      const res = await api.commonVars.deleteImpact(target.item.id, target.accountId)
      // 遅れて返った前の結果を、いま開いている窓に映さない。
      if (latestAccountRef.current !== target.accountId) return
      if (!res.success) throw new Error(res.error)
      setDeleteImpact(res.data)
      setDeletePhase('ready')
    } catch {
      // **使用先が読めないときは消させない。** 「0か所」と読み違えて消すと、
      // 差し込んでいた文が空欄のまま送られ続ける。
      setDeletePhase('error')
    }
  }

  const closeDelete = () => {
    if (deleting) return
    setDeleteTarget(null)
    setDeleteImpact(null)
    setDeleteError('')
    setDeletePhase('loading')
  }

  const remove = async () => {
    // 二度押しを受け付けない。読み込み中・切り替え後も走らせない。
    if (!deleteTarget || deleting || deleteAccountSwitched) return
    if (deletePhase !== 'ready' || !deleteImpact?.canDelete) return
    setDeleting(true)
    setDeleteError('')
    try {
      const res = await api.commonVars.delete(deleteTarget.item.id, deleteTarget.accountId)
      // 失敗を握りつぶさない。返事を見ずに一覧へ戻すと、消えていないのに
      // 消えたように見える。
      if (!res.success) throw new Error(res.error)
      router.push('/contents/vars')
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // 読んだあとに使われ始めた。理由が変わっているので読み直して見せる。
        setDeleteError('いま使われ始めたため、削除できませんでした。使用先を読み直しました。')
        try {
          const again = await api.commonVars.deleteImpact(deleteTarget.item.id, deleteTarget.accountId)
          if (again.success) setDeleteImpact(again.data)
          else setDeletePhase('error')
        } catch {
          setDeletePhase('error')
        }
        return
      }
      // 生のAPIエラーは出さない。運用者が次にすることだけを書く。
      setDeleteError('削除できませんでした。状態を読み直してから、もう一度お試しください。')
    } finally {
      setDeleting(false)
    }
  }

  const addSchedule = async () => {
    if (!item || !draft || !selectedAccountId) return
    if (!draft.date) {
      setError('開始日を入れてください')
      return
    }
    // VAR-06: 予約の値も本体と同じ型検査を通す。通さないとCronが
    // 型に合わない値をそのまま書き込む。
    const scheduleValueError = commonVarValueError(item.type, draft.value, '更新後の値')
    if (scheduleValueError) {
      setError(scheduleValueError)
      return
    }
    setError('')
    try {
      const res = await api.commonVars.addSchedule(item.id, selectedAccountId, {
        effectiveFrom: `${draft.date}T${draft.time || '00:00'}`,
        value: draft.value,
      })
      if (!res.success) {
        setError(res.error)
        return
      }
      setDraft(null)
      void load()
    } catch (e) {
      // サーバの生文言（500の'Internal server error'など）は出さない。
      setError(scheduleErrorText(e))
    }
  }

  const removeSchedule = async (scheduleId: string) => {
    if (!item || !selectedAccountId) return
    setError('')
    try {
      await api.commonVars.deleteSchedule(item.id, scheduleId, selectedAccountId)
      void load()
    } catch {
      setError('予約の削除に失敗しました。通信を確かめて、もう一度お試しください。')
    }
  }

  if (showImpactReview && impact && 'canSave' in impact) {
    return (
      <>
        <ImpactReview
          impact={impact}
          busy={saving}
          onBack={() => setShowImpactReview(false)}
          onSave={() => void save()}
        />
        {leaveConfirmDialog}
      </>
    )
  }

  /*
    対象が無いときは、パンくず・入力・右の案内・固定バーのどれも出さない。
    代わりに ★V7 TargetMissing を出す（設計 `x5cgUH`）。
  */
  if (!id) {
    return (
      <TargetMissing
        kind="unspecified"
        title="編集する共通情報が指定されていません"
        description="一覧から編集する共通情報を選び直してください。"
        backHref="/contents/vars"
        backLabel="共通情報一覧へ戻る"
      />
    )
  }
  if (!accountLoading && !selectedAccountId) {
    return (
      <ListState
        kind="empty"
        title="LINEアカウントを選んでください"
        description="選ぶと共通情報を編集できます。"
        action={<Button href="/contents/vars">共通情報一覧へ戻る</Button>}
      />
    )
  }
  if (!loading && loadFailure === 'missing') {
    return (
      <TargetMissing
        kind="not-found"
        title="この共通情報は見つかりません"
        description="削除されたか、リンクが古くなっています。一覧から選び直してください。"
        backHref="/contents/vars"
        backLabel="共通情報一覧へ戻る"
      />
    )
  }
  if (!loading && loadFailure === 'error') {
    return (
      <TargetMissing
        kind="error"
        title="共通情報を読み込めませんでした"
        description="通信が切れたか、サーバが応えませんでした。しばらくしてから、もう一度読み込んでください。"
        onRetry={() => void load()}
      />
    )
  }

  return (
    <div>
      <nav className="text-ink-faint mb-3 text-xs">
        <Link href="/contents/vars" className="text-info hover:underline">
          共通情報一覧
        </Link>
        <span className="mx-1.5">›</span>
        <span>共通情報編集</span>
      </nav>

      {error && item && (
        <div className="bg-danger-bg border-danger-bg text-danger mb-4 max-w-3xl rounded-lg border p-4 text-sm">
          {error}
        </div>
      )}

      {loading || !item ? (
        <div className="bg-canvas rounded-card border-hairline text-ink-faint max-w-3xl border p-8 text-center text-sm">
          読み込み中...
        </div>
      ) : (
        <>
          <div className="grid gap-4 xl:grid-cols-3" data-design-node="gBtaK">
            <div className="space-y-4 xl:col-span-2">
              <section className="bg-canvas rounded-card border-hairline space-y-5 border p-5">
                <div className="grid gap-4 md:grid-cols-3">
                  <div>
                    <label htmlFor="cv-name" className="text-ink-secondary mb-1 block text-sm font-medium">
                      名前<RequiredBadge />
                    </label>
                    <input
                      id="cv-name"
                      type="text"
                      maxLength={200}
                      value={name}
                      onChange={(e) => { setSaved(false); setName(e.target.value) }}
                      className="border-hairline rounded-control focus:ring-accent w-full border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
                    />
                    <p className="text-ink-faint mt-1 text-xs">管理画面の中で探すときの名前</p>
                  </div>
                  <div>
                    <p className="text-ink-secondary mb-1 text-sm font-medium">
                      差し込みキー<RequiredBadge />
                    </p>
                    <code className="bg-canvas-sunken text-ink block rounded-control px-3 py-2 text-sm">{placeholderText(item.varKey)}</code>
                    <p className="text-ink-faint mt-1 text-xs">本文にこの形で入ります</p>
                  </div>
                  <div>
                    <label htmlFor="cv-folder" className="text-ink-secondary mb-1 block text-sm font-medium">フォルダ</label>
                    <SelectField
                      id="cv-folder"
                      value={folderId}
                      onChange={(e) => { setSaved(false); setFolderId(e.target.value) }}
                      options={[{ value: '', label: '未分類' }, ...folders.map((folder) => ({ value: folder.id, label: folder.name }))]}
                    />
                  </div>
                </div>

                <div>
                  <div className="mb-1 flex items-center justify-between gap-3">
                    <label htmlFor="cv-value" className="text-ink-secondary text-sm font-medium">差し込まれる文字</label>
                    <span className="text-ink-faint text-xs tabular-nums">{value.length} / {item.type === 'long_text' ? 10000 : 200}</span>
                  </div>
                  {item.type === 'boolean' ? <SelectField id="cv-value" value={value} onChange={(e) => { setSaved(false); setValue(e.target.value) }} options={[{ value: 'true', label: 'true' }, { value: 'false', label: 'false' }]} className="w-full" /> : (item.type as string) === 'long_text' ? <textarea id="cv-value" maxLength={10000} value={value} onChange={(e) => { setSaved(false); setValue(e.target.value) }} className="border-hairline rounded-control w-full border px-3 py-3 text-sm" rows={5} /> : <input
                    id="cv-value"
                    type={item.type === 'number' ? 'number' : (item.type as string) === 'date' ? 'date' : (item.type as string) === 'datetime' ? 'datetime-local' : 'text'}
                    maxLength={item.type === 'number' ? undefined : 200}
                    value={value}
                    onChange={(e) => { setSaved(false); setValue(e.target.value) }}
                    className="border-hairline rounded-control w-full border px-3 py-3 text-sm"
                  />}
                </div>

                {/*
                  保存する**前**に、変わる範囲を状態（編集中・公開中・予約中）
                  ごとに分け、いつから効くか・何が変わらないかを示す
                  （IDEA-14）。「配信中にも反映」とだけ言うと、値を固定済みの
                  送信が直ると誤読されるため、実際の版管理（送信開始時の
                  写し）と言い方をそろえる。
                */}
                {impactState === 'ready' && impact ? (
                  <div className="bg-status-warning-soft text-status-warning rounded-control px-4 py-3 text-sm" role="status">
                    <p className="font-bold">{changeSummaryText(impact)}</p>
                    {value !== item.value ? (
                      <p className="mt-1 text-xs">
                        「{item.value || '（空）'}」→「{value || '（空）'}」
                      </p>
                    ) : null}
                    {reflectionScopeText(impact) ? (
                      <p className="mt-1 text-xs">{reflectionScopeText(impact)}</p>
                    ) : null}
                    {reflectionTimingText(impact) ? (
                      <p className="mt-1 text-xs">{reflectionTimingText(impact)}</p>
                    ) : null}
                  </div>
                ) : null}

                <div>
                  <p className="text-ink-secondary mb-1 text-sm font-medium">社内向けのメモ（お客さまには出ません）</p>
                  <input
                    type="text"
                    value={memo}
                    onChange={(event) => { setSaved(false); setMemo(event.target.value) }}
                    maxLength={1000}
                    className="border-hairline rounded-control w-full border px-3 py-2 text-sm"
                    placeholder="運用上の注意や、この値の使い方を書きます"
                  />
                </div>

                <fieldset className="border-hairline rounded-control space-y-3 border p-4">
                  <legend className="text-ink-secondary px-1 text-sm font-medium">配信で使える期間</legend>
                  <p className="text-ink-faint text-xs">予約配信は送信を始める時刻で判定します。空欄なら期間を制限しません。</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label htmlFor="cv-valid-from" className="text-ink-secondary mb-1 block text-xs font-medium">有効開始</label>
                      <input id="cv-valid-from" type="datetime-local" value={validFrom} onChange={(e) => { setSaved(false); setValidFrom(e.target.value) }} className="border-hairline rounded-control w-full border px-3 py-2 text-sm" />
                    </div>
                    <div>
                      <label htmlFor="cv-valid-until" className="text-ink-secondary mb-1 block text-xs font-medium">有効終了</label>
                      <input id="cv-valid-until" type="datetime-local" value={validUntil} onChange={(e) => { setSaved(false); setValidUntil(e.target.value) }} className="border-hairline rounded-control w-full border px-3 py-2 text-sm" />
                    </div>
                  </div>
                  <div>
                    <label htmlFor="cv-expiry-behavior" className="text-ink-secondary mb-1 block text-xs font-medium">期間外の動作</label>
                    <SelectField id="cv-expiry-behavior" value={expiryBehavior} onChange={(e) => { setSaved(false); setExpiryBehavior(e.target.value as 'stop' | 'fallback') }} options={[{ value: 'stop', label: '配信を止める' }, { value: 'fallback', label: '代替値を使う' }]} />
                  </div>
                  {expiryBehavior === 'fallback' && (
                    <div>
                      <label htmlFor="cv-fallback-value" className="text-ink-secondary mb-1 block text-xs font-medium">代替値</label>
                      {item.type === 'boolean' ? (
                        <SelectField
                          id="cv-fallback-value"
                          value={fallbackValue}
                          onChange={(e) => { setSaved(false); setFallbackValue(e.target.value) }}
                          options={[{ value: '', label: '選んでください' }, { value: 'true', label: 'true' }, { value: 'false', label: 'false' }]}
                        />
                      ) : (
                        <input
                          id="cv-fallback-value"
                          type={item.type === 'number' ? 'number' : (item.type as string) === 'date' ? 'date' : (item.type as string) === 'datetime' ? 'datetime-local' : 'text'}
                          value={fallbackValue}
                          onChange={(e) => { setSaved(false); setFallbackValue(e.target.value) }}
                          className="border-hairline rounded-control w-full border px-3 py-2 text-sm"
                        />
                      )}
                    </div>
                  )}
                </fieldset>

                <p className="text-ink-faint text-xs">
                  種別：{VAR_TYPE_LABELS[item.type] ?? item.type}（登録後は変更できません）
                </p>
              </section>

              <section className="bg-canvas rounded-card border-hairline border p-4">
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={schedules.length > 0}
                    onChange={() => {
                      if (schedules.length === 0) {
                        const now = jstNowLocalInput()
                        setDraft({ date: now.date, time: '00:00', value })
                      }
                    }}
                    className="mt-1 accent-green-500"
                  />
                  <span>
                    <span className="text-ink block text-sm font-semibold">この日を過ぎたら、自動で文字を変える</span>
                    <span className="text-ink-faint mt-1 block text-xs">
                      期間が終わったら出したくない案内や、次の値へ切り替えるときに使います。
                    </span>
                  </span>
                </label>
                {schedules.map((schedule) => (
                  <div key={schedule.id} className="border-hairline mt-3 flex flex-wrap items-center justify-between gap-3 border-t pt-3 text-xs">
                    <span className="text-ink-secondary">
                      {formatStamp(schedule.effectiveFrom)} に「{schedule.value || '（空）'}」へ変更
                    </span>
                    <Button type="button" onClick={() => void removeSchedule(schedule.id)}>予定を削除</Button>
                  </div>
                ))}
                {/*
                  予約中の扱いを保存前に明示する（IDEA-14）。いま値を保存
                  してもこの予定は消えず、時刻になると登録した値へ変わる
                  （applyDueCommonVarSchedules と同じ動き）。
                */}
                {schedules.length > 0 ? (
                  <p className="text-ink-faint mt-3 text-xs">
                    いま値を保存しても、この予定は消えません。予定の時刻になると、ここに登録した値へ変わります。
                  </p>
                ) : null}
              </section>

              <section className="bg-canvas rounded-card border-hairline border p-4">
                <h2 className="text-ink text-sm font-bold">これまでの変更</h2>
                {item.history.length > 0 ? (
                  <ol className="divide-hairline mt-3 divide-y">
                    {item.history.slice(0, 5).map((entry, index) => {
                      const previous = item.history[index + 1]
                      return (
                        <li key={entry.id} className="py-3 first:pt-0">
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                            <span className="text-ink font-semibold">{formatStamp(entry.createdAt)}</span>
                            <span className="text-ink-faint">{entry.actorName ?? (entry.actorId ? '担当者名を確認できません' : '担当者未記録')}</span>
                          </div>
                          <p className="text-ink-secondary mt-1 text-xs break-words">
                            {previous
                              ? `「${previous.value || '（空）'}」→「${entry.value || '（空）'}」`
                              : 'はじめて登録'}
                          </p>
                          {entry.changeReason ? <p className="text-ink-faint mt-1 text-xs">理由：{entry.changeReason}</p> : null}
                        </li>
                      )
                    })}
                  </ol>
                ) : (
                  <p className="text-ink-faint mt-3 text-sm">まだ変更履歴はありません。</p>
                )}
                <p className="text-ink-faint mt-2 text-xs">
                  変えた時点より前に送った配信の文面は、そのときの値のままです。あとから遡って変わることはありません。
                </p>
              </section>

              {saved && <p className="text-success text-sm">保存しました。</p>}
            </div>

            <aside className="space-y-4">
              {/* 変える前の影響確認（設計 `uNBlA` 14-1-B）。読めない値は0件にしない。 */}
              <section data-design-node="uNBlA">
                <div className="bg-canvas rounded-card border-hairline border">
                  <div className="border-hairline flex items-center justify-between gap-3 border-b px-4 py-3">
                    <div>
                      <p className="text-ink-faint text-xs font-bold">影響確認</p>
                      <h2 className="text-ink text-sm font-bold">使われている場所</h2>
                    </div>
                    <span className="text-action text-xs font-bold">
                      {impactState === 'ready' && impact ? `${impact.total.toLocaleString('ja-JP')}か所` : NOT_AVAILABLE}
                    </span>
                  </div>
                  {impactState !== 'ready' || !impact ? (
                    <div className="p-4" data-impact-state={impactState}>
                      <p className="text-ink-secondary text-sm">{impactStateText(impactState)}</p>
                      {impactState === 'error' ? (
                        <Button
                          type="button"
                          className="mt-3"
                          onClick={() => {
                            if (item && selectedAccountId) void loadImpact(item.id, selectedAccountId)
                          }}
                        >
                          {STATE_TEXT.retry}
                        </Button>
                      ) : null}
                    </div>
                  ) : (
                    <>
                      <div className="border-hairline space-y-1 border-b px-4 py-3 text-xs">
                        <p className="text-ink-secondary font-semibold">{changeSummaryText(impact)}</p>
                        {reflectionScopeText(impact) ? (
                          <p className="text-ink-faint">{reflectionScopeText(impact)}</p>
                        ) : null}
                        {reflectionTimingText(impact) ? (
                          <p className="text-ink-faint">{reflectionTimingText(impact)}</p>
                        ) : null}
                        {historicalText(impact) ? (
                          <p className="text-ink-faint">{historicalText(impact)}</p>
                        ) : null}
                      </div>
                      {usageGroups.length > 0 ? (
                        <ul className="divide-hairline divide-y">
                          {usageGroups.map((group) => (
                            <li key={group.kind} className="px-4 py-3">
                              <p className="text-ink text-sm font-semibold">
                                {group.kindLabel} {group.count.toLocaleString('ja-JP')}件
                              </p>
                              <p className="text-ink-faint mt-1 truncate text-xs" title={group.names.join(' ／ ')}>
                                {group.names.join(' ／ ')}
                                {group.count > group.names.length ? ` ほか${group.count - group.names.length}件` : ''}
                              </p>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-ink-faint p-4 text-sm">現在の使用先はありません。</p>
                      )}
                      {hiddenText(impact) ? (
                        <p className="text-ink-faint border-hairline border-t px-4 py-3 text-xs">
                          名前を確認できない使用先：{hiddenText(impact)}
                        </p>
                      ) : null}
                      <p className="text-ink-faint border-hairline border-t px-4 py-3 text-xs">
                        {checkedAtText(impact.checkedAt)} 時点で確認
                      </p>
                      {/* 案内は、下の操作列に同じボタンが出ているときだけ。
                          0か所や未変更（canSave無し）のときに「見るへ進め」と
                          言うと、存在しない操作を探させることになる。 */}
                      {'canSave' in impact && impact.blockingTotal > 0 ? (
                        <p className="text-ink-faint border-hairline border-t px-4 py-3 text-xs">
                          1件ずつ確かめるときは「{impact.blockingTotal.toLocaleString('ja-JP')}か所を1件ずつ見る」へ進んでください。
                        </p>
                      ) : null}
                    </>
                  )}
                </div>
              </section>

              <section className="bg-canvas rounded-card border-hairline border p-4">
                <h2 className="text-ink text-sm font-bold">差し込んだときの見え方</h2>
                {impactState === 'ready' && impact && previewUsage ? (
                  <div className="mt-3 space-y-3 text-xs">
                    <p className="text-ink-faint">
                      {previewUsage.kindLabel}「{previewUsage.name}」
                    </p>
                    <div>
                      <p className="text-ink-faint">いまの文</p>
                      <p className="text-ink-secondary mt-1 break-words">{previewUsage.currentPreview}</p>
                    </div>
                    <div className="bg-accent-soft rounded-control p-3">
                      <p className="text-ink-secondary font-semibold">保存したあとの文</p>
                      <p className="text-ink mt-1 break-words">
                        {isChangeItem(previewUsage)
                          ? previewUsage.nextPreview ?? `${NOT_AVAILABLE}（使用先を開いて確認してください）`
                          : '値を変えると、ここに保存後の文が出ます。'}
                      </p>
                    </div>
                    {'canSave' in impact ? (
                      <>
                        {blockingErrors(impact).length > 0 ? (
                          <ul className="text-danger list-disc space-y-1 pl-5">
                            {blockingErrors(impact).map((message) => <li key={message}>{message}</li>)}
                          </ul>
                        ) : (
                          <p className="text-success font-semibold">保存を止める問題は見つかりませんでした。</p>
                        )}
                        {reviewWarnings(impact).map((message) => (
                          <p key={message} className="text-ink-secondary">{message}</p>
                        ))}
                      </>
                    ) : null}
                  </div>
                ) : impactState !== 'ready' || !impact ? (
                  // 読み込み中・失敗・権限不足は、その状態のまま言う。
                  // 「確認中です」と出し続けると、0件確定や失敗と見分けが付かない。
                  <p className="text-ink-faint mt-3 text-sm">
                    {impactState === 'loading'
                      ? '使用先の本文を確認しています。'
                      : impactStateText(impactState)}
                  </p>
                ) : impact.total === 0 ? (
                  // 0件は「確認済みの0」。見せる文が無いことを、そのまま言う。
                  <p className="text-ink-faint mt-3 text-sm">
                    使われている場所がないため、確かめる文はありません。
                  </p>
                ) : (
                  // 使用先はあるが、保存ですぐ変わるものは無い（送信済みだけ等）。
                  // 未取得と混ぜず、理由を書く。
                  <p className="text-ink-faint mt-3 text-sm">{NOT_AVAILABLE}（すぐ変わる使用先の文はありません）</p>
                )}
              </section>
            </aside>
          </div>

          {/*
            削除は左端、保存は中央。**消す操作を保存の隣に置かない。**
            隣にあると、押し間違いが「保存したつもりが消えていた」になる。
          */}
          <StickyBar
            destructive={(
              <button
                type="button"
                onClick={() => void openDelete()}
                className="rounded-control bg-status-danger text-on-accent px-4 py-2 text-sm font-bold"
              >
                この共通情報を削除
              </button>
            )}
            actions={(
              <>
                <Button href="/contents/vars">キャンセル</Button>
                {blocked.length > 0 && (
                  <span className="text-danger text-xs">
                    {blocked[0]}。直すまで保存できません。
                  </span>
                )}
                {impact && 'canSave' in impact && impact.blockingTotal > 0 ? (
                  <Button
                    type="button"
                    data-qa-open="uNBlA"
                    onClick={() => setShowImpactReview(true)}
                  >
                    {impact.blockingTotal.toLocaleString('ja-JP')}か所を1件ずつ見る
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="primary"
                  disabled={saving || blocked.length > 0}
                  onClick={() => {
                    if (impact && 'canSave' in impact && impact.blockingTotal > 0) {
                      setShowImpactReview(true)
                      return
                    }
                    void save()
                  }}
                >
                  {saving ? '保存中…' : '共通情報を保存'}
                </Button>
              </>
            )}
          />
        </>
      )}

      {draft && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="スケジュール設定"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setDraft(null)
          }}
        >
          <div className="rounded-card bg-canvas w-full max-w-md space-y-4 p-6 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <p className="text-ink text-sm font-semibold">スケジュール設定</p>
              <button type="button" onClick={() => setDraft(null)} aria-label="閉じる" className="rounded-mini p-1 text-ink-secondary hover:bg-canvas-sunken">
                <X aria-hidden="true" className="h-5 w-5" />
              </button>
            </div>
            <div className="flex flex-wrap gap-3">
              <div>
                <label htmlFor="sc-date" className="text-ink-secondary mb-1 block text-xs font-medium">
                  開始日
                </label>
                <input
                  id="sc-date"
                  type="date"
                  value={draft.date}
                  min={jstNowLocalInput().date}
                  onChange={(e) => setDraft({ ...draft, date: e.target.value })}
                  className="border-hairline rounded-control border px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label htmlFor="sc-time" className="text-ink-secondary mb-1 block text-xs font-medium">
                  開始時刻
                </label>
                <input
                  id="sc-time"
                  type="time"
                  value={draft.time}
                  onChange={(e) => setDraft({ ...draft, time: e.target.value })}
                  className="border-hairline rounded-control border px-2 py-1.5 text-sm"
                />
              </div>
            </div>
            <div>
              <label htmlFor="sc-value" className="text-ink-secondary mb-1 block text-xs font-medium">
                更新後の値
              </label>
              {item?.type === 'boolean' ? (
                <SelectField
                  id="sc-value"
                  value={draft.value}
                  onChange={(e) => setDraft({ ...draft, value: e.target.value })}
                  options={[{ value: '', label: '選んでください' }, { value: 'true', label: 'true' }, { value: 'false', label: 'false' }]}
                  className="w-full"
                />
              ) : (
                <input
                  id="sc-value"
                  type={item?.type === 'number' ? 'number' : (item?.type as string) === 'date' ? 'date' : (item?.type as string) === 'datetime' ? 'datetime-local' : 'text'}
                  value={draft.value}
                  onChange={(e) => setDraft({ ...draft, value: e.target.value })}
                  className="border-hairline rounded-control w-full border px-3 py-2 text-sm"
                />
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDraft(null)}
                className="border-hairline text-ink-secondary rounded-control border px-4 py-2 text-sm"
              >
                キャンセル
              </button>
              <button
                onClick={() => void addSchedule()}
                className="bg-accent-deep text-on-accent rounded-control px-6 py-2 text-sm font-medium"
              >
                登録
              </button>
            </div>
          </div>
        </div>
      )}

      {/*
        取り消せないので `destructive` を付ける。共通情報を消すと
        `common_var_schedules` は `var_id ... ON DELETE CASCADE` なので
        次回予約も一緒に消える（`packages/db/migrations/101_content_library.sql`）。
        テンプレート側は外部キーではなく差し込みキーの文字なので、消しても
        テンプレートは残り、差し込んでいた場所が空欄になる。
      */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title={deleteTarget ? `共通情報「${deleteTarget.item.name}」を削除しますか？` : ''}
        description="この共通情報と、登録値・次回の更新予約を削除します。テンプレート・配信・フォルダ・友だちは削除しません。この操作は取り消せません。"
        confirmLabel="削除する"
        destructive
        busy={deleting}
        error={
          deleteAccountSwitched
            ? '窓を開けたあとにLINEアカウントが切り替わりました。この共通情報は、いま選んでいるアカウントのものではありません。閉じてから選び直してください。'
            : deleteError
        }
        /*
          消せないときは押し口ごと出さない（`ConfirmDialog` は `onConfirm` を
          渡さないとボタンを出さない）。押せるように見えて何も起きない形にしない。
        */
        onConfirm={
          deleteAccountSwitched || deletePhase !== 'ready' || !deleteImpact?.canDelete
            ? undefined
            : () => void remove()
        }
        onCancel={closeDelete}
      >
        <div className="space-y-2 text-xs leading-5">
          {deletePhase === 'loading' ? (
            <p className="text-ink-faint">使われている場所を読み込んでいます</p>
          ) : deletePhase === 'error' ? (
            <p className="text-danger font-semibold" role="alert">
              使用先を読み込めませんでした。読み直してから、もう一度お試しください。
            </p>
          ) : deleteImpact ? (
            <>
              <p className={deleteImpact.blockingTotal > 0 ? 'text-danger font-semibold' : 'text-ink-secondary'}>
                {deleteImpact.blockingTotal > 0
                  ? `いま${deleteImpact.blockingTotal}か所で使われています。先に差し替えてください。`
                  : '使っている設定はありません。'}
              </p>
              {deleteImpact.items
                .filter((usage) => usage.blocksDeletion)
                .map((usage) => (
                  <p key={`${usage.kind}-${usage.href}`} className="text-ink-secondary">
                    ・{usage.kindLabel}「{usage.name}」・{usage.status}
                  </p>
                ))}
              {/*
                **数えられていないものを「0か所」に混ぜない。**
                所属を確かめられないフォームは、名前も件数も混ぜずに断る。
              */}
              {deleteImpact.unavailableReferences.map((ref) => (
                <p key={ref.kind} className="text-ink-faint">
                  ・{ref.kindLabel}からの参照{ref.count}件は、{ref.reason}。
                </p>
              ))}
              {/*
                件数は書かない。予約の読み込みに失敗しても画面は開くので、
                そのときに「0件」と書くと、消えるものが無いように読める。
              */}
              <p className="text-ink-secondary">
                ・消えること: この共通情報に登録した更新スケジュールも一緒に消えます。
              </p>
              <p className="text-ink-secondary">
                ・残ること: テンプレートは残ります。{placeholderText(deleteTarget?.item.varKey ?? '')}
                と書いてある場所は、これから空欄で送られます。
              </p>
              <p className="text-ink-secondary">・残ること: すでに送ったものは変わりません。</p>
            </>
          ) : null}
        </div>
      </ConfirmDialog>

      {leaveConfirmDialog}
    </div>
  )
}

export default function EditCommonVarPage() {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      {/* 直URLでも共通情報オフのaccountには画面を出さない。 */}
      <FeatureGate feature="common_vars">
        <EditCommonVarInner />
      </FeatureGate>
    </Suspense>
  )
}
