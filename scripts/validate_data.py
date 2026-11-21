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
check(isinstance(data["learnings.json"], list), "learnings must be a list")

print(f"employees={len(emps)} activities={len(acts)} {dict(types)} events={len(evs)} requests={len(reqs)} rules={len(rules)}")
print(f"top5 talk share={top5_share:.0%}  attendance rate range="
      f"{min(v['attendance_rate'] for v in evs)}-{max(v['attendance_rate'] for v in evs)}")
if errors:
    print("FAILED:")
    for e in errors:
        print("  -", e)
    sys.exit(1)
print("ALL CHECKS PASSED")
