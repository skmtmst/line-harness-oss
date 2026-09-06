'use client'

import {
  FORM_THEME_DEFAULT,
  type FormCornerRadius,
  type FormFontFamily,
  type FormTheme,
} from '@line-crm/shared'
import Button from '@/components/shared/button'
import SelectField from '@/components/shared/select-field'
import { Field, TextArea, TextInput } from '@/components/shared/form-controls'

const COLOR_ROLES: Array<{
  key: keyof Pick<FormTheme, 'main' | 'sub' | 'accent' | 'error' | 'text'>
  label: string
  note: string
}> = [
  { key: 'main', label: 'メイン', note: 'ボタン・見出し・選択中の枠' },
  { key: 'sub', label: 'サブ', note: '帯や背景の薄い面' },
  { key: 'accent', label: 'アクセント', note: 'リンクと補足の強調' },
  { key: 'error', label: 'エラー', note: '入力の間違いを知らせる色' },
  { key: 'text', label: '文字', note: '本文の色' },
]

export default function FormDesignSettings({
  value,
  ogTitle,
  ogDescription,
  ogImageUrl,
  onChange,
  onOgTitleChange,
  onOgDescriptionChange,
  onOgImageUrlChange,
}: {
  value: FormTheme | undefined
  ogTitle: string
  ogDescription: string
  ogImageUrl: string
  onChange: (theme: FormTheme) => void
  onOgTitleChange: (value: string) => void
  onOgDescriptionChange: (value: string) => void
  onOgImageUrlChange: (value: string) => void
}) {
  const theme = value ?? FORM_THEME_DEFAULT
  const patch = <K extends keyof FormTheme>(key: K, next: FormTheme[K]) => {
    onChange({ ...theme, [key]: next })
  }

  return (
    <section data-design-node="ava2n" className="min-w-0 space-y-4">
      <div className="bg-canvas rounded-card border-hairline border p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-ink text-base font-bold">デザイン設定</h2>
            <p className="text-ink-faint mt-1 text-xs">変えるとすぐ左のプレビューに出ます</p>
          </div>
          <Button onClick={() => onChange({ ...FORM_THEME_DEFAULT })}>おまかせで組む</Button>
        </div>

        <div className="mt-5">
          <p className="text-ink text-sm font-semibold">色</p>
          <p className="text-ink-faint mt-1 text-xs">
            色は5つの役割にだけ割り当てます。任意のCSS・HTML・JavaScriptは保存できません。
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {COLOR_ROLES.map((role) => (
              <label key={role.key} className="border-hairline rounded-control flex items-center gap-3 border p-3">
                <input
                  type="color"
                  value={theme[role.key]}
                  onChange={(event) => patch(role.key, event.target.value)}
                  className="h-10 w-10 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
                  aria-label={`${role.label}の色`}
                />
                <span className="min-w-0 flex-1">
                  <span className="text-ink block text-sm font-medium">{role.label}</span>
                  <span className="text-ink-faint block text-xs">{role.note}</span>
                </span>
                <input
                  value={theme[role.key]}
                  onChange={(event) => {
                    if (/^#[0-9a-f]{6}$/i.test(event.target.value)) patch(role.key, event.target.value.toLowerCase())
                  }}
                  className="border-hairline text-ink-secondary w-24 rounded-control border px-2 py-1.5 font-mono text-xs"
                  aria-label={`${role.label}のカラーコード`}
                />
              </label>
            ))}
          </div>
          <p className="text-ink-faint mt-3 text-xs leading-5">
            色そのものではなく「役割」で持たせています。主ボタンの文字は、選んだ色に対して読みやすい色へ自動で切り替わります。
          </p>
        </div>

        <div className="border-hairline mt-5 grid gap-4 border-t pt-5 sm:grid-cols-2">
          <Field label="文字の書体" htmlFor="form-theme-font">
            <SelectField
              id="form-theme-font"
              value={theme.fontFamily}
              onChange={(event) => patch('fontFamily', event.target.value as FormFontFamily)}
              options={[
                { value: 'sans', label: 'ゴシック体' },
                { value: 'serif', label: '明朝体' },
              ]}
            />
          </Field>
          <Field label="角の丸み" htmlFor="form-theme-radius">
            <SelectField
              id="form-theme-radius"
              value={theme.cornerRadius}
              onChange={(event) => patch('cornerRadius', event.target.value as FormCornerRadius)}
              options={[
                { value: 'none', label: 'なし' },
                { value: 'medium', label: 'ふつう' },
                { value: 'round', label: '大きめ' },
              ]}
            />
          </Field>
        </div>

        <div className="mt-4">
          <Field
            label="背景画像"
            htmlFor="form-theme-background"
            note="HTTPSの画像URLだけを指定できます。空なら背景色を使います。"
          >
            <TextInput
              id="form-theme-background"
              type="url"
              value={theme.backgroundImageUrl ?? ''}
              onChange={(event) => patch('backgroundImageUrl', event.target.value || null)}
              placeholder="https://example.com/background.jpg"
            />
          </Field>
        </div>
      </div>

      <div className="bg-canvas rounded-card border-hairline border p-5">
        <h2 className="text-ink text-base font-bold">SNSで共有したときの表示</h2>
        <div className="mt-4 grid gap-4">
          <Field label="タイトル" htmlFor="form-og-title">
            <TextInput id="form-og-title" value={ogTitle} onChange={(event) => onOgTitleChange(event.target.value)} />
          </Field>
          <Field label="説明" htmlFor="form-og-description">
            <TextArea id="form-og-description" rows={3} value={ogDescription} onChange={(event) => onOgDescriptionChange(event.target.value)} />
          </Field>
          <Field label="画像URL" htmlFor="form-og-image">
            <TextInput id="form-og-image" type="url" value={ogImageUrl} onChange={(event) => onOgImageUrlChange(event.target.value)} />
          </Field>
        </div>
      </div>
    </section>
  )
}
