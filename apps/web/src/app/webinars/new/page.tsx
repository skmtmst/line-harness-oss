'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Button from '@/components/shared/button'
import SelectField from '@/components/shared/select-field'
import StepTrail from '@/components/shared/step-trail'
import StickyBar from '@/components/shared/sticky-bar'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import { webinarApi, type WebinarFolder } from '@/lib/api'

type DeliveryKind = 'on-demand' | 'scheduled'

export default function NewWebinarPage() {
  usePageTitle('ウェビナーを作成')
  const router = useRouter()
  const { selectedAccountId } = useAccount()
  const [title, setTitle] = useState('')
  const [deliveryKind, setDeliveryKind] = useState<DeliveryKind>('on-demand')
  const [folders, setFolders] = useState<WebinarFolder[]>([])
  const [folderId, setFolderId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!selectedAccountId) {
      setFolders([])
      setFolderId('')
      return
    }
    webinarApi.folders(selectedAccountId)
      .then((response) => setFolders(response.success && Array.isArray(response.data) ? response.data : []))
      .catch(() => setFolders([]))
  }, [selectedAccountId])

  async function save(next: 'list' | 'video') {
    if (!selectedAccountId) {
      setError('上のバーでLINE公式アカウントを選んでください')
      return
    }
    if (!title.trim()) {
      setError('ウェビナー名を入力してください')
      return
    }

    setSaving(true)
    setError(null)
    try {
      const created = await webinarApi.create({
        accountId: selectedAccountId,
        title: title.trim(),
        status: 'draft',
        slug: `webinar-${Date.now()}`,
        videoPrefix: null,
        durationSeconds: 120 * 60,
        schedule: [],
        cta: null,
        folderId: folderId || null,
        deliveryKind: deliveryKind === 'on-demand' ? 'on_demand' : 'scheduled',
        viewingCondition: { kind: 'registered', label: '申込者向け' },
      })
      router.push(next === 'video' ? `/webinars/edit?id=${created.data.id}` : '/webinars')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '下書きを保存できませんでした。もう一度お試しください。')
      setSaving(false)
    }
  }

  return (
    <main data-design-node="lvaY5" className="mx-auto max-w-screen-2xl px-6 pb-28 pt-4">
      <nav data-design="Crumb" className="text-ink-faint mb-5 text-xs">
        <Link href="/webinars" className="text-action hover:underline">← ウェビナー一覧</Link>
      </nav>

      <StepTrail
        label="ウェビナー作成の進み方"
        items={[
          { label: '基本設定', state: 'current' },
          { label: '動画', state: 'todo' },
          { label: 'CTA・フォーム', state: 'todo' },
          { label: '通知', state: 'todo' },
          { label: '確認', state: 'todo' },
        ]}
      />

      {error ? (
        <p className="bg-danger-bg text-danger mt-4 rounded-control border border-danger p-3 text-sm" role="alert">{error}</p>
      ) : null}

      <div className="mt-4 grid items-start gap-4 xl:grid-cols-4">
        <div className="space-y-4 xl:col-span-3">
          <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card">
            <h2 className="text-ink text-base font-bold">基本設定</h2>
            <p className="text-ink-faint mt-1 text-xs">管理名と公開ページの基本情報を設定します。</p>
            <div className="mt-4 grid gap-3 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <label htmlFor="webinar-title" className="text-ink-secondary mb-1 block text-sm font-medium">
                  ウェビナー名 <span className="bg-danger-bg text-danger rounded-pill ml-1 px-1.5 py-0.5 text-micro">必須</span>
                </label>
                <input
                  id="webinar-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="NEN活用スタートセミナー"
                  className="border-hairline rounded-control focus:ring-accent w-full border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="webinar-folder" className="text-ink-secondary mb-1 block text-sm font-medium">フォルダ</label>
                <SelectField
                  id="webinar-folder"
                  value={folderId}
                  onChange={(event) => setFolderId(event.target.value)}
                  options={[
                    { value: '', label: '未分類' },
                    ...folders.map((folder) => ({ value: folder.id, label: `${folder.name}（${folder.count}件）` })),
                  ]}
                />
              </div>
            </div>
          </section>

          <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card">
            <h2 className="text-ink text-base font-bold">開催形式</h2>
            <p className="text-ink-faint mt-1 text-xs">公開方法と視聴形式を選びます。</p>
            <div className="mt-4 space-y-3">
              <label className={`border-hairline flex cursor-pointer items-center gap-4 rounded-control border p-4 ${deliveryKind === 'on-demand' ? 'border-accent bg-accent-soft' : ''}`}>
                <input type="radio" name="delivery-kind" checked={deliveryKind === 'on-demand'} onChange={() => setDeliveryKind('on-demand')} />
                <span className="text-accent text-xl">♙</span>
                <span><strong className="text-ink block text-sm">オンデマンド配信</strong><span className="text-ink-faint mt-1 block text-xs">録画動画をいつでも視聴</span></span>
                <span className="text-action ml-auto" aria-hidden="true">›</span>
              </label>
              <label className={`border-hairline flex cursor-pointer items-center gap-4 rounded-control border p-4 ${deliveryKind === 'scheduled' ? 'border-accent bg-accent-soft' : ''}`}>
                <input type="radio" name="delivery-kind" checked={deliveryKind === 'scheduled'} onChange={() => setDeliveryKind('scheduled')} />
                <span className="text-action text-xl">⌑</span>
                <span><strong className="text-ink block text-sm">日時指定配信</strong><span className="text-ink-faint mt-1 block text-xs">指定日時に公開開始</span></span>
                <span className="text-action ml-auto" aria-hidden="true">›</span>
              </label>
            </div>
            <p className="text-ink-faint mt-3 text-xs">選んだ開催形式は下書き版へ保存され、動画設定でも変更できます。</p>
          </section>
        </div>

        <aside className="space-y-4">
          <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card">
            <h2 className="text-ink text-sm font-bold">設定サマリー</h2>
            <dl className="divide-hairline mt-4 divide-y text-xs">
              <div className="flex justify-between py-3"><dt className="text-ink-faint">状態</dt><dd className="text-ink font-semibold">下書き</dd></div>
              <div className="flex justify-between py-3"><dt className="text-ink-faint">動画</dt><dd className="text-ink font-semibold">未設定</dd></div>
              <div className="flex justify-between py-3"><dt className="text-ink-faint">公開</dt><dd className="text-ink font-semibold">非公開</dd></div>
            </dl>
            <p className="text-ink mt-3 text-xs font-semibold">タグ「配信済み」は確認画面で追加できます</p>
          </section>

          <section className="bg-info rounded-card p-4 text-on-accent shadow-card">
            <h2 className="text-center text-sm font-bold">LINEプレビュー</h2>
            <p className="mx-auto mt-3 w-fit rounded-pill bg-ink/20 px-3 py-1 text-micro">実際のLINE表示に近いプレビューです</p>
            <div className="bg-canvas text-ink mt-4 min-h-12 rounded-control p-4 text-sm font-medium">
              {title.trim() ? `${title.trim()}へようこそ。` : 'ウェビナー名を入れると、案内文をここで確認できます。'}
            </div>
            <div className="mt-52" aria-hidden="true" />
          </section>
          <div className="flex gap-2">
            <Button disabled title="下書き保存後に使えます">テスト送信</Button>
            <Button disabled title="公開後に使えます">公開ページを見る</Button>
          </div>
        </aside>
      </div>

      <StickyBar
        status="下書き（まだ誰にも公開されません）"
        actions={(
          <>
            <Button disabled={saving} onClick={() => void save('list')}>{saving ? '保存中…' : '下書き保存'}</Button>
            <Button variant="primary" disabled={saving} onClick={() => void save('video')}>動画設定へ</Button>
          </>
        )}
      />
    </main>
  )
}
