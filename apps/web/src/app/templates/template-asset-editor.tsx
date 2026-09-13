'use client'

import Link from 'next/link'
import { useState } from 'react'
import { api, type BroadcastAssetKind } from '@/lib/api'
import Button from '@/components/shared/button'
import StickyBar from '@/components/shared/sticky-bar'
import { TextField } from '@/components/shared/text-field'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'

type AssetKind = Extract<BroadcastAssetKind, 'rich_message' | 'coupon' | 'research'>

const META: Record<AssetKind, { title: string; folder: string }> = {
  rich_message: { title: 'リッチメッセージ', folder: '03_販促・クーポン' },
  coupon: { title: 'クーポン', folder: '03_販促・クーポン' },
  research: { title: 'リサーチ', folder: '02_健康フォロー' },
}

function Field({ label, children, note }: { label: string; children: React.ReactNode; note?: string }) {
  return (
    <label className="text-label block font-semibold text-ink-secondary">
      {label}
      {children}
      {note ? <span className="text-caption mt-1 block font-normal text-ink-faint">{note}</span> : null}
    </label>
  )
}

export default function TemplateAssetEditor({ kind, visual = false }: { kind: AssetKind; visual?: boolean }) {
  const meta = META[kind]
  usePageTitle(`${meta.title}を作る`)
  const { selectedAccountId } = useAccount()
  const [name, setName] = useState(visual ? ({ rich_message: '夏のキャンペーン告知', coupon: '夏の20%オフ', research: '定期便のご満足度' }[kind]) : '')
  const [folder, setFolder] = useState(visual ? meta.folder : '未分類')
  const [description, setDescription] = useState(visual ? (kind === 'coupon' ? '会計時にこの画面をご提示ください。他の割引との併用はできません。' : kind === 'research' ? '来月も定期便を続けたいと思いますか？' : '') : '')
  const [imageUrl, setImageUrl] = useState('')
  const [shape, setShape] = useState('3')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const save = async () => {
    if (!selectedAccountId) return setError('上のバーでLINE公式アカウントを選んでください。')
    if (!name.trim()) return setError(`${meta.title}名を入力してください。`)
    setSaving(true)
    setError('')
    const payload = kind === 'rich_message'
      ? { imageUrl, shape, tapAreas: [{ label: 'A', action: 'タグ「夏CP」を付ける' }, { label: 'B', action: 'キャンペーンページを開く' }] }
      : kind === 'coupon'
        ? { description, startsAt: '2026-08-25T00:00', endsAt: '2026-09-30T23:59', oncePerFriend: true, lotteryRate: 20, winnerLimit: 500 }
        : { description, questionCount: 3, answerAction: 'タグと友だち情報へ保存' }
    try {
      const result = await api.broadcastMessageAssets.create({
        lineAccountId: selectedAccountId,
        kind,
        name: name.trim(),
        payload: { ...payload, folder },
      })
      if (!result.success) {
        setError(result.error || '保存できませんでした。')
        return
      }
      // 保存後は押せなくする。二度押しで同じものが2つできるのを防ぐ。
      setSaved(true)
    } catch {
      setError('保存できませんでした。通信状態を確認して、もう一度お試しください。')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="pb-24" data-design-node={kind === 'rich_message' ? 'j9ixI' : kind === 'coupon' ? 'hsBtl' : 'J3GxEZ'}>
      <nav className="text-caption mb-4 text-ink-faint" aria-label="現在地">
        <Link href="/templates" className="text-accent hover:underline">テンプレート</Link>
        <span className="mx-2">›</span><span className="text-accent">{meta.title}</span>
        <span className="mx-2">›</span><span>新しく作る</span>
      </nav>

      {error ? <p role="alert" className="bg-danger-bg text-danger rounded-control mb-4 px-4 py-3 text-sm">{error}</p> : null}
      {saved ? <p role="status" className="bg-success-bg text-success rounded-control mb-4 px-4 py-3 text-sm">保存しました。<Link href="/templates" className="font-semibold underline">一覧へ戻る</Link></p> : null}

      <div className="flex min-w-0 flex-col gap-4 xl:flex-row">
        <main className="min-w-0 flex-1 space-y-4">
          <section className="bg-canvas border-hairline rounded-card shadow-card grid gap-4 border p-4 md:grid-cols-3">
            <div className="md:col-span-2"><Field label={`${meta.title}名　必須`}><TextField className="mt-2" value={name} onChange={(event) => setName(event.target.value)} /></Field></div>
            <Field label="フォルダ"><TextField className="mt-2" value={folder} onChange={(event) => setFolder(event.target.value)} /></Field>
          </section>

          {kind === 'rich_message' ? (
            <>
              <section className="bg-canvas border-hairline rounded-card shadow-card border p-4">
                <h2 className="font-bold text-ink">面の分け方</h2>
                <p className="text-caption mt-1 text-ink-faint">選んだ形に合わせて、下の設定が増えます</p>
                <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-6">
                  {[['1','1面'],['2v','上下2面'],['2h','左右2面'],['3','上1・下2'],['4','4面'],['6','6面']].map(([value, label]) => (
                    <Button key={value} type="button" variant={shape === value ? 'primary' : 'secondary'} onClick={() => setShape(value)}>
                      <span className="mb-2 block text-lg tracking-widest">{value === '6' ? 'A B C\nD E F' : value === '4' ? 'A B\nC D' : value.startsWith('2') ? 'A B' : value === '3' ? 'A\nB C' : 'A'}</span>{label}
                    </Button>
                  ))}
                </div>
              </section>
              <section className="bg-canvas border-hairline rounded-card shadow-card border p-4">
                <Field label="画像" note="1040 × 1040px 推奨。上下に分けるときは 1040 × 520px も選べます。">
                  <div className="border-hairline rounded-control mt-2 border border-dashed p-5 text-center">
                    <Button type="button">登録メディアから選ぶ</Button>
                    <input className="border-hairline rounded-control bg-canvas text-ink focus:ring-accent mt-3 w-full border px-3 py-2 text-sm focus:ring-2 focus:outline-none" value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} placeholder="画像URL" />
                  </div>
                </Field>
              </section>
              <section className="bg-canvas border-hairline rounded-card shadow-card border p-4">
                <div className="flex items-center justify-between"><h2 className="font-bold text-ink">押した面ごとの動き</h2><Button type="button">アクションを設定</Button></div>
                <div className="mt-3 grid gap-2 md:grid-cols-3">{['A　タグ「夏CP」を付ける','B　キャンペーンページを開く','C　アクションが未設定です'].map((text) => <div key={text} className="border-hairline rounded-control border p-3 text-sm">{text}</div>)}</div>
                <p className="text-warning mt-3 text-xs">面 C のアクションが未設定です。そのまま送ると、押しても何も起きません。</p>
              </section>
            </>
          ) : kind === 'coupon' ? (
            <>
              <section className="bg-canvas border-hairline rounded-card shadow-card grid gap-4 border p-4 md:grid-cols-2">
                <Field label="画像"><Button type="button" className="mt-2 w-full">登録メディアから選ぶ</Button><span className="text-caption mt-1 block font-normal text-ink-faint">1029 × 1029px 推奨</span></Field>
                <Field label="使える期間　必須"><div className="mt-2 flex items-center gap-2"><input className="border-hairline rounded-control bg-canvas text-ink focus:ring-accent w-full border px-3 py-2 text-sm focus:ring-2 focus:outline-none" value="2026/08/25 00:00" readOnly /><span>から</span><input className="border-hairline rounded-control bg-canvas text-ink focus:ring-accent w-full border px-3 py-2 text-sm focus:ring-2 focus:outline-none" value="2026/09/30 23:59" readOnly /></div></Field>
                <Field label="使い方のご案内（お客さまに見えます）"><textarea className="border-hairline rounded-control bg-canvas text-ink focus:ring-accent mt-2 w-full resize-y border px-3 py-2 text-sm focus:ring-2 focus:outline-none" rows={3} value={description} onChange={(event) => setDescription(event.target.value)} /></Field>
                <div className="grid gap-3 text-sm"><Field label="使える回数"><select className="border-hairline rounded-control bg-canvas text-ink focus:ring-accent mt-2 w-full border px-3 py-2 text-sm focus:ring-2 focus:outline-none"><option>1人1回だけ</option><option>期間中なら何回でも</option></select></Field><Field label="だれに見えるか"><select className="border-hairline rounded-control bg-canvas text-ink focus:ring-accent mt-2 w-full border px-3 py-2 text-sm focus:ring-2 focus:outline-none"><option>友だちだけ</option><option>リンクを知っている人</option></select></Field></div>
              </section>
              <section className="bg-canvas border-hairline rounded-card shadow-card grid gap-4 border p-4 md:grid-cols-3">
                <Field label="抽選にする"><select className="border-hairline rounded-control bg-canvas text-ink focus:ring-accent mt-2 w-full border px-3 py-2 text-sm focus:ring-2 focus:outline-none"><option>する</option><option>しない</option></select></Field><Field label="当たる確率"><input className="border-hairline rounded-control bg-canvas text-ink focus:ring-accent mt-2 w-full border px-3 py-2 text-sm focus:ring-2 focus:outline-none" value="20%" readOnly /></Field><Field label="当選人数の上限"><input className="border-hairline rounded-control bg-canvas text-ink focus:ring-accent mt-2 w-full border px-3 py-2 text-sm focus:ring-2 focus:outline-none" value="500人" readOnly /></Field>
              </section>
              <section className="bg-canvas border-hairline rounded-card shadow-card border p-4"><div className="flex items-center justify-between"><h2 className="font-bold">クーポンが使われたときに実行すること</h2><Button type="button">アクションを設定</Button></div><p className="mt-3 text-sm">タグ「夏CP利用」を付ける ／ マイルを 100 付与 ／ 対応マークを「来店あり」に</p></section>
            </>
          ) : (
            <>
              <section className="bg-canvas border-hairline rounded-card shadow-card grid gap-4 border p-4 md:grid-cols-3"><Field label="受付の開始"><input className="border-hairline rounded-control bg-canvas text-ink focus:ring-accent mt-2 w-full border px-3 py-2 text-sm focus:ring-2 focus:outline-none" value="2026/08/25 10:00" readOnly /></Field><Field label="受付の終了"><input className="border-hairline rounded-control bg-canvas text-ink focus:ring-accent mt-2 w-full border px-3 py-2 text-sm focus:ring-2 focus:outline-none" value="2026/09/07 23:59" readOnly /></Field><Field label="答えてもらう人"><input className="border-hairline rounded-control bg-canvas text-ink focus:ring-accent mt-2 w-full border px-3 py-2 text-sm focus:ring-2 focus:outline-none" value="タグ「定期便」を持つ人（1,284人）" readOnly /></Field></section>
              <section className="bg-canvas border-hairline rounded-card shadow-card border p-4"><div className="flex items-center justify-between"><div><h2 className="font-bold">質問（上から順に出ます）</h2><p className="text-caption mt-1 text-ink-faint">3 / 10 問</p></div><Button type="button">質問を追加（あと7問）</Button></div><div className="mt-3 grid gap-2">{['1　1つだけ選ぶ　来月も定期便を続けたいと思いますか？','2　いくつでも選ぶ　よく使っている商品を教えてください','3　自由に書く　改善してほしいところがあれば教えてください'].map((text) => <Button type="button" variant="secondary" key={text}>{text}</Button>)}</div></section>
              <section className="bg-canvas border-hairline rounded-card shadow-card border p-4"><Field label="質問 1 の中身"><textarea className="border-hairline rounded-control bg-canvas text-ink focus:ring-accent mt-2 w-full resize-y border px-3 py-2 text-sm focus:ring-2 focus:outline-none" rows={3} value={description} onChange={(event) => setDescription(event.target.value)} /></Field><div className="mt-3 grid gap-2 md:grid-cols-3">{['続けたい','どちらともいえない','止めたい'].map((choice) => <input key={choice} className="border-hairline rounded-control bg-canvas text-ink focus:ring-accent w-full border px-3 py-2 text-sm focus:ring-2 focus:outline-none" value={choice} readOnly />)}</div></section>
              <section className="bg-canvas border-hairline rounded-card shadow-card border p-4"><div className="flex items-center justify-between"><h2 className="font-bold">答え終わったときに実行すること</h2><Button type="button">アクションを設定</Button></div><p className="mt-3 text-sm">お礼メッセージを送る ／ タグ「アンケート回答済み」を付ける ／ マイルを 50 付与</p></section>
            </>
          )}
        </main>

        <aside className="min-w-0 space-y-4 xl:sticky xl:top-4 xl:w-96 xl:shrink-0 xl:self-start">
          <section className="rounded-card bg-line-preview p-4 text-on-accent">
            <h2 className="text-center font-bold">LINEプレビュー</h2>
            <p className="mx-auto mt-2 w-fit rounded-pill bg-line-preview-label px-3 py-1 text-xs">{meta.title}の見え方</p>
            <div className="rounded-card mt-4 bg-canvas p-4 text-ink">
              <p className="font-bold">{name || `${meta.title}名`}</p>
              {kind === 'rich_message' ? <div className="bg-canvas-sunken mt-3 grid h-44 grid-cols-2 place-items-center rounded-lg font-bold"><span>A</span><span>B</span><span className="col-span-2">C</span></div> : null}
              {kind === 'coupon' ? <><p className="mt-2 text-sm">2026/08/25 〜 2026/09/30</p><p className="mt-3 text-sm leading-relaxed">{description}</p><Button type="button" className="mt-4 w-full">クーポンを使う</Button></> : null}
              {kind === 'research' ? <><p className="mt-2 text-xs">質問 1 / 3</p><p className="mt-3 text-sm font-medium">{description}</p>{['続けたい','どちらともいえない','止めたい'].map((choice) => <p key={choice} className="border-hairline mt-2 rounded-control border p-2 text-center text-sm">{choice}</p>)}</> : null}
            </div>
            <Button type="button" className="mt-4 w-full">自分に送って確かめる</Button>
          </section>
          <section className="bg-canvas border-hairline rounded-card shadow-card border p-4 text-sm">
            <h2 className="font-bold">{kind === 'rich_message' ? 'リッチメニューとの違い' : kind === 'coupon' ? '公開したあとに見られる数' : '回答フォームとの使い分け'}</h2>
            <p className="mt-2 leading-relaxed text-ink-secondary">{kind === 'rich_message' ? 'リッチメッセージはトークに1回流れて、過去のやり取りに残ります。リッチメニューは画面の下に常に出ます。' : kind === 'coupon' ? '配った数 ／ 開いた数 ／ 使われた数 ／ 当選した数。使われた数は成果とアフィリエイトにも送れます。' : 'リサーチはLINEの中で完結する短い質問向けです。住所や画像も聞く場合は回答フォームを使います。'}</p>
          </section>
        </aside>
      </div>

      <StickyBar status={saved ? '保存しました。一覧へ戻れます。' : '下書き（まだ誰にも送られません）'} actions={<><Button href="/templates" variant="secondary">キャンセル</Button><Button type="button" variant="secondary" disabled={saving || saved} onClick={() => void save()}>下書きに保存</Button><Button type="button" variant="primary" disabled={saving || saved} onClick={() => void save()}>{saving ? '保存中…' : saved ? '保存しました' : 'テンプレートを保存'}</Button></>} />
    </div>
  )
}
