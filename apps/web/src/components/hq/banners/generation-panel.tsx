'use client'

import { ChevronDown, Images, Plus, Sparkles, Upload, X } from 'lucide-react'
import { useId, useRef, useState, type ReactNode } from 'react'
import Button from '@/components/shared/button'
import ColorWell from '@/components/shared/color-well'
import HelpTip from '@/components/shared/help-tip'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import Select from '@/components/shared/select'
import { TextArea, TextField } from '@/components/shared/text-field'
import {
  BANNER_MAX_REFERENCE_IMAGES,
  BANNER_REFERENCE_MODES,
  BANNER_REFERENCE_MODE_DESCRIPTION,
  BANNER_REFERENCE_MODE_LABEL,
  COLOR_ROLES,
  CROP_POSITION_OPTIONS,
  CUSTOM_PROMPT_MAX,
  FREE_PROMPT_MAX,
  TEXT_LINE_LENGTH_MAX,
  TEXT_LINE_MAX,
  groupPresets,
  presetCardLabel,
  presetSizeLabel,
  tileCaption,
  type BannerColorRoleKey,
  type BannerCropPosition,
  type BannerGenerationInput,
  type BannerImage,
  type BannerPreset,
  type BannerReferenceMode,
} from '@/lib/hq-banners'

/**
 * 右 390px の生成パネル。Pencil 35-2 `GcJHv`（2026-09-13 に参照画像欄を足して作り直し）。
 *
 * 運用者に見せるのは「用途・参照画像・テキスト・色・人物・追加の指示・枚数」だけ。
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
  referenceImages,
  onPickReference,
  onUploadReference,
  referenceBusy,
}: {
  presets: BannerPreset[]
  maxCount: number
  value: BannerGenerationInput
  onChange: (next: BannerGenerationInput) => void
  disabled?: boolean
  /** 選んでいる参照画像の実体（`value.references` の画像）。無ければ空。 */
  referenceImages: BannerImage[]
  /** 「ライブラリから選ぶ」。親が ★BG-C `cOgWE` のダイアログを開く。 */
  onPickReference: () => void
  /** 「ファイルを選ぶ」。親がプロジェクトへ取り込んでから参照にする。 */
  onUploadReference: (file: File) => void
  referenceBusy?: boolean
}) {
  const uid = useId()
  const fileRef = useRef<HTMLInputElement | null>(null)
  const set = <K extends keyof BannerGenerationInput>(key: K, next: BannerGenerationInput[K]) =>
    onChange({ ...value, [key]: next })

  const selectedPreset = presets.find((p) => p.key === value.presetKey)

  return (
    <aside
      data-design-node="GcJHv"
      className="flex w-full shrink-0 flex-col self-start rounded-card border border-hairline bg-canvas xl:sticky xl:top-4"
      style={{ maxWidth: 390 }}
      aria-label="画像を生成"
    >
      <div className="flex min-h-14 flex-wrap items-center gap-2 px-4 py-2">
        <Sparkles aria-hidden="true" className="h-4.5 w-4.5 text-ink-faint" />
        <h2 className="text-body font-bold text-ink">画像を生成</h2>
        <span className="flex-1" />
        <RadioCardGroup legend="生成のしかた" className="flex flex-wrap gap-1">
          <ModeOption
            name={`${uid}-mode`}
            value="banner"
            checked={value.mode === 'banner'}
            disabled={disabled}
            onSelect={() => set('mode', 'banner')}
            label="バナー"
          />
          <ModeOption
            name={`${uid}-mode`}
            value="free"
            checked={value.mode === 'free'}
            disabled={disabled}
            onSelect={() => set('mode', 'free')}
            label="自由入力"
          />
        </RadioCardGroup>
      </div>
      <div className="border-t border-hairline" />

      <div data-design-node="E8oZc" className="flex flex-col gap-4 p-4">
        <OutputSize
          name={`${uid}-preset`}
          presets={presets}
          value={value.presetKey}
          disabled={disabled}
          onSelect={(key) => set('presetKey', key)}
        />

        {selectedPreset ? (
          <Field
            label="切り抜きの位置"
            note="生成後に用途の寸法へ整える"
            help={
              <HelpTip label="切り抜きの位置の説明">
                生成は3種類の大きさだけなので、用途の寸法に合うよう切り抜きます。選んだ側を残します。
              </HelpTip>
            }
          >
            <fieldset className="grid grid-cols-3 gap-1.5" disabled={disabled}>
              <legend className="sr-only">切り抜きの位置</legend>
              {CROP_POSITION_OPTIONS.map((option) => (
                <SegmentOption
                  key={option.value}
                  name={`${uid}-crop`}
                  value={option.value}
                  checked={value.cropPosition === option.value}
                  onSelect={() => set('cropPosition', option.value)}
                  label={option.label}
                />
              ))}
            </fieldset>
            <CropPreview preset={selectedPreset} crop={value.cropPosition} />
          </Field>
        ) : null}

        {/*
          参照画像（承認済み ★BG-B `L1ax1Y`）。最大 3 枚で、1 枚ずつ使い方を決める。
          使い方の意味は下の説明（★BG-B `R6MBHf`）に出し、選ぶ前から読めるようにする。
        */}
        <Field label="参照画像" note={`任意・最大 ${BANNER_MAX_REFERENCE_IMAGES} 枚`}>
          <div data-design-node="L1ax1Y" className="flex flex-col gap-2">
            {value.references.map((entry, index) => {
              const image = referenceImages.find((candidate) => candidate.id === entry.imageId) ?? null
              const name = image ? referenceTitle(image) : `${index + 1}枚目`
              return (
                <div
                  key={entry.imageId}
                  data-design-node="hGpey"
                  className="flex flex-wrap items-center gap-3 rounded-control border border-hairline bg-surface-pearl px-3 py-2.5"
                >
                  {/* 統括の画像は Worker から配信されるので next/image の最適化は使わない（image-tile と同じ） */}
                  {image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={image.media.url} alt="" className="h-12 w-12 shrink-0 rounded-mini bg-step-idle object-cover" />
                  ) : (
                    <span className="h-12 w-12 shrink-0 rounded-mini bg-step-idle" />
                  )}
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <p className="truncate text-label font-medium text-ink">{name}</p>
                    <p className="truncate text-micro text-ink-faint">{image ? tileCaption(image, presets) : `${index + 1}枚目`}</p>
                  </div>
                  <Select
                    aria-label={`${name}の使い方`}
                    className="w-44"
                    value={entry.mode}
                    disabled={disabled || referenceBusy}
                    onChange={(next) =>
                      set(
                        'references',
                        value.references.map((other) =>
                          other.imageId === entry.imageId ? { ...other, mode: next as BannerReferenceMode } : other,
                        ),
                      )
                    }
                    options={BANNER_REFERENCE_MODES.map((mode) => ({ value: mode, label: BANNER_REFERENCE_MODE_LABEL[mode] }))}
                  />
                  <Button
                    disabled={disabled || referenceBusy}
                    aria-label={`${name}を外す`}
                    onClick={() => set('references', value.references.filter((other) => other.imageId !== entry.imageId))}
                  >
                    外す
                  </Button>
                </div>
              )
            })}

            {value.references.length < BANNER_MAX_REFERENCE_IMAGES ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <Button disabled={disabled || referenceBusy} onClick={onPickReference} className="w-full">
                    <Images aria-hidden="true" className="h-4 w-4" />
                    ライブラリから選ぶ
                  </Button>
                  <Button disabled={disabled || referenceBusy} onClick={() => fileRef.current?.click()} className="w-full" busy={referenceBusy} busyLabel="取り込んでいます…">
                    <Upload aria-hidden="true" className="h-4 w-4" />ファイルを選ぶ
                  </Button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="sr-only"
                    aria-label="参照画像のファイルを選ぶ"
                    onChange={(event) => {
                      const file = event.target.files?.[0]
                      event.target.value = ''
                      if (file) onUploadReference(file)
                    }}
                  />
                </div>
                {value.references.length === 0 ? (
                  <p className="text-micro text-ink-faint">
                    {`ライブラリの画像か、手元の画像（PNG・JPEG・WebP、10MB まで）を ${BANNER_MAX_REFERENCE_IMAGES} 枚まで選べます。`}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-micro text-ink-faint">
                {`参照画像は ${BANNER_MAX_REFERENCE_IMAGES} 枚までです。入れ替えるときは、どれかを外してください。`}
              </p>
            )}

            {/* 使い方の説明（★BG-B `R6MBHf`）。3 つの違いをここで読み切れるようにする。 */}
            <div data-design-node="R6MBHf" className="flex flex-col gap-1 rounded-control bg-canvas-sunken p-3">
              <p className="text-micro font-medium text-ink">{`使い方は ${BANNER_REFERENCE_MODES.length} つから選べます`}</p>
              <ul className="flex flex-col gap-0.5">
                {BANNER_REFERENCE_MODES.map((mode) => (
                  <li key={mode} className="text-micro text-ink-faint">
                    <span className="font-medium text-ink-secondary">{BANNER_REFERENCE_MODE_LABEL[mode]}</span>
                    ：{BANNER_REFERENCE_MODE_DESCRIPTION[mode]}
                  </li>
                ))}
              </ul>
            </div>
          </div>
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
                    className="inline-flex items-center gap-1 self-start text-caption font-semibold text-action hover:underline disabled:opacity-50"
                  >
                    <Plus aria-hidden="true" className="h-3.5 w-3.5" />
                    行を足す
                  </button>
                ) : null}
              </div>
            </Field>

            <ColorRoles value={value} onPick={(key, next) => set(key, next)} disabled={disabled} />

            <Field label="人物">
              <fieldset className="grid grid-cols-2 gap-1.5" disabled={disabled}>
                <legend className="sr-only">人物</legend>
                <SegmentOption name={`${uid}-person`} value="without" checked={value.personOption === 'without'} onSelect={() => set('personOption', 'without')} label="入れない" />
                <SegmentOption name={`${uid}-person`} value="with" checked={value.personOption === 'with'} onSelect={() => set('personOption', 'with')} label="入れる" />
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
                value={String(n)}
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

/** 参照画像の見出し。ファイル名から拡張子を落とす（「春のキャンペーン-1」「chirashi」）。 */
function referenceTitle(image: BannerImage): string {
  return image.media.filename.replace(/\.[a-z0-9]+$/i, '') || '画像'
}

function Field({
  label,
  note,
  htmlFor,
  help,
  children,
}: {
  label: string
  note?: string
  htmlFor?: string
  help?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="text-label font-medium text-ink">{label}</label>
        ) : (
          <span className="text-label font-medium text-ink">{label}{help ? <span className="ml-1">{help}</span> : null}</span>
        )}
        {note ? <span className="text-micro text-ink-faint">{note}</span> : null}
      </div>
      {children}
    </div>
  )
}

/**
 * 切り抜きのプレビュー（R120）。生成元の枠（APIの大きさの比率）の中に、
 * 用途の寸法の比率の窓を、選んだ位置（上・中央・下）で置く。
 * 縦横比が同じ用途では窓が枠いっぱいになる（切り抜き無し・拡大だけ）。
 */
export function CropPreview({ preset, crop }: { preset: BannerPreset; crop: BannerCropPosition }) {
  const api = /^(\d+)x(\d+)$/.exec(preset.apiSize)
  const sourceW = api ? Number(api[1]) : preset.targetWidth
  const sourceH = api ? Number(api[2]) : preset.targetHeight
  // cover で用途寸法へ拡大したとき、元画像のどの範囲が残るか。
  const scale = Math.max(preset.targetWidth / sourceW, preset.targetHeight / sourceH)
  const windowW = Math.min((preset.targetWidth / (sourceW * scale)) * 100, 100)
  const windowH = Math.min((preset.targetHeight / (sourceH * scale)) * 100, 100)
  const top = crop === 'top' ? 0 : crop === 'bottom' ? 100 - windowH : (100 - windowH) / 2
  const left = (100 - windowW) / 2
  return (
    <div>
      <div
        role="img"
        aria-label={`生成後にこの範囲で${preset.targetWidth}×${preset.targetHeight}に整えます`}
        className="relative w-full overflow-hidden rounded-mini bg-canvas-sunken"
        style={{ aspectRatio: `${sourceW} / ${sourceH}` }}
      >
        <div
          aria-hidden="true"
          className="absolute border-2 border-dashed border-ink-faint bg-canvas"
          style={{ width: `${windowW}%`, height: `${windowH}%`, top: `${top}%`, left: `${left}%` }}
        />
      </div>
      <p className="mt-1 text-micro text-ink-faint">
        生成後にこの範囲で{preset.targetWidth}×{preset.targetHeight}に整えます
      </p>
    </div>
  )
}

/**
 * 出力サイズ。Pencil ★BG-B `xy4EW`。
 *
 * LINE の規格を2列のカードで並べ、選んだカードを淡い緑にする（共通のラジオカード）。
 * Instagram・X・OGP などは普段使わないので、最初は畳んで「ほかの用途から選ぶ」の
 * 1行だけ置く。畳んだ中に選択中の規格が入っている場合（「同じ設定でもう一度」など）は
 * 開いた状態で出す。選べない選択肢は描かない（`docs/v6-common-rules.md` §5-5）。
 */
function OutputSize({
  name,
  presets,
  value,
  disabled,
  onSelect,
}: {
  name: string
  presets: BannerPreset[]
  value: string
  disabled?: boolean
  onSelect: (key: string) => void
}) {
  const [opened, setOpened] = useState(false)
  const groups = groupPresets(presets)
  const line = groups.find((g) => g.group === 'line')?.items ?? []
  const others = groups.find((g) => g.group === 'sns')?.items ?? []
  const showOthers = opened || others.some((p) => p.key === value)

  return (
    <div data-design-node="xy4EW" className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-label font-medium text-ink">出力サイズ</span>
        <span className="text-micro text-ink-faint">LINEの規格から選ぶ</span>
      </div>
      <RadioCardGroup legend="出力サイズ" className="grid grid-cols-2 gap-2">
        {[...line, ...(showOthers ? others : [])].map((preset) => (
          <RadioCard
            key={preset.key}
            name={name}
            value={preset.key}
            checked={value === preset.key}
            disabled={disabled}
            onChange={onSelect}
            title={presetCardLabel(preset)}
            note={presetSizeLabel(preset)}
          />
        ))}
      </RadioCardGroup>
      {showOthers ? null : (
        <Button
          variant="secondary"
          size="compact"
          className="w-full justify-center"
          disabled={disabled}
          onClick={() => setOpened(true)}
        >
          <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />
          ほかの用途から選ぶ（Instagram・X・OGPなど）
        </Button>
      )}
    </div>
  )
}

/** モード切替の1つ。Pencil `h9nAp5`。共通の選ぶ部品で出す。 */
function ModeOption({ name, value, checked, disabled, onSelect, label }: { name: string; value: string; checked: boolean; disabled?: boolean; onSelect: () => void; label: string }) {
  return (
    <RadioCard name={name} value={value} checked={checked} disabled={disabled} onChange={onSelect} title={label} />
  )
}

/** 人物・枚数の選択肢。Pencil `UgooV` / `ndNQM`。共通の選ぶ部品で出す。 */
function SegmentOption({ name, value, checked, onSelect, label }: { name: string; value: string; checked: boolean; onSelect: () => void; label: string }) {
  return (
    <RadioCard name={name} value={value} checked={checked} onChange={onSelect} title={label} />
  )
}

/**
 * 色の4つの役割。Pencil ★BG-B `KkTNS`。
 *
 * ベース＝背景、メイン＝主役、サブ＝差し色、強調＝目立たせたい文字。
 * 色そのものは共通の「色を選ぶ」（★BG-2 `P8ZUj`）で選ぶ。
 */
export function ColorRoles({
  value,
  onPick,
  disabled,
}: {
  value: BannerGenerationInput
  onPick: (key: BannerColorRoleKey, next: string | null) => void
  disabled?: boolean
}) {
  // いま使っている色を「このデザインの色」として見せ、役割どうしで使い回せるようにする。
  const used = Array.from(new Set(COLOR_ROLES.map((role) => value[role.key]).filter((c): c is string => Boolean(c))))
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-label font-medium text-ink">カラー</span>
        <span className="text-micro text-ink-faint">4つの役割で指定します</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {COLOR_ROLES.map((role) => (
          <div key={role.key} className="flex flex-col gap-1.5">
            <span className="text-label font-medium text-ink">{role.label}</span>
            <ColorWell
              block
              label={role.label}
              value={value[role.key] ?? null}
              fallback={role.sample}
              savedColors={used}
              disabled={disabled}
              onChange={(next) => onPick(role.key, next)}
            />
          </div>
        ))}
      </div>
      {/* 補足（Pencil `pQlYK`）。色の役割の意味を言葉で置いておく。 */}
      <div className="rounded-mini bg-canvas-sunken p-3">
        <p className="text-label font-semibold text-ink">色の決め方</p>
        <p className="mt-1 text-micro text-ink-secondary">
          色をタップすると、好きな色を選べる画面が開きます。画面の中の色をそのまま拾うスポイトも使えます。ベースは背景、メインは主役、サブは差し色、強調は特に目立たせたい文字に使います。
        </p>
      </div>
    </div>
  )
}
