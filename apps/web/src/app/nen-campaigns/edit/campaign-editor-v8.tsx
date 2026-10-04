'use client'

/*
 * ★V8-B 配信を直す（`w5pwG`）。
 *
 * v7（edit/campaign-editor）とは別の部品として持ち、data-theme="v8" の
 * ときだけこちらが出る。取得・保存・版つき競合・テスト送信の決めごとは
 * 同じ。違いは置き場と見せ方だけ——
 * ・節は 配信フロー・いつ送りますか・送るもの・押されたあとにすること。
 * ・右に届き方の見本・気をつけること・できないこと・テスト送信。
 * ・「リッチメッセージ／文字だけ」の選び分けと「届かない日」の口は
 *   まだ無いので、見え方の確認だけに使う（保存されるのは今の作りのまま）。
 * ・きっかけは配信ごとに決まっているので変えられない（見せるだけ）。
 */
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ApiError, api, describeSaveFailure, type NenCampaignAfterAction, type NenCampaignSetting } from '@/lib/api'
import { checkNenCampaignBodyLength, NEN_CAMPAIGN_BODY_MAX_LENGTH } from '@line-crm/shared'
import { useAccount } from '@/contexts/account-context'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import Combobox from '@/components/shared/combobox'
import LinePreview from '@/components/shared/line-preview'
import Notice from '@/components/shared/notice'
import { TimeField } from '@/components/shared/date-time-field'
import Select from '@/components/shared/select'
import StickyBar from '@/components/shared/sticky-bar'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import { TextInput } from '@/components/shared/form-controls'
import { Check } from 'lucide-react'
import { TextField } from '@/components/shared/text-field'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import ListState from '@/components/shared/list-state'
import InsertToolbar from '@/components/scenarios/insert-toolbar'
import { formatCampaignTiming } from '../campaign-display'
import { formatNumber } from '@/lib/format'
import styles from './campaign-editor-v8.module.css'

const TRIGGER_LABEL: Record<string, string> = {
  'ec.order.confirmed': '注文を受け付けたとき',
  'ec.order.shipped': '商品を発送したとき',
  'ec.order.delivered': '注文が届いたとき',
  'ec.order.arrived': '注文が届いたとき',
  'pet.birthday': 'ペットの誕生日',
}

type FormOption = { id: string; name: string; description: string | null; isActive: boolean }

function triggerLabel(setting: NenCampaignSetting): string {
  if (setting.campaignKey === 'birthday_coupon') return 'ペットの誕生日'
  if (!setting.triggerEvent) return '手動で送る'
  return TRIGGER_LABEL[setting.triggerEvent] ?? '登録済みのきっかけ'
}

function previewBody(value: string): string {
  return value
    .replaceAll('{{pet_name}}', 'ももちゃん')
    .replaceAll('{{ペットの名前}}', 'もも')
    .replaceAll('{{商品名}}', 'フード')
    .replaceAll('{{name}}', '高橋 直人')
}

function openFormUrl(liffId: string | null | undefined, formId: string): string | null {
  if (!liffId) return null
  return `https://liff.line.me/${liffId}/?page=form&id=${encodeURIComponent(formId)}`
}

export default function CampaignEditorV8({ campaignKey }: { campaignKey: string }) {
  const [setting, setSetting] = useState<NenCampaignSetting | null>(null)
  const [draft, setDraft] = useState<Partial<NenCampaignSetting>>({})
  const [forms, setForms] = useState<FormOption[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [testSearch, setTestSearch] = useState('')
  const [testCandidates, setTestCandidates] = useState<Array<{ id: string; displayName: string | null }>>([])
  const [testLoginUsers, setTestLoginUsers] = useState<Array<{ id: string; displayName: string }>>([])
  const [testing, setTesting] = useState(false)
  const [pendingCount, setPendingCount] = useState<number | null>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const { selectedAccountId, selectedAccount } = useAccount()

  useEffect(() => {
    if (!selectedAccountId) {
      setLoading(false)
      setError('LINEアカウントを選んでください')
      return
    }
    let cancelled = false
    setLoading(true)
    void Promise.all([
      api.nenCampaigns.settings(selectedAccountId),
      api.forms.list(selectedAccountId),
    ]).then(([settingsResponse, formsResponse]) => {
      if (cancelled) return
      if (settingsResponse.success) {
        const found = settingsResponse.data.find((item) => item.campaignKey === campaignKey) ?? null
        setSetting(found)
        if (found) setDraft(found)
        else setError('この配信が見つかりませんでした')
      }
      if (formsResponse.success) setForms(formsResponse.data)
    }).catch(() => {
      if (!cancelled) setError('読み込みに失敗しました。もう一度読み込んでください。')
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    void api.nenCampaigns.overview(selectedAccountId)
      .then((res) => {
        if (!cancelled && res.success) setPendingCount(res.data.jobs.pendingByCampaign?.[campaignKey] ?? 0)
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [campaignKey, selectedAccountId])

  useEffect(() => {
    setTestLoginUsers([])
    setTestCandidates([])
    if (!selectedAccountId) return
    let cancelled = false
    void api.accountSettings.getTestRecipientLoginUsers(selectedAccountId)
      .then((response) => {
        if (cancelled || !response.success) return
        const candidates = response.data
          .filter((candidate) => candidate.sameAccount)
          .map((candidate) => ({ id: candidate.id, displayName: candidate.staffName }))
        setTestLoginUsers(candidates)
        setTestCandidates(candidates)
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [selectedAccountId])

  const merged = { ...setting, ...draft } as NenCampaignSetting
  const dirty = setting !== null && JSON.stringify(draft) !== JSON.stringify(setting)
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty, busy: saving })
  const actions = merged.afterActions ?? []
  const formAction = actions.find((action) => action.kind === 'open_form')
  const mileageAction = actions.find((action) => action.kind === 'award_mileage')
  const isBirthday = merged.campaignKey === 'birthday_coupon'
  const selectedForm = formAction ? forms.find((form) => form.id === formAction.formId) : undefined
  const formIssueMessage = formAction
    ? (!selectedForm
        ? 'つなぐ回答フォームが見つかりません（削除されたか、別のLINEアカウント専用の可能性があります）'
        : !selectedForm.isActive
          ? 'つなぐ回答フォームは公開されていません'
          : null)
    : null
  const formIssueBanner = setting?.formIssue
    ? setting.formIssue === 'form_unselected'
      ? '設定不足：つなぐ回答フォームが選ばれていません。この間、新しい配信は予約されません。フォームを選んで保存してください。'
      : '設定不足：つなぐ回答フォームが使えなくなっています。この間、新しい配信は予約されません。フォームを選び直して保存してください。'
    : null

  const setActions = (afterActions: NenCampaignAfterAction[]) => {
    setDraft((previous) => ({ ...previous, afterActions }))
  }

  const addFormAction = (formId: string) => {
    const form = forms.find((candidate) => candidate.id === formId)
    if (!form) return
    const next: NenCampaignAfterAction = {
      kind: 'open_form', formId: form.id, formName: form.name, buttonLabel: '感想を書く（30秒）',
    }
    setDraft((previous) => ({
      ...previous,
      afterActions: [...actions.filter((action) => action.kind !== 'open_form'), next],
      buttonLabel: next.buttonLabel,
      buttonUrl: openFormUrl(selectedAccount?.liffId, form.id) ?? merged.buttonUrl,
    }))
  }

  const addMileageAction = () => {
    setActions([
      ...actions.filter((action) => action.kind !== 'award_mileage'),
      { kind: 'award_mileage', amount: 200, trigger: 'form_submitted' },
    ])
  }

  const searchFriends = async () => {
    const query = testSearch.trim()
    setNotice('')
    try {
      const response = await api.friends.list({ search: query, accountId: selectedAccountId ?? undefined, limit: 5 })
      if (!response.success) throw new Error('failed')
      const loginUsers = testLoginUsers.filter((candidate) => candidate.displayName.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
      const friends = response.data.items.map((friend) => ({ id: friend.id, displayName: friend.displayName }))
      setTestCandidates([...new Map([...loginUsers, ...friends].map((candidate) => [candidate.id, candidate])).values()])
    } catch {
      setNotice('相手を探せませんでした。通信を確認してもう一度お試しください。')
    }
  }

  const sendTest = async (friendId: string) => {
    if (!selectedAccountId) return
    setTesting(true)
    setError('')
    setNotice('')
    try {
      await api.nenCampaigns.testSend({
        campaignKey, accountId: selectedAccountId, friendId,
        draft: {
          title: merged.title, bodyText: merged.bodyText,
          buttonLabel: merged.buttonLabel ?? '', buttonUrl: merged.buttonUrl ?? '', imageUrl: merged.imageUrl ?? '',
        },
      })
      setNotice('テスト送信しました')
    } catch {
      setError('テスト送信できませんでした')
    } finally {
      setTesting(false)
    }
  }

  const bodyCheck = checkNenCampaignBodyLength(merged.bodyText ?? '')
  const bodyLimitLabel = formatNumber(NEN_CAMPAIGN_BODY_MAX_LENGTH)

  const save = async () => {
    if (!setting || !selectedAccountId) return
    if (!merged.bodyText?.trim()) {
      setError('本文を入力してください')
      return
    }
    if (!bodyCheck.fits) {
      setError(`本文が長すぎます（現在${formatNumber(bodyCheck.length)}字・上限${bodyLimitLabel}字）。短くしてから保存してください。入力内容はそのまま残っています。`)
      return
    }
    if (formIssueMessage) {
      setError(`${formIssueMessage}。フォームを外して選び直してから保存してください`)
      return
    }
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const response = await api.nenCampaigns.updateSetting(selectedAccountId, setting.campaignKey, {
        isEnabled: merged.isEnabled,
        title: merged.title,
        bodyText: merged.bodyText,
        delayDays: merged.delayDays,
        deliveryTime: merged.deliveryTime,
        buttonLabel: formAction?.buttonLabel ?? merged.buttonLabel,
        buttonUrl: formAction ? openFormUrl(selectedAccount?.liffId, formAction.formId) ?? merged.buttonUrl : merged.buttonUrl,
        imageUrl: merged.imageUrl,
        dedupWindowDays: merged.dedupWindowDays,
        excludeFormRespondents: Boolean(formAction) && merged.excludeFormRespondents,
        afterActions: actions,
        expectedUpdatedAt: setting.updatedAt,
      })
      if (!response.success) {
        setError('保存に失敗しました。通信を確かめて、もう一度お試しください。')
        return
      }
      setNotice('配信内容を保存しました')
      setSetting({ ...merged, updatedAt: response.data?.updatedAt ?? merged.updatedAt })
    } catch (error) {
      if (error instanceof ApiError && error.status === 409 && error.code === 'VERSION_CONFLICT') {
        try {
          const reloaded = await api.nenCampaigns.settings(selectedAccountId)
          if (reloaded.success) {
            const found = reloaded.data.find((item) => item.campaignKey === campaignKey) ?? null
            if (found) setSetting(found)
          }
        } catch {
          // 読み直しに失敗しても入力は残す。文面だけで理由を伝える。
        }
        setError('ほかの人が先に保存しました。最新の内容を確認してから、もう一度保存してください。入力した内容はそのまま残っています。')
        return
      }
      setError(describeSaveFailure(error))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <ListState kind="loading" title="NEN配信を読み込んでいます" />
  if (!setting) return <ListState kind="error" title={error || 'この配信が見つかりませんでした'} />

  const timing = `${formatCampaignTiming({ campaignKey, delayDays: merged.delayDays, deliveryTime: merged.deliveryTime.slice(0, 5) })} に届きます`

  return (
    <div data-design-node="w5pwG" className={styles.board}>
      <div className={styles.head}>
        <nav className={styles.crumb} aria-label="パンくず">
          <Link href="/nen-campaigns">← NEN配信へ</Link>
        </nav>
        <h1 className={styles.headTitle}>{setting.label}（配信を直す）</h1>
        <p className={styles.headDesc}>{timing}。保存した新しい中身は、次のきっかけからの配信に使われます。</p>
      </div>

      {error ? <Notice tone="danger" message={error} /> : null}
      {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
      {formIssueBanner ? <Notice tone="warn" message={formIssueBanner} /> : null}

      <div className={styles.split}>
        <div className={styles.main}>
          <section className={styles.card} aria-label="配信フロー">
            <h2 className={styles.cardTitle}>配信フロー</h2>
            <p className={styles.note}>回答フォームへの送信をきっかけにマイルを付けます</p>
            <ul className={styles.flow}>
              <li>{triggerLabel(setting)}</li>
              <li>{isBirthday ? '3日前 10:00' : `${merged.delayDays}日後 ${merged.deliveryTime.slice(0, 5)}`}</li>
              <li>{setting.label}</li>
              {formAction ? <li>フォームに答えた</li> : null}
              {mileageAction?.kind === 'award_mileage' ? <li>{formatNumber(mileageAction.amount)}マイル</li> : null}
            </ul>
          </section>

          <section className={styles.card} aria-label="いつ送りますか">
            <h2 className={styles.cardTitle}>いつ送りますか</h2>
            <p className={styles.note}>このアカウントでの反応がいい時間帯は、分析の「配信の反応」で見られます</p>
            <div className={styles.row3}>
              <div className={styles.fieldLabel}>
                きっかけ
                <p className={styles.static}>{triggerLabel(setting)}</p>
                {!isBirthday ? <label className={styles.delay}>
                  <TextInput aria-label="きっかけからの日数" type="number" min={0} max={365}
                    value={String(merged.delayDays)} onChange={(event) => setDraft((previous) => ({ ...previous, delayDays: Number(event.target.value) }))} />
                  <span>日後</span>
                </label> : null}
              </div>
              <div className={styles.fieldLabel}>
                送る時刻
                {isBirthday ? (
                  <p className={styles.static}>10:00（固定）</p>
                ) : (
                  <TimeField aria-label="送る時刻" value={merged.deliveryTime.slice(0, 5)} onChange={(v) => setDraft((previous) => ({ ...previous, deliveryTime: v }))} />
                )}
              </div>
              <div className={styles.fieldLabel}>
                届かない日
                <p className={styles.static}>なし（毎日送る）</p>
              </div>
            </div>
            {isBirthday ? (
              <p className={styles.note}>誕生日のきっかけ・日時は配信の実行処理で固定されています。</p>
            ) : (
              <>
                <label className={styles.checkRow}>
                  <Checkbox checked={merged.dedupWindowDays > 0} onCheckedChange={(checked) => setDraft((previous) => ({ ...previous, dedupWindowDays: checked ? 30 : 0 }))}>
                    同じ人に何度も送らない（30日のあいだに1回だけ）
                  </Checkbox>
                </label>
                {merged.campaignKey === 'review_request' ? (
                  <label className={styles.checkRow}>
                    <Checkbox checked={Boolean(formAction) && merged.excludeFormRespondents} disabled={!formAction} onCheckedChange={(checked) => setDraft((previous) => ({ ...previous, excludeFormRespondents: checked }))}>
                      すでに口コミを書いた人には送らない
                    </Checkbox>
                  </label>
                ) : null}
              </>
            )}
          </section>

          <section className={styles.card} aria-label="送るもの">
            <h2 className={styles.cardTitle}>送るもの</h2>
            <p className={styles.note}>この配信は1通で届きます</p>
            <div className={styles.fieldLabel}>
              届く形
              <RadioCardGroup legend="届く形" className={styles.row2}>
                <RadioCard name="message-kind" value="rich" checked onChange={() => {}} title="リッチメッセージ" />
                <RadioCard name="message-kind" value="text" checked={false} onChange={() => {}} title="文字だけ" disabled disabledReason="この配信では選べません" />
              </RadioCardGroup>
            </div>
            <label className={styles.fieldLabel}>
              配信本文
              <span className={styles.note}>差し込み：友だち情報欄「ペットの名前」・注文の「商品名」</span>
              <span className={styles.toolbar}>
                <InsertToolbar targetRef={bodyRef} value={merged.bodyText} onChange={(bodyText) => setDraft((previous) => ({ ...previous, bodyText }))} />
              </span>
              <textarea
                ref={bodyRef}
                rows={5}
                value={merged.bodyText}
                onChange={(event) => setDraft((previous) => ({ ...previous, bodyText: event.target.value }))}
                aria-label="配信本文"
                className={styles.textarea}
              />
            </label>
            {bodyCheck.fits ? (
              <p className={styles.note}>あと{formatNumber(NEN_CAMPAIGN_BODY_MAX_LENGTH - bodyCheck.length)}字（上限{bodyLimitLabel}字。長すぎるとLINEで送れません）</p>
            ) : (
              <p className={styles.errorText} role="alert">{bodyLimitLabel}字を超えています（現在{formatNumber(bodyCheck.length)}字）。短くしてください。</p>
            )}
            <p className={styles.caution}>差し込む名前が長いと、送るときに長すぎる場合があります。1回にたくさんの吹き出しを送るとブロックされやすい傾向があります（一般的な目安）。</p>
          </section>

          <section className={styles.card} aria-label="押されたあとにすること">
            <h2 className={styles.cardTitle}>押されたあとにすること</h2>
            <p className={styles.note}>メッセージの「口コミを書く」を押した人に何をするかです</p>
            {formAction?.kind === 'open_form' ? (
              <div className={styles.actionRow}>
                <div>
                  <p className={styles.actionTitle}>回答フォーム「{formAction.formName}」を開かせる（任意）</p>
                  <p className={styles.note}>星の評価と、ひとことだけの短いフォームです</p>
                </div>
                <Button type="button" variant="secondary" aria-label="回答フォームを外す" onClick={() => setActions(actions.filter((action) => action !== formAction))}>外す</Button>
              </div>
            ) : (
              <label className={styles.fieldLabel}>
                回答フォームを開かせる（任意）
                <Combobox
                  aria-label="回答フォームを開かせる（任意）"
                  placeholder="回答フォームを選ぶ"
                  value=""
                  onChange={(formId) => addFormAction(formId)}
                  options={forms.map((form) => ({ value: form.id, label: form.name, dot: form.isActive ? 'green' : 'gray', disabled: !form.isActive, hint: form.isActive ? undefined : '公開されていないため選べません' }))}
                />
              </label>
            )}
            {mileageAction?.kind === 'award_mileage' ? (
              <div className={styles.actionRow}>
                <div>
                  <p className={styles.actionTitle}>回答後に{formatNumber(mileageAction.amount)}マイル付ける</p>
                  <p className={styles.note}>回答フォームへの送信をきっかけにしています</p>
                </div>
                <Button type="button" variant="secondary" aria-label="マイル付与を外す" onClick={() => setActions(actions.filter((action) => action !== mileageAction))}>外す</Button>
              </div>
            ) : (
              <Button type="button" variant="secondary" onClick={addMileageAction}>回答後に200マイル付ける</Button>
            )}
            {formIssueMessage ? <p className={styles.errorText} role="alert">{formIssueMessage}。フォームを外して選び直してください。</p> : null}
            <p className={styles.linkLine}>つながる先：→ 回答フォーム → マイル → EC連携 → 友だち属性</p>
          </section>
        </div>

        <aside className={styles.side}>
          <section className={styles.preview} aria-label="届き方の見本">
            <h2 className={styles.cardTitle}>お客さまにはこう届きます</h2>
            <LinePreview caption={`◷ ${timing}`}>
              <div className={styles.previewBody}>
                <p className={styles.previewText}>{previewBody(merged.bodyText)}</p>
                {merged.buttonLabel ? <p className={styles.previewButton}>★ {merged.buttonLabel}</p> : null}
              </div>
            </LinePreview>
          </section>
          <section className={styles.card} aria-label="気をつけること">
            <h2 className={styles.cardTitle}>気をつけること（一般的な目安）</h2>
            <ul className={styles.tips}>
              <li>吹き出しは少なめが安心です</li>
              <li>届く時間は「配信の反応」で確かめられます</li>
              <li>誕生日配信は10:00に固定です</li>
            </ul>
          </section>
          <section className={styles.card} aria-label="この画面でできないこと">
            <h2 className={styles.cardTitle}>この画面でできないこと</h2>
            <p className={styles.note}>記事の本文を書く（外部サイトで書きます）・出した後の細かい設定（一斉配信と同じ）</p>
          </section>
          <section className={styles.card} aria-label="自分にテストを送る">
            <h2 className={styles.cardTitle}>自分にテストを送る</h2>
            <label className={styles.fieldLabel}>
              テスト送信の相手を名前で探す
              <TextField
                aria-label="テスト送信の相手を名前で探す"
                type="search"
                value={testSearch}
                onChange={(event) => setTestSearch(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') void searchFriends() }}
              />
            </label>
            <span className={styles.selectFoot}>
              <Button type="button" variant="secondary" onClick={() => void searchFriends()}>探す</Button>
              {testCandidates.slice(0, 3).map((candidate) => (
                <Button key={candidate.id} type="button" variant="secondary" disabled={testing} onClick={() => void sendTest(candidate.id)}>
                  {candidate.displayName ?? '名前なし'}へ送る
                </Button>
              ))}
            </span>
          </section>
        </aside>
      </div>

      <StickyBar
        status={merged.isEnabled
          ? pendingCount !== null && pendingCount > 0
            ? `動いています。配信待ちの${formatNumber(pendingCount)}通は予約したときの中身のまま届きます。保存した新しい中身は、次のきっかけからの配信に使われます。`
            : '動いています。保存した新しい中身は、次のきっかけからの配信に使われます。すでに配信待ちの分は、予約したときの中身のまま届きます。'
          : '停止中です。保存しても新しい配信は始まりません。'}
        actions={(
          <>
            <Button href="/nen-campaigns">キャンセル</Button>
            <Button type="button" variant="primary" onClick={() => void save()} disabled={saving || !bodyCheck.fits} busy={saving} busyLabel="保存しています…"><Check size={14} aria-hidden="true" />配信内容を保存する</Button>
          </>
        )}
      />
      <UnsavedLeaveDialog open={leaveTarget !== null} onConfirm={confirmLeave} onCancel={cancelLeave} />
    </div>
  )
}
