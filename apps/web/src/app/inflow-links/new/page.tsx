'use client'

import { useEffect, useState } from 'react'
import type { Scenario, Tag } from '@line-crm/shared'
import { api } from '@/lib/api'
import CreatePage, { Field, inputClass } from '@/components/shared/create-page'

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
  const [redirectUrl, setRedirectUrl] = useState('')
  const [tags, setTags] = useState<Tag[]>([])
  const [scenarios, setScenarios] = useState<Scenario[]>([])

  useEffect(() => {
    void api.tags.list().then((res) => {
      if (res.success) setTags(res.data)
    })
    void api.scenarios.list().then((res) => {
      if (res.success) setScenarios(res.data)
    })
  }, [])

  return (
    <CreatePage
      title="リンクを発行する"
      description="どこから友だちになったかを記録できるURLを作ります。"
      parent={['流入経路', '/inflow-links']}
      validate={() => {
        if (!name.trim()) return '名前を入力してください'
        if (!REF_PATTERN.test(refCode)) {
          return 'URLに使う名前は、半角英小文字・数字・ハイフンで2〜64文字にしてください'
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
          redirectUrl: redirectUrl.trim() || null,
        })
        if (!res.success) throw new Error(res.error)
        return res.data.id
      }}
    >
      <Field label="名前" htmlFor="ir-name" required note="管理画面での呼び名です。">
        <input
          id="ir-name"
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            if (!refTouched) setRefCode(suggestRef(e.target.value))
          }}
          placeholder="例: Instagramのプロフィール"
          className={inputClass}
        />
      </Field>

      <Field label="グループ" htmlFor="ir-genre" note="店舗や媒体でまとめたいときに使います。">
        <input
          id="ir-genre"
          type="text"
          value={genre}
          onChange={(e) => setGenre(e.target.value)}
          placeholder="例: A店"
          className={inputClass}
        />
      </Field>

      <Field
        label="URLに使う名前"
        htmlFor="ir-ref"
        required
        note={
          <>
            半角英小文字・数字・ハイフンで2〜64文字。
            {refCode && REF_PATTERN.test(refCode) && (
              <>
                <br />
                配るURLは <code className="bg-canvas-sunken rounded px-1">/r/{refCode}</code> になります。
              </>
            )}
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
          className={`${inputClass} font-mono`}
        />
      </Field>

      <Field
        label="友だち追加時に付けるタグ"
        htmlFor="ir-tag"
        note="このリンクから来た人を、あとから絞り込めるようになります。"
      >
        <select
          id="ir-tag"
          value={tagId}
          onChange={(e) => setTagId(e.target.value)}
          className={inputClass}
        >
          <option value="">— 付けない —</option>
          {tags.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="友だち追加時に始めるシナリオ" htmlFor="ir-scenario">
        <select
          id="ir-scenario"
          value={scenarioId}
          onChange={(e) => setScenarioId(e.target.value)}
          className={inputClass}
        >
          <option value="">— 始めない —</option>
          {scenarios.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
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
    </CreatePage>
  )
}
