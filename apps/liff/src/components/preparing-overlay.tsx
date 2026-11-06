import PreparingView from './preparing-view.js';

/**
 * 口（Worker）がまだ無い機能を押したときの、お客さまの「現在準備中です」（・K9HMJp）。
 * ページの上に全面で出す。壊れた画面・空の画面は出さない。
 */
export default function PreparingOverlay({ title, feature }: { title: string; feature: string }) {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-canvas" role="dialog" aria-modal="true" aria-label="現在準備中です">
      <PreparingView title={title} feature={feature} others="ほかの予約" />
    </div>
  );
}
