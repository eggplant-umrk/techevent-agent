// 本物の活動データの入口（GitHub）。開発者本人の公開リポジトリから、ネタ帳の材料を作る。
//   npm run import:github -- --user eggplant-umrk [--name "表示名"]
//
// 読むもの（本人が持っている公開リポジトリだけ。fork・アーカイブ・非公開は除く）
//   - リポジトリの説明と README の冒頭
//   - 本人の PR（タイトル・本文の冒頭・マージ日）。マージされずに閉じたものは除く
//   - 本人のコミットのメッセージ（マージ・依存更新・typo などの日常作業を除き、リポジトリ×日でまとめる）
//   - 本人が立てた Issue（タイトル・本文の冒頭）
// 読まないもの：メールアドレス、非公開リポジトリ、ほかの人のコメント本文。
//   本文に入ったメールアドレス・Co-authored-by などの行・ほかの人の @メンションは消してから保存する。
// 出力：data/sources/github/activities.json と employees.json（本人1人分）。
//   形は data/activities.json・data/employees.json と同じ。各活動の url に GitHub の実際のページを入れる。
//
// トークンなしで動く（未認証は1時間に60回まで、この取り込みは「リポジトリ数×2＋4」回ほど）。
// 制限にかかったときだけ .env の GITHUB_TOKEN（読み取り専用・任意）を使う。値は表示・ログ・コミットしない。
import fs from "node:fs";
import path from "node:path";
import type { Activity, Employee } from "../lib/data";

const API = "https://api.github.com";
const OUT_DIR = path.join(process.cwd(), "data", "sources", "github");
const BODY_CHARS = 300;
const MAX_COMMIT_DAYS_PER_REPO = 12;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const USER = arg("user");
if (!USER || !/^[A-Za-z0-9-]+$/.test(USER)) {
  console.error("使い方: npm run import:github -- --user <GitHubのユーザー名> [--name 表示名]");
  process.exit(1);
}

// ---- GitHub API ----------------------------------------------------------------

let token: string | null = null;
let calls = 0;

/** .env から GITHUB_TOKEN だけを読む（ほかの値は読まない・環境変数にも入れない）。 */
function readTokenFromEnvFile(): string | null {
  if (!fs.existsSync(".env")) return null;
  for (const line of fs.readFileSync(".env", "utf-8").split(/\r?\n/)) {
    const m = line.match(/^\s*GITHUB_TOKEN\s*=\s*(.*)\s*$/);
    if (m) return m[1].replace(/^["']|["']$/g, "").trim() || null;
  }
  return null;
}

async function gh(pathname: string, accept = "application/vnd.github+json"): Promise<Response> {
  for (;;) {
    const headers: Record<string, string> = {
      Accept: accept,
      "User-Agent": "techevent-agent-import",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    calls++;
    const res = await fetch(`${API}${pathname}`, { headers });
    const limited = (res.status === 403 || res.status === 429) && res.headers.get("x-ratelimit-remaining") === "0";
    if (!limited) return res;
    if (token) throw new Error("GitHub のレート制限にかかりました（トークンあり）。時間をおいて試してください");
    token = readTokenFromEnvFile();
    if (!token) {
      const reset = Number(res.headers.get("x-ratelimit-reset") ?? 0) * 1000;
      throw new Error(
        `GitHub のレート制限にかかりました。${reset ? new Date(reset).toLocaleTimeString("ja-JP") + " 以降に" : "時間をおいて"}もう一度試すか、.env に GITHUB_TOKEN（読み取り専用）を入れてください`,
      );
    }
    console.log("レート制限にかかったので、.env の GITHUB_TOKEN を使って続けます");
  }
}

async function ghJson<T>(pathname: string): Promise<T> {
  const res = await gh(pathname);
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${pathname}`);
  return (await res.json()) as T;
}

interface Repo {
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  fork: boolean;
  archived: boolean;
  private: boolean;
  visibility?: string;
  language: string | null;
  topics?: string[];
  pushed_at: string;
  default_branch: string;
}

interface CommitItem {
  sha: string;
  html_url: string;
  author: { login: string } | null;
  parents: unknown[];
  commit: { message: string; author: { date: string } };
}

interface SearchItem {
  title: string;
  body: string | null;
  html_url: string;
  repository_url: string;
  state: string;
  created_at: string;
  user: { login: string };
  pull_request?: { merged_at: string | null };
}

// ---- 本文の整形（個人情報・ほかの人を消す） --------------------------------------------

let mentionsRemoved = 0;
let emailsRemoved = 0;

const TRAILER = /^\s*(co-authored-by|signed-off-by|reviewed-by|reported-by|acked-by|tested-by|cc)\s*:.*$/gim;
const GENERATED = /^.*(generated with|🤖).*$/gim;
const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;

function scrub(text: string): string {
  let t = text.replace(TRAILER, "").replace(GENERATED, "");
  t = t.replace(EMAIL, () => {
    emailsRemoved++;
    return "";
  });
  // ほかの人の @メンション（@scope/package のようなパッケージ名は残す）
  t = t.replace(/(^|[\s(（「])@([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))(?![\w/-])/g, (m, pre: string, login: string) => {
    if (login.toLowerCase() === USER!.toLowerCase() || /^(channel|here|everyone)$/i.test(login)) return m;
    mentionsRemoved++;
    return `${pre}（ほかの人）`;
  });
  return t;
}

/** Markdown を、カードの材料として読める平文にする。 */
function plain(md: string): string {
  return scrub(md)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`\n]+)`/g, (_m, code: string) => code.replace(/</g, "＜").replace(/>/g, "＞"))
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/^\s*[-*+]\s+\[[ x]\]\s*/gim, "・")
    .replace(/^\s*[-*+]\s+/gm, "・")
    .replace(/^\s*>\s?/gm, "")
    .replace(/\*\*|__|[*`|]/g, "")
    .replace(/^\s*-{3,}\s*$/gm, "")
    .replace(/\n{2,}/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n/g, " ／ ")
    .replace(/(\s*／\s*)+/g, " ／ ")
    .replace(/^\s*／\s*|\s*／\s*$/g, "")
    .trim();
}

function cut(s: string, n = BODY_CHARS): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/** UTC の日時 → 日本時間の日付（YYYY-MM-DD）。 */
function jstDate(iso: string): string {
  return new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

/** 日常の作業（カードにしないもの）。ネタ帳の指示と同じ基準でコミットだけ先に落とす。 */
const ROUTINE = /^(merge\b|bump\b|chore\(deps|update dependenc|typo|fix typo|wip\b|initial commit$|first commit$)|依存.*更新|typo|誤字/i;

// ---- 取り込み -------------------------------------------------------------------

type Draft = Omit<Activity, "id" | "author_id">;

async function main() {
  const user = USER!;
  const profile = await ghJson<{ login: string; name: string | null; type: string }>(`/users/${user}`);
  const displayName = arg("name") || profile.name || profile.login;

  const allRepos = await ghJson<Repo[]>(`/users/${user}/repos?type=owner&per_page=100&sort=pushed`);
  const repos = allRepos.filter((r) => !r.fork && !r.archived && !r.private && (r.visibility ?? "public") === "public");
  const repoNames = new Set(repos.map((r) => r.full_name.toLowerCase()));
  console.log(`リポジトリ：公開${allRepos.length}件のうち、fork・アーカイブを除いた${repos.length}件を読みます`);

  const drafts: Draft[] = [];
  const counts = { repo: 0, pr: 0, commit: 0, commitDays: 0, issue: 0, skippedCommits: 0 };

  for (const r of repos) {
    // リポジトリの説明と README の冒頭
    let readme = "";
    const rr = await gh(`/repos/${r.full_name}/readme`, "application/vnd.github.raw");
    if (rr.ok) readme = plain(await rr.text());
    const desc = r.description ? scrub(r.description).trim() : "";
    if (desc || readme) {
      drafts.push({
        type: "design_doc",
        date: jstDate(r.pushed_at),
        title: `${r.name}：${desc || "README"}`.slice(0, 120),
        body: cut([desc, readme].filter(Boolean).join(" ／ ")),
        channel: null,
        repo: r.full_name,
        url: r.html_url,
      });
      counts.repo++;
    }

    // 本人のコミット（リポジトリ×日でまとめる）
    const cr = await gh(`/repos/${r.full_name}/commits?author=${user}&per_page=100`);
    if (cr.status === 409) continue; // 空のリポジトリ
    if (!cr.ok) throw new Error(`GitHub API ${cr.status}: commits of ${r.full_name}`);
    const commits = ((await cr.json()) as CommitItem[]).filter((c) => c.author?.login?.toLowerCase() === user.toLowerCase());
    const byDay = new Map<string, Array<{ subject: string; rest: string; url: string }>>();
    for (const c of commits) {
      const [subjectRaw, ...restLines] = scrub(c.commit.message).split("\n");
      const subject = subjectRaw.trim();
      // マージ・日常作業・PR をまとめたコミット（「…(#12)」は PR の方で取り込む）
      if (c.parents.length > 1 || !subject || ROUTINE.test(subject) || /\(#\d+\)\s*$/.test(subject)) {
        counts.skippedCommits++;
        continue;
      }
      const day = jstDate(c.commit.author.date);
      const list = byDay.get(day) ?? [];
      list.push({ subject, rest: plain(restLines.join("\n")), url: c.html_url });
      byDay.set(day, list);
      counts.commit++;
    }
    const days = [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, MAX_COMMIT_DAYS_PER_REPO);
    for (const [day, list] of days) {
      // 古い順に並べ、いちばん説明の長いコミットを見出しにする
      const ordered = list.slice().reverse();
      const main = ordered.reduce((m, c) => (c.subject.length + c.rest.length > m.subject.length + m.rest.length ? c : m));
      const body =
        ordered.length === 1
          ? [main.subject, main.rest].filter(Boolean).join(" ／ ")
          : `この日のコミット${ordered.length}件：` + ordered.map((c) => c.subject).join(" ／ ");
      drafts.push({
        type: "github_pr",
        date: day,
        title: `${r.name}：${main.subject}`.slice(0, 120),
        body: cut(body),
        channel: null,
        repo: r.full_name,
        url: ordered.length === 1 ? main.url : `${r.html_url}/commits/${r.default_branch}?author=${user}&since=${day}&until=${day}`,
      });
      counts.commitDays++;
    }
  }

  // 本人の PR と Issue（本人のリポジトリのものだけ。本文は本人が書いたものだけで、コメントは読まない）
  for (const kind of ["pr", "issue"] as const) {
    const q = encodeURIComponent(`author:${user} user:${user} type:${kind} is:public`);
    const res = await ghJson<{ items: SearchItem[] }>(`/search/issues?q=${q}&per_page=100&sort=created&order=desc`);
    for (const it of res.items) {
      const full = it.repository_url.replace(`${API}/repos/`, "");
      if (!repoNames.has(full.toLowerCase())) continue; // fork・アーカイブ・ほかの人のリポジトリ
      if (it.user.login.toLowerCase() !== user.toLowerCase()) continue;
      const name = full.split("/")[1];
      if (kind === "pr") {
        const merged = it.pull_request?.merged_at ?? null;
        if (!merged && it.state === "closed") continue; // マージされずに閉じた PR
        const body = plain(it.body ?? "");
        drafts.push({
          type: "github_pr",
          date: jstDate(merged ?? it.created_at),
          title: `${name}：${scrub(it.title).trim()}`.slice(0, 120),
          body: cut(`${merged ? `マージ ${jstDate(merged)}` : "レビュー中"}${body ? " ／ " + body : ""}`),
          channel: null,
          repo: full,
          url: it.html_url,
        });
        counts.pr++;
      } else {
        const body = plain(it.body ?? "");
        drafts.push({
          type: "design_doc",
          date: jstDate(it.created_at),
          title: `${name}：${scrub(it.title).trim()}`.slice(0, 120),
          body: cut(`Issue（${it.state === "open" ? "対応中" : "完了"}）${body ? " ／ " + body : ""}`),
          channel: null,
          repo: full,
          url: it.html_url,
        });
        counts.issue++;
      }
    }
  }

  const authorId = "e001";
  drafts.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.title < b.title ? -1 : 1));
  const activities: Activity[] = drafts.map((d, i) => ({
    id: `act${String(i + 1).padStart(3, "0")}`,
    type: d.type,
    author_id: authorId,
    date: d.date,
    title: d.title,
    body: d.body,
    channel: d.channel,
    repo: d.repo,
    url: d.url,
  }));

  // 得意なこと：リポジトリの主な言語とトピック（多い順に5つまで）
  const tally = new Map<string, number>();
  for (const r of repos) for (const t of [r.language, ...(r.topics ?? [])].filter(Boolean) as string[]) tally.set(t, (tally.get(t) ?? 0) + 1);
  const tags = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t]) => t);

  const employee: Employee = {
    id: authorId,
    name: displayName,
    business_unit: "個人の開発（GitHub）",
    role: "開発者",
    expertise_tags: tags,
    past_talk_count: 0,
    last_talk_date: null,
    workload: 3, // GitHub からは分からないので中くらいにしておく
  };

  // 念のため：出力にメールアドレスが残っていないか
  const out = JSON.stringify(activities);
  if (EMAIL.test(out)) throw new Error("出力にメールアドレスのような文字列が残っています。保存しません");

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "activities.json"), JSON.stringify(activities, null, 2) + "\n", "utf-8");
  fs.writeFileSync(path.join(OUT_DIR, "employees.json"), JSON.stringify([employee], null, 2) + "\n", "utf-8");

  console.log(
    `活動 ${activities.length}件（リポジトリ紹介${counts.repo}・PR${counts.pr}・コミット${counts.commit}件を${counts.commitDays}日分にまとめたもの・Issue${counts.issue}）`,
  );
  console.log(`除いたコミット（マージ・日常作業・PRと重なるもの）${counts.skippedCommits}件／消した @メンション${mentionsRemoved}件・メールアドレス${emailsRemoved}件`);
  console.log(`GitHub API ${calls}回${token ? "（途中からトークン使用）" : "（トークンなし）"}`);
  console.log(`保存：${path.relative(process.cwd(), OUT_DIR)}/activities.json, employees.json`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
