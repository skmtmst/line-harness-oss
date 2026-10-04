// Production-only Xserver deployer for the musubo.jp apex site.
// It never changes DNS, mail, Worker, Pages, databases or the staging subtree.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "./build.mjs";
import config from "./site.config.mjs";

export const relativeTarget = "musubo.jp/public_html";
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

export const expectedRootNames = [
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
  "stg.musubo.jp",
  "terms",
];

export const expectedApexFiles = [
  ...publicFiles,
  ".user.ini",
  "default_page.png",
];

export function payloadTarEnvironment(env = process.env) {
  return { ...env, COPYFILE_DISABLE: "1" };
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const lines = (value) =>
  String(value)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();

export function deploymentPaths(user) {
  if (!/^[a-z][a-z0-9_-]{0,31}$/.test(user || ""))
    throw new Error("MUSUBO_XSERVER_USERを指定してください");
  const accountRoot = `/home/${user}`;
  return {
    target: `${accountRoot}/${relativeTarget}`,
    lock: `${accountRoot}/.musubo-production-site-deploy.lock`,
    backups: `${accountRoot}/musubo-site-backups`,
  };
}

export function validateRemoteState({ rootNames, apexFiles, symlinks }) {
  const actualRoot = lines(rootNames);
  const actualFiles = lines(apexFiles);
  const links = lines(symlinks);
  if (actualRoot.join("\n") !== [...expectedRootNames].sort().join("\n"))
    throw new Error(
      `apex直下に想定外の差分があります。上書きせず停止します: ${actualRoot.join(", ")}`,
    );
  if (actualFiles.join("\n") !== [...expectedApexFiles].sort().join("\n"))
    throw new Error(
      `apexの配信ファイルに想定外の差分があります。上書きせず停止します: ${actualFiles.join(", ")}`,
    );
  if (links.length)
    throw new Error(
      `apexにシンボリックリンクがあります。配備しません: ${links.join(", ")}`,
    );
}

export function validateProductionHtml(
  file,
  html,
  { effectiveDate = false, retention = false } = {},
) {
  if (/noindex/i.test(html) || html.includes("確認用サイト") || html.includes("stg.musubo.jp"))
    throw new Error(`staging用の表示が残っています: ${file}`);
  if (effectiveDate && !html.includes("施行日：2026-10-04"))
    throw new Error(`本番用の新しい法務文面がありません: ${file}`);
  if (retention && !html.includes("28日後に削除"))
    throw new Error(`本番用の新しい削除期限がありません: ${file}`);
}

function validateChecksums(value) {
  const checksumLines = lines(value);
  if (checksumLines.length !== publicFiles.length)
    throw new Error("現在配信中のハッシュを全件取得できませんでした");
  for (const line of checksumLines) {
    const match = line.match(/^([0-9a-f]{64})  (.+)$/);
    if (!match || !publicFiles.includes(match[2]))
      throw new Error("現在配信中のハッシュ形式が不正です");
  }
  return checksumLines.join("\n");
}

const rootInventory = [...expectedRootNames].sort().join("|") + "|";
const apexInventory = [...expectedApexFiles].sort().join("|") + "|";

export function remoteInstall(id, user, beforeChecksums) {
  if (!/^\d{14}-[0-9a-f]{12}$/.test(id)) throw new Error("Invalid release ID");
  const verifiedBefore = validateChecksums(beforeChecksums);
  const { target, lock, backups } = deploymentPaths(user);
  const backup = `${backups}/production-${id}`;
  const managedArgs = publicFiles.map(quote).join(" ");
  const installLines = publicFiles
    .map(
      (file) =>
        `install -m 644 ${quote(`${backup}/payload/${file}`)} ${quote(`${target}/${file}`)}`,
    )
    .join("\n");
  const restoreLines = publicFiles
    .map(
      (file) =>
        `install -m 644 ${quote(`${backup}/before/${file}`)} ${quote(`${target}/${file}`)}`,
    )
    .join("\n");
  const failedCopyLines = publicFiles
    .map((file) => {
      const parent = dirname(file);
      const mkdir = parent === "." ? "" : `mkdir -p ${quote(`${backup}/failed-output/${parent}`)}\n`;
      return `${mkdir}cp -p ${quote(`${target}/${file}`)} ${quote(`${backup}/failed-output/${file}`)} 2>/dev/null || true`;
    })
    .join("\n");

  return `set -euo pipefail
root=${quote(target)}
lock=${quote(lock)}
backup=${quote(backup)}
for attempt in {1..30}; do
  if mkdir "$lock" 2>/dev/null; then acquired=1; break; fi
  sleep 2
done
test "\${acquired:-0}" = 1 || { echo '別の本番サイト配備が実行中です。ロックは削除しません。'; exit 1; }
started=0
finish() {
  status=$?
  trap - EXIT
  if [ "$status" -ne 0 ] && [ "$started" = 1 ]; then
    set +e
    mkdir -p "$backup/failed-output"
${failedCopyLines}
${restoreLines}
    cd "$root"
    sha256sum -c "$backup/BEFORE_SHA256SUMS"
    restore_status=$?
    set -e
    if [ "$restore_status" -eq 0 ]; then
      echo '設置に失敗したため、配備前の本番サイトへ復元しました。'
    else
      echo '復元後のハッシュ照合に失敗しました。バックアップを保全しています。' >&2
      status=70
    fi
  fi
  rmdir "$lock" || { echo '本番配備ロックを解放できませんでした。' >&2; [ "$status" -ne 0 ] || status=71; }
  exit "$status"
}
trap finish EXIT
test "$(readlink -f "$root")" = "$root"
test ! -L "$root"
test "$(find "$root" -mindepth 1 -maxdepth 1 -printf '%f\\n' | LC_ALL=C sort | tr '\\n' '|')" = ${quote(rootInventory)}
test "$(find "$root" -mindepth 1 -maxdepth 2 -type f -printf '%P\\n' | grep -v '^stg\\.musubo\\.jp/' | LC_ALL=C sort | tr '\\n' '|')" = ${quote(apexInventory)}
test -z "$(find "$root" -type l -print -quit)"
cd "$root"
printf '%s\\n' ${quote(verifiedBefore)} | sha256sum -c -
umask 077
mkdir -p ${quote(backups)}
mkdir "$backup"
printf '%s\\n' ${quote(verifiedBefore)} > "$backup/BEFORE_SHA256SUMS"
tar -czf "$backup/before.tar.gz" --exclude='./stg.musubo.jp' -C "$root" .
tar -tzf "$backup/before.tar.gz" >/dev/null
sha256sum "$backup/before.tar.gz" > "$backup/before.tar.gz.sha256"
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
echo '本番サイトを設置し、配信ハッシュを照合しました。DNS・メール・stagingは変更していません。'
echo '復元用バックアップをウェブルート外に保存しました。内部パスはログへ出していません。'
`;
}

async function main() {
  const flags = process.argv.slice(2);
  if (flags.some((flag) => flag !== "--apply") || flags.length > 1)
    throw new Error("Usage: node sites/musubo/deploy-production.mjs [--apply]");
  const apply = flags.includes("--apply");
  if (config.origin !== "https://musubo.jp")
    throw new Error("配備先は承認済みのmusubo.jp apexだけです");

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
      maxBuffer: 4 * 1024 * 1024,
      ...options,
    });
  const git = (...args) => run("git", args).trim();
  if (git("status", "--porcelain"))
    throw new Error("作業ツリーがクリーンではありません");
  run("git", ["fetch", "origin", "codex/development"]);
  const sha = git("rev-parse", "HEAD");
  const integrated = git("rev-parse", "origin/codex/development");
  if (apply && sha !== integrated)
    throw new Error("GitHub最新 codex/development と一致していません");
  if (!apply) {
    try {
      run("git", ["merge-base", "--is-ancestor", integrated, sha]);
    } catch {
      throw new Error("作業ブランチが最新 codex/development に基づいていません");
    }
  }

  const key = process.env.MUSUBO_SSH_KEY || join(homedir(), ".ssh/id_ed25519");
  await access(key, constants.R_OK);
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

  const rootNames = remote(
    `find ${quote(target)} -mindepth 1 -maxdepth 1 -printf '%f\\n' | LC_ALL=C sort`,
  );
  const apexFiles = remote(
    `find ${quote(target)} -mindepth 1 -maxdepth 2 -type f -printf '%P\\n' | grep -v '^stg\\.musubo\\.jp/' | LC_ALL=C sort`,
  );
  const symlinks = remote(`find ${quote(target)} -type l -printf '%P\\n'`);
  validateRemoteState({ rootNames, apexFiles, symlinks });
  const beforeChecksums = validateChecksums(
    remote(`cd ${quote(target)} && sha256sum ${publicFiles.map(quote).join(" ")}`),
  );

  const work = await mkdtemp(join(tmpdir(), "musubo-production-"));
  const output = join(work, "public");
  await build({ production: true, output });
  for (const file of publicFiles.filter((file) => file.endsWith(".html"))) {
    const html = await readFile(join(output, file), "utf8");
    validateProductionHtml(
      file,
      html,
      {
        effectiveDate:
          file === "privacy/index.html" || file === "terms/index.html",
        retention: file === "privacy/index.html",
      },
    );
  }

  console.log(
    `対象: ${config.origin} / [Xserver apex]\nSHA: ${sha}\nモード: ${apply ? "apply" : "dry-run"}\n生成物: ${work}`,
  );
  console.log("遠隔ファイル一覧:");
  console.log(lines(rootNames).join("\n"));
  console.log("no-write差分:");
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
  run(
    "tar",
    ["-czf", archive, "-C", output, ...publicFiles, "SHA256SUMS"],
    { env: payloadTarEnvironment() },
  );
  const id =
    new Date().toISOString().replace(/\D/g, "").slice(0, 14) +
    "-" +
    sha.slice(0, 12);
  console.log(
    remote(
      `bash -c ${quote(remoteInstall(id, user, beforeChecksums))}`,
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
