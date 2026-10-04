'use client'

/*
 * ★V8-B 流入リンクを作る（Pencil「★V8-B 画面の地図」：作る `KMaMk`、
 * 競合 `vWJEm`）。
 *
 * v7 の作る画面（`new/page.tsx`）とは別の見せ方。入力の項目・順番・
 * 保存の動きは v7 と同じ（REF の形・未入力の扱い・重複時の扱い）。
 * 右の列に「お客さまの進む順」とスマホの見本を固定し、下の帯は追従する。
 * v7 を直す必要が出たら `new/page.tsx` 側も同じ判断を入れる
 * （V8 完成までの二重管理）。
 *
 * 競合（`vWJEm`）：作る画面に版が無いので、同じ文字（REF）のリンクが
 * すでにあったとき（409）を競合として帯で出す。「最新を読み込んで続ける」
 * は候補を取り直す。「違いを比べる」は比べる相手の版が無いので置かない。
 */
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import type { ApiResponse, Scenario, Tag, TagGroup, TrafficPool, Template } from '@line-crm/shared'
import { groupTagsByFolder } from '../tag-options'
import { ApiError, api } from '@/lib/api'
import { isPoolsFeatureAvailable } from '@/lib/pools-availability'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { useAccount } from '@/contexts/account-context'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import Notice from '@/components/shared/notice'
import Select from '@/components/shared/select'
import Toggle from '@/components/shared/toggle'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import { inputClass } from '@/components/shared/create-page'
import { describeApiFailure } from '@/components/shared/api-error-message'
import styles from './inflow-create-v8.module.css'

/*
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

const READONLY_REASON = 'この操作にはオーナーか管理者の権限が要ります'

export default function InflowCreateV8() {
  usePageTitle('流入リンクを作る')
  usePageCrumbs([
    { label: 'ホーム', href: '/' },
    { label: '流入と計測', href: '/inflow-links' },
  ])
  const router = useRouter()
  const role = useStaffRole()
  // 閲覧のみ：作る操作は押せない形にする（隠さない）。
  const canEdit = canManageRole(role)
  const { selectedAccountId, selectedAccount } = useAccount()
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  // 409（同じ文字のリンクがすでにある）の競合の帯（`vWJEm`）。
  const [conflictRef, setConflictRef] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [genre, setGenre] = useState('')
  const [refCode, setRefCode] = useState('')
  const [refTouched, setRefTouched] = useState(false)
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
  const [pruneNotice, setPruneNotice] = useState<string | null>(null)
  // 動きの3行の開閉（変える・決める）。
  const [tagOpen, setTagOpen] = useState(false)
  const [messageOpen, setMessageOpen] = useState(false)
  const [scenarioOpen, setScenarioOpen] = useState(false)

  const loadCandidates = async (accountId: string | null, signal: { cancelled: boolean }) => {
    const poolsRequest: Promise<ApiResponse<TrafficPool[]>> = isPoolsFeatureAvailable().then((ok) =>
      ok
        ? api.pools.list({ suppressFeatureDisabledEvent: true })
        : { success: false as const, error: 'feature_disabled' },
    )
    const accountParams = accountId ? { accountId } : undefined
    const [t, s, p, tp, tg] = await Promise.allSettled([
      api.tags.list(accountParams),
      api.scenarios.list(accountParams),
      poolsRequest,
      api.templates.list(undefined, accountId ?? undefined),
      api.tagGroups.list(accountId),
    ])
    if (signal.cancelled) return
    if (t.status === 'fulfilled' && t.value.success) setTags(t.value.data)
    if (tg.status === 'fulfilled' && tg.value.success) setTagGroups(tg.value.data)
    if (s.status === 'fulfilled' && s.value.success) setScenarios(s.value.data)
    if (p.status === 'fulfilled' && p.value.success) setPools(p.value.data)
    if (tp.status === 'fulfilled' && tp.value.success) {
      setTemplates(tp.value.data as unknown as Template[])
    }
  }

  useEffect(() => {
    const signal = { cancelled: false }
    void loadCandidates(selectedAccountId, signal)
    return () => {
      signal.cancelled = true
    }
    // R39: 候補はアカウントごとに違う。切替後に古い候補のまま保存しないよう取り直す。
  }, [selectedAccountId])

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

  const dirty = Boolean(
    name || genre || refCode || tagId || scenarioId || introTemplateId
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

  const save = async () => {
    if (!canEdit || saving) return
    setSaveError(null)
    setConflictRef(null)
    const validationError = validate()
    if (validationError) {
      setSaveError(validationError)
      return
    }
    if (!selectedAccountId) {
      setSaveError('LINEアカウントを選んでください（画面上部で選べます）')
      return
    }
    setSaving(true)
    try {
      const res = await api.entryRoutes.create({
        name: name.trim(),
        genre: genre.trim() || null,
        refCode: refCode.trim(),
        tagId: tagId || null,
        scenarioId: scenarioId || null,
        introTemplateId: introTemplateId || null,
        poolId: poolId || null,
        redirectUrl: redirectUrl.trim() || null,
        isActive,
        lineAccountId: selectedAccountId,
      })
      if (!res.success) {
        // 作る画面の競合（`vWJEm`）：同じ文字のリンクがすでにある。
        if (res.error === 'duplicate' || res.error === 'conflict' || res.error?.includes('重複')) {
          setConflictRef(refCode.trim())
          return
        }
        throw new Error(res.error)
      }
      router.push(`/inflow-links/detail?id=${res.data.id}`)
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setConflictRef(refCode.trim())
        return
      }
      setSaveError(
        describeApiFailure(e, '発行', {
          forbidden: '発行するには権限が要ります。オーナーか管理者に依頼してください。',
        }),
      )
    } finally {
      setSaving(false)
    }
  }

  /** 「最新を読み込んで続ける」：候補を取り直す（入力は残す）。 */
  const reloadLatest = async () => {
    await loadCandidates(selectedAccountId, { cancelled: false })
    setConflictRef(null)
  }

  const tagName = tags.find((tag) => tag.id === tagId)?.name ?? null
  const scenarioName = scenarios.find((scenario) => scenario.id === scenarioId)?.name ?? null
  const templateName = templates.find((template) => template.id === introTemplateId)?.name ?? null
  const disabled = !canEdit || saving

  return (
    <div className={styles.board} data-design-node="KMaMk">
      <div className={styles.head}>
        <p className={styles.headBackWrap}>
          <Link href="/inflow-links" className={styles.headBack}>
            ← 流入と計測へ
          </Link>
        </p>
        <h1 className={styles.headTitle}>流入リンクを作る</h1>
        <p className={styles.headDescription}>
          発行すると URL と QR コードができます。友だちになった人を、この経路で数えます。
        </p>
      </div>

      {!canEdit ? (
        <Notice tone="info" message="閲覧のみで見ています。変える操作は管理者に頼んでください。" />
      ) : null}
      {pruneNotice ? (
        <Notice tone="warn" message={pruneNotice} onClose={() => setPruneNotice(null)} />
      ) : null}
      {conflictRef ? (
        <Notice
          tone="warn"
          message={`「${conflictRef}」のリンクはすでにあります。このまま保存すると、別の経路と混ざります。文字を変えるか、最新の候補を読み込んで続けてください。`}
          action={(
            <Button variant="secondary" onClick={() => void reloadLatest()}>
              最新を読み込んで続ける
            </Button>
          )}
          className={styles.conflictBand}
        />
      ) : null}
      {saveError ? <Notice tone="error" message={saveError} /> : null}

      <div className={styles.split}>
        <div className={styles.main}>
          <section className={styles.section} aria-labelledby="inflow-create-where">
            <h2 className={styles.sectionTitle} id="inflow-create-where">
              どこに置くリンクですか
            </h2>
            <p className={styles.sectionNote}>名前は一覧で見分けるため。お客さまには見えません</p>
            <div className={styles.fieldGrid}>
              <div>
                <label htmlFor="irv8-name">名前</label>
                <input
                  id="irv8-name"
                  type="text"
                  value={name}
                  disabled={disabled}
                  title={!canEdit ? READONLY_REASON : undefined}
                  onChange={(e) => {
                    setName(e.target.value)
                    if (!refTouched) setRefCode(suggestRef(e.target.value))
                  }}
                  placeholder="夏のInstagram投稿"
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="irv8-genre">フォルダ</label>
                <input
                  id="irv8-genre"
                  type="text"
                  value={genre}
                  disabled={disabled}
                  title={!canEdit ? READONLY_REASON : undefined}
                  onChange={(e) => setGenre(e.target.value)}
                  placeholder="SNS"
                  className={inputClass}
                />
              </div>
              <div className={styles.fieldFull}>
                <label htmlFor="irv8-redirect">
                  転送先（入れると友だち追加へ進みません） 任意
                </label>
                <input
                  id="irv8-redirect"
                  type="url"
                  value={redirectUrl}
                  disabled={disabled}
                  title={!canEdit ? READONLY_REASON : undefined}
                  onChange={(e) => setRedirectUrl(e.target.value)}
                  placeholder="（空欄）"
                  className={inputClass}
                />
              </div>
              <div className={styles.fieldFull}>
                <Checkbox
                  checked={isActive}
                  disabled={disabled}
                  onCheckedChange={setIsActive}
                  description="オフにすると、URLを開いても友だち追加できません。"
                >
                  発行したらすぐ使えるようにする
                </Checkbox>
              </div>
            </div>
          </section>

          <section className={styles.section} aria-labelledby="inflow-create-ref">
            <h2 className={styles.sectionTitle} id="inflow-create-ref">
              見分けるための文字（URL の最後に付く）
            </h2>
            <div className={styles.fieldGrid}>
              <div className={styles.fieldFull}>
                <label htmlFor="irv8-ref">REF</label>
                <input
                  id="irv8-ref"
                  type="text"
                  value={refCode}
                  disabled={disabled}
                  title={!canEdit ? READONLY_REASON : undefined}
                  onChange={(e) => {
                    setRefTouched(true)
                    setRefCode(e.target.value)
                  }}
                  placeholder="summer-ig"
                  className={`${inputClass} font-mono`}
                />
              </div>
            </div>
          </section>

          <section className={styles.section} aria-labelledby="inflow-create-account">
            <h2 className={styles.sectionTitle} id="inflow-create-account">
              どの LINE アカウントに入れますか
            </h2>
            <p className={styles.sectionNote}>友だちになる先のアカウント</p>
            <div className={styles.fieldGrid}>
              <div className={styles.fieldFull}>
                <label htmlFor="irv8-pool">友だちの追加先</label>
                <Select
                  id="irv8-pool"
                  value={poolId}
                  disabled={disabled}
                  onChange={(value) => setPoolId(value)}
                  aria-label="友だちの追加先アカウント"
                  size="full"
                  options={[
                    { value: '', label: 'メインプールで自動振り分け' },
                    ...pools.map((pool) => ({ value: pool.id, label: pool.name })),
                  ]}
                />
                <p className={styles.sectionNote}>
                  {selectedAccountId
                    ? `所属：${selectedAccount?.name ?? selectedAccountId}`
                    : '画面上部でLINEアカウントを選んでください'}
                </p>
              </div>
            </div>
          </section>

          <section className={styles.section} aria-labelledby="inflow-create-actions">
            <h2 className={styles.sectionTitle} id="inflow-create-actions">
              友だちになったときにすること
            </h2>
            <p className={styles.sectionNote}>
              何も決めないと「動きが未設定」になり、数えるだけになります
            </p>

            <div className={styles.actionRow}>
              <Toggle
                checked={tagId !== ''}
                label="タグを付ける"
                onChange={canEdit ? (next) => {
                  if (!next) {
                    setTagId('')
                    setTagOpen(false)
                  } else {
                    setTagOpen(true)
                  }
                } : undefined}
              />
              <div className={styles.actionRowText}>
                <p className={styles.actionRowTitle}>タグを付ける</p>
                <p className={styles.actionRowSub}>{tagName ?? 'まだ決めていません'}</p>
              </div>
              <Button
                variant="secondary"
                disabled={disabled}
                title={!canEdit ? READONLY_REASON : undefined}
                onClick={() => setTagOpen((open) => !open)}
              >
                {tagName ? '変える' : '決める'}
              </Button>
            </div>
            {tagOpen ? (
              <div className={styles.actionPicker}>
                <Select
                  value={tagId}
                  disabled={disabled}
                  onChange={(value) => setTagId(value)}
                  aria-label="自動で付けるタグ"
                  size="full"
                  options={[
                    { value: '', label: '（なし）' },
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

            <div className={styles.actionRow}>
              <Toggle
                checked={introTemplateId !== ''}
                label="メッセージを送る"
                onChange={canEdit ? (next) => {
                  if (!next) {
                    setIntroTemplateId('')
                    setMessageOpen(false)
                  } else {
                    setMessageOpen(true)
                  }
                } : undefined}
              />
              <div className={styles.actionRowText}>
                <p className={styles.actionRowTitle}>メッセージを送る</p>
                <p className={styles.actionRowSub}>
                  {templateName ? `テンプレート「${templateName}」` : 'まだ決めていません'}
                </p>
              </div>
              <Button
                variant="secondary"
                disabled={disabled}
                title={!canEdit ? READONLY_REASON : undefined}
                onClick={() => setMessageOpen((open) => !open)}
              >
                {templateName ? '変える' : '決める'}
              </Button>
            </div>
            {messageOpen ? (
              <div className={styles.actionPicker}>
                <Select
                  value={introTemplateId}
                  disabled={disabled}
                  onChange={(value) => setIntroTemplateId(value)}
                  aria-label="追加直後に送るメッセージ"
                  size="full"
                  options={[
                    { value: '', label: '送らない' },
                    ...templates.map((template) => ({ value: template.id, label: template.name })),
                  ]}
                />
              </div>
            ) : null}

            <div className={styles.actionRow}>
              <Toggle
                checked={scenarioId !== ''}
                label="シナリオ配信を始める"
                onChange={canEdit ? (next) => {
                  if (!next) {
                    setScenarioId('')
                    setScenarioOpen(false)
                  } else {
                    setScenarioOpen(true)
                  }
                } : undefined}
              />
              <div className={styles.actionRowText}>
                <p className={styles.actionRowTitle}>シナリオ配信を始める</p>
                <p className={styles.actionRowSub}>{scenarioName ?? 'まだ決めていません'}</p>
              </div>
              <Button
                variant="secondary"
                disabled={disabled}
                title={!canEdit ? READONLY_REASON : undefined}
                onClick={() => setScenarioOpen((open) => !open)}
              >
                {scenarioName ? '変える' : '決める'}
              </Button>
            </div>
            {scenarioOpen ? (
              <div className={styles.actionPicker}>
                <Select
                  value={scenarioId}
                  disabled={disabled}
                  onChange={(value) => setScenarioId(value)}
                  aria-label="開始するシナリオ配信"
                  size="full"
                  options={[
                    { value: '', label: '（なし）' },
                    ...scenarios.map((scenario) => ({ value: scenario.id, label: scenario.name })),
                  ]}
                />
              </div>
            ) : null}
          </section>

          <section className={styles.section} aria-labelledby="inflow-create-url">
            <h2 className={styles.sectionTitle} id="inflow-create-url">
              発行される URL
            </h2>
            <p className={styles.sectionNote}>
              発行したあと、一覧の「…」から QR コードと URL をコピーできます
            </p>
            <div className={styles.urlPreview}>
              <span className={styles.urlPreviewCode}>
                {previewUrl || '（REF を決めるとここに出ます）'}
              </span>
              <span className={styles.urlPreviewNote}>発行するとできます</span>
            </div>
          </section>
        </div>

        <aside className={styles.rail} aria-label="お客さまの進み方">
          <h2 className={styles.railTitle}>お客さまはこの順に進みます</h2>
          <ol className={styles.flowList}>
            <li className={styles.flowItem}>
              <span className={styles.flowNum} aria-hidden="true">1</span>
              QR コード・URL を開く
            </li>
            <li className={styles.flowItem}>
              <span className={styles.flowNum} aria-hidden="true">2</span>
              LINE で友だちになる（この経路で数える）
            </li>
            <li className={styles.flowItem}>
              <span className={styles.flowNum} aria-hidden="true">3</span>
              {tagName ? `タグ「${tagName}」が付く` : 'タグ「未設定」が付く'}
            </li>
            <li className={styles.flowItem}>
              <span className={`${styles.flowNum} ${styles.flowNumLast}`} aria-hidden="true">4</span>
              {templateName
                ? `メッセージ「${templateName}」が届く（右のスマホ）`
                : 'あいさつのメッセージが届く（右のスマホ）'}
            </li>
          </ol>
          <div className={styles.phone} role="img" aria-label="お客さまのスマホの見本">
            <div className={styles.phoneScreen}>
              <p className={styles.phoneStatus}>
                <span>9:41</span>
                <span aria-hidden="true">●●●</span>
              </p>
              <p className={styles.phoneAccount}>
                <span aria-hidden="true">＜</span>
                {selectedAccount?.name ?? '公式アカウント'}
              </p>
              <div className={styles.phoneBody}>
                <p className={styles.phoneDay}>登録した日 10:00</p>
                <div className={styles.phoneRow}>
                  <span className={styles.phoneAvatar} aria-hidden="true">公</span>
                  <p className={styles.phoneBubble}>はじめまして。友だち追加ありがとうございます。</p>
                </div>
              </div>
              <p className={styles.phoneMenu}>メニュー ⌄</p>
            </div>
          </div>
        </aside>
      </div>

      <div className={styles.footerBar}>
        <Button variant="secondary" onClick={() => router.push('/inflow-links')}>
          キャンセル
        </Button>
        <Button
          variant="primary"
          disabled={disabled}
          title={!canEdit ? READONLY_REASON : undefined}
          busy={saving}
          busyLabel="発行中…"
          onClick={() => void save()}
        >
          発行して URL を受け取る
        </Button>
      </div>

      <UnsavedLeaveDialog
        open={leaveTarget !== null}
        subject="入力した流入リンク"
        onConfirm={confirmLeave}
        onCancel={cancelLeave}
      />
    </div>
  )
}
