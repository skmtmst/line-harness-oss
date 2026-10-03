import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import MenuList from '../components/MenuList.js';
import StaffList from '../components/StaffList.js';
import DateTimePicker, { type SlotPick } from '../components/DateTimePicker.js';
import Confirm from '../components/Confirm.js';
import BookingPayment from '../components/BookingPayment.js';
import Done from '../components/Done.js';
import LiffHeader from '../components/ui/LiffHeader.js';
import Stepper from '../components/ui/Stepper.js';
import BottomBar from '../components/ui/BottomBar.js';
import Button from '../components/ui/Button.js';
import type { MenuItem, StaffItem } from '../lib/api.js';

type Step = 'menu' | 'staff' | 'datetime' | 'confirm' | 'payment' | 'done';

const STEPS = ['メニュー', '担当', '日時', '確認'];

/**
 * ご予約 (★V8・IruGD→biNP5→M2p63S/k3aJKU→gLReL→VU6Xi)。手順は4つ。
 * 進む操作は下の操作の帯に1つだけ。API・画面の流れ・保存の中身はそのまま。
 * 上の帯は ×・題・店名 (LiffHeader)。手順の印は短い緑の棒 (Stepper)。
 */
export default function Booking() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const isPeek = params.get('mode') === 'peek';

  const [step, setStep] = useState<Step>('menu');
  const [menu, setMenu] = useState<MenuItem | null>(null);
  const [staff, setStaff] = useState<StaffItem | null>(null);
  const [slot, setSlot] = useState<SlotPick | null>(null);
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [paymentDue, setPaymentDue] = useState(false);
  // 読み込み中・失敗の間は下の帯を出さない (押せないボタンの飾りを置かない)。
  const [stepReady, setStepReady] = useState(false);
  useEffect(() => {
    setStepReady(false);
  }, [step]);

  function exitPeekToBooking() {
    // peek モードを抜けて通常フローへ。同じ menu/staff/slot を持ち回したまま step を進める。
    const next = new URLSearchParams(params);
    next.delete('mode');
    navigate({ pathname: '/booking', search: next.toString() }, { replace: true });
    setStep('confirm');
  }

  function pickMenu(m: MenuItem) {
    // 選び直したら後の選択は捨てる (古い担当・日時のまま送らない)。
    if (m.id !== menu?.id) {
      setStaff(null);
      setSlot(null);
    }
    setMenu(m);
  }

  function pickStaff(s: StaffItem) {
    if (s.id !== staff?.id) setSlot(null);
    setStaff(s);
  }

  const stepIndex =
    step === 'menu' ? 0 : step === 'staff' ? 1 : step === 'datetime' ? 2 : STEPS.length - 1;

  return (
    <div className="min-h-screen bg-canvas">
      <LiffHeader title="ご予約" />
      {step !== 'done' && <Stepper steps={STEPS} current={stepIndex} />}
      <div className="mx-auto w-full max-w-md px-4 pt-3 pb-40">
        {step === 'menu' && (
          <div data-design-node="IruGD">
            <MenuList selectedId={menu?.id ?? null} onSelect={pickMenu} onLoadState={setStepReady} />
          </div>
        )}
        {step === 'staff' && menu && (
          <div data-design-node="biNP5">
            <StaffList
              key={menu.id}
              menu={menu}
              selectedId={staff?.id ?? null}
              onSelect={pickStaff}
              onLoadState={setStepReady}
            />
          </div>
        )}
        {step === 'datetime' && menu && staff && (
          <DateTimePicker
            key={`${menu.id}-${staff.id}`}
            menu={menu}
            staff={staff}
            hint={isPeek ? '空き状況の確認モードです' : undefined}
            selected={slot}
            onSelect={setSlot}
            onConfirm={isPeek ? exitPeekToBooking : () => setStep('confirm')}
            confirmLabel={isPeek ? 'この時間で予約に進む' : undefined}
            onBackToStaff={() => setStep('staff')}
          />
        )}
        {step === 'confirm' && menu && staff && slot && (
          <Confirm
            menu={menu}
            staff={staff}
            slot={slot}
            onBack={() => setStep('datetime')}
            onSubmitted={(result) => {
              setBookingId(result.bookingId);
              // お支払いありのときだけ支払いの段へ。なしの店では今までどおり完了へ。
              setPaymentDue(Boolean(result.payment));
              setStep(result.payment ? 'payment' : 'done');
            }}
          />
        )}
        {step === 'payment' && menu && staff && slot && bookingId && paymentDue && (
          <BookingPayment
            bookingId={bookingId}
            menuName={menu.name}
            initialAmount={staff.price}
            slot={slot}
            durationMinutes={staff.duration_minutes}
          />
        )}
        {step === 'done' && menu && staff && slot && (
          <Done menuName={menu.name} slot={slot} durationMinutes={staff.duration_minutes} />
        )}
      </div>
      {step === 'menu' && stepReady && (
        <BottomBar>
          <Button variant="primary" disabled={!menu} onClick={() => setStep('staff')}>
            担当を選ぶ
          </Button>
        </BottomBar>
      )}
      {step === 'staff' && stepReady && (
        <BottomBar>
          <Button variant="primary" disabled={!staff} onClick={() => setStep('datetime')}>
            日時を選ぶ
          </Button>
          <button
            type="button"
            onClick={() => setStep('menu')}
            className="self-center text-xs text-liff-sub focus-visible:outline-2 focus-visible:outline-ink"
          >
            ← メニューを選び直す
          </button>
        </BottomBar>
      )}
    </div>
  );
}
