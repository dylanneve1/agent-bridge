#!/usr/bin/env python3
"""Bridge Activity Aggregator

Collects message volumes, task completion rates, git commit frequency,
file sharing stats from the bridge. Per-agent activity scores.

Task: Bridge activity aggregator (assigned to Claudius)
"""

import sqlite3
import json
import os
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path
from collections import defaultdict

# Paths
BRIDGE_DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "messages.db")
ACTIVITY_DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bridge_activity.db")
REPOS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "repos")


def init_db(conn):
    """Create activity tables."""
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS activity_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            period TEXT NOT NULL,  -- 'hourly', 'daily', 'weekly'
            agent TEXT NOT NULL,
            messages_sent INTEGER DEFAULT 0,
            messages_received INTEGER DEFAULT 0,
            tasks_completed INTEGER DEFAULT 0,
            tasks_claimed INTEGER DEFAULT 0,
            files_shared INTEGER DEFAULT 0,
            git_commits INTEGER DEFAULT 0,
            activity_score REAL DEFAULT 0,
            UNIQUE(timestamp, period, agent)
        );

        CREATE TABLE IF NOT EXISTS bridge_stats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            total_messages INTEGER DEFAULT 0,
            total_conversations INTEGER DEFAULT 0,
            total_agents INTEGER DEFAULT 0,
            active_agents_24h INTEGER DEFAULT 0,
            avg_messages_per_agent REAL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS agent_profiles (
            agent TEXT PRIMARY KEY,
            first_seen TEXT,
            last_active TEXT,
            total_messages INTEGER DEFAULT 0,
            total_tasks_done INTEGER DEFAULT 0,
            lifetime_score REAL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_activity_agent ON activity_snapshots(agent);
        CREATE INDEX IF NOT EXISTS idx_activity_ts ON activity_snapshots(timestamp);
        CREATE INDEX IF NOT EXISTS idx_activity_period ON activity_snapshots(period);
    """)


def get_message_stats(bridge_conn, since_hours=24):
    """Get message counts per agent from the bridge messages DB."""
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=since_hours)).timestamp()

    stats = defaultdict(lambda: {"sent": 0, "received": 0})

    try:
        # Messages table structure varies — try common schemas
        rows = bridge_conn.execute("""
            SELECT from_agent, to_agent, timestamp FROM messages
            WHERE timestamp > ?
        """, (cutoff,)).fetchall()

        for sender, recipient, ts in rows:
            if sender:
                stats[sender]["sent"] += 1
            if recipient:
                stats[recipient]["received"] += 1
    except sqlite3.OperationalError:
        # Try alternative schema
        try:
            rows = bridge_conn.execute("""
                SELECT "from", "to", created_at FROM messages
                WHERE created_at > ?
            """, (cutoff,)).fetchall()

            for sender, recipient, ts in rows:
                if sender:
                    stats[sender]["sent"] += 1
                if recipient:
                    stats[recipient]["received"] += 1
        except sqlite3.OperationalError as e:
            print(f"  [!] Could not read messages: {e}")
            # Try to discover schema
            try:
                cols = bridge_conn.execute("PRAGMA table_info(messages)").fetchall()
                print(f"  [i] Messages table columns: {[c[1] for c in cols]}")
            except:
                pass

    return dict(stats)


def get_conversation_stats(bridge_conn):
    """Get overall conversation statistics."""
    stats = {
        "total_messages": 0,
        "total_conversations": 0,
        "total_agents": 0,
    }

    try:
        row = bridge_conn.execute("SELECT COUNT(*) FROM messages").fetchone()
        stats["total_messages"] = row[0] if row else 0
    except:
        pass

    try:
        row = bridge_conn.execute("SELECT COUNT(*) FROM conversations").fetchone()
        stats["total_conversations"] = row[0] if row else 0
    except:
        pass

    try:
        row = bridge_conn.execute("SELECT COUNT(*) FROM agents").fetchone()
        stats["total_agents"] = row[0] if row else 0
    except:
        pass

    return stats


def get_task_stats_from_api():
    """Get task completion stats from the task board API."""
    import requests
    stats = defaultdict(lambda: {"completed": 0, "claimed": 0})

    try:
        resp = requests.get("http://localhost:8765/tasks", timeout=5)
        data = resp.json()
        tasks = data.get("tasks", data if isinstance(data, list) else [])

        for task in tasks:
            agent = task.get("claimed_by") or task.get("assigned_to")
            if not agent:
                continue
            if task.get("status") == "done":
                stats[agent]["completed"] += 1
            elif task.get("status") in ("claimed", "in_progress"):
                stats[agent]["claimed"] += 1
    except Exception as e:
        print(f"  [!] Could not fetch tasks: {e}")

    return dict(stats)


def calculate_activity_score(messages_sent, messages_received, tasks_completed, tasks_claimed, files_shared, git_commits):
    """Calculate a weighted activity score for an agent."""
    return (
        messages_sent * 1.0 +
        messages_received * 0.5 +
        tasks_completed * 10.0 +
        tasks_claimed * 3.0 +
        files_shared * 2.0 +
        git_commits * 5.0
    )


def run_aggregation(period="hourly"):
    """Run a full activity aggregation cycle."""
    now = datetime.now(timezone.utc)
    now_str = now.strftime("%Y-%m-%dT%H:%M:%SZ")

    hours = {"hourly": 1, "daily": 24, "weekly": 168}.get(period, 24)

    print(f"[{now_str}] Running {period} bridge activity aggregation...")

    # Connect to DBs
    activity_conn = sqlite3.connect(ACTIVITY_DB)
    init_db(activity_conn)

    # Get message stats from bridge
    if os.path.exists(BRIDGE_DB):
        bridge_conn = sqlite3.connect(BRIDGE_DB)
        msg_stats = get_message_stats(bridge_conn, since_hours=hours)
        conv_stats = get_conversation_stats(bridge_conn)
        bridge_conn.close()
    else:
        print(f"  [!] Bridge DB not found: {BRIDGE_DB}")
        msg_stats = {}
        conv_stats = {}

    # Get task stats
    task_stats = get_task_stats_from_api()

    # Combine all agents
    all_agents = set(list(msg_stats.keys()) + list(task_stats.keys()))

    for agent in all_agents:
        msgs = msg_stats.get(agent, {"sent": 0, "received": 0})
        tasks = task_stats.get(agent, {"completed": 0, "claimed": 0})

        score = calculate_activity_score(
            msgs["sent"], msgs["received"],
            tasks["completed"], tasks["claimed"],
            0, 0  # files/git TBD
        )

        activity_conn.execute("""
            INSERT OR REPLACE INTO activity_snapshots
            (timestamp, period, agent, messages_sent, messages_received,
             tasks_completed, tasks_claimed, files_shared, git_commits, activity_score)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (now_str, period, agent, msgs["sent"], msgs["received"],
              tasks["completed"], tasks["claimed"], 0, 0, score))

        # Update agent profile
        activity_conn.execute("""
            INSERT INTO agent_profiles (agent, first_seen, last_active, total_messages, total_tasks_done, lifetime_score)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(agent) DO UPDATE SET
                last_active = ?,
                total_messages = total_messages + ?,
                total_tasks_done = ?,
                lifetime_score = lifetime_score + ?
        """, (agent, now_str, now_str, msgs["sent"], tasks["completed"], score,
              now_str, msgs["sent"], tasks["completed"], score))

    # Store bridge-wide stats
    active_24h = len([a for a in all_agents if msg_stats.get(a, {}).get("sent", 0) > 0])
    avg_msgs = conv_stats.get("total_messages", 0) / max(len(all_agents), 1)

    activity_conn.execute("""
        INSERT INTO bridge_stats (timestamp, total_messages, total_conversations, total_agents, active_agents_24h, avg_messages_per_agent)
        VALUES (?, ?, ?, ?, ?, ?)
    """, (now_str, conv_stats.get("total_messages", 0), conv_stats.get("total_conversations", 0),
          conv_stats.get("total_agents", 0), active_24h, avg_msgs))

    activity_conn.commit()
    activity_conn.close()

    # Report
    print(f"\n📊 Bridge Activity Report ({period}) — {now_str}")
    print(f"   Agents active: {len(all_agents)}")
    for agent in sorted(all_agents):
        msgs = msg_stats.get(agent, {"sent": 0, "received": 0})
        tasks = task_stats.get(agent, {"completed": 0, "claimed": 0})
        score = calculate_activity_score(msgs["sent"], msgs["received"], tasks["completed"], tasks["claimed"], 0, 0)
        print(f"   {agent}: msgs={msgs['sent']}/{msgs['received']} tasks_done={tasks['completed']} claimed={tasks['claimed']} score={score:.0f}")

    print(f"\n   Bridge totals: {conv_stats.get('total_messages', '?')} messages, {conv_stats.get('total_conversations', '?')} conversations")


def show_leaderboard():
    """Show agent activity leaderboard."""
    conn = sqlite3.connect(ACTIVITY_DB)
    try:
        rows = conn.execute("""
            SELECT agent, total_messages, total_tasks_done, lifetime_score, last_active
            FROM agent_profiles
            ORDER BY lifetime_score DESC
        """).fetchall()
    except:
        print("No activity data yet. Run aggregation first.")
        conn.close()
        return

    conn.close()

    print("🏆 Agent Activity Leaderboard:")
    for i, (agent, msgs, tasks, score, last_active) in enumerate(rows, 1):
        print(f"  #{i} {agent}: score={score:.0f} msgs={msgs} tasks_done={tasks} last={last_active[:10]}")


if __name__ == "__main__":
    if len(sys.argv) > 1:
        cmd = sys.argv[1]
        if cmd == "hourly":
            run_aggregation("hourly")
        elif cmd == "daily":
            run_aggregation("daily")
        elif cmd == "weekly":
            run_aggregation("weekly")
        elif cmd == "leaderboard":
            show_leaderboard()
        else:
            print(f"Usage: {sys.argv[0]} [hourly|daily|weekly|leaderboard]")
    else:
        run_aggregation("daily")
