'use client'

import {
  FORM_THEME_DEFAULT,
  type FormCornerRadius,
  type FormFontFamily,
  type FormTheme,
} from '@line-crm/shared'
import Button from '@/components/shared/button'
import SelectField from '@/components/shared/select-field'
import { Field } from '@/components/shared/form-controls'
import { useRouter } from 'next/navigation'

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
  const router = useRouter()
  void [ogTitle, ogDescription, ogImageUrl, onOgTitleChange, onOgDescriptionChange, onOgImageUrlChange]
  const theme = value ?? FORM_THEME_DEFAULT
  const patch = <K extends keyof FormTheme>(key: K, next: FormTheme[K]) => {
    onChange({ ...theme, [key]: next })
  }

  const close = () => router.replace('/form-submissions/edit?id=form-1&tab=basic')

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="デザイン設定">
      <section data-design-node="ava2n" className="my-[94px] w-full max-w-[820px] overflow-hidden rounded-panel bg-white shadow-lg">
        <header className="border-hairline flex items-start justify-between border-b px-6 py-4">
          <div>
            <h2 className="text-ink text-lg font-bold">デザイン設定</h2>
            <p className="text-ink-faint mt-0.5 text-xs">変えるとすぐ左のプレビューに出ます</p>
          </div>
          <button type="button" onClick={close} className="text-ink-faint px-2 text-2xl leading-none" aria-label="閉じる">×</button>
        </header>
        <div className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex gap-7 border-b border-hairline text-sm font-medium">
              <span className="border-b-2 border-accent px-1 pb-3 text-accent">色</span>
              <span className="px-1 pb-3 text-ink-secondary">文字と背景</span>
              <span className="px-1 pb-3 text-ink-secondary">CSSで細かく</span>
            </div>
          </div>
        </div>

        <div className="mt-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-ink text-sm font-semibold">色は5つの役割にだけ割り当てます</p>
            <Button onClick={() => onChange({ ...FORM_THEME_DEFAULT })}>おまかせで組む</Button>
          </div>
          <div className="mt-2 space-y-2">
            {COLOR_ROLES.map((role) => (
              <label key={role.key} className={`border-hairline rounded-control flex items-center gap-3 border p-3 ${role.key === 'main' ? 'border-accent bg-accent-soft' : ''}`}>
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

        <div className="border-hairline mt-5 grid gap-4 border-t pt-5 sm:grid-cols-3">
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

          <Field label="背景画像" htmlFor="form-theme-background">
            <SelectField id="form-theme-background" value={theme.backgroundImageUrl ?? ''} onChange={(event) => patch('backgroundImageUrl', event.target.value || null)} options={[{ value: '', label: 'なし' }]} />
          </Field>
        </div>
        <footer className="border-hairline flex items-center justify-between border-t px-6 py-4">
          <button type="button" onClick={() => onChange({ ...FORM_THEME_DEFAULT })} className="text-accent text-sm font-medium">元に戻す</button>
          <div className="flex gap-2"><Button onClick={close}>閉じる</Button><Button variant="primary">保存する</Button></div>
        </footer>
      </section>
    </div>
  )
}
