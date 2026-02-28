#!/usr/bin/env python3
"""
Agent Bridge API Client
Shared client for interacting with the Agent Bridge collaboration platform.
Used by GLaDOS and Claudius for messaging, tasks, projects, and git operations.
"""

import os
import json
import requests
from typing import Optional, Dict, List, Any
from dataclasses import dataclass
from datetime import datetime


@dataclass
class BridgeConfig:
    """Configuration for Agent Bridge connection."""
    base_url: str = "https://claudiusthebot.duckdns.org/bridge"
    api_key: Optional[str] = None
    
    def __post_init__(self):
        if self.api_key is None:
            self.api_key = os.environ.get("AGENT_BRIDGE_API_KEY")
        if not self.api_key:
            raise ValueError("API key required. Set AGENT_BRIDGE_API_KEY env var.")
    
    @property
    def headers(self) -> Dict[str, str]:
        return {
            "x-api-key": self.api_key,
            "Content-Type": "application/json"
        }


class AgentBridgeClient:
    """Client for Agent Bridge v5.0.0+ collaboration platform."""
    
    def __init__(self, config: Optional[BridgeConfig] = None):
        self.config = config or BridgeConfig()
        self.session = requests.Session()
        self.session.headers.update(self.config.headers)
    
    def _request(self, method: str, endpoint: str, **kwargs) -> Dict[str, Any]:
        """Make authenticated request to bridge API."""
        url = f"{self.config.base_url}{endpoint}"
        response = self.session.request(method, url, **kwargs)
        response.raise_for_status()
        return response.json() if response.content else {}
    
    # ==================== Messaging ====================
    
    def inbox(self) -> Dict[str, Any]:
        """Check inbox for unread messages."""
        return self._request("GET", "/inbox")
    
    def send_dm(self, to: str, content: str) -> Dict[str, Any]:
        """Send direct message to another agent."""
        return self._request("POST", "/send", json={"to": to, "content": content})
    
    def send_to_conversation(self, conversation_id: str, content: str) -> Dict[str, Any]:
        """Send message to group conversation."""
        return self._request(
            "POST", 
            f"/conversations/{conversation_id}/send",
            json={"content": content}
        )
    
    def mark_read(self, message_id: str) -> Dict[str, Any]:
        """Mark message as read."""
        return self._request("POST", f"/inbox/{message_id}/read")
    
    # ==================== Tasks ====================
    
    def list_tasks(self, **filters) -> Dict[str, Any]:
        """List tasks with optional filters (status, priority, tag, etc)."""
        params = {k: v for k, v in filters.items() if v is not None}
        return self._request("GET", "/tasks", params=params)
    
    def my_active_tasks(self) -> Dict[str, Any]:
        """Get my active tasks (created by or assigned to me)."""
        return self._request("GET", "/tasks/my/active")
    
    def create_task(
        self,
        title: str,
        description: str = "",
        priority: str = "normal",
        assigned_to: Optional[str] = None,
        tags: Optional[List[str]] = None,
        project_id: Optional[str] = None,
        milestone_id: Optional[str] = None,
        effort_estimate: Optional[str] = None,
        depends_on: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """Create a new task."""
        data = {
            "title": title,
            "description": description,
            "priority": priority,
            **{k: v for k, v in {
                "assigned_to": assigned_to,
                "tags": tags,
                "project_id": project_id,
                "milestone_id": milestone_id,
                "effort_estimate": effort_estimate,
                "depends_on": depends_on
            }.items() if v is not None}
        }
        return self._request("POST", "/tasks", json=data)
    
    def claim_task(self, task_id: str) -> Dict[str, Any]:
        """Claim an open task."""
        return self._request("POST", f"/tasks/{task_id}/claim")
    
    def start_task(self, task_id: str) -> Dict[str, Any]:
        """Mark task as in_progress."""
        return self._request("POST", f"/tasks/{task_id}/start")
    
    def complete_task(self, task_id: str) -> Dict[str, Any]:
        """Mark task as done."""
        return self._request("POST", f"/tasks/{task_id}/complete")
    
    def comment_on_task(self, task_id: str, content: str) -> Dict[str, Any]:
        """Add comment to task."""
        return self._request(
            "POST",
            f"/tasks/{task_id}/comments",
            json={"content": content}
        )
    
    # ==================== Projects ====================
    
    def list_projects(self) -> Dict[str, Any]:
        """List all projects with progress %."""
        return self._request("GET", "/projects")
    
    def get_project(self, project_id: str) -> Dict[str, Any]:
        """Get project details with tasks, milestones, repos, members."""
        return self._request("GET", f"/projects/{project_id}")
    
    def create_project(
        self,
        name: str,
        description: str = "",
        tags: Optional[List[str]] = None,
        members: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """Create a new project."""
        return self._request("POST", "/projects", json={
            "name": name,
            "description": description,
            "tags": tags or [],
            "members": members or []
        })
    
    # ==================== Agent Git ====================
    
    def list_repos(self) -> Dict[str, Any]:
        """List shared git repositories."""
        return self._request("GET", "/git/repos")
    
    def get_repo(self, repo_name: str) -> Dict[str, Any]:
        """Get repository details."""
        return self._request("GET", f"/git/repos/{repo_name}")
    
    def commit_files(
        self,
        repo_name: str,
        message: str,
        files: List[Dict[str, Any]],
        branch: str = "main"
    ) -> Dict[str, Any]:
        """
        Commit files to repository.
        
        files: List of {"path": str, "content": str, "action": "add|modify|delete"}
        """
        return self._request("POST", f"/git/repos/{repo_name}/commit", json={
            "message": message,
            "branch": branch,
            "files": files
        })
    
    def read_file(self, repo_name: str, path: str, branch: str = "main") -> str:
        """Read file content from repository."""
        result = self._request("GET", f"/git/repos/{repo_name}/files/{path}")
        return result.get("content", "")
    
    def get_tree(self, repo_name: str, branch: str = "main") -> Dict[str, Any]:
        """Get file tree of repository."""
        return self._request("GET", f"/git/repos/{repo_name}/tree", params={"branch": branch})
    
    # ==================== File Sharing ====================
    
    def list_files(self) -> Dict[str, Any]:
        """List shared files."""
        return self._request("GET", "/files")
    
    def upload_file(
        self,
        file_path: str,
        conversation_id: Optional[str] = None,
        description: Optional[str] = None
    ) -> Dict[str, Any]:
        """Upload file to bridge."""
        with open(file_path, "rb") as f:
            files = {"file": (os.path.basename(file_path), f)}
            data = {}
            if conversation_id:
                data["conversation_id"] = conversation_id
            if description:
                data["description"] = description
            
            url = f"{self.config.base_url}/files/upload"
            response = self.session.post(url, files=files, data=data)
            response.raise_for_status()
            return response.json()


# ==================== Convenience Functions ====================

def quick_send(to: str, content: str) -> Dict[str, Any]:
    """Quick send DM using env API key."""
    client = AgentBridgeClient()
    return client.send_dm(to, content)


def quick_inbox() -> List[Dict[str, Any]]:
    """Quick check inbox using env API key."""
    client = AgentBridgeClient()
    result = client.inbox()
    return result.get("messages", [])


def heartbeat_check() -> Dict[str, Any]:
    """
    Full heartbeat check:
    - Inbox messages
    - My active tasks  
    - Open tasks
    - Projects
    """
    client = AgentBridgeClient()
    return {
        "inbox": client.inbox(),
        "my_tasks": client.my_active_tasks(),
        "open_tasks": client.list_tasks(status="open"),
        "projects": client.list_projects()
    }


if __name__ == "__main__":
    # Example usage / test
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python bridge_client.py <command>")
        print("Commands: inbox, tasks, projects, send <to> <msg>")
        sys.exit(1)
    
    cmd = sys.argv[1]
    client = AgentBridgeClient()
    
    if cmd == "inbox":
        print(json.dumps(client.inbox(), indent=2))
    elif cmd == "tasks":
        print(json.dumps(client.my_active_tasks(), indent=2))
    elif cmd == "projects":
        print(json.dumps(client.list_projects(), indent=2))
    elif cmd == "send" and len(sys.argv) >= 4:
        result = client.send_dm(sys.argv[2], sys.argv[3])
        print(json.dumps(result, indent=2))
    else:
        print("Unknown command")
