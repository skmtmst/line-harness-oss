#!/usr/bin/env python3
"""Check the QA plan against pinned Git documents without connecting to staging."""

import csv
import hashlib
import json
from pathlib import Path
import re
import subprocess


HERE = Path(__file__).resolve().parent
ROOT = Path(subprocess.check_output(
    ["git", "-C", str(HERE), "rev-parse", "--show-toplevel"], text=True
).strip())
SHA = "22eed60ed62cb2a233d16a56787808c7c3629fd3"
CACHE = {}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def git(*args):
    return subprocess.check_output(["git", "-C", str(ROOT), *args])


def source(path):
    if path not in CACHE:
        CACHE[path] = git("show", f"{SHA}:{path}")
    return CACHE[path]


def read(name):
    with (HERE / name).open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle, delimiter="\t")
        require(len(set(reader.fieldnames)) == len(reader.fieldnames), f"duplicate columns: {name}")
        rows = list(reader)
    require(rows and all(None not in r and None not in r.values() for r in rows), f"bad TSV: {name}")
    return rows


def unique(rows, key):
    result = {r[key]: r for r in rows}
    require(len(result) == len(rows), f"duplicate key: {key}")
    return result


def split(value):
    return value.split(";") if value else []


def acceptance(path):
    """Independently extract ID tables, preserving source order and all cells."""
    header = None
    rows = []
    for number, line in enumerate(source(path).decode().splitlines(), 1):
        if not line.startswith("|"):
            header = None
            continue
        cells = [c.strip() for c in re.split(r"(?<!\\)\|", line.strip())[1:-1]]
        if cells[0] == "ID":
            header = cells
        elif header and re.fullmatch(r"[A-Z][A-Z0-9]*-\d+", cells[0]):
            require(len(cells) == len(header), f"table width: {path}:{number}")
            rows.append((number, header, cells))
    return rows


def check_refs(text):
    pattern = r"([a-f0-9]{40}):(docs/[^:;\s]+):L(\d+)-L(\d+)"
    refs = re.findall(pattern, text)
    require(refs, "missing pinned source reference")
    for sha, path, start, end in refs:
        require(sha == SHA, f"wrong source SHA: {path}")
        require(path in source_paths, f"reference missing from manifest: {path}")
        require(1 <= int(start) <= int(end) <= len(source(path).splitlines()), f"bad line range: {path}")
    return set(refs)


def check_pending(row):
    for field in ("ライバル比較_結果", "ライバル_手数"):
        require(row[field].startswith("未確認"), f"unverified rival claim: {row['case_key']}")
    for field in ("musubo_押す回数", "musubo_画面数", "musubo_入力欄数", "初見_誤操作回数", "初見_戻った回数"):
        require(row[field] == "未測定", f"invented measurement: {row['case_key']}:{field}")
    for field in ("初見_結果", "初見_探したもの", "初見_実際にあった場所", "初見_迷いごとの記録", "操作記録_参照"):
        require(row[field].startswith("未実施"), f"invented result: {row['case_key']}:{field}")


cases = read("CASES.tsv")
case_by_key = unique(cases, "case_key")
raw = unique(read("SOURCE-ROWS.tsv"), "case_key")
manifest = read("SOURCE-MANIFEST.tsv")
extra_sources = read("USABILITY-SOURCES.tsv")
source_paths = {r["source"] for r in manifest} | {r["path"] for r in extra_sources}
require(len(manifest) == 96 and len(extra_sources) == 24, "source manifest size")
for row in manifest:
    path = row["source"]
    require(row["SHA"] == SHA, f"manifest SHA: {path}")
    require(git("rev-parse", f"{SHA}:{path}").decode().strip() == row["blob"], f"blob: {path}")
    require(len(source(path).splitlines()) == int(row["行数"]), f"source length: {path}")
for row in extra_sources:
    path = row["path"]
    require(row["sha"] == SHA, f"extra source SHA: {path}")
    require(git("rev-parse", f"{SHA}:{path}").decode().strip() == row["blob"], f"extra blob: {path}")
    require(hashlib.sha256(source(path)).hexdigest() == row["sha256"], f"extra hash: {path}")

extracted = {}
for row in manifest:
    count = int(row["分類対象の行数"])
    if count:
        path = row["source"]
        rows = acceptance(path)
        require(len(rows) == count, f"acceptance count: {path}")
        for number, header, cells in rows:
            key = f"{Path(path).name}::{cells[0]}"
            require(key not in extracted, f"source key collision: {key}")
            extracted[key] = (path, number, header, cells)
require(set(extracted) == set(raw) == set(case_by_key), "missing or extra behavior ID")
for key, (path, number, header, cells) in extracted.items():
    row, case = raw[key], case_by_key[key]
    require(row["出典"] == case["出典"] == path, f"source path: {key}")
    require(int(row["行"]) == int(case["行"]) == number, f"source line: {key}")
    require(json.loads(row["header_json"]) == header, f"source header: {key}")
    require(json.loads(row["cells_json"]) == cells, f"source cells: {key}")
    require(case["原文ID"] == cells[0] and case["要件SHA"] == SHA, f"case ID/SHA: {key}")

counts = json.loads((HERE / "B352-COUNTS.json").read_text())
original_columns = list(cases[0])[:18]
original_rows = [{k: r[k] for k in original_columns} for r in cases]
original_hash = hashlib.sha256(json.dumps(original_rows, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
require(original_hash == counts["元18列の意味内容sha256"], "original 18 columns changed")
require(len(cases) == counts["元の受け入れ"] == 1654, "original denominator changed")
actual_classes = {k: sum(r["主分類"] == k for r in cases) for k in ("自動", "単体", "手")}
require(actual_classes == counts["主分類"] == {"自動": 1337, "単体": 257, "手": 60}, "classification changed")

tasks = unique(read("USABILITY-TASKS.tsv"), "作業ID")
expected = {f"COM-{i:02}" for i in range(1, 6)}
for group, count in (("STD", 5), ("FOOD", 7), ("SALON", 6), ("MEET", 6), ("CLASS", 7)):
    expected.update(f"{group}-{i:02}" for i in range(1, count + 1))
gap_ids = {f"GAP-{group}{i}" for group in ("B", "G") for i in range(1, 10)} | {"GAP-U1", "GAP-H1"}
require(set(tasks) == expected | gap_ids, "task coverage: five industries or twenty added features")
plan = (HERE / "PLAN.md").read_text()
owner_section = plan.split("## 12. 使いやすさとライバル比較", 1)[1].split("### 12-1.", 1)[0].rstrip() + "\n"
require(hashlib.sha256(owner_section.encode()).hexdigest() == counts["B352の司令塔追記本文sha256"], "B-352 commander text changed")
require(set(re.findall(r"^\d+\. \*\*([A-Z]+-\d+)\*\*", plan, re.M)) == expected, "PLAN §6 task mapping")
plan_cases = {}
current_source = None
for line in plan.split("## 11. IDごとの分類", 1)[1].split("## 付録A.", 1)[0].splitlines():
    if line.startswith("### ") and " — " in line:
        current_source = line[4:].split(" — ", 1)[0]
    if current_source and re.match(r"^\| [A-Z]+-\d+ \|", line):
        cells = [c.strip() for c in line.split("|")[1:-1]]
        key = f"{current_source}::{cells[0]}"
        require(key not in plan_cases, f"duplicate PLAN ID: {key}")
        plan_cases[key] = (cells[1], cells[2])
require(plan_cases == {key: (r["行"], r["主分類"]) for key, r in case_by_key.items()}, "PLAN §11 classification differs from CASES")
require(len(tasks) == counts["作業数"] == 56, "task count")
require(counts["共通作業"] == 5 and counts["業種固有作業"] == 31 and counts["追加機能"] == 20, "task subtotals")
all_refs = set()
for key, task in tasks.items():
    all_refs |= check_refs(task["比較根拠_固定版_箇所"])
    all_refs |= check_refs(task["言葉の確認根拠"])
    require(task["比較相手"] and task["根拠の範囲と未確認"] and task["初見へ渡す目的"], f"missing purpose/evidence: {key}")
    require(task["評価状態"].startswith("未実施"), f"invented task result: {key}")
    require(set(split(task["関連case_key"])) <= set(case_by_key), f"missing case: {key}")
    require(task["計画の通し区間"] == f"PLAN.md §6 {key}" or key in gap_ids, f"missing task in PLAN: {key}")
    if key not in gap_ids:
        all_refs |= check_refs(task["作業の出典"])
    for case_key in split(task["関連case_key"]):
        require(key in split(case_by_key[case_key]["使いやすさ作業ID"]), f"missing reverse task link: {key}/{case_key}")
for row in cases:
    ids = split(row["使いやすさ作業ID"])
    if ids:
        for key in ids:
            require(key in tasks and row["case_key"] in split(tasks[key]["関連case_key"]), f"extra task link: {key}")
            require(tasks[key]["比較根拠_固定版_箇所"] in row["比較根拠_固定版_箇所"], f"stale case reference: {key}")
        require(row["使いやすさ対象"].startswith("対象（" if row["主分類"] == "自動" else "補助（"), f"wrong scope: {row['case_key']}")
        check_pending(row)
    else:
        require(row["使いやすさ対象"].startswith("対象外（"), f"unmapped target: {row['case_key']}")
    candidates = row["既存試験の候補_存在のみ照合"]
    if not candidates.startswith("候補未特定"):
        for candidate in candidates.split(" ; "):
            require((ROOT / candidate).is_file(), f"missing existing test candidate: {candidate}")
auto_count = sum(r["使いやすさ対象"].startswith("対象（") for r in cases)
support_count = sum(r["使いやすさ対象"].startswith("補助（") for r in cases)
require(auto_count == counts["評価対象のA行"] == 151, "A target count")
require(support_count == counts["通しに関連する補助行"] == 35, "support count")
require(len(cases) - auto_count - support_count == counts["使いやすさ対象外の既存行"] == 1468, "non-target count")

gap = unique(read("GAP-USABILITY-CASES.tsv"), "case_key")
gap_source_rows = {}
for row in extra_sources:
    if row["受け入れ行数"] == "対象外":
        continue
    path = row["path"]
    extracted_rows = acceptance(path)
    require(len(extracted_rows) == int(row["受け入れ行数"]), f"gap source count: {path}")
    task_id = "GAP-" + Path(path).name.split("-")[0]
    require(task_id in gap_ids, f"gap source task: {path}")
    actual_ids = []
    for number, header, cells in extracted_rows:
        key = f"{Path(path).name}::{cells[0]}"
        gap_source_rows[key] = (path, number, dict(zip(header, cells)), task_id)
        actual_ids.append(cells[0])
    require(split(tasks[task_id]["追加機能の受け入れID"]) == actual_ids, f"gap task acceptance coverage: {task_id}")
require(set(gap) == set(gap_source_rows), "missing or extra gap ID")
require(len(gap) == counts["追加機能の受け入れ参照行"] == 503, "gap denominator")
for key, (path, number, cells, task_id) in gap_source_rows.items():
    row = gap[key]
    require(row["出典"] == path and row["要件SHA"] == SHA and int(row["行"]) == number, f"gap source: {key}")
    require(row["原文ID"] == cells["ID"] and json.loads(row["受け入れ全セル_JSON"]) == cells, f"gap cells: {key}")
    require(row["使いやすさ作業ID"] == task_id, f"gap task link: {key}")
    require(row["比較根拠_固定版_箇所"] == tasks[task_id]["比較根拠_固定版_箇所"], f"gap reference: {key}")
    check_pending(row)

for key in ("SALON-06", "CLASS-06"):
    require("gap-features/B2-tickets-monthly.md:L8-L13" in tasks[key]["比較根拠_固定版_箇所"], f"B2 evidence: {key}")
for key in ("MEET-01", "MEET-02", "MEET-03", "MEET-04", "MEET-06"):
    require("gap-features/B7-online-meeting-calendar.md:L8-L13" in tasks[key]["比較根拠_固定版_箇所"], f"B7 evidence: {key}")
require(counts["固定した要件SHA"] == SHA, "counts source SHA")
require(len(source_paths) == counts["照合した固定資料"] == 118, "source count")
require(len(all_refs) == counts["作業別の根拠箇所"] == 61, "evidence location count")
require(git("merge-base", "--is-ancestor", counts["取り込んだ本線SHA"], "HEAD") == b"", "recorded base not included")
require(not any((HERE / name).exists() for name in ("RESULTS.tsv", "FINDINGS.md", "USABILITY-RIVAL.md")), "stage 2 output present during planning")
print(f"PASS: 固定資料 {len(source_paths)}本、受け入れ {len(cases)}件、元18列・自動1337/単体257/手60を保持")
print(f"PASS: 作業 {len(tasks)}本、A対象 {auto_count}件・補助 {support_count}件、追加機能 {len(gap)}行、根拠 {len(all_refs)}箇所")
print("PASS: 全セル・行番号・blob/sha256・双方向の作業対応・未実施の状態を照合。段2・外部接続なし")
