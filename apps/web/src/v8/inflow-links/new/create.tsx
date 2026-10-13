'use client'

import { requiredText } from '@/lib/form-requirement'
const b244Requirements = {
  name: requiredText("リンク名を入力してください"),
}


import Toggle from '@/components/shared/toggle';
import { formatDate as polishFormatDate } from '@/lib/format'
import { createPageReturnHref } from '@/components/shared/create-page'
import { SaveConflictBand } from '@/components/shared/save-conflict'
import { useSearchParams } from 'next/navigation'
import { useListNavigationRouter as useRouter } from '@/components/shared/list-navigation'
import { Suspense, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ArrowLeftRight, Link2, RefreshCw, TriangleAlert } from 'lucide-react'
import type { ApiResponse, EntryRoute, EntryRouteGenre, Scenario, Tag, TagGroup, TrafficPool, Template } from '@line-crm/shared'
import { ApiError, api, type BroadcastMessageAsset } from '@/lib/api'
import { isPoolsFeatureAvailable } from '@/lib/pools-availability'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { useAccount } from '@/contexts/account-context'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { CreatePage } from '@/components/templates'
import Notice from '@/components/shared/notice'
import ListState from '@/components/shared/list-state'
import Button from '@/components/shared/button'
import Card, { CardHeader } from '@/components/shared/card'
import Dialog from '@/components/shared/dialog'
import HelpTip from '@/components/shared/help-tip'
import LinePreview, { LinePreviewMessage } from '@/components/shared/line-preview'
import { describeApiFailure } from '@/components/shared/api-error-message'
import Select from '@/components/shared/select'
import { EntityKindDialog } from '@/components/shared/entity-picker-sources'
import { Th } from '@/components/shared/table'
import Checkbox from '@/components/shared/checkbox'
import { TextField } from '@/components/shared/text-field'
import { focusField } from '../focus-field'
import { groupTagsByFolder } from './tag-options'
import CouponSettings, { type CouponSettingsValue } from '../coupon-settings'
import styles from './create.module.css'
import { Field, FieldError } from '@/components/shared/form-controls'
import { SaveErrorField, SaveErrorScope, useSaveFormErrors } from '@/components/shared/save-form-errors'
import ActionList from '@/components/shared/action-list'
import { EntityPickerField } from '@/components/shared/entity-picker'
import EntitySelect, { entityOptionMetadata } from '@/components/shared/entity-select'
import { SettingsFormRow } from '@/components/shared/settings-form-card'

/*
 * ★V8 流入リンクを作る（Pencil：作る `KMaMk`・競合 `vWJEm`・競合の比べ `E14GFm`）。
 *
 * 型（CreatePage）に、4つの段（どこに置くか・どのアカウントか・友だちになったとき・発行される URL）と、
 * 右の列（お客さまの進む順・スマホの見え方）、下の帯を渡す。
 *
 * 聞く項目・保存の口・送る形・失敗の扱いは今の作る画面（app/inflow-links/new/page.tsx）と同じ
 * （BEHAVIOR.md）。違うのは見せ方だけ：
 * - 競合（vWJEm）：発行が 409（見分けるための文字が使用中）で返ったら、板の頭の下に帯を出す
 * - 違いを比べる（E14GFm）：違う項目だけを並べた窓。「最新を取り込んで直す」で保存されている値を入力へ写す
 */

/* ref は口（entry-routes.ts）と同じ `[A-Za-z0-9_-]{1,64}`。 */
const REF_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

/** 名前から ref の候補を作る。日本語からは作れないので空にする。 */
function suggestRef(name: string): string {
  const ascii = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return /^[a-z0-9]/.test(ascii) ? ascii.slice(0, 64) : ''
}

/** 保存日時（実データ）を「M月d日 H:mm」にする。壊れていたら出さない。 */
function formatSavedAt(value: string): string {
  return polishFormatDate(value, { style: 'detail', fallback: '' })
}

export default function InflowCreateV8() {
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <InflowCreate />
    </Suspense>
  )
}

function InflowCreate() {
  const saveErrors = useSaveFormErrors()
  usePageTitle('流入リンクを作る')
  usePageCrumbs([{ label: 'ホーム', href: '/' }, { label: '流入と計測', href: '/inflow-links' }])
  const router = useRouter()
  /* `?name=`・`?ref=` で名前と見分けるための文字を入れて開ける（ほかの画面から「この名前で作る」）。 */
  const params = useSearchParams()
  const initialName = params.get('name') ?? ''
  const initialRef = params.get('ref') ?? ''
  const { selectedAccountId, selectedAccount } = useAccount()
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [name, setName] = useState(initialName)
  const [genre, setGenre] = useState('')
  const [newGenre, setNewGenre] = useState('')
  const [genres, setGenres] = useState<EntryRouteGenre[]>([])
  const [candidatesError,setCandidatesError]=useState(false)
  const [candidatesLoading,setCandidatesLoading]=useState(true)
  const [candidatesRetry,setCandidatesRetry]=useState(0)
  const [refCode, setRefCode] = useState(initialRef || suggestRef(initialName))
  const [refTouched, setRefTouched] = useState(initialRef !== '')
  const [tagId, setTagId] = useState('')
  const [scenarioId, setScenarioId] = useState('')
  const [introTemplateId, setIntroTemplateId] = useState('')
  const [coupon, setCoupon] = useState<CouponSettingsValue>({ couponEnabled: false, couponAssetId: null, couponAudience: 'new_friends' })
  const [couponOptions, setCouponOptions] = useState<BroadcastMessageAsset[]>([])
  const [poolId, setPoolId] = useState('')
  const [redirectUrl, setRedirectUrl] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [tags, setTags] = useState<Tag[]>([])
  const [, setTagGroups] = useState<TagGroup[]>([])
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [pools, setPools] = useState<TrafficPool[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [pruneNotice, setPruneNotice] = useState<string | null>(null)
  /* 発行が 409（見分けるための文字が使用中）で返り、同じ文字の発行済みリンクが見つかったときだけ立つ。 */
  const [conflict, setConflict] = useState<EntryRoute | null>(null)
  const [showCompare, setShowCompare] = useState(false)

  useEffect(() => {
    clearConflict()
    setCoupon({ couponEnabled: false, couponAssetId: null, couponAudience: 'new_friends' })
    setCouponOptions([])
  },[selectedAccountId])
  useEffect(()=>{
    let cancelled = false
    setCandidatesError(false)
    setCandidatesLoading(true)
    /* プールは補助データ。機能がオフでも発行画面は止めない。有効と分からない限り口を呼ばない。 */
    const poolsRequest: Promise<ApiResponse<TrafficPool[]>> = isPoolsFeatureAvailable().then((ok) =>
      ok ? api.pools.list({ suppressFeatureDisabledEvent: true }) : { success: false as const, error: 'feature_disabled' },
    )
    /* 候補は今のアカウントだけ（別アカウントの同名タグを混ぜない）。 */
    const accountParams = selectedAccountId ? { accountId: selectedAccountId } : undefined
    void Promise.allSettled([
      api.tags.list(accountParams),
      api.scenarios.list(accountParams),
      poolsRequest,
      api.templates.list(undefined, selectedAccountId ?? undefined),
      api.tagGroups.list(selectedAccountId),
      api.entryRouteGenres.list(),
    ]).then(([t, s, p, tp, tg, g]) => {
      if (cancelled) return
      setCandidatesLoading(false)
      const required=[t,s,tp,tg,g]
      if(required.some(result=>result.status==='rejected'||!result.value.success)||p.status==='rejected'||(!p.value.success&&p.value.error!=='feature_disabled')){setCandidatesError(true);return}
      if (t.status === 'fulfilled' && t.value.success) setTags(t.value.data)
      if (tg.status === 'fulfilled' && tg.value.success) setTagGroups(tg.value.data)
      if (s.status === 'fulfilled' && s.value.success) setScenarios(s.value.data)
      if (p.status === 'fulfilled' && p.value.success) setPools(p.value.data)
      if (tp.status === 'fulfilled' && tp.value.success) setTemplates(tp.value.data as unknown as Template[])
      if (g.status === 'fulfilled' && g.value.success) setGenres(g.value.data)
    })
    return () => { cancelled = true }
    // 候補はアカウントごとに違う。切替後に古い候補のまま保存しないよう取り直す（入力は残す）。
  }, [selectedAccountId,candidatesRetry])

  /* 新しい候補にない選択は外し、外したときだけ帯で知らせる。 */
  useEffect(() => {
    const tagIds = new Set(tags.map((tag) => tag.id))
    const scenarioIds = new Set(scenarios.map((scenario) => scenario.id))
    const templateIds = new Set(templates.map((template) => template.id))
    let removed = 0
    if (tagId && !tagIds.has(tagId)) { setTagId(''); removed += 1 }
    if (scenarioId && !scenarioIds.has(scenarioId)) { setScenarioId(''); removed += 1 }
    if (introTemplateId && !templateIds.has(introTemplateId)) { setIntroTemplateId(''); removed += 1 }
    if (removed > 0) setPruneNotice(`選んでいた候補のうち${removed} 件は、今のアカウントにないため外しました。選び直してください。`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tags, scenarios, templates])

  const validRef = REF_PATTERN.test(refCode)
  const workerBase = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '')
  /* ref が決まったときだけ見本の URL を作る（空欄で発行済みに見せない）。 */
  const previewUrl = validRef ? `${workerBase}/r/${refCode}` : ''

  const dirty = Boolean(
    (name && name !== initialName) || genre || newGenre || (refCode && refCode !== initialRef && refCode !== suggestRef(initialName))
    || coupon.couponEnabled || coupon.couponAssetId || tagId || scenarioId || introTemplateId || poolId || redirectUrl || !isActive,
  )
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty, busy: saving })

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  /* 発行の失敗は原文のまま出さない（403 は権限、409 は重複の立て直し、ほかは再試行の案内）。 */
  const doSave = async () => {
    if(candidatesError || candidatesLoading)return
    setSaveError(null)
    const errors: Record<string, string> = {}
    if ((b244Requirements.name.check(name) !== null)) errors['ir-name'] = 'リンク名を入力してください'
    if (!validRef) errors['ir-ref'] = '半角英数字・_・ハイフンで1〜64文字にしてください'
    if (redirectUrl.trim()) {
      try {
        const url = new URL(redirectUrl.trim())
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error()
      } catch (saveFailure) {
        saveErrors.capture(saveFailure);
 errors['ir-redirect'] = 'http または https で始まる URL を入力してください' }
    }
    if (coupon.couponEnabled && !coupon.couponAssetId) { setSaveError('渡すクーポンを選んでください'); return }
    setFieldErrors(errors)
    if (Object.keys(errors).length) {
      focusField(Object.keys(errors)[0])
      return
    }
    if (!selectedAccountId) {
      setSaveError('LINEアカウントを選んでください（画面上部で選べます）')
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      const genreName = genre === '__new' ? newGenre.trim() : genre
      const res = await api.entryRoutes.create({
        name: name.trim(),
        genre: genreName || null,
        refCode: refCode.trim(),
        tagId: tagId || null,
        scenarioId: scenarioId || null,
        introTemplateId: introTemplateId || null,
        poolId: poolId || null,
        redirectUrl: redirectUrl.trim() || null,
        isActive,
        lineAccountId: selectedAccountId,
        ...coupon,
      })
      if (!res.success) throw new Error(res.error)
      router.push(createPageReturnHref('/inflow-links', res.data.id))
    } catch (error) {
      const fieldFailure = saveErrors.capture(error);

      if (error instanceof ApiError && error.status === 409) {
        /* 見分けるための文字が使用中。同じ文字の発行済みリンクを探して比べられるようにする。 */
        const existing = await findRouteByRef(refCode.trim(), selectedAccountId)
        if (existing) {
          setConflict(existing)
          setShowCompare(false)
          { if (!fieldFailure)
          setSaveError(null) }
          return
        }
      }
      { if (!fieldFailure)
      setSaveError(describeApiFailure(error, '発行', {
        scope: 'store',
      })) }
    } finally {
      setSaving(false)
    }
  }

  /* ref は全体で一意。まず今のアカウント、無ければ見える範囲の全部から同じ文字を探す。 */
  async function findRouteByRef(ref: string, accountId: string): Promise<EntryRoute | null> {
    const pick = (routes: EntryRoute[]): EntryRoute | null => routes.find((route) => route.refCode === ref) ?? null
    try {
      const scoped = await api.entryRoutes.list(accountId)
      if (scoped.success) {
        const hit = pick(scoped.data)
        if (hit) return hit
      }
      const all = await api.entryRoutes.list()
      if (all.success) return pick(all.data)
    } catch (saveFailure) {
      saveErrors.capture(saveFailure)
      // 探せないときは競合にしない。通常の失敗文を出す。
    }
    return null
  }

  function clearConflict(): void {
    if (conflict) {
      setConflict(null)
      setShowCompare(false)
    }
  }

  /* 「最新を取り込んで直す」：保存されている値を入力へ写す。文字は競合のままなので変えてから発行する。 */
  function loadLatestAndContinue(): void {
    if (!conflict) return
    setName(conflict.name)
    if (conflict.genre && genres.some((item) => item.name === conflict.genre)) {
      setGenre(conflict.genre)
      setNewGenre('')
    } else if (conflict.genre) {
      setGenre('__new')
      setNewGenre(conflict.genre)
    } else {
      setGenre('')
      setNewGenre('')
    }
    setTagId(conflict.tagId && tags.some((tag) => tag.id === conflict.tagId) ? conflict.tagId : '')
    setScenarioId(conflict.scenarioId && scenarios.some((scenario) => scenario.id === conflict.scenarioId) ? conflict.scenarioId : '')
    setIntroTemplateId(conflict.introTemplateId && templates.some((template) => template.id === conflict.introTemplateId) ? conflict.introTemplateId : '')
    setPoolId(conflict.poolId && pools.some((pool) => pool.id === conflict.poolId) ? conflict.poolId : '')
    setRedirectUrl(conflict.redirectUrl ?? '')
    setIsActive(conflict.isActive)
    setCoupon({ couponEnabled: conflict.couponEnabled ?? false, couponAssetId: conflict.couponAssetId ?? null, couponAudience: conflict.couponAudience ?? 'new_friends' })
    setShowCompare(false)
    setSaveError(null)
  }

  const tagName = tags.find((tag) => tag.id === tagId)?.name ?? null
  const scenarioName = scenarios.find((scenario) => scenario.id === scenarioId)?.name ?? null
  const introTemplate = templates.find((template) => template.id === introTemplateId) ?? null
  const previewMessage = introTemplate?.messageContent || 'はじめまして。友だち追加ありがとうございます。'

  /* 違いを比べる：左は今の入力、右は保存されている値（どちらも実データ）。違う項目だけを並べる。 */
  const resolveCandidate = (id: string | null, names: Map<string, string>, empty: string): string => {
    if (!id) return empty
    return names.get(id) ?? '（このアカウントにありません）'
  }
  const tagNames = new Map(tags.map((tag) => [tag.id, tag.name] as const))
  const scenarioNames = new Map(scenarios.map((scenario) => [scenario.id, scenario.name] as const))
  const templateNames = new Map(templates.map((template) => [template.id, template.name] as const))
  const poolNames = new Map(pools.map((pool) => [pool.id, pool.name] as const))
  const poolName = poolId ? poolNames.get(poolId) ?? '（このアカウントにありません）' : 'メインプールで自動振り分け'
  const afterAdd = (tag: string | null, intro: string | null, scenario: string | null) =>
    [tag ? `タグ「${tag}」` : null, intro ? `テンプレート「${intro}」` : null, scenario ? `シナリオ「${scenario}」` : null]
      .filter(Boolean).join('＋') || '何もしない'
  const describeCoupon = (enabled?: boolean, assetId?: string | null, audience?: string) => enabled
    ? `${assetId ? couponOptions.find((item) => item.id === assetId)?.name ?? '現在選べないクーポン' : '（未選択）'} / ${audience === 'all_friends' ? 'すでに友だちの人にも' : '新しく友だちになった人だけ'}`
    : 'なし'
  const conflictRows = conflict ? [
    { label: '名前', mine: name.trim() || '（未設定）', saved: conflict.name },
    { label: 'フォルダ', mine: genre === '__new' ? newGenre.trim() || '（未設定）' : genre || '（未設定）', saved: conflict.genre ?? '（未設定）' },
    {
      label: '友だちになったら',
      mine: afterAdd(tagName, introTemplate?.name ?? null, scenarioName),
      saved: afterAdd(
        conflict.tagId ? resolveCandidate(conflict.tagId, tagNames, '') : null,
        conflict.introTemplateId ? resolveCandidate(conflict.introTemplateId, templateNames, '') : null,
        conflict.scenarioId ? resolveCandidate(conflict.scenarioId, scenarioNames, '') : null,
      ),
    },
    { label: '行き先 URL', mine: redirectUrl.trim() || '（未設定）', saved: conflict.redirectUrl ?? '（未設定）' },
    {
      label: '追加先',
      mine: poolName,
      saved: conflict.poolId ? poolNames.get(conflict.poolId) ?? '（このアカウントにありません）' : 'メインプールで自動振り分け',
    },
    { label: 'クーポン', mine: describeCoupon(coupon.couponEnabled, coupon.couponAssetId, coupon.couponAudience), saved: describeCoupon(conflict.couponEnabled, conflict.couponAssetId, conflict.couponAudience),
      different: coupon.couponEnabled !== Boolean(conflict.couponEnabled) || (coupon.couponEnabled && (coupon.couponAssetId !== conflict.couponAssetId || coupon.couponAudience !== (conflict.couponAudience ?? 'new_friends'))) },
    { label: '公開', mine: isActive ? '公開する' : '公開しない', saved: conflict.isActive ? '公開する' : '公開しない' },
  ].filter((row) => 'different' in row ? row.different : row.mine !== row.saved) : []
  const conflictSavedAt = conflict ? formatSavedAt(conflict.updatedAt) : ''

  const conflictBand = conflict ? (
    <SaveConflictBand title={`「${conflict.refCode}」は${conflictSavedAt ? ` ${conflictSavedAt} に` : ''}「${conflict.name}」で保存されています`} description="同じ文字のまま発行はできません。文字を変えるか、違いを比べてください" onCompare={() => setShowCompare(true)} onReload={loadLatestAndContinue} />
  ) : null

  const step4 = coupon.couponEnabled ? 'トークにクーポンが届く' : introTemplate
    ? `メッセージ「${introTemplate.name}」が届く（右のスマホ）`
    : scenarioName
      ? `シナリオ「${scenarioName}」が始まる`
      : 'あいさつのメッセージが届く（右のスマホ）'
  const preview = (
    <div className={styles.side}>
      <CardHeader size="stacked" title="お客さまはこの順に進みます" />
      <Card variant="aside" gap="tight">
      <ol className={styles.steps}>
        <li className={styles.step}><span className={styles.stepNum} aria-hidden="true">1</span><span>QR コード・URL を開く</span></li>
        <li className={styles.step}><span className={styles.stepNum} aria-hidden="true">2</span><span>LINE で友だちになる（この経路で数える）</span></li>
        <li className={styles.step}><span className={styles.stepNum} aria-hidden="true">3</span><span>{tagName ? `タグ「${tagName}」が付く` : 'タグは付かない'}</span></li>
        <li className={styles.step}><span className={`${styles.stepNum} ${styles.stepNumNow}`} aria-hidden="true">4</span><span>{step4}</span></li>
      </ol>
      </Card>
      <div>
        <LinePreview title={null} accountName={selectedAccount?.name ?? '公式アカウント'} caption="登録した日 10:00">
          <LinePreviewMessage accountName={selectedAccount?.name ?? '公式アカウント'} avatar={(selectedAccount?.name ?? '公').slice(0, 1)} time="10:00">
            {previewMessage}
          </LinePreviewMessage>
        </LinePreview>
      </div>
    </div>
  )

  return (
    <SaveErrorScope errors={saveErrors}><CreatePage
      hidePreviewWhenNarrow
      boardId="KMaMk"
      title="流入リンクを作る"
      help="友だち追加の入口を作り、どこから来たかと、追加後に行うことを決めます。"
      /* 競合の帯（vWJEm）は板の頭の下・左右の列の上に、板いっぱいで出す（型の頭と本文の間の段）。 */
      notice={conflictBand}
      preview={preview}
      footerActions={(
        <>
          <Button href="/inflow-links">キャンセル</Button>
          {conflict ? (
            <Button variant="primary" onClick={() => setShowCompare(true)} disabled={saving}><ArrowLeftRight size={15} aria-hidden="true" />比べてから保存</Button>
          ) : (
            <Button variant="primary" onClick={() => void doSave()} disabled={saving || candidatesError || candidatesLoading} busy={saving} busyLabel="発行しています…">
              <Link2 size={15} aria-hidden="true" />発行して URL を受け取る
            </Button>
          )}
        </>
      )} dirty={false}
    >
      {candidatesError?<ListState kind="error" title="候補を読み込めませんでした" onRetry={()=>setCandidatesRetry(value=>value+1)}/>:null}
      {pruneNotice ? <Notice tone="warn" message={pruneNotice} onClose={() => setPruneNotice(null)} /> : null}
      {saveError ? <Notice tone="danger" message={saveError} onClose={() => setSaveError(null)} /> : null}

      <Card variant="form" gap="normal" aria-labelledby="ir-new-where">
        <CardHeader size="stacked" titleId="ir-new-where" title={<>どこに置くリンクですか</>} meta={<>名前は一覧で見分けるため。お客さまには見えません</>} />
