import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  PREFECTURES,
  collectInputs,
  formThemeButtonText,
  isOtherFreeText,
  nextSectionIndex,
  normalizeFormTheme,
  validateAnswer,
  type FormBlock,
  type FormInputBlock,
  type FormLayout,
} from '@line-crm/shared';
import { api, type PublicForm } from '../lib/api.js';
import {
  conflictMessage,
  decideFormSubmitStep,
  FORM_SUBMIT_INCOMPLETE_MESSAGE,
} from '../lib/form-submit-flow.js';
import { logFailure } from '../lib/user-message.js';
import LoadErrorView from '../components/LoadErrorView.js';
import LoadingView from '../components/LoadingView.js';

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

function Asterisk() {
  return <span className="ml-1 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] text-red-700">必須</span>;
}

/** 'YYYY-MM-DD' を [年, 月, 日] に分ける。形でない値は空3つにする。 */
function splitYmd(value: string): [string, string, string] {
  const m = /^(\d{1,4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  return m ? [m[1], m[2], m[3]] : ['', '', ''];
}

/**
 * 日付を「年・月・日」の3欄で入れる。
 *
 * 編集画面で「年月日を3つに分ける」を選んだ日付欄に使う。カレンダー式は
 * 選びにくい年代（生年月日など）があるための出し分け。
 * 3欄とも入るまでは形の合わない値を回答に入れ、送信時の検証で
 * 「日付を選んでください」へ流す（途中経過を正しい値と誤認しないため）。
 */
function DateYmdField({
  value,
  onChange,
  inputClass,
}: {
  value: string;
  onChange: (next: string) => void;
  inputClass: string;
}) {
  const [parts, setParts] = useState<[string, string, string]>(() => splitYmd(value));
  // 自分が出した値が戻ってきたときは欄を上書きしない（途中の入力が消えるため）
  const lastEmitted = useRef<string | null>(null);

  useEffect(() => {
    if (value === lastEmitted.current) return;
    setParts(splitYmd(value));
  }, [value]);

  const update = (index: number, raw: string) => {
    const digits = raw.replace(/[^\d]/g, '').slice(0, index === 0 ? 4 : 2);
    const next = [...parts] as [string, string, string];
    next[index] = digits;
    setParts(next);
    const all = next.every((p) => p !== '');
    const emitted = all
      ? `${next[0].padStart(4, '0')}-${next[1].padStart(2, '0')}-${next[2].padStart(2, '0')}`
      : next.some((p) => p !== '')
        ? `${next[0] || '0000'}-${next[1] || '00'}-${next[2] || '00'}`
        : '';
    lastEmitted.current = emitted;
    onChange(emitted);
  };

  const partClass = `${inputClass} text-center`;
  const specs: { placeholder: string; label: string; maxLength: number }[] = [
    { placeholder: '年', label: '年', maxLength: 4 },
    { placeholder: '月', label: '月', maxLength: 2 },
    { placeholder: '日', label: '日', maxLength: 2 },
  ];
  return (
    <div className="flex items-center gap-2">
      {specs.map((spec, i) => (
        <span key={spec.label} className="flex items-center gap-1">
          <input
            type="text"
            inputMode="numeric"
            value={parts[i]}
            maxLength={spec.maxLength}
            placeholder={spec.placeholder}
            aria-label={spec.label}
            onChange={(e) => update(i, e.target.value)}
            className={partClass}
            style={{ width: i === 0 ? '4.5rem' : '3.25rem' }}
          />
          <span className="text-sm text-gray-500">{spec.label}</span>
        </span>
      ))}
    </div>
  );
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
    <input
      type="text"
      value={value}
      placeholder="具体的に入力してください"
      onChange={(e) => onChange(e.target.value)}
      className={`${inputClass} mt-1.5`}
    />
  );
}

export default function Form() {
  const { id } = useParams<{ id: string }>();
  const [search] = useSearchParams();

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
  /** 送信中のファイル欄。二重に押させないため欄ごとに持つ */
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const data = await api.getForm(id);
        if (cancelled) return;
        setForm(data);
        setAnswers(initialAnswers(data.layout));
        if (data.layout.options?.pageTitle) {
          document.title = data.layout.options.pageTitle;
        }

        // 前回の回答を出す設定のときだけ、サーバが中身を返す
        if (data.layout.options?.restorePrevious) {
          try {
            const latest = await api.getMyLatestFormAnswer(id);
            if (!cancelled && latest?.answers) {
              setAnswers((prev) => ({ ...prev, ...latest.answers }));
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
  }, [id, reloadKey]);

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

  const setValue = (name: string, value: unknown) =>
    setAnswers((prev) => ({ ...prev, [name]: value }));

  const toggleCheckbox = (name: string, label: string) =>
    setAnswers((prev) => {
      const current = Array.isArray(prev[name]) ? (prev[name] as string[]) : [];
      return {
        ...prev,
        [name]: current.includes(label)
          ? current.filter((v) => v !== label)
          : [...current, label],
      };
    });

  /**
   * 画像を預けて、回答にはURLを入れる。
   *
   * 中身をそのまま回答データに入れない。回答は D1 に JSON で入るので、
   * 画像を base64 で持たせると1件で数MBになり、一覧を開くだけで重くなる。
   */
  const uploadFile = async (name: string, file: File) => {
    if (!id) return;
    setError(null);
    setUploading((prev) => ({ ...prev, [name]: true }));
    try {
      const res = await api.uploadFormFile(id, file);
      setValue(name, res.data.url);
    } catch (err) {
      logFailure('form-upload', err);
      setError('画像を送れませんでした。もう一度お試しください。');
    } finally {
      setUploading((prev) => ({ ...prev, [name]: false }));
    }
  };

  /** このページだけを見る。次のページの必須は、そこへ着くまで問わない。 */
  const validateCurrent = (): string | null => {
    for (const block of visibleInputs) {
      const message = validateAnswer(block, answers[block.name]);
      if (message) return message;
    }
    return null;
  };

  const goNext = () => {
    const message = validateCurrent();
    if (message) {
      setError(message);
      return;
    }
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

  const submitErrorText = (err: unknown): string => {
    const status = (err as { status?: number }).status;
    const body = (err as { body?: { error?: string; code?: string } }).body;
    if (status === 429 || body?.code === 'idempotent_in_progress') {
      return '送信を処理中です。少し待って送り直してください。';
    }
    // サーバが断った理由（期限切れ・1人1回・定員）はそのまま出す
    return body?.error ?? '送信できませんでした。時間をおいて試してください。';
  };

  const sendFlow = async (key: string): Promise<void> => {
    // 送り直しの判定は lib/form-submit-flow.ts の判定表に従う。内容違い・
    // 期限切れの自動付け替えはここには書かない(書くと二重回答になる)。
    let current = key;
    for (let i = 0; i < 6; i += 1) {
      const attempt = await api.submitForm(id!, {
        data: answers,
        trackedLinkId: search.get('ref') ?? undefined,
      }, current);
      const decision = decideFormSubmitStep(attempt);
      if (decision.action === 'done') {
        const url = layout!.options?.thanksUrl;
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
    const message = validateCurrent();
    if (message) {
      setError(message);
      return;
    }
    if (layout.options?.confirmDialog?.enabled && !confirming && !keyOverride) {
      setConfirming(true);
      return;
    }

    setConfirming(false);
    setSending(true);
    setError(null);
    setConflict(null);
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

  if (!form.isActive) {
    return (
      <div className="p-8 text-center text-sm text-gray-500">
        このフォームは、いま回答を受け付けていません。
      </div>
    );
  }

  if (done) {
    return (
      <div className="mx-auto max-w-md p-8 text-center">
        <p className="text-base font-bold text-gray-900">送信しました</p>
        <p className="mt-2 text-sm whitespace-pre-wrap text-gray-600">
          {layout.options?.thanksText || 'ご回答ありがとうございました。'}
        </p>
      </div>
    );
  }

  const options = layout.options ?? {};
  const theme = normalizeFormTheme(options.theme);
  const multi = layout.sections.length > 1;
  const radius = theme.cornerRadius === 'none' ? '0' : theme.cornerRadius === 'round' ? '1rem' : '0.5rem';

  return (
    <div
      className="mx-auto min-h-screen max-w-md p-4 pb-24"
      style={{
        color: theme.text,
        backgroundColor: theme.sub,
        backgroundImage: theme.backgroundImageUrl ? `url(${theme.backgroundImageUrl})` : undefined,
        backgroundPosition: 'center',
        backgroundSize: 'cover',
        fontFamily: theme.fontFamily === 'serif' ? 'serif' : 'sans-serif',
      }}
    >
      {multi && options.sectionHeader !== 'none' && (
        <div className="mb-4 flex items-center justify-center gap-2">
          {layout.sections.map((s, i) => (
            <span
              key={s.id}
              className={`text-xs tabular-nums ${
                i === sectionIndex ? 'font-bold' : 'text-gray-400'
              }`}
              style={i === sectionIndex ? { color: theme.main } : undefined}
            >
              {options.sectionHeader === 'name' ? s.name : i + 1}
            </span>
          ))}
        </div>
      )}

      <div className="space-y-5">
        {[...layout.header, ...(section?.blocks ?? [])].map((block) => (
          <BlockView
            key={block.id}
            block={block}
            answers={answers}
            onChange={setValue}
            onToggle={toggleCheckbox}
            onUpload={uploadFile}
            uploading={!!uploading[block.kind === 'input' ? block.name : '']}
          />
        ))}
      </div>

      {error && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      {conflict && (
        <button
          onClick={resendWithFreshKey}
          disabled={sending}
          className="mt-2 w-full rounded-lg border border-gray-300 py-3 text-sm font-bold text-gray-700 disabled:opacity-50"
        >
          {conflict.code === 'idempotency_expired' ? 'もう一度送る' : '別の回答として送り直す'}
        </button>
      )}

      <div className="mt-6 flex gap-2">
        {trail.length > 0 && (
          <button
            onClick={goBack}
            className="flex-1 rounded-lg border border-gray-300 py-3 text-sm font-medium text-gray-700"
          >
            {options.prevLabel || '前へ'}
          </button>
        )}
        <button
          onClick={() => (isLast ? submit() : goNext())}
          disabled={sending}
          className="flex-1 py-3 text-sm font-bold disabled:opacity-50"
          style={{ backgroundColor: theme.main, color: formThemeButtonText(theme), borderRadius: radius }}
        >
          {sending ? '送信中...' : isLast ? options.submitLabel || '送信' : options.nextLabel || '次へ'}
        </button>
      </div>

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
          <div className="w-full max-w-xs rounded-xl bg-white p-5 text-center">
            <p className="text-sm text-gray-900">
              {options.confirmDialog?.text || '送信してよろしいですか？'}
            </p>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setConfirming(false)}
                className="flex-1 rounded-lg border border-gray-300 py-2 text-sm text-gray-700"
              >
                {options.confirmDialog?.cancelLabel || 'キャンセル'}
              </button>
              <button
                onClick={() => submit()}
                className="flex-1 py-2 text-sm font-bold"
                style={{ backgroundColor: theme.main, color: formThemeButtonText(theme), borderRadius: radius }}
              >
                {options.confirmDialog?.okLabel || '送信'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** ブロック1つを描く。 */
function BlockView({
  block,
  answers,
  onChange,
  onToggle,
  onUpload,
  uploading,
}: {
  block: FormBlock;
  answers: Answers;
  onChange: (name: string, value: unknown) => void;
  onToggle: (name: string, label: string) => void;
  onUpload: (name: string, file: File) => void;
  uploading: boolean;
}) {
  if (block.kind === 'heading') {
    const size = block.level === 1 ? 'text-xl' : block.level === 3 ? 'text-sm' : 'text-lg';
    return <h2 className={`font-bold text-gray-900 ${size}`}>{block.text}</h2>;
  }

  if (block.kind === 'text') {
    return <p className="text-sm leading-relaxed whitespace-pre-wrap text-gray-600">{block.text}</p>;
  }

  if (block.kind === 'image') {
    if (!block.mediaUrl) return null;
    const image = (
      <img
        src={block.mediaUrl}
        alt=""
        className={block.size === 'full' ? 'w-full rounded-lg' : 'mx-auto max-w-[70%] rounded-lg'}
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
        className={`block rounded-lg py-3 text-center text-sm font-medium ${
          block.style === 'outline'
            ? 'border border-emerald-500 text-emerald-600'
            : 'bg-emerald-500 text-white'
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
    'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none';

  return (
    <div>
      <label className="block text-sm font-medium text-gray-900">
        {block.label}
        {block.required && <Asterisk />}
      </label>
      {block.description && (
        <p className="mt-0.5 text-xs text-gray-500">{block.description}</p>
      )}

      <div className="mt-1.5">
        {block.type === 'text' && (
          <input
            type={block.limit?.format === 'email' ? 'email' : block.limit?.format === 'tel' ? 'tel' : 'text'}
            value={text}
            placeholder={block.placeholder}
            maxLength={block.limit?.max}
            onChange={(e) => onChange(block.name, e.target.value)}
            className={inputClass}
          />
        )}

        {block.type === 'textarea' && (
          <textarea
            rows={4}
            value={text}
            placeholder={block.placeholder}
            maxLength={block.limit?.max}
            onChange={(e) => onChange(block.name, e.target.value)}
            className={`${inputClass} resize-y`}
          />
        )}

        {block.type === 'date' &&
          (block.dateStyle === 'ymd' ? (
            <DateYmdField
              value={text}
              onChange={(next) => onChange(block.name, next)}
              inputClass={inputClass}
            />
          ) : (
            <input
              type="date"
              value={text}
              onChange={(e) => onChange(block.name, e.target.value)}
              className={inputClass}
            />
          ))}

        {block.type === 'prefecture' && (
          <select
            value={text}
            onChange={(e) => onChange(block.name, e.target.value)}
            className={inputClass}
          >
            <option value="">都道府県を選択</option>
            {PREFECTURES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        )}

        {block.type === 'select' && (
          <div>
            <select
              // 「その他」を自由記入したときは、プルダウンにはその選択肢を出す
              value={isOtherFreeText(block, text) ? otherLabel(block) : text}
              onChange={(e) => onChange(block.name, e.target.value)}
              className={inputClass}
            >
              <option value="">選択してください</option>
              {(block.choices ?? []).map((choice) => (
                <option key={choice.id} value={choice.label}>
                  {choice.label}
                </option>
              ))}
            </select>
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
          <div className={block.inline ? 'flex flex-wrap gap-3' : 'space-y-2'}>
            {(block.choices ?? []).map((choice) => {
              // 「その他」は、ラベルそのものだけでなく自由記入の値でも選中扱い
              const isFree = choice.isOther ? isOtherFreeText(block, text) : false;
              const checkedRadio = choice.isOther
                ? text === choice.label || isFree
                : text === choice.label;
              return (
                <div key={choice.id}>
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="radio"
                      name={block.name}
                      checked={checkedRadio}
                      onChange={() => onChange(block.name, choice.label)}
                    />
                    {choice.label}
                  </label>
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
          <div className={block.inline ? 'flex flex-wrap gap-3' : 'space-y-2'}>
            {(block.choices ?? []).map((choice) => {
              const freeTexts = checked.filter((v) => isOtherFreeText(block, v));
              const isChecked = choice.isOther
                ? checked.includes(choice.label) || freeTexts.length > 0
                : checked.includes(choice.label);
              return (
                <div key={choice.id}>
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={isChecked}
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
                  </label>
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

        {block.type === 'file' && (
          <div>
            <input
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif"
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onUpload(block.name, file);
              }}
              className="w-full text-sm text-gray-700 file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-500 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white disabled:opacity-50"
            />
            {uploading && <p className="mt-1 text-xs text-gray-500">送っています...</p>}
            {text && (
              <div className="mt-2">
                <img src={text} alt="送った画像" className="max-h-40 rounded-lg" />
                <button
                  onClick={() => onChange(block.name, '')}
                  className="mt-1 text-xs text-gray-500 underline"
                >
                  選び直す
                </button>
              </div>
            )}
            <p className="mt-1 text-xs text-gray-400">jpg・png・gif・webp・heic、10MBまで</p>
          </div>
        )}

        {/* 文字数。上限を決めているときだけ出す */}
        {(block.type === 'text' || block.type === 'textarea') &&
          block.limit?.max &&
          !block.limit.hideCounter && (
            <p className="mt-1 text-right text-xs text-gray-400 tabular-nums">
              {text.length}/{block.limit.max}
            </p>
          )}
      </div>
    </div>
  );
}
