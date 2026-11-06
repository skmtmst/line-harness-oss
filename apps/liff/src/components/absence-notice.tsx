/** 欠席は受け付けたが振替が付かなかったときの、両方の履歴で共通のお知らせ。 */
export default function AbsenceNotice({ message }: { message: string | null }) {
  return message ? <p role="status" className="rounded-(--liff-radius) bg-liff-soft p-3.5 text-sm leading-6 text-ink">{message}</p> : null;
}
