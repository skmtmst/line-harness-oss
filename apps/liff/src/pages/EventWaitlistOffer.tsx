import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';

type State = 'ready' | 'submitting' | 'confirmed' | 'expired' | 'unavailable' | 'error';

export default function EventWaitlistOffer({ token }: { token: string }) {
  const [state, setState] = useState<State>('ready');

  const accept = async () => {
    if (state === 'submitting' || state === 'confirmed') return;
    setState('submitting');
    try {
      await api.acceptEventWaitlistOffer(token);
      setState('confirmed');
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 410) setState('expired');
      else if (status === 404 || status === 409) setState('unavailable');
      else setState('error');
    }
  };

  if (state === 'confirmed') {
    return (
      <main className="min-h-screen bg-gray-50 p-6 flex items-center justify-center">
        <section className="w-full max-w-md rounded-2xl bg-white p-6 text-center shadow-sm">
          <div className="mb-4 text-5xl">✅</div>
          <h1 className="mb-2 text-xl font-bold text-gray-900">予約が確定しました</h1>
          <p className="mb-6 text-sm leading-6 text-gray-600">キャンセル待ちの席を予約しました。詳しい内容は予約履歴で確認できます。</p>
          <Link to="/events/me" className="inline-block rounded-lg bg-[#06c755] px-6 py-3 font-semibold text-white">
            予約履歴を見る
          </Link>
        </section>
      </main>
    );
  }

  const cannotAccept = state === 'expired' || state === 'unavailable';
  return (
    <main className="min-h-screen bg-gray-50 p-6 flex items-center justify-center">
      <section className="w-full max-w-md rounded-2xl bg-white p-6 shadow-sm">
        <h1 className="mb-3 text-xl font-bold text-gray-900">キャンセル待ちの空きが出ました</h1>
        {state === 'expired' && <p className="mb-5 text-sm leading-6 text-red-700">回答期限を過ぎています。席は次の方へ案内されました。</p>}
        {state === 'unavailable' && <p className="mb-5 text-sm leading-6 text-red-700">この案内はすでに利用済みか、席を確保できませんでした。</p>}
        {state === 'error' && <p className="mb-5 text-sm leading-6 text-red-700">通信に失敗しました。時間を置いて、もう一度お試しください。</p>}
        {!cannotAccept && (
          <>
            <p className="mb-5 text-sm leading-6 text-gray-600">下のボタンを押すと予約が確定します。押すまでは予約になりません。</p>
            <button
              type="button"
              onClick={accept}
              disabled={state === 'submitting'}
              className="w-full rounded-lg bg-[#06c755] px-5 py-3 font-semibold text-white disabled:cursor-wait disabled:opacity-60"
            >
              {state === 'submitting' ? '予約を確定しています…' : 'この席を予約する'}
            </button>
          </>
        )}
        {cannotAccept && <Link to="/events/me" className="block text-center text-sm font-semibold text-blue-700">予約履歴を見る</Link>}
      </section>
    </main>
  );
}
