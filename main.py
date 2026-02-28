"""Agent Bridge v4 — Multi-agent conversation broker with file sharing + task board"""
from fastapi import FastAPI, HTTPException, Header, Depends, Request, Response, UploadFile, File, Form, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
import sqlite3, os, secrets, time, uuid, json, hashlib, mimetypes, shutil

# ── Rate limiting note ────────────────────────────────────────────────────────
# TODO: Add rate limiting middleware if abuse becomes an issue.
# Recommended: slowapi (wraps limits library) — 60 req/min per API key.
# Example: @limiter.limit("60/minute") on each route, keyed by x-api-key header.
# For uploads specifically: 10/min to prevent disk exhaustion attacks.
# ──────────────────────────────────────────────────────────────────────────────

app = FastAPI(title="Agent Bridge v4")

SERVER_START_TIME = time.time()
VERSION = "4.0.0"

DB_PATH = os.path.join(os.path.dirname(__file__), "messages.db")
FILES_DIR = os.path.join(os.path.dirname(__file__), "files")
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB
os.makedirs(FILES_DIR, exist_ok=True)
SECRET_FILE = os.path.join(os.path.dirname(__file__), "admin_secret.txt")
ADMIN_SECRET = os.environ.get("BRIDGE_ADMIN_SECRET", "")
if not ADMIN_SECRET and os.path.exists(SECRET_FILE):
    try:
        ADMIN_SECRET = open(SECRET_FILE).read().strip()
    except OSError as e:
        print(f"[agent-bridge] WARNING: Could not read admin_secret.txt: {e}")

# No file type restrictions — agents can share anything up to MAX_FILE_SIZE

# ── Database ─────────────────────────────────────────

def get_db():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    conn.execute("""CREATE TABLE IF NOT EXISTS api_keys (
        key TEXT PRIMARY KEY, agent_id TEXT NOT NULL, created_at REAL NOT NULL
    )""")
    conn.execute("""CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'group',
        created_by TEXT, created_at REAL NOT NULL
    )""")
    conn.execute("""CREATE TABLE IF NOT EXISTS conversation_members (
        conversation_id TEXT NOT NULL, agent_id TEXT NOT NULL, joined_at REAL NOT NULL,
        PRIMARY KEY (conversation_id, agent_id)
    )""")
    conn.execute("""CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY, filename TEXT NOT NULL, original_name TEXT NOT NULL,
        mime_type TEXT, size INTEGER NOT NULL, sha256 TEXT,
        uploaded_by TEXT NOT NULL, uploaded_at REAL NOT NULL,
        conversation_id TEXT, message_id TEXT,
        description TEXT
    )""")
    # Task board tables
    conn.execute("""CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT DEFAULT '',
        status TEXT DEFAULT 'open', priority TEXT DEFAULT 'normal',
        created_by TEXT NOT NULL, assigned_to TEXT, claimed_by TEXT,
        tags TEXT DEFAULT '[]', created_at REAL NOT NULL, updated_at REAL NOT NULL,
        completed_at REAL, due_by REAL, parent_id TEXT,
        FOREIGN KEY (parent_id) REFERENCES tasks(id)
    )""")
    conn.execute("""CREATE TABLE IF NOT EXISTS task_comments (
        id TEXT PRIMARY KEY, task_id TEXT NOT NULL, agent_name TEXT NOT NULL,
        content TEXT NOT NULL, created_at REAL NOT NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(id)
    )""")
    conn.execute("""CREATE TABLE IF NOT EXISTS task_history (
        id TEXT PRIMARY KEY, task_id TEXT NOT NULL, agent_name TEXT NOT NULL,
        action TEXT NOT NULL, details TEXT DEFAULT '', created_at REAL NOT NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(id)
    )""")
    tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
    if "messages" not in tables:
        conn.execute("""CREATE TABLE messages (
            id TEXT PRIMARY KEY, conversation_id TEXT, from_agent TEXT NOT NULL,
            to_agent TEXT, content TEXT NOT NULL, timestamp REAL NOT NULL, read INTEGER DEFAULT 0
        )""")
    else:
        cols = [r[1] for r in conn.execute("PRAGMA table_info(messages)").fetchall()]
        if "conversation_id" not in cols:
            conn.execute("ALTER TABLE messages ADD COLUMN conversation_id TEXT")
    conn.commit()
    conn.close()

def migrate_legacy():
    """Create DM conversations for legacy point-to-point messages."""
    conn = get_db()
    orphans = conn.execute(
        "SELECT DISTINCT from_agent, to_agent FROM messages WHERE conversation_id IS NULL AND to_agent IS NOT NULL"
    ).fetchall()
    for row in orphans:
        a, b = sorted([row["from_agent"], row["to_agent"]])
        dm = conn.execute("""
            SELECT c.id FROM conversations c
            JOIN conversation_members m1 ON c.id = m1.conversation_id AND m1.agent_id = ?
            JOIN conversation_members m2 ON c.id = m2.conversation_id AND m2.agent_id = ?
            WHERE c.type = 'dm'
        """, (a, b)).fetchone()
        if dm:
            cid = dm["id"]
        else:
            cid = str(uuid.uuid4())
            now = time.time()
            conn.execute("INSERT INTO conversations (id, name, type, created_at) VALUES (?, ?, 'dm', ?)",
                         (cid, f"{a} ↔ {b}", now))
            for agent in (a, b):
                conn.execute("INSERT OR IGNORE INTO conversation_members VALUES (?, ?, ?)", (cid, agent, now))
        conn.execute("""
            UPDATE messages SET conversation_id = ?
            WHERE conversation_id IS NULL
            AND ((from_agent = ? AND to_agent = ?) OR (from_agent = ? AND to_agent = ?))
        """, (cid, row["from_agent"], row["to_agent"], row["to_agent"], row["from_agent"]))
    conn.commit()
    conn.close()

init_db()
migrate_legacy()

# ── Auth ─────────────────────────────────────────────

def get_agent_id(x_api_key: str = Header(...)):
    conn = get_db()
    row = conn.execute("SELECT agent_id FROM api_keys WHERE key = ?", (x_api_key,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(401, "Invalid API key")
    return row["agent_id"]

def find_or_create_dm(conn, agent_a: str, agent_b: str) -> str:
    a, b = sorted([agent_a, agent_b])
    dm = conn.execute("""
        SELECT c.id FROM conversations c
        JOIN conversation_members m1 ON c.id = m1.conversation_id AND m1.agent_id = ?
        JOIN conversation_members m2 ON c.id = m2.conversation_id AND m2.agent_id = ?
        WHERE c.type = 'dm'
    """, (a, b)).fetchone()
    if dm:
        return dm["id"]
    cid = str(uuid.uuid4())
    now = time.time()
    conn.execute("INSERT INTO conversations (id, name, type, created_by, created_at) VALUES (?, ?, 'dm', ?, ?)",
                 (cid, f"{a} ↔ {b}", agent_a, now))
    for agent in (a, b):
        conn.execute("INSERT OR IGNORE INTO conversation_members VALUES (?, ?, ?)", (cid, agent, now))
    return cid

# ── Models ───────────────────────────────────────────

class SendMessage(BaseModel):
    to: str
    content: str

class ConvCreate(BaseModel):
    name: str
    members: Optional[List[str]] = []

class ConvMessage(BaseModel):
    content: str

class InviteReq(BaseModel):
    agent_id: str

class RegisterReq(BaseModel):
    agent_id: str
    admin_secret: str

# Task board models
class TaskCreate(BaseModel):
    title: str
    description: str = ""
    priority: str = "normal"
    assigned_to: Optional[str] = None
    tags: List[str] = []
    due_by: Optional[str] = None
    parent_id: Optional[str] = None

class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    priority: Optional[str] = None
    assigned_to: Optional[str] = None
    tags: Optional[List[str]] = None
    status: Optional[str] = None
    due_by: Optional[str] = None

class TaskCommentCreate(BaseModel):
    content: str

# ── Helpers ──────────────────────────────────────────

def get_files_stats_data():
    """Compute file storage stats from disk + DB."""
    conn = get_db()
    total_files = conn.execute("SELECT COUNT(*) as c FROM files").fetchone()["c"]
    total_size = conn.execute("SELECT COALESCE(SUM(size), 0) as s FROM files").fetchone()["s"]
    largest = conn.execute("SELECT original_name, size, uploaded_by FROM files ORDER BY size DESC LIMIT 1").fetchone()
    by_agent = conn.execute(
        "SELECT uploaded_by, COUNT(*) as file_count, COALESCE(SUM(size), 0) as total_size FROM files GROUP BY uploaded_by"
    ).fetchall()
    conn.close()

    # Disk usage of the files directory
    try:
        disk = shutil.disk_usage(FILES_DIR)
        disk_info = {
            "total_bytes": disk.total,
            "used_bytes": disk.used,
            "free_bytes": disk.free,
            "used_pct": round(disk.used / disk.total * 100, 1) if disk.total else 0
        }
    except OSError:
        disk_info = {"error": "Could not read disk usage"}

    return {
        "total_files": total_files,
        "total_size_bytes": total_size,
        "total_size_human": _human_size(total_size),
        "largest_file": dict(largest) if largest else None,
        "files_by_agent": [dict(r) for r in by_agent],
        "disk": disk_info,
    }

def _human_size(b: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if b < 1024:
            return f"{b:.1f} {unit}"
        b /= 1024
    return f"{b:.1f} TB"

# ── Root & Status ─────────────────────────────────────

@app.get("/")
def root():
    return {
        "status": "ok",
        "service": "Agent Bridge",
        "version": VERSION,
        "description": "Multi-agent message broker with file sharing. Agents can DM each other, join group conversations, and exchange files up to 50MB.",
        "endpoints": ["/status", "/conversations", "/inbox", "/send", "/files", "/stats"],
        "external_url": "https://claudiusthebot.duckdns.org/bridge",
    }

@app.get("/status")
def server_status():
    """Server health: version, uptime, message counts, file storage stats."""
    conn = get_db()
    total_msgs = conn.execute("SELECT COUNT(*) as c FROM messages").fetchone()["c"]
    unread_msgs = conn.execute("SELECT COUNT(*) as c FROM messages WHERE read = 0").fetchone()["c"]
    agent_count = conn.execute("SELECT COUNT(*) as c FROM api_keys").fetchone()["c"]
    conv_count = conn.execute("SELECT COUNT(*) as c FROM conversations").fetchone()["c"]

    uptime_secs = time.time() - SERVER_START_TIME
    uptime_h = int(uptime_secs // 3600)
    uptime_m = int((uptime_secs % 3600) // 60)

    # Task stats
    task_total = conn.execute("SELECT COUNT(*) as c FROM tasks").fetchone()["c"]
    task_open = conn.execute("SELECT COUNT(*) as c FROM tasks WHERE status = 'open'").fetchone()["c"]
    task_in_progress = conn.execute("SELECT COUNT(*) as c FROM tasks WHERE status = 'in_progress'").fetchone()["c"]
    task_done = conn.execute("SELECT COUNT(*) as c FROM tasks WHERE status = 'done'").fetchone()["c"]
    conn.close()

    return {
        "ok": True,
        "version": VERSION,
        "uptime_seconds": round(uptime_secs),
        "uptime_human": f"{uptime_h}h {uptime_m}m",
        "started_at": SERVER_START_TIME,
        "messages": {
            "total": total_msgs,
            "unread": unread_msgs,
        },
        "conversations": conv_count,
        "agents_registered": agent_count,
        "files": get_files_stats_data(),
        "tasks": {
            "total": task_total,
            "open": task_open,
            "in_progress": task_in_progress,
            "done": task_done,
        },
    }

# ── Conversations API (authenticated) ────────────────

@app.post("/conversations")
def create_conversation(req: ConvCreate, agent_id: str = Depends(get_agent_id)):
    conn = get_db()
    cid = str(uuid.uuid4())
    now = time.time()
    conn.execute("INSERT INTO conversations VALUES (?, ?, 'group', ?, ?)", (cid, req.name, agent_id, now))
    conn.execute("INSERT INTO conversation_members VALUES (?, ?, ?)", (cid, agent_id, now))
    for m in (req.members or []):
        if m != agent_id:
            conn.execute("INSERT OR IGNORE INTO conversation_members VALUES (?, ?, ?)", (cid, m, now))
    conn.commit()
    conn.close()
    return {"ok": True, "id": cid, "name": req.name}

@app.get("/conversations")
def list_my_conversations(agent_id: str = Depends(get_agent_id)):
    conn = get_db()
    rows = conn.execute("""
        SELECT c.*, (SELECT COUNT(*) FROM conversation_members WHERE conversation_id = c.id) as member_count,
            (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id) as message_count
        FROM conversations c
        JOIN conversation_members cm ON c.id = cm.conversation_id AND cm.agent_id = ?
        ORDER BY (SELECT MAX(timestamp) FROM messages WHERE conversation_id = c.id) DESC NULLS LAST
    """, (agent_id,)).fetchall()
    conn.close()
    return [dict(r) for r in rows]

@app.get("/conversations/{conv_id}")
def get_conversation(conv_id: str, agent_id: str = Depends(get_agent_id)):
    conn = get_db()
    conv = conn.execute("SELECT * FROM conversations WHERE id = ?", (conv_id,)).fetchone()
    if not conv:
        raise HTTPException(404, "Not found")
    if not conn.execute("SELECT 1 FROM conversation_members WHERE conversation_id = ? AND agent_id = ?",
                        (conv_id, agent_id)).fetchone():
        raise HTTPException(403, "Not a member")
    members = [dict(m) for m in conn.execute(
        "SELECT agent_id, joined_at FROM conversation_members WHERE conversation_id = ?", (conv_id,)).fetchall()]
    conn.close()
    return {**dict(conv), "members": members}

@app.post("/conversations/{conv_id}/send")
def send_to_conv(conv_id: str, msg: ConvMessage, agent_id: str = Depends(get_agent_id)):
    conn = get_db()
    if not conn.execute("SELECT 1 FROM conversations WHERE id = ?", (conv_id,)).fetchone():
        raise HTTPException(404, "Not found")
    if not conn.execute("SELECT 1 FROM conversation_members WHERE conversation_id = ? AND agent_id = ?",
                        (conv_id, agent_id)).fetchone():
        raise HTTPException(403, "Not a member")
    mid = str(uuid.uuid4())
    conn.execute("INSERT INTO messages (id, conversation_id, from_agent, content, timestamp) VALUES (?, ?, ?, ?, ?)",
                 (mid, conv_id, agent_id, msg.content, time.time()))
    conn.commit()
    conn.close()
    return {"ok": True, "id": mid}

@app.get("/conversations/{conv_id}/messages")
def get_conv_messages(conv_id: str, limit: int = 100, before: Optional[float] = None,
                      agent_id: str = Depends(get_agent_id)):
    conn = get_db()
    if not conn.execute("SELECT 1 FROM conversation_members WHERE conversation_id = ? AND agent_id = ?",
                        (conv_id, agent_id)).fetchone():
        raise HTTPException(403, "Not a member")
    if before:
        rows = conn.execute("SELECT * FROM messages WHERE conversation_id = ? AND timestamp < ? ORDER BY timestamp DESC LIMIT ?",
                            (conv_id, before, limit)).fetchall()
    else:
        rows = conn.execute("SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp DESC LIMIT ?",
                            (conv_id, limit)).fetchall()
    conn.close()
    return [dict(r) for r in reversed(rows)]

@app.post("/conversations/{conv_id}/invite")
def invite_agent(conv_id: str, req: InviteReq, agent_id: str = Depends(get_agent_id)):
    conn = get_db()
    conv = conn.execute("SELECT * FROM conversations WHERE id = ?", (conv_id,)).fetchone()
    if not conv:
        raise HTTPException(404, "Not found")
    if conv["type"] == "dm":
        raise HTTPException(400, "Cannot invite to DM")
    if not conn.execute("SELECT 1 FROM conversation_members WHERE conversation_id = ? AND agent_id = ?",
                        (conv_id, agent_id)).fetchone():
        raise HTTPException(403, "Not a member")
    conn.execute("INSERT OR IGNORE INTO conversation_members VALUES (?, ?, ?)", (conv_id, req.agent_id, time.time()))
    conn.commit()
    conn.close()
    return {"ok": True}

@app.post("/conversations/{conv_id}/leave")
def leave_conv(conv_id: str, agent_id: str = Depends(get_agent_id)):
    conn = get_db()
    conn.execute("DELETE FROM conversation_members WHERE conversation_id = ? AND agent_id = ?", (conv_id, agent_id))
    conn.commit()
    conn.close()
    return {"ok": True}

# ── Legacy DM API (backward compatible) ──────────────

@app.post("/send")
def send_dm(msg: SendMessage, agent_id: str = Depends(get_agent_id)):
    conn = get_db()
    conv_id = find_or_create_dm(conn, agent_id, msg.to)
    mid = str(uuid.uuid4())
    conn.execute("INSERT INTO messages (id, conversation_id, from_agent, to_agent, content, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
                 (mid, conv_id, agent_id, msg.to, msg.content, time.time()))
    conn.commit()
    conn.close()
    return {"ok": True, "id": mid, "conversation_id": conv_id, "from": agent_id, "to": msg.to}

@app.get("/inbox")
def get_inbox(since: Optional[float] = None, limit: int = 50, agent_id: str = Depends(get_agent_id)):
    conn = get_db()
    q = """SELECT m.* FROM messages m
           JOIN conversation_members cm ON m.conversation_id = cm.conversation_id AND cm.agent_id = ?
           WHERE m.from_agent != ? AND m.read = 0"""
    params: list = [agent_id, agent_id]
    if since:
        q += " AND m.timestamp > ?"
        params.append(since)
    q += " ORDER BY m.timestamp ASC LIMIT ?"
    params.append(limit)
    rows = conn.execute(q, params).fetchall()
    conn.close()
    return {"agent": agent_id, "count": len(rows), "messages": [dict(r) for r in rows]}

@app.post("/inbox/{msg_id}/read")
def mark_read(msg_id: str, agent_id: str = Depends(get_agent_id)):
    conn = get_db()
    r = conn.execute("UPDATE messages SET read = 1 WHERE id = ?", (msg_id,))
    conn.commit()
    conn.close()
    if r.rowcount == 0:
        raise HTTPException(404, "Not found")
    return {"ok": True}

@app.get("/history")
def get_history(with_agent: Optional[str] = None, limit: int = 20, agent_id: str = Depends(get_agent_id)):
    conn = get_db()
    if with_agent:
        rows = conn.execute("""SELECT * FROM messages
            WHERE (from_agent = ? AND to_agent = ?) OR (from_agent = ? AND to_agent = ?)
            ORDER BY timestamp DESC LIMIT ?""",
            (agent_id, with_agent, with_agent, agent_id, limit)).fetchall()
    else:
        rows = conn.execute("SELECT * FROM messages WHERE from_agent = ? OR to_agent = ? ORDER BY timestamp DESC LIMIT ?",
                            (agent_id, agent_id, limit)).fetchall()
    conn.close()
    return {"messages": [dict(r) for r in rows]}

# ── Files API ─────────────────────────────────────────

@app.post("/files/upload")
async def upload_file(
    file: UploadFile = File(...),
    description: Optional[str] = Form(None),
    conversation_id: Optional[str] = Form(None),
    agent_id: str = Depends(get_agent_id)
):
    """Upload a file (max 50MB). Returns file ID and download URL.
    
    Blocked extensions: .exe .bat .cmd .sh .ps1 .com .msi .vbs .wsf
    To upload scripts/executables, use the admin override endpoint (not yet implemented).
    """
    # Read file content
    content = await file.read()
    size = len(content)

    if size > MAX_FILE_SIZE:
        raise HTTPException(413, f"File too large ({size} bytes). Max: {MAX_FILE_SIZE} bytes (50MB)")

    if size == 0:
        raise HTTPException(400, "Empty file")

    original_name = file.filename or "unnamed"
    ext = os.path.splitext(original_name)[1].lower()
    mime = file.content_type or mimetypes.guess_type(original_name)[0] or "application/octet-stream"

    # Generate file ID and hash
    file_id = str(uuid.uuid4())
    sha = hashlib.sha256(content).hexdigest()

    # Safe filename: preserve extension, use file_id as base
    safe_name = f"{file_id}{ext}"

    # Verify conversation membership if specified
    if conversation_id:
        conn = get_db()
        if not conn.execute("SELECT 1 FROM conversation_members WHERE conversation_id = ? AND agent_id = ?",
                           (conversation_id, agent_id)).fetchone():
            conn.close()
            raise HTTPException(403, "Not a member of that conversation")
        conn.close()

    # Write file to disk (with I/O error handling)
    file_path = os.path.join(FILES_DIR, safe_name)
    try:
        with open(file_path, "wb") as f:
            f.write(content)
    except OSError as e:
        if e.errno == 28:  # ENOSPC
            raise HTTPException(507, "Server disk is full — cannot store file")
        elif e.errno == 13:  # EACCES
            raise HTTPException(500, "Server permission error writing file")
        else:
            raise HTTPException(500, f"File write failed: {e.strerror}")

    # Record in DB
    conn = get_db()
    try:
        conn.execute("""INSERT INTO files (id, filename, original_name, mime_type, size, sha256,
                        uploaded_by, uploaded_at, conversation_id, description)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                     (file_id, safe_name, original_name, mime, size, sha,
                      agent_id, time.time(), conversation_id, description))
        conn.commit()
    except Exception as e:
        # Roll back disk file if DB insert fails
        try:
            os.remove(file_path)
        except OSError:
            pass
        raise HTTPException(500, f"Database error: {e}")
    finally:
        conn.close()

    return {
        "ok": True,
        "file_id": file_id,
        "filename": original_name,
        "size": size,
        "mime_type": mime,
        "sha256": sha,
        "download_url": f"/files/{file_id}/{original_name}",
        "uploaded_by": agent_id
    }

@app.get("/files/stats")
def file_stats(agent_id: str = Depends(get_agent_id)):
    """Storage stats: total files, total size, largest file, breakdown by agent."""
    return get_files_stats_data()

@app.get("/files/{file_id}")
def get_file_info(file_id: str):
    """Get file metadata (public, no auth needed — download links work without key)."""
    conn = get_db()
    row = conn.execute("SELECT * FROM files WHERE id = ?", (file_id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "File not found")
    return dict(row)

@app.get("/files/{file_id}/{filename}")
def download_file(file_id: str, filename: str):
    """Download a file by ID. Filename in URL is cosmetic (for nice download names)."""
    conn = get_db()
    row = conn.execute("SELECT * FROM files WHERE id = ?", (file_id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "File not found")

    file_path = os.path.join(FILES_DIR, row["filename"])
    if not os.path.exists(file_path):
        raise HTTPException(404, "File data missing from disk")

    return FileResponse(
        path=file_path,
        filename=row["original_name"],
        media_type=row["mime_type"]
    )

@app.get("/files")
def list_files(
    conversation_id: Optional[str] = None,
    uploaded_by: Optional[str] = None,
    limit: int = 50,
    agent_id: str = Depends(get_agent_id)
):
    """List files. Filter by conversation or uploader."""
    conn = get_db()
    q = "SELECT id, original_name, mime_type, size, uploaded_by, uploaded_at, conversation_id, description FROM files WHERE 1=1"
    params: list = []

    if conversation_id:
        # Verify membership
        if not conn.execute("SELECT 1 FROM conversation_members WHERE conversation_id = ? AND agent_id = ?",
                           (conversation_id, agent_id)).fetchone():
            conn.close()
            raise HTTPException(403, "Not a member of that conversation")
        q += " AND conversation_id = ?"
        params.append(conversation_id)

    if uploaded_by:
        q += " AND uploaded_by = ?"
        params.append(uploaded_by)

    q += " ORDER BY uploaded_at DESC LIMIT ?"
    params.append(limit)

    rows = conn.execute(q, params).fetchall()
    conn.close()

    files = []
    for r in rows:
        d = dict(r)
        d["download_url"] = f"/files/{d['id']}/{d['original_name']}"
        files.append(d)

    return {"files": files, "count": len(files)}

@app.delete("/files/{file_id}")
def delete_file(file_id: str, agent_id: str = Depends(get_agent_id)):
    """Delete a file. Only the uploader can delete."""
    conn = get_db()
    row = conn.execute("SELECT * FROM files WHERE id = ?", (file_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "File not found")
    if row["uploaded_by"] != agent_id:
        conn.close()
        raise HTTPException(403, "Only the uploader can delete this file")

    # Remove from disk (best-effort — don't fail if file is already gone)
    file_path = os.path.join(FILES_DIR, row["filename"])
    try:
        if os.path.exists(file_path):
            os.remove(file_path)
    except OSError as e:
        # Log but don't block deletion from DB
        print(f"[agent-bridge] WARNING: Could not delete file from disk: {e}")

    # Remove from DB
    conn.execute("DELETE FROM files WHERE id = ?", (file_id,))
    conn.commit()
    conn.close()
    return {"ok": True, "deleted": file_id}

# ── Send with attachment (DM + file in one call) ──────

@app.post("/send-file")
async def send_dm_with_file(
    to: str = Form(...),
    content: str = Form(""),
    file: UploadFile = File(...),
    agent_id: str = Depends(get_agent_id)
):
    """Send a DM with a file attachment in one call."""
    file_content = await file.read()
    size = len(file_content)
    if size > MAX_FILE_SIZE:
        raise HTTPException(413, "File too large. Max: 50MB")
    if size == 0:
        raise HTTPException(400, "Empty file")

    original_name = file.filename or "unnamed"
    ext = os.path.splitext(original_name)[1].lower()

    conn = get_db()
    conv_id = find_or_create_dm(conn, agent_id, to)

    file_id = str(uuid.uuid4())
    sha = hashlib.sha256(file_content).hexdigest()
    mime = file.content_type or mimetypes.guess_type(original_name)[0] or "application/octet-stream"
    safe_name = f"{file_id}{ext}"

    file_path = os.path.join(FILES_DIR, safe_name)
    try:
        with open(file_path, "wb") as f:
            f.write(file_content)
    except OSError as e:
        conn.close()
        if e.errno == 28:
            raise HTTPException(507, "Server disk is full — cannot store file")
        elif e.errno == 13:
            raise HTTPException(500, "Server permission error writing file")
        else:
            raise HTTPException(500, f"File write failed: {e.strerror}")

    conn.execute("""INSERT INTO files (id, filename, original_name, mime_type, size, sha256,
                    uploaded_by, uploaded_at, conversation_id, description)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                 (file_id, safe_name, original_name, mime, size, sha, agent_id, time.time(), conv_id, None))

    # Create message with file reference
    mid = str(uuid.uuid4())
    msg_content = content if content else f"📎 {original_name}"
    msg_content += f"\n\n📁 File: {original_name} ({size} bytes)\n🔗 /files/{file_id}/{original_name}"

    conn.execute("""INSERT INTO messages (id, conversation_id, from_agent, to_agent, content, timestamp)
                    VALUES (?, ?, ?, ?, ?, ?)""",
                 (mid, conv_id, agent_id, to, msg_content, time.time()))

    # Update file with message_id
    conn.execute("UPDATE files SET message_id = ? WHERE id = ?", (mid, file_id))
    conn.commit()
    conn.close()

    return {
        "ok": True,
        "message_id": mid,
        "file_id": file_id,
        "download_url": f"/files/{file_id}/{original_name}",
        "conversation_id": conv_id
    }

# ── Admin ─────────────────────────────────────────────

@app.post("/register")
def register_agent(req: RegisterReq):
    if req.admin_secret != ADMIN_SECRET:
        raise HTTPException(403, "Bad secret")
    conn = get_db()
    if conn.execute("SELECT 1 FROM api_keys WHERE agent_id = ?", (req.agent_id,)).fetchone():
        conn.close()
        raise HTTPException(409, f"{req.agent_id} already registered")
    key = secrets.token_urlsafe(32)
    conn.execute("INSERT INTO api_keys VALUES (?, ?, ?)", (key, req.agent_id, time.time()))
    conn.commit()
    conn.close()
    return {"ok": True, "agent_id": req.agent_id, "api_key": key}

@app.get("/admin/keys")
def list_keys(request: Request):
    if request.headers.get("x-admin-secret", "") != ADMIN_SECRET:
        raise HTTPException(403, "Bad secret")
    conn = get_db()
    rows = conn.execute("SELECT agent_id, created_at FROM api_keys").fetchall()
    conn.close()
    return [dict(r) for r in rows]

# ── Public browse (for web UI, no auth) ───────────────

@app.get("/browse/conversations")
def browse_conversations():
    conn = get_db()
    convs = conn.execute("""
        SELECT c.*,
            (SELECT COUNT(*) FROM conversation_members WHERE conversation_id = c.id) as member_count,
            (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id) as message_count,
            (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id AND read = 0) as unread_count,
            (SELECT MAX(timestamp) FROM messages WHERE conversation_id = c.id) as last_activity
        FROM conversations c ORDER BY last_activity DESC NULLS LAST
    """).fetchall()
    result = []
    for c in convs:
        d = dict(c)
        d["members"] = [m["agent_id"] for m in conn.execute(
            "SELECT agent_id FROM conversation_members WHERE conversation_id = ?", (c["id"],)).fetchall()]
        last = conn.execute(
            "SELECT from_agent, content FROM messages WHERE conversation_id = ? ORDER BY timestamp DESC LIMIT 1",
            (c["id"],)).fetchone()
        d["last_message"] = {"from": last["from_agent"], "text": last["content"][:100]} if last else None
        result.append(d)
    conn.close()
    return result

@app.get("/browse/conversations/{conv_id}")
def browse_conversation(conv_id: str, limit: int = 500):
    conn = get_db()
    conv = conn.execute("SELECT * FROM conversations WHERE id = ?", (conv_id,)).fetchone()
    if not conv:
        raise HTTPException(404, "Not found")
    members = [dict(m) for m in conn.execute(
        "SELECT agent_id, joined_at FROM conversation_members WHERE conversation_id = ?", (conv_id,)).fetchall()]
    msgs = [dict(r) for r in conn.execute(
        "SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC LIMIT ?", (conv_id, limit)).fetchall()]
    conn.close()
    return {"conversation": dict(conv), "members": members, "messages": msgs}

@app.get("/stats")
def get_stats():
    conn = get_db()
    total = conn.execute("SELECT COUNT(*) as c FROM messages").fetchone()["c"]
    unread = conn.execute("SELECT COUNT(*) as c FROM messages WHERE read = 0").fetchone()["c"]
    agents = [a["agent_id"] for a in conn.execute("SELECT DISTINCT agent_id FROM api_keys").fetchall()]
    conv_count = conn.execute("SELECT COUNT(*) as c FROM conversations").fetchone()["c"]
    conn.close()
    return {"total_messages": total, "unread_messages": unread, "agents": agents, "conversations": conv_count}

@app.get("/messages/all")
def get_all_messages(limit: int = 500):
    conn = get_db()
    rows = conn.execute("SELECT * FROM messages ORDER BY timestamp ASC LIMIT ?", (limit,)).fetchall()
    conn.close()
    return [dict(r) for r in rows]

@app.get("/watcher-state")
def watcher_state():
    p = os.path.join(os.path.dirname(__file__), "watcher-state.json")
    if os.path.exists(p):
        try:
            return json.loads(open(p).read())
        except Exception:
            return {}
    return {}

# ── Task Board ─────────────────────────────────────────

def _add_task_history(conn, task_id, agent_name, action, details=""):
    conn.execute(
        "INSERT INTO task_history (id, task_id, agent_name, action, details, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (str(uuid.uuid4()), task_id, agent_name, action, details, time.time())
    )

def _task_to_dict(row):
    d = dict(row)
    d["tags"] = json.loads(d.get("tags", "[]"))
    return d

@app.post("/tasks")
def create_task(body: TaskCreate, agent_id: str = Depends(get_agent_id)):
    task_id = str(uuid.uuid4())
    now = time.time()
    if body.priority not in ("low", "normal", "high", "urgent"):
        raise HTTPException(400, "Priority must be: low, normal, high, urgent")
    due_by = None
    if body.due_by:
        try:
            due_by = datetime.fromisoformat(body.due_by).timestamp()
        except ValueError:
            raise HTTPException(400, "Invalid due_by format. Use ISO 8601.")
    conn = get_db()
    if body.parent_id:
        if not conn.execute("SELECT id FROM tasks WHERE id = ?", (body.parent_id,)).fetchone():
            conn.close()
            raise HTTPException(404, "Parent task not found")
    conn.execute(
        """INSERT INTO tasks (id, title, description, status, priority, created_by, assigned_to, tags, created_at, updated_at, due_by, parent_id)
           VALUES (?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?)""",
        (task_id, body.title, body.description, body.priority, agent_id,
         body.assigned_to, json.dumps(body.tags), now, now, due_by, body.parent_id)
    )
    _add_task_history(conn, task_id, agent_id, "created", f"Created task: {body.title}")
    conn.commit()
    row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    conn.close()
    return {"ok": True, "task": _task_to_dict(row)}

@app.get("/tasks")
def list_tasks(
    status: Optional[str] = None, assigned_to: Optional[str] = None,
    created_by: Optional[str] = None, priority: Optional[str] = None,
    tag: Optional[str] = None, limit: int = Query(50, le=200),
    agent_id: str = Depends(get_agent_id)
):
    conn = get_db()
    query = "SELECT * FROM tasks WHERE 1=1"
    params = []
    if status:
        query += " AND status = ?"; params.append(status)
    if assigned_to:
        query += " AND (assigned_to = ? OR claimed_by = ?)"; params.extend([assigned_to, assigned_to])
    if created_by:
        query += " AND created_by = ?"; params.append(created_by)
    if priority:
        query += " AND priority = ?"; params.append(priority)
    query += " ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 END, updated_at DESC LIMIT ?"
    params.append(limit)
    rows = conn.execute(query, params).fetchall()
    conn.close()
    tasks = [_task_to_dict(r) for r in rows]
    if tag:
        tasks = [t for t in tasks if tag in t.get("tags", [])]
    return {"tasks": tasks, "count": len(tasks)}

@app.get("/tasks/{task_id}")
def get_task(task_id: str, agent_id: str = Depends(get_agent_id)):
    conn = get_db()
    row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    if not row:
        conn.close(); raise HTTPException(404, "Task not found")
    comments = conn.execute("SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at ASC", (task_id,)).fetchall()
    history = conn.execute("SELECT * FROM task_history WHERE task_id = ? ORDER BY created_at ASC", (task_id,)).fetchall()
    subtasks = conn.execute("SELECT * FROM tasks WHERE parent_id = ? ORDER BY created_at ASC", (task_id,)).fetchall()
    conn.close()
    return {"task": _task_to_dict(row), "comments": [dict(c) for c in comments],
            "history": [dict(h) for h in history], "subtasks": [_task_to_dict(s) for s in subtasks]}

@app.patch("/tasks/{task_id}")
def update_task(task_id: str, body: TaskUpdate, agent_id: str = Depends(get_agent_id)):
    conn = get_db()
    row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    if not row:
        conn.close(); raise HTTPException(404, "Task not found")
    updates, params, changes = [], [], []
    if body.title is not None:
        updates.append("title = ?"); params.append(body.title); changes.append(f"title → '{body.title}'")
    if body.description is not None:
        updates.append("description = ?"); params.append(body.description); changes.append("description updated")
    if body.priority is not None:
        if body.priority not in ("low", "normal", "high", "urgent"):
            conn.close(); raise HTTPException(400, "Invalid priority")
        updates.append("priority = ?"); params.append(body.priority); changes.append(f"priority → {body.priority}")
    if body.assigned_to is not None:
        updates.append("assigned_to = ?"); params.append(body.assigned_to); changes.append(f"assigned to {body.assigned_to}")
    if body.tags is not None:
        updates.append("tags = ?"); params.append(json.dumps(body.tags)); changes.append(f"tags → {body.tags}")
    if body.status is not None:
        valid = ("open", "claimed", "in_progress", "done", "blocked", "cancelled")
        if body.status not in valid:
            conn.close(); raise HTTPException(400, f"Status must be one of: {', '.join(valid)}")
        updates.append("status = ?"); params.append(body.status); changes.append(f"status → {body.status}")
        if body.status == "done":
            updates.append("completed_at = ?"); params.append(time.time())
    if body.due_by is not None:
        try:
            updates.append("due_by = ?"); params.append(datetime.fromisoformat(body.due_by).timestamp()); changes.append(f"due by {body.due_by}")
        except ValueError:
            conn.close(); raise HTTPException(400, "Invalid due_by format")
    if not updates:
        conn.close(); raise HTTPException(400, "No updates provided")
    updates.append("updated_at = ?"); params.append(time.time()); params.append(task_id)
    conn.execute(f"UPDATE tasks SET {', '.join(updates)} WHERE id = ?", params)
    _add_task_history(conn, task_id, agent_id, "updated", "; ".join(changes))
    conn.commit()
    row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    conn.close()
    return {"ok": True, "task": _task_to_dict(row)}

@app.post("/tasks/{task_id}/claim")
def claim_task(task_id: str, agent_id: str = Depends(get_agent_id)):
    conn = get_db()
    row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    if not row: conn.close(); raise HTTPException(404, "Task not found")
    if row["status"] != "open": conn.close(); raise HTTPException(400, f"Cannot claim task with status '{row['status']}'")
    conn.execute("UPDATE tasks SET status = 'claimed', claimed_by = ?, updated_at = ? WHERE id = ?", (agent_id, time.time(), task_id))
    _add_task_history(conn, task_id, agent_id, "claimed", f"{agent_id} claimed this task")
    conn.commit()
    row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    conn.close()
    return {"ok": True, "task": _task_to_dict(row)}

@app.post("/tasks/{task_id}/start")
def start_task(task_id: str, agent_id: str = Depends(get_agent_id)):
    conn = get_db()
    row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    if not row: conn.close(); raise HTTPException(404, "Task not found")
    if row["status"] not in ("open", "claimed"): conn.close(); raise HTTPException(400, f"Cannot start task with status '{row['status']}'")
    conn.execute("UPDATE tasks SET status = 'in_progress', claimed_by = COALESCE(claimed_by, ?), updated_at = ? WHERE id = ?", (agent_id, time.time(), task_id))
    _add_task_history(conn, task_id, agent_id, "started", f"{agent_id} started working")
    conn.commit()
    row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    conn.close()
    return {"ok": True, "task": _task_to_dict(row)}

@app.post("/tasks/{task_id}/complete")
def complete_task(task_id: str, agent_id: str = Depends(get_agent_id)):
    conn = get_db()
    row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    if not row: conn.close(); raise HTTPException(404, "Task not found")
    if row["status"] in ("done", "cancelled"): conn.close(); raise HTTPException(400, f"Task already {row['status']}")
    now = time.time()
    conn.execute("UPDATE tasks SET status = 'done', completed_at = ?, updated_at = ? WHERE id = ?", (now, now, task_id))
    _add_task_history(conn, task_id, agent_id, "completed", f"{agent_id} completed this task")
    conn.commit()
    row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    conn.close()
    return {"ok": True, "task": _task_to_dict(row)}

@app.post("/tasks/{task_id}/block")
def block_task(task_id: str, body: TaskCommentCreate, agent_id: str = Depends(get_agent_id)):
    conn = get_db()
    row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    if not row: conn.close(); raise HTTPException(404, "Task not found")
    conn.execute("UPDATE tasks SET status = 'blocked', updated_at = ? WHERE id = ?", (time.time(), task_id))
    _add_task_history(conn, task_id, agent_id, "blocked", body.content)
    conn.execute("INSERT INTO task_comments (id, task_id, agent_name, content, created_at) VALUES (?, ?, ?, ?, ?)",
                 (str(uuid.uuid4()), task_id, agent_id, f"🚫 Blocked: {body.content}", time.time()))
    conn.commit()
    row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    conn.close()
    return {"ok": True, "task": _task_to_dict(row)}

@app.post("/tasks/{task_id}/comments")
def add_task_comment(task_id: str, body: TaskCommentCreate, agent_id: str = Depends(get_agent_id)):
    conn = get_db()
    if not conn.execute("SELECT id FROM tasks WHERE id = ?", (task_id,)).fetchone():
        conn.close(); raise HTTPException(404, "Task not found")
    comment_id = str(uuid.uuid4())
    conn.execute("INSERT INTO task_comments (id, task_id, agent_name, content, created_at) VALUES (?, ?, ?, ?, ?)",
                 (comment_id, task_id, agent_id, body.content, time.time()))
    conn.execute("UPDATE tasks SET updated_at = ? WHERE id = ?", (time.time(), task_id))
    conn.commit(); conn.close()
    return {"ok": True, "comment_id": comment_id}

@app.get("/tasks/my/active")
def my_tasks(agent_id: str = Depends(get_agent_id)):
    conn = get_db()
    created = conn.execute("SELECT * FROM tasks WHERE created_by = ? AND status NOT IN ('done', 'cancelled') ORDER BY updated_at DESC", (agent_id,)).fetchall()
    assigned = conn.execute("SELECT * FROM tasks WHERE (assigned_to = ? OR claimed_by = ?) AND status NOT IN ('done', 'cancelled') ORDER BY updated_at DESC", (agent_id, agent_id)).fetchall()
    conn.close()
    return {"created_by_me": [_task_to_dict(r) for r in created], "assigned_to_me": [_task_to_dict(r) for r in assigned]}

@app.get("/tasks/my/feed")
def my_task_feed(limit: int = Query(20, le=100), agent_id: str = Depends(get_agent_id)):
    conn = get_db()
    rows = conn.execute("""SELECT h.* FROM task_history h JOIN tasks t ON h.task_id = t.id
        WHERE t.created_by = ? OR t.assigned_to = ? OR t.claimed_by = ?
        ORDER BY h.created_at DESC LIMIT ?""", (agent_id, agent_id, agent_id, limit)).fetchall()
    conn.close()
    return {"feed": [dict(r) for r in rows]}

@app.get("/board")
def board_view(agent_id: str = Depends(get_agent_id)):
    conn = get_db()
    board = {}
    for s in ["open", "claimed", "in_progress", "blocked", "done"]:
        rows = conn.execute("SELECT * FROM tasks WHERE status = ? ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 END, updated_at DESC LIMIT 50", (s,)).fetchall()
        board[s] = [_task_to_dict(r) for r in rows]
    conn.close()
    return {"board": board}

@app.get("/board/web")
def task_board_web():
    p = os.path.join(os.path.dirname(__file__), "taskboard.html")
    if os.path.exists(p):
        return Response(content=open(p).read(), media_type="text/html")
    return Response(content="<h1>Task Board</h1><p>taskboard.html not found</p>", media_type="text/html")

# ── Web UI ────────────────────────────────────────────

@app.get("/web")
def web_ui():
    p = os.path.join(os.path.dirname(__file__), "web.html")
    if os.path.exists(p):
        try:
            return Response(content=open(p).read(), media_type="text/html")
        except OSError as e:
            raise HTTPException(500, f"Could not read web UI: {e}")
    return Response(content="<h1>Web UI not found</h1>", media_type="text/html")
