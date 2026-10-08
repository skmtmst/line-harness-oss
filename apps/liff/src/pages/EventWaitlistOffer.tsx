import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import liff from '@line/liff';
import { api, type EventWaitlistOfferDetail } from '../lib/api.js';
import { formatHoldLeft, formatJstEventAt } from '../lib/datetime.js';
import { logFailure } from '../lib/user-message.js';
import Button from '../components/ui/Button.js';
import BottomBar from '../components/ui/BottomBar.js';
import Icon from '../components/ui/Icon.js';
import LiffHeader from '../components/ui/LiffHeader.js';
import LiffLookScope from '../components/LiffLookScope.js';
import StatusView from '../components/ui/StatusView.js';

/** 繰上げ案内の token だけを外した query（ほかの値は残す）。 */
export function searchWithoutOfferToken(search: string): string {
  const params = new URLSearchParams(search);
  params.delete('eventWaitlistToken');
  const rest = params.toString();
  return rest ? `?${rest}` : '';
}

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

  // 案内の中身 (枠の日時・席の数・取っておく残り時間)。読めなければ本文だけ出す。
  const [offer, setOffer] = useState<EventWaitlistOfferDetail | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .eventWaitlistOffer(token)
      .then((res) => {
        if (alive) setOffer(res.data);
      })
      .catch((e) => logFailure('event-waitlist-offer-detail', e));
    return () => {
      alive = false;
    };
  }, [token]);

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
    // 案内の token を外して移る。残すと App が案内の画面を優先し、
    // 自分のイベントへ移れない（?liffId などほかの値は引き継ぐ）。
    navigate({ pathname: '/events/me', search: searchWithoutOfferToken(search) });
  }

  return (
    <LiffLookScope className="min-h-screen bg-canvas" designNode="BjcuB">
      <LiffHeader title="イベント" />
      <div
        className={`mx-auto w-full max-w-md ${
          state === 'ready' || state === 'submitting'
            ? 'pb-[142px]'
            : 'flex min-h-[calc(100dvh-var(--liff-header-h)-1px)] flex-col justify-center px-4 py-10'
        }`}
      >
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
          <>
            {/* ★V8 (BjcuB)：上の帯と下の帯の間の真ん中に、丸・題・本文・取っておく残り時間を置く。
                案内の中身 (GET /api/liff/events/waitlist/:token) が読めないときは本文だけ。 */}
            <div className="flex min-h-[calc(100dvh-var(--liff-header-h)-1px-142px)] flex-col items-center justify-center px-6 py-4">
              <StatusView
                large
                icon="party-popper"
                tone="success"
                title="空きが出ました"
                body={`${offer ? `${formatJstEventAt(offer.startsAt)}〜 に ${offer.partySize} 席あります。` : ''}下のボタンを押すまで、予約にはなりません。`}
              >
                {offer && offer.remainingSeconds > 0 && (
                  <p className="text-[13px] font-bold whitespace-nowrap text-liff-wait-ink">{`あと ${formatHoldLeft(offer.remainingSeconds)} 取っておきます`}</p>
                )}
              </StatusView>
            </div>
            <BottomBar>
              <Button variant="primary" onClick={accept} disabled={state === 'submitting'}>
                {state === 'submitting' ? '予約を確定しています…' : 'この席を取る'}
              </Button>
              <Button variant="secondary" onClick={() => liff.closeWindow()} disabled={state === 'submitting'}>
                今回は見送る
              </Button>
            </BottomBar>
          </>
        )}
      </div>
    </LiffLookScope>
  );
}
