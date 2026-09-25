import Icon, { type IconName } from './Icon.js';
import Button from './Button.js';

/**
 * ★V7 の中央寄せの状態 (完了・空・開けない)。
 * 丸い印＋題＋本文＋ボタン1つ。ボタンは action があるときだけ1つ出す。
 */
export default function StatusView({
  icon,
  tone = 'neutral',
  title,
  body,
  action,
}: {
  icon: IconName;
  tone?: 'neutral' | 'success';
  title: string;
  body?: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <span
        className={`flex h-16 w-16 items-center justify-center rounded-full ${
          tone === 'success' ? 'bg-ok-bg text-ok-ink' : 'bg-state-mark text-ink-faint'
        }`}
        aria-hidden="true"
      >
        <Icon name={icon} className="h-7 w-7" />
      </span>
      <p className="mt-4 text-base font-bold text-ink">{title}</p>
      {body && <BodyText text={body} />}
      {action && (
        <div className="mt-6 w-full max-w-60">
          <Button variant="primary" onClick={action.onClick}>
            {action.label}
          </Button>
        </div>
      )}
    </div>
  );
}

function BodyText({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <p className="mt-2 text-sm leading-6 text-pretty text-ink-secondary">
      {lines.map((line, i) => (
        <span key={i}>
          {i > 0 && <br />}
          {line}
        </span>
      ))}
    </p>
  );
}
