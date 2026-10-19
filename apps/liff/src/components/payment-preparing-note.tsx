import { PAYMENT_PREPARING_BODY, PAYMENT_PREPARING_TITLE } from '../lib/customer-words.js';
import Card from './ui/card.js';

/** ：既存の試験の操作を残し、実際の請求とは分けて案内する。 */
export default function PaymentPreparingNote() {
  return <Card className="space-y-1 p-3.5">
    <p className="text-sm font-bold text-ink">{PAYMENT_PREPARING_TITLE}</p>
    <p className="text-xs leading-5 text-liff-sub">{PAYMENT_PREPARING_BODY}</p>
  </Card>;
}
