'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { api, type NenCampaignSetting } from '@/lib/api'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'
import { Field, inputClass } from '@/components/shared/form-controls'
import { formatCampaignTiming } from '../campaign-display'
import { usePageTitle } from '@/components/shell/page-chrome'

/**
 * NENコラムを編集する（設計 V2 9-1-1）。
 *
 * 設計は「どの配信か → いつ届けるか → 誰に届けるか → 今回の内容」の4節。
 * `nen_campaign_settings` にあるのは、きっかけ・何日後・時刻・題・本文・
 * 画像・ボタン・動かすかどうか。設計の**毎週金曜10:00のような曜日指定**と、
 * **タグで絞り込む**は、持っている列と合わない。
 *
 * この配信は「きっかけが起きた N日後の指定時刻」に動く。毎週ではない。
 * 曜日の欄を出すと、設定したのに毎週来ない配信ができるので出していない。
 */

const CATEGORY_LABEL: Record<NenCampaignSetting['category'], string> = {
  transactional: '注文まわり',
  follow_up: 'フォロー',
  column: 'コラム',
  birthday: '誕生日',
}

const TRIGGER_LABEL: Record<string, string> = {
  'ec.order.confirmed': '注文を受け付けたとき',
  'ec.order.shipped': '商品を発送したとき',
  'ec.order.delivered': '商品が届いたとき',
  'pet.birthday': 'ペットの誕生日',
}

function triggerLabel(setting: NenCampaignSetting): string {
  if (setting.campaignKey === 'birthday_coupon') return 'ペットの誕生日'
  if (!setting.triggerEvent) return '手動で送る'
  return TRIGGER_LABEL[setting.triggerEvent] ?? '登録済みのきっかけ'
}

export default function CampaignEditor({ campaignKey }: { campaignKey: string }) {
  usePageTitle('NEN配信を編集する')
  const [setting, setSetting] = useState<NenCampaignSetting | null>(null)
  const [draft, setDraft] = useState<Partial<NenCampaignSetting>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [testSearch, setTestSearch] = useState('')
  const [testCandidates, setTestCandidates] = useState<Array<{ id: string; displayName: string | null }>>([])
  const [testLoginUsers, setTestLoginUsers] = useState<Array<{ id: string; displayName: string }>>([])
  const [testing, setTesting] = useState(false)
  const { selectedAccountId } = useAccount()

  useEffect(() => {
    if (!selectedAccountId) {
      setLoading(false)
      setError('LINEアカウントを選んでください')
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const res = await api.nenCampaigns.settings(selectedAccountId)
        if (cancelled) return
        if (res.success) {
          const found = res.data.find((s) => s.campaignKey === campaignKey) ?? null
          setSetting(found)
          if (found) setDraft(found)
          if (!found) setError('この配信が見つかりませんでした')
        }
      } catch {
        if (!cancelled) setError('読み込みに失敗しました')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
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

  /** テスト送信の相手を名前で探す。宛先を選ばないと送れない。 */
  const searchFriends = async () => {
    const query = testSearch.trim()
    const res = await api.friends.list({ search: query, accountId: selectedAccountId ?? undefined, limit: 5 })
    if (res.success) {
      const matchingLoginUsers = testLoginUsers.filter((candidate) => candidate.displayName.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
      const found = res.data.items.map((friend) => ({ id: friend.id, displayName: friend.displayName }))
      setTestCandidates([...new Map([...matchingLoginUsers, ...found].map((candidate) => [candidate.id, candidate])).values()])
    }
  }

  const sendTest = async (friendId: string) => {
    if (!selectedAccountId) {
      setError('アカウントを選んでください')
      return
    }
    setTesting(true)
    setError('')
    setNotice('')
    try {
      await api.nenCampaigns.testSend({
        campaignKey: campaignKey,
        accountId: selectedAccountId,
        friendId,
      })
      setNotice('テスト送信しました')
      setTestCandidates([])
    } catch {
      setError('テスト送信できませんでした')
    } finally {
      setTesting(false)
    }
  }

  const save = async () => {
    if (!setting || !selectedAccountId) return
    if (!merged.title?.trim()) {
      setError('タイトルを入力してください')
      return
    }
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const res = await api.nenCampaigns.updateSetting(selectedAccountId, setting.campaignKey, {
        isEnabled: merged.isEnabled,
        title: merged.title,
        bodyText: merged.bodyText,
        delayDays: merged.delayDays,
        deliveryTime: merged.deliveryTime,
        buttonLabel: merged.buttonLabel,
        buttonUrl: merged.buttonUrl,
        imageUrl: merged.imageUrl,
      })
      if (!res.success) {
        setError('保存に失敗しました')
        return
      }
      setSetting(merged)
      setNotice('保存しました')
    } catch {
      setError('保存できませんでした。通信状態を確認して、もう一度お試しください。')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-8 text-center text-sm">
        読み込み中...
      </div>
    )
  }

  if (!setting) {
    return (
      <div>

        <p className="text-ink-faint bg-canvas rounded-card border-hairline border p-8 text-center text-sm">
          {error || 'この配信が見つかりませんでした。'}
          <Link href="/nen-campaigns" className="text-accent ml-1 hover:underline">
            NEN配信へ戻る
          </Link>
        </p>
      </div>
    )
  }

  return (
    <div>
      <nav className="text-ink-faint mb-2 text-xs" data-design="Crumb">
        <Link href="/nen-campaigns" className="hover:underline">
          NEN配信
        </Link>
        <span className="mx-1.5">/</span>
        <span>編集</span>
      </nav>

      <div data-design="Head">
        <Header
          title={`${setting.label}を編集する`}
          description="定期的に届けるコラムの内容と送り方を設定します。"
          action={
            <div className="flex flex-wrap gap-2">
              {/* 宛先を選ばないと送れない。名前で探して選ぶ。 */}
              <div className="flex items-center gap-1">
                <input
                  type="search"
                  value={testSearch}
                  onChange={(e) => setTestSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void searchFriends()
                  }}
                  placeholder="テスト送信の相手を名前で探す"
                  aria-label="テスト送信の相手を名前で探す"
                  className="border-hairline rounded-control border px-3 py-2 text-sm"
                />
                <button
                  onClick={() => void searchFriends()}
                  disabled={!testSearch.trim() || testing}
                  className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-control border px-3 py-2 text-sm font-medium disabled:opacity-40"
                >
                  探す
                </button>
              </div>
              <Link
                href="/nen-campaigns"
                className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-control border px-3 py-2 text-sm font-medium"
              >
                キャンセル
              </Link>
              <button
                onClick={save}
                disabled={saving}
                className="bg-accent-deep text-on-accent hover:brightness-92 rounded-control px-4 py-2 text-sm font-medium transition-colors disabled:opacity-40"
              >
                {saving ? '保存中...' : '変更を保存'}
              </button>
            </div>
          }
        />
      </div>

      {error && (
        <div className="bg-danger-bg border-danger-bg text-danger mb-4 rounded-lg border p-4 text-sm">
          {error}
        </div>
      )}
      {notice && <p className="text-success mb-4 text-sm">{notice}</p>}

      {testCandidates.length > 0 && (
        <div className="bg-canvas rounded-card border-hairline mb-4 border p-3">
          <p className="text-ink-secondary mb-2 text-xs font-medium">テスト送信の相手を選ぶ</p>
          <ul className="flex flex-wrap gap-2">
            {testCandidates.map((f) => (
              <li key={f.id}>
                <button
                  onClick={() => void sendTest(f.id)}
                  disabled={testing}
                  className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-pill border px-3 py-1.5 text-xs disabled:opacity-40"
                >
                  {f.displayName}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
        <div data-design="Body" className="space-y-5">
          {/* ---- 1 ---- */}
          <section className="bg-canvas rounded-card border-hairline space-y-4 border p-5">
            <h2 className="text-ink text-sm font-bold">
              <span className="bg-accent-soft text-accent rounded-pill mr-2 px-2 py-0.5 text-xs">
                1
              </span>
              どの配信か
            </h2>
            <Field label="配信名">
              <p className="border-hairline text-ink rounded-control border px-3 py-2 text-sm">
                {setting.label}
                <span className="text-ink-faint ml-2 text-xs">
                  {CATEGORY_LABEL[setting.category]}
                </span>
              </p>
            </Field>
            {/* 配信ごとに送るアカウントを選ぶ列が無い。 */}
            <Field label="対象アカウント" note="配信ごとにアカウントを分ける設定は、まだありません。">
              <p className="border-hairline text-ink-faint rounded-control border px-3 py-2 text-sm">
                既定のアカウント
              </p>
            </Field>
          </section>

          {/* ---- 2 ---- */}
          <section className="bg-canvas rounded-card border-hairline space-y-4 border p-5">
            <h2 className="text-ink text-sm font-bold">
              <span className="bg-accent-soft text-accent rounded-pill mr-2 px-2 py-0.5 text-xs">
                2
              </span>
              いつ届けるか
            </h2>
            <p className="text-ink-faint text-xs leading-relaxed">
              {setting.campaignKey === 'birthday_coupon'
                ? 'ペットの誕生日の3日前、10:00に届きます。この日時は誕生日配信の実行処理で固定されています。'
                : 'この配信は「きっかけが起きたあと、指定した日数が経った日の指定時刻」に届きます。毎週きまった曜日・毎月きまった日で送る形は、まだ保存する場所がありません。'}
            </p>
            <Field label="きっかけ">
              <p className="border-hairline text-ink rounded-control border px-3 py-2 text-sm">
                {triggerLabel(setting)}
              </p>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              {setting.campaignKey === 'birthday_coupon' ? (
                <>
                  <Field label="送る日">
                    <p className="border-hairline text-ink rounded-control border px-3 py-2 text-sm">
                      誕生日の3日前
                    </p>
                  </Field>
                  <Field label="時刻">
                    <p className="border-hairline text-ink rounded-control border px-3 py-2 text-sm">
                      10:00（固定）
                    </p>
                  </Field>
                </>
              ) : (
                <>
                  <Field label="何日後に送るか" htmlFor="nc-delay" note="0 なら当日です。">
                    <input
                      id="nc-delay"
                      type="number"
                      min={0}
                      value={merged.delayDays ?? 0}
                      onChange={(e) => setDraft((p) => ({ ...p, delayDays: Number(e.target.value) }))}
                      className={`${inputClass} w-32 tabular-nums`}
                    />
                  </Field>
                  <Field label="時刻" htmlFor="nc-time">
                    <input
                      id="nc-time"
                      type="time"
                      value={(merged.deliveryTime ?? '10:00').slice(0, 5)}
                      onChange={(e) => setDraft((p) => ({ ...p, deliveryTime: e.target.value }))}
                      className={`${inputClass} w-40`}
                    />
                  </Field>
                </>
              )}
            </div>
          </section>

          {/* ---- 3 ---- */}
          <section className="bg-canvas rounded-card border-hairline space-y-3 border p-5">
            <h2 className="text-ink text-sm font-bold">
              <span className="bg-accent-soft text-accent rounded-pill mr-2 px-2 py-0.5 text-xs">
                3
              </span>
              誰に届けるか
            </h2>
            {/* 宛先を絞る列が無い。きっかけに当たった人にだけ届く。 */}
            <p className="text-ink-faint text-xs leading-relaxed">
              きっかけに当たった友だちに届きます。タグでさらに絞り込む設定は、まだ保存する場所がありません。
            </p>
          </section>

          {/* ---- 4 ---- */}
          <section className="bg-canvas rounded-card border-hairline space-y-4 border p-5">
            <h2 className="text-ink text-sm font-bold">
              <span className="bg-accent-soft text-accent rounded-pill mr-2 px-2 py-0.5 text-xs">
                4
              </span>
              今回の内容
            </h2>

            <Field
              label="画像を添える"
              htmlFor="nc-image"
              note="本文の上に1枚表示されます。画像のURLを入れてください。"
            >
              <input
                id="nc-image"
                type="url"
                value={merged.imageUrl ?? ''}
                onChange={(e) => setDraft((p) => ({ ...p, imageUrl: e.target.value || null }))}
                placeholder="https://example.com/column_08.jpg"
                className={inputClass}
              />
            </Field>

            <Field label="タイトル" htmlFor="nc-title" required>
              <input
                id="nc-title"
                type="text"
                value={merged.title ?? ''}
                onChange={(e) => setDraft((p) => ({ ...p, title: e.target.value }))}
                className={inputClass}
              />
            </Field>

            <Field label="本文" htmlFor="nc-body">
              <textarea
                id="nc-body"
                rows={6}
                value={merged.bodyText ?? ''}
                onChange={(e) => setDraft((p) => ({ ...p, bodyText: e.target.value }))}
                className={`${inputClass} resize-y`}
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="ボタンの文字" htmlFor="nc-btn">
                <input
                  id="nc-btn"
                  type="text"
                  value={merged.buttonLabel ?? ''}
                  onChange={(e) => setDraft((p) => ({ ...p, buttonLabel: e.target.value || null }))}
                  placeholder="続きを読む"
                  className={inputClass}
                />
              </Field>
              <Field label="ボタンの行き先" htmlFor="nc-url">
                <input
                  id="nc-url"
                  type="url"
                  value={merged.buttonUrl ?? ''}
                  onChange={(e) => setDraft((p) => ({ ...p, buttonUrl: e.target.value || null }))}
                  placeholder="https://nen-petfood.com/column/…"
                  className={inputClass}
                />
              </Field>
            </div>

            <label className="text-ink-secondary flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={merged.isEnabled ?? false}
                onChange={(e) => setDraft((p) => ({ ...p, isEnabled: e.target.checked }))}
              />
              <span>
                この配信を動かす
                <span className="text-ink-faint block text-xs">
                  オフにすると、次回以降の自動送信を止めます。
                </span>
              </span>
            </label>
          </section>
        </div>

        {/* ---- プレビュー ---- */}
        <aside data-design="Right" className="space-y-4">
          <section className="bg-canvas rounded-card border-hairline border p-4">
            <h2 className="text-ink mb-2 text-sm font-bold">届き方のプレビュー</h2>
            <p className="text-ink-faint mb-2 text-xs">
              {formatCampaignTiming(merged)}
            </p>
            <div className="bg-canvas-sunken rounded-card space-y-2 p-3">
              {merged.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- 外部URLの見本。静的アセットではない
                <img
                  src={merged.imageUrl}
                  alt=""
                  className="rounded-control max-h-32 w-full object-cover"
                />
              )}
              <p className="text-ink text-sm font-bold">{merged.title || '（タイトル未入力）'}</p>
              <p className="text-ink-secondary text-xs leading-relaxed whitespace-pre-wrap">
                {merged.bodyText || '（本文未入力）'}
              </p>
              {merged.buttonLabel && (
                <p className="border-hairline rounded-control text-accent border py-1.5 text-center text-xs">
                  {merged.buttonLabel}
                </p>
              )}
            </div>
          </section>

          {/* 配信ごとの送信・開封を数える経路が無い。 */}
          <section className="bg-canvas rounded-card border-hairline border p-4">
            <h2 className="text-ink mb-2 text-sm font-bold">前回の結果</h2>
            <p className="text-ink-faint text-xs leading-relaxed">
              配信ごとの送信数・開封数を数える経路がまだありません。送信の待ち行列は
              <Link href="/nen-campaigns" className="text-accent mx-1 hover:underline">
                フォロー配信
              </Link>
              で見られます。
            </p>
          </section>
        </aside>
      </div>
    </div>
  )
}
