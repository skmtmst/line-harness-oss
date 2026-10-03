import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import liff from '@line/liff';
import { api } from '../lib/api.js';
import { logFailure } from '../lib/user-message.js';
import Button from '../components/ui/Button.js';
import BottomBar from '../components/ui/BottomBar.js';
import Icon from '../components/ui/Icon.js';
import LiffHeader from '../components/ui/LiffHeader.js';
import StatusView from '../components/ui/StatusView.js';

type State = 'ready' | 'submitting' | 'confirmed' | 'expired' | 'unavailable' | 'error';

/**
 * キャンセル待ちの繰上げ承諾。LINE の案内から token で開く。
 * 状態の分け方 (成功・期限切れ・利用不能・失敗) はそのまま。
 * 失敗のときは行き止まりにせず、もう一度試せるボタンを出す。
 * 見た目だけ ★V7 (主ボタン1つ・札の代わりに印＋文)。
 */
export default function EventWaitlistOffer({ token }: { token: string }) {
  const [state, setState] = useState<State>('ready');
  const navigate = useNavigate();
  // ?liffId=... を引き継ぐ (再読み込みで失わない)。
  const { search } = useLocation();

  const accept = async () => {
    if (state === 'submitting' || state === 'confirmed') return;
    setState('submitting');
    try {
      await api.acceptEventWaitlistOffer(token);
      setState('confirmed');
    } catch (error) {
      logFailure('accept-event-waitlist-offer', error);
      const status = (error as { status?: number }).status;
      if (status === 410) setState('expired');
      else if (status === 404 || status === 409) setState('unavailable');
      else setState('error');
    }
  };

  function goMine() {
    navigate({ pathname: '/events/me', search });
  }

  return (
    <div
      className="min-h-screen bg-ground"
      data-design-node="BjcuB"
      style={{ fontFamily: 'var(--liff-look-font-body)' }}
    >
      <LiffHeader title="イベント" />
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-10">
        {state === 'confirmed' ? (
          <div className="space-y-4">
            <StatusView
              icon="calendar"
              tone="success"
              title="予約が確定しました"
              body="キャンセル待ちの席を予約しました。詳しい内容は自分のイベントで確認できます。"
            />
            <Button variant="secondary" onClick={goMine}>
              <Icon name="list" className="h-4 w-4" />
              自分のイベントを見る
            </Button>
          </div>
        ) : state === 'expired' ? (
          <div className="space-y-4">
            <StatusView
              icon="hourglass"
              tone="wait"
              title="回答期限を過ぎています"
              body="席は次の方へ案内されました。"
            />
            <Button variant="secondary" onClick={goMine}>
              <Icon name="list" className="h-4 w-4" />
              自分のイベントを見る
            </Button>
          </div>
        ) : state === 'unavailable' ? (
          <div className="space-y-4">
            <StatusView
              icon="calendar"
              title="この案内は使えませんでした"
              body="この案内はすでに利用済みか、席を確保できませんでした。"
            />
            <Button variant="secondary" onClick={goMine}>
              <Icon name="list" className="h-4 w-4" />
              自分のイベントを見る
            </Button>
          </div>
        ) : state === 'error' ? (
          <div className="space-y-4">
            <StatusView
              icon="cloud-off"
              title="送信できませんでした"
              body="通信に失敗しました。時間を置いて、もう一度お試しください。"
            />
            <Button variant="secondary" onClick={accept}>
              <Icon name="rotate-cw" className="h-4 w-4" />
              もう一度試す
            </Button>
          </div>
        ) : (
          <div className="pb-28">
            <div className="flex flex-col items-center px-6 py-10 text-center">
              <span
                className="flex h-18 w-18 items-center justify-center rounded-full bg-[var(--liff-look-soft)] text-[var(--liff-look-main)]"
                aria-hidden="true"
              >
                <Icon name="circle-check" className="h-9 w-9" />
              </span>
              <p
                className="mt-4 text-xl font-bold text-[var(--liff-look-ink)]"
                style={{ fontFamily: 'var(--liff-look-font-heading)' }}
              >
                空きが出ました
              </p>
              <p className="mt-2 text-[13px] leading-6 text-pretty text-[var(--liff-look-sub)]">
                下のボタンを押すと予約が確定します。
                <br />
                押すまでは予約になりません。
              </p>
            </div>
            <BottomBar>
              <Button variant="primary" onClick={accept} disabled={state === 'submitting'}>
                {state === 'submitting' ? '予約を確定しています…' : 'この席を取る'}
              </Button>
              <Button variant="secondary" onClick={() => liff.closeWindow()} disabled={state === 'submitting'}>
                今回は見送る
              </Button>
            </BottomBar>
          </div>
        )}
      </div>
    </div>
  );
}
