import { useEffect, useRef, useState } from 'react';
import { affiliateBankFields } from '@line-crm/shared';
import { affiliateSelfApi, SelfApiError, type BankInput, type BankProfile, type Statement } from '../lib/affiliate-self-api.js';
import Button from './ui/Button.js';
import Card from './ui/Card.js';
import ConfirmDialog from './ui/ConfirmDialog.js';
import { FormSelectControl, FormTextControl } from './forms/controls.js';

const empty: BankInput = { bankCode: '', bankName: '', branchCode: '', branchName: '', accountType: 'ordinary', accountNumber: '', accountHolderName: '' };
const labels: Array<[Exclude<keyof BankInput, 'accountType'>, string]> = [
  ['bankCode', '銀行コード'], ['bankName', '銀行名'], ['branchCode', '支店コード'],
  ['branchName', '支店名'], ['accountNumber', '口座番号'], ['accountHolderName', '口座名義'],
];
export default function AffiliatePayments({ editable }: { editable: boolean }) {
  const [profile, setProfile] = useState<BankProfile | null>(null);
  const [statements, setStatements] = useState<Statement[] | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [draft, setDraft] = useState<BankInput>(empty);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const initial = useRef(JSON.stringify(empty));
  const key = useRef<{ fingerprint: string; key: string } | null>(null);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let alive = true;
    setFailed(false); setReady(false);
    Promise.all([affiliateSelfApi.bank(), affiliateSelfApi.statements()]).then(([bank, rows]) => {
      if (alive) { setProfile(bank); setStatements(rows); setReady(true); }
    }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [reload]);
  function start() {
    const value: BankInput = profile ? { bankCode: profile.bankCode, bankName: profile.bankName, branchCode: profile.branchCode, branchName: profile.branchName, accountType: profile.accountType, accountHolderName: profile.accountHolderName, accountNumber: '' } : { ...empty };
    setDraft(value); initial.current = JSON.stringify(value); setFields({}); setError(''); setConflict(false); setEditing(true);
  }
  function close() {
    if (busy) return;
    if (JSON.stringify(draft) !== initial.current) setDiscarding(true);
    else setEditing(false);
  }
  function validate() {
    const errors = affiliateBankFields({ ...draft }); setFields(errors); setError('');
    if (Object.keys(errors).length) { document.getElementById(`bank-${Object.keys(errors)[0]}`)?.focus(); return; }
    setConfirming(true);
  }
  async function save() {
    if (busyRef.current || conflict) return;
    busyRef.current = true; setBusy(true); setError('');
    const expectedVersion = profile?.version ?? 0;
    const fingerprint = JSON.stringify({ draft, expectedVersion });
    if (key.current?.fingerprint !== fingerprint) key.current = { fingerprint, key: crypto.randomUUID() };
    try {
      const result = await affiliateSelfApi.saveBank(draft, expectedVersion, key.current.key);
      setProfile(result); setDraft(empty); setEditing(false); setNotice('振込先を保存しました');
    } catch (e) {
      if (e instanceof SelfApiError && Object.keys(e.fields).length) {
        setFields(e.fields); setTimeout(() => document.getElementById(`bank-${Object.keys(e.fields)[0]}`)?.focus(), 0);
      } else {
        setError(e instanceof Error ? e.message : '保存できませんでした');
        if (e instanceof SelfApiError && e.status === 409) setConflict(true);
      }
    } finally { setConfirming(false); busyRef.current = false; setBusy(false); }
  }
  async function refreshConflict() {
    try { setProfile(await affiliateSelfApi.bank()); setConflict(false); setError('最新の振込先を取得しました。入力を確かめて保存してください。'); }
    catch { setError('最新の振込先を読み込めませんでした。もう一度お試しください。'); }
  }
  return <section aria-label="振込先と支払明細" className="space-y-3">
    <h2 className="text-sm font-bold text-ink">振込先と支払明細</h2>
    {failed ? <><p role="alert">振込先と明細を読み込めませんでした</p><Button variant="secondary" onClick={() => setReload(n => n + 1)}>もう一度読み込む</Button></> : !ready ? <p role="status">読み込んでいます</p> : <>
      <Card className="space-y-2 p-4">
        {profile ? <p>{profile.bankName} {profile.branchName} {profile.accountType === 'ordinary' ? '普通' : '当座'} 末尾{profile.accountLast4} {profile.accountHolderName}</p> : <p>振込先はまだ登録されていません</p>}
        {editable && <Button variant="secondary" onClick={start}>{profile ? '振込先を編集する' : '振込先を登録する'}</Button>}
        {notice && <p role="status">{notice}</p>}
      </Card>
      <h3 className="text-sm font-bold">支払明細</h3>
      {statements?.length === 0 && <p className="text-sm">支払明細はまだありません</p>}
      {statements?.map(row => <Card key={row.id} className="space-y-2 p-3">
        <p>{new Date(row.createdAt).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' })}・¥{row.totalAmount.toLocaleString()}</p>
        {row.expiresAt && <p className="text-xs">ダウンロード期限：{new Date(row.expiresAt).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' })}</p>}
        {!row.expiresAt || Date.now() <= Date.parse(row.expiresAt) ? <Button variant="secondary" onClick={() => void affiliateSelfApi.download(row.id).catch(() => setNotice('支払明細を取得できませんでした。もう一度お試しください。'))}>PDFをダウンロードする</Button> : <p>ダウンロード期限を過ぎています</p>}
      </Card>)}
    </>}
    <ConfirmDialog open={editing && !confirming && !discarding} title="振込先を編集" description={profile ? `現在の口座番号は末尾${profile.accountLast4}です。保存するときは口座番号をすべて入力してください。` : '報酬を受け取る口座を入力してください。'} cancelLabel="キャンセル" confirmLabel="保存する" busy={busy} error={error} onCancel={close} onConfirm={conflict ? undefined : validate}>
      <div className="mt-3 max-h-80 space-y-3 overflow-y-auto">
        {labels.map(([name, label]) => <div key={name}>
          <label htmlFor={`bank-${name}`} className="text-sm font-bold">{label}</label>
          <FormTextControl block={{ id: name, kind: 'input', type: 'text', name, label }} id={`bank-${name}`} value={draft[name]} onChange={value => setDraft(d => ({ ...d, [name]: value }))} aria-invalid={!!fields[name]} aria-describedby={fields[name] ? `bank-${name}-error` : undefined} />
          {fields[name] && <p id={`bank-${name}-error`} className="text-xs text-danger">{fields[name]}</p>}
        </div>)}
        <label className="block text-sm font-bold">口座種別<FormSelectControl aria-invalid={!!fields.accountType} aria-describedby={fields.accountType ? 'bank-accountType-error' : undefined} value={draft.accountType} onChange={e => setDraft(d => ({ ...d, accountType: e.target.value as BankInput['accountType'] }))}><option value="ordinary">普通</option><option value="checking">当座</option></FormSelectControl></label>
        {fields.accountType && <p id="bank-accountType-error" className="text-xs text-danger">{fields.accountType}</p>}
        {conflict && <><p>入力は残っています。現在の振込先：{profile?.bankName} {profile?.branchName} 末尾{profile?.accountLast4}</p><Button variant="secondary" onClick={() => void refreshConflict()}>最新の振込先を読み込む</Button></>}
      </div>
    </ConfirmDialog>
    <ConfirmDialog open={confirming} title="振込先を保存しますか？" description={`${draft.bankName} ${draft.branchName} ${draft.accountType === 'ordinary' ? '普通' : '当座'} 末尾${draft.accountNumber.slice(-4)} ${draft.accountHolderName}`} cancelLabel="戻る" confirmLabel="保存する" busy={busy} onCancel={() => setConfirming(false)} onConfirm={() => void save()} />
    <ConfirmDialog open={discarding} title="入力を破棄しますか？" description="入力した振込先は保存されません。" cancelLabel="入力に戻る" confirmLabel="破棄する" destructive onCancel={() => setDiscarding(false)} onConfirm={() => { setDiscarding(false); setEditing(false); setDraft(empty); }} />
  </section>;
}
