import Icon, { type IconName } from './Icon.js';
import Button from './Button.js';

/**
 * ★V8 の中央寄せの状態 (完了・待ち・空・開けない)。
 * 印＋題＋本文＋ボタン1つ。ボタンは action があるときだけ1つ出す。
 * 印は success だけ緑の丸。それ以外は灰色の線の印をそのまま置く
 * (ADutg・zz9R3 と同じ形)。ウェビナーの暗い地では dark を渡す。
 * 待ち (キャンセル待ち・承認待ち) は tone="wait" で黄土色の丸にする。
 */
export default function StatusView({
  icon,
  tone = 'neutral',
  dark = false,
  title,
  body,
  action,
}: {
  icon: IconName;
  tone?: 'neutral' | 'success' | 'wait';
  dark?: boolean;
  title: string;
  body?: string;
  action?: { label: string; onClick: () => void };
}) {
  const mark =
    tone === 'success' ? (
      <span
        className="flex h-18 w-18 items-center justify-center rounded-full bg-[var(--liff-look-soft)] text-[var(--liff-look-main)]"
        aria-hidden="true"
      >
        <Icon name={icon} className="h-9 w-9" />
      </span>
    ) : tone === 'wait' ? (
      <span
        className="flex h-18 w-18 items-center justify-center rounded-full bg-[var(--liff-look-wait-bg)] text-[var(--liff-look-wait-ink)]"
        aria-hidden="true"
      >
        <Icon name={icon} className="h-8 w-8" />
      </span>
    ) : (
      <span className={dark ? 'text-night-faint' : 'text-[var(--liff-look-idle)]'} aria-hidden="true">
        <Icon name={icon} className="h-10 w-10" />
      </span>
    );
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      {mark}
      <p
        className={`mt-4 text-[17px] font-bold ${dark ? 'text-canvas' : 'text-[var(--liff-look-ink)]'}`}
        style={dark ? undefined : { fontFamily: 'var(--liff-look-font-heading)' }}
      >
        {title}
      </p>
      {body && <BodyText text={body} dark={dark} />}
      {action && (
        <div className="mt-6 w-full max-w-55">
          <Button variant="primary" onClick={action.onClick}>
            {action.label}
          </Button>
        </div>
      )}
    </div>
  );
}

function BodyText({ text, dark = false }: { text: string; dark?: boolean }) {
  const lines = text.split('\n');
  return (
    <p
      className={`mt-2 text-[13px] leading-6 text-pretty ${dark ? 'text-night-faint' : 'text-[var(--liff-look-sub)]'}`}
    >
      {lines.map((line, i) => (
        <span key={i}>
          {i > 0 && <br />}
          {line}
        </span>
      ))}
    </p>
  );
}
