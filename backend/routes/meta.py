"""
Modular route handlers for Title & Person Metadata, Subtitles, Calendar and Providers:
- GET /api/trailer
- GET /api/person
- GET /api/person-photo
- GET /api/title-meta
- GET /api/provider-link
- GET /api/skip-intro
- GET /api/subtitles/search
- GET /api/subtitles/translate
- GET /api/calendar
"""

from __future__ import annotations

import re
import threading
import time
import urllib.parse
from typing import Any, Dict, List

from backend.hdrezka import HDRezkaClient


def handle_trailer(handler: Any, qs: Dict[str, Any], parsed: Any, ctx: Any) -> bool:
    item_id = qs.get("id", [""])[0].strip()
    rezka_id = qs.get("rezka_id", [""])[0].strip()
    title = qs.get("title", [""])[0].strip()
    orig_title = qs.get("orig_title", [""])[0].strip()
    year = ctx.qs_int(qs, "year", 0)
    media_type = qs.get("media_type", ["movie"])[0].strip() or "movie"
    req_lang = ctx.norm_app_lang(qs.get("lang", [ctx.app_prefs.get("app_lang", "ru")])[0], ctx.app_prefs.get("app_lang", "ru"))
    if ctx.profile_manager.is_kids_mode_active():
        cand_item = ctx.build_trusted_item_for_kids_check(
            item_id=item_id,
            title=title,
            orig_title=orig_title,
            media_type=media_type,
        )
        probe_tr = (
            cand_item
            if (cand_item.get("genres") or cand_item.get("description") or cand_item.get("age_rating"))
            else {**cand_item, "genres": ["семейный"]}
        )
        if not (cand_item.get("title") or cand_item.get("orig_title") or cand_item.get("genres")) or not ctx.profile_manager.is_item_kids_safe(probe_tr):
            handler._send_json(
                {"ok": False, "error": ctx.msg("Контент недоступен в детском профиле", "Content restricted in Kids Mode", req_lang)},
                status=403,
            )
            return True
    rezka_url = qs.get("rezka_url", [""])[0].strip()
    data = ctx.rezka_client.get_trailer_for_title(
        item_id=item_id,
        rezka_id=rezka_id,
        title=title,
        orig_title=orig_title,
        year=year,
        media_type=media_type,
        rezka_url=rezka_url,
    )
    handler._send_json(data)
    return True


def handle_person(handler: Any, qs: Dict[str, Any], parsed: Any, ctx: Any) -> bool:
    name = qs.get("name", [""])[0].strip()
    p_url = qs.get("url", [""])[0].strip()
    hint_title = qs.get("hint_title", [""])[0].strip()
    hint_orig = qs.get("hint_orig", [""])[0].strip()
    req_lang = ctx.norm_app_lang(qs.get("lang", [ctx.app_prefs.get("app_lang", "ru")])[0], ctx.app_prefs.get("app_lang", "ru"))
    person_payload = ctx.aggregator.get_person_profile(
        name=name,
        person_url=p_url,
        hint_title=hint_title,
        hint_orig=hint_orig,
        lang=req_lang,
    )
    if ctx.profile_manager.is_kids_mode_active() and isinstance(person_payload, dict):
        person_payload = dict(person_payload)
        safe_all = ctx.profile_manager.filter_items_for_kids(person_payload.get("all_items") or [])
        person_payload["all_items"] = safe_all
        raw_secs = person_payload.get("sections") or person_payload.get("roles") or []
        safe_secs = []
        for sec in raw_secs:
            if not isinstance(sec, dict):
                continue
            sec_items = ctx.profile_manager.filter_items_for_kids(sec.get("items") or [])
            if sec_items:
                sec_copy = dict(sec)
                sec_copy["items"] = sec_items
                sec_copy["count"] = len(sec_items)
                safe_secs.append(sec_copy)
        person_payload["sections"] = safe_secs
        person_payload["roles"] = safe_secs
        if isinstance(person_payload.get("stats"), dict):
            st_copy = dict(person_payload["stats"])
            total_c = len(safe_all)
            watched_c = sum(1 for it in safe_all if (it.get("kinorium") or {}).get("watched"))
            st_copy["total_count"] = total_c
            st_copy["watched_count"] = watched_c
            st_copy["watching_count"] = sum(1 for it in safe_all if (it.get("kinorium") or {}).get("watching"))
            st_copy["watchlist_count"] = sum(1 for it in safe_all if (it.get("kinorium") or {}).get("in_watchlist"))
            st_copy["watched_pct"] = int(round((watched_c / total_c) * 100)) if total_c > 0 else 0
            person_payload["stats"] = st_copy
    handler._send_json(person_payload)
    return True


def handle_person_photo(handler: Any, qs: Dict[str, Any], parsed: Any, ctx: Any) -> bool:
    name = qs.get("name", [""])[0].strip()
    hint_url = (qs.get("url", [""])[0] or qs.get("hint", [""])[0]).strip()
    cache_key = (hint_url or name.lower()).strip()
    cached_hit = None
    if cache_key:
        with ctx.person_photo_lock:
            cached_hit = ctx.person_photo_cache.get(cache_key)
    if cached_hit:
        cached_ctype, cached_bytes = cached_hit
        handler.send_response(200)
        handler.send_header("Content-Type", cached_ctype)
        handler.send_header("X-Content-Type-Options", "nosniff")
        handler.send_header("Content-Security-Policy", "sandbox; default-src 'none'")
        handler.send_header("Content-Length", str(len(cached_bytes)))
        handler.send_header("Cache-Control", "public, max-age=86400")
        handler.end_headers()
        handler.wfile.write(cached_bytes)
        return True

    candidate_urls = []
    if hint_url and ctx.is_allowed_media_source_url(hint_url, allow_torrserver_loopback=False):
        candidate_urls.append(hint_url)
    resolved_url = ctx.rezka_client.resolve_person_photo(name)
    if resolved_url and resolved_url not in candidate_urls:
        candidate_urls.append(resolved_url)

    proxy_cfg = getattr(ctx.rezka_client, "proxy_url", None)
    for p_url in candidate_urls:
        try:
            with ctx.open_safe_public_url(
                p_url,
                headers={
                    "User-Agent": ctx.net_client.default_ua,
                    "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
                },
                timeout=4.0,
                proxy_url=proxy_cfg,
            ) as resp:
                raw_img = resp.read(524288)
                sniff_ctype = ctx.sniff_raster_image_type(raw_img)
                if resp.status == 200 and raw_img and sniff_ctype:
                    out_ctype = sniff_ctype
                    if cache_key:
                        with ctx.person_photo_lock:
                            if len(ctx.person_photo_cache) > 350:
                                for k_old in list(ctx.person_photo_cache.keys())[:88]:
                                    ctx.person_photo_cache.pop(k_old, None)
                            ctx.person_photo_cache[cache_key] = (out_ctype, raw_img)
                    handler.send_response(200)
                    handler.send_header("Content-Type", out_ctype)
                    handler.send_header("X-Content-Type-Options", "nosniff")
                    handler.send_header("Content-Security-Policy", "sandbox; default-src 'none'")
                    handler.send_header("Content-Length", str(len(raw_img)))
                    handler.send_header("Cache-Control", "public, max-age=86400")
                    handler.end_headers()
                    handler.wfile.write(raw_img)
                    return True
        except Exception:
            continue

    parts = [w for w in name.split() if w]
    initials = "".join(w[0].upper() for w in parts[:2]) or "CF"
    safe_initials = (
        initials.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    )
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 160">'
        '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">'
        '<stop offset="0%" stop-color="#2c2c30"/><stop offset="100%" stop-color="#1c1c1f"/>'
        '</linearGradient></defs>'
        '<rect width="120" height="160" fill="url(#g)"/>'
        f'<text x="60" y="90" fill="#e5e5ea" font-family="-apple-system,sans-serif" '
        f'font-size="36" font-weight="600" text-anchor="middle">{safe_initials}</text></svg>'
    ).encode("utf-8")
    handler.send_response(200)
    handler.send_header("Content-Type", "image/svg+xml; charset=utf-8")
    handler.send_header("Content-Length", str(len(svg)))
    handler.send_header("Cache-Control", "public, max-age=86400")
    handler.end_headers()
    handler.wfile.write(svg)
    return True


def handle_title_meta(handler: Any, qs: Dict[str, Any], parsed: Any, ctx: Any) -> bool:
    item_id = qs.get("id", [""])[0].strip()
    kin_item_id = qs.get("item_id", [""])[0].strip() or item_id
    kin_kid = qs.get("kinorium_id", [""])[0].strip()
    if not kin_kid and kin_item_id.startswith("kin_") and kin_item_id[4:].isdigit():
        kin_kid = kin_item_id[4:]
    explicit_rezka_id = qs.get("rezka_id", [""])[0].strip()
    title = qs.get("title", [""])[0].strip()
    orig_title = qs.get("orig_title", [""])[0].strip()
    year = ctx.qs_int(qs, "year", 0)
    media_type = qs.get("media_type", ["movie"])[0].strip() or "movie"
    rezka_url = qs.get("rezka_url", [""])[0].strip() or None

    cached_live_m = None
    if media_type == "series" or (not qs.get("media_type") and (kin_kid or (kin_item_id or item_id).startswith("kin_"))):
        cached_live_m = ctx.kinorium_service.get_series_live_meta(
            item_id=kin_item_id or item_id, title=title, orig_title=orig_title, kid=kin_kid, year=year, media_type="series"
        )
    if cached_live_m and (media_type == "series" or not qs.get("media_type")):
        media_type = "series"
        if not explicit_rezka_id and cached_live_m.get("rezka_id"):
            explicit_rezka_id = str(cached_live_m["rezka_id"])
        if not rezka_url and cached_live_m.get("rezka_url"):
            rezka_url = cached_live_m["rezka_url"]

    if media_type != "series":
        if rezka_url and "/series/" in rezka_url.lower():
            media_type = "series"
        elif not qs.get("media_type"):
            st_peek = ctx.kinorium_service.get_item_status(
                kin_item_id or item_id, title=title, orig_title=orig_title
            )
            w_info = st_peek.get("watched_info")
            if isinstance(w_info, dict) and str(w_info.get("media_type") or "").lower() == "series":
                media_type = "series"
            elif st_peek.get("next_season") and int(st_peek.get("next_season") or 0) > 1:
                media_type = "series"
            if isinstance(w_info, dict):
                if not explicit_rezka_id and w_info.get("rezka_id"):
                    explicit_rezka_id = str(w_info["rezka_id"])
                if not rezka_url and w_info.get("rezka_url"):
                    rezka_url = w_info["rezka_url"]
    req_lang = ctx.norm_app_lang(qs.get("lang", [ctx.app_prefs.get("app_lang", "ru")])[0], ctx.app_prefs.get("app_lang", "ru"))
    if ctx.profile_manager.is_kids_mode_active():
        cand_tm = ctx.build_trusted_item_for_kids_check(
            item_id=kin_item_id or item_id,
            title=title,
            orig_title=orig_title,
            media_type=media_type,
        )
        probe_tm = (
            cand_tm
            if (cand_tm.get("genres") or cand_tm.get("description") or cand_tm.get("age_rating"))
            else {**cand_tm, "genres": ["семейный"]}
        )
        if not ctx.profile_manager.is_item_kids_safe(probe_tm):
            handler._send_json(
                {
                    "ok": False,
                    "error": ctx.msg(
                        "Контент недоступен в детском профиле",
                        "Content restricted in Kids Mode",
                        req_lang,
                    ),
                },
                status=403,
            )
            return True
    num_id = HDRezkaClient._extract_safe_rezka_id(
        item_id=item_id,
        explicit_rezka_id=explicit_rezka_id,
        rezka_url=rezka_url,
    )
    inferred_imdb = item_id if re.match(r"^tt\d{5,10}$", item_id) else ""
    req_prof_id_tm = str(getattr(ctx.kinorium_service, "_profile_id", "main") or "main")

    reconcile_thread = None
    if media_type == "series" and ctx.kinorium_service.is_service_enabled("kinorium"):
        reconcile_thread = threading.Thread(
            target=ctx.kinorium_service.reconcile_series_episodes,
            kwargs={
                "item_id": kin_item_id,
                "title": title,
                "orig_title": orig_title,
                "kid": kin_kid or None,
            },
            daemon=True,
        )
        reconcile_thread.start()

    kin_extras_holder: Dict[str, Any] = {
        "pct": None,
        "kinorium_id": kin_kid,
        "similar_raw": None,
        "description": "",
    }
    en_holder: Dict[str, Any] = {"data": None}
    jw_offers_holder: Dict[str, Any] = {"offers": []}

    def _fetch_kin_extras_bg() -> None:
        if ctx.kinorium_service.is_service_enabled("kinorium"):
            if str(getattr(ctx.kinorium_service, "_profile_id", "main") or "main") != req_prof_id_tm:
                return
            extras = ctx.kinorium_service.fetch_movie_page_extras(
                kid=kin_kid,
                item_id=kin_item_id,
                title=title,
                orig_title=orig_title,
                year=year or None,
                media_type=media_type,
                allow_network=True,
            )
            kin_extras_holder["pct"] = extras.get("critics_pct")
            if extras.get("kinorium_id"):
                kin_extras_holder["kinorium_id"] = extras["kinorium_id"]
            kin_extras_holder["similar_raw"] = extras.get("similar_raw")
            if extras.get("description"):
                kin_extras_holder["description"] = str(extras.get("description") or "").strip()
            eff_k_ep = str(kin_extras_holder.get("kinorium_id") or kin_kid or "").strip()
            if (
                eff_k_ep.isdigit()
                and kin_extras_holder["description"]
                and str(getattr(ctx.kinorium_service, "_profile_id", "main") or "main") == req_prof_id_tm
            ):
                with ctx.kinorium_service._state_lock:
                    ctx.kinorium_service.state.setdefault("descriptions_by_kid", {})[eff_k_ep] = kin_extras_holder["description"]
            if (
                media_type == "series"
                and reconcile_thread is None
                and eff_k_ep.isdigit()
                and str(getattr(ctx.kinorium_service, "_profile_id", "main") or "main") == req_prof_id_tm
            ):
                try:
                    ctx.kinorium_service.fetch_series_episodes_state(eff_k_ep, item_id=kin_item_id)
                except Exception:
                    pass

    def _fetch_jw_offers_bg() -> None:
        try:
            jw_offers_holder["offers"] = ctx.aggregator.resolve_provider_offers_for_title(
                title=title,
                orig_title=orig_title,
                year=year,
                media_type=media_type,
            )
        except Exception:
            jw_offers_holder["offers"] = []

    def _fetch_en_bg() -> None:
        en_holder["data"] = ctx.en_meta_resolver.resolve(
            item_id=kin_item_id or item_id,
            title=title,
            orig_title=orig_title,
            year=year,
            media_type=media_type,
            kinorium_id=kin_kid,
            need_episodes=(media_type == "series"),
        )

    critics_thread = threading.Thread(target=_fetch_kin_extras_bg, daemon=True)
    critics_thread.start()
    jw_offers_thread = threading.Thread(target=_fetch_jw_offers_bg, daemon=True)
    jw_offers_thread.start()
    en_thread = None
    if req_lang == "en" or media_type == "series":
        en_thread = threading.Thread(target=_fetch_en_bg, daemon=True)
        en_thread.start()

    meta = ctx.rezka_client._resolve_page_metadata(
        num_id,
        title,
        orig_title,
        rezka_url,
        year=year,
        media_type=media_type,
        imdb_id=inferred_imdb,
    )
    bg_deadline = time.time() + 4.5
    for th in (reconcile_thread, critics_thread, jw_offers_thread, en_thread):
        if th is not None and th.is_alive():
            rem = max(0.05, bg_deadline - time.time())
            th.join(timeout=rem)

    if ctx.profile_manager.is_kids_mode_active():
        cand_tm = ctx.build_trusted_item_for_kids_check(
            item_id=kin_item_id or item_id,
            title=title or str((meta or {}).get("title") or ""),
            orig_title=orig_title,
            media_type=media_type,
            server_genres=(meta or {}).get("genres") or [],
            server_age=str((meta or {}).get("age_rating") or ""),
            server_description=str((meta or {}).get("description") or kin_extras_holder.get("description") or ""),
        )
        if not ctx.profile_manager.is_item_kids_safe(cand_tm):
            handler._send_json(
                {
                    "ok": False,
                    "error": ctx.msg(
                        "Контент недоступен в детском профиле",
                        "Content restricted in Kids Mode",
                        req_lang,
                    ),
                },
                status=403,
            )
            return True

    if kin_extras_holder["pct"] is None or not (meta and meta.get("genres")):
        # Fallback to JustWatch US / EN resolver when Kinorium critics % or HDRezka genres are missing
        resolved_en_fb = (
            en_holder["data"]
            if isinstance(en_holder.get("data"), dict)
            else ctx.en_meta_resolver.resolve(
                item_id=kin_item_id or item_id,
                title=title,
                orig_title=orig_title,
                year=year,
                media_type=media_type,
                kinorium_id=kin_extras_holder["kinorium_id"] or kin_kid,
                need_episodes=(media_type == "series"),
            )
        )
        if resolved_en_fb:
            if kin_extras_holder["pct"] is None and resolved_en_fb.get("critics_pct") is not None:
                kin_extras_holder["pct"] = int(resolved_en_fb["critics_pct"])
            if en_holder["data"] is None:
                en_holder["data"] = resolved_en_fb

    en_data = en_holder["data"]
    final_critics = kin_extras_holder["pct"]
    if final_critics is None and isinstance(en_data, dict) and en_data.get("critics_pct") is not None:
        final_critics = int(en_data["critics_pct"])

    eff_kin_id_str = str(kin_extras_holder.get("kinorium_id") or kin_kid or "")
    raw_meta_desc = str(meta.get("description") or "").strip() if meta else ""
    if ctx.is_stub_description(raw_meta_desc, title, orig_title):
        fb_desc_tm = (
            str(kin_extras_holder.get("description") or "").strip()
            or ctx.lookup_fallback_description(
                item_id=kin_item_id or item_id,
                kinorium_id=eff_kin_id_str,
                title=title,
                orig_title=orig_title,
            )
        )
        if fb_desc_tm:
            raw_meta_desc = fb_desc_tm
        elif isinstance(en_data, dict) and en_data.get("description_en") and not raw_meta_desc:
            raw_meta_desc = str(en_data["description_en"])

    resp_payload = {
        "ok": True,
        "rezka_id": meta.get("rezka_id", "") if meta else "",
        "rezka_url": meta.get("rezka_url", "") if meta else "",
        "description": raw_meta_desc,
        "directors": meta.get("directors", []) if meta else [],
        "actors": meta.get("actors", []) if meta else [],
        "cast_people": meta.get("cast_people", []) if meta else [],
        "duration_label": meta.get("duration_label", "") if meta else "",
        "genres": meta.get("genres", []) if meta else [],
        "genres_en": (en_data.get("genres_en") or []) if isinstance(en_data, dict) else [],
        "countries": meta.get("countries", []) if meta else [],
        "countries_en": (en_data.get("countries_en") or []) if isinstance(en_data, dict) else [],
        "studios": meta.get("studios", []) if meta else [],
        "seasons_map": meta.get("seasons_map", {}) if meta else {},
        "episodes_titles": meta.get("episodes_titles", {}) if meta else {},
        "episodes_meta": meta.get("episodes_meta", {}) if meta else {},
        "latest_season": meta.get("latest_season") if meta else None,
        "latest_episode": meta.get("latest_episode") if meta else None,
        "is_completed": bool(meta.get("is_completed", False)) if meta else False,
        "series_status_text": meta.get("series_status_text", "") if meta else "",
        "critics_rating": final_critics,
    }
    if ctx.profile_manager.is_kids_mode_active():
        has_resolved_meta = bool(
            resp_payload.get("genres")
            or resp_payload.get("genres_en")
            or resp_payload.get("age_rating")
            or resp_payload.get("description")
        )
        probe_resolved_tm = (
            resp_payload if has_resolved_meta else {**resp_payload, "genres": ["семейный"]}
        )
        if not ctx.profile_manager.is_item_kids_safe(probe_resolved_tm):
            handler._send_json(
                {
                    "ok": False,
                    "error": ctx.msg(
                        "Контент недоступен в детском профиле",
                        "Content restricted in Kids Mode",
                        req_lang,
                    ),
                },
                status=403,
            )
            return True

    if not resp_payload["cast_people"] and isinstance(en_data, dict) and en_data.get("cast_people"):
        resp_payload["cast_people"] = en_data["cast_people"]
        if not resp_payload["directors"]:
            resp_payload["directors"] = [p["name"] for p in en_data["cast_people"] if p.get("is_director")]
        if not resp_payload["actors"]:
            resp_payload["actors"] = [p["name"] for p in en_data["cast_people"] if not p.get("is_director")]
    elif not resp_payload["directors"] and isinstance(en_data, dict) and en_data.get("directors"):
        resp_payload["directors"] = en_data["directors"]
    if not resp_payload["actors"] and isinstance(en_data, dict) and en_data.get("actors"):
        resp_payload["actors"] = en_data["actors"]

    raw_studios = meta.get("studios", []) if meta else []
    free_studios = [s for s in raw_studios if not s.get("is_prem_locked")]
    resp_payload["studios"] = free_studios if free_studios else raw_studios

    if req_lang == "en":
        if isinstance(en_data, dict) and en_data.get("ok"):
            if en_data.get("description_en"):
                resp_payload["description"] = en_data["description_en"]
                resp_payload["description_en"] = en_data["description_en"]
            elif ctx.has_cyrillic(str(resp_payload.get("description") or "")):
                resp_payload["description"] = ctx.translate_kinorium_extra_desc_to_en(
                    str(resp_payload.get("description") or "")
                )
            en_cast = ctx.build_english_cast_people(en_data, resp_payload.get("cast_people"))
            resp_payload["cast_people"] = en_cast
            resp_payload["directors"] = [p["name"] for p in en_cast if p.get("is_director")]
            resp_payload["actors"] = [p["name"] for p in en_cast if not p.get("is_director")]
            if en_data.get("poster_en"):
                resp_payload["poster_en"] = en_data["poster_en"]
            if en_data.get("countries_en"):
                resp_payload["countries_en"] = en_data["countries_en"]
            if en_data.get("genres_en"):
                resp_payload["genres_en"] = en_data["genres_en"]
            if en_data.get("runtime_min"):
                resp_payload["duration_label"] = f"{int(en_data['runtime_min'])} min"
            if en_data.get("episodes_titles_en"):
                merged_t = dict(resp_payload.get("episodes_titles") or {})
                for sn_k, ep_dict in en_data["episodes_titles_en"].items():
                    cur_sn = dict(merged_t.get(sn_k) or {})
                    cur_sn.update(ep_dict)
                    merged_t[sn_k] = cur_sn
                resp_payload["episodes_titles"] = merged_t
            if en_data.get("episodes_meta_en"):
                merged_m = dict(resp_payload.get("episodes_meta") or {})
                for sn_k, ep_dict in en_data["episodes_meta_en"].items():
                    cur_sn_m = dict(merged_m.get(sn_k) or {})
                    for ep_k, ep_info in ep_dict.items():
                        base_ep = dict(cur_sn_m.get(ep_k) or {})
                        base_ep.update(
                            {k: v for k, v in ep_info.items() if v or isinstance(v, bool)}
                        )
                        cur_sn_m[ep_k] = base_ep
                    merged_m[sn_k] = cur_sn_m
                resp_payload["episodes_meta"] = merged_m
        else:
            if ctx.has_cyrillic(str(resp_payload.get("description") or "")):
                tr_desc = ctx.translate_kinorium_extra_desc_to_en(
                    str(resp_payload.get("description") or "")
                )
                resp_payload["description"] = tr_desc if not ctx.has_cyrillic(tr_desc) else ""
            en_cast_fb = ctx.build_english_cast_people({}, resp_payload.get("cast_people"))
            resp_payload["cast_people"] = en_cast_fb
            resp_payload["directors"] = [p["name"] for p in en_cast_fb if p.get("is_director")]
            resp_payload["actors"] = [p["name"] for p in en_cast_fb if not p.get("is_director")]

    sim_bundle = ctx.aggregator.resolve_similar_for_title(
        item_id=kin_item_id or item_id,
        kinorium_id=eff_kin_id_str,
        title=title,
        orig_title=orig_title,
        year=year,
        media_type=media_type,
        directors=meta.get("directors", []) if meta else [],
        actors=meta.get("actors", []) if meta else [],
        preloaded_raw=kin_extras_holder.get("similar_raw"),
        allow_network=False,
        lang=req_lang,
        limit=12,
    )
    sim_items = sim_bundle.get("items", [])
    if ctx.profile_manager.is_kids_mode_active():
        sim_items = ctx.profile_manager.filter_items_for_kids(sim_items)
    resp_payload["similar_items"] = sim_items
    resp_payload["similar_source"] = sim_bundle.get("source", "curated")
    if kin_extras_holder.get("kinorium_id"):
        resp_payload["kinorium_id"] = str(kin_extras_holder["kinorium_id"])
    resp_payload["providers"] = jw_offers_holder.get("offers") or []

    if media_type == "series":
        merged_em = {
            str(sk): {str(ek): dict(ev) for ek, ev in (sv or {}).items() if isinstance(ev, dict)}
            for sk, sv in (resp_payload.get("episodes_meta") or {}).items()
            if isinstance(sv, dict)
        }
        merged_sm = {
            str(sk): sorted({int(x) for x in (sv or []) if str(x).isdigit() and int(x) > 0})
            for sk, sv in (resp_payload.get("seasons_map") or {}).items()
        }
        # 1. Merge HDRezka Premium-locked aired episodes so they are clickable
        prem_map = (meta.get("prem_episodes_map") or {}) if isinstance(meta, dict) else {}
        for sn_p, ep_list_p in prem_map.items():
            sn_ps = str(sn_p)
            cur_s_em = merged_em.setdefault(sn_ps, {})
            cur_s_sm = merged_sm.setdefault(sn_ps, [])
            for ep_p in ep_list_p or []:
                if not str(ep_p).isdigit() or int(ep_p) <= 0:
                    continue
                ep_pi = int(ep_p)
                ep_ps = str(ep_pi)
                ep_m_entry = cur_s_em.setdefault(ep_ps, {})
                ep_m_entry["is_prem_locked"] = True
                if ep_pi not in cur_s_sm:
                    cur_s_sm.append(ep_pi)
            if cur_s_sm:
                cur_s_sm.sort()

        # 2. Propagate Cinemeta/TVMaze is_future / orig_title metadata
        today_utc_iso = time.strftime("%Y-%m-%d", time.gmtime())
        if isinstance(en_data, dict) and isinstance(en_data.get("episodes_meta_en"), dict):
            for sn_k, ep_dict in en_data["episodes_meta_en"].items():
                sn_s = str(sn_k)
                cur_s_em = merged_em.setdefault(sn_s, {})
                for ep_k, ep_info in (ep_dict or {}).items():
                    if not isinstance(ep_info, dict):
                        continue
                    ep_s = str(ep_k)
                    cur_ep_m = cur_s_em.setdefault(ep_s, {})
                    if "is_future" in ep_info:
                        cur_ep_m["is_future"] = bool(ep_info["is_future"])
                        cur_ep_m["is_released"] = not bool(ep_info["is_future"])
                    if not cur_ep_m.get("orig_title") and ep_info.get("title"):
                        cur_ep_m["orig_title"] = str(ep_info["title"])
                    if not cur_ep_m.get("title") and ep_info.get("title") and req_lang == "ru":
                        cur_ep_m["title"] = str(ep_info["title"])
                    ep_still = ep_info.get("still") or ep_info.get("thumbnail")
                    if not cur_ep_m.get("still") and ep_still:
                        cur_ep_m["still"] = str(ep_still)
                    ep_air_iso = str(ep_info.get("air_date") or "")[:10]
                    if (
                        ep_s.isdigit()
                        and int(ep_s) > 0
                        and re.match(r"^\d{4}-\d{2}-\d{2}$", ep_air_iso)
                        and ep_air_iso <= today_utc_iso
                        and not bool(ep_info.get("is_future"))
                    ):
                        ep_num_i = int(ep_s)
                        cur_s_sm = merged_sm.setdefault(sn_s, [])
                        if ep_num_i not in cur_s_sm:
                            cur_s_sm.append(ep_num_i)
                            cur_s_sm.sort()

        # 3. Merge Kinorium episode titles and future flags
        if eff_kin_id_str.isdigit():
            with ctx.kinorium_service._episodes_lock:
                cached_ep_st = ctx.kinorium_service._series_episodes_cache.get(eff_kin_id_str)
            if cached_ep_st and isinstance(cached_ep_st.get("episodes"), dict):
                seasons_missing_on_rezka = {
                    str(sn_k) for (sn_k, _e) in cached_ep_st["episodes"].keys() if not merged_sm.get(str(sn_k))
                }
                for (sn_i, en_i), ep_obj in cached_ep_st["episodes"].items():
                    sn_s = str(sn_i)
                    en_s = str(en_i)
                    cur_s_meta = merged_em.setdefault(sn_s, {})
                    cur_ep_m = cur_s_meta.setdefault(en_s, {})
                    if req_lang == "en":
                        if not cur_ep_m.get("title"):
                            orig_ep_t = str(ep_obj.get("orig_title") or "").strip()
                            if orig_ep_t and not ctx.has_cyrillic(orig_ep_t):
                                cur_ep_m["title"] = orig_ep_t
                    else:
                        if ep_obj.get("ru_title"):
                            cur_ep_m["title"] = ep_obj["ru_title"]
                        elif not cur_ep_m.get("title") and ep_obj.get("orig_title"):
                            cur_ep_m["title"] = ep_obj["orig_title"]
                    if not cur_ep_m.get("orig_title") and ep_obj.get("orig_title"):
                        cur_ep_m["orig_title"] = ep_obj["orig_title"]
                    if ep_obj.get("air_date") and not cur_ep_m.get("air_date") and req_lang != "en":
                        cur_ep_m["air_date"] = ep_obj["air_date"]
                    if ep_obj.get("is_future"):
                        cur_ep_m["is_future"] = True
                        cur_ep_m["is_released"] = False
                    elif "is_future" not in cur_ep_m:
                        cur_ep_m["is_future"] = False
                        cur_ep_m["is_released"] = True
                    kin_air_iso = str(ep_obj.get("air_date_iso") or "")[:10]
                    is_confirmed_kin_aired = bool(
                        re.match(r"^\d{4}-\d{2}-\d{2}$", kin_air_iso)
                        and kin_air_iso <= today_utc_iso
                        and not cur_ep_m.get("is_future")
                    )
                    if not cur_ep_m.get("is_future") and (sn_s in seasons_missing_on_rezka or is_confirmed_kin_aired):
                        merged_sm.setdefault(sn_s, [])
                        if en_i not in merged_sm[sn_s]:
                            merged_sm[sn_s].append(en_i)
                            merged_sm[sn_s].sort()

        # 4. If seasons_map is still completely empty, populate released episodes from Cinemeta/TVMaze
        if not any(merged_sm.values()) and isinstance(en_data, dict) and isinstance(en_data.get("episodes_meta_en"), dict):
            for sn_k, ep_dict in en_data["episodes_meta_en"].items():
                sn_s = str(sn_k)
                rel_eps = sorted(
                    int(ek)
                    for ek, ev in (ep_dict or {}).items()
                    if str(ek).isdigit() and int(ek) > 0 and isinstance(ev, dict) and not ev.get("is_future")
                )
                if rel_eps:
                    merged_sm[sn_s] = rel_eps

        # 5. Strictly exclude any confirmed future/unreleased episodes from clickable seasons_map
        filtered_sm: Dict[str, List[int]] = {}
        for sn_s, ep_nums in merged_sm.items():
            s_em = merged_em.get(sn_s) or {}
            kept = [
                int(ep_n)
                for ep_n in ep_nums
                if not bool((s_em.get(str(ep_n)) or {}).get("is_future"))
            ]
            if kept:
                filtered_sm[sn_s] = sorted(set(kept))

        resp_payload["episodes_meta"] = merged_em
        resp_payload["seasons_map"] = filtered_sm
        numeric_s_keys = [int(k) for k in filtered_sm.keys() if str(k).isdigit() and filtered_sm.get(k)]
        if numeric_s_keys:
            max_rel_s = max(numeric_s_keys)
            resp_payload["latest_season"] = max_rel_s
            resp_payload["latest_episode"] = max(filtered_sm[str(max_rel_s)])

        resolved_meta_url = str((meta or {}).get("rezka_url") or "")
        if (
            filtered_sm
            and not (kin_item_id and kin_item_id.isdigit())
            and title.lower() not in ("", "фильм", "сериал", "видео", "movie", "series")
            and "/films/" not in resolved_meta_url.lower()
            and str(getattr(ctx.kinorium_service, "_profile_id", "main") or "main") == req_prof_id_tm
        ):
            st_names = [s.get("name", "") for s in ((meta or {}).get("studios") or []) if s.get("name")][:4]
            ctx.kinorium_service.save_series_live_meta(
                [
                    {
                        "id": kin_item_id,
                        "title": title,
                        "orig_title": orig_title,
                        "year": year,
                        "media_type": "series",
                        "rezka_id": (meta or {}).get("rezka_id", ""),
                        "rezka_url": resolved_meta_url,
                        "latest_season": resp_payload.get("latest_season") or 1,
                        "latest_episode": resp_payload.get("latest_episode") or 1,
                        "seasons_map": filtered_sm,
                        "is_completed": bool((meta or {}).get("is_completed", False)),
                        "series_status_text": (meta or {}).get("series_status_text", ""),
                        "studios_summary": ", ".join(st_names) if st_names else "HDRezka",
                        "studios_count": len((meta or {}).get("studios") or []),
                        "not_found": False,
                    }
                ]
            )

    if req_lang == "en":
        resp_payload["episodes_titles"], resp_payload["episodes_meta"] = ctx.scrub_cyrillic_episode_dicts(
            resp_payload.get("episodes_titles"), resp_payload.get("episodes_meta")
        )

    k_stat = (
        ctx.kinorium_service.get_item_status(
            kin_item_id or item_id,
            title=title,
            orig_title=orig_title,
        )
        if ctx.kinorium_service.is_service_enabled("kinorium")
        else {}
    )
    resp_payload["kinorium_status"] = k_stat
    resp_payload["kinorium_counts"] = (
        ctx.kinorium_service.get_sections_counts()
        if ctx.kinorium_service.is_service_enabled("kinorium")
        else {}
    )
    kin_rating = k_stat.get("kinorium_rating") or (meta.get("kinorium_rating") if meta else None)
    w_info = k_stat.get("watched_info") if isinstance(k_stat.get("watched_info"), dict) else {}
    if isinstance(en_data, dict) and en_data.get("imdb_id") and not resp_payload.get("imdb_id"):
        resp_payload["imdb_id"] = en_data["imdb_id"]
    imdb_rating = (
        ((en_data.get("imdb_rating") or en_data.get("imdb_score")) if isinstance(en_data, dict) else None)
        or k_stat.get("imdb_rating")
        or w_info.get("imdb_rating")
        or (meta.get("imdb_rating") if meta else None)
        or (meta.get("rating_imdb") if meta else None)
    )
    if imdb_rating is None:
        with ctx.kinorium_service._state_lock:
            for skey in ("remote_watching_items", "remote_watchlist_items", "remote_watched_items", "remote_never_items"):
                rem_it = (ctx.kinorium_service.state.get(skey) or {}).get(eff_kin_id_str)
                if isinstance(rem_it, dict) and rem_it.get("imdb_rating"):
                    imdb_rating = rem_it["imdb_rating"]
                    break
    if imdb_rating is None:
        cand_c = (
            (ctx.aggregator.lookup_cached_item(item_id) or ctx.aggregator.lookup_cached_item(f"kin_{eff_kin_id_str}"))
            if hasattr(ctx.aggregator, "lookup_cached_item")
            else None
        )
        if isinstance(cand_c, dict):
            imdb_rating = (cand_c.get("ratings") or {}).get("imdb") or cand_c.get("imdb_rating")
    if imdb_rating is None:
        en_cached = ctx.en_meta_resolver.resolve(
            item_id=kin_item_id or item_id,
            title=title,
            orig_title=orig_title,
            year=year,
            media_type=media_type,
            kinorium_id=eff_kin_id_str or kin_kid,
            need_episodes=False,
        )
        if isinstance(en_cached, dict):
            if en_cached.get("imdb_id") and not resp_payload.get("imdb_id"):
                resp_payload["imdb_id"] = en_cached["imdb_id"]
            if en_cached.get("imdb_rating") or en_cached.get("imdb_score"):
                imdb_rating = en_cached.get("imdb_rating") or en_cached.get("imdb_score")
    resp_payload["kinorium_rating"] = kin_rating
    resp_payload["imdb_rating"] = imdb_rating
    resp_payload["ratings"] = {
        "kinorium": kin_rating,
        "imdb": imdb_rating,
        "critics": final_critics,
    }
    handler._send_json(resp_payload)
    return True


def handle_provider_link(handler: Any, qs: Dict[str, Any], parsed: Any, ctx: Any) -> bool:
    service = qs.get("service", [""])[0].strip().lower()
    title = qs.get("title", [""])[0].strip()
    orig_title = qs.get("orig_title", [""])[0].strip()
    year = ctx.qs_int(qs, "year", 0)
    media_type = qs.get("media_type", [""])[0].strip().lower()
    if ctx.profile_manager.is_kids_mode_active():
        cand_pl = ctx.build_trusted_item_for_kids_check(
            item_id=qs.get("id", [""])[0].strip(),
            title=title,
            orig_title=orig_title,
            media_type=media_type,
        )
        if (cand_pl.get("genres") or cand_pl.get("age_rating") or cand_pl.get("description")) and not ctx.profile_manager.is_item_kids_safe(cand_pl):
            handler._send_json({"ok": False, "error": "Restricted in Kids Mode"}, status=403)
            return True
        if not (cand_pl.get("genres") or cand_pl.get("description")) and not ctx.profile_manager.is_item_kids_safe({**cand_pl, "genres": ["семейный"]}):
            handler._send_json({"ok": False, "error": "Restricted in Kids Mode"}, status=403)
            return True
    offers = ctx.aggregator.resolve_provider_offers_for_title(
        title=title,
        orig_title=orig_title,
        year=year,
        media_type=media_type,
    )
    matched = next((p for p in offers if str(p.get("id") or "") == service and p.get("url")), None)
    q_str = urllib.parse.quote((orig_title or title or "").strip())
    search_fallbacks = {
        "netflix": f"https://www.netflix.com/search?q={q_str}" if q_str else "https://www.netflix.com",
        "appletv": f"https://tv.apple.com/pl/search?term={q_str}" if q_str else "https://tv.apple.com/pl",
        "prime": f"https://www.primevideo.com/search?phrase={q_str}" if q_str else "https://www.primevideo.com",
        "disney": "https://www.disneyplus.com/search" if q_str else "https://www.disneyplus.com",
        "max": f"https://play.max.com/search?q={q_str}" if q_str else "https://play.max.com",
        "playerpl": "https://player.pl",
    }
    direct_url = str(matched.get("url") or "") if matched else ""
    final_url = direct_url or search_fallbacks.get(service, "https://www.justwatch.com/pl")
    handler._send_json(
        {
            "ok": True,
            "service": service,
            "url": final_url,
            "direct_offer": bool(direct_url),
            "quality": str(matched.get("quality") or "") if matched else "",
            "providers": offers,
        }
    )
    return True


def handle_skip_intro(handler: Any, qs: Dict[str, Any], parsed: Any, ctx: Any) -> bool:
    imdb_id = qs.get("imdb_id", [""])[0].strip()
    season = max(1, ctx.qs_int(qs, "season", 1))
    episode = max(1, ctx.qs_int(qs, "episode", 1))
    media_type = qs.get("media_type", ["series"])[0]
    title = qs.get("title", [""])[0]
    orig_title = qs.get("orig_title", [""])[0]
    year = ctx.qs_int(qs, "year", 0)
    req_lang = ctx.norm_app_lang(qs.get("lang", [ctx.app_prefs.get("app_lang", "ru")])[0], ctx.app_prefs.get("app_lang", "ru"))
    data = ctx.skip_intro_engine.get_skip_segments(
        imdb_id=imdb_id,
        season=season,
        episode=episode,
        media_type=media_type,
        title=title,
        orig_title=orig_title,
        year=year,
        lang=req_lang,
    )
    handler._send_json(data)
    return True


def handle_subtitles_search(handler: Any, qs: Dict[str, Any], parsed: Any, ctx: Any) -> bool:
    req_lang = ctx.norm_app_lang(qs.get("lang", [ctx.app_prefs.get("app_lang", "ru")])[0], ctx.app_prefs.get("app_lang", "ru"))
    sub_id = qs.get("id", [""])[0].strip()
    sub_title = qs.get("title", [""])[0].strip()
    sub_orig = qs.get("orig_title", [""])[0].strip()
    sub_mtype = qs.get("media_type", ["movie"])[0].strip() or "movie"
    if ctx.profile_manager.is_kids_mode_active():
        cand_sub = ctx.build_trusted_item_for_kids_check(
            item_id=sub_id,
            title=sub_title,
            orig_title=sub_orig,
            media_type=sub_mtype,
        )
        probe_sub = cand_sub if (cand_sub.get("genres") or cand_sub.get("description")) else {**cand_sub, "genres": ["семейный"]}
        if not ctx.profile_manager.is_item_kids_safe(probe_sub):
            handler._send_json({"ok": False, "subtitles": [], "error": "Restricted in Kids Mode"}, status=403)
            return True
    res_subs = ctx.subtitle_service.search_subtitles(
        item_id=sub_id,
        imdb_id=qs.get("imdb_id", [""])[0].strip(),
        title=sub_title,
        orig_title=sub_orig,
        year=ctx.qs_int(qs, "year", 0),
        media_type=sub_mtype,
        season=max(1, ctx.qs_int(qs, "season", 1)),
        episode=max(1, ctx.qs_int(qs, "episode", 1)),
        lang=req_lang,
    )
    handler._send_json(res_subs)
    return True


def handle_subtitles_translate(handler: Any, qs: Dict[str, Any], parsed: Any, ctx: Any) -> bool:
    word_q = qs.get("word", [""])[0].strip()
    ctx_q = qs.get("context", [""])[0].strip()
    target_q = ctx.norm_app_lang(qs.get("target_lang", [ctx.app_prefs.get("app_lang", "ru")])[0], ctx.app_prefs.get("app_lang", "ru"))
    res_tr = ctx.subtitle_service.translate_subtitle_word(
        word=word_q,
        context=ctx_q,
        target_lang=target_q,
    )
    handler._send_json(res_tr, status=200 if res_tr.get("ok") else 400)
    return True


def handle_calendar(handler: Any, qs: Dict[str, Any], parsed: Any, ctx: Any) -> bool:
    req_lang = ctx.norm_app_lang(qs.get("lang", [ctx.app_prefs.get("app_lang", "ru")])[0], ctx.app_prefs.get("app_lang", "ru"))
    has_cal_auth = handler._is_loopback_client() or ctx.remote_broker.verify_key(qs.get("k", [""])[0].strip())
    force_cal = qs.get("force", ["0"])[0].strip().lower() in ("1", "true", "yes") and has_cal_auth
    cal_data = ctx.aggregator.get_release_calendar(
        days_past=max(1, ctx.qs_int(qs, "days_past", 14)),
        days_ahead=max(1, ctx.qs_int(qs, "days_ahead", 45)),
        lang=req_lang,
        kids_mode=ctx.profile_manager.is_kids_mode_active(),
        force_refresh=force_cal,
    )
    handler._send_json(cal_data)
    return True


META_GET_ROUTES = {
    "/api/trailer": handle_trailer,
    "/api/person": handle_person,
    "/api/person-photo": handle_person_photo,
    "/api/title-meta": handle_title_meta,
    "/api/provider-link": handle_provider_link,
    "/api/skip-intro": handle_skip_intro,
    "/api/subtitles/search": handle_subtitles_search,
    "/api/subtitles/translate": handle_subtitles_translate,
    "/api/calendar": handle_calendar,
}
