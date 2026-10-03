'use client'

/*
 * 回答フォーム編集の「見た目」段（M3）。
 *
 * 既定は「店の設定に合わせる」。「このフォームだけ変える」のときだけ
 * 型と色を使う。色の null・空文字は「型の色・店の色」。
 * 入力途中の色コードはここに保持し、確定（blur / Enter）のときだけ
 * 親へ渡す（1文字消す操作で元の値へ戻らないように）。
 */

import { useState } from 'react'
import {
  checkLiffColor,
  LIFF_HEADING_FONT_META,
  LIFF_HEADING_FONTS,
  LIFF_THEME_META,
  LIFF_THEMES,
  resolveLiffTextColor,
  type LiffFormAppearance,
} from '@line-crm/shared'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import Select from '@/components/shared/select'
import Button from '@/components/shared/button'
import { Field } from '@/components/shared/form-controls'

const HEX_PATTERN = /^#[0-9a-f]{6}$/i

function AppearanceColorField({ label, note, value, onChange }: {
  label: string
  note: string
  value: string | null
  onChange: (value: string | null) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const [invalid, setInvalid] = useState(false)
  const shown = draft ?? value ?? ''
  const commit = (raw: string) => {
    const text = raw.trim()
    if (text === '') {
      setDraft(null)
      setInvalid(false)
      onChange(null)
      return
    }
    if (HEX_PATTERN.test(text)) {
      setDraft(null)
      setInvalid(false)
      onChange(text.toLowerCase())
    } else {
      setInvalid(true)
    }
  }
  return (
    <Field label={label} note={note}>
      <span className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label}の色`}
          value={value ?? '#ffffff'}
          onChange={(event) => {
            setDraft(null)
            setInvalid(false)
            onChange(event.target.value.toLowerCase())
          }}
          className="h-9 w-10 shrink-0 cursor-pointer rounded-mini border-0 bg-transparent p-0"
        />
        <input
          value={shown}
          placeholder="型・店の色"
          onChange={(event) => {
            setDraft(event.target.value)
            setInvalid(false)
          }}
          onBlur={(event) => commit(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commit((event.target as HTMLInputElement).value)
            }
          }}
          className="border-hairline text-ink-secondary w-28 rounded-control border px-2 py-1.5 font-mono text-xs"
          aria-label={`${label}のカラーコード`}
        />
        {!value ? <span className="text-ink-faint text-xs">型・店の色</span> : null}
      </span>
      {invalid ? (
        <span role="alert" className="text-danger mt-1 block text-micro leading-4">
          #に続けて6桁の16進数で入れてください（例: #0f1c33）。型・店の色に戻すときは空にしてください。
        </span>
      ) : null}
    </Field>
  )
}

export default function FormLiffAppearanceSection({ value, onChange }: {
  value: LiffFormAppearance
  onChange: (next: LiffFormAppearance) => void
}) {
  const custom = value.mode === 'custom'
  const patch = (part: Partial<LiffFormAppearance>) => onChange({ ...value, ...part })
  const primaryCheck = checkLiffColor(value.primaryColor, '主の色')
  const backgroundCheck = checkLiffColor(value.backgroundColor, '地の色')

  return (
    <div className="bg-canvas rounded-card border-hairline mt-4 border p-4">
      <p className="text-ink text-sm font-semibold">見た目</p>
      <p className="text-ink-secondary mt-0.5 text-xs">
        お客さまの回答画面の型と色です。既定は店の設定に合わせます（予約設定の「お客さまの予約画面の見た目」）。
      </p>
      <div className="mt-3">
        <RadioCardGroup legend="フォームの見た目の合わせ方">
          <RadioCard
            name="form-liff-appearance-mode"
            value="inherit"
            checked={!custom}
            onChange={() => patch({ mode: 'inherit' })}
            title="店の設定に合わせる"
            note="予約設定の型・店の色を使います。店の設定を変えるとこのフォームも変わります。"
          />
          <RadioCard
            name="form-liff-appearance-mode"
            value="custom"
            checked={custom}
            onChange={() => patch({ mode: 'custom' })}
            title="このフォームだけ変える"
            note="下の型と色を使います。店の設定を変えてもこのフォームは変わりません。"
          />
        </RadioCardGroup>
      </div>
      {custom ? (
        <div className="mt-4">
          <Field label="型" htmlFor="form-liff-theme">
            <Select
              id="form-liff-theme"
              aria-label="このフォームの型"
              value={value.theme}
              onChange={(next) => patch({ theme: next as LiffFormAppearance['theme'] })}
              size="full"
              options={LIFF_THEMES.map((theme) => ({
                value: theme,
                label: `${LIFF_THEME_META[theme].label}（${LIFF_THEME_META[theme].note}）`,
              }))}
            />
          </Field>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <AppearanceColorField
              label="主の色"
              note="ボタンや見出しに使います。空のままなら型・店の色です。"
              value={value.primaryColor}
              onChange={(next) => patch({ primaryColor: next })}
            />
            <AppearanceColorField
              label="地の色"
              note="画面の地に使います。空のままなら型・店の色です。"
              value={value.backgroundColor}
              onChange={(next) => patch({ backgroundColor: next })}
            />
          </div>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Field label="見出しの書体" htmlFor="form-liff-font">
              <Select
                id="form-liff-font"
                aria-label="このフォームの見出しの書体"
                value={value.headingFont}
                onChange={(next) => patch({ headingFont: next as LiffFormAppearance['headingFont'] })}
                size="full"
                options={LIFF_HEADING_FONTS.map((font) => ({
                  value: font,
                  label: font === 'default' ? '店の設定に合わせる' : LIFF_HEADING_FONT_META[font].label,
                }))}
              />
            </Field>
            <div className="flex items-end">
              <Button
                onClick={() => patch({ primaryColor: null, backgroundColor: null })}
                title="主の色・地の色を空にします。型は変わりません。"
              >
                型・店の色に戻す
              </Button>
            </div>
          </div>
          {/*
           * 白い字との見やすさ（4.5:1 以上）の注意。足りなくても保存は止めない。
           * 足りない色には字を黒にすることと、濃い候補を出す。
           */}
          <div className="mt-3 space-y-1">
            {!value.primaryColor && !value.backgroundColor ? (
              <p className="text-ink-faint text-xs">
                色は型・店の色のままです。白い字との見やすさ（4.5:1以上）は、色を入れたときに自動で確かめます。
              </p>
            ) : null}
            {[
              { color: value.primaryColor, check: primaryCheck },
              { color: value.backgroundColor, check: backgroundCheck },
            ].map((entry) => entry.color ? (
              <p key={entry.color} className="text-ink-faint text-xs">
                {entry.color}の字は{entry.check.textColor === '#ffffff' ? '白' : '黒'}にします
                （白い字との見やすさ {entry.check.whiteRatio.toFixed(1)}:1・目安 4.5:1）。
                {entry.check.textColor === '#ffffff' ? null : (
                  <>
                    <span
                      aria-hidden
                      className="mx-1 inline-block rounded-mini px-2 text-xs font-semibold"
                      style={{ background: entry.color, color: resolveLiffTextColor(entry.color) }}
                    >
                      あ
                    </span>
                    {entry.check.darkerCandidates.length > 0 ? (
                      <>白い字のままにするなら、濃い候補があります：{entry.check.darkerCandidates.join('・')}</>
                    ) : null}
                  </>
                )}
              </p>
            ) : null)}
            {(value.primaryColor || value.backgroundColor) ? (
              <p className="text-ink-faint text-xs">足りなくても保存はできます。</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
