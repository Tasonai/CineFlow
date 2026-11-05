# CineFlow Fix Log (`docs/FIXLOG.md`)

Persistent engineering fix log recording symptoms, root causes, fixes, and standing rules.

---

## 2026-11-05 — S-001: Unconditional `[CineFlow-DEBUG]` logging on every `/api/hdrezka/streams` request

- **Symptom:** Every call to `/api/hdrezka/streams` emitted two raw `[CineFlow-DEBUG] streams req:...` and `[CineFlow-DEBUG] streams resp:...` lines to stdout and `data/cineflow.log` / `data/cineflow-macos.log` even in normal production mode (`CINEFLOW_VERBOSE_LOG=0`).
- **Cause:** `handle_hdrezka_streams` in `backend/routes/streams.py` invoked `ctx.safe_log("[CineFlow-DEBUG]...")` unconditionally without checking `ctx.verbose_log`.
- **Fix:** Added `@property def verbose_log(self) -> bool` on `ServerContext` (`backend/routes/context.py`) backed by `_VERBOSE_LOG` / `CINEFLOW_VERBOSE_LOG`, and gated both `[CineFlow-DEBUG]` log statements in `backend/routes/streams.py` behind `if getattr(ctx, "verbose_log", False):`.
- **Rule:** Never emit `[CineFlow-DEBUG]` or high-frequency per-request diagnostic logs in route handlers without gating behind `getattr(ctx, "verbose_log", False)`.
