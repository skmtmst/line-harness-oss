import type { ReactNode } from 'react';
import Button from './Button.js';
import Icon from './Icon.js';

/**
 * LIFF 共通の確認窓。管理画面の ConfirmDialog と同じ形
 * (題・影響・「やめる」と危ない操作のボタン)。
 *
 * ブラウザの `confirm()` は使わない。見た目が OS 任せで、
 * 何を取り消すのかを読ませられず、押し間違いを止められない。
 * 取り消せない操作 (`destructive`) は赤い実行ボタン＋警告の印にする。
 */
export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = '実行する',
  cancelLabel = 'やめる',
  destructive = false,
  busy = false,
  error,
  children,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  error?: string;
  children?: ReactNode;
  /** 渡さないと実行ボタンそのものを出さない (条件を満たすまで押させない止め方)。 */
  onConfirm?: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-6"
      role="presentation"
      onMouseDown={(event) => {
        if (!busy && event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        role={destructive ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-xs rounded-xl border border-hairline bg-canvas p-5"
      >
        <div className="flex items-start gap-2">
          {destructive ? (
            <span className="shrink-0 text-danger" aria-hidden="true">
              <Icon name="alert-triangle" className="h-5 w-5" />
            </span>
          ) : null}
          <p className="min-w-0 flex-1 text-sm font-bold leading-6 text-ink">{title}</p>
        </div>
        <p className="mt-2 text-sm leading-6 text-ink-secondary">{description}</p>
        {children}
        {error && (
          <p role="alert" className="mt-2 text-sm leading-6 text-danger">
            {error}
          </p>
        )}
        <div className="mt-4 flex gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          {onConfirm ? (
            <Button variant={destructive ? 'danger' : 'primary'} onClick={onConfirm} disabled={busy}>
              {busy ? '処理中…' : confirmLabel}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
