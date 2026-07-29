import { useCallback, useEffect, useState } from 'react';
import LocationList from '../components/LocationList.js';
import MenuList from '../components/MenuList.js';
import StaffList from '../components/StaffList.js';
import DateTimePicker from '../components/DateTimePicker.js';
import Confirm from '../components/Confirm.js';
import Done from '../components/Done.js';
import CustomerDetails, { type CustomerDetailsValue } from '../components/CustomerDetails.js';
import { useSalonContext } from '../lib/context.js';
import {
  createApi,
  type BookingFormField,
  type BookingPublicSettings,
  type ConsentSetting,
  type LocationItem,
  type MenuItem,
  type StaffItem,
} from '../lib/api.js';

type Step = 'location' | 'menu' | 'staff' | 'datetime' | 'details' | 'confirm' | 'done';

const PHASES = [
  { label: '予約日程選択' },
  { label: '情報入力' },
  { label: '確認' },
  { label: '完了' },
];

function phaseOf(step: Step): number {
  if (step === 'details') return 1;
  if (step === 'confirm') return 2;
  if (step === 'done') return 3;
  return 0;
}

function initialCustomer(): CustomerDetailsValue {
  try {
    const stored = JSON.parse(localStorage.getItem('meauty_booking_customer') ?? '{}') as Partial<CustomerDetailsValue>;
    return {
      name: stored.name ?? '',
      kana: stored.kana ?? '',
      phone: stored.phone ?? '',
      birthdate: stored.birthdate ?? '',
      note: '',
      formValues: stored.formValues ?? {},
    };
  } catch {
    return { name: '', kana: '', phone: '', birthdate: '', note: '', formValues: {} };
  }
}

export default function Booking({
  peekMode,
  exitPeek,
  initialLocationId,
  initialMenuId,
  changeBookingId,
}: {
  peekMode: boolean;
  exitPeek: () => void;
  initialLocationId?: string | null;
  initialMenuId?: string | null;
  changeBookingId?: string | null;
}) {
  const ctx = useSalonContext();
  const [step, setStep] = useState<Step>('location');
  const [location, setLocation] = useState<LocationItem | null>(null);
  const [menu, setMenu] = useState<MenuItem | null>(null);
  const [staff, setStaff] = useState<StaffItem | null>(null);
  const [slot, setSlot] = useState<{ date: string; start: string } | null>(null);
  const [customer, setCustomer] = useState<CustomerDetailsValue>(initialCustomer);
  const [consent, setConsent] = useState<ConsentSetting | null>(null);
  const [settings, setSettings] = useState<BookingPublicSettings | null>(null);
  const [fields, setFields] = useState<BookingFormField[]>([]);
  const [consentError, setConsentError] = useState(false);
  // ?menu_id=... が指定されたら、メニュー一覧をスキップして staff から開始。
  // 該当 menu が無効/未公開だった場合は通常フローに fallback（黙って全
  // メニュー一覧を出す方が「初回オリエン直リンク経由なのに別メニュー
  // を選ばれる」事故より安全）。
  const [deepLinkResolving, setDeepLinkResolving] = useState(Boolean(initialMenuId));

  useEffect(() => {
    let cancelled = false;
    Promise.all([createApi(ctx).consent(), createApi(ctx).config()])
      .then(([consentResult, configResult]) => {
        if (!cancelled) {
          setConsent(consentResult.consent);
          setSettings(configResult.settings);
          setFields(configResult.fields);
        }
      })
      .catch(() => {
        if (!cancelled) setConsentError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [ctx]);

  useEffect(() => {
    if (!initialMenuId || !location) return;
    let cancelled = false;
    createApi(ctx)
      .menus()
      .then((res) => {
        if (cancelled) return;
        const hit = res.menus.find((m) => m.id === initialMenuId);
        if (hit) {
          setMenu(hit);
          setStep('staff');
        }
      })
      .catch(() => {
        // 解決失敗時は通常の menu 一覧フローへ。MenuList が同 API を
        // 再度叩くのでここで UI エラーを出す必要は無い。
      })
      .finally(() => {
        if (!cancelled) setDeepLinkResolving(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ctx, initialMenuId, location]);

  const selectLocation = useCallback((selected: LocationItem) => {
    setLocation(selected);
    setMenu(null);
    setStaff(null);
    setSlot(null);
    setStep('menu');
  }, []);

  function exitPeekToBooking() {
    const url = new URL(window.location.href);
    url.searchParams.delete('mode');
    window.history.replaceState(null, '', url.toString());
    exitPeek();
    setStep('details');
  }

  const phase = phaseOf(step);

  if (!settings && !consentError) {
    return <div className="flex flex-col items-center py-12"><div className="sb-spinner" /><p className="mt-3 text-sm text-gray-500">予約設定を読み込み中…</p></div>;
  }

  if (settings && (settings.is_public !== 1 || settings.allow_new_booking !== 1)) {
    return (
      <div className="sb-card py-12 text-center">
        <h1 className="text-lg font-bold text-slate-800">現在、新規予約を受け付けていません</h1>
        <p className="mt-3 text-sm text-gray-500">予約の確認・履歴は画面上部のボタンからご覧いただけます。</p>
      </div>
    );
  }

  return (
    <div>
      <div
        className="mb-6 px-1"
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${PHASES.length}, minmax(0, 1fr))`,
          gap: 0,
        }}
      >
        {PHASES.map((item, i) => (
          <div key={item.label} className="relative flex flex-col items-center">
            {i > 0 && (
              <span
                aria-hidden
                className="absolute"
                style={{
                  top: 12,
                  left: '-50%',
                  width: '100%',
                  height: 3,
                  background: i <= phase ? '#2f9e1d' : '#d7d9dc',
                }}
              />
            )}
            <span
              className="relative z-10 block rounded-full"
              style={{ width: 24, height: 24, background: i <= phase ? '#2f9e1d' : '#d7d9dc' }}
            />
            <span
              className="mt-2 text-center text-[10px] font-bold leading-tight"
              style={{ color: i <= phase ? '#2f9e1d' : '#9ca3af' }}
            >
              {item.label}
            </span>
          </div>
        ))}
      </div>

      {phase === 0 && (
        <div
          className="mb-5 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-xs leading-5 text-green-900"
        >
          店舗・メニュー・担当者を選ぶと、予約可能な日時が表示されます。
        </div>
      )}

      {step === 'location' && (
        <LocationList initialLocationId={initialLocationId} onSelect={selectLocation} />
      )}
      {step === 'menu' && deepLinkResolving && (
        <div className="py-12 text-center text-sm text-gray-500">読み込み中…</div>
      )}
      {step === 'menu' && !deepLinkResolving && (
        <>
          <button onClick={() => setStep('location')} className="sb-back-btn mb-4">
            <span aria-hidden>←</span>
            店舗を選び直す
          </button>
          {location && <p className="mb-3 text-xs font-semibold sb-line-green-text">{location.name}</p>}
          <MenuList
            onSelect={(m) => {
              if (menu?.id !== m.id) {
                setStaff(null);
                setSlot(null);
              }
              setMenu(m);
              setStep('staff');
            }}
          />
        </>
      )}
      {step === 'staff' && menu && (
        <StaffList
          menuId={menu.id}
          basePrice={menu.base_price}
          onSelect={(s) => {
            if (staff?.id !== s.id) setSlot(null);
            setStaff(s);
            setStep('datetime');
          }}
          onBack={() => setStep('menu')}
        />
      )}
      {step === 'datetime' && location && menu && staff && (
        <DateTimePicker
          locationId={location.id}
          menuId={menu.id}
          staffId={staff.id}
          ctaLabel={
            peekMode
              ? '空き状況の確認モードです（タップで予約に進めます）'
              : '○の時間をタップして選択してください'
          }
          selected={slot}
          calendarView={settings?.calendar_view ?? 'week'}
          onSelect={(picked) => {
            setSlot(picked);
            if (!peekMode) setStep('details');
          }}
          onBack={() => setStep('staff')}
        />
      )}
      {step === 'datetime' && peekMode && slot && (
        <div
          className="fixed bottom-0 left-0 right-0 px-4 py-3 sb-slide-up"
          style={{ background: 'rgba(255, 255, 255, 0.95)', backdropFilter: 'blur(8px)', borderTop: '1px solid #e5e7eb' }}
        >
          <div className="max-w-md mx-auto">
            <p className="text-xs text-gray-600 mb-2">
              選択中: <span className="font-semibold">{slot.date} {slot.start}</span>
            </p>
            <button
              onClick={exitPeekToBooking}
              className="w-full text-white py-3 rounded-xl font-bold text-sm"
              style={{ background: '#06C755', boxShadow: '0 1px 3px rgba(6, 199, 85, 0.3)' }}
            >
              この時間で予約に進む
            </button>
          </div>
        </div>
      )}
      {step === 'details' && location && menu && staff && slot && (
        <CustomerDetails
          location={location}
          menu={menu}
          staff={staff}
          slot={slot}
          initial={customer}
          fields={fields}
          onNext={(value) => {
            setCustomer(value);
            setStep('confirm');
          }}
          onBack={() => setStep('datetime')}
        />
      )}
      {step === 'confirm' && location && menu && staff && slot && consent && (
        <Confirm
          location={location}
          menu={menu}
          staff={staff}
          slot={slot}
          customer={customer}
          fields={fields}
          changeBookingId={changeBookingId}
          consent={consent}
          onSubmitted={() => setStep('done')}
          onBack={() => setStep('details')}
        />
      )}
      {step === 'confirm' && !consent && !consentError && (
        <div className="flex flex-col items-center py-12">
          <div className="sb-spinner" />
          <p className="mt-3 text-sm text-gray-500">同意書を読み込み中…</p>
        </div>
      )}
      {step === 'confirm' && !consent && consentError && (
        <div className="sb-card text-center">
          <p className="text-sm text-red-600">同意書を読み込めませんでした。</p>
          <p className="mt-2 text-xs text-gray-500">通信状態を確認して、画面を再読み込みしてください。</p>
          <button onClick={() => window.location.reload()} className="sb-outline-btn mt-5">再読み込み</button>
        </div>
      )}
      {step === 'done' && <Done />}
    </div>
  );
}
