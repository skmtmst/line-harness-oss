'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import type { ApiResponse, EntryRoute, EntryRouteGenre, Scenario, Tag, TagGroup, TrafficPool, Template } from '@line-crm/shared'
import { groupTagsByFolder } from '../tag-options'
import { ApiError, api } from '@/lib/api'
import { isPoolsFeatureAvailable } from '@/lib/pools-availability'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { useAccount } from '@/contexts/account-context'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import Notice from '@/components/shared/notice'
import Button from '@/components/shared/button'
import { Field, inputClass } from '@/components/shared/create-page'
import { describeApiFailure } from '@/components/shared/api-error-message'
import Select from '@/components/shared/select'
import Toggle from '@/components/shared/toggle'
import styles from './inflow-create-v8.module.css'

/** 流入元の情報と、友だち追加時の動きをまとめて設定する。 */

/**
 * ref コードはURLに出る。口(entry-routes.ts)と同じ `[A-Za-z0-9_-]{1,64}`
 * に寄せる(#514-10)。画面だけ狭い(小文字・ハイフン・2文字以上)と、
 * 口が許す正規の ref を作れない。
 */
const REF_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

/** 名前から ref コードの候補を作る。日本語からは作れないので空にする。 */
function suggestRef(name: string): string {
  const ascii = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return /^[a-z0-9]/.test(ascii) ? ascii.slice(0, 64) : ''
}

export default function NewInflowLinkPage() {
  const router = useRouter()
  const { selectedAccountId, selectedAccount } = useAccount()
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [genre, setGenre] = useState('')
  const [newGenre, setNewGenre] = useState('')
  const [genres, setGenres] = useState<EntryRouteGenre[]>([])
  const [refCode, setRefCode] = useState('')
  const [refTouched, setRefTouched] = useState(false)
  const [tagId, setTagId] = useState('')
  const [scenarioId, setScenarioId] = useState('')
  const [introTemplateId, setIntroTemplateId] = useState('')
  const [poolId, setPoolId] = useState('')
  const [redirectUrl, setRedirectUrl] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [tags, setTags] = useState<Tag[]>([])
  /*
    タグのフォルダ。**タグを平らに並べると選べない**——実データでは
    「VIPタグ 1〜13」「ペットタグ 1〜12」のように似た名前が続く。
    フォルダで束ねると、どの群から選ぶのかが先に決まる。
  */
  const [tagGroups, setTagGroups] = useState<TagGroup[]>([])
  /* フォルダで束ねた選択肢。フォルダが取れないときは束ねずにそのまま出す。 */
  const tagOptionGroups = useMemo(() => groupTagsByFolder(tags, tagGroups), [tags, tagGroups])
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [pools, setPools] = useState<TrafficPool[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [showTagPick, setShowTagPick] = useState(false)
  const [showIntroPick, setShowIntroPick] = useState(false)
  const [showScenarioPick, setShowScenarioPick] = useState(false)
  // R23横展開: アカウントを切り替えたら、前の候補にしかない選択を外して知らせる。
  const [pruneNotice, setPruneNotice] = useState<string | null>(null)
  /*
   * vWJEm（作る・競合）: 発行が 409（見分けるための文字が使用中）で返り、
   * 同じ文字の発行済みリンクが見つかったときだけ立つ。誰が保存したかは
   * 口が持っていないので出さない。保存日時と名前は実データを出す。
   */
  const [conflict, setConflict] = useState<EntryRoute | null>(null)
  const [showCompare, setShowCompare] = useState(false)

  useEffect(() => {
    // vWJEm: アカウントが変わったら前の競合は古いので閉じる。
    clearConflict()
    let cancelled = false
    // プールは補助データ。機能がオフでもリンク発行画面そのものは止めない。
    // 403 の応答自体が console error になるため、有効と分からない限り
    // 口を発行しない（#703）。
    const poolsRequest: Promise<ApiResponse<TrafficPool[]>> = isPoolsFeatureAvailable().then((ok) =>
      ok
        ? api.pools.list({ suppressFeatureDisabledEvent: true })
        : { success: false as const, error: 'feature_disabled' },
    )
    // R23横展開: 候補は今のアカウントだけ。別アカウントの同名タグ混入防止。
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
      /*
        **フォルダが取れなくてもタグは選べるままにする。**
        束ねられないだけで、選択そのものを止める理由はない。
      */
      if (tg.status === 'fulfilled' && tg.value.success) setTagGroups(tg.value.data)
      if (s.status === 'fulfilled' && s.value.success) setScenarios(s.value.data)
      if (p.status === 'fulfilled' && p.value.success) setPools(p.value.data)
      if (tp.status === 'fulfilled' && tp.value.success) {
        setTemplates(tp.value.data as unknown as Template[])
      }
      if (g.status === 'fulfilled' && g.value.success) setGenres(g.value.data)
    })
    return () => {
      cancelled = true
    }
    // R39: 候補（タグ・シナリオ・プール・テンプレート）はアカウントごとに
    // 違う。切替後に古い候補のまま保存しないよう、取り直す。入力は残す。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccountId])

  /*
   * R23横展開(m18hと同じ形): 新しい候補にない選択は外す。
   * 外すものがなければ何もしない。選び直しが必要なときだけ帯で知らせる。
   */
  useEffect(() => {
    const tagIds = new Set(tags.map((tag) => tag.id))
    const scenarioIds = new Set(scenarios.map((scenario) => scenario.id))
    const templateIds = new Set(templates.map((template) => template.id))
    let removed = 0
    if (tagId && !tagIds.has(tagId)) { setTagId(''); removed += 1 }
    if (scenarioId && !scenarioIds.has(scenarioId)) { setScenarioId(''); removed += 1 }
    if (introTemplateId && !templateIds.has(introTemplateId)) { setIntroTemplateId(''); removed += 1 }
    if (removed > 0) {
      setPruneNotice(`選んでいた候補のうち${removed}件は、今のアカウントにないため外しました。選び直してください。`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tags, scenarios, templates])

  const validRef = REF_PATTERN.test(refCode)
  const workerBase = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '')
  /*
   * #975 U065: REFが未入力でも「/r/summer-ig」を出すと発行済みに見える。
   * 見本URLはREFが決まったときだけ作り、空欄では例示の文字だけを出す。
   */
  const previewUrl = validRef ? `${workerBase}/r/${refCode}` : ''
  // #514-7: 短縮 URL(/s/xxxx)は Worker に経路が無い。開けない URL を
  // 印刷物・SMS に載せないよう、表示しない。

  /*
   * R18: 入力の途中で一覧リンク・左メニュー・戻る・再読込へ出るときは、
   * 入力が消える前に確認を出す。保存が終わって詳細へ進む動きは
   * プログラムの移動なので、この確認は出ない。
   */
  const dirty = Boolean(
    name || genre || newGenre || refCode || tagId || scenarioId || introTemplateId
    || poolId || redirectUrl || !isActive,
  )
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty, busy: saving })

  const validate = (): string | null => {
    if (!selectedAccountId) return 'LINEアカウントを選んでください（画面上部で選べます）'
    if (!name.trim()) return 'リンク名を入力してください'
    if (!validRef) {
      return 'refコードは、半角英数字・_・ハイフンで1〜64文字にしてください'
    }
    return null
  }

  /*
   * M030: 発行の失敗は原文のまま出さない。403は権限の案内、
   * 400は入力の直し方つき、409は重複の立て直し文、429は待ち案内、
   * 機械コードだけの失敗は再試行の案内にする。
   */
  const doSave = async () => {
    const problem = validate()
    if (problem) {
      setSaveError(problem)
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
        // vWJEm: 見分けるための文字が使用中。同じ文字の発行済みリンクを
        // 探して比べられるようにする。見つからなければ通常の失敗文のまま。
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

  /*
   * vWJEm: ref は全体で一意（entry-routes.ts の UNIQUE 制約）のため、
   * まず今のアカウント、無ければ見える範囲の全部から同じ文字を探す。
   */
  async function findRouteByRef(ref: string, accountId: string): Promise<EntryRoute | null> {
    const pick = (routes: EntryRoute[]): EntryRoute | null =>
      routes.find((route) => route.refCode === ref) ?? null
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

  /** vWJEm: 文字を変えたら競合は解けたものとして帯と比べを閉じる。 */
  function clearConflict(): void {
    if (conflict) {
      setConflict(null)
      setShowCompare(false)
    }
  }

  /*
   * vWJEm「最新を読み込んで続ける」: 保存されている値（実データ）を
   * 入力へ写す。文字は競合のままなので変えてから発行する。
   * 今のアカウントに無い候補は選べないため空ける。
   */
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

  /** vWJEm: 保存日時（実データ）を「M月d日 H:mm」にする。壊れていたら出さない。 */
  function formatSavedAt(value: string): string {
    const time = new Date(value).getTime()
    if (Number.isNaN(time)) return ''
    const date = new Date(time)
    const hour = String(date.getHours()).padStart(2, '0')
    const minute = String(date.getMinutes()).padStart(2, '0')
    return `${date.getMonth() + 1}月${date.getDate()}日 ${hour}:${minute}`
  }

  const tagName = tags.find((tag) => tag.id === tagId)?.name ?? null
  const scenarioName = scenarios.find((scenario) => scenario.id === scenarioId)?.name ?? null
  const introTemplate = templates.find((template) => template.id === introTemplateId) ?? null
  const previewMessage = introTemplate?.messageContent
    || 'はじめまして。友だち追加ありがとうございます。'

  /*
   * vWJEm「違いを比べる」の行。左は今の入力、右は保存されている値
   * （どちらも実データ）。候補に無いIDは、その旨を正直に出す。
   */
  const resolveCandidate = (id: string | null, names: Map<string, string>, empty: string): string => {
    if (!id) return empty
    return names.get(id) ?? '（このアカウントにありません）'
  }
  const tagNames = new Map(tags.flatMap((tag) => [[tag.id, tag.name] as const]))
  const scenarioNames = new Map(scenarios.map((scenario) => [scenario.id, scenario.name] as const))
  const templateNames = new Map(templates.map((template) => [template.id, template.name] as const))
  const poolNames = new Map(pools.map((pool) => [pool.id, pool.name] as const))
  const poolName = poolId ? poolNames.get(poolId) ?? '（このアカウントにありません）' : 'メインプールで自動振り分け'
  const conflictRows = conflict ? [
    { label: '名前', mine: name.trim() || '（未設定）', saved: conflict.name },
    {
      label: 'フォルダ',
      mine: genre === '__new' ? newGenre.trim() || '（未設定）' : genre || '（未設定）',
      saved: conflict.genre ?? '（未設定）',
    },
    { label: '転送先', mine: redirectUrl.trim() || '（未設定）', saved: conflict.redirectUrl ?? '（未設定）' },
    {
      label: 'タグ',
      mine: tagName ?? '（未設定）',
      saved: resolveCandidate(conflict.tagId, tagNames, '（未設定）'),
    },
    {
      label: 'メッセージ',
      mine: introTemplate ? `テンプレート「${introTemplate.name}」` : '送らない',
      saved: conflict.introTemplateId && templateNames.has(conflict.introTemplateId)
        ? `テンプレート「${templateNames.get(conflict.introTemplateId)}」`
        : resolveCandidate(conflict.introTemplateId, templateNames, '送らない'),
    },
    {
      label: 'シナリオ',
      mine: scenarioName ?? '（始めない）',
      saved: resolveCandidate(conflict.scenarioId, scenarioNames, '（始めない）'),
    },
    {
      label: '追加先',
      mine: poolName,
      saved: conflict.poolId
        ? poolNames.get(conflict.poolId) ?? '（このアカウントにありません）'
        : 'メインプールで自動振り分け',
    },
    { label: '公開', mine: isActive ? '公開する' : '公開しない', saved: conflict.isActive ? '公開する' : '公開しない' },
  ] : []
  const conflictSavedAt = conflict ? formatSavedAt(conflict.updatedAt) : ''

  return (
    <>
    <div className={styles.board} data-design-node="KMaMk">
      <nav aria-label="パンくず">
        <Link href="/inflow-links" className={styles.backLink}>
          ← 流入と計測へ
        </Link>
      </nav>
      <div>
        <h2 className={styles.title}>流入リンクを作る</h2>
        <p className={styles.sub}>発行するとURLとQRコードができます。友だちになった人を、この経路で数えます。</p>
      </div>

      {pruneNotice ? <Notice tone="warn" message={pruneNotice} onClose={() => setPruneNotice(null)} /> : null}
      {saveError ? <Notice tone="error" message={saveError} onClose={() => setSaveError(null)} /> : null}
      {conflict ? (
        <section className={styles.conflictBand} data-design-node="vWJEm" aria-label="文字が重複しています">
          <div className={styles.conflictText}>
            <div className={styles.conflictTitle}>「{conflict.refCode}」は既に使われています</div>
            <div className={styles.conflictSub}>
              {conflictSavedAt ? `${conflictSavedAt} 保存の` : ''}「{conflict.name}」があります。同じ文字のまま発行はできません。文字を変えるか、違いを比べてください。
            </div>
          </div>
          <div className={styles.conflictActions}>
            <Button variant="secondary" onClick={() => setShowCompare((current) => !current)} aria-expanded={showCompare}>
              違いを比べる
            </Button>
            <Button variant="secondary" onClick={loadLatestAndContinue}>
              最新を読み込んで続ける
            </Button>
          </div>
        </section>
      ) : null}
      {conflict && showCompare ? (
        <section className={styles.card} aria-label="いまの入力と保存されている値の違い">
          <h3 className={styles.cardTitle}>いまの入力と保存されている値の違い</h3>
          <p className={styles.cardSub}>左が今の入力、右が保存されている値です。どちらも実際の設定です</p>
          <table className={styles.compareTable}>
            <thead>
              <tr>
                <th scope="col">項目</th>
                <th scope="col">いまの入力</th>
                <th scope="col">保存されている値</th>
              </tr>
            </thead>
            <tbody>
              {conflictRows.map((row) => (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  <td>{row.mine}</td>
                  <td>{row.saved}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <div className={styles.columns}>
        <div className={styles.mainCol}>
          <section className={styles.card} aria-label="どこに置くリンクですか">
            <h3 className={styles.cardTitle}>どこに置くリンクですか</h3>
            <p className={styles.cardSub}>名前は一覧で分けるため。お客さまには見えません</p>
            <div className={styles.fields}>
              <div className={styles.twoCol}>
                <Field label="名前" htmlFor="ir-name" required>
                  <input
                    id="ir-name"
                    type="text"
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value)
                      if (!refTouched) setRefCode(suggestRef(e.target.value))
                      if (saveError) setSaveError(null)
                    }}
                    placeholder="夏のInstagram投稿"
                    className={inputClass}
                  />
                </Field>
                <div>
                  <label className={styles.fieldLabel} htmlFor="ir-genre">フォルダ</label>
                  <Select
                    id="ir-genre"
                    value={genre}
                    onChange={(value) => setGenre(value)}
                    aria-label="フォルダ"
                    size="full"
                    options={[
                      { value: '', label: '（選ばない）' },
                      ...genres.map((item) => ({ value: item.name, label: item.name })),
                      { value: '__new', label: '新しいフォルダ…' },
                    ]}
                  />
                  {genre === '__new' ? (
                    <input
                      type="text"
                      value={newGenre}
                      onChange={(e) => setNewGenre(e.target.value)}
                      placeholder="新しいフォルダの名前"
                      aria-label="新しいフォルダの名前"
                      className={`${inputClass} mt-2`}
                    />
                  ) : null}
                </div>
              </div>
              <Field
                label="転送先（任意）"
                htmlFor="ir-redirect"
                note="入れると友だち追加へ進みません"
              >
                <input
                  id="ir-redirect"
                  type="url"
                  value={redirectUrl}
                  onChange={(e) => setRedirectUrl(e.target.value)}
                  placeholder="（空欄）"
                  className={inputClass}
                />
              </Field>
              <div>
                <label className={styles.fieldLabel} htmlFor="ir-ref">見分けるための文字（URL の最後に付く）</label>
                <input
                  id="ir-ref"
                  type="text"
                  value={refCode}
                  onChange={(e) => { setRefTouched(true); setRefCode(e.target.value); if (saveError) setSaveError(null); clearConflict() }}
                  placeholder="summer-ig"
                  aria-invalid={refCode !== '' && !validRef}
                  className={`${inputClass} font-mono`}
                />
                {refCode !== '' && !validRef ? (
                  <p className={styles.fieldError} role="alert">
                    半角英数字・_・ハイフンで1〜64文字にしてください
                  </p>
                ) : null}
              </div>
            </div>
          </section>

          <section className={styles.card} aria-label="どのLINEアカウントに入れますか">
            <h3 className={styles.cardTitle}>どの LINE アカウントに入れますか</h3>
            <p className={styles.cardSub}>友だちになる先のアカウント</p>
            <div className={styles.fields}>
              <div>
                <label className={styles.fieldLabel} htmlFor="ir-pool">友だちの追加先</label>
                <Select
                  id="ir-pool"
                  value={poolId}
                  onChange={(value) => setPoolId(value)}
                  aria-label="友だちの追加先アカウント"
                  size="full"
                  options={[
                    { value: '', label: 'メインプールで自動振り分け' },
                    ...pools.map((pool) => ({ value: pool.id, label: pool.name })),
                  ]}
                />
              </div>
              <div>
                <Field label="所属するLINEアカウント">
                  {selectedAccount ? selectedAccount.name : '選択なし'}
                </Field>
              </div>
              <p className={styles.cardSub}>
                {selectedAccount
                  ? 'いっぱいのときの振り分けは、LINEアカウント側の設定に従います。'
                  : '画面上部でLINEアカウントを選んでください。'}
              </p>
            </div>
          </section>

          <section className={styles.card} aria-label="友だちになったときにすること">
            <h3 className={styles.cardTitle}>友だちになったときにすること</h3>
            <p className={styles.cardSub}>何も決めないと「動きが未設定」になり、数えるだけになります</p>
            <div className={styles.fields}>
              <div>
                <div className={styles.toggleRow}>
                  <Toggle
                    checked={tagId !== ''}
                    label="タグを付ける"
                    onChange={(next) => { if (!next) setTagId('') }}
                  />
                  <div className={styles.toggleText}>
                    <div className={styles.toggleTitle}>タグを付ける</div>
                    <div className={styles.toggleValue}>{tagName ?? 'まだ決めていません'}</div>
                  </div>
                  <Button
                    variant="secondary"
                    onClick={() => setShowTagPick((current) => !current)}
                    aria-expanded={showTagPick}
                    aria-label={tagName ? '付けるタグを変える' : '付けるタグを決める'}
                  >
                    {tagName ? '変える' : '決める'}
                  </Button>
                </div>
                {showTagPick ? (
                  <div className={styles.togglePick}>
                    <Select
                      id="ir-tag"
                      value={tagId}
                      onChange={(value) => { setTagId(value); setShowTagPick(false) }}
                      aria-label="付けるタグ"
                      size="full"
                      options={[
                        { value: '', label: '（付けない）' },
                        ...tagOptionGroups.flatMap((group) =>
                          group.tags.map((tag) => ({
                            value: tag.id,
                            label: group.label ? `${group.label} / ${tag.name}` : tag.name,
                          })),
                        ),
                      ]}
                    />
                  </div>
                ) : null}
              </div>
              <div>
                <div className={styles.toggleRow}>
                  <Toggle
                    checked={introTemplateId !== ''}
                    label="メッセージを送る"
                    onChange={(next) => { if (!next) setIntroTemplateId('') }}
                  />
                  <div className={styles.toggleText}>
                    <div className={styles.toggleTitle}>メッセージを送る</div>
                    <div className={styles.toggleValue}>
                      {introTemplate ? `テンプレート「${introTemplate.name}」` : 'まだ決めていません'}
                    </div>
                  </div>
                  <Button
                    variant="secondary"
                    onClick={() => setShowIntroPick((current) => !current)}
                    aria-expanded={showIntroPick}
                    aria-label={introTemplate ? '送るメッセージを変える' : '送るメッセージを決める'}
                  >
                    {introTemplate ? '変える' : '決める'}
                  </Button>
                </div>
                {showIntroPick ? (
                  <div className={styles.togglePick}>
                    <Select
                      id="ir-intro"
                      value={introTemplateId}
                      onChange={(value) => { setIntroTemplateId(value); setShowIntroPick(false) }}
                      aria-label="送るメッセージ"
                      size="full"
                      options={[
                        { value: '', label: '送らない' },
                        ...templates.map((template) => ({ value: template.id, label: template.name })),
                      ]}
                    />
                  </div>
                ) : null}
              </div>
              <div>
                <div className={styles.toggleRow}>
                  <Toggle
                    checked={scenarioId !== ''}
                    label="シナリオ配信を始める"
                    onChange={(next) => { if (!next) setScenarioId('') }}
                  />
                  <div className={styles.toggleText}>
                    <div className={styles.toggleTitle}>シナリオ配信を始める</div>
                    <div className={styles.toggleValue}>
                      {scenarioName ? `シナリオ「${scenarioName}」` : 'まだ決めていません'}
                    </div>
                  </div>
                  <Button
                    variant="secondary"
                    onClick={() => setShowScenarioPick((current) => !current)}
                    aria-expanded={showScenarioPick}
                    aria-label={scenarioName ? '始めるシナリオを変える' : '始めるシナリオを決める'}
                  >
                    {scenarioName ? '変える' : '決める'}
                  </Button>
                </div>
                {showScenarioPick ? (
                  <div className={styles.togglePick}>
                    <Select
                      id="ir-scenario"
                      value={scenarioId}
                      onChange={(value) => { setScenarioId(value); setShowScenarioPick(false) }}
                      aria-label="始めるシナリオ配信"
                      size="full"
                      options={[
                        { value: '', label: '（始めない）' },
                        ...scenarios.map((scenario) => ({ value: scenario.id, label: scenario.name })),
                      ]}
                    />
                  </div>
                ) : null}
              </div>
            </div>
          </section>

          <section className={styles.card} aria-label="発行されるURL">
            <h3 className={styles.cardTitle}>発行される URL</h3>
            <p className={styles.cardSub}>発行したあと、一覧の「…」から QR コードと URL をコピーできます</p>
            <div className={styles.fields}>
              <div className={styles.urlBox}>
                <span className={styles.urlText}>
                  {previewUrl ? previewUrl : <>例: {workerBase}/r/summer-ig</>}
                </span>
                <span className={styles.urlNote}>
                  {previewUrl ? '発行するとできます' : 'まだ発行されていません'}
                </span>
              </div>
              {!previewUrl ? (
                <p className={styles.cardSub}>上の「見分けるための文字」を決めると、発行されるURLがここに出ます。例のURLは実際には開けないので配らないでください。</p>
              ) : null}
              {/*
                絵には無いが、公開オフで仕込む口は残す。URL カードの発行の話なのでここに置く。
                オフのまま発行すると URL を開いても友だち追加できない旨は、その場に出す。
              */}
              <div className={styles.toggleRow}>
                <Toggle
                  checked={isActive}
                  label="発行したらすぐ使えるようにする"
                  onChange={(next) => setIsActive(next)}
                />
                <div className={styles.toggleText}>
                  <div className={styles.toggleTitle}>発行したらすぐ使えるようにする</div>
                  <div className={styles.toggleValue}>
                    {isActive
                      ? '発行すると、すぐにこのURLが使えます。'
                      : '公開オフのまま発行すると、URLを開いても友だち追加できません。'}
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>

        <div className={styles.sideCol}>
          <div className={styles.stepsCard}>
            <h3 className={styles.stepsTitle}>お客さまはこの順に進みます</h3>
            <ol className={styles.steps}>
              <li className={styles.step}>
                <span className={styles.stepNum} aria-hidden="true">1</span>
                <span>QR コード・URL を開く</span>
              </li>
              <li className={styles.step}>
                <span className={styles.stepNum} aria-hidden="true">2</span>
                <span>LINE で友だちになる（この経路で数える）</span>
              </li>
              <li className={styles.step}>
                <span className={styles.stepNum} aria-hidden="true">3</span>
                <span>{tagName ? `タグ「${tagName}」が付く` : 'タグは付かない'}</span>
              </li>
              <li className={styles.step}>
                <span className={`${styles.stepNum} ${styles.stepNumNow}`} aria-hidden="true">4</span>
                <span>
                  {introTemplate
                    ? `メッセージ「${introTemplate.name}」が届く（右のスマホ）`
                    : scenarioName
                      ? `シナリオ「${scenarioName}」が始まる`
                      : 'あいさつのメッセージが届く（右のスマホ）'}
                </span>
              </li>
            </ol>
            <div className={styles.phone} role="img" aria-label="友だち追加直後に届くメッセージの見本">
              <div className={styles.phoneHead}>{selectedAccount?.name ?? 'LINE'}</div>
              <div className={styles.phoneBody}>
                <div className={styles.bubble}>
                  {previewMessage}
                  <div className={styles.bubbleTime}>10:00</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className={styles.footer}>
        <Button variant="secondary" href="/inflow-links">キャンセル</Button>
        {conflict ? (
          <Button variant="primary" onClick={() => setShowCompare(true)} disabled={saving}>
            比べてから保存
          </Button>
        ) : (
          <Button variant="primary" onClick={() => void doSave()} disabled={saving} aria-busy={saving}>
            {saving ? '発行しています…' : '発行してURLを受け取る'}
          </Button>
        )}
      </div>
    </div>

    <UnsavedLeaveDialog open={leaveTarget !== null} subject="入力した流入リンク" onConfirm={confirmLeave} onCancel={cancelLeave} />
    </>
  )
}
