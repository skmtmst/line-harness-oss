'use client'

import { useEffect, useMemo, useState } from 'react'
import type { Scenario, Tag, TagGroup, TrafficPool, Template } from '@line-crm/shared'
import { groupTagsByFolder } from '../tag-options'
import { api } from '@/lib/api'
import CreatePage, {
  AsideCard,
  Field,
  FormSection,
  inputClass,
} from '@/components/shared/create-page'
import SelectField from '@/components/shared/select-field'

/** 流入元の情報と、友だち追加時の動きをまとめて設定する。 */

/** ref コードはURLに出る。日本語や記号を許すと /r/xxx が壊れる。 */
const REF_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/

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

  useEffect(() => {
    let cancelled = false
    void Promise.allSettled([
      api.tags.list(),
      api.scenarios.list(),
      api.pools.list(),
      api.templates.list(),
      api.tagGroups.list(),
    ]).then(([t, s, p, tp, tg]) => {
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
    })
    return () => {
      cancelled = true
    }
  }, [])

  const validRef = REF_PATTERN.test(refCode)

  return (
    <CreatePage
      title="流入リンクをつくる"
      description="流入経路ごとにURLを分けると、どこから友だちになったかが分かります。"
      parent={['流入と計測', '/inflow-links']}
      saveLabel="発行してURLを受け取る"
      successHref={(id) => `/inflow-links/detail?id=${id}`}
      designNode="TEVk8"
      variant="v6"
      statusLabel="まだ発行されていません。発行すると、すぐにこのURLが使えます。"
      validate={() => {
        if (!name.trim()) return 'リンク名を入力してください'
        if (!validRef) {
          return 'refコードは、半角英小文字・数字・ハイフンで2〜64文字にしてください'
        }
        return null
      }}
      onSave={async () => {
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
        })
        if (!res.success) throw new Error(res.error)
        return res.data.id
      }}
      aside={
        <>
          <AsideCard title="お客さまはこの順に進みます">
            <ol className="space-y-3 text-xs leading-relaxed text-ink-secondary">
              <FlowStep step="1" title="案内や広告を見る" description="投稿・広告・チラシなどの案内を見ます。" />
              <FlowStep step="2" title="このURLを一瞬だけ通る" description="画面には何も出ません。ここで経路を記録します。" />
              <FlowStep step="3" title="LINEの友だち追加が開く" description="いつもの追加画面で、友だち追加をします。" />
              <FlowStep step="4" title="あいさつとシナリオが届く" description="左で決めた動きが、この瞬間に始まります。" />
            </ol>
          </AsideCard>
          <AsideCard title="気をつけること">
            <ul className="space-y-2 text-xs leading-relaxed text-ink-faint">
              <li>REFを変えると別の経路になります。</li>
              <li>印刷ずみのQRコードは古いREFのままです。</li>
              <li>LINEの追加ボタンを直接置くと数えられません。かならず発行したURLを通してください。</li>
            </ul>
          </AsideCard>
        </>
      }
    >
      <FormSection step={1} label="どこに置くリンクですか">
        <Field label="フォルダ" htmlFor="ir-genre" note="選んだフォルダの中に追加されます。">
          <input
            id="ir-genre"
            type="text"
            value={genre}
            onChange={(e) => setGenre(e.target.value)}
            placeholder="例：SNS"
            className={inputClass}
          />
        </Field>

        <Field label="流入元の名前" htmlFor="ir-name" required note="管理画面で見分けるための名前です。">
          <input
            id="ir-name"
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              if (!refTouched) setRefCode(suggestRef(e.target.value))
            }}
            placeholder="例：Instagramプロフィール"
            className={inputClass}
          />
        </Field>

        <Field
          label="REF（URLに入る文字）"
          htmlFor="ir-ref"
          required
          note={
            <>
              URLの末尾に使います。半角英小文字・数字・ハイフンで2〜64文字。
              <br />
              <strong>あとから変えられません。</strong>配ったURLが使えなくなるためです。
            </>
          }
        >
          <input
            id="ir-ref"
            type="text"
            value={refCode}
            onChange={(e) => {
              setRefTouched(true)
              setRefCode(e.target.value)
            }}
            placeholder="ig-profile"
            className={`${inputClass} font-mono`}
          />
        </Field>
      </FormSection>

      <FormSection step={2} label="この経路から友だちになったときにすること" note="設定しないと、ふつうの友だち追加と同じ扱いになります。">
        <Field
          label="タグを自動で付ける"
          htmlFor="ir-tag"
          note="あとで配信の絞り込みに使えます。"
        >
          <SelectField
            id="ir-tag"
            value={tagId}
            onChange={(e) => setTagId(e.target.value)}
            aria-label="自動で付けるタグ"
            className={inputClass}
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
        </Field>

        <Field
          label="シナリオ配信を開始する"
          htmlFor="ir-scenario"
          note="経路ごとに違う案内を送れます。"
        >
          <SelectField
            id="ir-scenario"
            value={scenarioId}
            onChange={(e) => setScenarioId(e.target.value)}
            aria-label="開始するシナリオ配信"
            className={inputClass}
            options={[
              { value: '', label: '（なし）' },
              ...scenarios.map((scenario) => ({ value: scenario.id, label: scenario.name })),
            ]}
          />
        </Field>

        <Field
          label="追加直後にメッセージを送る"
          htmlFor="ir-intro"
          note="シナリオとは別に、その場で1通だけ送ります。"
        >
          <SelectField
            id="ir-intro"
            value={introTemplateId}
            onChange={(e) => setIntroTemplateId(e.target.value)}
            aria-label="追加直後に送るメッセージ"
            className={inputClass}
            options={[
              { value: '', label: '送らない' },
              ...templates.map((template) => ({ value: template.id, label: template.name })),
            ]}
          />
        </Field>

        {/* 有効期限を持つ列が無い。入れられるように見せると、期限が来ても
            止まらないリンクができる。 */}
        <Field label="有効期限" note="期限での自動停止は、まだ保存する場所がありません。">
          <p className="bg-canvas-sunken text-ink-faint rounded-control px-3 py-2 text-sm">
            期限なし
          </p>
        </Field>

        <Field
          label="転送先"
          htmlFor="ir-redirect"
          note="友だち追加のかわりに、指定したページへ送ります。空欄なら友だち追加へ進みます。"
        >
          <input
            id="ir-redirect"
            type="url"
            value={redirectUrl}
            onChange={(e) => setRedirectUrl(e.target.value)}
            placeholder="https://example.com/lp"
            className={inputClass}
          />
        </Field>

        <label className="text-ink-secondary flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
          />
          <span>
            発行したらすぐ使えるようにする
            <span className="text-ink-faint block text-xs">
              オフにすると、URLを開いても友だち追加できません。
            </span>
          </span>
        </label>
      </FormSection>

      <FormSection step={3} label="どのLINEアカウントに入れるか">
        <Field
          label="入れるアカウント"
          htmlFor="ir-pool"
          note="選ばないと、全体の既定の振り分けに従います。"
        >
          <SelectField
            id="ir-pool"
            value={poolId}
            onChange={(e) => setPoolId(e.target.value)}
            aria-label="友だちの追加先アカウント"
            className={inputClass}
            options={[
              { value: '', label: 'メインプールで自動振り分け' },
              ...pools.map((pool) => ({ value: pool.id, label: pool.name })),
            ]}
          />
        </Field>
        <p className="rounded-control bg-canvas-sunken px-3 py-2 text-xs leading-relaxed text-ink-faint">
          いっぱいのときの振り分けは、LINEアカウント側の設定に従います。
        </p>
      </FormSection>

      <FormSection step={4} label="発行されるURL">
        <p className="rounded-control bg-canvas-sunken px-3 py-3 text-xs leading-relaxed text-ink-faint">
          発行に成功すると、通常のURLを詳細画面でコピーできます。短いURLとQR画像は、発行APIが対応したあとに同じ詳細画面へ表示します。
        </p>
      </FormSection>
    </CreatePage>
  )
}

function FlowStep({ step, title, description }: { step: string; title: string; description: string }) {
  return (
    <li className="flex gap-2">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-bold text-on-accent">{step}</span>
      <span><strong className="block text-ink-secondary">{title}</strong>{description}</span>
    </li>
  )
}
