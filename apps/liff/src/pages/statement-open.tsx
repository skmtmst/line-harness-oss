import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import LiffLookScope from '../components/liff-look-scope.js';
import LoadingView from '../components/loading-view.js';
import DownloadFailure from '../components/download-failure.js';
import LiffHeader from '../components/ui/liff-header.js';
import StatusView from '../components/ui/status-view.js';
import BottomBar from '../components/ui/bottom-bar.js';
import Button from '../components/ui/button/index.js';
import Card from '../components/ui/card.js';
import { FileDownloadError, type FileFailureKind } from '../lib/file-download-api.js';
import { fetchStatementBlob, issueStatement, type IssuedStatement } from '../lib/statement-download-api.js';
import { logFailure } from '../lib/user-message.js';
import { closeOrBackToLine } from './not-found.js';

type State =
  | { name: 'loading' }
  | { name: 'ready'; issued: IssuedStatement }
  | { name: 'fetching'; issued: IssuedStatement }
  | { name: 'opened'; blobUrl: string }
  | { name: 'failed'; kind: FileFailureKind; waitSeconds?: number };

/**
 * 支払明細の取り直し画面。本文の通知リンク (/liff/statements/<明細ID>) から LINE で本人確認して入る。
 * 状態：本人確認中→取得できます→開いた／期限切れ［もう一度取得］／明細を利用できません／LINEでログイン／通信の失敗。
 * 取得はボタンを押してから (LINE の中のブラウザで確実に開くため)。
 */
export default function StatementOpen() {
  const params = useParams();
  const [search] = useSearchParams();
  const id = params.id ?? search.get('id') ?? '';
  const [state, setState] = useState<State>({ name: 'loading' });
  const generation = useRef(0);
  const blobUrl = useRef<string | null>(null);

  const fail = (err: unknown) => {
    const e = err instanceof FileDownloadError ? err : new FileDownloadError('retry');
    setState({ name: 'failed', kind: e.kind, waitSeconds: e.retryAfterSeconds });
  };

  const load = useCallback(async () => {
    const mine = ++generation.current;
    if (blobUrl.current) { URL.revokeObjectURL(blobUrl.current); blobUrl.current = null; }
    setState({ name: 'loading' });
    try {
      const issued = await issueStatement(id);
      if (mine === generation.current) setState({ name: 'ready', issued });
    } catch (err) {
      logFailure('statement-issue', err);
      if (mine === generation.current) fail(err);
    }
  }, [id]);

  useEffect(() => {
    void load();
    return () => { generation.current++; };
  }, [load]);
  useEffect(() => () => { if (blobUrl.current) URL.revokeObjectURL(blobUrl.current); }, []);

  const open = async (issued: IssuedStatement) => {
    if (!Number.isFinite(Date.parse(issued.expiresAt)) || Date.parse(issued.expiresAt) <= Date.now()) {
      setState({ name: 'failed', kind: 'expired' });
      return;
    }
    const mine = generation.current;
    setState({ name: 'fetching', issued });
    try {
      const blob = await fetchStatementBlob(id, issued);
      if (mine !== generation.current) return;
      const url = URL.createObjectURL(blob);
      blobUrl.current = url;
      setState({ name: 'opened', blobUrl: url });
      window.location.assign(url);
    } catch (err) {
      if (mine !== generation.current) return;
      logFailure('statement-fetch', err);
      fail(err);
    }
  };

  return (
    <LiffLookScope className="min-h-screen bg-canvas">
      <LiffHeader title="支払明細" />
      <div className="mx-auto w-full max-w-md px-4 pt-3 pb-40">
        {state.name === 'loading' && <LoadingView label="本人確認をしています..." />}
        {(state.name === 'ready' || state.name === 'fetching') && (
          <div className="space-y-3.5" data-statement-state={state.name}>
            <Card className="space-y-1 p-4">
              <p className="text-[15px] font-bold text-ink">支払明細</p>
              <p className="text-[13px] text-liff-sub">PDF</p>
            </Card>
            <p className="text-[13px] text-pretty text-liff-sub">ボタンを押すと、明細を開きます。</p>
          </div>
        )}
        {state.name === 'opened' && (
          <div data-statement-state="opened">
            <StatusView tone="success" icon="check" title="明細を開きました" body={'開けないときは、もう一度開いてください。'} />
          </div>
        )}
        {state.name === 'failed' && (
          <div data-statement-state={state.kind}>
            <DownloadFailure
              kind={state.kind}
              waitSeconds={state.waitSeconds}
              onRetry={() => void load()}
              copy={{
                unavailableTitle: '明細を利用できません',
                unavailableBody: 'お店へお問い合わせください',
                expiredRetry: 'もう一度開く',
                expiredBody: 'もう一度開くと、新しいリンクを作ります。',
                unconfiguredBody: 'ただいま開けません。お店へお問い合わせください',
                loginBody: 'LINEでログインして、もう一度お試しください',
                retryBody: '時間をおいて、もう一度お試しください。',
              }}
            />
          </div>
        )}
      </div>
      {(state.name === 'ready' || state.name === 'fetching') && (
        <BottomBar>
          <Button variant="primary" disabled={state.name === 'fetching'} onClick={() => void open(state.issued)}>
            {state.name === 'fetching' ? '開いています...' : '明細を開く'}
          </Button>
        </BottomBar>
      )}
      {state.name === 'opened' && (
        <BottomBar>
          <Button variant="primary" onClick={() => closeOrBackToLine('close')}>閉じる</Button>
          <Button variant="secondary" onClick={() => window.location.assign(state.blobUrl)}>もう一度開く</Button>
        </BottomBar>
      )}
    </LiffLookScope>
  );
}
