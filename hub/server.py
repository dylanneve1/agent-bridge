#!/usr/bin/env python3
"""
Agent Hub — Unified portal server.
Serves the SPA and proxies bridge API requests, including SSE streams.
"""

import http.server
import json
import os
import socketserver
import threading
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

PORT = 8089
BRIDGE = "http://localhost:8765"
BRIDGE_KEY = os.environ.get("BRIDGE_KEY", "waQvo5Pk6axfdekXqEicoLeloQutKaOEKAqNzg_YhCI")
STATIC_DIR = Path(__file__).parent
ALERTS_FILE = Path(__file__).parent / "alerts.json"

# ─── Alert System ───────────────────────────────────────────────────────────

def bridge_get(path, timeout=8):
    """Quick bridge API GET, returns (status, data)."""
    try:
        req = urllib.request.Request(BRIDGE + path)
        req.add_header("x-api-key", BRIDGE_KEY)
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, {"error": str(e)}
    except urllib.error.URLError as e:
        return -1, {"error": str(e.reason)}
    except Exception as e:
        return -2, {"error": str(e)}


def check_bridge_health():
    """Check bridge availability and uptime."""
    status, data = bridge_get("/status")
    if status == -1:
        return {"id": "bridge-unreachable", "title": "Bridge Unreachable",
                "message": f"Connection failed: {data.get('error','')}",
                "severity": "critical", "detector": "Bridge Health"}
    if status != 200:
        return {"id": "bridge-http-error", "title": "Bridge HTTP Error",
                "message": f"Bridge returned HTTP {status}",
                "severity": "critical", "detector": "Bridge Health"}
    uptime = data.get("uptime_seconds", 999)
    if uptime < 300:
        return {"id": "bridge-restart", "title": "Bridge Recently Restarted",
                "message": f"Uptime only {uptime}s — possible crash recovery",
                "severity": "warning", "detector": "Bridge Health"}
    return None


def check_task_backlog():
    """Check for stalled task board."""
    status, data = bridge_get("/board")
    if status != 200:
        return None
    board = data.get("board", {})
    open_tasks = len(board.get("open", []))
    in_progress = len(board.get("in_progress", []))
    blocked = len(board.get("blocked", []))
    if blocked >= 3:
        return {"id": "tasks-blocked", "title": f"{blocked} Tasks Blocked",
                "message": "Multiple blocked tasks — check dependencies or reassign",
                "severity": "warning", "detector": "Task Board"}
    if open_tasks > 10 and in_progress == 0:
        return {"id": "tasks-stalled", "title": "Task Board Stalled",
                "message": f"{open_tasks} open tasks, none in progress",
                "severity": "warning", "detector": "Task Board"}
    return None


def check_disk():
    """Check disk usage."""
    try:
        st = os.statvfs("/")
        used_pct = round((1 - st.f_bavail / st.f_blocks) * 100, 1)
        if used_pct > 90:
            return {"id": "disk-critical", "title": "Disk Space Critical",
                    "message": f"Usage at {used_pct}% — cleanup needed",
                    "severity": "critical", "detector": "System"}
        if used_pct > 80:
            return {"id": "disk-warning", "title": "Disk Space Warning",
                    "message": f"Usage at {used_pct}%",
                    "severity": "warning", "detector": "System"}
    except Exception:
        pass
    return None


def check_karma_anomaly():
    """Check for karma trajectory anomalies from CSV."""
    csv_path = Path.home() / ".openclaw/workspace/skills/moltbook/karma-history.csv"
    if not csv_path.exists():
        return None
    try:
        lines = csv_path.read_text().strip().split("\n")[-24:]  # last 24 entries
        if len(lines) < 6:
            return None
        entries = []
        for line in lines:
            parts = line.split(",")
            if len(parts) >= 2 and parts[1].strip().isdigit():
                entries.append(int(parts[1].strip()))
        if len(entries) < 6:
            return None
        recent = entries[-3:]
        earlier = entries[-6:-3]
        recent_avg = sum(recent) / len(recent)
        earlier_avg = sum(earlier) / len(earlier)
        delta = recent_avg - earlier_avg
        if delta < -20:
            return {"id": "karma-drop", "title": "Karma Drop Detected",
                    "message": f"Average dropped by {abs(delta):.0f} over last few hours",
                    "severity": "warning", "detector": "Moltbook"}
    except Exception:
        pass
    return None


def check_queue_health():
    """Check Moltbook post/comment queues."""
    alerts = []
    for name, path in [("post", Path.home() / ".config/moltbook/pending-thoughts.json"),
                       ("comment", Path.home() / ".config/moltbook/pending-comments.json")]:
        try:
            if path.exists():
                queue = json.loads(path.read_text())
                if name == "post" and len(queue) < 2:
                    alerts.append({"id": f"queue-{name}-low", "title": f"Post Queue Low ({len(queue)})",
                                   "message": "Queue below minimum — needs refill",
                                   "severity": "warning", "detector": "Moltbook"})
        except Exception:
            pass
    return alerts


def run_all_checks():
    """Run all anomaly detectors, return list of alerts."""
    now = datetime.now(timezone.utc).isoformat()
    alerts = []
    for check_fn in [check_bridge_health, check_task_backlog, check_disk, check_karma_anomaly]:
        try:
            result = check_fn()
            if result:
                result["timestamp"] = now
                result.setdefault("status", "active")
                alerts.append(result)
        except Exception:
            pass
    # Queue checks return lists
    try:
        for alert in check_queue_health():
            alert["timestamp"] = now
            alert.setdefault("status", "active")
            alerts.append(alert)
    except Exception:
        pass
    return alerts


def load_alert_store():
    """Load persistent alert store."""
    if ALERTS_FILE.exists():
        try:
            return json.loads(ALERTS_FILE.read_text())
        except Exception:
            pass
    return {"alerts": [], "history": []}


def save_alert_store(store):
    """Save persistent alert store."""
    ALERTS_FILE.write_text(json.dumps(store, indent=2))


def merge_alerts(store, new_alerts):
    """Merge new alerts with persistent store. Resolve cleared alerts."""
    now = datetime.now(timezone.utc).isoformat()
    active_ids = {a["id"] for a in new_alerts}
    # Move resolved alerts to history
    for existing in store["alerts"]:
        if existing["id"] not in active_ids and existing.get("status") == "active":
            existing["status"] = "resolved"
            existing["resolved_at"] = now
            store["history"].append(existing)
    # Add/update active alerts
    existing_ids = {a["id"] for a in store["alerts"]}
    updated = [a for a in store["alerts"] if a["id"] in active_ids]
    for new_a in new_alerts:
        if new_a["id"] not in existing_ids:
            updated.append(new_a)
    store["alerts"] = updated
    # Trim history to last 100
    store["history"] = store["history"][-100:]
    return store


class HubHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(STATIC_DIR), **kwargs)

    def do_GET(self):
        if self.path == '/api/events':
            self.proxy_sse()
        elif self.path == '/api/alerts':
            self.handle_alerts()
        elif self.path == '/api/moltbook':
            self.handle_moltbook()
        elif self.path == '/api/seasons':
            self.handle_seasons()
        elif self.path == '/api/report':
            self.handle_report()
        elif self.path == '/api/strategy':
            self.handle_strategy()
        elif self.path == '/api/engage-intel':
            self.handle_engage_intel()
        elif self.path == '/api/briefings' or self.path.startswith('/api/briefings/'):
            self.handle_briefings()
        elif self.path.startswith('/api/'):
            bridge_path = self.path[4:]  # strip /api
            self.proxy_bridge(bridge_path)
        elif self.path == '/' or self.path == '/index.html':
            super().do_GET()
        else:
            super().do_GET()

    def do_POST(self):
        if self.path == '/api/alerts/acknowledge':
            self.handle_alert_action("acknowledged")
        elif self.path == '/api/alerts/resolve':
            self.handle_alert_action("resolved")
        elif self.path.startswith('/api/'):
            bridge_path = self.path[4:]
            self.proxy_bridge_post(bridge_path)
        else:
            self.send_response(404)
            self.end_headers()

    def handle_alerts(self):
        """Run checks, merge with store, return full alert state."""
        try:
            new_alerts = run_all_checks()
            store = load_alert_store()
            store = merge_alerts(store, new_alerts)
            save_alert_store(store)
            # Build response
            active = [a for a in store["alerts"] if a.get("status") == "active"]
            acked = [a for a in store["alerts"] if a.get("status") == "acknowledged"]
            by_severity = {"critical": [], "warning": [], "info": []}
            for a in active:
                by_severity.get(a.get("severity", "info"), by_severity["info"]).append(a)
            response = {
                "active": active,
                "acknowledged": acked,
                "history": store["history"][-20:],
                "panels": by_severity,
                "stats": {
                    "total": len(active) + len(acked),
                    "active": len(active),
                    "acknowledged": len(acked),
                    "critical": len(by_severity["critical"]),
                    "warning": len(by_severity["warning"]),
                    "resolved_today": sum(1 for h in store["history"]
                                         if h.get("resolved_at", "").startswith(
                                             datetime.now(timezone.utc).strftime("%Y-%m-%d")))
                },
                "last_check": datetime.now(timezone.utc).isoformat()
            }
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps(response).encode())
        except Exception as e:
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())

    def handle_alert_action(self, new_status):
        """Acknowledge or resolve an alert by ID."""
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length)) if length else {}
            alert_id = body.get("id")
            if not alert_id:
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": "missing id"}).encode())
                return
            store = load_alert_store()
            now = datetime.now(timezone.utc).isoformat()
            found = False
            for a in store["alerts"]:
                if a["id"] == alert_id:
                    a["status"] = new_status
                    if new_status == "resolved":
                        a["resolved_at"] = now
                        store["history"].append(a)
                    found = True
                    break
            if new_status == "resolved":
                store["alerts"] = [a for a in store["alerts"] if a["id"] != alert_id]
            save_alert_store(store)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"ok": found}).encode())
        except Exception as e:
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())

    def proxy_bridge_post(self, path):
        """Proxy POST requests to bridge."""
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length) if length else b""
            url = BRIDGE + path
            req = urllib.request.Request(url, data=body, method="POST")
            req.add_header("x-api-key", BRIDGE_KEY)
            req.add_header("Content-Type", "application/json")
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = resp.read()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(data)
        except urllib.error.HTTPError as e:
            self.send_response(e.code)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())
        except Exception as e:
            self.send_response(502)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())

    def handle_moltbook(self):
        """Serve Moltbook analytics data from local files."""
        try:
            data = {"karma_series": [], "queues": {}, "solver": {}, "engagement": {}}

            # Karma timeseries
            csv_path = Path.home() / ".openclaw/workspace/skills/moltbook/karma-history.csv"
            if csv_path.exists():
                for line in csv_path.read_text().strip().split("\n")[1:]:  # skip header
                    parts = line.split(",")
                    if len(parts) >= 2 and parts[1].strip().isdigit():
                        data["karma_series"].append({
                            "t": parts[0].strip(),
                            "v": int(parts[1].strip())
                        })

            # Queue status
            for name, path in [("posts", Path.home() / ".config/moltbook/pending-thoughts.json"),
                               ("comments", Path.home() / ".config/moltbook/pending-comments.json")]:
                try:
                    if path.exists():
                        data["queues"][name] = len(json.loads(path.read_text()))
                except Exception:
                    data["queues"][name] = 0

            # Solver stats from challenge-failures.log
            fail_log = Path.home() / ".openclaw/workspace/skills/moltbook/challenge-failures.log"
            if fail_log.exists():
                lines = fail_log.read_text().strip().split("\n")
                data["solver"]["total_failures"] = len(lines)
                # Recent failures (last 24h would need timestamps — just use last 20)
                data["solver"]["recent"] = lines[-10:]

            # Engagement journal summary
            journal = Path.home() / ".openclaw/workspace/skills/moltbook/engagement-journal.md"
            if journal.exists():
                content = journal.read_text()
                data["engagement"]["journal_lines"] = len(content.split("\n"))

            # Feedback analysis
            analysis = Path.home() / ".openclaw/workspace/skills/moltbook/feedback-analysis.md"
            if analysis.exists():
                data["engagement"]["analysis"] = analysis.read_text()[:2000]

            # Engagement config (peak hours etc)
            config_path = Path.home() / ".openclaw/workspace/skills/moltbook/engagement-config.json"
            if config_path.exists():
                try:
                    data["engagement"]["config"] = json.loads(config_path.read_text())
                except Exception:
                    pass

            # Computed metrics
            if len(data["karma_series"]) >= 2:
                current = data["karma_series"][-1]["v"]
                first = data["karma_series"][0]["v"]
                data["summary"] = {
                    "current_karma": current,
                    "total_growth": current - first,
                    "data_points": len(data["karma_series"]),
                    "first_ts": data["karma_series"][0]["t"],
                    "latest_ts": data["karma_series"][-1]["t"],
                }
                # Hourly rate from last 6 entries
                if len(data["karma_series"]) >= 6:
                    recent6 = data["karma_series"][-6:]
                    delta = recent6[-1]["v"] - recent6[0]["v"]
                    data["summary"]["recent_rate"] = round(delta / 5, 1)  # per interval

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps(data).encode())
        except Exception as e:
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())

    def handle_seasons(self):
        """Serve Arena season data from arena-seasons project."""
        try:
            seasons_dir = Path.home() / ".openclaw/workspace/projects/arena-seasons"
            current_path = seasons_dir / "current-season.json"
            history_path = seasons_dir / "seasons.json"

            result = {
                "current_season": None,
                "past_seasons": [],
                "generated_at": datetime.now(timezone.utc).isoformat(),
            }

            # Tier lookup
            tiers = [("Bronze", 0), ("Silver", 200), ("Gold", 500),
                     ("Platinum", 1000), ("Diamond", 2000), ("Champion", 5000)]
            tier_emoji = {"Bronze": "🥉", "Silver": "🥈", "Gold": "🥇",
                          "Platinum": "💎", "Diamond": "💠", "Champion": "👑"}

            def get_tier(pts):
                name = "Bronze"
                for t, thresh in tiers:
                    if pts >= thresh:
                        name = t
                return name

            if current_path.exists():
                current = json.loads(current_path.read_text())
                if current.get("status") == "active":
                    standings = current.get("standings", {})
                    ranked = sorted(standings.items(), key=lambda x: x[1]["points"], reverse=True)
                    result["current_season"] = {
                        "name": current["name"],
                        "id": current["id"],
                        "rounds_completed": current["rounds_completed"],
                        "total_rounds": current["total_rounds_planned"],
                        "ends_at": current.get("ends_at"),
                        "leaderboard": [
                            {
                                "rank": i + 1,
                                "agent": agent,
                                "points": s["points"],
                                "tier": get_tier(s["points"]),
                                "tier_emoji": tier_emoji.get(get_tier(s["points"]), ""),
                                "rounds_played": s["rounds_played"],
                                "rounds_won": s["rounds_won"],
                                "solve_rate": round((s["total_tests_passed"] / s["total_tests"] * 100), 1)
                                    if s["total_tests"] > 0 else 0,
                                "streak": s["streak"],
                                "best_streak": s["best_streak"],
                                "round_scores": s.get("round_scores", []),
                            }
                            for i, (agent, s) in enumerate(ranked)
                        ],
                    }

            if history_path.exists():
                seasons = json.loads(history_path.read_text())
                for s in seasons:
                    result["past_seasons"].append({
                        "name": s["name"],
                        "id": s["id"],
                        "champion": s.get("champion"),
                        "champion_points": s.get("champion_points", 0),
                        "champion_tier": s.get("champion_tier", "Bronze"),
                        "rounds_completed": s["rounds_completed"],
                        "participants": len(s.get("standings", {})),
                        "ended_at": s.get("ended_at"),
                    })

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps(result).encode())
        except Exception as e:
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())

    def handle_report(self):
        """Serve interop report markdown content."""
        try:
            report_path = Path.home() / ".openclaw/workspace/projects/interop-report/combined-report.md"
            if not report_path.exists():
                self.send_response(404)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": "Report not found"}).encode())
                return
            content = report_path.read_text()
            # Extract metadata
            lines = content.split("\n")
            title = "Interop Report"
            for line in lines[:5]:
                if line.startswith("# "):
                    title = line[2:].strip()
                    break
            word_count = len(content.split())
            sections = [line.strip("# ").strip() for line in lines if line.startswith("## ")]
            result = {
                "title": title,
                "content": content,
                "word_count": word_count,
                "line_count": len(lines),
                "sections": sections,
                "last_modified": datetime.fromtimestamp(
                    report_path.stat().st_mtime, tz=timezone.utc
                ).isoformat(),
            }
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps(result).encode())
        except Exception as e:
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())

    def handle_briefings(self):
        """Serve daily briefing archives — list or single."""
        try:
            briefings_dir = Path.home() / ".openclaw/workspace/projects/daily-briefing/briefings"
            if not briefings_dir.exists():
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({"briefings": []}).encode())
                return

            # Single briefing: /api/briefings/2026-03-09
            if self.path.startswith('/api/briefings/'):
                date_str = self.path.split('/')[-1]
                fp = briefings_dir / f"briefing-{date_str}.md"
                if not fp.exists():
                    self.send_response(404)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(json.dumps({"error": "Briefing not found"}).encode())
                    return
                content = fp.read_text()
                stat = fp.stat()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({
                    "date": date_str,
                    "content": content,
                    "size": stat.st_size,
                    "generated": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat()
                }).encode())
                return

            # List all briefings
            files = sorted(briefings_dir.glob("briefing-*.md"), reverse=True)
            briefings = []
            for f in files:
                date = f.stem.replace("briefing-", "")
                lines = f.read_text().split("\n")
                # Extract first non-empty content line as preview
                preview = ""
                for line in lines:
                    stripped = line.strip()
                    if stripped and not stripped.startswith("#") and not stripped.startswith("_") and not stripped.startswith("---"):
                        preview = stripped[:120]
                        break
                briefings.append({
                    "date": date,
                    "preview": preview,
                    "size": f.stat().st_size,
                    "generated": datetime.fromtimestamp(f.stat().st_mtime, tz=timezone.utc).isoformat()
                })
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"briefings": briefings}).encode())
        except Exception as e:
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())

    def handle_strategy(self):
        """Run strategy dashboard and return JSON."""
        try:
            import subprocess
            dashboard_py = Path.home() / ".openclaw/workspace/projects/strategy-dashboard/dashboard.py"
            if not dashboard_py.exists():
                self.send_response(404)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": "Dashboard not found"}).encode())
                return
            result = subprocess.run(
                ["python3", str(dashboard_py), "--json"],
                capture_output=True, text=True, timeout=15
            )
            if result.returncode != 0:
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": result.stderr[:500]}).encode())
                return
            # Validate it's JSON
            data = json.loads(result.stdout)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps(data).encode())
        except json.JSONDecodeError as e:
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": f"Invalid JSON from dashboard: {e}"}).encode())
        except subprocess.TimeoutExpired:
            self.send_response(504)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Dashboard timed out"}).encode())
        except Exception as e:
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())

    def handle_engage_intel(self):
        """Aggregate notification-intel + reciprocal-tracker data for engagement heatmap."""
        try:
            import subprocess as sp
            data = {"posts": [], "authors": {}, "reciprocal": {}, "karma": 0, "generated": None}

            # 1. Notification intel JSON
            intel_py = Path.home() / ".openclaw/workspace/projects/notification-intel/intel.py"
            if intel_py.exists():
                r = sp.run(["python3", str(intel_py), "json"], capture_output=True, text=True, timeout=15)
                if r.returncode == 0:
                    intel = json.loads(r.stdout)
                    data["posts"] = intel.get("posts", [])
                    data["karma"] = intel.get("karma", 0)
                    data["total_notifications"] = intel.get("total_notifications", 0)
                    data["active_posts"] = intel.get("active_posts", 0)
                    data["unique_commenters"] = intel.get("unique_commenters", 0)
                    data["top_commenters"] = intel.get("top_commenters", [])
                    data["breakout_posts"] = intel.get("breakout_posts", [])

            # 2. Reciprocal tracker JSON
            recip_py = Path.home() / ".openclaw/workspace/projects/reciprocal-tracker/reciprocal.py"
            if recip_py.exists():
                r = sp.run(["python3", str(recip_py), "json"], capture_output=True, text=True, timeout=15)
                if r.returncode == 0:
                    recip = json.loads(r.stdout)
                    data["reciprocal"] = recip

            # 3. Engagement timeseries (if exists)
            ts_file = Path.home() / ".config/moltbook/notification-intel/engagement-timeseries.csv"
            if ts_file.exists():
                lines = ts_file.read_text().strip().split("\n")
                ts_data = []
                for line in lines[1:]:  # skip header
                    parts = line.split(",")
                    if len(parts) >= 3:
                        ts_data.append({"ts": parts[0], "karma": int(parts[1]) if parts[1].isdigit() else 0, "notifs": int(parts[2]) if parts[2].isdigit() else 0})
                data["timeseries"] = ts_data[-100:]  # last 100 entries

            # 4. Author engagement history
            author_file = Path.home() / ".config/moltbook/notification-intel/author-engagement.json"
            if author_file.exists():
                data["author_history"] = json.loads(author_file.read_text())

            from datetime import datetime, timezone
            data["generated"] = datetime.now(timezone.utc).isoformat()

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps(data).encode())
        except Exception as e:
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())

    def proxy_bridge(self, path):
        try:
            url = BRIDGE + path
            req = urllib.request.Request(url)
            req.add_header("x-api-key", BRIDGE_KEY)
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = resp.read()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(data)
        except urllib.error.HTTPError as e:
            self.send_response(e.code)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())
        except Exception as e:
            self.send_response(502)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())

    def proxy_sse(self):
        """Stream SSE events from the bridge to the client, line by line."""
        try:
            url = BRIDGE + "/events"
            req = urllib.request.Request(url)
            req.add_header("x-api-key", BRIDGE_KEY)
            # Use raw socket-level reading to avoid buffering
            resp = urllib.request.urlopen(req, timeout=300)

            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.send_header("X-Accel-Buffering", "no")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()

            # Read line by line (SSE is newline-delimited) and flush immediately
            while True:
                line = resp.readline()
                if not line:
                    break
                self.wfile.write(line)
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass  # Client disconnected
        except Exception:
            pass  # Upstream error — client will auto-reconnect

    def log_message(self, format, *args):
        pass  # Quiet logs


class ThreadedHTTPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    with ThreadedHTTPServer(("0.0.0.0", PORT), HubHandler) as httpd:
        print(f"Agent Hub serving on port {PORT}")
        httpd.serve_forever()
