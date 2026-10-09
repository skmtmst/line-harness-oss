import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import liff from '@line/liff';
import {
  PREFECTURES,
  collectInputs,
  isOtherFreeText,
  nextSectionIndex,
  normalizeBookingValue,
  normalizeFormTheme,
  normalizeRatingValue,
  validateAnswer,
  type FormBlock,
  type FormBookingValue,
  type FormInputBlock,
  type FormLayout,
} from '@line-crm/shared';
import { submitButtonText } from '../lib/form-button-text.js';
import { api, type MenuItem, type PostalCodeCandidate, type PublicForm, type StaffItem } from '../lib/api.js';
import {
  addDays,
  formatWeekday,
  slotStartsAtIso,
  formatJstEventAt,
  jstToday,
  utcToJstHm,
  utcToJstMd,
} from '../lib/datetime.js';
import {
  conflictMessage,
  decideFormSubmitStep,
  FORM_SUBMIT_INCOMPLETE_MESSAGE,
} from '../lib/form-submit-flow.js';
import { logFailure } from '../lib/user-message.js';
import { useWideViewport } from '../lib/use-wide-viewport.js';
import LoadErrorView from '../components/LoadErrorView.js';
import LoadingView from '../components/LoadingView.js';
import Button from '../components/ui/Button.js';
import { LiffFieldLabel } from '../components/forms/controls.js';
import LiffHeader from '../components/ui/LiffHeader.js';
import BottomBar from '../components/ui/BottomBar.js';
import PrivacyNote from '../components/ui/PrivacyNote.js';
import StatusView from '../components/ui/StatusView.js';
import Icon from '../components/ui/Icon.js';
import { DateYmdField, AddressControls, BookingControls, FormChoiceRow, FormFileControl, FormSelectControl, FormTextControl, RatingStars } from '../components/forms/controls';
import { LiffInput } from '../components/forms/controls.js'

/**
 * 回答フォーム（友だちが実際に入力する画面）。
 *
 * 管理画面で組んだ layout を、そのまま入力欄に起こす。ページ（セクション）
 * が2枚以上あるときは1枚ずつ出し、選択肢に行き先が付いていればそこへ飛ぶ。
 *
 * 検証は入力のたびではなく「次へ / 送信」を押したときに出す。打っている
 * 最中に赤が出ると、まだ入力し終えていないだけなのに間違いだと言われている
 * ように見える。
 *
 * ここでの検証は親切のためで、正しさの最終判断はサーバがする。画面を
 * 通り抜けられても、保存側で同じ検証にかかる。
 */

type Answers = Record<string, unknown>;

/** 選択肢を選んだ状態から、はじめの値を作る。 */
function initialAnswers(layout: FormLayout): Answers {
  const answers: Answers = {};
  for (const block of collectInputs(layout)) {
    if (block.defaultValue) {
      answers[block.name] = block.defaultValue;
      continue;
    }
    const preselected = (block.choices ?? []).filter((c) => c.defaultSelected);
    if (preselected.length === 0) continue;
    answers[block.name] =
      block.type === 'checkbox' ? preselected.map((c) => c.label) : preselected[0].label;
  }
  return answers;
}

/**
 * 必須の印。★V8 (B8rCt・g9osGN) は欄名の横の小さな赤い札。
 * 入力の失敗 (お店のテーマの error) とは分け、必須は常にこの札にする。
 */


/**
 * 送信ボタンの文字。管理画面で決めた名前があればそれを使い、
 * 決めていないとき (空・旧い既定の「送信」) は設計どおり「送信する」。
 */
function submitLabelText(label: string | undefined): string {
  if (label && label !== '送信') return label;
  return '送信する';
}

/** 「その他」の選択肢ラベル。無ければ空。 */
function otherLabel(block: FormInputBlock): string {
  return (block.choices ?? []).find((choice) => choice.isOther)?.label ?? '';
}

/** 「その他」を選んだときに出す自由記入欄。 */
function OtherTextInput({
  value,
  onChange,
  inputClass,
}: {
  value: string;
  onChange: (next: string) => void;
  inputClass: string;
}) {
  return (
    <LiffInput
      type="text"
      value={value}
      placeholder="具体的に入力してください"
      onChange={(e) => onChange(e.target.value)}
      className="mt-1.5"
    />
  );
}

export default function Form() {
  const { id } = useParams<{ id: string }>();
  const [search] = useSearchParams();
  /**
   * P（試し回答）：管理画面の試しURLに付く合言葉。あるときは下書きを試す。
   * 試しの回答は集計に入らず、回答後の動作も動かない。
   */
  const testToken = search.get('test_token');

  // 414 幅の板（`wPfqW`）は板 ID だけを替える。中身は同じ。
  const wide = useWideViewport();
  const [form, setForm] = useState<PublicForm | null>(null);
  const [answers, setAnswers] = useState<Answers>({});
  const [sectionIndex, setSectionIndex] = useState(0);
  /** 通ってきたページ。「前へ」で分岐を逆にたどるために覚える */
  const [trail, setTrail] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [confirming, setConfirming] = useState(false);
  /**
   * 欄ごとの直し方。★V7 (4-a) は欄のすぐ下に出す。
   * 画面下の `error` はサーバの失敗 (送信・画像) だけに使い、検証とは分ける。
   */
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  /** 送信中のファイル欄。二重に押させないため欄ごとに持つ */
  const filePreviewUrls = useRef(new Set<string>());
  useEffect(() => () => { filePreviewUrls.current.forEach(url => URL.revokeObjectURL(url)); }, []);
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setForm(null);
      setError(null);
      try {
        const data = await api.getForm(id, testToken ?? undefined);
        if (cancelled) return;
        const defaults = initialAnswers(data.layout);
        setForm(data);
        setAnswers(defaults);
        // タブの題は上の帯（LiffHeader）が pageTitle・フォーム名から付ける。

        // 前回の回答を出す設定のときだけ、サーバが中身を返す。
        // 試しでは前の試しを書き戻さない（本物の回答も出さない）。
        if (!testToken && data.layout.options?.restorePrevious) {
          try {
            const latest = await api.getMyLatestFormAnswer(id);
            if (!cancelled && latest?.answers) {
              const restored = { ...latest.answers };
              // A document belongs to one answer. Restore other inputs; reselect attachments.
              collectInputs(data.layout).filter(block => block.type === 'file').forEach(block => { delete restored[block.name]; });
              setAnswers((prev) => ({ ...prev, ...restored }));
            }
          } catch {
            // 前回の回答は無くても入力はできる
          }
        }
      } catch (err) {
        if (!cancelled) {
          logFailure('form-load', err);
          setError(
            (err as { status?: number }).status === 404
              ? 'このフォームは見つかりませんでした'
              : 'フォームを開けませんでした',
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, reloadKey, testToken]);

  const layout = form?.layout;
  const section = layout?.sections[sectionIndex];

  /** いま出ているページの入力欄。検証はここだけを見る。 */
  const visibleInputs = useMemo(() => {
    if (!layout || !section) return [];
    return [...layout.header, ...section.blocks].filter(
      (b): b is Extract<FormBlock, { kind: 'input' }> => b.kind === 'input' && !b.hidden,
    );
  }, [layout, section]);

  const isLast = useMemo(() => {
    if (!layout) return true;
    return nextSectionIndex(layout, sectionIndex, answers) >= layout.sections.length;
  }, [layout, sectionIndex, answers]);

  /** 欄を直したら、その欄の直し方を消す (直したのに残らないため)。 */
  const clearFieldError = (name: string) =>
    setFieldErrors((prev) => {
      if (!(name in prev)) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });

  const setValue = (name: string, value: unknown) => {
    setAnswers((prev) => ({ ...prev, [name]: value }));
    clearFieldError(name);
  };

  const toggleCheckbox = (name: string, label: string) => {
    setAnswers((prev) => {
      const current = Array.isArray(prev[name]) ? (prev[name] as string[]) : [];
      return {
        ...prev,
        [name]: current.includes(label)
          ? current.filter((v) => v !== label)
          : [...current, label],
      };
    });
    clearFieldError(name);
  };

  /**
   * ファイルを預けて、回答には添付のIDを入れる。
   *
   * 中身をそのまま回答データに入れない。回答は D1 に JSON で入るので、
   * 画像を base64 で持たせると1件で数MBになり、一覧を開くだけで重くなる。
   */
  const uploadFile = async (name: string, file: File, side: 'single' | 'front' | 'back' = 'single') => {
    if (!id) return;
    setError(null);
    setUploading((prev) => ({ ...prev, [name]: true }));
    try {
      if (!layout) return;
      const block = collectInputs(layout).find(b => b.name === name);
      if (!block) return;
      const res = await api.uploadFormFile(id, file, testToken ?? undefined, block.id, side);
      if (res.data.file) {
        const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined;
        if (previewUrl) filePreviewUrls.current.add(previewUrl);
        const entry = { ...res.data.file, previewUrl };
        setAnswers(previous => ({ ...previous, [name]: [...(Array.isArray(previous[name]) ? previous[name] as import('@line-crm/shared').FormFileAnswer[] : []), entry] }));
      } else if (res.data.url) setValue(name, res.data.url);
      else throw new Error('document_upload_response_missing');
      clearFieldError(name);
    } catch (err) {
      logFailure('form-upload', err);
      setError('ファイルを送れませんでした。形式と容量を確認して、もう一度お試しください。');
    } finally {
      setUploading((prev) => ({ ...prev, [name]: false }));
    }
  };

  /**
   * このページだけを見る。次のページの必須は、そこへ着くまで問わない。
   * 直し方は欄ごとに返し、呼び出し側が欄の下へ出す。
   */
  const validateVisible = (): { errors: Record<string, string>; first: string | null } => {
    const errors: Record<string, string> = {};
    for (const block of visibleInputs) {
      if (block.name in errors) continue;
      const message = validateAnswer(block, answers[block.name]);
      if (message) errors[block.name] = message;
    }
    return { errors, first: Object.values(errors)[0] ?? null };
  };

  const goNext = () => {
    const { errors, first } = validateVisible();
    setFieldErrors(errors);
    if (first) return;
    setError(null);
    if (!layout) return;
    const to = nextSectionIndex(layout, sectionIndex, answers);
    if (to >= layout.sections.length) return;
    setTrail((prev) => [...prev, sectionIndex]);
    setSectionIndex(to);
    window.scrollTo({ top: 0 });
  };

  const goBack = () => {
    setError(null);
    setTrail((prev) => {
      const next = [...prev];
      const to = next.pop();
      if (to !== undefined) setSectionIndex(to);
      return next;
    });
    window.scrollTo({ top: 0 });
  };

  // 論理送信単位の安定した冪等キー。この画面を開いている間は同じ値を
  // 使い続け、連打・通信再送を同じ回答としてまとめる
  // (イベント予約の確認画面と同じ流儀)。送り直しも同じキーで行い、
  // 新しいキーへの付け替えは利用者の明示の送り直し操作のときだけ行う。
  const [idemKey, setIdemKey] = useState<string>(() => crypto.randomUUID());
  // 内容違い・期限切れの使い回し。自動では送り直さず、利用者の操作を待つ。
  const [conflict, setConflict] = useState<
    null | { code: 'idempotency_content_mismatch' | 'idempotency_expired' }
  >(null);
  /**
   * 回答は保存できたが予約の確保に失敗したときの文言。空でなければ
   * 終わり画面に直し方と送り直しを出す（回答自体は保存済みと伝える）。
   */
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [bookingRetrying, setBookingRetrying] = useState(false);
  /** 確保できた予約 (終わりの画面の一文「次回のご予約（10月14日 13:00）は…」に使う)。 */
  const [booked, setBooked] = useState<Array<{ startsAt: string; status: string }>>([]);

  const submitErrorText = (err: unknown): string => {
    const status = (err as { status?: number }).status;
    const body = (err as { body?: { error?: string; code?: string } }).body;
    if (status === 429 || body?.code === 'idempotent_in_progress') {
      return '送信を処理中です。少し待って送り直してください。';
    }
    // サーバが断った理由（期限切れ・1人1回・定員）はそのまま出す
    return body?.error ?? '送信できませんでした。時間をおいて試してください。';
  };

  /**
   * 「予約を入れる」欄の枠を確保する。予約は「未承認」で入り、店が承認する。
   * 枠の再確認と重なり防止は予約の受け口が担い、埋まっていれば断る。
   * 試し回答では予約を入れない。失敗の文言を返し、空なら全件確保できた。
   */
  const ensureBookings = async (key: string): Promise<string | null> => {
    if (testToken || !layout) return null;
    const targets = collectInputs(layout)
      .map((block) => ({ block, picked: normalizeBookingValue(answers[block.name]) }))
      .filter((t) => t.block.type === 'booking' && t.picked !== null);
    const made: Array<{ startsAt: string; status: string }> = [];
    setBooked([]);
    for (const { block, picked } of targets) {
      const slot = picked as { menuId: string; staffId: string; startsAt: string };
      try {
        const res = await api.createRequest(
          { menu_id: slot.menuId, staff_id: slot.staffId, starts_at: slot.startsAt },
          `${key}:booking:${block.id}`,
        );
        made.push({ startsAt: slot.startsAt, status: res?.status ?? 'requested' });
        setBooked([...made]);
      } catch (err) {
        logFailure('form-booking-request', err);
        const code = (err as { body?: { error?: string } }).body?.error;
        if (code === 'slot_not_available') {
          return '選んだ枠が埋まりました。日時を選び直してください。';
        }
        return '予約の確保に失敗しました。回答は保存されています。';
      }
    }
    return null;
  };

  const retryBookings = async () => {
    setBookingRetrying(true);
    try {
      const message = await ensureBookings(idemKey);
      setBookingError(message);
    } finally {
      setBookingRetrying(false);
    }
  };

  const sendFlow = async (key: string): Promise<void> => {
    // 送り直しの判定は lib/form-submit-flow.ts の判定表に従う。内容違い・
    // 期限切れの自動付け替えはここには書かない(書くと二重回答になる)。
    let current = key;
    for (let i = 0; i < 6; i += 1) {
      const attempt = await api.submitForm(id!, {
        data: Object.fromEntries(Object.entries(answers).map(([name, value]) => [name, Array.isArray(value) ? value.map(v => v && typeof v === 'object' && 'fileId' in v ? { fileId: v.fileId } : v) : value])),
        trackedLinkId: search.get('ref') ?? undefined,
      }, current, testToken ?? undefined);
      const decision = decideFormSubmitStep(attempt);
      if (decision.action === 'done') {
        // 回答の保存後に予約を確保する。予約だけ失敗しても回答は残す。
        const bookingMessage = await ensureBookings(current);
        setBookingError(bookingMessage);
        const url = !bookingMessage ? layout!.options?.thanksUrl : undefined;
        if (url) {
          window.location.href = url;
          return;
        }
        setDone(true);
        window.scrollTo({ top: 0 });
        return;
      }
      if (decision.action === 'poll-same') {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      if (decision.action === 'adopt-key') {
        current = decision.key;
        setIdemKey(decision.key);
        continue;
      }
      if (decision.action === 'conflict') {
        setConflict({ code: decision.code });
        setError(conflictMessage(decision.code));
        return;
      }
      if (decision.action === 'busy') {
        setError('送信を処理中です。少し待って送り直してください。');
        return;
      }
      throw new Error(decision.message);
    }
    throw new Error(FORM_SUBMIT_INCOMPLETE_MESSAGE);
  };

  const submit = async (keyOverride?: string) => {
    if (!id || !layout) return;
    const { errors, first } = validateVisible();
    setFieldErrors(errors);
    if (first) return;
    if (layout.options?.confirmDialog?.enabled && !confirming && !keyOverride) {
      setConfirming(true);
      return;
    }

    setConfirming(false);
    setSending(true);
    setError(null);
    setConflict(null);
    setBookingError(null);
    try {
      await sendFlow(keyOverride ?? idemKey);
    } catch (err) {
      logFailure('form-submit', err);
      setError(submitErrorText(err));
    } finally {
      setSending(false);
    }
  };

  // 利用者の明示の送り直し操作のときだけ、新しいキーで送る。
  const resendWithFreshKey = async () => {
    const fresh = crypto.randomUUID();
    setIdemKey(fresh);
    setConflict(null);
    await submit(fresh);
  };

  if (loading) {
    return <LoadingView />;
  }

  if (error && !form) {
    return <LoadErrorView message={error} onRetry={() => setReloadKey((k) => k + 1)} />;
  }

  if (!form || !layout) return null;

  const options = layout.options ?? {};
  const theme = normalizeFormTheme(options.theme);
  /**
   * デザイン設定でフォームの色を決めているときだけ true。
   * 決めていなければ ★V8 (B8rCt) の白い地のままにし、既定の薄緑は付けない。
   */
  const hasCustomTheme = options.theme !== undefined && options.theme !== null;

  // P（試し回答）：試し合言葉があるときは、受付停止の下書きでも試せる。
  if (!form.isActive && !testToken) {
    return (
      <div className="min-h-screen bg-canvas">
        <LiffHeader title={options.pageTitle || form.name} />
        <div className="mx-auto max-w-md" style={{ backgroundColor: theme.sub }}>
          <StatusView icon="calendar" title="このフォームは、いま回答を受け付けていません。" />
        </div>
      </div>
    );
  }

  if (done) {
    // ★V8 (aNZKe)：お礼を題に、予約を入れたときはその日時と次の動きを本文に出す。
    const bookingNote = booked
      .map((b) => {
        const [m, d] = utcToJstMd(b.startsAt).split('/');
        const when = `${m}月${d}日 ${utcToJstHm(b.startsAt)}`;
        return b.status === 'confirmed'
          ? `次回のご予約（${when}）が決まりました。`
          : `次回のご予約（${when}）はお店の確認待ちです。決まったらLINEでお知らせします。`;
      })
      .join('\n');
    return (
      <div className="min-h-screen bg-canvas" data-design-node="aNZKe">
        <LiffHeader title={options.pageTitle || form.name} />
        <div
          className="mx-auto max-w-md pb-[90px]"
          style={{ backgroundColor: hasCustomTheme ? theme.sub : undefined }}
        >
          {/* 上の帯と下の帯の間の真ん中に置く (送信しました)。 */}
          <div className="flex min-h-[calc(100dvh-var(--liff-header-h)-1px-90px)] flex-col items-center justify-center px-6">
            <StatusView
              icon="check"
              tone="success"
              large
              title={layout.options?.thanksText || 'ご回答ありがとうございました'}
              body={bookingNote || undefined}
            />
          </div>
          {testToken ? (
            <p className="px-6 pb-8 text-center text-xs text-ink-faint">
              試しの回答のため、集計には入りません。
            </p>
          ) : null}
          {bookingError && (
            <div className="mx-6 mb-6 rounded-[10px] border border-liff-line-strong bg-canvas p-4">
              <p className="text-sm font-bold text-ink">{bookingError}</p>
              <div className="mt-3 flex gap-2">
                <Button variant="primary"
                  type="button"
                  onClick={() => void retryBookings()}
                  disabled={bookingRetrying}
                  className="flex-1"
                >
                  {bookingRetrying ? '確保中...' : '予約を取り直す'}
                </Button>
                <Button variant="secondary"
                  type="button"
                  onClick={() => {
                    setBookingError(null);
                    setDone(false);
                    window.scrollTo({ top: 0 });
                  }}
                  className="flex-1"
                >
                  日時を選び直す
                </Button>
              </div>
            </div>
          )}
        </div>
        <BottomBar>
          <Button variant="primary" onClick={() => liff.closeWindow()}>
            LINEに戻る
          </Button>
        </BottomBar>
      </div>
    );
  }

  const multi = layout.sections.length > 1;
  const radius = theme.cornerRadius === 'none' ? '0' : theme.cornerRadius === 'round' ? '1rem' : '0.5rem';

  const pageTitle = options.pageTitle || form.name;
  /**
   * ★V8 (B8rCt・g9osGN)：1ページ目はフォームの題と説明、2ページ目からは
   * そのページ (セクション) の名前を題にする。
   */
  const firstPage = sectionIndex === 0;
  const heading = firstPage || !section?.name ? pageTitle : section.name;
  /**
   * ページの先頭に並ぶ画像は、題の上の表紙として出す (★V8 B8rCt の「画像」)。
   * 共通ヘッダは今までどおり題の下・ページの中身の前に出す。
   */
  const pageBlocks = section?.blocks ?? [];
  let coverCount = 0;
  while (coverCount < pageBlocks.length && pageBlocks[coverCount].kind === 'image') coverCount += 1;
  const covers = pageBlocks.slice(0, coverCount);
  const bodyBlocks = [...layout.header, ...pageBlocks.slice(coverCount)];
  const blockView = (block: FormBlock, cover = false) => (
    <BlockView
      key={block.id}
      block={block}
      cover={cover}
      answers={answers}
      onChange={setValue}
      onToggle={toggleCheckbox}
      onUpload={uploadFile}
      uploading={!!uploading[block.kind === 'input' ? block.name : '']}
      error={block.kind === 'input' ? (fieldErrors[block.name] ?? null) : null}
      errorColor={theme.error}
    />
  );

  return (
    <div className="min-h-screen bg-canvas" data-design-node={wide ? 'wPfqW' : 'B8rCt'}>
      <LiffHeader title={pageTitle} />
      <div
        className="mx-auto min-h-screen w-full max-w-md pb-28"
        style={{
          color: theme.text,
          backgroundColor: hasCustomTheme ? theme.sub : undefined,
          backgroundImage: theme.backgroundImageUrl ? `url(${theme.backgroundImageUrl})` : undefined,
          backgroundPosition: 'center',
          backgroundSize: 'cover',
          // 明朝を選んだときだけ書体を替える。ふつうは LIFF の書体 (Noto Sans JP) のまま。
          fontFamily: theme.fontFamily === 'serif' ? 'serif' : undefined,
        }}
      >
        {multi && options.sectionHeader !== 'none' && (
          <div className="px-4 pt-3">
            <div className="flex gap-1" aria-hidden="true">
              {layout.sections.map((s, i) => (
                <span
                  key={s.id}
                  className={`h-1 flex-1 rounded-xs ${i <= sectionIndex ? 'bg-liff-primary' : 'bg-liff-line'}`}
                />
              ))}
            </div>
            <p className="mt-1.5 text-[10px] text-liff-sub">
              {options.sectionHeader === 'name'
                ? layout.sections[sectionIndex]?.name
                : `${sectionIndex + 1} / ${layout.sections.length} ページ`}
            </p>
          </div>
        )}
        <div className="flex flex-col gap-3.5 p-4">
          {testToken ? (
            <p className="rounded-lg border border-hairline bg-canvas px-3 py-2 text-center text-xs text-ink-faint">
              試し回答中です。この回答は集計に入りません。
            </p>
          ) : null}
          {covers.map((block) => blockView(block, true))}
          <h1 className="text-xl font-bold text-ink">{heading}</h1>
          {firstPage && form.description && (
            <p className="text-xs leading-[18px] whitespace-pre-wrap text-liff-sub">
              {form.description}
            </p>
          )}

          {bodyBlocks.map((block) => blockView(block))}

          {error && (
            <p className="rounded-lg border border-hairline bg-canvas px-3 py-2 text-sm font-bold text-danger">
              {error}
            </p>
          )}

          {conflict && (
            <div>
              <Button variant="secondary" onClick={resendWithFreshKey} disabled={sending || Object.values(uploading).some(Boolean)}>
                {conflict.code === 'idempotency_expired' ? 'もう一度送る' : '別の回答として送り直す'}
              </Button>
            </div>
          )}

          {/* 送る最後のページだけ、個人情報の取り扱いの一行。 */}
          {isLast && <PrivacyNote />}
        </div>
      </div>

      <BottomBar>
        <Button variant="primary"
          type="button"
          onClick={() => (isLast ? submit() : goNext())}
          disabled={sending || Object.values(uploading).some(Boolean)}
          style={{ backgroundColor: theme.main, color: submitButtonText(theme, hasCustomTheme), borderRadius: radius }}
        >
          {sending ? '送信中...' : isLast ? submitLabelText(options.submitLabel) : options.nextLabel || '次へ'}
        </Button>
        {trail.length > 0 && (
          <Button variant="text"
            type="button"
            onClick={goBack}
            className="self-center"
          >
            ← {options.prevLabel || '前のページへ'}
          </Button>
        )}
      </BottomBar>

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
          <div className="w-full max-w-xs rounded-xl bg-canvas p-5 text-center">
            <p className="text-sm text-ink">
              {options.confirmDialog?.text || '送信してよろしいですか？'}
            </p>
            <div className="mt-4 flex gap-2">
              <Button variant="secondary"
                type="button"
                onClick={() => setConfirming(false)}
                className="flex-1"
              >
                {options.confirmDialog?.cancelLabel || 'キャンセル'}
              </Button>
              <Button variant="primary"
                type="button"
                onClick={() => submit()}
                className="flex-1"
                style={{ backgroundColor: theme.main, color: submitButtonText(theme, hasCustomTheme), borderRadius: radius }}
              >
                {submitLabelText(options.confirmDialog?.okLabel)}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** 回答の住所の形。空欄は空文字に寄せる（未入力判定と一致させるため）。 */
type AddressDraft = {
  postalCode: string;
  prefecture: string;
  city: string;
  addressLine1: string;
  addressLine2: string;
};

function toAddressDraft(value: unknown): AddressDraft {
  const empty: AddressDraft = { postalCode: '', prefecture: '', city: '', addressLine1: '', addressLine2: '' };
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return empty;
  const v = value as Record<string, unknown>;
  const text = (key: string): string => (typeof v[key] === 'string' ? (v[key] as string) : '');
  return {
    postalCode: text('postalCode'),
    prefecture: text('prefecture'),
    city: text('city'),
    addressLine1: text('addressLine1'),
    addressLine2: text('addressLine2'),
  };
}

/**
 * F-11：住所は郵便番号→自動補完＋手入力。候補が複数の番号は選んでもらう。
 * 選ばなければ手入力の住所はそのまま残す（上書きは選んだときだけ）。
 */
function AddressFields({
  name,
  draft,
  onChange,
  placeholder,
}: {
  name: string;
  draft: AddressDraft;
  onChange: (name: string, value: unknown) => void;
  placeholder?: string;
}) {
  const [candidates, setCandidates] = useState<PostalCodeCandidate[]>([]);
  const [looking, setLooking] = useState(false);
  const [lookupMessage, setLookupMessage] = useState<string | null>(null);
  // 調べている間に書いた欄を、届いた応答で古い中身に戻さないため、
  // いちばん新しい住所を持っておく（応答のときはこれに足す）。
  const draftRef = useRef(draft);
  draftRef.current = draft;
  // 調べた郵便番号の回。郵便番号を書き換えたら古い応答・候補は使わない。
  const lookupGenRef = useRef(0);
  useEffect(
    () => () => {
      lookupGenRef.current += 1;
    },
    [],
  );

  const patch = (next: AddressDraft) => onChange(name, next);

  const applyCandidate = (c: PostalCodeCandidate) => {
    const latest = draftRef.current;
    patch({
      ...latest,
      prefecture: c.prefecture,
      city: c.city,
      // 町名は番地欄が空のときだけ入れる。書いた番地は消さない。
      addressLine1: latest.addressLine1 || c.town,
    });
    setCandidates([]);
    setLookupMessage(null);
  };

  const lookup = async () => {
    const searched = draft.postalCode;
    const gen = ++lookupGenRef.current;
    setLooking(true);
    setLookupMessage(null);
    // 応答を使ってよいか（この回が最新で、郵便番号も調べた時のまま）。
    const stillCurrent = () =>
      gen === lookupGenRef.current && draftRef.current.postalCode === searched;
    try {
      const res = await api.postalCodeSearch(searched);
      if (!stillCurrent()) return;
      if (!res.success) throw new Error('postal_code_search_failed');
      const data = res.data;
      if (data.status === 'matched' && data.candidates.length === 1) {
        applyCandidate(data.candidates[0]);
        return;
      }
      if (data.status === 'multiple') {
        setCandidates(data.candidates);
        return;
      }
      setCandidates([]);
      setLookupMessage(
        data.status === 'invalid'
          ? '郵便番号は 123-4567 のように入力してください'
          : 'その郵便番号の住所が見つかりません。下の欄へ直接入力してください',
      );
    } catch {
      if (!stillCurrent()) return;
      setCandidates([]);
      setLookupMessage('住所を調べられませんでした。下の欄へ直接入力してください');
    } finally {
      if (gen === lookupGenRef.current) setLooking(false);
    }
  };

  return (
    <AddressControls draft={draft} placeholder={placeholder} looking={looking} onLookup={() => void lookup()} onChange={(next) => {
      if (next.postalCode !== draft.postalCode) {
        lookupGenRef.current += 1;
        setLooking(false);
        setCandidates([]);
      }
      patch(next);
    }}>
      {candidates.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-ink-faint">候補が複数あります。選んでください</p>
          {candidates.map((c) => (
            <Button variant="secondary"
              key={`${c.postalCode}-${c.town}`}
              type="button"
              onClick={() => applyCandidate(c)}

            >
              {c.prefecture}
              {c.city}
              {c.town}
            </Button>
          ))}
        </div>
      )}
      {lookupMessage && <p className="text-xs text-ink-faint">{lookupMessage}</p>}
    </AddressControls>
  );
}

/**
 * 「予約を入れる」ブロック。メニューは店の指定、担当は指定か選ぶ、
 * 日にち→時刻の順に空き枠から選ぶ。選んだ枠は回答に入れ、送信後に
 * 予約の受け口で確保する（枠の再確認と重なり防止はそちらが担う）。
 */
export function BookingSlotPicker({
  block,
  value,
  onChange,
}: {
  block: FormInputBlock;
  value: unknown;
  onChange: (next: FormBookingValue | '') => void;
}) {
  const menuId = block.booking?.menuId ?? '';
  const fixedStaffId = block.booking?.staffId ?? null;
  const daysAhead = Math.min(60, Math.max(1, block.booking?.daysAhead ?? 14));
  const picked = normalizeBookingValue(value);
  const today = jstToday();
  const lastDay = addDays(today, daysAhead - 1);

  const [menu, setMenu] = useState<MenuItem | null>(null);
  const [staffList, setStaffList] = useState<StaffItem[]>([]);
  const [staffId, setStaffId] = useState<string>(fixedStaffId ?? '');
  const [byDate, setByDate] = useState<Record<string, Array<{ start: string; open: boolean; startUtc?: string }>>>({});
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  // メニューと担当を読む。担当の指定が無いときは選べるように出す。
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    Promise.all([
      api.menus(),
      fixedStaffId ? Promise.resolve(null) : api.staffOf(menuId).catch(() => null),
    ])
      .then(([menus, staff]) => {
        if (cancelled || !menuId) return;
        setMenu(menus.menus.find((m) => m.id === menuId) ?? null);
        const list = staff?.staff ?? [];
        setStaffList(list);
        if (!fixedStaffId) setStaffId((prev) => prev || list[0]?.id || '');
      })
      .catch((e) => {
        if (cancelled) return;
        logFailure('form-booking-menu', e);
        setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [menuId, fixedStaffId]);

  // 選べる期間の空きを28日ずつに割って読む（口の上限に収める）。
  useEffect(() => {
    const activeStaff = fixedStaffId ?? staffId;
    if (!menuId || !activeStaff) return;
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    const chunks: Array<[string, string]> = [];
    let head = today;
    while (head <= lastDay) {
      const tail = addDays(head, 27) <= lastDay ? addDays(head, 27) : lastDay;
      chunks.push([head, tail]);
      head = addDays(tail, 1);
    }
    Promise.all(chunks.map(([from, to]) => api.availability(menuId, activeStaff, from, to)))
      .then((results) => {
        if (cancelled) return;
        const merged: Record<string, Array<{ start: string; open: boolean; startUtc?: string }>> = {};
        for (const r of results) {
          for (const bucket of r.by_staff ?? []) {
            if (bucket.staff_id !== activeStaff) continue;
            for (const s of bucket.slots ?? []) {
              if (s.date < today || s.date > lastDay) continue;
              const open = !((s.remaining ?? 1) <= 0 || s.state === 'full' || s.state === 'closed');
              const list = (merged[s.date] ??= []);
              if (!list.some((t) => t.start === s.start)) {
                list.push({ start: s.start, open, ...(s.startUtc ? { startUtc: s.startUtc } : {}) });
              }
              else if (open) list.find((t) => t.start === s.start)!.open = true;
            }
          }
        }
        for (const d of Object.keys(merged)) {
          merged[d].sort((a, b) => (a.start < b.start ? -1 : 1));
        }
        setByDate(merged);
        setSelectedDate((prev) => {
          if (prev && merged[prev]?.some((t) => t.open)) return prev;
          return Object.keys(merged).sort().find((d) => merged[d].some((t) => t.open)) ?? null;
        });
      })
      .catch((e) => {
        if (cancelled) return;
        logFailure('form-booking-availability', e);
        setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [menuId, fixedStaffId, staffId, today, lastDay]);

  if (!menuId) {
    return <p className="text-sm text-ink-secondary">予約のメニューが決まっていません。お店に確認してください。</p>;
  }
  if (loading && Object.keys(byDate).length === 0) {
    return <p className="text-sm text-ink-faint">空き枠を読み込んでいます...</p>;
  }
  if (failed && Object.keys(byDate).length === 0) {
    return <p className="text-sm text-ink-secondary">空き枠を読めませんでした。時間をおいて開き直してください。</p>;
  }

  // ★V8 (g9osGN)：枠のある日はすべて並べ、空きの無い日は灰色で押せなくする。
  const dates = Object.keys(byDate).sort();
  const hasOpen = (d: string) => byDate[d].some((t) => t.open);
  const daySlots = (selectedDate && byDate[selectedDate]) || [];

  return (
    <div className="flex flex-col gap-2" data-design-node="g9osGN">
      {menu && (
        <p className="text-xs leading-[18px] text-liff-sub">
          {menu.name}・{menu.duration_minutes}分
        </p>
      )}
      {!fixedStaffId && staffList.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {staffList.map((s) => (
            <Button variant="choice"
              key={s.id}
              type="button"
              onClick={() => {
                // 担当を変えたら前の枠は捨てる（別の担当の枠で送らない）。
                if (picked && picked.staffId !== s.id) onChange('');
                setStaffId(s.id);
              }}
              aria-pressed={staffId === s.id}

            >
              {s.display_name}
            </Button>
          ))}
        </div>
      )}
      <BookingControls
        days={dates.map((d) => ({ date: d, weekday: formatWeekday(d), day: Number(d.slice(8, 10)), open: hasOpen(d) }))}
        selectedDate={selectedDate ?? ''}
        onDate={setSelectedDate}
        times={selectedDate ? daySlots.map((t) => ({ start: t.start, open: t.open, selected: picked?.startsAt === slotStartsAtIso({ date: selectedDate, start: t.start, startUtc: t.startUtc }) })) : []}
        onTime={(start) => {
          const t = daySlots.find((slot) => slot.start === start);
          if (!t || !t.open || !selectedDate) return;
          const startsAt = slotStartsAtIso({ date: selectedDate, start: t.start, startUtc: t.startUtc });
          onChange(picked?.startsAt === startsAt ? '' : { menuId, staffId: fixedStaffId ?? staffId, startsAt });
        }}
      />
      {!dates.some(hasOpen) && <p className="text-sm text-ink-secondary">選べる期間に空きがありません。期間を変えてください。</p>}
      {picked && (
        <p className="text-xs font-bold text-liff-primary">
          {formatJstEventAt(picked.startsAt)}〜 を選んでいます
        </p>
      )}
    </div>
  );
}

/**
 * ブロック1つを描く。
 * 直し方 (error) は欄のすぐ下に出す (★V7 4-a)。枠の色も直しの色にする。
 */
function BlockView({
  block,
  cover = false,
  answers,
  onChange,
  onToggle,
  onUpload,
  uploading,
  error,
  errorColor,
}: {
  block: FormBlock;
  /** ページの先頭の画像 (題の上の表紙)。★V8 B8rCt は高さ 96・角丸 12 の帯。 */
  cover?: boolean;
  answers: Answers;
  onChange: (name: string, value: unknown) => void;
  onToggle: (name: string, label: string) => void;
  onUpload: (name: string, file: File, side?: 'single' | 'front' | 'back') => void;
  uploading: boolean;
  error: string | null;
  errorColor: string;
}) {
  if (block.kind === 'heading') {
    const size = block.level === 1 ? 'text-xl' : block.level === 3 ? 'text-sm' : 'text-lg';
    return <h2 className={`font-bold text-ink ${size}`}>{block.text}</h2>;
  }

  if (block.kind === 'text') {
    return <p className="text-sm leading-relaxed whitespace-pre-wrap text-ink-secondary">{block.text}</p>;
  }

  if (block.kind === 'image') {
    if (!block.mediaUrl) return null;
    const image = (
      <img
        src={block.mediaUrl}
        alt=""
        className={
          cover
            ? 'h-24 w-full rounded-xl object-cover'
            : block.size === 'full'
              ? 'w-full rounded-lg'
              : 'mx-auto max-w-[70%] rounded-lg'
        }
      />
    );
    return block.linkUrl ? (
      <a href={block.linkUrl} target="_blank" rel="noreferrer">
        {image}
      </a>
    ) : (
      image
    );
  }

  if (block.kind === 'button') {
    return (
      <a
        href={block.url}
        target="_blank"
        rel="noreferrer"
        className={`block rounded-lg py-3 text-center text-sm font-bold ${
          block.style === 'outline'
            ? 'border border-liff-primary text-liff-primary'
            : 'bg-liff-primary text-white'
        }`}
      >
        {block.label}
      </a>
    );
  }

  if (block.hidden) return null;

  const value = answers[block.name];
  const text = typeof value === 'string' ? value : '';
  const checked = Array.isArray(value) ? (value as string[]) : [];
  const inputClass =
    'w-full rounded-[10px] border border-liff-line-strong bg-canvas px-3.5 py-3 text-sm text-ink placeholder:text-liff-idle focus:border-liff-primary focus:outline-none';
  /** 直しがある欄は枠を直しの色にする (お店のテーマの error)。 */
  const invalidStyle = error ? { borderColor: errorColor } : undefined;
  // 欄名・説明・直しの文を入力と結ぶ（読み上げで欄名と直し方が分かるように）。
  // id はブロックの id から作る（並べ替えても同じ欄を指す）。
  const fieldId = `lf-${block.id}`;
  const labelId = `${fieldId}-label`;
  const descId = block.description ? `${fieldId}-desc` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  const describedBy = [descId, errorId].filter(Boolean).join(' ') || undefined;
  // 1つの入力で答える欄は label の htmlFor で結ぶ。選択肢・★・住所などは群れにして欄名で呼ぶ。
  const singleControl =
    block.type === 'text' ||
    block.type === 'textarea' ||
    block.type === 'prefecture' ||
    block.type === 'select' ||
    (block.type === 'date' && block.dateStyle !== 'ymd');
  const fieldProps = { id: fieldId, 'aria-describedby': describedBy };

  return (
    <div className="flex flex-col gap-2">
      {/* ★V8 (B8rCt)：欄名と必須の札を1行に並べ、選択肢まで 8 空ける。 */}
      <LiffFieldLabel id={labelId} htmlFor={singleControl ? fieldId : undefined} label={block.label} required={block.required} />
      {block.description && (
        <p id={descId} className="-mt-1 text-xs text-ink-faint">{block.description}</p>
      )}

      <div
        {...(singleControl
          ? {}
          : { role: 'group', 'aria-labelledby': labelId, 'aria-describedby': describedBy })}
      >
        {(block.type === 'text' || block.type === 'textarea') && (
          <FormTextControl block={block} value={text} onChange={(next) => onChange(block.name, next)} style={invalidStyle} aria-invalid={!!error} {...fieldProps} />
        )}

        {block.type === 'date' &&
          (block.dateStyle === 'ymd' ? (
            <DateYmdField
              value={text}
              onChange={(next) => onChange(block.name, next)}
              placeholder={block.placeholder}
            />
          ) : (
            <FormTextControl block={block} value={text} onChange={(next) => onChange(block.name, next)} style={invalidStyle} aria-invalid={!!error} {...fieldProps} />
          ))}

        {block.type === 'prefecture' && (
          <FormSelectControl
            value={text}
            onChange={(e) => onChange(block.name, e.target.value)}
            className={inputClass}
            style={invalidStyle}
            aria-invalid={!!error}
            {...fieldProps}
          >
            <option value="">都道府県を選択</option>
            {PREFECTURES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </FormSelectControl>
        )}

        {block.type === 'select' && (
          <div>
            <FormSelectControl
              // 「その他」を自由記入したときは、プルダウンにはその選択肢を出す
              value={isOtherFreeText(block, text) ? otherLabel(block) : text}
              onChange={(e) => onChange(block.name, e.target.value)}
              className={inputClass}
              style={invalidStyle}
              aria-invalid={!!error}
              {...fieldProps}
            >
              <option value="">選択してください</option>
              {(block.choices ?? []).map((choice) => (
                <option key={choice.id} value={choice.label}>
                  {choice.label}
                </option>
              ))}
            </FormSelectControl>
            {isOtherFreeText(block, text) && (
              <OtherTextInput
                value={text}
                onChange={(next) => onChange(block.name, next)}
                inputClass={inputClass}
              />
            )}
          </div>
        )}

        {block.type === 'radio' && (
          <div className={block.inline ? 'flex flex-wrap gap-2' : 'space-y-2'}>
            {(block.choices ?? []).map((choice) => {
              // 「その他」は、ラベルそのものだけでなく自由記入の値でも選中扱い
              const isFree = choice.isOther ? isOtherFreeText(block, text) : false;
              const checkedRadio = choice.isOther
                ? text === choice.label || isFree
                : text === choice.label;
              return (
                <div key={choice.id}>
                  <FormChoiceRow selected={checkedRadio}>
                    <LiffInput
                      type="radio"
                      name={block.name}
                      checked={checkedRadio}
                      onChange={() => onChange(block.name, choice.label)}
                      className="shrink-0"
                    />
                    {choice.label}
                  </FormChoiceRow>
                  {choice.isOther && checkedRadio && (
                    <OtherTextInput
                      value={isFree ? text : ''}
                      onChange={(next) => onChange(block.name, next)}
                      inputClass={inputClass}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}

        {block.type === 'checkbox' && (
          <div className={block.inline ? 'flex flex-wrap gap-2' : 'space-y-2'}>
            {(block.choices ?? []).map((choice) => {
              const freeTexts = checked.filter((v) => isOtherFreeText(block, v));
              const isChecked = choice.isOther
                ? checked.includes(choice.label) || freeTexts.length > 0
                : checked.includes(choice.label);
              return (
                <div key={choice.id}>
                  <FormChoiceRow selected={isChecked}>
                    <LiffInput
                      type="checkbox"
                      checked={isChecked}
                      className="shrink-0"
                      onChange={() => {
                        if (!choice.isOther) {
                          onToggle(block.name, choice.label);
                          return;
                        }
                        // 「その他」を外すときは、自由記入の値も一緒に外す
                        onChange(
                          block.name,
                          isChecked
                            ? checked.filter(
                                (v) => v !== choice.label && !isOtherFreeText(block, v),
                              )
                            : [...checked, choice.label],
                        );
                      }}
                    />
                    {choice.label}
                  </FormChoiceRow>
                  {choice.isOther && isChecked && (
                    <OtherTextInput
                      value={freeTexts[0] ?? ''}
                      onChange={(next) =>
                        onChange(
                          block.name,
                          next === ''
                            ? [
                                ...checked.filter(
                                  (v) => v !== choice.label && !isOtherFreeText(block, v),
                                ),
                                choice.label,
                              ]
                            : [
                                ...checked.filter(
                                  (v) => v !== choice.label && !isOtherFreeText(block, v),
                                ),
                                next,
                              ],
                        )
                      }
                      inputClass={inputClass}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/*
          F-11：5段階評価は★で答える。初期値は「3」などの文字でも来るため
          数に直してから塗る（直せない文字は未選択として出す）。
        */}
        {block.type === 'rating' && (
          <RatingStars
            name={block.name}
            current={normalizeRatingValue(value)}
            onChange={onChange}
          />
        )}

        {/* F-11：住所は郵便番号から自動補完。手入力も残す。 */}
        {block.type === 'address' && (
          <AddressFields
            name={block.name}
            draft={toAddressDraft(value)}
            onChange={onChange}
            placeholder={block.placeholder}
          />
        )}

        {block.type === 'file' && (
          <div>
            <FormFileControl label={block.label} kind={block.fileKind} kinds={block.fileKinds} bothSides={block.fileBothSides} maxCount={block.fileMaxCount}
              files={Array.isArray(value) ? value as import('@line-crm/shared').FormFileAnswer[] : []}
              uploading={uploading} onUpload={(file, side) => onUpload(block.name, file, side)}
              onRemove={fileId => { const next = (Array.isArray(value) ? value : []).filter(v => v.fileId !== fileId); const removed = (Array.isArray(value) ? value : []).find(v => v.fileId === fileId); if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl); onChange(block.name, next); }} />
            {!Array.isArray(value) && text && (
              <div className="mt-2">
                <img src={text} alt="送った画像" className="max-h-40 rounded-lg" />
                <Button variant="text"
                  type="button"
                  onClick={() => onChange(block.name, '')}
                  className="mt-1"
                >
                  選び直す
                </Button>
              </div>
            )}
          </div>
        )}

        {block.type === 'booking' && (
          <BookingSlotPicker
            block={block}
            value={value}
            onChange={(next) => onChange(block.name, next)}
          />
        )}

        {/* 文字数。上限を決めているときだけ出す */}
        {(block.type === 'text' || block.type === 'textarea') &&
          block.limit?.max &&
          !block.limit.hideCounter && (
            <p className="mt-1 text-right text-xs text-ink-faint tabular-nums">
              {text.length}/{block.limit.max}
            </p>
          )}
      </div>

      {error && (
        <p id={errorId} className="mt-1 flex items-center gap-1 text-xs font-bold" style={{ color: errorColor }}>
          <Icon name="info" className="h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}
