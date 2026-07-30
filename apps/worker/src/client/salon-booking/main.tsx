// main.tsx — Salon booking React entry. Loaded via dynamic import from the
// LIFF orchestrator (apps/worker/src/client/main.ts). Caller passes already-
// initialized LIFF context (liffId / lineUserId / idToken).

import { StrictMode, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SalonBookingProvider, type SalonBookingContext } from './lib/context.js';
import Booking from './pages/Booking.js';
import BookingHistory from './pages/BookingHistory.js';
import './styles.css';

let _root: Root | null = null;

function readUrlState(): {
  view: string | null;
  peekMode: boolean;
  locationId: string | null;
  menuId: string | null;
  changeBookingId: string | null;
} {
  const params = new URLSearchParams(window.location.search);
  return {
    view: params.get('view'),
    peekMode: params.get('mode') === 'peek',
    locationId: params.get('location_id'),
    menuId: params.get('menu_id'),
    changeBookingId: params.get('change_booking_id'),
  };
}

function App({ ctx }: { ctx: SalonBookingContext }) {
  // peekMode は state として保持し、Booking から `exitPeek` で false に倒せる。
  const initial = readUrlState();
  const [view, setView] = useState(initial.view);
  const [peekMode, setPeekMode] = useState(initial.peekMode);
  // menu_id ディープリンクは URL から1度だけ読む。お客様が「戻る」で
  // メニュー選択に戻った後にディープリンクで再ロックされないように、
  // mount 時点の値だけ Booking に渡す。
  const [initialMenuId] = useState(initial.menuId);
  const [initialLocationId] = useState(initial.locationId);
  const [changeBookingId] = useState(initial.changeBookingId);

  const headerLabel = view === 'history' ? '予約の確認・履歴' : peekMode ? '空き状況' : 'ご予約';

  function changeView(next: 'history' | null) {
    const url = new URL(window.location.href);
    if (next) url.searchParams.set('view', next);
    else url.searchParams.delete('view');
    window.history.replaceState(null, '', url.toString());
    setView(next);
  }

  return (
    <SalonBookingProvider value={ctx}>
      <div className="min-h-screen sb-fade-in" style={{ background: '#f7f8f7' }}>
        <header
          className="sticky top-0 z-20 border-b border-green-500 bg-white px-4 py-3"
        >
          <div className="mx-auto flex max-w-md items-center justify-between gap-3">
            <div>
              <div className="text-lg font-bold text-slate-800">{headerLabel}</div>
              <div className="text-[10px] text-gray-400">meauty 予約ページ</div>
            </div>
            <button
              onClick={() => changeView(view === 'history' ? null : 'history')}
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm"
            >
              {view === 'history' ? '予約する' : '予約の確認'}
            </button>
          </div>
        </header>
        <main className="max-w-md mx-auto px-4 py-4 pb-24">
          {view === 'history' ? (
            <BookingHistory onBook={() => changeView(null)} />
          ) : (
            <Booking
              peekMode={peekMode}
              exitPeek={() => setPeekMode(false)}
              initialLocationId={initialLocationId}
              initialMenuId={initialMenuId}
              changeBookingId={changeBookingId}
            />
          )}
        </main>
      </div>
    </SalonBookingProvider>
  );
}

export function mountSalonBooking(container: HTMLElement, ctx: SalonBookingContext): void {
  // body.sb-active は preflight reset と #app inline 上書きが効くための前提。
  // useEffect で付けると初回 paint がブラウザデフォルト (black border, list disc 等)
  // のままチラつくので、createRoot 前に同期で付ける。
  document.body.classList.add('sb-active');

  if (_root) {
    _root.unmount();
    _root = null;
  }
  container.innerHTML = '';
  _root = createRoot(container);
  _root.render(
    <StrictMode>
      <App ctx={ctx} />
    </StrictMode>,
  );
}

export function unmountSalonBooking(): void {
  if (_root) {
    _root.unmount();
    _root = null;
  }
  document.body.classList.remove('sb-active');
}
