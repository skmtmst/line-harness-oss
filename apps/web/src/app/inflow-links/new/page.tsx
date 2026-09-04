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

/**
 * リンクを発行する（設計 V2 6-2-2）。
 *
 * 設計は「どのリンクか → このリンクから友だちになったとき → 貼り付けて使うURL」
 * の3節。何が起きるかを、貼る前に読み切れる形にしてある。
 *
 * 設計はここだけ「ジャンル」と呼んでいるが、一覧（6-2）とタグ・テンプレート・
 * シナリオの各画面は「フォルダ」なので、こちらに揃えた。同じものが2つの名前を
 * 持つと、画面を行き来したときに別の機能に見える。
 */

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

  const workerBase = process.env.NEXT_PUBLIC_API_URL ?? ''
  const validRef = REF_PATTERN.test(refCode)
  const previewUrl = validRef ? `${workerBase}/r/${refCode}` : null

  return (
    <CreatePage
      title="リンクを発行する"
      description="流入経路ごとにURLを分けると、どこから友だちになったかが分かります。"
      parent={['流入と計測', '/inflow-links']}
      saveLabel="リンクを発行"
      validate={() => {
        if (!name.trim()) return 'リンク名を入力してください'
        if (!validRef) {
          return 'refコードは、半角英小文字・数字・ハイフンで2〜64文字にしてください'
        }
        return null
      }}
      onReset={() => {
        setName('')
        setRefCode('')
        setRefTouched(false)
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
        <AsideCard title="気をつけること">
          <ul className="text-ink-faint space-y-1.5 text-xs leading-relaxed">
            <li>・refコードはあとから変更できません</li>
            <li>・同じ人が別のリンクから再度追加しても、最初の経路が残ります</li>
            <li>・フォルダはあとから移動できます</li>
          </ul>
        </AsideCard>
      }
    >
      <FormSection step={1} label="どのリンクか">
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

        <Field label="リンク名" htmlFor="ir-name" required note="管理画面での呼び名です。">
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
          label="refコード"
          htmlFor="ir-ref"
          required
          note={
            <>
              URLの末尾に使われます。半角英小文字・数字・ハイフンで2〜64文字。
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

      <FormSection step={2} label="このリンクから友だちになったとき">
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

        <Field
          label="追加先アカウント"
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

      <FormSection step={3} label="貼り付けて使うURL" note="保存すると確定します。">
        <div className="border-hairline rounded-control flex items-center gap-2 border px-3 py-2">
          <code className="text-ink-secondary min-w-0 flex-1 truncate text-xs">
            {previewUrl ?? 'refコードを入れると出ます'}
          </code>
          <button
            disabled
            title="保存すると押せるようになります"
            className="border-hairline text-ink-faint rounded-control border px-2 py-1 text-xs opacity-50"
          >
            コピー
          </button>
        </div>
        <p className="text-ink-faint text-xs">
          チラシや店頭POPにはQRコードが便利です。
          <button
            disabled
            title="保存すると押せるようになります"
            className="border-hairline text-ink-faint rounded-control ml-2 border px-2 py-1 opacity-50"
          >
            QRコードを保存
          </button>
        </p>
      </FormSection>
    </CreatePage>
  )
}
