import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import liff from '@line/liff';
import { api } from '../lib/api.js';
import { formatJstEventAt, utcToJstHm } from '../lib/datetime.js';
import { logFailure } from '../lib/user-message.js';
import LiffHeader from '../components/ui/LiffHeader.js';
import LiffLookScope from '../components/LiffLookScope.js';
import StatusView from '../components/ui/StatusView.js';
import BottomBar from '../components/ui/BottomBar.js';
import Button from '../components/ui/Button.js';
import Icon from '../components/ui/Icon.js';

/**
 * 2-c 申し込みが確定した・2-d キャンセル待ちに入った (★V8 qVdiX)。
 * 承認制で承認待ちのときは 2-d と同じ待ちの印で出す (文言は承認待ちのまま)。
 * 上の帯と下の帯の間の真ん中に、丸・題・本文・申し込みの箱を置く。
 * 下の帯は「LINEに戻る」と「自分のイベントを見る」。
 * 絵の「順番 2 番目」「キャンセル待ちをやめる」は、待ちの順番・取り下げの
 * 口が API に無いため出さない (API が入ったら足す)。
 */
export default function EventDone() {
  const { id } = useParams<{ id: string }>();
  const [search] = useSearchParams();
  const { search: locationSearch } = useLocation();
  const navigate = useNavigate();
  const status = search.get('status') ?? '';
  const startsAt = search.get('startsAt') ?? '';

  const isWaitlisted = status === 'waitlisted';
  const isPending = status === 'requested';

  // 箱の「イベント」の行に出す名前。読めなければ行ごと出さない。
  const [eventName, setEventName] = useState<string | null>(null);
  useEffect(() => {
    if (!id) return;
    let alive = true;
    api
      .getEvent(id)
      .then((e) => {
        if (alive) setEventName(e.name);
      })
      .catch((e) => logFailure('event-done-name', e));
    return () => {
      alive = false;
    };
  }, [id]);

  const title = isWaitlisted ? 'キャンセル待ちに入りました' : isPending ? '受付しました' : '申し込みが確定しました';
  const body = isWaitlisted
    ? 'いまは満席です。空きが出たら、LINEでお知らせします。お知らせから24時間以内に「この席を取る」を押すと予約になります'
    : isPending
      ? '運営の承認をお待ちください。承認されると LINE でお知らせします。'
      : startsAt
        ? `${formatJstEventAt(startsAt)}にお待ちしています。\n前日に LINE でお知らせします。`
        : '予約が確定しました。LINE で詳細をお送りしました。';

  function goMine() {
    navigate({ pathname: '/events/me', search: locationSearch });
  }

  return (
    <LiffLookScope className="min-h-screen bg-canvas" designNode="qVdiX">
      <LiffHeader title="イベント" />
      <div className="mx-auto w-full max-w-md pb-[142px]">
        <div className="flex min-h-[calc(100dvh-var(--liff-header-h)-1px-142px)] flex-col items-center justify-center px-6 py-4">
          <StatusView
            large
            icon={isWaitlisted || isPending ? 'hourglass' : 'calendar'}
            tone={isWaitlisted || isPending ? 'wait' : 'success'}
            title={title}
            body={body}
          >
            {eventName && (
              <dl className="w-full rounded-(--liff-radius-lg) border border-liff-line px-3.5 py-1 text-left">
                <div className="flex gap-2 py-2.5">
                  <dt className="w-18 shrink-0 text-xs text-liff-sub">イベント</dt>
                  <dd className="min-w-0 flex-1 text-sm font-semibold text-ink">
                    {/* 1つの文にまとめる (板 qVdiX「秋のわんこ撮影会 11:00〜」)。 */}
                    {`${eventName}${startsAt ? ` ${utcToJstHm(startsAt)}〜` : ''}`}
                  </dd>
                </div>
              </dl>
            )}
          </StatusView>
        </div>
      </div>
      <BottomBar>
        <Button variant="primary" onClick={() => liff.closeWindow()}>
          LINEに戻る
        </Button>
        <Button variant="secondary" onClick={goMine}>
          <Icon name="list" className="h-4 w-4" />
          自分のイベントを見る
        </Button>
      </BottomBar>
    </LiffLookScope>
  );
}
