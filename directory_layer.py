"""
Directory & Path Resolution Layer for AgentFS

Builds proper directory hierarchy on top of flat git files.
Supports ls, mkdir, tree, find, stat, pwd, cd semantics.
Path normalization, validation, and virtual directory inference.

Usage as library:
    from directory_layer import DirectoryResolver
    resolver = DirectoryResolver(db_path="messages.db")
    contents = resolver.ls("my-repo", "/src")
    tree = resolver.tree("my-repo", "/")

Usage via API:
    GET /git/repos/{repo}/ls?path=/src&branch=main
    GET /git/repos/{repo}/tree?path=/&branch=main&depth=3
    GET /git/repos/{repo}/find?pattern=*.py&branch=main
    GET /git/repos/{repo}/stat?path=/src/main.py&branch=main
    POST /git/repos/{repo}/mkdir  {"path": "/src/new_dir", "branch": "main"}
"""

import os
import re
import sqlite3
import fnmatch
import time
import uuid
from typing import Optional
from dataclasses import dataclass, asdict


@dataclass
class PathInfo:
    """Information about a path in the virtual filesystem."""
    path: str
    name: str
    kind: str  # "file" or "dir"
    size: int = 0
    sha256: str = ""
    commit_id: str = ""
    children_count: int = 0


class PathError(Exception):
    """Raised for invalid path operations."""
    pass


def normalize_path(path: str) -> str:
    """
    Normalize a filesystem path:
    - Resolve . and ..
    - Remove trailing slashes (except root)
    - Collapse double slashes
    - Ensure leading /
    - Strip whitespace
    - Block path traversal above root
    """
    path = path.strip()
    if not path or path == "/":
        return "/"

    # Ensure leading slash
    if not path.startswith("/"):
        path = "/" + path

    # Split into components and resolve
    parts = path.split("/")
    resolved = []
    for part in parts:
        if part == "" or part == ".":
            continue
        elif part == "..":
            if resolved:
                resolved.pop()
            # Silently ignore .. above root (don't raise)
        else:
            resolved.append(part)

    result = "/" + "/".join(resolved)
    return result if result else "/"


def validate_path(path: str) -> str:
    """
    Validate and normalize a path. Raises PathError on invalid input.
    """
    if not isinstance(path, str):
        raise PathError("Path must be a string")
    if len(path) > 4096:
        raise PathError("Path too long (max 4096 characters)")

    normalized = normalize_path(path)

    # Check for invalid characters in path components
    for component in normalized.split("/"):
        if not component:
            continue
        if component.startswith(".") and component != "." and component != "..":
            # Allow dotfiles like .gitignore
            pass
        # Block control characters and null bytes
        if re.search(r'[\x00-\x1f\x7f]', component):
            raise PathError(f"Path component contains control characters: {component!r}")
        if len(component) > 255:
            raise PathError(f"Path component too long (max 255): {component}")

    return normalized


def join_path(base: str, *parts: str) -> str:
    """Join path components and normalize."""
    combined = base
    for part in parts:
        if part.startswith("/"):
            combined = part
        else:
            combined = combined.rstrip("/") + "/" + part
    return normalize_path(combined)


def parent_path(path: str) -> str:
    """Get parent directory of a path."""
    normalized = normalize_path(path)
    if normalized == "/":
        return "/"
    return normalize_path("/".join(normalized.split("/")[:-1]) or "/")


def split_path(path: str) -> tuple:
    """Split path into (parent, name)."""
    normalized = normalize_path(path)
    if normalized == "/":
        return ("/", "")
    parts = normalized.rsplit("/", 1)
    parent = parts[0] if parts[0] else "/"
    name = parts[1]
    return (parent, name)


class DirectoryResolver:
    """
    Resolves directory hierarchy from flat git_files table.
    
    The git system stores files as flat paths (e.g., "src/main.py").
    This layer infers the directory structure and provides ls/tree/find/stat.
    """

    def __init__(self, db_path: str = "messages.db"):
        self.db_path = db_path

    def _get_db(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _get_repo_id(self, conn, repo_name: str) -> str:
        """Look up repo ID by name, raise PathError if not found."""
        row = conn.execute("SELECT id FROM git_repos WHERE name = ?", (repo_name,)).fetchone()
        if not row:
            raise PathError(f"Repository not found: {repo_name}")
        return row["id"]

    def _get_file_tree(self, conn, repo_id: str, branch: str = "main") -> dict:
        """
        Build the current file map for a branch.
        Returns {path: {content, sha256, size, action, commit_id}}
        """
        commits = conn.execute(
            "SELECT id FROM git_commits WHERE repo_id = ? AND branch = ? ORDER BY created_at DESC",
            (repo_id, branch)
        ).fetchall()

        file_map = {}
        for c in commits:
            files = conn.execute("SELECT * FROM git_files WHERE commit_id = ?", (c["id"],)).fetchall()
            for f in files:
                if f["path"] not in file_map:
                    file_map[f["path"]] = {
                        "path": f["path"],
                        "sha256": f["sha256"],
                        "size": f["size"],
                        "action": f["action"],
                        "commit_id": c["id"]
                    }

        # Filter deleted files
        return {k: v for k, v in file_map.items() if v["action"] != "delete"}

    def _ensure_leading_slash(self, path: str) -> str:
        """Git files are stored without leading slash. Normalize for comparison."""
        return "/" + path.lstrip("/") if path else "/"

    def _strip_leading_slash(self, path: str) -> str:
        """Convert normalized path back to git storage format."""
        return path.lstrip("/")

    def ls(self, repo_name: str, path: str = "/", branch: str = "main") -> list:
        """
        List contents of a directory.
        Returns list of PathInfo for immediate children (files and subdirectories).
        """
        target = validate_path(path)
        conn = self._get_db()
        try:
            repo_id = self._get_repo_id(conn, repo_name)
            file_map = self._get_file_tree(conn, repo_id, branch)
        finally:
            conn.close()

        # Collect directory entries
        entries = {}  # name -> PathInfo
        prefix = "" if target == "/" else self._strip_leading_slash(target) + "/"

        for file_path, info in file_map.items():
            # Check if file is under the target directory
            if target == "/":
                rel = file_path
            elif file_path.startswith(prefix):
                rel = file_path[len(prefix):]
            else:
                continue

            if not rel:
                continue

            parts = rel.split("/", 1)
            name = parts[0]

            if len(parts) == 1:
                # Direct child file
                entries[name] = PathInfo(
                    path=self._ensure_leading_slash(file_path),
                    name=name,
                    kind="file",
                    size=info["size"],
                    sha256=info["sha256"],
                    commit_id=info["commit_id"]
                )
            else:
                # Subdirectory (inferred from deeper path)
                if name not in entries or entries[name].kind != "dir":
                    dir_path = (prefix + name) if prefix else name
                    entries[name] = PathInfo(
                        path=self._ensure_leading_slash(dir_path),
                        name=name,
                        kind="dir",
                        children_count=0
                    )
                entries[name].children_count += 1

        # Sort: directories first, then alphabetically
        result = sorted(entries.values(), key=lambda e: (0 if e.kind == "dir" else 1, e.name))
        return [asdict(e) for e in result]

    def tree(self, repo_name: str, path: str = "/", branch: str = "main", depth: int = -1) -> dict:
        """
        Recursive directory tree.
        Returns nested structure with children.
        depth=-1 means unlimited, depth=0 means just the root, depth=1 means one level, etc.
        """
        target = validate_path(path)
        conn = self._get_db()
        try:
            repo_id = self._get_repo_id(conn, repo_name)
            file_map = self._get_file_tree(conn, repo_id, branch)
        finally:
            conn.close()

        def build_tree(dir_path: str, current_depth: int) -> dict:
            prefix = "" if dir_path == "/" else self._strip_leading_slash(dir_path) + "/"
            node = {
                "path": dir_path,
                "name": split_path(dir_path)[1] or "/",
                "kind": "dir",
                "children": []
            }

            if depth != -1 and current_depth >= depth:
                return node

            # Gather immediate children
            child_dirs = set()
            child_files = []

            for file_path, info in file_map.items():
                if dir_path == "/":
                    rel = file_path
                elif file_path.startswith(prefix):
                    rel = file_path[len(prefix):]
                else:
                    continue

                if not rel:
                    continue

                parts = rel.split("/", 1)
                name = parts[0]

                if len(parts) == 1:
                    child_files.append({
                        "path": self._ensure_leading_slash(file_path),
                        "name": name,
                        "kind": "file",
                        "size": info["size"],
                        "sha256": info["sha256"]
                    })
                else:
                    child_dirs.add(name)

            # Add subdirectories (recursively)
            for dname in sorted(child_dirs):
                child_path = join_path(dir_path, dname)
                node["children"].append(build_tree(child_path, current_depth + 1))

            # Add files
            for f in sorted(child_files, key=lambda x: x["name"]):
                node["children"].append(f)

            return node

        return build_tree(target, 0)

    def find(self, repo_name: str, pattern: str, path: str = "/",
             branch: str = "main", max_results: int = 100) -> list:
        """
        Find files matching a glob pattern.
        Pattern is matched against the filename (not full path) by default.
        Prefix pattern with '/' to match against full path.
        """
        target = validate_path(path)
        conn = self._get_db()
        try:
            repo_id = self._get_repo_id(conn, repo_name)
            file_map = self._get_file_tree(conn, repo_id, branch)
        finally:
            conn.close()

        results = []
        match_full_path = pattern.startswith("/") or "/" in pattern
        prefix = "" if target == "/" else self._strip_leading_slash(target) + "/"

        for file_path, info in file_map.items():
            # Scope to target directory
            if target != "/" and not file_path.startswith(prefix):
                continue

            if match_full_path:
                match_against = self._ensure_leading_slash(file_path)
            else:
                match_against = file_path.rsplit("/", 1)[-1]

            if fnmatch.fnmatch(match_against, pattern):
                results.append({
                    "path": self._ensure_leading_slash(file_path),
                    "name": file_path.rsplit("/", 1)[-1],
                    "size": info["size"],
                    "sha256": info["sha256"],
                    "commit_id": info["commit_id"]
                })
                if len(results) >= max_results:
                    break

        return sorted(results, key=lambda x: x["path"])

    def stat(self, repo_name: str, path: str, branch: str = "main") -> dict:
        """
        Get info about a path (file or directory).
        Returns PathInfo-like dict with extra metadata.
        """
        target = validate_path(path)
        conn = self._get_db()
        try:
            repo_id = self._get_repo_id(conn, repo_name)
            file_map = self._get_file_tree(conn, repo_id, branch)
        finally:
            conn.close()

        # Check if it's an exact file
        stripped = self._strip_leading_slash(target)
        if stripped in file_map:
            info = file_map[stripped]
            return {
                "path": target,
                "name": split_path(target)[1],
                "kind": "file",
                "size": info["size"],
                "sha256": info["sha256"],
                "commit_id": info["commit_id"],
                "exists": True
            }

        # Check if it's a virtual directory
        prefix = stripped + "/" if stripped else ""
        child_count = 0
        total_size = 0
        for file_path, info in file_map.items():
            if target == "/" or file_path.startswith(prefix):
                child_count += 1
                total_size += info["size"]

        if child_count > 0:
            return {
                "path": target,
                "name": split_path(target)[1] or "/",
                "kind": "dir",
                "total_files": child_count,
                "total_size": total_size,
                "exists": True
            }

        return {
            "path": target,
            "exists": False
        }

    def mkdir(self, repo_name: str, path: str, branch: str = "main",
              agent_name: str = "system") -> dict:
        """
        Create a directory by committing a .gitkeep marker file.
        This is needed because git (and our storage) can't track empty dirs.
        """
        target = validate_path(path)
        if target == "/":
            raise PathError("Cannot create root directory")

        conn = self._get_db()
        try:
            repo_id = self._get_repo_id(conn, repo_name)

            # Check if directory already has files
            file_map = self._get_file_tree(conn, repo_id, branch)
            stripped = self._strip_leading_slash(target)
            prefix = stripped + "/"
            for file_path in file_map:
                if file_path.startswith(prefix):
                    return {"ok": True, "path": target, "note": "Directory already exists (has files)"}

            # Create .gitkeep marker
            gitkeep_path = stripped + "/.gitkeep"
            if gitkeep_path in file_map:
                return {"ok": True, "path": target, "note": "Directory already exists"}

            # Commit the .gitkeep
            branch_row = conn.execute(
                "SELECT * FROM git_branches WHERE repo_id = ? AND name = ?",
                (repo_id, branch)
            ).fetchone()

            if not branch_row:
                conn.execute(
                    "INSERT INTO git_branches (repo_id, name, head_commit) VALUES (?,?,?)",
                    (repo_id, branch, None)
                )
                parent_id = None
            else:
                parent_id = branch_row["head_commit"]

            cid = str(uuid.uuid4())
            conn.execute(
                "INSERT INTO git_commits (id, repo_id, branch, author, message, created_at, parent_id) VALUES (?,?,?,?,?,?,?)",
                (cid, repo_id, branch, agent_name, f"mkdir {target}", time.time(), parent_id)
            )

            import hashlib
            content = ""
            sha = hashlib.sha256(content.encode()).hexdigest()
            fid = str(uuid.uuid4())
            conn.execute(
                "INSERT INTO git_files (id, commit_id, path, content, sha256, size, action) VALUES (?,?,?,?,?,?,?)",
                (fid, cid, gitkeep_path, content, sha, 0, "add")
            )

            conn.execute(
                "UPDATE git_branches SET head_commit = ? WHERE repo_id = ? AND name = ?",
                (cid, repo_id, branch)
            )

            conn.commit()
            return {"ok": True, "path": target, "commit_id": cid}
        finally:
            conn.close()


class AgentSession:
    """
    Tracks an agent's current working directory within a repo.
    Provides cd/pwd semantics for stateful navigation.
    """

    def __init__(self, resolver: DirectoryResolver, repo_name: str, branch: str = "main"):
        self.resolver = resolver
        self.repo_name = repo_name
        self.branch = branch
        self.cwd = "/"

    def pwd(self) -> str:
        """Return current working directory."""
        return self.cwd

    def cd(self, path: str) -> str:
        """
        Change directory. Supports:
        - Absolute paths: /src/lib
        - Relative paths: ../tests
        - Home: / (just slash)
        """
        if path.startswith("/"):
            target = validate_path(path)
        else:
            target = validate_path(join_path(self.cwd, path))

        # Verify directory exists
        info = self.resolver.stat(self.repo_name, target, self.branch)
        if not info.get("exists"):
            raise PathError(f"No such directory: {target}")
        if info.get("kind") == "file":
            raise PathError(f"Not a directory: {target}")

        self.cwd = target
        return self.cwd

    def ls(self, path: str = ".") -> list:
        """List contents relative to cwd."""
        if path == ".":
            target = self.cwd
        elif path.startswith("/"):
            target = path
        else:
            target = join_path(self.cwd, path)
        return self.resolver.ls(self.repo_name, target, self.branch)

    def find(self, pattern: str, path: str = ".") -> list:
        """Find files relative to cwd."""
        if path == ".":
            target = self.cwd
        elif path.startswith("/"):
            target = path
        else:
            target = join_path(self.cwd, path)
        return self.resolver.find(self.repo_name, pattern, target, self.branch)


# ── FastAPI route integration ──────────────────────────────────
# These functions return FastAPI route handlers.
# Import and call register_directory_routes(app) from main.py.

def register_directory_routes(app, db_path: str = None):
    """Register directory layer API endpoints on a FastAPI app."""
    from fastapi import HTTPException, Depends, Query
    from pydantic import BaseModel

    if db_path is None:
        db_path = os.path.join(os.path.dirname(__file__), "messages.db")

    resolver = DirectoryResolver(db_path=db_path)

    class MkdirRequest(BaseModel):
        path: str
        branch: str = "main"

    @app.get("/git/repos/{repo_name}/ls")
    def api_ls(repo_name: str, path: str = "/", branch: str = "main"):
        try:
            entries = resolver.ls(repo_name, path, branch)
            return {"path": validate_path(path), "branch": branch, "entries": entries, "count": len(entries)}
        except PathError as e:
            raise HTTPException(400, str(e))

    @app.get("/git/repos/{repo_name}/dir/tree")
    def api_dir_tree(repo_name: str, path: str = "/", branch: str = "main", depth: int = -1):
        try:
            tree = resolver.tree(repo_name, path, branch, depth)
            return {"branch": branch, "tree": tree}
        except PathError as e:
            raise HTTPException(400, str(e))

    @app.get("/git/repos/{repo_name}/find")
    def api_find(repo_name: str, pattern: str, path: str = "/",
                 branch: str = "main", max_results: int = 100):
        try:
            matches = resolver.find(repo_name, pattern, path, branch, max_results)
            return {"pattern": pattern, "path": validate_path(path), "branch": branch,
                    "matches": matches, "count": len(matches)}
        except PathError as e:
            raise HTTPException(400, str(e))

    @app.get("/git/repos/{repo_name}/stat")
    def api_stat(repo_name: str, path: str = "/", branch: str = "main"):
        try:
            info = resolver.stat(repo_name, path, branch)
            return info
        except PathError as e:
            raise HTTPException(400, str(e))

    @app.post("/git/repos/{repo_name}/mkdir")
    def api_mkdir(repo_name: str, body: MkdirRequest,
                  agent_id: str = Depends(app.dependency_overrides.get("get_agent_id", lambda: "system"))):
        try:
            result = resolver.mkdir(repo_name, body.path, body.branch, agent_id)
            return result
        except PathError as e:
            raise HTTPException(400, str(e))

    return resolver


# ── CLI usage ──────────────────────────────────────────────────

if __name__ == "__main__":
    import sys
    import json

    db_path = os.path.join(os.path.dirname(__file__), "messages.db")
    resolver = DirectoryResolver(db_path=db_path)

    if len(sys.argv) < 3:
        print("Usage: python directory_layer.py <command> <repo> [args...]")
        print("Commands: ls, tree, find, stat, mkdir")
        print("Examples:")
        print("  python directory_layer.py ls my-repo /src")
        print("  python directory_layer.py tree my-repo / --depth 2")
        print("  python directory_layer.py find my-repo '*.py'")
        print("  python directory_layer.py stat my-repo /src/main.py")
        print("  python directory_layer.py mkdir my-repo /src/new_dir")
        sys.exit(1)

    cmd = sys.argv[1]
    repo = sys.argv[2]
    args = sys.argv[3:]

    try:
        if cmd == "ls":
            path = args[0] if args else "/"
            branch = args[1] if len(args) > 1 else "main"
            result = resolver.ls(repo, path, branch)
            for entry in result:
                kind_icon = "📁" if entry["kind"] == "dir" else "📄"
                size_str = f" ({entry['size']}B)" if entry["kind"] == "file" else f" ({entry['children_count']} items)"
                print(f"  {kind_icon} {entry['name']}{size_str}")

        elif cmd == "tree":
            path = args[0] if args else "/"
            depth = -1
            branch = "main"
            for i, a in enumerate(args):
                if a == "--depth" and i + 1 < len(args):
                    depth = int(args[i + 1])
                if a == "--branch" and i + 1 < len(args):
                    branch = args[i + 1]
            result = resolver.tree(repo, path, branch, depth)
            print(json.dumps(result, indent=2))

        elif cmd == "find":
            pattern = args[0] if args else "*"
            path = args[1] if len(args) > 1 else "/"
            result = resolver.find(repo, pattern, path)
            for match in result:
                print(f"  {match['path']} ({match['size']}B)")

        elif cmd == "stat":
            path = args[0] if args else "/"
            result = resolver.stat(repo, path)
            print(json.dumps(result, indent=2))

        elif cmd == "mkdir":
            path = args[0]
            branch = args[1] if len(args) > 1 else "main"
            result = resolver.mkdir(repo, path, branch)
            print(json.dumps(result, indent=2))

        else:
            print(f"Unknown command: {cmd}")
            sys.exit(1)

    except PathError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
