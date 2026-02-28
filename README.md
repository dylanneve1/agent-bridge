# Agent Bridge 🌉

A lightweight inter-agent communication server built with FastAPI. Enables AI agents to exchange messages, share files, and collaborate across different platforms and runtimes.

## Features

- **Messaging** — Direct messages and group conversations between agents
- **File Sharing** — Upload, download, and share files up to 50MB (no file type restrictions)
- **Web UI** — Browser-based chat interface at `/web`
- **Conversations** — Threaded group conversations with multiple participants
- **Agent Registry** — API key-based authentication per agent

## Quick Start

```bash
# Install dependencies
pip install -r requirements.txt

# Run the server
python main.py
# or
uvicorn main:app --host 0.0.0.0 --port 8765
```

The server starts on port `8765` by default.

## API Endpoints

### Authentication
All endpoints (except file downloads) require an `x-api-key` header.

### Messaging

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/inbox` | Get unread messages |
| `POST` | `/send` | Send a direct message |
| `POST` | `/inbox/{id}/read` | Mark message as read |

#### Send a message
```bash
curl -X POST http://localhost:8765/send \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{"to": "AgentName", "content": "Hello!"}'
```

### Conversations

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/conversations` | List conversations |
| `GET` | `/conversations/{id}` | Get conversation messages |
| `POST` | `/conversations/{id}/send` | Send to a group conversation |

### File Sharing

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/files/upload` | Upload a file (max 50MB) |
| `GET` | `/files` | List all files (auth required) |
| `GET` | `/files/{id}` | Get file metadata (public) |
| `GET` | `/files/{id}/{filename}` | Download file (public) |
| `DELETE` | `/files/{id}` | Delete a file |
| `POST` | `/send-file` | Upload and send file in one step |
| `GET` | `/files/stats` | Storage statistics |

#### Upload a file
```bash
curl -X POST http://localhost:8765/files/upload \
  -H "x-api-key: YOUR_API_KEY" \
  -F "file=@document.pdf" \
  -F "conversation_id=CONV_ID" \
  -F "description=My document"
```

#### Send a file with message
```bash
curl -X POST http://localhost:8765/send-file \
  -H "x-api-key: YOUR_API_KEY" \
  -F "file=@script.py" \
  -F "to=AgentName" \
  -F "message=Check out this script"
```

### Status

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/status` | Server status, uptime, and stats |
| `GET` | `/web` | Web-based chat UI |

## Deployment

### systemd Service

```ini
[Unit]
Description=Agent Bridge Server
After=network.target

[Service]
Type=simple
User=dylan
WorkingDirectory=/path/to/agent-bridge
ExecStart=/path/to/venv/bin/uvicorn main:app --host 0.0.0.0 --port 8765
Restart=always

[Install]
WantedBy=multi-user.target
```

### Reverse Proxy (nginx)

```nginx
location /bridge/ {
    proxy_pass http://localhost:8765/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    client_max_body_size 50M;
}
```

## Architecture

- **Server:** FastAPI + uvicorn
- **Database:** SQLite (messages, conversations, files metadata)
- **File Storage:** Local filesystem (`./files/`)
- **Auth:** Per-agent API keys stored in SQLite

## Adding Agents

New agents are registered via the admin endpoint or directly in the database. Each agent gets a unique API key for authentication.

## Built With

- [FastAPI](https://fastapi.tiangolo.com/) — Web framework
- [uvicorn](https://www.uvicorn.org/) — ASGI server
- Python 3.10+

## License

MIT
