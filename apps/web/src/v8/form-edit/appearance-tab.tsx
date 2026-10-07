'use client'

/*
 * 「受付と見た目」のタブ（tpRRT）。受付のきまり・色と文字・背景とリンクの見え方・
 * ボタンの言葉。いちばん下に、フォームの名前と覚え書き（お客さまには出ない）。
 * 色と書体の決まり（文字と背景の差 4.5:1）は今までのデザイン設定と同じ。
 */
import { useState } from 'react'
import { Image as ImageIcon, Sparkles, Link2 } from 'lucide-react'
import {
  FORM_THEME_DEFAULT,
  formThemeContrastError,
  normalizeFormTheme,
  type FormCornerRadius,
  type FormFontFamily,
  type FormOptions,
  type FormTheme,
} from '@line-crm/shared'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import ColorWell from '@/components/shared/color-well'
import DateTimeField from '@/components/shared/date-time-field'
import Dialog from '@/components/shared/dialog'
import { TextArea, TextField } from '@/components/shared/text-field'
import Select from '@/components/shared/select'
import Toggle from '@/components/shared/toggle'
import MediaPickerDialog from './media-picker'
import { ogImageUrlError } from './model'
import styles from './edit.module.css'

type ColorKey = keyof Pick<FormTheme, 'main' | 'sub' | 'accent' | 'error' | 'text'>
const COLOR_ROLES: { key: ColorKey; label: string }[] = [
  { key: 'main', label: 'メイン（ボタン・見出し・選択中の枠）' },
  { key: 'sub', label: 'サブ（帯や背景の薄い面）' },
  { key: 'accent', label: 'アクセント（リンクと補足の強調）' },
  { key: 'error', label: 'エラー（入力の間違い）' },
  { key: 'text', label: '文字（本文）' },
]

const FONT_LABEL: Record<FormFontFamily, string> = { sans: 'ゴシック', serif: '明朝' }
const RADIUS_LABEL: Record<FormCornerRadius, string> = { none: '角ばった', medium: 'やや丸い', round: '丸い' }

type Props = {
  options: FormOptions
  accountId: string | null
  name: string
  nameError: string | null
  description: string
  ogTitle: string
  ogDescription: string
  ogImageUrl: string
  onChangeOptions: (next: Partial<FormOptions>) => void
  onChangeName: (next: string) => void
  onChangeDescription: (next: string) => void
  onChangeOgTitle: (next: string) => void
  onChangeOgDescription: (next: string) => void
  onChangeOgImageUrl: (next: string) => void
}

export function AppearanceTab(props: Props) {
  const { options, onChangeOptions } = props
  const theme = options.theme ?? FORM_THEME_DEFAULT
  const contrastError = formThemeContrastError(normalizeFormTheme(theme))
  const [pickerFor, setPickerFor] = useState<'background' | 'ogImage' | null>(null)
  const [linkOpen, setLinkOpen] = useState(false)
  const patchTheme = (next: Partial<FormTheme>) => onChangeOptions({ theme: { ...theme, ...next } })
  const deadlineOn = options.deadline?.enabled ?? false
  const ogImageError = ogImageUrlError(props.ogImageUrl)
  const linkSummary = [props.ogTitle.trim() ? '見出し' : null, props.ogDescription.trim() ? '説明' : null, props.ogImageUrl.trim() ? '画像' : null].filter(Boolean).join('・') || '自動で作る'

  return (
    <>
      <section className={styles.card} aria-labelledby="fe-reception-title">
        <h2 id="fe-reception-title" className={styles.cardTitle}>受付のきまり</h2>
        <div className={styles.periodRow}>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>受付の開始</span>
            {/* 開始の日時を保存する口はまだ無い。公開した時から受け付ける（今の動き）を出す。 */}
            <span className={styles.readonlyBox}>公開したときから</span>
          </div>
          <span className={styles.periodSep} aria-hidden="true">〜</span>
          <div className={styles.field}>
            <span className={styles.fieldLabel} id="fe-deadline-label">受付の終了（空なら終わらない）</span>
            <DateTimeField
              aria-labelledby="fe-deadline-label"
              value={deadlineOn ? (options.deadline?.endsAt ?? '') : ''}
              onChange={(value) => onChangeOptions({ deadline: { ...options.deadline, enabled: Boolean(value), endsAt: value || null } })}
            />
          </div>
        </div>
        <div className={styles.toggleRow}>
          <span>1人1回だけ答えられる</span>
          <Toggle checked={options.oncePerFriend?.enabled ?? false} onChange={(enabled) => onChangeOptions({ oncePerFriend: { ...options.oncePerFriend, enabled } })} label="1人1回だけ答えられる" />
        </div>
        <div className={styles.toggleRow}>
          <span>{`答えの数が ${(options.totalLimit?.max ?? 300).toLocaleString('ja-JP')}件 になったら締め切る`}</span>
          <Toggle
            checked={options.totalLimit?.enabled ?? false}
            onChange={(enabled) => onChangeOptions({ totalLimit: { ...options.totalLimit, enabled, max: options.totalLimit?.max ?? 300 } })}
            label="答えの数が上限になったら締め切る"
          />
        </div>
        {options.totalLimit?.enabled ? (
          <div className={styles.limitRow}>
            <label className={styles.fieldLabel} htmlFor="fe-total-limit">締め切る件数</label>
            <TextField
              id="fe-total-limit"
              type="number"
              min={1}
              className={styles.limitInput}
              value={String(options.totalLimit?.max ?? 300)}
              onChange={(e) => onChangeOptions({ totalLimit: { ...options.totalLimit, enabled: true, max: Math.max(1, Number(e.target.value) || 1) } })}
            />
          </div>
        ) : null}
      </section>

      <section className={styles.card} aria-label="受付のつづきと見た目">
        <div className={styles.subBox}>
          <h3 className={styles.subTitle}>受付のきまり（つづき）</h3>
          <Checkbox checked={options.restorePrevious ?? false} onCheckedChange={(restorePrevious) => onChangeOptions({ restorePrevious })}>前回の答えを最初から入れておく</Checkbox>
          <Checkbox checked={options.confirmDialog?.enabled ?? false} onCheckedChange={(enabled) => onChangeOptions({ confirmDialog: { ...options.confirmDialog, enabled } })}>送る前に確認の画面を出す</Checkbox>
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="fe-deadline-message">期限を過ぎた人に出す文</label>
            <TextField id="fe-deadline-message" value={options.deadline?.message ?? ''} placeholder="受付は終了しました" onChange={(e) => onChangeOptions({ deadline: { ...options.deadline, enabled: options.deadline?.enabled ?? false, message: e.target.value } })} />
          </div>
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="fe-page-title">ページの題名（LINE の上に出る）</label>
            <TextField id="fe-page-title" value={options.pageTitle ?? ''} placeholder="回答フォーム" onChange={(e) => onChangeOptions({ pageTitle: e.target.value || null })} />
          </div>
        </div>

        <div className={styles.subBox}>
          <h3 className={styles.subTitle}>色と文字</h3>
          <p className={styles.fieldLabelPlain}>色（5つの役割）</p>
          <div className={styles.wells}>
            {COLOR_ROLES.map((role) => (
              <span key={role.key} className={styles.well}>
                <ColorWell value={theme[role.key]} allowAlpha={false} allowClear={false} label={`${role.label}の色`} onChange={(color) => color && patchTheme({ [role.key]: color.slice(0, 7).toLowerCase() })} />
                <span className={styles.wellLabel}>{role.label}</span>
              </span>
            ))}
          </div>
          {contrastError ? <p role="alert" className={styles.fieldError}>{contrastError}</p> : null}
          <span>
            <Button
              onClick={() => patchTheme({ main: FORM_THEME_DEFAULT.main, sub: FORM_THEME_DEFAULT.sub, accent: FORM_THEME_DEFAULT.accent, error: FORM_THEME_DEFAULT.error, text: FORM_THEME_DEFAULT.text })}
              title="5つの色だけを初期の組合せにします。書体・角の丸み・背景画像は変わりません。"
            >
              <Sparkles size={15} aria-hidden="true" />
              おまかせで組む
            </Button>
          </span>
          <div className={styles.tight}>
            <Select
              aria-label="書体"
              size="full"
              value={theme.fontFamily}
              onChange={(value) => patchTheme({ fontFamily: value as FormFontFamily })}
              options={(Object.keys(FONT_LABEL) as FormFontFamily[]).map((key) => ({ value: key, label: `書体：${FONT_LABEL[key]}` }))}
            />
            <Select
              aria-label="角の丸み"
              size="full"
              value={theme.cornerRadius}
              onChange={(value) => patchTheme({ cornerRadius: value as FormCornerRadius })}
              options={(Object.keys(RADIUS_LABEL) as FormCornerRadius[]).map((key) => ({ value: key, label: `角の丸み：${RADIUS_LABEL[key]}` }))}
            />
          </div>
        </div>

        <div className={styles.subBox}>
          <h3 className={styles.subTitle}>背景とリンクの見え方</h3>
          <div className={styles.tight}>
            <span className={styles.inlineButtons}>
              <Button onClick={() => setPickerFor('background')}>
                <ImageIcon size={15} aria-hidden="true" />
                {theme.backgroundImageUrl ? '背景の画像を選び直す' : '背景の画像を選ぶ'}
              </Button>
              {theme.backgroundImageUrl ? <Button variant="text" onClick={() => patchTheme({ backgroundImageUrl: null })}>画像を外す</Button> : null}
            </span>
            <button type="button" className={styles.selectLike} onClick={() => setLinkOpen(true)} aria-haspopup="dialog">
              <span>{`リンクの見え方：${linkSummary}`}</span>
              <Link2 size={14} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className={styles.cardHeadText}>
          <h2 className={styles.cardTitle}>ボタンの言葉</h2>
        </div>
        <div className={styles.wordsHead} aria-hidden="true">
          <span>前へ</span>
          <span>次へ</span>
          <span>送る</span>
        </div>
        <div className={styles.wordsRow}>
          <TextField aria-label="前へボタンの文字" value={options.prevLabel ?? ''} placeholder="前へ" onChange={(e) => onChangeOptions({ prevLabel: e.target.value })} />
          <TextField aria-label="次へボタンの文字" value={options.nextLabel ?? ''} placeholder="次へ" onChange={(e) => onChangeOptions({ nextLabel: e.target.value })} />
          <TextField aria-label="送るボタンの文字" value={options.submitLabel ?? ''} placeholder="送信する" onChange={(e) => onChangeOptions({ submitLabel: e.target.value })} />
        </div>
      </section>

      <section className={styles.card} aria-labelledby="fe-about-title">
        <div className={styles.cardHeadText}>
          <h2 id="fe-about-title" className={styles.cardTitle}>フォームのこと</h2>
          <p className={styles.cardNote}>名前は一覧と題に出ます。覚え書きはお客さまには出ません。</p>
        </div>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="fe-name">フォーム名</label>
          <TextField id="fe-name" value={props.name} invalid={Boolean(props.nameError)} onChange={(e) => props.onChangeName(e.target.value)} />
          {props.nameError ? <p role="alert" className={styles.fieldError}>{props.nameError}</p> : null}
        </div>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="fe-desc">覚え書き</label>
          <TextArea id="fe-desc" rows={2} value={props.description} onChange={(e) => props.onChangeDescription(e.target.value)} />
        </div>
      </section>

      <Dialog open={linkOpen} title="リンクの見え方" description="LINEやSNSにこのフォームのURLを貼ったときに出るカードです。空のままなら自動で作ります。" confirmLabel="閉じる" onConfirm={() => setLinkOpen(false)} onCancel={() => setLinkOpen(false)}>
        <div className={styles.dialogFields}>
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="fe-og-title">カードの見出し</label>
            <TextField id="fe-og-title" maxLength={80} value={props.ogTitle} onChange={(e) => props.onChangeOgTitle(e.target.value)} />
          </div>
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="fe-og-desc">カードの説明</label>
            <TextArea id="fe-og-desc" rows={3} maxLength={200} value={props.ogDescription} onChange={(e) => props.onChangeOgDescription(e.target.value)} />
          </div>
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="fe-og-image">カードの画像URL</label>
            <TextField id="fe-og-image" type="url" inputMode="url" placeholder="https://" value={props.ogImageUrl} invalid={Boolean(ogImageError)} onChange={(e) => props.onChangeOgImageUrl(e.target.value)} />
            {ogImageError ? <p role="alert" className={styles.fieldError}>{ogImageError}</p> : null}
          </div>
          <span>
            <Button onClick={() => setPickerFor('ogImage')}>
              <ImageIcon size={15} aria-hidden="true" />
              登録メディアから選ぶ
            </Button>
          </span>
        </div>
      </Dialog>

      <MediaPickerDialog
        open={pickerFor !== null}
        accountId={props.accountId}
        kind="image"
        onClose={() => setPickerFor(null)}
        onSelect={(item) => {
          // 配信用の公開URLを保存値へ入れる（管理画面の表示用URLではない）。
          if (pickerFor === 'background') patchTheme({ backgroundImageUrl: item.url })
          else if (pickerFor === 'ogImage') props.onChangeOgImageUrl(item.url)
          setPickerFor(null)
        }}
      />
    </>
  )
}
