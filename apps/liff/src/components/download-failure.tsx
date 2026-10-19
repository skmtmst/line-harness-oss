import StatusView from './ui/status-view.js';
import type { FileFailureKind } from '../lib/file-download-api.js';

export interface DownloadFailureCopy {
  unavailableTitle: string;
  unavailableBody: string;
  /** 取得時に元が消えていた (添付だけ)。無ければ開けない扱い。 */
  deletedTitle?: string;
  expiredRetry: string;
  expiredBody: string;
  unconfiguredBody: string;
  loginBody: string;
  retryBody: string;
}

/**
 * 取得に失敗したときの案内 (ファイル・支払明細で共通)。
 * 全部 ★V8 の「灰色の丸の中のアイコン・題・説明・ボタン」の同じ形 (StatusView tone="muted")。
 * 再試行できる状態だけボタンを出す。
 */
export default function DownloadFailure({
  kind, waitSeconds, onRetry, copy,
}: { kind: FileFailureKind; waitSeconds?: number; onRetry: () => void; copy: DownloadFailureCopy }) {
  switch (kind) {
    case 'expired':
      return <StatusView tone="muted" icon="rotate-cw" title="リンクの期限が切れました" body={copy.expiredBody} action={{ label: copy.expiredRetry, onClick: onRetry }} />;
    case 'unavailable':
      return <StatusView tone="muted" icon="link-2-off" title={copy.unavailableTitle} body={copy.unavailableBody} />;
    case 'deleted':
      return <StatusView tone="muted" icon="cloud-off" title={copy.deletedTitle ?? copy.unavailableTitle} body="お店へお問い合わせください。" />;
    case 'unconfigured':
      return <StatusView tone="muted" icon="link-2-off" title={copy.unavailableTitle} body={copy.unconfiguredBody} />;
    case 'login':
      return <StatusView tone="muted" icon="alert-triangle" title="本人確認ができませんでした" body={copy.loginBody} action={{ label: 'もう一度試す', onClick: onRetry }} />;
    case 'wait':
      return <StatusView tone="muted" icon="rotate-cw" title="混み合っています" body={`${waitSeconds ?? 30}秒ほど待ってから、もう一度お試しください。`} action={{ label: 'もう一度試す', onClick: onRetry }} />;
    default:
      return <StatusView tone="muted" icon="wifi-off" title="開けませんでした" body={copy.retryBody} action={{ label: 'もう一度試す', onClick: onRetry }} />;
  }
}
