'use client'

import { useRef, useState } from 'react'
import {
  FORM_THEME_DEFAULT,
  type FormCornerRadius,
  type FormFontFamily,
  type FormTheme,
} from '@line-crm/shared'
import type { MediaItem } from '@line-crm/shared'
import Button from '@/components/shared/button'
import SelectField from '@/components/shared/select-field'
import { Field, TextArea, TextInput } from '@/components/shared/form-controls'
import { useOverlayFocus } from '@/components/shared/overlay-utils'
import { useRouter } from 'next/navigation'
import MediaPickerDialog from '@/app/contents/media-picker-dialog'
import { ogImageUrlError } from './form-validate'

type ColorKey = keyof Pick<FormTheme, 'main' | 'sub' | 'accent' | 'error' | 'text'>

const COLOR_CODE_PATTERN = /^#[0-9a-f]{6}$/i

const COLOR_ROLES: Array<{
  key: ColorKey
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
  formId,
  accountId,
  value,
  ogTitle,
  ogDescription,
  ogImageUrl,
  onChange,
  onOgTitleChange,
  onOgDescriptionChange,
  onOgImageUrlChange,
}: {
  formId: string
  /** メディア選択窓が読むアカウント。未選択なら窓は案内だけ出す。 */
  accountId: string | null
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
  const theme = value ?? FORM_THEME_DEFAULT
  /** FORM-18: カードの画像URLの入力時検査。空は「使わない」なので通す。 */
  const ogImageError = ogImageUrlError(ogImageUrl)
  /** メディア選択窓を開いている対象。null なら閉じている（N-193）。 */
  const [pickerFor, setPickerFor] = useState<'background' | 'ogImage' | null>(null)
  /*
   * DEEP-12: カラーコード欄は入力途中の文字列をここへ保持し、確定
   * （blur / Enter）のときだけ検証してテーマへ反映する。正規の形式と
   * 一致しない限り onChange を呼ばないので、1文字消す・空にする・
   * 途中まで打つ操作で勝手に元の値へ戻らない。
   */
  const [colorDrafts, setColorDrafts] = useState<Partial<Record<ColorKey, string>>>({})
  const [colorErrors, setColorErrors] = useState<Partial<Record<ColorKey, boolean>>>({})
  /*
   * DEEP-13: 「元に戻す」は既定値ではなく、この窓を開いた時点の
   * 値（テーマとリンク設定の全部）へ戻す。窓は閉じるとアンマウント
   * されるので、初回描画の値がそのまま編集開始時のスナップショット。
   */
  const initial = useRef({ theme, ogTitle, ogDescription, ogImageUrl })

  const close = () => router.replace(`/form-submissions/edit?id=${encodeURIComponent(formId)}&tab=basic`)

  /*
   * DEEP-14: 独自の固定divに共通のフォーカス管理を接続する。
   * 開いた時の初回フォーカス・Tabの範囲・Escで閉じる・閉じた後の
   * 起点への復帰・背景スクロール停止は useOverlayFocus が担う。
   * メディア選択窓が上に重なっている間はこちらの制御を止め、
   * Esc が両方の窓を一度に閉じないようにする。
   */
  const panelRef = useOverlayFocus(pickerFor === null, close)

  const patch = <K extends keyof FormTheme>(key: K, next: FormTheme[K]) => {
    onChange({ ...theme, [key]: next })
  }

  const clearColorInput = (key?: ColorKey) => {
    setColorDrafts((prev) => {
      if (key === undefined) return {}
      const next = { ...prev }
      delete next[key]
      return next
    })
    setColorErrors((prev) => {
      if (key === undefined) return {}
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  /** 確定時だけ検証する。有効ならテーマへ反映して下書きを捨て、無効なら入力を残してエラーを出す。 */
  const commitColor = (key: ColorKey) => {
    const draft = colorDrafts[key]
    if (draft === undefined) return
    if (COLOR_CODE_PATTERN.test(draft)) {
      patch(key, draft.toLowerCase())
      clearColorInput(key)
    } else {
      setColorErrors((prev) => ({ ...prev, [key]: true }))
    }
  }

  /** DEEP-13: 「おまかせ」は配色5項目だけを既定の組合せにする。書体・角丸・背景画像は触らない。 */
  const resetColors = () => {
    clearColorInput()
    onChange({
      ...theme,
      main: FORM_THEME_DEFAULT.main,
      sub: FORM_THEME_DEFAULT.sub,
      accent: FORM_THEME_DEFAULT.accent,
      error: FORM_THEME_DEFAULT.error,
      text: FORM_THEME_DEFAULT.text,
    })
  }

  /** DEEP-13: 開いた時点の全値へ戻す。テーマとリンク設定の両方をスナップショットから復元する。 */
  const revertToInitial = () => {
    clearColorInput()
    onChange({ ...initial.current.theme })
    onOgTitleChange(initial.current.ogTitle)
    onOgDescriptionChange(initial.current.ogDescription)
    onOgImageUrlChange(initial.current.ogImageUrl)
  }

  /** DEEP-13: 全初期化は別の操作として残し、変更範囲を説明する。 */
  const resetAllToDefaults = () => {
    clearColorInput()
    onChange({ ...FORM_THEME_DEFAULT })
  }

  const pickMedia = (item: MediaItem) => {
    // 配信用の公開URLを保存値へ入れる（管理画面の表示用URLではない）。
    if (pickerFor === 'background') {
      patch('backgroundImageUrl', item.url)
    } else if (pickerFor === 'ogImage') {
      onOgImageUrlChange(item.url)
    }
    setPickerFor(null)
  }

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 outline-none"
      style={{ background: 'color-mix(in srgb, var(--color-ink) 40%, transparent)' }}
      role="dialog"
      aria-modal="true"
      aria-label="デザイン設定"
    >
      <section data-design-node="ava2n" className="w-full overflow-hidden rounded-panel shadow-lg" style={{ marginBlock: 94, maxWidth: 820, background: 'var(--color-canvas)' }}>
        <header className="border-hairline flex items-start justify-between border-b px-6 py-4">
          <div>
            <h2 className="text-ink text-lg font-bold">デザイン設定</h2>
            <p className="text-ink-faint mt-0.5 text-xs">変えるとすぐ左のプレビューに出ます</p>
          </div>
          <button type="button" onClick={close} className="text-ink-faint px-2 text-2xl leading-none" aria-label="閉じる">×</button>
        </header>
        <div className="p-6">
        {/*
          #725: 「色／文字と背景／CSSで細かく」は <span> で押せなかった。
          押せる形にはせず、タブをやめて区分を見出しで並べて出す。
          - 「CSSで細かく」は中身がどこにも無い。押せるようにすると、
            切り替えた先が空の面になり、いま消している死にUIが1つ増える
          - 中身は1画面に収まる。押せなかった面を押せるようにする代わりに、
            いま全部見えているものを隠すのは、利用者にとって損になる
          CSS編集を実装するときは、そのときタブへ戻す。
        */}
        <div>
          <h3 className="text-ink text-sm font-medium">色</h3>
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-ink text-sm font-semibold">色は5つの役割にだけ割り当てます</p>
            <Button onClick={resetColors} title="5つの色だけを初期の組合せにします。書体・角の丸み・背景画像は変わりません。">おまかせで組む</Button>
          </div>
          <div className="mt-2 space-y-2">
            {COLOR_ROLES.map((role) => {
              const errorId = `form-theme-${role.key}-error`
              return (
              <label key={role.key} className={`border-hairline rounded-control flex items-center gap-3 border p-3 ${role.key === 'main' ? 'border-accent bg-accent-soft' : ''}`}>
                <input
                  type="color"
                  value={theme[role.key]}
                  onChange={(event) => {
                    clearColorInput(role.key)
                    patch(role.key, event.target.value)
                  }}
                  className="h-10 w-10 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
                  aria-label={`${role.label}の色`}
                />
                <span className="min-w-0 flex-1">
                  <span className="text-ink block text-sm font-medium">{role.label}</span>
                  <span className="text-ink-faint block text-xs">{role.note}</span>
                </span>
                <span className="flex w-24 flex-col gap-1">
                  <input
                    value={colorDrafts[role.key] ?? theme[role.key]}
                    onChange={(event) =>
                      setColorDrafts((prev) => ({ ...prev, [role.key]: event.target.value }))}
                    onBlur={() => commitColor(role.key)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        commitColor(role.key)
                      }
                    }}
                    className="border-hairline text-ink-secondary w-24 rounded-control border px-2 py-1.5 font-mono text-xs"
                    aria-label={`${role.label}のカラーコード`}
                    aria-invalid={colorErrors[role.key] || undefined}
                    aria-describedby={colorErrors[role.key] ? errorId : undefined}
                  />
                  {colorErrors[role.key] ? (
                    <span id={errorId} role="alert" className="text-danger text-micro leading-4">
                      #に続けて6桁の16進数で入れてください（例: #008f3d）
                    </span>
                  ) : null}
                </span>
              </label>
              )
            })}
          </div>
          <p className="text-ink-faint mt-3 text-xs leading-5">
            色そのものではなく「役割」で持たせています。主ボタンの文字は、選んだ色に対して読みやすい色へ自動で切り替わります。
          </p>
        </div>

        <div className="border-hairline mt-5 border-t pt-5">
          <h3 className="text-ink text-sm font-medium">文字と角の丸み</h3>
          <div className="mt-3 grid gap-4 sm:grid-cols-3">
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
        </div>

        {/*
          背景画像（N-193）: #725 で選ぶものが無く消していた選択欄を、
          登録メディアへの接続ができたので戻した。値は `form-preview.tsx`
          が背景として描き、`normalizeFormTheme` が https のURLだけ通す。
        */}
        <div className="border-hairline mt-5 border-t pt-5">
          <h3 className="text-ink text-sm font-medium">背景</h3>
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-ink text-sm font-semibold">
              {theme.backgroundImageUrl ? '登録メディアの画像を使っています' : '背景画像は使っていません'}
            </p>
            <div className="flex gap-2">
              {theme.backgroundImageUrl ? (
                <Button onClick={() => patch('backgroundImageUrl', null)}>画像を外す</Button>
              ) : null}
              <Button onClick={() => setPickerFor('background')}>登録メディアから選ぶ</Button>
            </div>
          </div>
          {theme.backgroundImageUrl ? (
            <p className="text-ink-faint mt-2 truncate text-xs" title={theme.backgroundImageUrl}>
              {theme.backgroundImageUrl}
            </p>
          ) : null}
        </div>

        <div className="border-hairline mt-5 border-t pt-5">
          <h3 className="text-ink text-sm font-medium">リンクの見え方</h3>
          <p className="text-ink-faint mt-0.5 text-xs">LINEやSNSにこのフォームのURLを貼ったときに出るカードです。空のままなら自動で作ります。</p>
          <div className="mt-3 space-y-4">
            <Field label="カードの見出し" htmlFor="form-og-title">
              <TextInput
                id="form-og-title"
                value={ogTitle}
                maxLength={80}
                onChange={(event) => onOgTitleChange(event.target.value)}
              />
            </Field>
            <Field label="カードの説明" htmlFor="form-og-description">
              <TextArea
                id="form-og-description"
                value={ogDescription}
                maxLength={200}
                rows={3}
                onChange={(event) => onOgDescriptionChange(event.target.value)}
              />
            </Field>
            {/*
              FORM-18: 入力の時点で https:// 以外だと理由を出す。
              **値は消さない。**確定時だけ弾くカラーコード欄（DEEP-12）と同じ
              作法で、直せるように入力はそのまま残す。
            */}
            <Field label="カードの画像URL" htmlFor="form-og-image-url" note="https で始まるURLだけ使えます。登録メディアからも選べます。">
              <TextInput
                id="form-og-image-url"
                type="url"
                inputMode="url"
                placeholder="https://"
                value={ogImageUrl}
                invalid={Boolean(ogImageError)}
                aria-describedby={ogImageError ? 'form-og-image-url-error' : undefined}
                onChange={(event) => onOgImageUrlChange(event.target.value)}
              />
              {ogImageError ? (
                <span id="form-og-image-url-error" role="alert" className="text-danger mt-1 block text-micro leading-4">
                  {ogImageError}
                </span>
              ) : null}
            </Field>
            <div>
              <Button onClick={() => setPickerFor('ogImage')}>登録メディアから選ぶ</Button>
            </div>
          </div>
        </div>
        </div>
        <footer className="border-hairline flex items-center justify-between border-t px-6 py-4">
          <span className="flex items-center gap-4">
            <button
              type="button"
              onClick={revertToInitial}
              title="この窓を開いた時点の設定へ戻します"
              className="text-accent text-sm font-medium"
            >
              元に戻す
            </button>
            <button
              type="button"
              onClick={resetAllToDefaults}
              title="色・書体・角の丸み・背景画像をすべて初期値に戻します"
              className="text-ink-faint text-sm"
            >
              初期設定に戻す
            </button>
          </span>
          {/*
            #725: ここにあった「保存する」は onClick を持たず、押しても何も
            起きなかった。繋がずに消す。本物の保存は編集画面下部の追従帯
            （`edit/page.tsx` の StickyBar）ひとつだけで、同じ意味のボタンを
            2つ並べると、押した人はどちらが効いたのか分からなくなる。
          */}
          <Button onClick={close}>閉じる</Button>
        </footer>
      </section>

      <MediaPickerDialog
        open={pickerFor !== null}
        accountId={accountId}
        kind="image"
        onClose={() => setPickerFor(null)}
        onSelect={pickMedia}
      />
    </div>
  )
}
