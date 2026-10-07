'use client'

/*
 * ★V8-B 配信を直す（`w5pwG`、例：口コミのお願い）。
 *
 * 取得・保存・版つき競合・テスト送信の決めごとは今の画面
 * （app/nen-campaigns/edit/campaign-editor-v8.tsx）と同じ。違いは置き場と見せ方だけ——
 * ・節は 配信フロー・いつ送りますか・送るもの・押されたあとにすること。
 * ・きっかけからの日数・送る時刻・つなぐ回答フォーム・付けるマイルは、どれも「選ぶ欄」で選ぶ。
 * ・差し込みの道具・残りの字数は、欄の横の小さな押し口から開く／足りないときだけ出す。
 * ・右に LINE での見え方・気をつけること・この画面でできないこと・自分にテストを送る。
 * 動きの一覧は同じ場所の BEHAVIOR.md。
 */
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { CalendarClock, ChevronLeft, ClipboardList, Coins, Eye, MessageSquare, Package, Save, Send } from 'lucide-react'
import { checkNenCampaignBodyLength, NEN_CAMPAIGN_BODY_MAX_LENGTH } from '@line-crm/shared'
import { ApiError, api, describeSaveFailure, type NenCampaignAfterAction, type NenCampaignSetting } from '@/lib/api'
import { CreatePage } from '@/components/templates'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import LinePreview, { LinePreviewMessage } from '@/components/shared/line-preview'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import Radio from '@/components/shared/radio'
import SearchField from '@/components/shared/search-field'
import Select from '@/components/shared/select'
import InsertToolbar from '@/components/scenarios/insert-toolbar'
import { useAccount } from '@/contexts/account-context'
import { useStaffRole, canManageRole } from '@/lib/staff-role'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { formatNumber } from '@/lib/format'
import { formatCampaignTiming } from './display'
import styles from './form.module.css'

/** きっかけの短い言い方（配信フローの札・日数の選ぶ欄）。 */
const TRIGGER_SHORT: Record<string, string> = {
  'ec.order.confirmed': '注文を受け付けた',
  'ec.order.shipped': '商品を発送した',
  'ec.shipping.shipped': '商品を発送した',
  'ec.order.delivered': '注文が届いた',
  'ec.order.arrived': '注文が届いた',
  'pet.birthday': 'ペットの誕生日',
}

const DELAY_CHOICES = [0, 1, 2, 3, 5, 7, 10, 14, 21, 30, 45, 60, 90]
const MILEAGE_CHOICES = [50, 100, 200, 300, 500, 1000]
const BODY_NOTICE_REMAINING = 300

type FormOption = { id: string; name: string; description: string | null; isActive: boolean }
type Candidate = { id: string; displayName: string | null }

function triggerShort(setting: NenCampaignSetting): string {
  if (setting.campaignKey === 'birthday_coupon') return 'ペットの誕生日'
  if (!setting.triggerEvent) return '手動で送る'
  return TRIGGER_SHORT[setting.triggerEvent] ?? '登録済みのきっかけ'
}

/** 30分ごとの時刻（今の値が並びに無ければ足す）。 */
function timeChoices(current: string): string[] {
  const list: string[] = []
  for (let h = 6; h <= 22; h += 1) for (const m of ['00', '30']) list.push(`${String(h).padStart(2, '0')}:${m}`)
  return list.includes(current) ? list : [...list, current].sort()
}

function withCurrent(choices: number[], current: number): number[] {
  return choices.includes(current) ? choices : [...choices, current].sort((a, b) => a - b)
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

/** 選べない値（誕生日の固定・閲覧のみの人）は、押せない部品を置かずに箱で見せる。 */
function StaticBox({ label, value }: { label: string; value: string }) {
  return <span className={styles.staticBox} role="note" aria-label={`${label}：${value}`}>{value}</span>
}

export default function CampaignEdit({ campaignKey }: { campaignKey: string }) {
  const [setting, setSetting] = useState<NenCampaignSetting | null>(null)
  const [draft, setDraft] = useState<Partial<NenCampaignSetting>>({})
  const [forms, setForms] = useState<FormOption[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [testSearch, setTestSearch] = useState('')
  const [testCandidates, setTestCandidates] = useState<Candidate[]>([])
  const [testLoginUsers, setTestLoginUsers] = useState<Array<{ id: string; displayName: string }>>([])
  const [testTarget, setTestTarget] = useState('')
  const [testing, setTesting] = useState(false)
  const [pendingCount, setPendingCount] = useState<number | null>(null)
  const [insertOpen, setInsertOpen] = useState(false)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const { selectedAccountId, selectedAccount } = useAccount()
  const staffRole = useStaffRole()
  const canEdit = staffRole === null || canManageRole(staffRole)

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

  // テスト送信の相手の候補。はじめは、このアカウントのテスト送信先に登録したログインユーザー。
  useEffect(() => {
    setTestLoginUsers([])
    setTestCandidates([])
    setTestTarget('')
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
        setTestTarget(candidates[0]?.id ?? '')
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

  const setActions = (afterActions: NenCampaignAfterAction[]) => setDraft((previous) => ({ ...previous, afterActions }))

  const chooseForm = (formId: string) => {
    if (!formId) {
      setActions(actions.filter((action) => action.kind !== 'open_form'))
      return
    }
    const form = forms.find((candidate) => candidate.id === formId)
    if (!form) return
    const next: NenCampaignAfterAction = { kind: 'open_form', formId: form.id, formName: form.name, buttonLabel: '感想を書く（30秒）' }
    setDraft((previous) => ({
      ...previous,
      afterActions: [...actions.filter((action) => action.kind !== 'open_form'), next],
      buttonLabel: next.buttonLabel,
      buttonUrl: openFormUrl(selectedAccount?.liffId, form.id) ?? merged.buttonUrl,
    }))
  }

  const chooseMileage = (value: string) => {
    const others = actions.filter((action) => action.kind !== 'award_mileage')
    if (!value) { setActions(others); return }
    setActions([...others, { kind: 'award_mileage', amount: Number(value), trigger: 'form_submitted' }])
  }

  const searchFriends = async () => {
    const query = testSearch.trim()
    setNotice('')
    try {
      const response = await api.friends.list({ search: query, accountId: selectedAccountId ?? undefined, limit: 5 })
      if (!response.success) throw new Error('failed')
      const loginUsers = testLoginUsers.filter((candidate) => candidate.displayName.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
      const friends = response.data.items.map((friend) => ({ id: friend.id, displayName: friend.displayName }))
      const next = [...new Map([...loginUsers, ...friends].map((candidate) => [candidate.id, candidate])).values()]
      setTestCandidates(next)
      setTestTarget(next[0]?.id ?? '')
      if (next.length === 0) setNotice('その名前の相手は見つかりませんでした。')
    } catch {
      setNotice('相手を探せませんでした。通信を確認してもう一度お試しください。')
    }
  }

  const sendTest = async () => {
    if (!selectedAccountId || !testTarget) return
    setTesting(true)
    setError('')
    setNotice('')
    try {
      await api.nenCampaigns.testSend({
        campaignKey, accountId: selectedAccountId, friendId: testTarget,
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
  const bodyRemaining = NEN_CAMPAIGN_BODY_MAX_LENGTH - bodyCheck.length

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
    if (mileageAction && (!Number.isInteger(mileageAction.amount) || mileageAction.amount < 1 || mileageAction.amount > 1_000_000)) {
      setError('付けるマイルは1〜1,000,000の整数で入力してください')
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
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409 && caught.code === 'VERSION_CONFLICT') {
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
      setError(describeSaveFailure(caught))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <ListState kind="loading" title="NEN配信を読み込んでいます" />
  if (!setting) return <ListState kind="error" title={error || 'この配信が見つかりませんでした'} />

  const time = merged.deliveryTime.slice(0, 5)
  const timing = `${formatCampaignTiming({ campaignKey, delayDays: merged.delayDays, deliveryTime: time })} に届きます`
  const trigger = triggerShort(setting)
  const back = <Link href="/nen-campaigns" className={styles.backLink}><ChevronLeft size={14} aria-hidden="true" />NEN配信へ</Link>
  const accountName = selectedAccount?.displayName || selectedAccount?.name || '公式アカウント'
  const kindIsRich = Boolean(merged.imageUrl)
  // 下の帯の左は短く（長いと折り返して帯が高くなる）。くわしい決めごとは見出しの説明に書く。
  const status = merged.isEnabled
    ? pendingCount !== null && pendingCount > 0 ? `動いています・配信待ち ${formatNumber(pendingCount)}通は前の中身のまま` : '動いています'
    : '停止中です（保存しても送り始めません）'

  const preview = (
    <div className={styles.side}>
      <LinePreview accountName={accountName} caption={timing}>
        <LinePreviewMessage accountName={accountName} avatar={accountName.slice(0, 1)} time={isBirthday ? '10:00' : time}>
          <span className={styles.bubbleText}>{`${previewBody(merged.bodyText)}${merged.buttonLabel ? `\n▶ ${merged.buttonLabel}` : ''}`}</span>
        </LinePreviewMessage>
      </LinePreview>
      <section className={styles.sideCard} aria-labelledby="nen-edit-tips">
        <h2 className={styles.sideTitle} id="nen-edit-tips">気をつけること（一般的な目安）</h2>
        <ul className={styles.sideText}>
          <li>・吹き出しは少なめが安心です</li>
          <li>・届く時間は「配信の反応」で確かめられます</li>
          <li>・誕生日配信は 10:00 に固定です</li>
        </ul>
      </section>
      <section className={styles.sideCard} aria-labelledby="nen-edit-cannot">
        <h2 className={styles.sideTitle} id="nen-edit-cannot">この画面でできないこと</h2>
        <p className={`${styles.sideText} ${styles.sideTextTight}`}>記事の本文を書く（外部サイトで書きます）・出しかたの細かい設定（一斉配信と同じ）</p>
      </section>
      {canEdit ? (
        <section className={`${styles.sideCard} ${styles.sideCardTest}`} aria-labelledby="nen-edit-test">
          <h2 className={`${styles.sideTitle} ${styles.sideTitleSmall}`} id="nen-edit-test">自分にテストを送る</h2>
          <SearchField
            aria-label="テスト送信の相手を名前で探す"
            placeholder="テスト送信の相手を名前で探す"
            value={testSearch}
            onChange={setTestSearch}
            onClear={() => setTestSearch('')}
            onKeyDown={(event) => { if (event.key === 'Enter') void searchFriends() }}
          />
          <span className={styles.fullButton}>
            <Button type="button" disabled={testing || !testTarget} busy={testing} busyLabel="送っています…" title={testTarget ? undefined : '先に相手を名前で探してください'} onClick={() => void sendTest()}>
              <Send size={15} aria-hidden="true" />{testCandidates.length === 1 ? `${testCandidates[0].displayName ?? '名前なし'}へテストを送る` : 'テストを送る'}
            </Button>
          </span>
          {/* 相手が2人以上いるときだけ、送る相手を選ぶ欄を出す（ボタンの下：上の並びを動かさない）。 */}
          {testCandidates.length > 1 ? (
            <Select aria-label="テスト送信の相手" size="full" value={testTarget} onChange={setTestTarget} options={testCandidates.map((candidate) => ({ value: candidate.id, label: `送る相手：${candidate.displayName ?? '名前なし'}` }))} />
          ) : null}
        </section>
      ) : null}
    </div>
  )

  return (
    <CreatePage
      boardId="w5pwG"
      title={`${setting.label}（配信を直す）`}
      description={`${timing}。保存した新しい中身は次のきっかけから使われ、すでに配信待ちの分は予約したときの中身のまま届きます。`}
      identity={back}
      preview={preview}
      status={status}
      footerActions={canEdit ? (
        <>
          <Button href="/nen-campaigns">キャンセル</Button>
          <Button type="button" variant="primary" onClick={() => void save()} disabled={saving || !bodyCheck.fits} busy={saving} busyLabel="保存しています…"><Save size={15} aria-hidden="true" />配信内容を保存する</Button>
        </>
      ) : <Button href="/nen-campaigns">一覧へ戻る</Button>}
    >
      {!canEdit ? (
        <div className={styles.viewerBand} role="status">
          <Eye size={16} aria-hidden="true" />
          <span>閲覧のみで見ています。配信を直すのは管理者に頼んでください。</span>
        </div>
      ) : null}
      {error ? <Notice tone="danger" message={error} /> : null}
      {notice ? <Notice tone="success" message={notice} /> : null}
      {formIssueBanner ? <Notice tone="warn" message={formIssueBanner} /> : null}

      <section className={styles.card} aria-labelledby="nen-edit-flow">
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle} id="nen-edit-flow">配信フロー</h2>
          <p className={styles.cardNote}>{formAction && mileageAction ? '回答フォームへの送信をきっかけにマイルを付けます' : 'きっかけから届くまでの流れです'}</p>
        </div>
        <ol className={styles.flow} aria-label="配信フロー">
          <li className={styles.flowStep}><Package size={13} aria-hidden="true" />{trigger}</li>
          <li className={styles.flowStep}><CalendarClock size={13} aria-hidden="true" />{isBirthday ? '3日前 10:00' : `${merged.delayDays}日後 ${time}`}</li>
          <li className={styles.flowStep} data-current=""><Send size={13} aria-hidden="true" />{setting.label}</li>
          {formAction ? <li className={styles.flowStep}><ClipboardList size={13} aria-hidden="true" />フォームに答えた</li> : null}
          {mileageAction?.kind === 'award_mileage' ? <li className={styles.flowStep}><Coins size={13} aria-hidden="true" />{`${formatNumber(mileageAction.amount)} マイル`}</li> : null}
        </ol>
      </section>

      <section className={styles.card} aria-labelledby="nen-edit-when">
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle} id="nen-edit-when">いつ送りますか</h2>
          <p className={styles.cardNote}>このアカウントでの反応がいい時間帯は、分析の「配信の反応」で見られます</p>
        </div>
        <div className={styles.row}>
          <div className={styles.field}>
            <span className={styles.labelSmall}>きっかけ</span>
            {isBirthday ? (
              <StaticBox label="きっかけ" value="ペットの誕生日の3日前" />
            ) : !canEdit ? (
              <StaticBox label="きっかけ" value={merged.delayDays === 0 ? `${trigger}日（当日）` : `${trigger}日から ${merged.delayDays} 日後`} />
            ) : (
              <Select
                aria-label="きっかけからの日数"
                size="full"
                value={String(merged.delayDays)}
                onChange={(value) => setDraft((previous) => ({ ...previous, delayDays: Number(value) }))}
                options={withCurrent(DELAY_CHOICES, merged.delayDays).map((days) => ({ value: String(days), label: days === 0 ? `${trigger}日（当日）` : `${trigger}日から ${days} 日後` }))}
              />
            )}
          </div>
          <div className={styles.field}>
            <span className={styles.labelSmall}>送る時刻</span>
            {isBirthday ? (
              <StaticBox label="送る時刻" value="10:00（固定）" />
            ) : !canEdit ? (
              <StaticBox label="送る時刻" value={time} />
            ) : (
              <Select aria-label="送る時刻" size="full" value={time} onChange={(value) => setDraft((previous) => ({ ...previous, deliveryTime: value }))} options={timeChoices(time).map((value) => ({ value, label: value }))} />
            )}
          </div>
          <div className={styles.field}>
            <span className={styles.labelSmall}>届かない日</span>
            {/* 届かない日を決める口はまだ無い。毎日送る（今の作りのまま）。 */}
            <StaticBox label="届かない日" value="なし（毎日送る）" />
          </div>
        </div>
        {isBirthday ? (
          <p className={styles.cardNote}>誕生日のきっかけ・日時は配信の実行処理で固定されています。</p>
        ) : (
          <div className={styles.checks}>
            <Checkbox checked={merged.dedupWindowDays > 0} disabled={!canEdit} onCheckedChange={(checked) => setDraft((previous) => ({ ...previous, dedupWindowDays: checked ? 30 : 0 }))}>
              同じ人に何度も送らない（30日のあいだに1回だけ）
            </Checkbox>
            {merged.campaignKey === 'review_request' ? (
              <Checkbox checked={Boolean(formAction) && merged.excludeFormRespondents} disabled={!canEdit || !formAction} title={formAction ? undefined : '回答フォームをつなぐと選べます'} onCheckedChange={(checked) => setDraft((previous) => ({ ...previous, excludeFormRespondents: checked }))}>
                すでに口コミを書いた人には送らない
              </Checkbox>
            ) : null}
          </div>
        )}
      </section>

      <section className={styles.card} aria-labelledby="nen-edit-what">
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle} id="nen-edit-what">送るもの</h2>
          <p className={styles.cardNote}>この配信は1通で届きます</p>
        </div>
        {/* 届く形を選ぶ口はまだ無い。画像があればリッチメッセージ、無ければ文字だけで届く（今の作りのまま）。 */}
        <div className={styles.radios} role="radiogroup" aria-label="届く形">
          <Radio name="nen-message-kind" checked={kindIsRich} readOnly disabled={!kindIsRich} title={kindIsRich ? undefined : '画像のある配信だけがリッチメッセージになります'}>リッチメッセージ</Radio>
          <Radio name="nen-message-kind" checked={!kindIsRich} readOnly disabled={kindIsRich}>文字だけ</Radio>
        </div>
        <div className={styles.field}>
          <span className={styles.labelRow}>
            <label className={styles.labelSmall} htmlFor="nen-edit-body">配信本文</label>
            <span className={styles.labelNote}>差し込み：友だち情報欄「ペットの名前」・注文の「商品名」</span>
            {canEdit ? <button type="button" className={styles.labelAside} aria-expanded={insertOpen} onClick={() => setInsertOpen((current) => !current)}>{insertOpen ? '差し込みを閉じる' : '差し込む'}</button> : null}
          </span>
          <textarea
            id="nen-edit-body"
            ref={bodyRef}
            rows={3}
            value={merged.bodyText}
            readOnly={!canEdit}
            onChange={(event) => setDraft((previous) => ({ ...previous, bodyText: event.target.value }))}
            aria-label="配信本文"
            className={styles.textarea}
          />
          {insertOpen && canEdit ? (
            <InsertToolbar targetRef={bodyRef} value={merged.bodyText} onChange={(bodyText) => setDraft((previous) => ({ ...previous, bodyText }))} />
          ) : null}
          {!bodyCheck.fits ? (
            <p className={styles.error} role="alert">{bodyLimitLabel}字を超えています（現在{formatNumber(bodyCheck.length)}字）。短くしてください。</p>
          ) : bodyRemaining <= BODY_NOTICE_REMAINING ? (
            <p className={styles.muted}>あと{formatNumber(bodyRemaining)}字（上限{bodyLimitLabel}字。長すぎるとLINEで送れません）</p>
          ) : null}
        </div>
        <p className={styles.caution}>差し込む名前が長いと、送るときに長すぎる場合があります。1回にたくさんの吹き出しを送るとブロックされやすい傾向があります（一般的な目安）。</p>
      </section>

      <section className={styles.card} aria-labelledby="nen-edit-after">
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle} id="nen-edit-after">押されたあとにすること</h2>
          <p className={styles.cardNote}>{`メッセージの「${merged.buttonLabel?.replace(/（.*?）/, '') || 'ボタン'}」を押した人に何をするかです`}</p>
        </div>
        <div className={styles.row}>
          <div className={styles.field}>
            <span className={styles.labelSmall}>回答フォームを開かせる（任意）</span>
            {!canEdit ? <StaticBox label="回答フォーム" value={formAction?.formName ?? '開かせない'} /> : <Select
              aria-label="回答フォームを開かせる（任意）"
              size="full"
              value={formAction?.formId ?? ''}
              error={formIssueMessage ?? undefined}
              onChange={chooseForm}
              options={[
                { value: '', label: '開かせない' },
                ...(formAction && !selectedForm ? [{ value: formAction.formId, label: `${formAction.formName}（見つかりません）`, disabled: true }] : []),
                ...forms.map((form) => ({ value: form.id, label: form.isActive ? form.name : `${form.name}（公開されていません）`, disabled: !form.isActive })),
              ]}
            />}
          </div>
          <div className={styles.field}>
            <span className={styles.labelSmall}>回答後にマイルを付ける</span>
            {!canEdit ? <StaticBox label="回答後のマイル" value={mileageAction?.kind === 'award_mileage' ? `${formatNumber(mileageAction.amount)} マイル` : '付けない'} /> : <Select
              aria-label="回答後にマイルを付ける"
              size="full"
              value={mileageAction?.kind === 'award_mileage' ? String(mileageAction.amount) : ''}
              onChange={chooseMileage}
              options={[
                { value: '', label: '付けない' },
                ...withCurrent(MILEAGE_CHOICES, mileageAction?.kind === 'award_mileage' ? mileageAction.amount : MILEAGE_CHOICES[0]).map((amount) => ({ value: String(amount), label: `${formatNumber(amount)} マイル` })),
              ]}
            />}
          </div>
        </div>
        <p className={styles.chain}>つながる先：→ 回答フォーム　→ マイル　→ EC連携　→ 友だち属性</p>
      </section>
      <UnsavedLeaveDialog open={leaveTarget !== null} onConfirm={confirmLeave} onCancel={cancelLeave} />
    </CreatePage>
  )
}
