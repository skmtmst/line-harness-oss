import { Suspense, lazy } from 'react';
import { Routes, Route, Navigate, useSearchParams } from 'react-router-dom';
import LoadingView from './components/LoadingView.js';

// 画面ごとに束を分ける。開いた画面のぶんだけ読む。
const Booking = lazy(() => import('./pages/Booking.js'));
const BookingHistory = lazy(() => import('./pages/BookingHistory.js'));
const Event = lazy(() => import('./pages/Event.js'));
const EventConfirm = lazy(() => import('./pages/EventConfirm.js'));
const EventDone = lazy(() => import('./pages/EventDone.js'));
const EventBookings = lazy(() => import('./pages/EventBookings.js'));
const Affiliate = lazy(() => import('./pages/Affiliate.js'));
const Webinar = lazy(() => import('./pages/Webinar.js'));
const Form = lazy(() => import('./pages/Form.js'));
const EventWaitlistOffer = lazy(() => import('./pages/EventWaitlistOffer.js'));

function Loading() {
  return <LoadingView />;
}

export default function App() {
  const [search] = useSearchParams();
  const waitlistToken = search.get('eventWaitlistToken');
  if (waitlistToken) {
    return (
      <Suspense fallback={<Loading />}>
        <EventWaitlistOffer token={waitlistToken} />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/booking" element={<Booking />} />
        <Route path="/booking/history" element={<BookingHistory />} />
        <Route path="/events/me" element={<EventBookings />} />
        <Route path="/events/:id/confirm" element={<EventConfirm />} />
        <Route path="/events/:id/done" element={<EventDone />} />
        <Route path="/events/:id" element={<Event />} />
        <Route path="/affiliate" element={<Affiliate />} />
        <Route path="/webinar/:slug" element={<Webinar />} />
        <Route path="/forms/:id" element={<Form />} />
        <Route path="/" element={<Navigate to="/booking" replace />} />
        <Route
          path="*"
          element={
            <div className="p-8 text-center text-gray-500">
              ページが見つかりませんでした
            </div>
          }
        />
      </Routes>
    </Suspense>
  );
}
