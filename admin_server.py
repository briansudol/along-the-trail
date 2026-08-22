#!/usr/bin/env python3
"""
Local server for the mushroom atlas with admin photo-save API,
community upload inbox, and newsletter persistence.

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
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parent
CONFIG_PATH = ROOT / "admin_config.json"
CATALOG_PATH = ROOT / "data" / "mushrooms.json"
MAP_PATH = ROOT / "data" / "map-finds.json"
PHOTOS_DIR = ROOT / "photos"
COMMUNITY_PUBLIC = ROOT / "data" / "community.json"
COMMUNITY_STORE = ROOT / "data" / "community-store.json"
NEWSLETTER_JSON = ROOT / "data" / "newsletter.json"
PENDING_DIR = ROOT / "uploads" / "community"
APPROVED_DIR = ROOT / "photos" / "community"
MAX_IMAGE_BYTES = 6 * 1024 * 1024
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
ID_RE = re.compile(r"^c-[A-Za-z0-9_-]{6,80}$")

# In-memory session tokens
_tokens: set[str] = set()
_lock = threading.Lock()
_rate: dict[tuple[str, str], list[float]] = {}


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


def rate_ok(ip: str, bucket: str, limit: int, window: float = 3600) -> bool:
    now = time.time()
    key = (ip, bucket)
    with _lock:
        times = [t for t in _rate.get(key, []) if now - t < window]
        if len(times) >= limit:
            _rate[key] = times
            return False
        times.append(now)
        _rate[key] = times
        return True


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


def parse_data_url(data_url: str) -> tuple[bytes, str]:
    m = re.match(r"^data:image/([a-zA-Z0-9+.-]+);base64,(.+)$", data_url, re.DOTALL)
    if not m:
        raise ValueError("Expected a data:image/...;base64,... URL")
    kind = m.group(1).lower().split("+")[0]
    if kind == "jpg":
        kind = "jpeg"
    if kind not in ("jpeg", "png", "webp", "gif"):
        raise ValueError("Unsupported image type")
    raw = base64.b64decode(m.group(2))
    ext = {"jpeg": ".jpg", "png": ".png", "webp": ".webp", "gif": ".gif"}[kind]
    return raw, ext


def sanitize_text(value: object, limit: int) -> str:
    text = str(value or "").replace("\x00", "").strip()
    return text[:limit]


def new_community_id() -> str:
    return "c-" + time.strftime("%Y%m%d-%H%M%S") + "-" + secrets.token_hex(3)


def read_store(path: Path, default):
    with _lock:
        if not path.exists():
            return json.loads(json.dumps(default))
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return json.loads(json.dumps(default))


def write_store(path: Path, obj) -> None:
    with _lock:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text(json.dumps(obj, indent=2) + "\n", encoding="utf-8")
        tmp.replace(path)


def community_store() -> dict:
    data = read_store(COMMUNITY_STORE, None)
    if not isinstance(data, dict) or not isinstance(data.get("uploads"), list):
        public = read_store(COMMUNITY_PUBLIC, {"uploads": []})
        uploads = public.get("uploads") if isinstance(public, dict) else []
        data = {"uploads": uploads if isinstance(uploads, list) else []}
    return data


def write_community_store(store: dict) -> None:
    write_store(COMMUNITY_STORE, store)
    approved = [u for u in store.get("uploads") or [] if u.get("status") == "approved"]
    write_store(COMMUNITY_PUBLIC, {"uploads": approved})


def newsletter_store() -> dict:
    data = read_store(NEWSLETTER_JSON, {"signups": []})
    if not isinstance(data, dict) or not isinstance(data.get("signups"), list):
        return {"signups": []}
    return data


def finite_coord(value, limit: float) -> float | None:
    try:
        if value is None or value == "":
            return None
        n = float(value)
        if n != n or abs(n) > limit:
            return None
        return n
    except (TypeError, ValueError):
        return None


def save_community_upload(payload: dict) -> dict:
    location = sanitize_text(payload.get("location"), 200)
    notes = sanitize_text(payload.get("notes"), 1000)
    incoming = payload.get("entry") if isinstance(payload.get("entry"), dict) else {}
    if not location:
        location = sanitize_text(incoming.get("location"), 200)
    if not notes:
        notes = sanitize_text(incoming.get("notes"), 1000)
    if not location:
        raise ValueError("Location is required")

    image = payload.get("image") or ""
    if not image:
        photos = incoming.get("photos") or []
        if photos and isinstance(photos[0], dict):
            image = photos[0].get("src") or ""
    raw, ext = parse_data_url(str(image))
    if len(raw) > MAX_IMAGE_BYTES:
        raise ValueError("Image too large (max 6 MB)")

    cid = sanitize_text(payload.get("id") or incoming.get("id"), 80)
    if not ID_RE.match(cid):
        cid = new_community_id()

    PENDING_DIR.mkdir(parents=True, exist_ok=True)
    rel = f"uploads/community/{cid}{ext}"
    (ROOT / rel).write_bytes(raw)

    lat = finite_coord(payload.get("lat"), 90)
    lon = finite_coord(payload.get("lon"), 180)
    if lat is None and isinstance(incoming.get("gps"), dict):
        lat = finite_coord(incoming["gps"].get("lat"), 90)
        lon = finite_coord(incoming["gps"].get("lon"), 180)

    entry = {
        "id": cid,
        "status": "pending",
        "source": "community",
        "pending_id": True,
        "common_name": "Unidentified find",
        "scientific_name": "Pending identification",
        "category": "Pending ID",
        "category_slug": "other",
        "edibility": "Unknown — do not eat",
        "confidence": "pending",
        "summary": "Awaiting identification." + (f" Note: {notes}" if notes else ""),
        "uses": "Not assessed until identified.",
        "habitat": notes or "See photo and location.",
        "tree_associates": "Not yet determined.",
        "field_marks": "See photo.",
        "season": "Not specified",
        "region_notes": location,
        "location": location,
        "notes": notes,
        "photos": [
            {
                "src": rel,
                "caption": "Pending ID",
                "view": "top",
                "location": location,
                "lat": lat,
                "lon": lon,
            }
        ],
        "contributor": "Community",
        "uploaded_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    if lat is not None and lon is not None:
        entry["gps"] = {"lat": lat, "lon": lon}
        entry["location_source"] = "exif_gps"

    store = community_store()
    store["uploads"] = [u for u in store.get("uploads") or [] if u.get("id") != cid]
    store["uploads"].insert(0, entry)
    write_community_store(store)
    return entry


def moderate_community(cid: str, action: str, extra: dict) -> dict:
    store = community_store()
    found = None
    for item in store.get("uploads") or []:
        if item.get("id") == cid:
            found = item
            break
    if not found:
        raise KeyError(f"Upload not found: {cid}")

    action = (action or "").strip().lower()
    if action == "reject":
        found["status"] = "rejected"
    elif action == "approve":
        found["status"] = "approved"
        APPROVED_DIR.mkdir(parents=True, exist_ok=True)
        for photo in found.get("photos") or []:
            src = str(photo.get("src") or "")
            if src.startswith("uploads/community/"):
                src_path = (ROOT / src).resolve()
                try:
                    src_path.relative_to(PENDING_DIR.resolve())
                except ValueError:
                    continue
                if src_path.exists():
                    dest = APPROVED_DIR / src_path.name
                    dest.write_bytes(src_path.read_bytes())
                    photo["src"] = f"photos/community/{dest.name}"
        name = sanitize_text(extra.get("common_name"), 120)
        sci = sanitize_text(extra.get("scientific_name"), 160)
        if name:
            found["common_name"] = name
            found["pending_id"] = False
            found["confidence"] = "reviewed"
            found["category"] = "Community"
            if sci:
                found["scientific_name"] = sci
        found["approved_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    else:
        raise ValueError("action must be approve or reject")

    write_community_store(store)
    return found


def save_newsletter(email: str) -> dict:
    email = sanitize_text(email, 200).lower()
    if not EMAIL_RE.match(email):
        raise ValueError("Please enter a valid email address.")
    store = newsletter_store()
    existing = {str(s.get("email") or "").lower() for s in store.get("signups") or [] if isinstance(s, dict)}
    duplicate = email in existing
    if not duplicate:
        store["signups"].insert(
            0,
            {
                "email": email,
                "consented_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "source": "site",
            },
        )
        write_store(NEWSLETTER_JSON, store)
    return {"ok": True, "duplicate": duplicate}


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
        if length > MAX_IMAGE_BYTES + 512_000:
            raise ValueError("Payload too large")
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
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _auth(self, data: dict) -> str | None:
        token = data.get("token") or self.headers.get("X-Admin-Token")
        if check_token(token):
            return token
        return None

    def _ip(self) -> str:
        return self.client_address[0] if self.client_address else "unknown"

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
            return self._send_json({"ok": True, "admin": True, "persist": True})
        if parsed.path == "/api/community":
            store = community_store()
            approved = [u for u in store.get("uploads") or [] if u.get("status") == "approved"]
            return self._send_json({"uploads": approved, "persist": True})
        if parsed.path == "/api/community-inbox":
            token = self.headers.get("X-Admin-Token")
            if not check_token(token):
                return self._send_json({"error": "Unauthorized"}, 401)
            store = community_store()
            inbox = [
                u
                for u in store.get("uploads") or []
                if u.get("status") in ("pending", "rejected")
            ]
            return self._send_json({"uploads": inbox})
        if parsed.path == "/api/newsletter":
            token = self.headers.get("X-Admin-Token")
            if not check_token(token):
                return self._send_json({"error": "Unauthorized"}, 401)
            return self._send_json(newsletter_store())
        return super().do_GET()

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path

        try:
            data = self._read_json()
        except ValueError as e:
            return self._send_json({"error": str(e)}, 400)
        except Exception:
            return self._send_json({"error": "Invalid JSON"}, 400)

        if path == "/api/newsletter":
            if not rate_ok(self._ip(), "newsletter", 10):
                return self._send_json({"error": "Too many signups from this address. Try later."}, 429)
            try:
                return self._send_json(save_newsletter(str(data.get("email") or "")))
            except ValueError as e:
                return self._send_json({"error": str(e)}, 400)

        if path == "/api/community":
            if not rate_ok(self._ip(), "community", 20):
                return self._send_json({"error": "Too many uploads from this address. Try later."}, 429)
            try:
                entry = save_community_upload(data)
            except ValueError as e:
                return self._send_json({"error": str(e)}, 400)
            except Exception as e:
                return self._send_json({"error": str(e)}, 400)
            return self._send_json({"ok": True, "entry": entry})

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

        if path == "/api/community-moderate":
            try:
                entry = moderate_community(
                    str(data.get("id") or ""),
                    str(data.get("action") or ""),
                    data,
                )
            except KeyError as e:
                return self._send_json({"error": str(e)}, 404)
            except ValueError as e:
                return self._send_json({"error": str(e)}, 400)
            return self._send_json({"ok": True, "entry": entry})

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
    print("Mushroom atlas + admin API + community persist")
    print(f"  Open  http://127.0.0.1:{port}/")
    print("  Admin password: (see admin_config.json)")
    print(f"  Serving {ROOT}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
