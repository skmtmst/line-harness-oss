import { describe, expect, test } from "vitest";
import {
  collectInputs,
  emptyLayout,
  fieldsToLayout,
  layoutToFields,
  newBlockId,
  nextSectionIndex,
  normalizeLayout,
  parseLayout,
  validateAnswer,
  validateAnswers,
  type FormInputBlock,
  type FormLayout,
} from "./form-layout";

/** 入力ブロックを1つ作る。テストの見通しのため、必要な分だけ埋める。 */
function input(partial: Partial<FormInputBlock> & { name: string }): FormInputBlock {
  return {
    id: newBlockId(),
    kind: "input",
    type: "text",
    label: partial.name,
    ...partial,
  };
}

function layoutWith(blocks: FormInputBlock[]): FormLayout {
  const layout = emptyLayout();
  layout.sections[0].blocks = blocks;
  return layout;
}

describe("昔の fields から持ち上げる", () => {
  test("type ごとに、単一行＋入力制限へ寄せる", () => {
    const layout = fieldsToLayout([
      { name: "mail", label: "メール", type: "email", required: true },
      { name: "tel", label: "電話", type: "tel" },
      { name: "age", label: "年齢", type: "number" },
    ]);

    const inputs = collectInputs(layout);
    expect(inputs.map((b) => b.type)).toEqual(["text", "text", "text"]);
    expect(inputs.map((b) => b.limit?.format)).toEqual(["email", "tel", "integer"]);
    expect(inputs[0].required).toBe(true);
  });

  test("見出しは入力欄にならない", () => {
    const layout = fieldsToLayout([
      { name: "h", label: "基本情報", type: "heading" },
      { name: "x", label: "お名前", type: "text" },
    ]);
    expect(layout.sections[0].blocks[0].kind).toBe("heading");
    expect(collectInputs(layout)).toHaveLength(1);
  });

  test("登録先とオプションを引き継ぐ", () => {
    const layout = fieldsToLayout([
      { name: "x", label: "お名前", type: "text", friendFieldId: "ff-1" },
      { name: "y", label: "好み", type: "select", options: ["犬", "猫"] },
    ]);
    const [first, second] = collectInputs(layout);
    expect(first.destinations?.friendFieldIds).toEqual(["ff-1"]);
    expect(second.choices?.map((c) => c.label)).toEqual(["犬", "猫"]);
  });
});

describe("互換の fields を作り直す", () => {
  test("入力欄だけを、出る順に並べる", () => {
    const layout = emptyLayout();
    layout.header = [
      { id: "b1", kind: "text", text: "ごあいさつ" },
      input({ name: "from_header", label: "紹介コード" }),
    ];
    layout.sections[0].blocks = [
      { id: "b2", kind: "heading", text: "基本情報", level: 2 },
      input({ name: "full_name", label: "お名前", required: true }),
    ];

    expect(layoutToFields(layout)).toEqual([
      { name: "from_header", label: "紹介コード", type: "text", required: false },
      { name: "full_name", label: "お名前", type: "text", required: true },
    ]);
  });

  test("入力制限は昔の type 名へ寄せる", () => {
    const layout = layoutWith([
      input({ name: "mail", label: "メール", limit: { format: "email" } }),
      input({ name: "pref", label: "住まい", type: "prefecture" }),
    ]);
    expect(layoutToFields(layout).map((f) => f.type)).toEqual(["email", "select"]);
  });

  test("選択肢はラベルの配列になる", () => {
    const layout = layoutWith([
      input({
        name: "plan",
        label: "プラン",
        type: "radio",
        choices: [
          { id: "c1", label: "松", tagId: "t1" },
          { id: "c2", label: "竹", tagId: "t2" },
        ],
      }),
    ]);
    expect(layoutToFields(layout)[0].options).toEqual(["松", "竹"]);
  });
});

describe("壊れた入力を受け止める", () => {
  test("読めない JSON は fields から作り直す", () => {
    const layout = parseLayout("{壊れている", JSON.stringify([{ name: "x", label: "名前" }]));
    expect(collectInputs(layout).map((b) => b.name)).toEqual(["x"]);
  });

  test("layout も fields も無ければ、空のフォームになる", () => {
    const layout = parseLayout(null);
    expect(layout.sections).toHaveLength(1);
    expect(layout.sections[0].blocks).toHaveLength(0);
  });

  test("セクションが無い JSON でも、1枚に整える", () => {
    const layout = normalizeLayout({ version: 2, header: [], sections: [], options: {} });
    expect(layout?.sections).toHaveLength(1);
  });

  test("知らない種類のブロックは落とす", () => {
    const layout = normalizeLayout({
      sections: [{ id: "s1", name: "1", blocks: [{ id: "x", kind: "iframe", src: "..." }] }],
    });
    expect(layout?.sections[0].blocks).toHaveLength(0);
  });
});

describe("回答の検証", () => {
  test("必須が空なら断る", () => {
    const block = input({ name: "x", label: "お名前", required: true });
    expect(validateAnswer(block, "")).toBe("お名前 は必須項目です");
    expect(validateAnswer(block, "山田")).toBeNull();
  });

  test("必須でなければ、空欄は通す", () => {
    const block = input({ name: "x", label: "メモ", limit: { format: "email" } });
    expect(validateAnswer(block, "")).toBeNull();
  });

  test("形式ごとの判定", () => {
    const cases: [string, string, boolean][] = [
      ["email", "a@example.com", true],
      ["email", "a@example", false],
      ["kana", "ヤマダタロウ", true],
      ["kana", "やまだ", false],
      ["tel", "09012345678", true],
      ["tel", "090-1234-5678", true],
      ["tel", "電話", false],
      ["integer", "42", true],
      ["integer", "4.2", false],
      ["zip", "123-4567", true],
      ["zip", "1234567", true],
      ["zip", "12-34", false],
      ["time", "9:00", true],
      ["time", "25:00", false],
    ];
    for (const [format, value, ok] of cases) {
      const block = input({
        name: "x",
        label: "欄",
        limit: { format: format as never },
      });
      expect(validateAnswer(block, value) === null, `${format}: ${value}`).toBe(ok);
    }
  });

  test("文字数の上下限", () => {
    const block = input({ name: "x", label: "紹介文", limit: { min: 3, max: 5 } });
    expect(validateAnswer(block, "あい")).toBe("紹介文 は3文字以上で入力してください");
    expect(validateAnswer(block, "あいうえおか")).toBe("紹介文 は5文字までです");
    expect(validateAnswer(block, "あいうえ")).toBeNull();
  });

  test("チェックボックスの選択数", () => {
    const block = input({
      name: "x",
      label: "気になる機能",
      type: "checkbox",
      choices: [
        { id: "c1", label: "配信" },
        { id: "c2", label: "フォーム" },
        { id: "c3", label: "タグ" },
      ],
      selectionLimit: { min: 2, max: 2 },
    });
    expect(validateAnswer(block, ["配信"])).toBe("気になる機能 は2つ以上選んでください");
    expect(validateAnswer(block, ["配信", "フォーム", "タグ"])).toBe(
      "気になる機能 は2つまで選べます",
    );
    expect(validateAnswer(block, ["配信", "タグ"])).toBeNull();
  });

  test("用意していない選択肢は断る。ただし「その他」があるときは通す", () => {
    const strict = input({
      name: "x",
      label: "プラン",
      type: "radio",
      choices: [{ id: "c1", label: "松" }],
    });
    expect(validateAnswer(strict, "梅")).toBe("プラン に無い選択肢が選ばれています");

    const loose = input({
      name: "x",
      label: "プラン",
      type: "radio",
      choices: [
        { id: "c1", label: "松" },
        { id: "c2", label: "その他", isOther: true },
      ],
    });
    expect(validateAnswer(loose, "梅")).toBeNull();
  });

  test("都道府県は一覧の中だけ", () => {
    const block = input({ name: "x", label: "お住まい", type: "prefecture" });
    expect(validateAnswer(block, "東京都")).toBeNull();
    expect(validateAnswer(block, "TOKYO")).toBe("お住まい は都道府県から選んでください");
  });

  test("日付は年月日の形", () => {
    const block = input({ name: "x", label: "希望日", type: "date" });
    expect(validateAnswer(block, "2026-08-19")).toBeNull();
    expect(validateAnswer(block, "2026/8/19")).toBe("希望日 は日付を選んでください");
  });

  test("ファイルは、預けた画像のURLだけを通す", () => {
    const block = input({ name: "x", label: "お写真", type: "file" });
    expect(
      validateAnswer(block, "https://nen-line.example.workers.dev/images/form-uploads/f1/fr1/a.jpg"),
    ).toBeNull();
    // 別の場所を指すURLは、こちらが預かった画像ではない
    expect(validateAnswer(block, "https://example.com/photo.jpg")).toBe(
      "お写真 の画像を送りなおしてください",
    );
    expect(validateAnswer(block, "写真を送りました")).toBe(
      "お写真 の画像を送りなおしてください",
    );
  });

  test("非表示の欄は、必須でも問わない", () => {
    const layout = layoutWith([
      input({ name: "hidden_one", label: "内部用", required: true, hidden: true }),
      input({ name: "x", label: "お名前", required: true }),
    ]);
    expect(validateAnswers(layout, { x: "山田" })).toBeNull();
  });
});

describe("選択肢による分岐", () => {
  function branching(): FormLayout {
    const layout = emptyLayout();
    layout.sections[0].id = "s1";
    layout.sections.push(
      { id: "s2", name: "犬の人", blocks: [] },
      { id: "s3", name: "猫の人", blocks: [] },
    );
    layout.sections[0].blocks = [
      input({
        name: "pet",
        label: "飼っている子",
        type: "radio",
        choices: [
          { id: "c1", label: "犬", jumpToSectionId: "s2" },
          { id: "c2", label: "猫", jumpToSectionId: "s3" },
          { id: "c3", label: "いない" },
        ],
      }),
    ];
    return layout;
  }

  test("行き先が付いている選択肢は、そこへ飛ぶ", () => {
    const layout = branching();
    expect(nextSectionIndex(layout, 0, { pet: "猫" })).toBe(2);
  });

  test("行き先が無ければ、次のページへ進む", () => {
    const layout = branching();
    expect(nextSectionIndex(layout, 0, { pet: "いない" })).toBe(1);
  });

  test("消えたページを指していたら、次のページへ進む", () => {
    const layout = branching();
    layout.sections[0].blocks = [
      input({
        name: "pet",
        label: "飼っている子",
        type: "radio",
        choices: [{ id: "c1", label: "犬", jumpToSectionId: "s-deleted" }],
      }),
    ];
    expect(nextSectionIndex(layout, 0, { pet: "犬" })).toBe(1);
  });

  test("複数選択で行き先が2つ出たら、先に書いてあるほうへ", () => {
    const layout = branching();
    layout.sections[0].blocks = [
      input({
        name: "pet",
        label: "飼っている子",
        type: "checkbox",
        choices: [
          { id: "c1", label: "犬", jumpToSectionId: "s2" },
          { id: "c2", label: "猫", jumpToSectionId: "s3" },
        ],
      }),
    ];
    expect(nextSectionIndex(layout, 0, { pet: ["猫", "犬"] })).toBe(1);
  });

  test("最後のページからは、ページ数を超えた番号が返る（＝送信）", () => {
    const layout = branching();
    expect(nextSectionIndex(layout, 2, {})).toBe(3);
  });
});
