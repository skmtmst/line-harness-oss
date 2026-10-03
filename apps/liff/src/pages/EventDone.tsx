import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { formatJstEventAt } from '../lib/datetime.js';
import LiffHeader from '../components/ui/LiffHeader.js';
import StatusView from '../components/ui/StatusView.js';
import Button from '../components/ui/Button.js';
import Icon from '../components/ui/Icon.js';

/**
 * 2-c 申し込みが確定した・2-d キャンセル待ちに入った。
 * 承認制で承認待ちのときは 2-d と同じ待ちの印で出す (文言は承認待ちのまま)。
 * 進む先は「自分のイベントを見る」1つだけ。
 */
export default function EventDone() {
  const [search] = useSearchParams();
  const { search: locationSearch } = useLocation();
  const navigate = useNavigate();
  const status = search.get('status') ?? '';
  const startsAt = search.get('startsAt') ?? '';

  const isWaitlisted = status === 'waitlisted';
  const isPending = status === 'requested';

  const title = isWaitlisted ? 'キャンセル待ちに入りました' : isPending ? '受付しました' : '申し込みが確定しました';
  const body = isWaitlisted
    ? 'まだ参加は決まっていません。\n席が空いたら LINE でお知らせします。お知らせから参加を決めると確定します。'
    : isPending
      ? '運営の承認をお待ちください。承認されると LINE でお知らせします。'
      : startsAt
        ? `${formatJstEventAt(startsAt)}にお待ちしています。\n前日に LINE でお知らせします。`
        : '予約が確定しました。LINE で詳細をお送りしました。';

  function goMine() {
    navigate({ pathname: '/events/me', search: locationSearch });
  }

  return (
    <div className="min-h-screen bg-ground" data-design-node="qVdiX">
      <LiffHeader title="イベント" />
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-10">
        <StatusView
          icon={isWaitlisted || isPending ? 'hourglass' : 'calendar'}
          tone={isWaitlisted || isPending ? 'wait' : 'success'}
          title={title}
          body={body}
        />
        <div className="mt-6">
          <Button variant="secondary" onClick={goMine}>
            <Icon name="list" className="h-4 w-4" />
            自分のイベントを見る
          </Button>
        </div>
      </div>
    </div>
  );
}
