import { useLocation, useNavigate } from 'react-router-dom';
import { useCustomerStyle } from './customer-style-scope.js';
import LiffHeader from './ui/liff-header.js';
import StatusView from './ui/status-view.js';
import BottomBar from './ui/bottom-bar.js';
import Button from './ui/button/index.js';
import type { ReactNode } from 'react';

/** 古い予約ボタンでも別機能へ勝手に転送せず、実在する本人向けの行き先を示す。 */
export default function CustomerBookingEntry({ children }: { children: ReactNode }) {
  const style = useCustomerStyle();
  const navigate = useNavigate();
  const { search } = useLocation();
  if (style !== 'ec' && style !== 'lesson') return children;
  const lesson = style === 'lesson';
  return <div className="flex min-h-screen flex-col bg-canvas">
    <LiffHeader title="ご案内" />
    <main className="mx-auto flex w-full max-w-md flex-1 items-center px-4 pb-40">
      <StatusView icon="message-circle" title={lesson ? 'クラスのご案内をご確認ください' : 'LINEのメニューをご確認ください'}
        body={lesson ? 'お申し込みは、教室から届いたクラスのリンクからお進みください。予約の確認・振替は下のボタンから開けます。' : '商品やご注文については、LINEのメニューからご確認ください。'} />
    </main>
    <BottomBar>
      <Button variant="primary" onClick={() => navigate({ pathname: lesson ? '/events/me' : '/mypage', search })}>{lesson ? '予約の確認・振替' : 'マイページを見る'}</Button>
    </BottomBar>
  </div>;
}
