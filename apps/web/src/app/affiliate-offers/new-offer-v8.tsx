'use client'

/** ★V8-B 案件を作る（Td4TN）。成果地点の紐付けはAPI未対応。 */
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { Tag, Scenario } from '@line-crm/shared'
import { api } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import { TextField, TextArea } from '@/components/shared/text-field'
import { Check } from 'lucide-react'
import Button from '@/components/shared/button'
import Toggle from '@/components/shared/toggle'
import Select from '@/components/shared/select'
import StickyBar from '@/components/shared/sticky-bar'
import { formatNumber } from '@/lib/format'
import '../affiliates/create-v8.css'

const OFFER_LIST_PATH = '/conversions?tab=offers'

function rewardIntegerError(value: string, kind: 'amount' | 'miles'): string | null {
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

export function NewOfferV8() {
  usePageTitle('案件を作る')
  const router = useRouter()
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
  const [tagsFetch, setTagsFetch] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [scenariosFetch, setScenariosFetch] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [candidateSeq, setCandidateSeq] = useState(0)
  const [operationId, setOperationId] = useState(() => crypto.randomUUID())
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saveNote, setSaveNote] = useState('')

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
    void Promise.allSettled([api.tags.list(accountParams), api.scenarios.list(accountParams)]).then(
      ([t, s]) => {
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
      },
    )
    return () => {
      cancelled = true
    }
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
    const amountError = rewardIntegerError(rewardAmount, 'amount')
    if (amountError) return amountError
    const milesError = rewardIntegerError(rewardMiles, 'miles')
    if (milesError) return milesError
    return null
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

  /*
   * 足元の操作。`publish` が真なら公開で作り（保存して公開）、
   * 偽なら下書きで作る（保存して続けて作る）。
   */
  const runSave = async (publish: boolean) => {
    if (saving) return
    const invalid = validate()
    if (invalid) {
      setSaveError(invalid)
      setSaveNote('')
      return
    }
    if (!selectedAccountId) {
      setSaveError('LINEアカウントを選んでください（画面上部で選べます）')
      return
    }
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
        const res = await api.affiliateOffers.create({
          ...fields,
          lineAccountId: selectedAccountId,
          isActive: publish,
          operationId,
        })
        if (!res.success) throw new Error('案件を作成できませんでした。LINEアカウントを選び直してください')
        offerId = res.data.id
        setCreatedId(offerId)
        if (res.data.isActive !== publish) {
          const fix = await api.affiliateOffers.update(offerId, { isActive: publish })
          if (!fix.success) {
            throw new Error('案件の公開状態を変えられませんでした。一覧で状態を確認してください')
          }
        }
      } else {
        const update = await api.affiliateOffers.update(offerId, { ...fields, isActive: publish })
        if (!update.success) {
          throw new Error('案件の変更を保存できませんでした。もう一度押してください')
        }
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

  return (
    <div data-design-node="Td4TN" className="af-create-board">
      <div className="af-create-head">
        <Link href="/affiliates" className="af-create-backLink">← 成果とアフィリエイトへ</Link>
        <h1 className="af-create-headTitle">案件を作る</h1>
        <p className="af-create-headDescription">「何を紹介すると、いくら払うか」を決めます。公開すると、アフィリエイターの画面に出ます。</p>
      </div>

      <div className="af-create-columns">
        <div className="af-create-main">
          <section className="af-create-card" aria-label="どんな案件か">
            <h2 className="af-create-cardTitle">どんな案件か</h2>
            <p className="af-create-cardNote">アフィリエイターの画面に出ます</p>
            <label className="af-create-fieldLabel" htmlFor="of-name">
              案件名
              <TextField
                id="of-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="例：定期便の初回"
                maxLength={120}
              />
            </label>
            <label className="af-create-fieldLabel" htmlFor="of-description">
              説明 任意
              <TextArea
                id="of-description"
                rows={3}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="例：初回の定期便をお申し込みいただいた方が対象です。"
              />
            </label>
          </section>

          {/*
            板 `Td4TN` の「何を成果として数えるか」。見た目だけ（API待ち）。
            成果地点の候補を返す口が無いので、選んだ値はどこにも送らない。
            口ができたらここを本物の選択肢に替える。
          */}
          <section className="af-create-card" aria-label="何を成果として数えるか">
            <h2 className="af-create-cardTitle">何を成果として数えるか</h2>
            <p className="af-create-cardNote">コンバージョンで作った成果地点から選びます</p>
            <label className="af-create-fieldLabel" htmlFor="v8-offer-point">
              成果地点
              <Select
                id="v8-offer-point"
                aria-label="成果地点"
                value=""
                onChange={() => {}}
                options={[{ value: '', label: '準備中' }]}
                disabled
                size="standard"
              />
            </label>
            <p className="af-create-footnote">成果地点の選び方は準備中です。用意ができたらここで選べるようになります。</p>
          </section>

          <section className="af-create-card" aria-label="いくら払うか">
            <h2 className="af-create-cardTitle">いくら払うか</h2>
            <p className="af-create-cardNote">アフィリエイター側の決まりが「定額」のときにこの額を使います</p>
            <div className="af-create-grid2">
              <label className="af-create-fieldLabel" htmlFor="of-amount">
                報酬額（円）
                <TextField
                  id="of-amount"
                  type="number"
                  min={0}
                  step={1}
                  value={rewardAmount}
                  onChange={(event) => setRewardAmount(event.target.value)}
                  placeholder="2000"
                />
              </label>
              <label className="af-create-fieldLabel" htmlFor="of-miles">
                マイル（任意） 任意
                <TextField
                  id="of-miles"
                  type="number"
                  min={0}
                  step={1}
                  value={rewardMiles}
                  onChange={(event) => setRewardMiles(event.target.value)}
                  placeholder="200"
                />
              </label>
            </div>
            <p className="af-create-footnote">現金とマイルは併用できます。マイルは標準プログラムで付けます。</p>
            <div className="af-create-staticBox">
              <p className="af-create-staticLabel">誘導するLINEアカウント</p>
              <p className="af-create-staticValue">{selectedAccount ? selectedAccount.name : '未選択（画面上部で選んでください）'}</p>
              <p className="af-create-staticReason">紹介リンクを開いた方を、このアカウントへ案内します。他のアカウントに作りたいときは、先に上部で切り替えてください。</p>
            </div>
          </section>

          <section className="af-create-card" aria-label="成果を認めたときにすること">
            <h2 className="af-create-cardTitle">成果を認めたときにすること</h2>
            <p className="af-create-cardNote">任意</p>
            <div className="af-create-switchRow">
              <Toggle checked={tagEnabled} label="タグを付ける" onChange={(next) => { setTagEnabled(next); if (!next) setTagId('') }} />
              <div className="af-create-switchBody">
                <p className="af-create-switchName">タグを付ける</p>
                <p className="af-create-switchNote">{tagName ?? 'まだ決めていません'}</p>
                {tagEnabled ? (
                  <Select
                    id="of-tag"
                    aria-label="付けるタグ"
                    value={tagId}
                    onChange={(value) => setTagId(value)}
                    options={[
                      { value: '', label: '（なし）' },
                      ...tags.filter((t) => (t.status ?? 'active') === 'active').map((t) => ({ value: t.id, label: t.name })),
                    ]}
                    size="standard"
                  />
                ) : null}
                {tagsFetch === 'loading' ? <p className="af-create-footnote">タグの候補を読み込んでいます</p> : null}
                {tagsFetch === 'failed' ? (
                  <div className="af-create-toolbar">
                    <p className="af-create-errorText">タグの候補を読み込めませんでした。</p>
                    <Button type="button" variant="secondary" size="compact" onClick={() => setCandidateSeq((n) => n + 1)}>
                      もう一度読み込む
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>
            <div className="af-create-switchRow">
              <Toggle checked={scenarioEnabled} label="シナリオ配信を始める" onChange={(next) => { setScenarioEnabled(next); if (!next) setScenarioId('') }} />
              <div className="af-create-switchBody">
                <p className="af-create-switchName">シナリオ配信を始める</p>
                <p className="af-create-switchNote">{scenarioName ?? 'まだ決めていません'}</p>
                {scenarioEnabled ? (
                  <Select
                    id="of-scenario"
                    aria-label="開始するシナリオ"
                    value={scenarioId}
                    onChange={(value) => setScenarioId(value)}
                    options={[
                      { value: '', label: '（なし）' },
                      ...scenarios.filter((s) => s.isActive !== false).map((s) => ({ value: s.id, label: s.name })),
                    ]}
                    size="standard"
                  />
                ) : null}
                {scenariosFetch === 'loading' ? <p className="af-create-footnote">シナリオの候補を読み込んでいます</p> : null}
                {scenariosFetch === 'failed' ? (
                  <div className="af-create-toolbar">
                    <p className="af-create-errorText">シナリオの候補を読み込めませんでした。</p>
                    <Button type="button" variant="secondary" size="compact" onClick={() => setCandidateSeq((n) => n + 1)}>
                      もう一度読み込む
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>
          </section>

          {saveError ? <p className="af-create-errorText" role="alert">{saveError}</p> : null}
          {saveNote ? <p className="af-create-footnote" role="status">{saveNote}</p> : null}
        </div>

        <aside className="af-create-rail" aria-label="公開の確認">
          <section className="af-create-card">
            <h2 className="af-create-cardTitle">アフィリエイターの画面での見え方</h2>
            <p className="af-create-cardNote">公開するとこう見えます</p>
            <div className="af-create-previewBox">
              <p className="af-create-previewName">{name.trim() || '（案件名）'}</p>
              {description.trim() ? <p className="af-create-footnote">{description.trim()}</p> : null}
              <p className="af-create-previewReward">報酬 ¥{formatNumber(yen)}{miles > 0 ? ` ＋ ${formatNumber(miles)}マイル` : ''} / 件</p>
            </div>
          </section>

          <section className="af-create-card">
            <h2 className="af-create-cardTitle">気をつけること</h2>
            <ul className="af-create-noteList">
              <li>公開中の案件の報酬額を変えると、変えたあとの成果から新しい額になります</li>
            </ul>
          </section>
        </aside>
      </div>

      <StickyBar
        status={saving ? '保存しています' : createdId ? '下書きを保存済み・続きを作れます' : 'まだ保存していません'}
        actions={(
          <>
            <Button href="/affiliates">キャンセル</Button>
            <Button variant="secondary" disabled={saving} busy={saving} busyLabel="保存中..." onClick={() => void runSave(false)}>
              保存して続けて作る
            </Button>
            <Button variant="primary" disabled={saving} busy={saving} busyLabel="保存中..." onClick={() => void runSave(true)}>
              <Check size={15} aria-hidden="true" /> 保存して公開
            </Button>
          </>
        )}
      />
      <UnsavedLeaveDialog open={leaveTarget !== null} subject="入力した案件" onConfirm={confirmLeave} onCancel={cancelLeave} />
    </div>
  )
}
