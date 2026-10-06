import { useEffect, useRef, useState } from 'react';
import type { CustomerBookingWaitlist, CustomerSeatWaitlist } from '@line-crm/shared';
import { api } from '../lib/api.js';
import Button from './ui/Button.js';
import BookingPayment from './BookingPayment.js';
/** 案内のリンクを開いた本人が、既存の予約口で期限内に確定する。 */
export default function WaitlistOfferSheet({ id, seat = false, decline = false, onClose }: { id: string; seat?: boolean; decline?: boolean; onClose: () => void ;}) {
  const [entry, setEntry] = useState<CustomerBookingWaitlist | CustomerSeatWaitlist | null>(null);
  const [error, setError] = useState<string | null>(null), [working, setWorking] = useState(false), [message, setMessage] = useState<string | null>(null);
  const [paymentBooking, setPaymentBooking] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const key = useRef(crypto.randomUUID());
  useEffect(() => { let alive = true; const request = seat ? api.seatWaitlists(id) : api.bookingWaitlists(id); request.then(r => { if (!alive) return; const own = r.waitlist.find(w => w.id === id); if (own) setEntry(own); else setError('この案内が見つかりません。'); }).catch(() => { if (alive) setError('案内を読み込めません。もう一度開いてください。'); }); const timer = setInterval(() => setNow(Date.now()), 1000); return () => { alive = false; clearInterval(timer); }; }, [id, seat]);
  const active = entry?.status === 'invited' && !!entry.hold_expires_at && Date.parse(entry.hold_expires_at) > now;
  async function accept() {    
if (!entry || !active) return; setWorking(true); setError(null); try {
      if (seat) { await api.acceptSeatWaitlist(id, key.current); setMessage('予約が確定しました。'); }
      else { const person = entry as CustomerBookingWaitlist; const result = await api.acceptWaitlist({ menu_id: person.menu_id, staff_id: person.staff_id, starts_at: person.starts_at, waitlist_id: id }, key.current); if (result.payment && result.payment.status !== 'paid') setPaymentBooking(result.booking_id); else setMessage(result.status === 'confirmed' ? '予約が確定しました。' : '予約を受け付けました。お店の承認をお待ちください。'); }
    } catch (e) { const code = (e as { body?: { error?: string ;} ;}).body?.error; setError(code === 'offer_expired' ? '仮押さえの期限が切れました。' : code === 'slot_conflict' || code === 'slot_not_available' ? 'この枠は予約できなくなりました。' : '予約できませんでした。期限内にもう一度お試しください。'); } finally { setWorking(false); }  
}
  async function cancel() { setWorking(true); setError(null); try { if (seat) await api.cancelSeatWaitlist(id); else await api.cancelWaitlist(id); setMessage('取り消しました。次の方へ案内します。'); } catch { setError('取り消せませんでした。もう一度お試しください。'); } finally { setWorking(false); } }
  return <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="空いたら知らせる">
    <button className="absolute inset-0 bg-ink/40" aria-label="閉じる" onClick={onClose} />
    <div className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-md rounded-t-(--liff-radius-lg) bg-canvas p-4 pb-8">
      <h2 className="text-[15px] font-bold text-ink">{decline ? '今回は見送る' : '空きが出ました'}</h2>
      {entry && <p className="mt-1 text-[13px] text-liff-sub">{new Date(entry.starts_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}・{'guest_count' in entry ? `${entry.store_name} ${entry.guest_count}名` : `${entry.menu_name}・${entry.staff_name}`}</p>}
      {paymentBooking ? <BookingPayment bookingId={paymentBooking} menuName={('menu_name' in entry! ? entry!.menu_name : '') || 'ご予約'} initialAmount={0} slot={{ date: new Date(entry!.starts_at).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }), start: new Date(entry!.starts_at).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' }) }} durationMinutes={('ends_at' in entry! && entry!.ends_at) ? (Date.parse(entry!.ends_at) - Date.parse(entry!.starts_at)) / 60000 : 60} /> : message ? <p className="mt-3" role="status">{message}</p> : entry ? <p className="mt-3 text-[13px]">{active ? `仮押さえは${new Date(entry.hold_expires_at!).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' })}までです。${decline ? '見送ると次の方へ案内します。' : '期限内に予約を確定してください。'}` : entry.status === 'waiting' ? 'まだ空きの案内を待っています。' : entry.status === 'converted' ? 'この案内は予約になりました。' : 'この待ちは終わりました。仮押さえはありません。'}</p> : !error ? <p className="mt-3">読み込んでいます。</p> : null}
      {error && <p className="mt-3 text-[13px] text-danger" role="alert">{error}</p>}
      <div className="mt-4 flex gap-2">{!message && !paymentBooking && active && !decline && <Button disabled={working} onClick={accept}>この時間で予約する</Button>}{!message && !paymentBooking && (entry?.status === 'waiting' || active) && <Button variant="secondary" disabled={working} onClick={cancel}>{decline ? '今回は見送る' : '待ちを取り消す'}</Button>}<Button variant="secondary" onClick={onClose}>閉じる</Button></div>
    </div>
  </div>;
}
