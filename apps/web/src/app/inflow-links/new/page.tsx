'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ApiResponse, Scenario, Tag, TagGroup, TrafficPool, Template } from '@line-crm/shared'
import { groupTagsByFolder } from '../tag-options'
import { api } from '@/lib/api'
import { isPoolsFeatureAvailable } from '@/lib/pools-availability'
import { qrToDataURL } from '@/lib/qr-image'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { useAccount } from '@/contexts/account-context'
import Checkbox from '@/components/shared/checkbox'
import Button from '@/components/shared/button'
import Card from '@/components/shared/card'
import SectionHeader from '@/components/shared/section-header'
import Toggle from '@/components/shared/toggle'
import Disclosure from '@/components/shared/disclosure'
import LinePreview from '@/components/shared/line-preview'
import { TextField } from '@/components/shared/text-field'
import { Link as LinkIcon } from 'lucide-react'
import styles from './create-v8.module.css'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import Notice from '@/components/shared/notice'
import CreatePage, {
  Field,
} from '@/components/shared/create-page'
import { describeApiFailure } from '@/components/shared/api-error-message'
import Select from '@/components/shared/select'

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
  const { selectedAccountId, selectedAccount } = useAccount()
  const rootRef = useRef<HTMLDivElement>(null)
  const [widePreview, setWidePreview] = useState(true)
  useEffect(() => {
    if (!rootRef.current || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidePreview(entry.contentRect.width >= 1100)
    })
    observer.observe(rootRef.current)
    return () => observer.disconnect()
  }, [])
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const [genre, setGenre] = useState('')
  const [refCode, setRefCode] = useState('')
  const [refTouched, setRefTouched] = useState(false)
  const [tagId, setTagId] = useState('')
  const [tagEnabled, setTagEnabled] = useState(false)
  const [messageEnabled, setMessageEnabled] = useState(false)
  const [scenarioEnabled, setScenarioEnabled] = useState(false)
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
  const [qrDataUrl, setQrDataUrl] = useState('')
  // R23横展開: アカウントを切り替えたら、前の候補にしかない選択を外して知らせる。
  const [candidateLoading, setCandidateLoading] = useState(true)
  const [candidateFailed, setCandidateFailed] = useState(false)
  const [candidateAttempt, setCandidateAttempt] = useState(0)
  const [pruneNotice, setPruneNotice] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setCandidateLoading(true)
    setCandidateFailed(false)
    if (!selectedAccountId) {
      setTags([])
      setTagGroups([])
      setScenarios([])
      setTemplates([])
      setPools([])
      setCandidateLoading(false)
      return
    }
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
    ]).then(([t, s, p, tp, tg]) => {
      if (cancelled) return
      setCandidateLoading(false)
      setCandidateFailed([t, s, tp].some((result) => result.status === 'rejected' || !result.value.success))
      setTags(t.status === 'fulfilled' && t.value.success ? t.value.data : [])
      /*
        **フォルダが取れなくてもタグは選べるままにする。**
        束ねられないだけで、選択そのものを止める理由はない。
      */
      setTagGroups(tg.status === 'fulfilled' && tg.value.success ? tg.value.data : [])
      setScenarios(s.status === 'fulfilled' && s.value.success ? s.value.data : [])
      setPools(p.status === 'fulfilled' && p.value.success ? p.value.data : [])
      setTemplates(tp.status === 'fulfilled' && tp.value.success ? tp.value.data as unknown as Template[] : [])
    })
    return () => {
      cancelled = true
    }
    // R39: 候補（タグ・シナリオ・プール・テンプレート）はアカウントごとに
    // 違う。切替後に古い候補のまま保存しないよう、取り直す。入力は残す。
  }, [selectedAccountId, candidateAttempt])

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
  useEffect(() => {
    // #975 U065: 未入力のQRを作らない。見本QRは「保存前の見本」と分かるURLだけ。
    if (!previewUrl) {
      setQrDataUrl('')
      return
    }
    // キー入力ごとに作り直すと、遅れて届いた古い QR が表示とずれて残る。
    // 少し待ってから作り、古い解決は捨てる。
    let stale = false
    const timer = window.setTimeout(() => {
      void qrToDataURL(previewUrl, { width: 180, margin: 1 }).then((url) => {
        if (!stale) setQrDataUrl(url)
      })
    }, 250)
    return () => {
      stale = true
      window.clearTimeout(timer)
    }
  }, [previewUrl])

  /*
   * R18: 入力の途中で一覧リンク・左メニュー・戻る・再読込へ出るときは、
   * 入力が消える前に確認を出す。保存が終わって詳細へ進む動きは
   * プログラムの移動なので、この確認は出ない。
   */
  const dirty = Boolean(
    name || genre || refCode || tagId || scenarioId || introTemplateId
    || poolId || redirectUrl || !isActive || tagEnabled || messageEnabled || scenarioEnabled,
  )
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty, busy: saving })

  return (
    <div ref={rootRef} className={styles.root}>
      <header className={styles.heading}>
        <Link href="/inflow-links">← 流入と計測へ</Link>
        <h2>流入リンクを作る</h2>
        <p>発行すると URL と QR コードができます。友だちになった人を、この経路で数えます。</p>
      </header>
    <CreatePage
      title="流入リンクを作る"
      description="流入経路ごとにURLを分けると、どこから友だちになったかが分かります。"
      showHeader={false}
      parent={['流入と計測', '/inflow-links']}
      saveLabel="発行してURLを受け取る"
      successHref={(id) => `/inflow-links/detail?id=${id}`}
      designNode="KMaMk"
      variant="v6"
      statusLabel={isActive ? 'まだ発行されていません。発行すると、すぐにこのURLが使えます。' : 'まだ発行されていません。公開オフのまま発行すると、URLを開いても友だち追加できません。'}
      validate={() => {
        if (!selectedAccountId) return 'LINEアカウントを選んでください（画面上部で選べます）'
        if (candidateLoading) return '友だち追加時の動きの候補を読み込み中です。少し待ってから発行してください'
        if (!name.trim()) return 'リンク名を入力してください'
        if (!validRef) {
          return 'refコードは、半角英数字・_・ハイフンで1〜64文字にしてください'
        }
        if (tagEnabled && !tagId) return '付けるタグを選んでください'
        if (messageEnabled && !introTemplateId) return '送るメッセージを選んでください'
        if (scenarioEnabled && !scenarioId) return '始めるシナリオ配信を選んでください'
        return null
      }}
      /*
       * M030: 発行の失敗は原文のまま出さない。403は権限の案内、
       * 400は入力の直し方つき、409は重複の立て直し文、429は待ち案内、
       * 機械コードだけの失敗は再試行の案内にする。
       */
      describeError={(e) => describeApiFailure(e, '発行', {
        forbidden: '発行するには権限が要ります。オーナーか管理者に依頼してください。',
      })}
      onSave={async () => {
        if (!selectedAccountId) {
          throw new Error('LINEアカウントを選んでください（画面上部で選べます）')
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
          if (!res.success) throw new Error(res.error)
          return res.data.id
        } finally {
          setSaving(false)
        }
      }}
      aside={
        <Disclosure key={widePreview ? 'wide' : 'compact'} title="お客さまの進み方と LINE の見え方" defaultOpen={widePreview} className={styles.previewPanel}>
          <SectionHeader title="お客さまはこの順に進みます" />
          <Card padding="default">
            <ol className={styles.flow}>
              <FlowStep step="1">QR コード・URL を開く</FlowStep>
              <FlowStep step="2">{redirectUrl.trim() ? '転送先のページへ進む' : 'LINE で友だちになる（この経路で数える）'}</FlowStep>
              {tagId ? <FlowStep step="3">タグ「{tags.find((tag) => tag.id === tagId)?.name}」が付く</FlowStep> : null}
              {introTemplateId ? <FlowStep step={tagId ? '4' : '3'}>選んだメッセージが届く（右のスマホ）</FlowStep> : null}
              {scenarioId ? <FlowStep step={String(3 + Number(Boolean(tagId)) + Number(Boolean(introTemplateId)))}>シナリオ「{scenarios.find((scenario) => scenario.id === scenarioId)?.name}」が始まる</FlowStep> : null}
            </ol>
          </Card>
          <LinePreview
            accountName={selectedAccount?.name}
            caption="友だち追加直後"
            empty={!introTemplateId ? '追加直後に送るメッセージを選ぶと、ここに表示されます。' : false}
          >
            {introTemplateId ? <p className={styles.message}>
              {templates.find((template) => template.id === introTemplateId)?.messageType === 'text'
                ? templates.find((template) => template.id === introTemplateId)?.messageContent || '本文を取得できませんでした'
                : `テンプレート「${templates.find((template) => template.id === introTemplateId)?.name}」を送ります`}
            </p> : null}
          </LinePreview>
        </Disclosure>
      }
    >
      {candidateLoading ? <p role="status" className="text-xs text-ink-secondary">友だち追加時の動きの候補を読み込んでいます</p> : null}
      {candidateFailed ? <Notice tone="warn" message="友だち追加時の動きの候補を読み込めませんでした。選び直す前に、もう一度読み込んでください。" action={<Button onClick={() => setCandidateAttempt((value) => value + 1)}>候補を再読み込み</Button>} /> : null}
      {pruneNotice ? <Notice tone="warn" message={pruneNotice} onClose={() => setPruneNotice(null)} /> : null}
      <InflowSection label="どこに置くリンクですか" help="名前は一覧で見分けるためのものです。お客さまには見えません。">
        <div className={styles.pair}>
          <Field label="名前" htmlFor="ir-name" required>
            <TextField id="ir-name" value={name} onChange={(e) => {
              setName(e.target.value)
              if (!refTouched) setRefCode(suggestRef(e.target.value))
            }} placeholder="例：夏のInstagram投稿" />
          </Field>
          <Field label="フォルダ" htmlFor="ir-genre" help="選んだフォルダの中に追加されます。新しい名前を入力することもできます。">
            <TextField id="ir-genre" value={genre} onChange={(e) => setGenre(e.target.value)} placeholder="例：SNS" />
          </Field>
        </div>
        <Field label="転送先（入れると友だち追加へ進みません）" htmlFor="ir-redirect">
          <TextField id="ir-redirect" type="url" value={redirectUrl} onChange={(e) => setRedirectUrl(e.target.value)} placeholder="（空欄）" />
        </Field>
        <Field label="見分けるための文字（URL の最後に付く）" htmlFor="ir-ref" required help="REF（URLに入る文字）。半角英数字・_・ハイフンで1〜64文字にします。配ったURLが使えなくなるため、発行後は変えられません。">
          <TextField id="ir-ref" value={refCode} onChange={(e) => { setRefTouched(true); setRefCode(e.target.value) }} placeholder="summer-ig" />
        </Field>
      </InflowSection>

      <InflowSection label="どの LINE アカウントに入れますか" help="友だちになる先のアカウントです。一覧では選んだアカウントの分だけ表示されます。">
        <Field label="所属するLINEアカウント" help="画面上部で選んだアカウントに所属します。">
          <p className={styles.account} title={selectedAccount?.name ?? undefined}>
            {selectedAccountId ? selectedAccount?.name ?? selectedAccountId : '画面上部でLINEアカウントを選んでください'}
          </p>
        </Field>
        {pools.length > 0 ? <Field label="入れるアカウント" htmlFor="ir-pool" help="選ばないと、全体の既定の振り分けに従います。いっぱいのときの振り分けはLINEアカウント側の設定に従います。">
          <Select id="ir-pool" value={poolId} onChange={setPoolId} aria-label="友だちの追加先アカウント" size="full" options={[
            { value: '', label: 'メインプールで自動振り分け' },
            ...pools.map((pool) => ({ value: pool.id, label: pool.name })),
          ]} />
        </Field> : null}
      </InflowSection>

      <InflowSection label="友だちになったときにすること" help="何も決めないと「動きが未設定」になり、数えるだけになります。">
        <div className={styles.action}>
          <Toggle checked={tagEnabled || Boolean(tagId)} label="タグを付ける" onChange={(next) => { setTagEnabled(next); if (!next) setTagId('') }} />
          <Field label="タグを付ける" htmlFor="ir-tag" help="あとで配信の絞り込みに使えます。">
            <Select id="ir-tag" value={tagId} onChange={(value) => { setTagId(value); setTagEnabled(Boolean(value)) }} aria-label="自動で付けるタグ" size="full" options={[
              { value: '', label: '（なし）' },
              ...tagOptionGroups.flatMap((group) => group.tags.map((tag) => ({ value: tag.id, label: group.label ? `${group.label} / ${tag.name}` : tag.name }))),
            ]} />
          </Field>
        </div>
        <div className={styles.action}>
          <Toggle checked={messageEnabled || Boolean(introTemplateId)} label="メッセージを送る" onChange={(next) => { setMessageEnabled(next); if (!next) setIntroTemplateId('') }} />
          <Field label="メッセージを送る" htmlFor="ir-intro" help="シナリオとは別に、追加直後に1通だけ送ります。">
            <Select id="ir-intro" value={introTemplateId} onChange={(value) => { setIntroTemplateId(value); setMessageEnabled(Boolean(value)) }} aria-label="追加直後に送るメッセージ" size="full" options={[
              { value: '', label: '送らない' }, ...templates.map((template) => ({ value: template.id, label: template.name })),
            ]} />
          </Field>
        </div>
        <div className={styles.action}>
          <Toggle checked={scenarioEnabled || Boolean(scenarioId)} label="シナリオ配信を始める" onChange={(next) => { setScenarioEnabled(next); if (!next) setScenarioId('') }} />
          <Field label="シナリオ配信を始める" htmlFor="ir-scenario" help="経路ごとに違う案内を送れます。">
            <Select id="ir-scenario" value={scenarioId} onChange={(value) => { setScenarioId(value); setScenarioEnabled(Boolean(value)) }} aria-label="開始するシナリオ配信" size="full" options={[
              { value: '', label: '（なし）' }, ...scenarios.map((scenario) => ({ value: scenario.id, label: scenario.name })),
            ]} />
          </Field>
        </div>
        <Disclosure size="compact" title="公開の詳細設定" hint={isActive ? '発行したらすぐ使えます' : '公開オフで発行します'}>
          <Checkbox checked={isActive} onCheckedChange={setIsActive}>発行したらすぐ使えるようにする</Checkbox>
        </Disclosure>
      </InflowSection>

      <InflowSection label="発行される URL" help="発行したあと、一覧の「…」から QR コードと URL をコピーできます。紙にはQRコード、Webにはリンクを使ってください。">
        <div className={styles.url}>
          <LinkIcon size={16} aria-hidden="true" />
          <span>{previewUrl || '見分けるための文字を決めると URL ができます'}</span>
          <span>発行するとできます</span>
        </div>
        {previewUrl ? <Disclosure size="compact" title="保存前の見本 — まだ発行されていません">
          <p className="text-xs text-ink-secondary">発行する前に配ると開けません。</p>
          {/* eslint-disable-next-line @next/next/no-img-element -- ローカル生成した保存前の見本 */}
          {qrDataUrl ? <img src={qrDataUrl} alt="発行されるURLのQRコード（保存前の見本）" width={96} height={96} /> : null}
          <p className="text-xs text-ink-secondary">見本のQR — 保存後に画像で保存できます</p>
        </Disclosure> : null}
      </InflowSection>

    </CreatePage>

    <UnsavedLeaveDialog open={leaveTarget !== null} subject="入力した流入リンク" onConfirm={confirmLeave} onCancel={cancelLeave} />
    </div>
  )
}

function FlowStep({ step, children }: { step: string; children: ReactNode }) {
  return <li><span>{step}</span><span>{children}</span></li>
}

function InflowSection({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return <Card padding="default">
    <SectionHeader title={label} help={help} helpLabel={`${label}の説明`} />
    <div className={styles.fields}>{children}</div>
  </Card>
}
