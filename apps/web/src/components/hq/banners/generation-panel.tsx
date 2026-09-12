'use client'

import { Plus, Sparkles, X } from 'lucide-react'
import { useId, type ReactNode } from 'react'
import SelectField from '@/components/shared/select-field'
import { TextArea, TextField } from '@/components/shared/text-field'
import {
  CUSTOM_PROMPT_MAX,
  FREE_PROMPT_MAX,
  MAIN_COLOR_SWATCHES,
  SUB_COLOR_SWATCHES,
  TEXT_LINE_LENGTH_MAX,
  TEXT_LINE_MAX,
  groupPresets,
  isHexColor,
  presetOptionLabel,
  type BannerGenerationInput,
  type BannerPreset,
} from '@/lib/hq-banners'

/**
 * 右 390px の生成パネル。Pencil 35-2 `UKR6a`。
 *
 * 運用者に見せるのは「用途・テキスト・色・人物・追加の指示・枚数」だけ。
 * 品質やクレジットの選択は置かない（2026-09-12 決定、`docs/hq-banner-generation.md`）。
 *
 * 単一選択（モード・人物・枚数・色の見本）は radio で組む。見た目は label が持つ。
 */
export default function GenerationPanel({
  presets,
  maxCount,
  value,
  onChange,
  disabled,
}: {
  presets: BannerPreset[]
  maxCount: number
  value: BannerGenerationInput
  onChange: (next: BannerGenerationInput) => void
  disabled?: boolean
}) {
  const uid = useId()
  const set = <K extends keyof BannerGenerationInput>(key: K, next: BannerGenerationInput[K]) =>
    onChange({ ...value, [key]: next })

  const presetOptions = groupPresets(presets).flatMap((group) =>
    group.items.map((p) => ({ value: p.key, label: `${group.label}｜${presetOptionLabel(p)}` })),
  )
  const selectedPreset = presets.find((p) => p.key === value.presetKey)

  return (
    <aside
      data-design-node="UKR6a"
      className="flex w-full shrink-0 flex-col self-start rounded-card border border-hairline bg-canvas xl:sticky xl:top-4"
      style={{ maxWidth: 390 }}
      aria-label="画像を生成"
    >
      <div className="flex h-14 items-center gap-2 px-4">
        <Sparkles aria-hidden="true" className="h-4.5 w-4.5 text-accent-deep" />
        <h2 className="text-body font-bold text-ink">画像を生成</h2>
        <span className="flex-1" />
        <fieldset className="flex rounded-control bg-shell p-0.5" disabled={disabled}>
          <legend className="sr-only">生成のしかた</legend>
          <ModeOption
            name={`${uid}-mode`}
            checked={value.mode === 'banner'}
            onSelect={() => set('mode', 'banner')}
            label="バナー"
          />
          <ModeOption
            name={`${uid}-mode`}
            checked={value.mode === 'free'}
            onSelect={() => set('mode', 'free')}
            label="自由入力"
          />
        </fieldset>
      </div>
      <div className="border-t border-hairline" />

      <div data-design-node="E82WuU" className="flex flex-col gap-4 p-4">
        <Field label="用途" note="LINE と SNS の規格から選ぶ" htmlFor={`${uid}-preset`}>
          <SelectField
            id={`${uid}-preset`}
            className="w-full"
            style={{ width: '100%' }}
            value={value.presetKey}
            disabled={disabled}
            onChange={(event) => set('presetKey', event.target.value)}
            options={value.presetKey ? presetOptions : [{ value: '', label: '用途を選んでください' }, ...presetOptions]}
          />
          {selectedPreset ? <p className="text-micro text-ink-faint">{selectedPreset.note}</p> : null}
        </Field>

        {value.mode === 'banner' ? (
          <>
            <Field label="画像に入れるテキスト" note={`1行に1つ・${TEXT_LINE_LENGTH_MAX}文字まで`}>
              <div className="flex flex-col gap-2 rounded-control border border-hairline p-3">
                {value.textLines.map((line, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="w-3 text-micro font-semibold text-ink-faint" aria-hidden="true">{i + 1}</span>
                    <TextField
                      aria-label={`テキスト ${i + 1}行目`}
                      value={line}
                      maxLength={TEXT_LINE_LENGTH_MAX}
                      disabled={disabled}
                      placeholder={i === 0 ? '例: 2周年 春の感謝祭' : i === value.textLines.length - 1 ? '行動を促す文言（例: 今すぐチェック）' : ''}
                      onChange={(event) => {
                        const next = [...value.textLines]
                        next[i] = event.target.value
                        set('textLines', next)
                      }}
                      className="min-w-0 flex-1"
                    />
                    {value.textLines.length > 1 ? (
                      <button
                        type="button"
                        disabled={disabled}
                        aria-label={`${i + 1}行目を消す`}
                        onClick={() => set('textLines', value.textLines.filter((_, j) => j !== i))}
                        className="rounded-mini p-1 text-ink-faint hover:bg-canvas-sunken disabled:opacity-50"
                      >
                        <X aria-hidden="true" className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </div>
                ))}
                {value.textLines.length < TEXT_LINE_MAX ? (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => set('textLines', [...value.textLines, ''])}
                    className="inline-flex items-center gap-1 self-start text-caption font-semibold text-accent-deep hover:underline disabled:opacity-50"
                  >
                    <Plus aria-hidden="true" className="h-3.5 w-3.5" />
                    行を足す
                  </button>
                ) : null}
              </div>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <ColorPicker
                name={`${uid}-main`}
                label="メインカラー"
                swatches={MAIN_COLOR_SWATCHES}
                value={value.mainColor}
                onChange={(v) => set('mainColor', v)}
                disabled={disabled}
              />
              <ColorPicker
                name={`${uid}-sub`}
                label="サブカラー"
                note="任意"
                swatches={SUB_COLOR_SWATCHES}
                value={value.subColor}
                onChange={(v) => set('subColor', v)}
                disabled={disabled}
              />
            </div>

            <Field label="人物">
              <fieldset className="grid grid-cols-2 gap-1.5" disabled={disabled}>
                <legend className="sr-only">人物</legend>
                <SegmentOption name={`${uid}-person`} checked={value.personOption === 'without'} onSelect={() => set('personOption', 'without')} label="入れない" />
                <SegmentOption name={`${uid}-person`} checked={value.personOption === 'with'} onSelect={() => set('personOption', 'with')} label="入れる" />
              </fieldset>
            </Field>

            <Field label="追加の指示" note="任意" htmlFor={`${uid}-custom`}>
              <TextArea
                id={`${uid}-custom`}
                rows={2}
                maxLength={CUSTOM_PROMPT_MAX}
                disabled={disabled}
                value={value.customPrompt}
                placeholder="例: 桜の花びらと餃子・生ビールの写真風。和風で温かみのある雰囲気"
                onChange={(event) => set('customPrompt', event.target.value)}
                className="w-full"
              />
            </Field>
          </>
        ) : (
          <Field label="作りたい画像の説明" note={`${FREE_PROMPT_MAX}文字まで`} htmlFor={`${uid}-free`}>
            <TextArea
              id={`${uid}-free`}
              rows={6}
              maxLength={FREE_PROMPT_MAX}
              disabled={disabled}
              value={value.freePrompt}
              placeholder="例: 餃子と生ビールの写真風ビジュアル。木のテーブル、温かい照明、文字は入れない"
              onChange={(event) => set('freePrompt', event.target.value)}
              className="w-full"
            />
            <p className="text-micro text-ink-faint">書いた文がそのまま生成の指示になります。文字を入れたいときはその文字も書いてください。</p>
          </Field>
        )}

        <Field label="枚数">
          <fieldset className="grid grid-cols-4 gap-1.5" disabled={disabled}>
            <legend className="sr-only">枚数</legend>
            {Array.from({ length: maxCount }, (_, i) => i + 1).map((n) => (
              <SegmentOption
                key={n}
                name={`${uid}-count`}
                checked={value.count === n}
                onSelect={() => set('count', n)}
                label={`${n}枚`}
              />
            ))}
          </fieldset>
        </Field>
      </div>
    </aside>
  )
}

function Field({
  label,
  note,
  htmlFor,
  children,
}: {
  label: string
  note?: string
  htmlFor?: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="text-label font-bold text-ink">{label}</label>
        ) : (
          <span className="text-label font-bold text-ink">{label}</span>
        )}
        {note ? <span className="text-micro text-ink-faint">{note}</span> : null}
      </div>
      {children}
    </div>
  )
}

/** モード切替の1つ。Pencil `h9nAp5`。選ばれている方だけ白地。 */
function ModeOption({ name, checked, onSelect, label }: { name: string; checked: boolean; onSelect: () => void; label: string }) {
  return (
    <label
      className={
        checked
          ? 'cursor-pointer rounded-mini bg-canvas px-2.5 py-1 text-caption font-bold text-ink shadow-card'
          : 'cursor-pointer rounded-mini px-2.5 py-1 text-caption font-semibold text-ink-faint hover:text-ink'
      }
    >
      <input type="radio" name={name} className="sr-only" checked={checked} onChange={onSelect} />
      {label}
    </label>
  )
}

/** 人物・枚数の選択肢。Pencil `UgooV` / `ndNQM`。高さ44。 */
function SegmentOption({ name, checked, onSelect, label }: { name: string; checked: boolean; onSelect: () => void; label: string }) {
  return (
    <label
      className={
        checked
          ? 'flex h-11 cursor-pointer items-center justify-center rounded-control border border-accent bg-accent-soft text-label font-bold text-accent-deep has-focus-visible:outline-2'
          : 'flex h-11 cursor-pointer items-center justify-center rounded-control border border-divider-soft bg-canvas text-label font-semibold text-ink hover:bg-canvas-sunken has-focus-visible:outline-2'
      }
    >
      <input type="radio" name={name} className="sr-only" checked={checked} onChange={onSelect} />
      {label}
    </label>
  )
}

/** 色の見本＋HEX。Pencil `l69Th` / `l6UwE`。見本を押すか、HEXを直接書く。 */
function ColorPicker({
  name,
  label,
  note,
  swatches,
  value,
  onChange,
  disabled,
}: {
  name: string
  label: string
  note?: string
  swatches: readonly string[]
  value: string | null
  onChange: (next: string | null) => void
  disabled?: boolean
}) {
  const invalid = value !== null && value !== '' && !isHexColor(value)
  return (
    <fieldset className="flex flex-col gap-1.5" disabled={disabled}>
      <legend className="flex w-full items-baseline justify-between gap-2">
        <span className="text-label font-bold text-ink">{label}</span>
        {note ? <span className="text-micro text-ink-faint">{note}</span> : null}
      </legend>
      <div className="flex gap-1.5">
        {swatches.map((hex) => {
          const checked = (value ?? '').toUpperCase() === hex
          return (
            <label
              key={hex}
              title={hex}
              className={
                checked
                  ? 'h-6.5 w-6.5 cursor-pointer rounded-mini border-2 border-accent-deep'
                  : 'h-6.5 w-6.5 cursor-pointer rounded-mini border border-divider-soft'
              }
              style={{ backgroundColor: hex }}
            >
              <input
                type="radio"
                name={name}
                className="sr-only"
                checked={checked}
                onChange={() => onChange(hex)}
                aria-label={`${label} ${hex}`}
              />
            </label>
          )
        })}
      </div>
      <TextField
        aria-label={`${label} のHEX`}
        value={value ?? ''}
        placeholder="#RRGGBB"
        maxLength={7}
        invalid={invalid}
        onChange={(event) => {
          const raw = event.target.value.trim()
          onChange(raw === '' ? null : raw.startsWith('#') ? raw.toUpperCase() : `#${raw.toUpperCase()}`)
        }}
        className="w-full"
      />
    </fieldset>
  )
}
