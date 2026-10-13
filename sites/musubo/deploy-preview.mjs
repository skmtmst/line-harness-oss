// Installs stg.musubo.jp once from the audited initial state, then updates only the reviewed
// installed state (same file inventory, verified hashes, backup and automatic restore).
// No production build, DNS, Worker, database or mail configuration operations.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "./build.mjs";
import config from "./site.config.mjs";

export const relativeTarget = "musubo.jp/public_html/stg.musubo.jp";
export function deploymentPaths(user) {
  if (!/^[a-z][a-z0-9_-]{0,31}$/.test(user || ""))
    throw new Error("MUSUBO_XSERVER_USERを指定してください");
  const accountRoot = `/home/${user}`;
  return {
    target: `${accountRoot}/${relativeTarget}`,
    lock: `${accountRoot}/.musubo-stg-site-deploy.lock`,
    backups: `${accountRoot}/musubo-site-backups`,
  };
}
export const publicFiles = [
  ".htaccess",
  "assets/site.css",
  "assets/site.js",
  "assets/symbol.svg",
  "terms/index.html",
  "privacy/index.html",
  "legal/index.html",
  "contact/index.html",
  "robots.txt",
  "sitemap.xml",
  "index.html",
];
const initialIndex =
  "3be3cd528345bb63771b934886d37c3c9011400095f0506ae3e596cea4ff6190";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
const hash = (value) => createHash("sha256").update(value).digest("hex");

export function validateInitialState(names, indexHash) {
  const allowed = [".user.ini", "default_page.png", "index.html"];
  if (names.trim().split("\n").sort().join("\n") !== allowed.sort().join("\n"))
    throw new Error(
      "初期配置から変更されています。上書きせず再監査してください",
    );
  if (indexHash !== initialIndex)
    throw new Error("既存ページが監査時から変わっています");
}

export function remoteInstall(id, user) {
  if (!/^\d{14}-[0-9a-f]{12}$/.test(id)) throw new Error("Invalid release ID");
  const { target, lock, backups } = deploymentPaths(user);
  // Only the reviewed initial index may be replaced. All other public names are new.
  return `set -euo pipefail
root=${quote(target)}
lock=${quote(lock)}
backup=${quote(`${backups}/stg-${id}`)}
for attempt in {1..30}; do
  if mkdir "$lock" 2>/dev/null; then acquired=1; break; fi
  sleep 2
done
test "\${acquired:-0}" = 1 || { echo '別の配備が実行中です。ロックは削除しません。'; exit 1; }
started=0
finish() {
  status=$?
  trap - EXIT
  if [ "$status" -ne 0 ] && [ "$started" = 1 ]; then
    mkdir -p "$backup/failed-output"
    for name in .htaccess assets terms privacy legal contact robots.txt sitemap.xml; do
      if [ -e "$root/$name" ]; then mv "$root/$name" "$backup/failed-output/$name"; fi
    done
    tar -xzf "$backup/before.tar.gz" -C "$root" ./index.html
    echo "設置に失敗したため初期ページへ復元しました。失敗した出力は $backup/failed-output に保存。"
  fi
  rmdir "$lock"
  exit "$status"
}
trap finish EXIT
test "$(readlink -f "$root")" = "$root"
test "$(ls -1A "$root" | LC_ALL=C sort | tr '\\n' '|')" = '.user.ini|default_page.png|index.html|'
for name in .user.ini default_page.png index.html; do test ! -L "$root/$name"; done
test "$(sha256sum "$root/index.html" | cut -d ' ' -f 1)" = ${initialIndex}
umask 077
mkdir -p ${quote(backups)}
mkdir "$backup"
tar -czf "$backup/before.tar.gz" -C "$root" .
tar -tzf "$backup/before.tar.gz" >/dev/null
sha256sum "$backup/before.tar.gz"
mkdir "$backup/payload"
tar -xzf - -C "$backup/payload"
cd "$backup/payload"
sha256sum -c SHA256SUMS
umask 022
started=1
mkdir "$root/assets" "$root/terms" "$root/privacy" "$root/legal" "$root/contact"
${publicFiles.map((file) => `install -m 644 ${quote(file)} ${quote(`${target}/${file}`)}`).join("\n")}
cd "$root"
sha256sum -c "$backup/payload/SHA256SUMS"
echo '確認用サイトを設置しました。DNSはこのスクリプトでは変更していません。'
echo "復元用バックアップ: $backup/before.tar.gz"
`;
}

// ---- updates of an installed review site -------------------------------------------------
export const installedRootNames = [
  ".htaccess",
  ".user.ini",
  "assets",
  "contact",
  "default_page.png",
  "index.html",
  "legal",
  "privacy",
  "robots.txt",
  "sitemap.xml",
  "terms",
];
export const installedFiles = [...publicFiles, ".user.ini", "default_page.png"];
const sortedLines = (value) =>
  String(value)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();

export function isInitialState(names) {
  return (
    sortedLines(names).join("\n") ===
    [".user.ini", "default_page.png", "index.html"].join("\n")
  );
}

export function validateInstalledState({ rootNames, files, symlinks }) {
  if (sortedLines(rootNames).join("\n") !== [...installedRootNames].sort().join("\n"))
    throw new Error(
      `確認用サイトの直下に想定外の差分があります。上書きせず停止します: ${sortedLines(rootNames).join(", ")}`,
    );
  if (sortedLines(files).join("\n") !== [...installedFiles].sort().join("\n"))
    throw new Error(
      `確認用サイトの配信ファイルに想定外の差分があります。上書きせず停止します: ${sortedLines(files).join(", ")}`,
    );
  if (sortedLines(symlinks).length)
    throw new Error("確認用サイトにシンボリックリンクがあります。配備しません");
}

export function validateChecksums(value) {
  const checksumLines = sortedLines(value);
  const named = new Set(checksumLines.map((line) => line.slice(66)));
  if (checksumLines.length !== publicFiles.length || named.size !== publicFiles.length)
    throw new Error("現在配信中のハッシュを全件取得できませんでした");
  for (const line of checksumLines) {
    const match = line.match(/^([0-9a-f]{64})  (.+)$/);
    if (!match || !publicFiles.includes(match[2]))
      throw new Error("現在配信中のハッシュ形式が不正です");
  }
  return checksumLines.join("\n");
}

export function remoteUpdate(id, user, beforeChecksums) {
  if (!/^\d{14}-[0-9a-f]{12}$/.test(id)) throw new Error("Invalid release ID");
  const verifiedBefore = validateChecksums(beforeChecksums);
  const { target, lock, backups } = deploymentPaths(user);
  const backup = `${backups}/stg-${id}`;
  const rootInventory = [...installedRootNames].sort().join("|") + "|";
  const fileInventory = [...installedFiles].sort().join("|") + "|";
  const installLines = publicFiles
    .map((file) => `install -m 644 ${quote(`${backup}/payload/${file}`)} ${quote(`${target}/${file}`)}`)
    .join("\n");
  const restoreLines = publicFiles
    .map((file) => `install -m 644 ${quote(`${backup}/before/${file}`)} ${quote(`${target}/${file}`)}`)
    .join("\n");
  return `set -euo pipefail
root=${quote(target)}
lock=${quote(lock)}
backup=${quote(backup)}
for attempt in {1..30}; do
  if mkdir "$lock" 2>/dev/null; then acquired=1; break; fi
  sleep 2
done
test "\${acquired:-0}" = 1 || { echo '別の配備が実行中です。ロックは削除しません。'; exit 1; }
started=0
finish() {
  status=$?
  trap - EXIT
  if [ "$status" -ne 0 ] && [ "$started" = 1 ]; then
    set +e
${restoreLines}
    cd "$root"
    sha256sum -c "$backup/BEFORE_SHA256SUMS"
    restore_status=$?
    set -e
    if [ "$restore_status" -eq 0 ]; then
      echo '更新に失敗したため、更新前の確認用サイトへ復元しました。'
    else
      echo '復元後のハッシュ照合に失敗しました。バックアップを保全しています。' >&2
      status=70
    fi
  fi
  rmdir "$lock" || { echo '配備ロックを解放できませんでした。' >&2; [ "$status" -ne 0 ] || status=71; }
  exit "$status"
}
trap finish EXIT
test "$(readlink -f "$root")" = "$root"
test ! -L "$root"
test "$(find "$root" -mindepth 1 -maxdepth 1 -printf '%f\\n' | LC_ALL=C sort | tr '\\n' '|')" = ${quote(rootInventory)}
test "$(find "$root" -mindepth 1 -type f -printf '%P\\n' | LC_ALL=C sort | tr '\\n' '|')" = ${quote(fileInventory)}
test -z "$(find "$root" -type l -print -quit)"
cd "$root"
printf '%s\\n' ${quote(verifiedBefore)} | sha256sum -c -
umask 077
mkdir -p ${quote(backups)}
mkdir "$backup"
printf '%s\\n' ${quote(verifiedBefore)} > "$backup/BEFORE_SHA256SUMS"
tar -czf "$backup/before.tar.gz" -C "$root" .
tar -tzf "$backup/before.tar.gz" >/dev/null
mkdir "$backup/before"
tar -xzf "$backup/before.tar.gz" -C "$backup/before"
cd "$backup/before"
sha256sum -c "$backup/BEFORE_SHA256SUMS"
cat > "$backup/payload.tar.gz"
tar -tzf "$backup/payload.tar.gz" >/dev/null
mkdir "$backup/payload"
tar -xzf "$backup/payload.tar.gz" -C "$backup/payload"
cd "$backup/payload"
sha256sum -c SHA256SUMS
test "$(find . -type f -printf '%P\\n' | LC_ALL=C sort | tr '\\n' '|')" = ${quote([...publicFiles, "SHA256SUMS"].sort().join("|") + "|")}
umask 022
started=1
${installLines}
cd "$root"
sha256sum -c "$backup/payload/SHA256SUMS"
echo '確認用サイトを更新し、配信ハッシュを照合しました。DNS・本番サイトは変更していません。'
echo "復元用バックアップ: $backup/before.tar.gz"
`;
}

async function main() {
  const flags = process.argv.slice(2);
  if (flags.some((flag) => flag !== "--apply") || flags.length > 1)
    throw new Error("Usage: node sites/musubo/deploy-preview.mjs [--apply]");
  const apply = flags.includes("--apply");
  if (config.previewOrigin !== "https://stg.musubo.jp")
    throw new Error("配備先は承認済みのstg.musubo.jpだけです");
  const user = process.env.MUSUBO_XSERVER_USER;
  const server = process.env.MUSUBO_XSERVER_HOST;
  const { target } = deploymentPaths(user);
  if (!/^sv[0-9]+\.xserver\.jp$/.test(server || ""))
    throw new Error(
      "MUSUBO_XSERVER_HOSTに確認済みのXserverホスト名を指定してください",
    );
  const host = `${user}@${server}`;
  const run = (command, args, options = {}) =>
    execFileSync(command, args, {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      ...options,
    });
  const git = (...args) => run("git", args).trim();
  if (git("status", "--porcelain"))
    throw new Error("作業ツリーがクリーンではありません");
  run("git", ["fetch", "origin", "codex/development"]);
  const sha = git("rev-parse", "HEAD");
  if (apply && sha !== git("rev-parse", "origin/codex/development"))
    throw new Error("GitHub最新 codex/development と一致していません");
  const key = process.env.MUSUBO_SSH_KEY || join(homedir(), ".ssh/id_ed25519");
  const sshArgs = [
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=10",
    "-p",
    "10022",
    "-i",
    key,
    host,
  ];
  const remote = (command, input) =>
    run("ssh", [...sshArgs, command], { input });
  const names = remote(`ls -1A ${quote(target)}`);
  const firstInstall = isInitialState(names);
  let beforeChecksums = "";
  if (firstInstall) {
    const indexHash = remote(
      `sha256sum ${quote(`${target}/index.html`)} | cut -d ' ' -f 1`,
    ).trim();
    validateInitialState(names, indexHash);
  } else {
    validateInstalledState({
      rootNames: remote(`find ${quote(target)} -mindepth 1 -maxdepth 1 -printf '%f\\n'`),
      files: remote(`find ${quote(target)} -mindepth 1 -type f -printf '%P\\n'`),
      symlinks: remote(`find ${quote(target)} -type l -printf '%P\\n'`),
    });
    beforeChecksums = validateChecksums(
      remote(`cd ${quote(target)} && sha256sum ${publicFiles.map(quote).join(" ")}`),
    );
  }
  const work = await mkdtemp(join(tmpdir(), "musubo-xserver-"));
  const output = join(work, "public");
  await build({ output });
  for (const file of publicFiles.filter((file) => file.endsWith(".html"))) {
    const html = await readFile(join(output, file), "utf8");
    if (
      !html.includes("noindex,nofollow") ||
      !html.includes("確認用サイト") ||
      !html.includes("https://nen-line-stg-admin.pages.dev/register")
    )
      throw new Error(`確認用の安全表示がありません: ${file}`);
  }
  console.log(
    `対象: ${config.previewOrigin} / ${target}\nSHA: ${sha}\n種別: ${firstInstall ? "初回設置" : "更新"}\nモード: ${apply ? "apply" : "dry-run"}\n生成物: ${work}`,
  );
  // Always print a real no-write transfer comparison before any remote write.
  const transport = ["ssh", ...sshArgs.slice(0, -1)].map(quote).join(" ");
  console.log(
    run("rsync", [
      "-rinc",
      "--itemize-changes",
      "-e",
      transport,
      `${output}/`,
      `${host}:${target}/`,
    ]),
  );
  if (!apply) return;
  const checksums = await Promise.all(
    publicFiles.map(
      async (file) => `${hash(await readFile(join(output, file)))}  ${file}`,
    ),
  );
  await writeFile(join(output, "SHA256SUMS"), checksums.join("\n") + "\n");
  const archive = join(work, "payload.tar.gz");
  // macOS tar would otherwise add AppleDouble (._*) files that the strict inventory rejects.
  run("tar", ["-czf", archive, "-C", output, ...publicFiles, "SHA256SUMS"], {
    env: { ...process.env, COPYFILE_DISABLE: "1" },
  });
  const id =
    new Date().toISOString().replace(/\D/g, "").slice(0, 14) +
    "-" +
    sha.slice(0, 12);
  console.log(
    remote(
      `bash -c ${quote(firstInstall ? remoteInstall(id, user) : remoteUpdate(id, user, beforeChecksums))}`,
      await readFile(archive),
    ),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
