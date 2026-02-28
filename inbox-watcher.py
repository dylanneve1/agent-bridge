#!/usr/bin/env python3
"""
Agent Bridge Inbox Watcher
Polls the bridge API for unread messages.
- Telegram notification: immediate (every poll cycle)
- Auto-reply via spawned agent: batched every 30 minutes

This prevents flywheel effects when two agents both have auto-reply.
"""

import sys
import time
import json
import logging
import subprocess
import urllib.request
import urllib.error

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(levelname)s %(message)s',
    stream=sys.stdout
)

BRIDGE_URL = "http://localhost:8765"
CLAUDIUS_KEY = "waQvo5Pk6axfdekXqEicoLeloQutKaOEKAqNzg_YhCI"
BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = "-1001426819337"

DETECT_INTERVAL = 60       # Check for new messages every 60 seconds
REPLY_INTERVAL = 1800      # Spawn agent to reply every 30 minutes

# Track state
pending_messages = []       # Messages detected but not yet replied to
notified_ids = set()        # Message IDs we've already sent Telegram pings for
last_reply_time = 0         # Last time we spawned an agent to reply


def http_get(url, headers=None):
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode())


def http_post(url, data=None, headers=None):
    body = json.dumps(data or {}).encode()
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json", **(headers or {})},
        method="POST"
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode())


def check_inbox():
    return http_get(
        f"{BRIDGE_URL}/inbox",
        headers={"x-api-key": CLAUDIUS_KEY}
    )


def mark_read(msg_id):
    http_post(
        f"{BRIDGE_URL}/inbox/{msg_id}/read",
        headers={"x-api-key": CLAUDIUS_KEY}
    )


def send_telegram(text):
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
    return http_post(url, {
        "chat_id": TELEGRAM_CHAT_ID,
        "text": text,
        "parse_mode": "HTML"
    })


def spawn_agent_reply(messages):
    """Spawn a local OpenClaw agent to reply to accumulated bridge messages."""
    msg_summary = []
    senders = set()
    for msg in messages:
        sender = msg["from_agent"]
        content = msg["content"]
        senders.add(sender)
        msg_summary.append(f"From {sender}: {content}")

    messages_text = "\n\n---\n\n".join(msg_summary)
    sender_list = ", ".join(senders)

    prompt = f"""You have unread messages on your Agent Bridge from: {sender_list}

Here are the messages:

{messages_text}

---

Reply to each sender with a thoughtful, in-character response. Be yourself — casual, warm, substantive. You're Claudius, a persistent AI agent.

To send a reply, use this exact curl command format (one per sender):

curl -s -X POST http://localhost:8765/send \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: {CLAUDIUS_KEY}" \\
  -d '{{
    "to": "SENDER_NAME_HERE",
    "content": "YOUR_REPLY_HERE"
  }}'

IMPORTANT:
- The field names are "to" and "content" (not "message", not "recipient")
- The header is "x-api-key" (not "Authorization")
- Sender names are case-sensitive: use exactly "{sender_list}"
- Send one reply per sender, combining responses if they sent multiple messages
- After sending, confirm what you sent"""

    try:
        result = subprocess.run(
            ["openclaw", "agent", "--local", "--session-id", "bridge-auto-reply", "--message", prompt],
            capture_output=True,
            text=True,
            timeout=120
        )
        logging.info("Agent spawn result: %s", result.returncode)
        if result.returncode != 0:
            logging.error("Agent stderr: %s", result.stderr[-500:] if result.stderr else "none")
        if result.stdout:
            output = result.stdout.strip()
            logging.info("Agent output: %s", output[-800:] if len(output) > 800 else output)
        return result.returncode == 0
    except subprocess.TimeoutExpired:
        logging.error("Agent spawn timed out")
        return False
    except Exception as e:
        logging.error("Agent spawn failed: %s", e)
        return False


def main():
    global pending_messages, notified_ids, last_reply_time

    logging.info(
        "Agent Bridge Inbox Watcher starting — detect every %ds, reply every %ds...",
        DETECT_INTERVAL, REPLY_INTERVAL
    )

    while True:
        try:
            data = check_inbox()
            messages = data.get("messages", [])

            # --- IMMEDIATE: Telegram notification for any new messages ---
            new_messages = [m for m in messages if m["id"] not in notified_ids]

            if new_messages:
                for msg in new_messages:
                    logging.info("New message from %s: %s", msg["from_agent"], msg["content"][:120])
                    notified_ids.add(msg["id"])

                    # Add to pending queue if not already there
                    if not any(p["id"] == msg["id"] for p in pending_messages):
                        pending_messages.append(msg)

                # Send Telegram ping immediately
                for msg in new_messages:
                    content = msg["content"]
                    preview = content if len(content) <= 500 else content[:497] + "..."
                    notification = (
                        f"\U0001f4e8 <b>Agent Bridge — Message from {msg['from_agent']}:</b>\n\n"
                        f"{preview}"
                    )
                    try:
                        send_telegram(notification)
                    except Exception as e:
                        logging.error("Telegram notification failed: %s", e)

            # --- BATCHED: Auto-reply every REPLY_INTERVAL ---
            now = time.time()
            if pending_messages and (now - last_reply_time) >= REPLY_INTERVAL:
                logging.info(
                    "Reply interval reached — spawning agent for %d pending message(s)",
                    len(pending_messages)
                )

                success = spawn_agent_reply(pending_messages)

                if success:
                    # Mark all as read
                    for msg in pending_messages:
                        try:
                            mark_read(msg["id"])
                            logging.info("Marked %s as read", msg["id"][:8])
                        except Exception as e:
                            logging.error("Failed to mark %s as read: %s", msg["id"][:8], e)
                    pending_messages = []
                    last_reply_time = now
                else:
                    logging.warning(
                        "Agent spawn failed — keeping %d message(s) pending for retry",
                        len(pending_messages)
                    )
                    last_reply_time = now  # Don't retry immediately

        except urllib.error.URLError as e:
            logging.error("Bridge connection error: %s", e)
        except Exception as e:
            logging.error("Unexpected error: %s", e)

        time.sleep(DETECT_INTERVAL)


if __name__ == "__main__":
    main()
