'use client'

/**
 * オプション設定。
 *
 * 1問ずつの設定ではなく、フォーム全体にかかるもの（送ったあとどうするか、
 * いつまで受け付けるか、何回まで答えられるか）をここに集める。
 *
 * 編集画面の本体に並べると、ブロックを並べ替える作業の邪魔になる。
 * 触る頻度が低いので、開いたときだけ出す。
 */

import type { FormOptions } from '@line-crm/shared'
import styles from './options-dialog.module.css'
import { AfterActionsSection, ReceptionSection, ThanksSection, WordsSection } from './options-sections'
import type { FormRefs } from './form-refs'
import Button from '@/components/shared/button'
import { useOverlayFocus } from '@/components/shared/overlay-utils'

export default function OptionsDialog({
  value,
  refs,
  onChange,
  onClose,
  onSave,
}: {
  value: FormOptions
  refs: FormRefs
  onChange: (next: FormOptions) => void
  onClose: () => void
  onSave: () => Promise<void>
}) {
  const patch = (next: Partial<FormOptions>) => onChange({ ...value, ...next })
  /*
   * R198: 開いている間はTab/Shift+Tabを窓の中に閉じ込め、Escで閉じる。
   * 呼び出し元（編集画面）は条件付きで描画しているので、描画中＝開いている。
   * 閉じたあとのフォーカスは、開く前の場所（公開ボタンなど）へ戻す。
   * 共通の窓制御と同じ作法にする（shared/overlay-utils）。
   */
  const panelRef = useOverlayFocus(true, onClose)

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4"
      style={{ background: 'color-mix(in srgb, var(--color-ink) 40%, transparent)' }}
      role="dialog"
      aria-modal="true"
      aria-label="オプション設定"
    >
      {/*
        R26: 高さ900・幅880の固定をやめる。390pxの画面では窓が画面の外へ出て、
        閉じる口まで届かなかった。縦は画面に収め、中身だけを中で流す。
        寸法は options-dialog.module.css にだけ置く（任意値にしない）。
      */}
      <div
        ref={panelRef}
        className={`bg-canvas flex w-full flex-col overflow-hidden rounded-panel shadow-float ${styles.panel}`}
      >
        <div className="border-hairline flex shrink-0 items-center justify-between border-b px-5 py-3">
          <div>
            <h2 className="text-ink text-base font-bold">オプション設定</h2>
            <p className="mt-0.5 text-xs text-ink-faint">答え終わったあとの動きと、受付のきまり</p>
          </div>
          <button type="button" onClick={onClose} aria-label="閉じる" className="text-ink-faint hover:text-ink px-2 text-lg">
            ×
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 sm:px-6">
          <ThanksSection value={value} onChange={patch} />
          <AfterActionsSection value={value} refs={refs} onChange={patch} />
          <ReceptionSection value={value} onChange={patch} />
          <WordsSection value={value} onChange={patch} />
        </div>

        <div className="border-hairline flex shrink-0 justify-end gap-2 border-t px-5 py-3">
          <Button variant="primary" onClick={() => void onSave()}>
            保存する
          </Button>
        </div>
      </div>
    </div>
  )
}
