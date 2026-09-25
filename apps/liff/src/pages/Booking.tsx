import { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import MenuList from '../components/MenuList.js';
import StaffList from '../components/StaffList.js';
import DateTimePicker, { type SlotPick } from '../components/DateTimePicker.js';
import Confirm from '../components/Confirm.js';
import Done from '../components/Done.js';
import PageHeader from '../components/ui/PageHeader.js';
import Stepper from '../components/ui/Stepper.js';
import BottomBar from '../components/ui/BottomBar.js';
import Button from '../components/ui/Button.js';
import type { MenuItem, StaffItem } from '../lib/api.js';
import { formatMd } from '../lib/datetime.js';

type Step = 'menu' | 'staff' | 'datetime' | 'confirm' | 'done';

const STEPS = ['メニュー', '担当', '日時', '確認'];

/**
 * ご予約 (1-a〜1-e)。手順は4つ。進む操作は下の操作の帯に1つだけ。
 * API・画面の流れ・保存の中身はそのまま。見た目だけ ★V7。
 */
export default function Booking() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const isPeek = params.get('mode') === 'peek';

  const [step, setStep] = useState<Step>('menu');
  const [menu, setMenu] = useState<MenuItem | null>(null);
  const [staff, setStaff] = useState<StaffItem | null>(null);
  const [slot, setSlot] = useState<SlotPick | null>(null);

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
    <div className="min-h-screen bg-ground">
      <div className="mx-auto w-full max-w-md space-y-4 px-4 pt-2 pb-28">
        {step !== 'done' && (
          <>
            <PageHeader
              title={
                step === 'menu'
                  ? 'ご予約'
                  : step === 'staff'
                    ? '担当を選ぶ'
                    : step === 'datetime'
                      ? '日時を選ぶ'
                      : '内容の確認'
              }
              onBack={
                step === 'menu'
                  ? undefined
                  : () =>
                      setStep(
                        step === 'staff' ? 'menu' : step === 'datetime' ? 'staff' : 'datetime',
                      )
              }
            />
            <Stepper steps={STEPS} current={stepIndex} />
          </>
        )}
        {step === 'menu' && <MenuList selectedId={menu?.id ?? null} onSelect={pickMenu} />}
        {step === 'staff' && menu && (
          <StaffList
            key={menu.id}
            menuId={menu.id}
            basePrice={menu.base_price}
            selectedId={staff?.id ?? null}
            onSelect={pickStaff}
          />
        )}
        {step === 'datetime' && menu && staff && (
          <DateTimePicker
            key={`${menu.id}-${staff.id}`}
            menuId={menu.id}
            staffId={staff.id}
            hint={isPeek ? '空き状況の確認モードです' : undefined}
            selected={slot}
            onSelect={setSlot}
          />
        )}
        {step === 'confirm' && menu && staff && slot && (
          <Confirm menu={menu} staff={staff} slot={slot} onSubmitted={() => setStep('done')} />
        )}
        {step === 'done' && menu && slot && <Done menuName={menu.name} slot={slot} />}
      </div>
      {step === 'menu' && (
        <BottomBar>
          <Button variant="primary" disabled={!menu} onClick={() => setStep('staff')}>
            担当を選ぶ
          </Button>
        </BottomBar>
      )}
      {step === 'staff' && (
        <BottomBar>
          <Button variant="primary" disabled={!staff} onClick={() => setStep('datetime')}>
            日時を選ぶ
          </Button>
        </BottomBar>
      )}
      {step === 'datetime' && !isPeek && (
        <BottomBar>
          <Button variant="primary" disabled={!slot} onClick={() => setStep('confirm')}>
            {slot ? `${formatMd(slot.date)} ${slot.start} で確認へ` : '日時を選ぶ'}
          </Button>
        </BottomBar>
      )}
      {step === 'datetime' && isPeek && slot && (
        <BottomBar>
          <p className="mb-2 truncate text-sm text-ink-secondary" title={`${slot.date} ${slot.start}`}>
            選択中: {formatMd(slot.date)} {slot.start}
          </p>
          <Button variant="primary" onClick={exitPeekToBooking}>
            この時間で予約に進む
          </Button>
        </BottomBar>
      )}
    </div>
  );
}


