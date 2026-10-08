'use client'

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
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ArrowLeftRight, Link2, RefreshCw, TriangleAlert } from 'lucide-react'
import type { ApiResponse, EntryRoute, EntryRouteGenre, Scenario, Tag, TagGroup, TrafficPool, Template } from '@line-crm/shared'
import { ApiError, api } from '@/lib/api'
import { isPoolsFeatureAvailable } from '@/lib/pools-availability'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { useAccount } from '@/contexts/account-context'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { CreatePage } from '@/components/templates'
import Notice from '@/components/shared/notice'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import HelpTip from '@/components/shared/help-tip'
import ListState from '@/components/shared/list-state'
import LinePreview, { LinePreviewMessage } from '@/components/shared/line-preview'
import { describeApiFailure } from '@/components/shared/api-error-message'
import Select from '@/components/shared/select'
import { Th } from '@/components/shared/table'
import Toggle from '@/components/shared/toggle'
import { TextField } from '@/components/shared/text-field'
import { focusField } from '../focus-field'
import { groupTagsByFolder } from './tag-options'
import styles from './create.module.css'

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
  const time = new Date(value).getTime()
  if (Number.isNaN(time)) return ''
  const date = new Date(time)
  return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export default function InflowCreateV8() {
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <InflowCreate />
    </Suspense>
  )
}

function InflowCreate() {
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
  const [refCode, setRefCode] = useState(initialRef || suggestRef(initialName))
  const [refTouched, setRefTouched] = useState(initialRef !== '')
  const [tagId, setTagId] = useState('')
  const [scenarioId, setScenarioId] = useState('')
  const [introTemplateId, setIntroTemplateId] = useState('')
  const [poolId, setPoolId] = useState('')
  const [redirectUrl, setRedirectUrl] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [tags, setTags] = useState<Tag[]>([])
  const [tagGroups, setTagGroups] = useState<TagGroup[]>([])
  const tagOptionGroups = useMemo(() => groupTagsByFolder(tags, tagGroups), [tags, tagGroups])
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [pools, setPools] = useState<TrafficPool[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [showTagPick, setShowTagPick] = useState(false)
  const [showIntroPick, setShowIntroPick] = useState(false)
  const [showScenarioPick, setShowScenarioPick] = useState(false)
  const [pruneNotice, setPruneNotice] = useState<string | null>(null)
  /* 発行が 409（見分けるための文字が使用中）で返り、同じ文字の発行済みリンクが見つかったときだけ立つ。 */
  const [conflict, setConflict] = useState<EntryRoute | null>(null)
  const [showCompare, setShowCompare] = useState(false)

  useEffect(() => {
    clearConflict()
    let cancelled = false
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
      api.entryRouteGenres.list().catch(() => ({ success: false as const, data: [] as EntryRouteGenre[] })),
    ]).then(([t, s, p, tp, tg, g]) => {
      if (cancelled) return
      if (t.status === 'fulfilled' && t.value.success) setTags(t.value.data)
      if (tg.status === 'fulfilled' && tg.value.success) setTagGroups(tg.value.data)
      if (s.status === 'fulfilled' && s.value.success) setScenarios(s.value.data)
      if (p.status === 'fulfilled' && p.value.success) setPools(p.value.data)
      if (tp.status === 'fulfilled' && tp.value.success) setTemplates(tp.value.data as unknown as Template[])
      if (g.status === 'fulfilled' && g.value.success) setGenres(g.value.data)
    })
    return () => { cancelled = true }
    // 候補はアカウントごとに違う。切替後に古い候補のまま保存しないよう取り直す（入力は残す）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccountId])

  /* 新しい候補にない選択は外し、外したときだけ帯で知らせる。 */
  useEffect(() => {
    const tagIds = new Set(tags.map((tag) => tag.id))
    const scenarioIds = new Set(scenarios.map((scenario) => scenario.id))
    const templateIds = new Set(templates.map((template) => template.id))
    let removed = 0
    if (tagId && !tagIds.has(tagId)) { setTagId(''); removed += 1 }
    if (scenarioId && !scenarioIds.has(scenarioId)) { setScenarioId(''); removed += 1 }
    if (introTemplateId && !templateIds.has(introTemplateId)) { setIntroTemplateId(''); removed += 1 }
    if (removed > 0) setPruneNotice(`選んでいた候補のうち${removed}件は、今のアカウントにないため外しました。選び直してください。`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tags, scenarios, templates])

  const validRef = REF_PATTERN.test(refCode)
  const workerBase = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '')
  /* ref が決まったときだけ見本の URL を作る（空欄で発行済みに見せない）。 */
  const previewUrl = validRef ? `${workerBase}/r/${refCode}` : ''

  const dirty = Boolean(
    (name && name !== initialName) || genre || newGenre || (refCode && refCode !== initialRef && refCode !== suggestRef(initialName))
    || tagId || scenarioId || introTemplateId || poolId || redirectUrl || !isActive,
  )
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty, busy: saving })

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  /* 発行の失敗は原文のまま出さない（403 は権限、409 は重複の立て直し、ほかは再試行の案内）。 */
  const doSave = async () => {
    setSaveError(null)
    const errors: Record<string, string> = {}
    if (!name.trim()) errors['ir-name'] = 'リンク名を入力してください'
    if (!validRef) errors['ir-ref'] = '半角英数字・_・ハイフンで1〜64文字にしてください'
    if (redirectUrl.trim()) {
      try {
        const url = new URL(redirectUrl.trim())
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error()
      } catch { errors['ir-redirect'] = 'http または https で始まる URL を入力してください' }
    }
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
      })
      if (!res.success) throw new Error(res.error)
      router.push(`/inflow-links/detail?id=${res.data.id}`)
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        /* 見分けるための文字が使用中。同じ文字の発行済みリンクを探して比べられるようにする。 */
        const existing = await findRouteByRef(refCode.trim(), selectedAccountId)
        if (existing) {
          setConflict(existing)
          setShowCompare(false)
          setSaveError(null)
          return
        }
      }
      setSaveError(describeApiFailure(error, '発行', {
        forbidden: '発行するには権限が要ります。オーナーか管理者に依頼してください。',
      }))
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
    } catch {
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
    { label: '公開', mine: isActive ? '公開する' : '公開しない', saved: conflict.isActive ? '公開する' : '公開しない' },
  ].filter((row) => row.mine !== row.saved) : []
  const conflictSavedAt = conflict ? formatSavedAt(conflict.updatedAt) : ''

  const conflictBand = conflict ? (
    <div className={styles.conflictBand} role="alert" aria-label="文字が重複しています">
      <TriangleAlert size={16} aria-hidden="true" className={styles.conflictIcon} />
      <div className={styles.conflictText}>
        <p className={styles.conflictTitle}>{`「${conflict.refCode}」は${conflictSavedAt ? ` ${conflictSavedAt} に` : ''}「${conflict.name}」で保存されています`}</p>
        <p className={styles.conflictNote}>同じ文字のまま発行はできません。文字を変えるか、違いを比べてください</p>
      </div>
      <Button onClick={() => setShowCompare(true)} aria-expanded={showCompare}><ArrowLeftRight size={15} aria-hidden="true" />違いを比べる</Button>
      <Button onClick={loadLatestAndContinue}><RefreshCw size={15} aria-hidden="true" />最新を読み込んで続ける</Button>
    </div>
  ) : null

  const step4 = introTemplate
    ? `メッセージ「${introTemplate.name}」が届く（右のスマホ）`
    : scenarioName
      ? `シナリオ「${scenarioName}」が始まる`
      : 'あいさつのメッセージが届く（右のスマホ）'
  const preview = (
    <div className={styles.side}>
      <h2 className={styles.sideTitle}>お客さまはこの順に進みます</h2>
      <ol className={styles.steps}>
        <li className={styles.step}><span className={styles.stepNum} aria-hidden="true">1</span><span>QR コード・URL を開く</span></li>
        <li className={styles.step}><span className={styles.stepNum} aria-hidden="true">2</span><span>LINE で友だちになる（この経路で数える）</span></li>
        <li className={styles.step}><span className={styles.stepNum} aria-hidden="true">3</span><span>{tagName ? `タグ「${tagName}」が付く` : 'タグは付かない'}</span></li>
        <li className={styles.step}><span className={`${styles.stepNum} ${styles.stepNumNow}`} aria-hidden="true">4</span><span>{step4}</span></li>
      </ol>
      <div>
        <LinePreview title={null} accountName={selectedAccount?.name ?? '公式アカウント'} caption="登録した日 10:00">
          <LinePreviewMessage accountName={selectedAccount?.name ?? '公式アカウント'} avatar={(selectedAccount?.name ?? '公').slice(0, 1)} time="10:00">
            {previewMessage}
          </LinePreviewMessage>
        </LinePreview>
      </div>
    </div>
  )

  const actionRow = (opts: {
    title: string
    value: string | null
    on: boolean
    onOff: () => void
    open: boolean
    onToggleOpen: () => void
    pickLabel: string
    picker: ReactNode
  }) => (
    <div className={styles.actionItem}>
      <div className={styles.actionRow}>
        <Toggle checked={opts.on} label={opts.title} onChange={(next) => { if (!next) opts.onOff(); else if (!opts.on) opts.onToggleOpen() }} />
        <div className={styles.actionText}>
          <span className={styles.actionTitle}>{opts.title}</span>
          <span className={styles.actionValue}>{opts.value ?? 'まだ決めていません'}</span>
        </div>
        <Button variant="text" onClick={opts.onToggleOpen} aria-expanded={opts.open} aria-label={`${opts.pickLabel}を${opts.value ? '変える' : '決める'}`}>
          {opts.value ? '変える' : '決める'}
        </Button>
      </div>
      {opts.open ? <div className={styles.actionPick}>{opts.picker}</div> : null}
    </div>
  )

  return (
    <CreatePage
      boardId="KMaMk"
      title="流入リンクを作る"
      description="発行すると URL と QR コードができます。友だちになった人を、この経路で数えます。"
      /* 競合の帯（vWJEm）は板の頭の下・左右の列の上に、板いっぱいで出す（型の頭と本文の間の段）。 */
      notice={conflictBand}
      preview={preview}
      footerActions={(
        <>
          <Button href="/inflow-links">キャンセル</Button>
          {conflict ? (
            <Button variant="primary" onClick={() => setShowCompare(true)} disabled={saving}><ArrowLeftRight size={15} aria-hidden="true" />比べてから保存</Button>
          ) : (
            <Button variant="primary" onClick={() => void doSave()} disabled={saving} busy={saving} busyLabel="発行しています…">
              <Link2 size={15} aria-hidden="true" />発行して URL を受け取る
            </Button>
          )}
        </>
      )}
    >
      {pruneNotice ? <Notice tone="warn" message={pruneNotice} onClose={() => setPruneNotice(null)} /> : null}
      {saveError ? <Notice tone="error" message={saveError} onClose={() => setSaveError(null)} /> : null}

      <section className={styles.card} aria-labelledby="ir-new-where">
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle} id="ir-new-where">どこに置くリンクですか</h2>
          <p className={styles.cardNote}>名前は一覧で見分けるため。お客さまには見えません</p>
        </div>
        <div className={styles.fieldRow}>
          <label className={styles.field}>
            <span className={styles.label}>名前</span>
            <TextField
              id="ir-name"
              type="text"
              value={name}
              onChange={(event) => {
                setName(event.target.value)
                setFieldErrors((previous) => ({ ...previous, 'ir-name': '' }))
                if (!refTouched) { setRefCode(suggestRef(event.target.value)); setFieldErrors((previous) => ({ ...previous, 'ir-ref': '' })) }
                if (saveError) setSaveError(null)
              }}
              placeholder="夏のInstagram投稿"
              aria-invalid={Boolean(fieldErrors['ir-name'])}
              aria-describedby={fieldErrors['ir-name'] ? 'ir-name-error' : undefined}
            />
            {fieldErrors['ir-name'] ? <span id="ir-name-error" className={styles.fieldError} role="alert">{fieldErrors['ir-name']}</span> : null}
          </label>
          <div className={styles.field}>
            <span className={styles.pickLabel}>フォルダ</span>
            <Select
              id="ir-genre"
              value={genre}
              onChange={(next) => setGenre(next)}
              aria-label="フォルダ"
              size="full"
              options={[
                { value: '', label: '（選ばない）' },
                ...genres.map((item) => ({ value: item.name, label: item.name })),
                { value: '__new', label: '新しいフォルダ…' },
              ]}
            />
          </div>
        </div>
        {genre === '__new' ? (
          <TextField
            type="text"
            value={newGenre}
            onChange={(event) => setNewGenre(event.target.value)}
            placeholder="新しいフォルダの名前"
            aria-label="新しいフォルダの名前"
          />
        ) : null}
        <label className={styles.field}>
          <span className={styles.labelRow}>
            <span className={styles.label}>転送先（入れると友だち追加へ進みません）</span>
            <span className={styles.optional}>任意</span>
          </span>
          <TextField
            id="ir-redirect"
            type="url"
            value={redirectUrl}
            onChange={(event) => { setRedirectUrl(event.target.value); setFieldErrors((previous) => ({ ...previous, 'ir-redirect': '' })) }}
            placeholder="（空欄）"
            aria-invalid={Boolean(fieldErrors['ir-redirect'])}
            aria-describedby={fieldErrors['ir-redirect'] ? 'ir-redirect-error' : undefined}
          />
          {fieldErrors['ir-redirect'] ? <span id="ir-redirect-error" className={styles.fieldError} role="alert">{fieldErrors['ir-redirect']}</span> : null}
        </label>
        <label className={styles.field}>
          <span className={styles.label}>見分けるための文字（URL の最後に付く）</span>
          <TextField
            id="ir-ref"
            type="text"
            value={refCode}
            onChange={(event) => { setRefTouched(true); setRefCode(event.target.value); setFieldErrors((previous) => ({ ...previous, 'ir-ref': '' })); if (saveError) setSaveError(null); clearConflict() }}
            placeholder="summer-ig"
            aria-invalid={Boolean(fieldErrors['ir-ref']) || (refCode !== '' && !validRef)}
            aria-describedby={fieldErrors['ir-ref'] || (refCode !== '' && !validRef) ? 'ir-ref-error' : undefined}
          />
          {fieldErrors['ir-ref'] || (refCode !== '' && !validRef) ? <span id="ir-ref-error" className={styles.fieldError} role="alert">半角英数字・_・ハイフンで1〜64文字にしてください</span> : null}
        </label>
      </section>

      <section className={styles.card} aria-labelledby="ir-new-account">
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle} id="ir-new-account">どの LINE アカウントに入れますか</h2>
          <p className={styles.cardNote}>友だちになる先のアカウント</p>
        </div>
        <div className={styles.field}>
          <span className={styles.labelRow}>
            <span className={styles.pickLabel}>友だちの追加先</span>
            <HelpTip label="友だちの追加先の説明">
              {selectedAccount
                ? `所属するLINEアカウントは「${selectedAccount.name}」です。いっぱいのときの振り分けは、LINEアカウント側の設定に従います。`
                : '画面上部でLINEアカウントを選んでください。'}
            </HelpTip>
          </span>
          <Select
            id="ir-pool"
            value={poolId}
            onChange={(next) => setPoolId(next)}
            aria-label="友だちの追加先アカウント"
            size="full"
            options={[
              { value: '', label: 'メインプールで自動振り分け' },
              ...pools.map((pool) => ({ value: pool.id, label: pool.name })),
            ]}
          />
        </div>
      </section>

      <section className={styles.card} aria-labelledby="ir-new-after">
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle} id="ir-new-after">友だちになったときにすること</h2>
          <p className={styles.cardNote}>何も決めないと「動きが未設定」になり、数えるだけになります</p>
        </div>
        {actionRow({
          title: 'タグを付ける',
          value: tagName,
          on: tagId !== '',
          onOff: () => setTagId(''),
          open: showTagPick,
          onToggleOpen: () => setShowTagPick((current) => !current),
          pickLabel: '付けるタグ',
          picker: (
            <Select
              id="ir-tag"
              value={tagId}
              onChange={(next) => { setTagId(next); setShowTagPick(false) }}
              aria-label="付けるタグ"
              size="full"
              options={[
                { value: '', label: '（付けない）' },
                ...tagOptionGroups.flatMap((group) => group.tags.map((tag) => ({ value: tag.id, label: group.label ? `${group.label} / ${tag.name}` : tag.name }))),
              ]}
            />
          ),
        })}
        {actionRow({
          title: 'メッセージを送る',
          value: introTemplate ? `テンプレート「${introTemplate.name}」` : null,
          on: introTemplateId !== '',
          onOff: () => setIntroTemplateId(''),
          open: showIntroPick,
          onToggleOpen: () => setShowIntroPick((current) => !current),
          pickLabel: '送るメッセージ',
          picker: (
            <Select
              id="ir-intro"
              value={introTemplateId}
              onChange={(next) => { setIntroTemplateId(next); setShowIntroPick(false) }}
              aria-label="送るメッセージ"
              size="full"
              options={[{ value: '', label: '送らない' }, ...templates.map((template) => ({ value: template.id, label: template.name }))]}
            />
          ),
        })}
        {actionRow({
          title: 'シナリオ配信を始める',
          value: scenarioName ? `シナリオ「${scenarioName}」` : null,
          on: scenarioId !== '',
          onOff: () => setScenarioId(''),
          open: showScenarioPick,
          onToggleOpen: () => setShowScenarioPick((current) => !current),
          pickLabel: '始めるシナリオ',
          picker: (
            <Select
              id="ir-scenario"
              value={scenarioId}
              onChange={(next) => { setScenarioId(next); setShowScenarioPick(false) }}
              aria-label="始めるシナリオ配信"
              size="full"
              options={[{ value: '', label: '（始めない）' }, ...scenarios.map((scenario) => ({ value: scenario.id, label: scenario.name }))]}
            />
          ),
        })}
      </section>

      <section className={styles.card} aria-labelledby="ir-new-url">
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle} id="ir-new-url">発行される URL</h2>
          <p className={styles.cardNote}>発行したあと、一覧の「…」から QR コードと URL をコピーできます</p>
        </div>
        <div className={styles.urlBox}>
          <Link2 size={14} aria-hidden="true" className={styles.urlIcon} />
          <span className={styles.urlText} title={previewUrl || undefined}>{previewUrl || `例: ${workerBase}/r/summer-ig`}</span>
          <span className={styles.urlNote}>{previewUrl ? '発行するとできます' : 'まだ発行されていません'}</span>
        </div>
        {!previewUrl ? (
          <p className={styles.cardNote}>上の「見分けるための文字」を決めると、発行されるURLがここに出ます。例のURLは実際には開けないので配らないでください。</p>
        ) : null}
        {/* 絵には無いが、公開オフで仕込む口は残す（URL の発行の話なのでこの段の最後に置く）。 */}
        <div className={styles.actionRow}>
          <Toggle checked={isActive} label="発行したらすぐ使えるようにする" onChange={(next) => setIsActive(next)} />
          <div className={styles.actionText}>
            <span className={styles.actionTitle}>発行したらすぐ使えるようにする</span>
            <span className={styles.actionValue}>
              {isActive ? '発行すると、すぐにこのURLが使えます。' : '公開オフのまま発行すると、URLを開いても友だち追加できません。'}
            </span>
          </div>
        </div>
      </section>

      <Dialog
        open={conflict !== null && showCompare}
        title="違いを比べる"
        designNode="E14GFm"
        designWidth={680}
        designTop={185}
        confirmLabel="最新を取り込んで直す"
        confirmIcon={<RefreshCw size={15} aria-hidden="true" />}
        onConfirm={loadLatestAndContinue}
        onCancel={() => setShowCompare(false)}
      >
        <p className={styles.compareLead}>
          {conflict ? `${conflictSavedAt ? `${conflictSavedAt} に` : ''}保存された「${conflict.name}」と、いまの入力の違う項目だけ並べています。` : ''}
        </p>
        {conflictRows.length > 0 ? (
          <table className={styles.compareTable}>
            <thead>
              <tr>
                <Th className={styles.compareLabelCol}><span className="sr-only">項目</span></Th>
                <Th>いまの入力</Th>
                <Th className={styles.compareSaved}>保存されている内容</Th>
              </tr>
            </thead>
            <tbody>
              {conflictRows.map((row) => (
                <tr key={row.label}>
                  <Th scope="row" className={styles.compareLabelCol}>{row.label}</Th>
                  <td>{row.mine}</td>
                  <td className={styles.compareSaved}>{row.saved}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className={styles.cardNote}>見分けるための文字のほかに、違う項目はありません。</p>
        )}
        <p className={styles.compareNote}>
          {`上書きはできません（見分けるための文字「${conflict?.refCode ?? ''}」はもう使われています）。「最新を取り込んで直す」を選ぶと、保存されている内容を入力に写します。文字を変えてから発行してください。`}
        </p>
      </Dialog>
      <UnsavedLeaveDialog open={leaveTarget !== null} subject="入力した流入リンク" onConfirm={confirmLeave} onCancel={cancelLeave} />
    </CreatePage>
  )
}
