'use client'

/*
 * ★V8-B 案件を作る（絵 Td4TN・機能追加 F-23）。
 *
 * 型（CreatePage）に4つの段（どんな案件か・何を成果として数えるか・いくら払うか・成果を認めたときにすること）と、
 * 右の列（アフィリエイターの画面での見え方・気をつけること）、下の帯を渡す。
 * 聞く項目・保存の口・送る形・入力の断り方は今の画面（app/affiliate-offers/new-offer-v8.tsx）から写した。
 * 成果地点を案件につなぐ口がまだ無い（F-23）ので、成果地点の欄は押せない形で置く（BEHAVIOR.md）。
 */
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check } from 'lucide-react'
import type { Scenario, Tag } from '@line-crm/shared'
import { api } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import { CreatePage } from '@/components/templates'
import Button from '@/components/shared/button'
import HelpTip from '@/components/shared/help-tip'
import Select from '@/components/shared/select'
import { TextField } from '@/components/shared/text-field'
import Toggle from '@/components/shared/toggle'
import styles from './create.module.css'

const OFFER_LIST_PATH = '/conversions?tab=offers'

/** 報酬の数の断り方（今の画面と同じ文）。 */
export function rewardIntegerError(value: string, kind: 'amount' | 'miles'): string | null {
  if (!value.trim()) return null
  const reward = Number(value)
  const label = kind === 'amount' ? '報酬額' : '報酬マイル'
  if (!Number.isFinite(reward) || reward < 0) return `${label}は0以上で入力してください`
  if (!Number.isInteger(reward)) {
    return kind === 'amount'
      ? '報酬額は小数ではなく、1円単位の整数で入力してください'
      : '報酬マイルは小数ではなく、整数で入力してください'
  }
  return null
}

type Fetch = 'loading' | 'ready' | 'failed'

export default function AffiliateOfferCreateV8() {
  usePageTitle('案件を作る')
  const router = useRouter()
  const role = useStaffRole()
  const canEdit = !role || canManageRole(role)
  const { selectedAccountId, selectedAccount } = useAccount()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [rewardAmount, setRewardAmount] = useState('')
  const [rewardMiles, setRewardMiles] = useState('')
  const [tagId, setTagId] = useState('')
  const [scenarioId, setScenarioId] = useState('')
  const [tagEnabled, setTagEnabled] = useState(false)
  const [scenarioEnabled, setScenarioEnabled] = useState(false)
  const [createdId, setCreatedId] = useState<string | null>(null)
  const [tags, setTags] = useState<Tag[]>([])
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [tagsFetch, setTagsFetch] = useState<Fetch>('loading')
  const [scenariosFetch, setScenariosFetch] = useState<Fetch>('loading')
  const [candidateSeq, setCandidateSeq] = useState(0)
  const [operationId, setOperationId] = useState(() => crypto.randomUUID())
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saveNote, setSaveNote] = useState('')

  /* アカウントを替えたら、前のアカウントの下書き・タグ・シナリオは持ち越さない。 */
  const draftAccountRef = useRef(selectedAccountId)
  useEffect(() => {
    if (draftAccountRef.current === selectedAccountId) return
    draftAccountRef.current = selectedAccountId
    setCreatedId(null)
    setOperationId(crypto.randomUUID())
    setTagId('')
    setScenarioId('')
    setTagEnabled(false)
    setScenarioEnabled(false)
  }, [selectedAccountId])

  useEffect(() => {
    let cancelled = false
    if (!selectedAccountId) {
      setTags([])
      setScenarios([])
      setTagsFetch('ready')
      setScenariosFetch('ready')
      return () => { cancelled = true }
    }
    setTags([])
    setScenarios([])
    setTagsFetch('loading')
    setScenariosFetch('loading')
    const accountParams = { accountId: selectedAccountId }
    void Promise.allSettled([api.tags.list(accountParams), api.scenarios.list(accountParams)]).then(([t, s]) => {
      if (cancelled) return
      if (t.status === 'fulfilled' && t.value.success) {
        setTags(t.value.data)
        setTagsFetch('ready')
      } else {
        setTags([])
        setTagsFetch('failed')
      }
      if (s.status === 'fulfilled' && s.value.success) {
        setScenarios(s.value.data as unknown as Scenario[])
        setScenariosFetch('ready')
      } else {
        setScenarios([])
        setScenariosFetch('failed')
      }
    })
    return () => { cancelled = true }
  }, [selectedAccountId, candidateSeq])

  const yen = rewardAmount ? Number(rewardAmount) : 0
  const miles = rewardMiles ? Number(rewardMiles) : 0

  const validate = (): string | null => {
    if (!name.trim()) return '案件名を入力してください'
    if (!selectedAccountId) return 'LINEアカウントを選んでください（画面上部で選べます）'
    if (tagsFetch === 'failed' || scenariosFetch === 'failed') {
      return 'タグまたはシナリオの候補を読み込めませんでした。「もう一度読み込む」で取り直してから保存してください'
    }
    if (tagEnabled && !tagId) return '付けるタグを選んでください'
    if (scenarioEnabled && !scenarioId) return '開始するシナリオを選んでください'
    if (!rewardAmount && !rewardMiles) return '報酬（円かマイル）のどちらかを入れてください'
    return rewardIntegerError(rewardAmount, 'amount') ?? rewardIntegerError(rewardMiles, 'miles')
  }

  const reset = () => {
    setName('')
    setDescription('')
    setRewardAmount('')
    setRewardMiles('')
    setTagId('')
    setScenarioId('')
    setTagEnabled(false)
    setScenarioEnabled(false)
    setCreatedId(null)
    setOperationId(crypto.randomUUID())
  }

  /* `publish` が真なら公開で作る（保存して公開）。偽なら下書きで作り、続けて作れるよう空にする。 */
  const runSave = async (publish: boolean) => {
    if (saving) return
    const invalid = validate()
    if (invalid) {
      setSaveError(invalid)
      setSaveNote('')
      return
    }
    if (!selectedAccountId) return
    setSaving(true)
    setSaveError('')
    setSaveNote('')
    try {
      const fields = {
        name: name.trim(),
        description: description.trim() || null,
        rewardAmount: rewardAmount ? Number(rewardAmount) : undefined,
        rewardMiles: rewardMiles ? Number(rewardMiles) : undefined,
        tagId: tagId || null,
        scenarioId: scenarioId || null,
      }
      let offerId = createdId
      if (!offerId) {
        const res = await api.affiliateOffers.create({ ...fields, lineAccountId: selectedAccountId, isActive: publish, operationId })
        if (!res.success) throw new Error('案件を作成できませんでした。LINEアカウントを選び直してください')
        offerId = res.data.id
        setCreatedId(offerId)
        if (res.data.isActive !== publish) {
          const fix = await api.affiliateOffers.update(offerId, { isActive: publish })
          if (!fix.success) throw new Error('案件の公開状態を変えられませんでした。一覧で状態を確認してください')
        }
      } else {
        const update = await api.affiliateOffers.update(offerId, { ...fields, isActive: publish })
        if (!update.success) throw new Error('案件の変更を保存できませんでした。もう一度押してください')
      }
      if (publish) {
        router.push(`${OFFER_LIST_PATH}&highlight=${encodeURIComponent(offerId)}`)
      } else {
        reset()
        setSaveNote('下書きに保存しました。続けて作れます。')
      }
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : '保存できませんでした')
    } finally {
      setSaving(false)
    }
  }

  const dirty = Boolean(name || description || rewardAmount || rewardMiles || tagId || scenarioId || tagEnabled || scenarioEnabled)
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty, busy: saving })

  const tagName = tags.find((tag) => tag.id === tagId)?.name ?? null
  const scenarioName = scenarios.find((item) => item.id === scenarioId)?.name ?? null

  const retry = (what: string) => (
    <div className={styles.retry}>
      <p className={styles.error} role="alert">{`${what}の候補を読み込めませんでした。`}</p>
      <Button type="button" variant="secondary" size="compact" onClick={() => setCandidateSeq((n) => n + 1)}>もう一度読み込む</Button>
    </div>
  )

  const preview = (
    <>
      <section className={styles.sideCard} aria-labelledby="af-new-preview">
        <h2 className={styles.sideTitle} id="af-new-preview">アフィリエイターの画面での見え方</h2>
        <p className={styles.sideNote}>公開するとこう見えます</p>
        <div className={styles.previewBox}>
          <p className={styles.previewName}>{name.trim() || '（案件名）'}</p>
          {description.trim() ? <p className={styles.previewDesc}>{description.trim()}</p> : null}
          <p className={styles.previewReward}>{`報酬 ¥${formatNumber(yen)}${miles > 0 ? ` ＋ ${formatNumber(miles)}マイル` : ''} / 件`}</p>
        </div>
      </section>
      <section className={styles.sideCard} aria-labelledby="af-new-care">
        <h2 className={styles.sideTitle} id="af-new-care">気をつけること</h2>
        <ul className={styles.careList}>
          <li>・公開中の案件の報酬額を変えると、変えたあとの成果から新しい額になります</li>
          <li>{`・紹介リンクを開いた方は「${selectedAccount ? selectedAccount.name : '上部で選んだLINEアカウント'}」へ案内します。ほかのアカウントに作るときは、先に上部で切り替えてください`}</li>
        </ul>
      </section>
    </>
  )

  return (
    <CreatePage
      boardId="Td4TN"
      identity={<Link href="/affiliates" className={styles.back}>← 成果とアフィリエイトへ</Link>}
      title="案件を作る"
      description="「何を紹介すると、いくら払うか」を決めます。公開すると、アフィリエイターの画面に出ます。"
      preview={preview}
      status={canEdit ? (saving ? '保存しています' : createdId ? '下書きを保存済み・続きを作れます' : undefined) : undefined}
      footerActions={(
        <>
          <Button href="/affiliates">キャンセル</Button>
          {canEdit ? (
            <>
              <Button variant="secondary" disabled={saving} busy={saving} busyLabel="保存中..." onClick={() => void runSave(false)}>
                保存して続けて作る
              </Button>
              <Button variant="primary" disabled={saving} busy={saving} busyLabel="保存中..." onClick={() => void runSave(true)}>
                <Check size={15} aria-hidden="true" />保存して公開
              </Button>
            </>
          ) : null}
        </>
      )}
    >
      {canEdit ? null : <p className={styles.viewerBand} role="status">閲覧のみで見ています。案件を作るのは管理者に頼んでください。</p>}
      {saveError ? <p className={styles.error} role="alert">{saveError}</p> : null}
      {saveNote ? <p className={styles.note} role="status">{saveNote}</p> : null}

      <section className={styles.card} aria-labelledby="af-new-what">
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle} id="af-new-what">どんな案件か</h2>
          <p className={styles.cardNote}>アフィリエイターの画面に出ます</p>
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="of-name">案件名</label>
          <TextField id="of-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="例：定期便の初回" maxLength={120} readOnly={!canEdit} />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="of-description">説明<span className={styles.optional}>任意</span></label>
          <TextField id="of-description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="例：初回の定期便をお申し込みいただいた方が対象です。" maxLength={500} readOnly={!canEdit} />
        </div>
      </section>

      <section className={styles.card} aria-labelledby="af-new-point">
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle} id="af-new-point">何を成果として数えるか</h2>
          <p className={styles.cardNote}>コンバージョンで作った成果地点から選びます</p>
        </div>
        <div className={styles.field}>
          <span className={styles.pickLabel}>
            成果地点
            <HelpTip label="成果地点の説明">成果地点と案件をつなぐ操作は、まだ保存できません。今は案件ごとの報酬だけを決めます。</HelpTip>
          </span>
          <div className={styles.selectBox}>
            <Select
              id="of-point"
              aria-label="成果地点"
              size="full"
              value=""
              onChange={() => undefined}
              options={[{ value: '', label: 'まだ選べません' }]}
              disabled
            />
          </div>
        </div>
      </section>

      <section className={styles.card} aria-labelledby="af-new-reward">
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle} id="af-new-reward">いくら払うか</h2>
          <p className={styles.cardNote}>アフィリエイター側の決まりが「定額」のときにこの額を使います</p>
        </div>
        <div className={styles.pair}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="of-amount">報酬額（円）</label>
            <TextField id="of-amount" type="number" min={0} step={1} value={rewardAmount} onChange={(event) => setRewardAmount(event.target.value)} placeholder="2000" readOnly={!canEdit} />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="of-miles">
              マイル（任意）<span className={styles.optional}>任意</span>
              <HelpTip label="マイルの説明">現金とマイルは併用できます。マイルは標準プログラムで付けます。</HelpTip>
            </label>
            <TextField id="of-miles" type="number" min={0} step={1} value={rewardMiles} onChange={(event) => setRewardMiles(event.target.value)} placeholder="200" readOnly={!canEdit} />
          </div>
        </div>
      </section>

      <section className={styles.card} aria-labelledby="af-new-after">
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle} id="af-new-after">成果を認めたときにすること</h2>
          <p className={styles.cardNote}>任意</p>
        </div>
        <div className={styles.switchRow}>
          <Toggle checked={tagEnabled} label="タグを付ける" onChange={canEdit ? (next) => { setTagEnabled(next); if (!next) setTagId('') } : undefined} />
          <div className={styles.switchBody}>
            <p className={styles.switchName}>タグを付ける</p>
            <p className={styles.switchNote}>{tagName ?? 'まだ決めていません'}</p>
            {tagEnabled ? (
              <div className={styles.selectBox}>
                <Select
                  id="of-tag"
                  aria-label="付けるタグ"
                  size="full"
                  value={tagId}
                  onChange={(value) => setTagId(value)}
                  options={[{ value: '', label: '（なし）' }, ...tags.filter((t) => (t.status ?? 'active') === 'active').map((t) => ({ value: t.id, label: t.name }))]}
                />
              </div>
            ) : null}
            {tagsFetch === 'loading' && tagEnabled ? <p className={styles.switchNote}>タグの候補を読み込んでいます</p> : null}
            {tagsFetch === 'failed' ? retry('タグ') : null}
          </div>
        </div>
        <div className={styles.switchRow}>
          <Toggle checked={scenarioEnabled} label="シナリオ配信を始める" onChange={canEdit ? (next) => { setScenarioEnabled(next); if (!next) setScenarioId('') } : undefined} />
          <div className={styles.switchBody}>
            <p className={styles.switchName}>シナリオ配信を始める</p>
            <p className={styles.switchNote}>{scenarioName ?? 'まだ決めていません'}</p>
            {scenarioEnabled ? (
              <div className={styles.selectBox}>
                <Select
                  id="of-scenario"
                  aria-label="開始するシナリオ"
                  size="full"
                  value={scenarioId}
                  onChange={(value) => setScenarioId(value)}
                  options={[{ value: '', label: '（なし）' }, ...scenarios.filter((s) => s.isActive !== false).map((s) => ({ value: s.id, label: s.name }))]}
                />
              </div>
            ) : null}
            {scenariosFetch === 'loading' && scenarioEnabled ? <p className={styles.switchNote}>シナリオの候補を読み込んでいます</p> : null}
            {scenariosFetch === 'failed' ? retry('シナリオ') : null}
          </div>
        </div>
      </section>

      <UnsavedLeaveDialog open={leaveTarget !== null} subject="入力した案件" onConfirm={confirmLeave} onCancel={cancelLeave} />
    </CreatePage>
  )
}
