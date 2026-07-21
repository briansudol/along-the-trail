#!/usr/bin/env python3
"""
Local server for the mushroom atlas with admin photo-save API.

  python3 admin_server.py
  → http://localhost:8877

Default admin password is in admin_config.json (change it).
"""

from __future__ import annotations

import base64
import hashlib
import json
import mimetypes
import re
import secrets
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parent
CONFIG_PATH = ROOT / "admin_config.json"
CATALOG_PATH = ROOT / "data" / "mushrooms.json"
MAP_PATH = ROOT / "data" / "map-finds.json"
PHOTOS_DIR = ROOT / "photos"

# In-memory session tokens
_tokens: set[str] = set()
_lock = threading.Lock()


def load_password() -> str:
    if CONFIG_PATH.exists():
        cfg = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        return str(cfg.get("password") or "sourlands")
    return "sourlands"


def check_token(token: str | None) -> bool:
    if not token:
        return False
    with _lock:
        return token in _tokens


def issue_token() -> str:
    tok = secrets.token_urlsafe(32)
    with _lock:
        _tokens.add(tok)
    return tok


def revoke_token(token: str) -> None:
    with _lock:
        _tokens.discard(token)


def safe_photo_path(rel: str) -> Path | None:
    """Resolve a photos/… path under PHOTOS_DIR only."""
    rel = unquote(rel).replace("\\", "/").lstrip("/")
    if not rel.startswith("photos/"):
        return None
    if ".." in rel.split("/"):
        return None
    path = (ROOT / rel).resolve()
    try:
        path.relative_to(PHOTOS_DIR.resolve())
    except ValueError:
        return None
    return path


def decode_data_url(data_url: str) -> bytes:
    m = re.match(r"^data:image/([a-zA-Z0-9+.-]+);base64,(.+)$", data_url, re.DOTALL)
    if not m:
        raise ValueError("Expected a data:image/...;base64,... URL")
    return base64.b64decode(m.group(2))


def update_cover(group_id: str, photo_src: str) -> None:
    data = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    found = False
    for g in data.get("groups", []):
        if g.get("id") == group_id:
            g["cover_image"] = photo_src
            # move cover photo to front
            photos = g.get("photos") or []
            photos = sorted(photos, key=lambda p: 0 if p.get("src") == photo_src else 1)
            g["photos"] = photos
            found = True
            break
    if not found:
        for w in data.get("wildlife", []):
            if w.get("id") == group_id:
                w["cover_image"] = photo_src
                found = True
                break
    if not found:
        raise KeyError(f"Group not found: {group_id}")
    CATALOG_PATH.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")

    # Map thumbs stay as-is (paths unchanged on save)


def list_photos() -> list[dict]:
    data = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    items: list[dict] = []
    for g in data.get("groups", []):
        for i, p in enumerate(g.get("photos") or []):
            items.append(
                {
                    "group_id": g.get("id"),
                    "group_name": g.get("common_name"),
                    "photo_index": i,
                    "src": p.get("src"),
                    "caption": p.get("caption") or "",
                    "view": p.get("view") or "top",
                    "is_cover": p.get("src") == g.get("cover_image"),
                    "id_detail": p.get("id_detail") or {},
                    "section": "mushrooms",
                }
            )
    for w in data.get("wildlife", []):
        for i, p in enumerate(w.get("photos") or []):
            items.append(
                {
                    "group_id": w.get("id"),
                    "group_name": w.get("common_name"),
                    "photo_index": i,
                    "src": p.get("src"),
                    "caption": p.get("caption") or "",
                    "view": p.get("view") or "top",
                    "is_cover": p.get("src") == w.get("cover_image") or i == 0,
                    "id_detail": p.get("id_detail") or {},
                    "section": "wildlife",
                }
            )
    return items


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt: str, *args) -> None:
        # Quieter logs
        if args and str(args[0]).startswith('"GET /api'):
            super().log_message(fmt, *args)
        elif args and "POST /api" in str(args[0]):
            super().log_message(fmt, *args)

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        if not raw:
            return {}
        return json.loads(raw.decode("utf-8"))

    def _send_json(self, obj: dict, status: int = 200) -> None:
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _auth(self, data: dict) -> str | None:
        token = data.get("token") or self.headers.get("X-Admin-Token")
        if check_token(token):
            return token
        return None

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Admin-Token")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path == "/api/photos":
            token = self.headers.get("X-Admin-Token")
            if not check_token(token):
                return self._send_json({"error": "Unauthorized"}, 401)
            return self._send_json({"photos": list_photos()})
        if parsed.path == "/api/health":
            return self._send_json({"ok": True, "admin": True})
        return super().do_GET()

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path

        try:
            data = self._read_json()
        except Exception:
            return self._send_json({"error": "Invalid JSON"}, 400)

        if path == "/api/login":
            pw = str(data.get("password") or "")
            if secrets.compare_digest(pw, load_password()):
                token = issue_token()
                return self._send_json({"ok": True, "token": token})
            return self._send_json({"error": "Invalid password"}, 401)

        if path == "/api/logout":
            tok = data.get("token")
            if tok:
                revoke_token(str(tok))
            return self._send_json({"ok": True})

        if not self._auth(data):
            return self._send_json({"error": "Unauthorized — log in as admin"}, 401)

        if path == "/api/save-image":
            rel = str(data.get("path") or "")
            target = safe_photo_path(rel)
            if not target:
                return self._send_json({"error": "Invalid photo path"}, 400)
            try:
                raw = decode_data_url(str(data.get("image") or ""))
            except Exception as e:
                return self._send_json({"error": str(e)}, 400)
            # Keep .jpg extension; write bytes
            target.parent.mkdir(parents=True, exist_ok=True)
            # Backup original once
            bak = target.with_suffix(target.suffix + ".bak")
            if target.exists() and not bak.exists():
                bak.write_bytes(target.read_bytes())
            target.write_bytes(raw)
            # Cache-bust: touch catalog mtime so clients can re-fetch if needed
            if CATALOG_PATH.exists():
                CATALOG_PATH.write_text(CATALOG_PATH.read_text(encoding="utf-8"), encoding="utf-8")
            return self._send_json(
                {
                    "ok": True,
                    "path": rel,
                    "bytes": len(raw),
                    "cache_bust": hashlib.md5(raw[:4096]).hexdigest()[:10],
                }
            )

        if path == "/api/set-cover":
            group_id = str(data.get("group_id") or "")
            photo_src = str(data.get("path") or "")
            if not group_id or not photo_src:
                return self._send_json({"error": "group_id and path required"}, 400)
            try:
                update_cover(group_id, photo_src)
            except KeyError as e:
                return self._send_json({"error": str(e)}, 404)
            return self._send_json({"ok": True, "group_id": group_id, "path": photo_src})

        return self._send_json({"error": "Not found"}, 404)


def main() -> None:
    port = 8877
    httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"Mushroom atlas + admin API")
    print(f"  Open  http://127.0.0.1:{port}/")
    print(f"  Admin password: (see admin_config.json)")
    print(f"  Serving {ROOT}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
