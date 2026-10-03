import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import liff from '@line/liff';
import {
  PREFECTURES,
  collectInputs,
  isOtherFreeText,
  nextSectionIndex,
  normalizeFormTheme,
  validateAnswer,
  type FormBlock,
  type FormInputBlock,
  type FormLayout,
} from '@line-crm/shared';
import { submitButtonText } from '../lib/form-button-text.js';
import { liffLookVars } from '../lib/liff-look.js';
import { api, type PublicForm } from '../lib/api.js';
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
import LiffHeader from '../components/ui/LiffHeader.js';
import BottomBar from '../components/ui/BottomBar.js';
import StatusView from '../components/ui/StatusView.js';
import Icon from '../components/ui/Icon.js';

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
function RequiredMark() {
  return (
    <span className="ml-1.5 rounded bg-liff-required-bg px-1.5 py-px text-[10px] font-bold whitespace-nowrap text-liff-sun">
      必須
    </span>
  );
}

/**
 * 送信ボタンの文字。管理画面で決めた名前があればそれを使い、
 * 決めていないとき (空・旧い既定の「送信」) は設計どおり「送信する」。
 */
function submitLabelText(label: string | undefined): string {
  if (label && label !== '送信') return label;
  return '送信する';
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
          <span className="text-sm text-ink-faint">{spec.label}</span>
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
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const data = await api.getForm(id, testToken ?? undefined);
        if (cancelled) return;
        setForm(data);
        setAnswers(initialAnswers(data.layout));
        if (data.layout.options?.pageTitle) {
          document.title = data.layout.options.pageTitle;
        }

        // 前回の回答を出す設定のときだけ、サーバが中身を返す。
        // 試しでは前の試しを書き戻さない（本物の回答も出さない）。
        if (!testToken && data.layout.options?.restorePrevious) {
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
      const res = await api.uploadFormFile(id, file, testToken ?? undefined);
      setValue(name, res.data.url);
      clearFieldError(name);
    } catch (err) {
      logFailure('form-upload', err);
      setError('画像を送れませんでした。もう一度お試しください。');
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
      }, current, testToken ?? undefined);
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
   * 決めていなければ殻 (bg-ground) の灰色のままにし、既定の薄緑は付けない。
   */
  const hasCustomTheme = options.theme !== undefined && options.theme !== null;

  // P（試し回答）：試し合言葉があるときは、受付停止の下書きでも試せる。
  if (!form.isActive && !testToken) {
    return (
      <div className="min-h-screen bg-ground">
        <LiffHeader title={options.pageTitle || form.name} />
        <div className="mx-auto max-w-md" style={{ backgroundColor: theme.sub }}>
          <StatusView icon="calendar" title="このフォームは、いま回答を受け付けていません。" />
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen bg-ground" data-design-node="aNZKe">
        <LiffHeader title={options.pageTitle || form.name} />
        <div className="mx-auto max-w-md pb-28" style={{ backgroundColor: theme.sub }}>
          <StatusView
            icon="check"
            tone="success"
            title="送信しました"
            body={layout.options?.thanksText || 'ご回答ありがとうございました。'}
          />
          {testToken ? (
            <p className="px-6 pb-8 text-center text-xs text-ink-faint">
              試しの回答のため、集計には入りません。
            </p>
          ) : null}
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

  return (
    <div className="min-h-screen bg-ground" data-design-node={wide ? 'wPfqW' : 'B8rCt'}>
      <LiffHeader title={pageTitle} />
      <div
        className="mx-auto min-h-screen w-full max-w-md px-4 pt-3 pb-28"
        style={{
          ...liffLookVars(),
          color: theme.text,
          backgroundColor: hasCustomTheme ? theme.sub : undefined,
          backgroundImage: theme.backgroundImageUrl ? `url(${theme.backgroundImageUrl})` : undefined,
          backgroundPosition: 'center',
          backgroundSize: 'cover',
          fontFamily: theme.fontFamily === 'serif' ? 'serif' : 'sans-serif',
        }}
      >
        {multi && options.sectionHeader !== 'none' && (
          <div className="mb-3">
            <div className="flex gap-1" aria-hidden="true">
              {layout.sections.map((s, i) => (
                <span
                  key={s.id}
                  className="h-1 flex-1 rounded-full"
                  style={{
                    backgroundColor:
                      i <= sectionIndex ? 'var(--liff-look-main)' : 'var(--liff-look-line)',
                  }}
                />
              ))}
            </div>
            <p className="mt-1.5 text-[10px] text-[var(--liff-look-sub)] tabular-nums">
              {options.sectionHeader === 'name'
                ? layout.sections[sectionIndex]?.name
                : `${sectionIndex + 1} / ${layout.sections.length}ページ`}
            </p>
          </div>
        )}
        {testToken ? (
          <p className="mb-3 rounded-lg border border-hairline bg-canvas px-3 py-2 text-center text-xs text-ink-faint">
            試し回答中です。この回答は集計に入りません。
          </p>
        ) : null}
        <div>
          <h1 className="text-xl font-bold text-[var(--liff-look-ink)]">{pageTitle}</h1>
          {form.description && (
            <p className="mt-1 text-xs leading-relaxed whitespace-pre-wrap text-[var(--liff-look-sub)]">
              {form.description}
            </p>
          )}

          <div className="mt-4 space-y-5">
            {[...layout.header, ...(section?.blocks ?? [])].map((block) => (
              <BlockView
                key={block.id}
                block={block}
                answers={answers}
                onChange={setValue}
                onToggle={toggleCheckbox}
                onUpload={uploadFile}
                uploading={!!uploading[block.kind === 'input' ? block.name : '']}
                error={block.kind === 'input' ? (fieldErrors[block.name] ?? null) : null}
                errorColor={theme.error}
              />
            ))}
          </div>

          {error && (
            <p className="mt-4 rounded-lg border border-hairline bg-canvas px-3 py-2 text-sm font-bold text-danger">
              {error}
            </p>
          )}

          {conflict && (
            <div className="mt-2">
              <Button variant="secondary" onClick={resendWithFreshKey} disabled={sending}>
                {conflict.code === 'idempotency_expired' ? 'もう一度送る' : '別の回答として送り直す'}
              </Button>
            </div>
          )}
        </div>
      </div>

      <BottomBar>
        <button
          type="button"
          onClick={() => (isLast ? submit() : goNext())}
          disabled={sending}
          className="w-full py-3 text-[15px] font-bold disabled:opacity-50"
          style={{ backgroundColor: theme.main, color: submitButtonText(theme, hasCustomTheme), borderRadius: radius }}
        >
          {sending ? '送信中...' : isLast ? submitLabelText(options.submitLabel) : options.nextLabel || '次へ'}
        </button>
        {trail.length > 0 && (
          <button
            type="button"
            onClick={goBack}
            className="self-center px-4 py-1 text-xs text-[var(--liff-look-sub)] focus-visible:outline-2 focus-visible:outline-ink"
          >
            ← {options.prevLabel || '前のページへ'}
          </button>
        )}
      </BottomBar>

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
          <div className="w-full max-w-xs rounded-xl bg-canvas p-5 text-center">
            <p className="text-sm text-ink">
              {options.confirmDialog?.text || '送信してよろしいですか？'}
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="flex-1 rounded-lg border border-hairline bg-canvas py-2 text-sm text-ink"
              >
                {options.confirmDialog?.cancelLabel || 'キャンセル'}
              </button>
              <button
                type="button"
                onClick={() => submit()}
                className="flex-1 py-2 text-sm font-bold"
                style={{ backgroundColor: theme.main, color: submitButtonText(theme, hasCustomTheme), borderRadius: radius }}
              >
                {submitLabelText(options.confirmDialog?.okLabel)}
              </button>
            </div>
          </div>
        </div>
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
  answers,
  onChange,
  onToggle,
  onUpload,
  uploading,
  error,
  errorColor,
}: {
  block: FormBlock;
  answers: Answers;
  onChange: (name: string, value: unknown) => void;
  onToggle: (name: string, label: string) => void;
  onUpload: (name: string, file: File) => void;
  uploading: boolean;
  error: string | null;
  errorColor: string;
}) {
  if (block.kind === 'heading') {
    const size = block.level === 1 ? 'text-xl' : block.level === 3 ? 'text-sm' : 'text-lg';
    return <h2 className={`font-bold text-[var(--liff-look-ink)] ${size}`}>{block.text}</h2>;
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
        className={`block rounded-lg py-3 text-center text-sm font-bold ${
          block.style === 'outline'
            ? 'border border-[var(--liff-look-main)] text-[var(--liff-look-main)]'
            : 'bg-[var(--liff-look-main)] text-white'
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
    'w-full rounded-[var(--liff-look-radius)] border border-[var(--liff-look-line-strong)] bg-canvas px-3 py-2 text-sm text-[var(--liff-look-ink)] placeholder:text-[var(--liff-look-idle)] focus:border-[var(--liff-look-main)] focus:outline-none';
  /** 直しがある欄は枠を直しの色にする (お店のテーマの error)。 */
  const invalidStyle = error ? { borderColor: errorColor } : undefined;

  return (
    <div>
      <label className="block text-sm font-bold text-[var(--liff-look-ink)]">
        {block.label}
        {block.required && <RequiredMark />}
      </label>
      {block.description && (
        <p className="mt-0.5 text-xs text-ink-faint">{block.description}</p>
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
            style={invalidStyle}
            aria-invalid={!!error}
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
            style={invalidStyle}
            aria-invalid={!!error}
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
              style={invalidStyle}
              aria-invalid={!!error}
            />
          ))}

        {block.type === 'prefecture' && (
          <select
            value={text}
            onChange={(e) => onChange(block.name, e.target.value)}
            className={inputClass}
            style={invalidStyle}
            aria-invalid={!!error}
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
              style={invalidStyle}
              aria-invalid={!!error}
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
          <div className={block.inline ? 'flex flex-wrap gap-2' : 'space-y-2'}>
            {(block.choices ?? []).map((choice) => {
              // 「その他」は、ラベルそのものだけでなく自由記入の値でも選中扱い
              const isFree = choice.isOther ? isOtherFreeText(block, text) : false;
              const checkedRadio = choice.isOther
                ? text === choice.label || isFree
                : text === choice.label;
              return (
                <div key={choice.id}>
                  <label
                    className={`flex min-h-12 items-center gap-2.5 rounded-[10px] border px-3.5 py-3 text-sm ${
                      checkedRadio
                        ? 'border-[var(--liff-look-main)] bg-[var(--liff-look-soft)] font-semibold text-ink'
                        : 'border-[var(--liff-look-line-strong)] bg-canvas text-ink'
                    }`}
                  >
                    <input
                      type="radio"
                      name={block.name}
                      checked={checkedRadio}
                      onChange={() => onChange(block.name, choice.label)}
                      className="h-[18px] w-[18px] shrink-0 accent-[var(--liff-look-main)]"
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
          <div className={block.inline ? 'flex flex-wrap gap-2' : 'space-y-2'}>
            {(block.choices ?? []).map((choice) => {
              const freeTexts = checked.filter((v) => isOtherFreeText(block, v));
              const isChecked = choice.isOther
                ? checked.includes(choice.label) || freeTexts.length > 0
                : checked.includes(choice.label);
              return (
                <div key={choice.id}>
                  <label
                    className={`flex min-h-12 items-center gap-2.5 rounded-[10px] border px-3.5 py-3 text-sm ${
                      isChecked
                        ? 'border-[var(--liff-look-main)] bg-[var(--liff-look-soft)] font-semibold text-ink'
                        : 'border-[var(--liff-look-line-strong)] bg-canvas text-ink'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      className="h-[18px] w-[18px] shrink-0 accent-[var(--liff-look-main)]"
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
              className="w-full text-sm text-ink-secondary file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--liff-look-main)] file:px-3 file:py-2 file:text-sm file:font-medium file:text-white disabled:opacity-50"
            />
            {uploading && <p className="mt-1 text-xs text-ink-faint">送っています...</p>}
            {text && (
              <div className="mt-2">
                <img src={text} alt="送った画像" className="max-h-40 rounded-lg" />
                <button
                  type="button"
                  onClick={() => onChange(block.name, '')}
                  className="mt-1 min-h-11 text-xs text-ink-faint underline"
                >
                  選び直す
                </button>
              </div>
            )}
            <p className="mt-1 text-xs text-ink-faint">jpg・png・gif・webp・heic、10MBまで</p>
          </div>
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
        <p className="mt-1 flex items-center gap-1 text-xs font-bold" style={{ color: errorColor }}>
          <Icon name="info" className="h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}
