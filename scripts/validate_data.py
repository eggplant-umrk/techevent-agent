"""Parse data/*.json and check counts and cross-references."""
import json
import sys
from collections import Counter
from pathlib import Path

D = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "data"
errors = []


def check(cond, msg):
    if not cond:
        errors.append(msg)


data = {}
for f in sorted(D.glob("*.json")):
    try:
        data[f.name] = json.loads(f.read_text(encoding="utf-8"))
        print(f"OK parse  {f.name}")
    except json.JSONDecodeError as e:
        errors.append(f"parse error {f.name}: {e}")

emps = data["employees.json"]
acts = data["activities.json"]
evs = data["events.json"]
reqs = data["requests.json"]
rules = data["application_rules.json"]["rules"]

check(len(emps) == 30, f"employees {len(emps)}")
check(len(acts) == 120, f"activities {len(acts)}")
check(len(evs) == 20, f"events {len(evs)}")
check(len(reqs) == 5, f"requests {len(reqs)}")
for name, items in [("employees", emps), ("activities", acts), ("events", evs), ("requests", reqs), ("rules", rules)]:
    ids = [x["id"] for x in items]
    check(len(ids) == len(set(ids)), f"duplicate ids in {name}")

eid = {e["id"]: e for e in emps}
units = {"バクラク", "Ai Workforce", "Fintech", "セキュリティ", "CTO室"}
for e in emps:
    check(e["business_unit"] in units, f"{e['id']} unit")
    check(1 <= e["workload"] <= 5, f"{e['id']} workload")
    check((e["past_talk_count"] == 0) == (e["last_talk_date"] is None), f"{e['id']} talk count/date mismatch")

talks = sorted((e["past_talk_count"] for e in emps), reverse=True)
top5_share = sum(talks[:5]) / sum(talks)
check(top5_share >= 0.8, f"top5 share {top5_share:.2f}")

types = Counter(a["type"] for a in acts)
check(set(types) == {"slack_post", "github_pr", "design_doc", "weekly_report"}, f"types {types}")
for a in acts:
    check(a["author_id"] in eid, f"{a['id']} author")
    check("2026-09-01" <= a["date"] <= "2026-11-30", f"{a['id']} date {a['date']}")
    check((a["channel"] is None) != (a["repo"] is None), f"{a['id']} channel/repo")

ev_count = Counter()
for v in evs:
    r = v["attendees"] / v["applications"]
    check(0.6 <= r <= 0.9, f"{v['id']} rate {r:.2f}")
    check(v["applications"] <= v["capacity"], f"{v['id']} over capacity")
    for s in v["speaker_ids"]:
        check(s in eid, f"{v['id']} speaker {s}")
        ev_count[s] += 1
        check(eid[s]["last_talk_date"] >= v["date"], f"{s} last_talk_date older than {v['id']}")
for s, n in ev_count.items():
    check(n <= eid[s]["past_talk_count"], f"{s} events {n} > past_talk_count")

check({r["pattern"] for r in reqs} == {"open_slot", "theme_specified", "named_speaker"}, "request patterns")
for r in reqs:
    if r["nominated_employee_id"]:
        check(r["nominated_employee_id"] in eid, f"{r['id']} nominee")

pubs = data["published.json"]
check(30 <= len(pubs) <= 50, f"published {len(pubs)}")
for p in pubs:
    check(p["author_id"] in eid, f"{p['id']} author")
    check(p["business_unit"] == eid[p["author_id"]]["business_unit"], f"{p['id']} unit")
for s in data["schedules.json"]:
    check(s["employee_id"] in eid, f"schedule {s}")
    check(s["from"] <= s["to"], f"schedule range {s}")
acts_by_id = {a["id"]: a for a in acts}
pub_by_id = {p["id"]: p for p in pubs}

# ネタ帳の材料は activities.json だけではない（lib/data.ts の activities() と同じ）：
#   ブログ（data/sources/blog_posts.json、id は blg…）とリリースノート（data/sources/release_notes.json、id は rel…）も活動として扱う。
#   リリースノートの担当者は lib/releaseNotes.ts の ownerOf と同じ順：技術広報の割り当て > データの owner_id > キーワード一致＋AI の判断
SRC = D / "sources"


def load_source(name, default):
    f = SRC / name
    if not f.exists():
        return default
    try:
        return json.loads(f.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        errors.append(f"parse error sources/{name}: {e}")
        return default


blogs = load_source("blog_posts.json", [])
notes = load_source("release_notes.json", [])
owners = data.get("release_owners.json", {})
for b in blogs:
    check(b["id"].startswith("blg"), f"blog id {b['id']}")
    check(b["author_id"] in eid, f"{b['id']} author")
    check(b.get("published_id") in pub_by_id, f"{b['id']} published_id {b.get('published_id')}")
    if b.get("published_id") in pub_by_id:
        check(pub_by_id[b["published_id"]]["author_id"] == b["author_id"], f"{b['id']} author differs from {b['published_id']}")
    acts_by_id.setdefault(b["id"], {"author_id": b["author_id"]})


def note_owner(n):
    r = owners.get(n["id"]) or {}
    if r.get("by") == "human" and r.get("employee_id"):
        return r["employee_id"]
    if n.get("owner_id"):
        return n["owner_id"]
    if r.get("by") == "match" and r.get("employee_id"):
        return r["employee_id"]
    return ""


for n in notes:
    check(n["id"].startswith("rel"), f"release note id {n['id']}")
    own = note_owner(n)
    check(own == "" or own in eid, f"{n['id']} owner {own}")
    acts_by_id.setdefault(n["id"], {"author_id": own})
check(len(acts_by_id) == len(acts) + len(blogs) + len(notes), "activity ids collide across activities / blog_posts / release_notes")
for c in data.get("cards.json", []):
    for aid in c["evidence_activity_ids"] + c.get("announcement_activity_ids", []):
        check(aid in acts_by_id and acts_by_id[aid]["author_id"] == c["employee_id"], f"{c['card_id']} bad activity id {aid}")
    for pid in c["published_ids"]:
        check(pid in pub_by_id and pub_by_id[pid]["author_id"] == c["employee_id"], f"{c['card_id']} bad published id {pid}")
    check(1 <= len(c["themes"]) <= 3, f"{c['card_id']} themes")
    req_by_id = {r["id"]: r for r in reqs}
    for rid in c.get("evidence_request_ids", []):
        check(rid in req_by_id and req_by_id[rid].get("nominated_employee_id") == c["employee_id"], f"{c['card_id']} bad request id {rid}")
    check(bool(c["evidence_activity_ids"] or c["published_ids"] or c.get("evidence_request_ids")), f"{c['card_id']} has no evidence")

# surveys (v0.4): Google Forms CSV exports, data/surveys/{event_id}.csv. Fictional.
import csv as _csv
ev_by_id = {v["id"]: v for v in evs}
emp_names = [e["name"] for e in emps]
files = sorted((D / "surveys").glob("*.csv")) if (D / "surveys").exists() else []
check(5 <= len(files) <= 6, f"surveys cover {len(files)} events (want 5-6)")
for f in files:
    ev_id = f.stem
    ev = ev_by_id.get(ev_id)
    check(ev is not None, f"surveys/{f.name}: unknown event")
    rows = list(_csv.reader(f.read_text(encoding="utf-8").splitlines()))
    head, body = rows[0], rows[1:]
    check(head[0] == "タイムスタンプ", f"surveys/{f.name}: first column must be タイムスタンプ")
    check(20 <= len(body) <= 40, f"surveys/{f.name}: {len(body)} answers (want 20-40)")
    col = {h: i for i, h in enumerate(head)}
    mail = next((i for h, i in col.items() if "メール" in h), None)
    name = next((i for h, i in col.items() if "名前" in h), None)
    talk = next((i for h, i in col.items() if "どの登壇" in h), None)
    rate = next((i for h, i in col.items() if "満足度" in h), None)
    for n, r in enumerate(body, 2):
        check(len(r) == len(head), f"surveys/{f.name} row {n}: {len(r)} cells")
        check(r[rate] in ("1", "2", "3", "4", "5"), f"surveys/{f.name} row {n}: rating {r[rate]}")
        if talk is not None and ev:
            check(any(r[talk].startswith(eid_name) for eid_name in [eid[s_]["name"] for s_ in ev["speaker_ids"]]), f"surveys/{f.name} row {n}: talk {r[talk]}")
        if mail is not None and r[mail]:
            check(r[mail].endswith("@example.com"), f"surveys/{f.name} row {n}: e-mail must be @example.com")
        if name is not None and r[name]:
            check(r[name] not in emp_names, f"surveys/{f.name} row {n}: an employee name in the name column")
        free = [c for i, c in enumerate(r) if i not in (mail, name, talk)]
        check(not any("@" in c for c in free), f"surveys/{f.name} row {n}: e-mail outside the e-mail column")
        check(not any(en in c for c in free for en in emp_names), f"surveys/{f.name} row {n}: an employee name in a free answer")

print(f"employees={len(emps)} activities={len(acts)} {dict(types)} events={len(evs)} requests={len(reqs)} rules={len(rules)}")
print(f"top5 talk share={top5_share:.0%}  attendance rate range="
      f"{min(v['attendance_rate'] for v in evs)}-{max(v['attendance_rate'] for v in evs)}")
if errors:
    print("FAILED:")
    for e in errors:
        print("  -", e)
    sys.exit(1)
print("ALL CHECKS PASSED")
