#!/usr/bin/env python3
"""Moltbook Activity Scraper

Periodic scraper that pulls top posts, karma changes, new users, trending submolts.
Stores in SQLite with timestamps for trend analysis.

Task: Moltbook activity scraper (assigned to Claudius)
"""

import sqlite3
import json
import time
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests

# Config
PROXY_BASE = "https://moltbook-proxy.dylanneve1.workers.dev/proxy"
PROXY_SECRET = "moltproxy-claudius-2026"
CREDS_PATH = os.path.expanduser("~/.config/moltbook/credentials.json")
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "moltbook_activity.db")

def load_api_key():
    with open(CREDS_PATH) as f:
        return json.load(f)["api_key"]

API_KEY = load_api_key()

HEADERS = {
    "Authorization": f"Bearer {API_KEY}",
    "X-Proxy-Secret": PROXY_SECRET,
}


def api_get(endpoint):
    """GET request to Moltbook API via proxy."""
    resp = requests.get(f"{PROXY_BASE}/{endpoint}", headers=HEADERS, timeout=15)
    resp.raise_for_status()
    return resp.json()


def init_db(conn):
    """Create tables if they don't exist."""
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS scrape_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            posts_scraped INTEGER DEFAULT 0,
            users_scraped INTEGER DEFAULT 0,
            submolts_scraped INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS posts (
            id TEXT NOT NULL,
            scraped_at TEXT NOT NULL,
            title TEXT,
            author TEXT,
            submolt TEXT,
            upvote_count INTEGER DEFAULT 0,
            comment_count INTEGER DEFAULT 0,
            created_at TEXT,
            content_preview TEXT,
            PRIMARY KEY (id, scraped_at)
        );

        CREATE TABLE IF NOT EXISTS user_karma (
            username TEXT NOT NULL,
            scraped_at TEXT NOT NULL,
            karma INTEGER DEFAULT 0,
            follower_count INTEGER,
            post_count INTEGER,
            PRIMARY KEY (username, scraped_at)
        );

        CREATE TABLE IF NOT EXISTS submolt_activity (
            submolt TEXT NOT NULL,
            scraped_at TEXT NOT NULL,
            post_count INTEGER DEFAULT 0,
            total_upvotes INTEGER DEFAULT 0,
            total_comments INTEGER DEFAULT 0,
            PRIMARY KEY (submolt, scraped_at)
        );

        CREATE TABLE IF NOT EXISTS trending_posts (
            id TEXT NOT NULL,
            scraped_at TEXT NOT NULL,
            title TEXT,
            author TEXT,
            submolt TEXT,
            upvote_count INTEGER DEFAULT 0,
            comment_count INTEGER DEFAULT 0,
            score REAL DEFAULT 0,
            PRIMARY KEY (id, scraped_at)
        );

        CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author);
        CREATE INDEX IF NOT EXISTS idx_posts_submolt ON posts(submolt);
        CREATE INDEX IF NOT EXISTS idx_posts_scraped ON posts(scraped_at);
        CREATE INDEX IF NOT EXISTS idx_karma_user ON user_karma(username);
        CREATE INDEX IF NOT EXISTS idx_trending_scraped ON trending_posts(scraped_at);
    """)


def scrape_hot_feed(conn, now_str):
    """Scrape the hot feed for top posts."""
    try:
        data = api_get("posts")
        posts = data.get("posts", [])
    except Exception as e:
        print(f"  [!] Failed to fetch feed: {e}")
        return 0

    count = 0
    submolt_stats = {}
    authors_seen = set()

    for post in posts:
        post_id = post.get("id", "")
        title = post.get("title", "")
        author = post.get("author", {}).get("username", "") if isinstance(post.get("author"), dict) else str(post.get("author", ""))
        submolt = post.get("submolt", {}).get("name", "") if isinstance(post.get("submolt"), dict) else str(post.get("submolt", ""))
        upvotes = post.get("upvote_count", 0) or 0
        comments = post.get("comment_count", 0) or 0
        created = post.get("created_at", "")
        content = (post.get("content", "") or "")[:200]

        if not post_id:
            continue

        conn.execute("""
            INSERT OR REPLACE INTO posts (id, scraped_at, title, author, submolt, upvote_count, comment_count, created_at, content_preview)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (post_id, now_str, title, author, submolt, upvotes, comments, created, content))

        # Track trending (top by engagement)
        score = upvotes + (comments * 2)
        conn.execute("""
            INSERT OR REPLACE INTO trending_posts (id, scraped_at, title, author, submolt, upvote_count, comment_count, score)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (post_id, now_str, title, author, submolt, upvotes, comments, score))

        # Aggregate submolt stats
        if submolt:
            if submolt not in submolt_stats:
                submolt_stats[submolt] = {"posts": 0, "upvotes": 0, "comments": 0}
            submolt_stats[submolt]["posts"] += 1
            submolt_stats[submolt]["upvotes"] += upvotes
            submolt_stats[submolt]["comments"] += comments

        if author:
            authors_seen.add(author)

        count += 1

    # Store submolt activity
    for submolt, stats in submolt_stats.items():
        conn.execute("""
            INSERT OR REPLACE INTO submolt_activity (submolt, scraped_at, post_count, total_upvotes, total_comments)
            VALUES (?, ?, ?, ?, ?)
        """, (submolt, now_str, stats["posts"], stats["upvotes"], stats["comments"]))

    return count


def scrape_own_profile(conn, now_str):
    """Scrape own profile for karma tracking."""
    try:
        data = api_get("home")
        account = data.get("your_account", data.get("profile", {}))
        karma = account.get("karma", 0)
        followers = account.get("followerCount", account.get("follower_count"))
        username = account.get("username", "Claudius_AI")

        conn.execute("""
            INSERT OR REPLACE INTO user_karma (username, scraped_at, karma, follower_count)
            VALUES (?, ?, ?, ?)
        """, (username, now_str, karma, followers))

        return 1
    except Exception as e:
        print(f"  [!] Failed to fetch profile: {e}")
        return 0


def scrape_new_feed(conn, now_str):
    """Scrape the new feed for recent posts/users."""
    try:
        data = api_get("posts?sort=new")
        posts = data.get("posts", [])
    except Exception as e:
        print(f"  [!] Failed to fetch new feed: {e}")
        return 0

    count = 0
    for post in posts:
        post_id = post.get("id", "")
        if not post_id:
            continue

        title = post.get("title", "")
        author = post.get("author", {}).get("username", "") if isinstance(post.get("author"), dict) else str(post.get("author", ""))
        submolt = post.get("submolt", {}).get("name", "") if isinstance(post.get("submolt"), dict) else str(post.get("submolt", ""))
        upvotes = post.get("upvote_count", 0) or 0
        comments = post.get("comment_count", 0) or 0
        created = post.get("created_at", "")
        content = (post.get("content", "") or "")[:200]

        conn.execute("""
            INSERT OR IGNORE INTO posts (id, scraped_at, title, author, submolt, upvote_count, comment_count, created_at, content_preview)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (post_id, now_str, title, author, submolt, upvotes, comments, created, content))
        count += 1

    return count


def generate_report(conn, now_str):
    """Generate a quick text report of the current scrape."""
    lines = [f"📊 Moltbook Activity Report — {now_str}", ""]

    # Top posts by engagement
    rows = conn.execute("""
        SELECT title, author, submolt, upvote_count, comment_count, score
        FROM trending_posts
        WHERE scraped_at = ?
        ORDER BY score DESC
        LIMIT 5
    """, (now_str,)).fetchall()

    if rows:
        lines.append("🔥 Top Posts (by engagement):")
        for title, author, submolt, ups, comms, score in rows:
            lines.append(f"  [{score:.0f}] {title[:50]}... by {author} in {submolt} (↑{ups} 💬{comms})")
        lines.append("")

    # Submolt activity
    rows = conn.execute("""
        SELECT submolt, post_count, total_upvotes, total_comments
        FROM submolt_activity
        WHERE scraped_at = ?
        ORDER BY total_upvotes DESC
        LIMIT 8
    """, (now_str,)).fetchall()

    if rows:
        lines.append("📁 Submolt Activity:")
        for submolt, posts, ups, comms in rows:
            lines.append(f"  {submolt}: {posts} posts, ↑{ups}, 💬{comms}")
        lines.append("")

    # Own karma
    row = conn.execute("""
        SELECT karma, follower_count FROM user_karma
        WHERE username = 'Claudius_AI' AND scraped_at = ?
    """, (now_str,)).fetchone()

    if row:
        lines.append(f"👤 Claudius_AI: karma={row[0]}, followers={row[1]}")

    return "\n".join(lines)


def run_scrape():
    """Run a full scrape cycle."""
    now = datetime.now(timezone.utc)
    now_str = now.strftime("%Y-%m-%dT%H:%M:%SZ")

    print(f"[{now_str}] Starting Moltbook activity scrape...")

    conn = sqlite3.connect(DB_PATH)
    init_db(conn)

    # Scrape
    hot_count = scrape_hot_feed(conn, now_str)
    print(f"  Hot feed: {hot_count} posts")

    new_count = scrape_new_feed(conn, now_str)
    print(f"  New feed: {new_count} posts")

    user_count = scrape_own_profile(conn, now_str)
    print(f"  Profile: {'ok' if user_count else 'failed'}")

    # Log the run
    conn.execute("""
        INSERT INTO scrape_runs (timestamp, posts_scraped, users_scraped, submolts_scraped)
        VALUES (?, ?, ?, ?)
    """, (now_str, hot_count + new_count, user_count,
          conn.execute("SELECT COUNT(DISTINCT submolt) FROM submolt_activity WHERE scraped_at = ?", (now_str,)).fetchone()[0]))

    conn.commit()

    # Report
    report = generate_report(conn, now_str)
    print(report)

    conn.close()
    print(f"[{now_str}] Scrape complete. DB: {DB_PATH}")


def show_trends():
    """Show karma trends over time."""
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute("""
        SELECT scraped_at, karma FROM user_karma
        WHERE username = 'Claudius_AI'
        ORDER BY scraped_at DESC LIMIT 20
    """).fetchall()
    conn.close()

    if not rows:
        print("No karma data yet.")
        return

    print("📈 Karma Trend (Claudius_AI):")
    for ts, karma in reversed(rows):
        print(f"  {ts}: {karma}")


def show_top_submolts():
    """Show most active submolts from latest scrape."""
    conn = sqlite3.connect(DB_PATH)
    latest = conn.execute("SELECT MAX(scraped_at) FROM submolt_activity").fetchone()[0]
    if not latest:
        print("No submolt data yet.")
        conn.close()
        return

    rows = conn.execute("""
        SELECT submolt, post_count, total_upvotes, total_comments
        FROM submolt_activity WHERE scraped_at = ?
        ORDER BY total_upvotes DESC
    """, (latest,)).fetchall()
    conn.close()

    print(f"📁 Submolt Activity ({latest}):")
    for submolt, posts, ups, comms in rows:
        print(f"  {submolt}: {posts} posts, ↑{ups}, 💬{comms}")


if __name__ == "__main__":
    if len(sys.argv) > 1:
        cmd = sys.argv[1]
        if cmd == "trends":
            show_trends()
        elif cmd == "submolts":
            show_top_submolts()
        elif cmd == "scrape":
            run_scrape()
        else:
            print(f"Usage: {sys.argv[0]} [scrape|trends|submolts]")
    else:
        run_scrape()
