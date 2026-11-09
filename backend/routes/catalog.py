"""
Velarium Catalog & Search Route Handlers
Dispatches /api/catalog and /api/search requests.
"""

from typing import Dict, Any, List


def _safe_int(val: Any, default: int = 1) -> int:
    try:
        return int(val) if val is not None and str(val).strip() != "" else default
    except (ValueError, TypeError):
        return default


def build_offline_catalog_payload(ctx, media_type: str = "all", lang: str = "ru") -> Dict[str, Any]:
    """Constructs catalog payload directly from completed offline downloads."""
    dl_mgr = getattr(ctx, "download_manager", None)
    if dl_mgr is None:
        return {"ok": True, "items": [], "providers_meta": {}, "continue_watching": [], "is_offline": True}

    kids_mode = (
        bool(getattr(ctx.profile_manager, "is_kids_mode_active", lambda: False)())
        if hasattr(ctx, "profile_manager") and ctx.profile_manager
        else False
    )
    active_prof_id = (
        getattr(ctx.profile_manager, "get_active_profile_id", lambda: "main")()
        if hasattr(ctx, "profile_manager") and ctx.profile_manager
        else "main"
    )
    dl_payload = dl_mgr.get_downloads_payload(
        profile_id=active_prof_id,
        kids_mode=kids_mode,
        active_profile_id=active_prof_id,
        lang=lang,
    )
    items_raw = dl_payload.get("items") or []
    completed = [it for it in items_raw if it.get("status") == "completed"]

    grouped_items: List[Dict[str, Any]] = []
    series_groups: Dict[str, Dict[str, Any]] = {}

    for it in completed:
        m_type = it.get("media_type") or "movie"
        if media_type != "all" and m_type != media_type:
            continue

        if m_type == "series":
            group_key = (
                str(it.get("item_id") or "").strip()
                or (f"kin_{it.get('kinorium_id')}" if it.get("kinorium_id") else "")
                or (f"rezka_{it.get('rezka_id')}" if it.get("rezka_id") else "")
                or str(it.get("title") or "").strip().lower()
            )
            s_num = max(1, _safe_int(it.get("season"), 1))
            e_num = max(1, _safe_int(it.get("episode"), 1))

            if group_key not in series_groups:
                series_item = {
                    "id": it.get("item_id") or group_key,
                    "title": it.get("title") or "Velarium",
                    "orig_title": it.get("orig_title") or "",
                    "year": it.get("year") or "",
                    "media_type": "series",
                    "poster": it.get("poster") or "",
                    "backdrop": it.get("backdrop") or it.get("poster") or "",
                    "genres": it.get("genres") or [],
                    "age_rating": it.get("age_rating") or "",
                    "ratings": it.get("ratings") or {},
                    "kinorium": it.get("kinorium") or {},
                    "is_offline": True,
                    "download_id": it.get("download_id"),
                    "offline_count": 0,
                    "_seasons_map": {},
                }
                series_groups[group_key] = series_item
                grouped_items.append(series_item)

            s_map = series_groups[group_key]["_seasons_map"]
            s_key = str(s_num)
            if s_key not in s_map:
                s_map[s_key] = []
            if e_num not in s_map[s_key]:
                s_map[s_key].append(e_num)
            series_groups[group_key]["offline_count"] += 1
        else:
            movie_item = {
                "id": it.get("item_id") or f"dl_{it.get('download_id')}",
                "title": it.get("title") or "Velarium",
                "orig_title": it.get("orig_title") or "",
                "year": it.get("year") or "",
                "media_type": "movie",
                "poster": it.get("poster") or "",
                "backdrop": it.get("backdrop") or it.get("poster") or "",
                "genres": it.get("genres") or [],
                "age_rating": it.get("age_rating") or "",
                "ratings": it.get("ratings") or {},
                "kinorium": it.get("kinorium") or {},
                "is_offline": True,
                "download_id": it.get("download_id"),
                "offline_play_url": it.get("play_url"),
            }
            grouped_items.append(movie_item)

    for item in grouped_items:
        if item.get("media_type") == "series" and "_seasons_map" in item:
            s_map = item.pop("_seasons_map")
            for k in s_map:
                s_map[k].sort()
            item["seasons_map"] = s_map

    return {
        "ok": True,
        "items": grouped_items,
        "providers_meta": {"offline": {"name": "Offline", "badge": "Offline"}},
        "continue_watching": [],
        "is_offline": True,
    }


def handle_catalog(handler, qs, parsed, ctx):
    provider = qs.get("provider", ["all"])[0]
    media_type = qs.get("media_type", ["all"])[0]
    kinorium_section = qs.get("kinorium_section", ["all"])[0]
    app_lang = ctx.app_prefs.get("app_lang", "ru")
    req_lang = ctx.norm_app_lang(qs.get("lang", [app_lang])[0], app_lang)

    if provider == "offline" or kinorium_section == "offline" or media_type == "offline":
        cat_payload = build_offline_catalog_payload(
            ctx,
            media_type=media_type if media_type != "offline" else "all",
            lang=req_lang,
        )
    else:
        try:
            cat_payload = ctx.aggregator.get_catalog(
                provider_filter=provider,
                media_type_filter=media_type,
                kinorium_section=kinorium_section,
                lang=req_lang,
            )
        except Exception:
            cat_payload = build_offline_catalog_payload(
                ctx,
                media_type=media_type,
                lang=req_lang,
            )

    if not isinstance(cat_payload, dict):
        cat_payload = build_offline_catalog_payload(
            ctx,
            media_type=media_type if media_type != "offline" else "all",
            lang=req_lang,
        )

    prof_mgr = getattr(ctx, "profile_manager", None)
    if prof_mgr and hasattr(prof_mgr, "is_kids_mode_active") and prof_mgr.is_kids_mode_active():
        cat_payload = prof_mgr.filter_catalog_payload_for_kids(cat_payload)
    else:
        cat_payload = dict(cat_payload)
    if prof_mgr and hasattr(prof_mgr, "get_active_profile"):
        cat_payload["active_profile"] = prof_mgr.get_active_profile(
            lang=req_lang,
            live_kinorium_service=getattr(ctx, "kinorium_service", None),
        )
    handler._send_json(cat_payload)
    return True


def handle_search(handler, qs, parsed, ctx):
    q = qs.get("q", [""])[0]
    provider = qs.get("provider", ["all"])[0]
    media_type = qs.get("media_type", ["all"])[0]
    kinorium_section = qs.get("kinorium_section", ["all"])[0]
    search_mode = qs.get("mode", ["full"])[0]
    app_lang = ctx.app_prefs.get("app_lang", "ru")
    req_lang = ctx.norm_app_lang(qs.get("lang", [app_lang])[0], app_lang)

    if provider == "offline" or kinorium_section == "offline" or media_type == "offline":
        off_payload = build_offline_catalog_payload(
            ctx,
            media_type=media_type if media_type != "offline" else "all",
            lang=req_lang,
        )
        q_norm = q.strip().lower()
        if q_norm:
            off_payload["items"] = [
                it
                for it in off_payload.get("items", [])
                if q_norm in str(it.get("title") or "").lower()
                or q_norm in str(it.get("orig_title") or "").lower()
            ]
        srch_payload = off_payload
    else:
        try:
            srch_payload = ctx.aggregator.unified_search(
                query=q,
                provider_filter=provider,
                media_type_filter=media_type,
                kinorium_section=kinorium_section,
                lang=req_lang,
                mode=search_mode,
            )
        except Exception:
            srch_payload = build_offline_catalog_payload(
                ctx,
                media_type=media_type,
                lang=req_lang,
            )

    if not isinstance(srch_payload, dict):
        srch_payload = build_offline_catalog_payload(
            ctx,
            media_type=media_type,
            lang=req_lang,
        )

    prof_mgr = getattr(ctx, "profile_manager", None)
    if prof_mgr and hasattr(prof_mgr, "is_kids_mode_active") and prof_mgr.is_kids_mode_active():
        srch_payload = prof_mgr.filter_catalog_payload_for_kids(srch_payload)
    handler._send_json(srch_payload)
    return True


_MOOD_GENRE_MAP: Dict[str, set] = {
    "action": {"боевик", "приключения", "криминал", "вестерн", "военный", "action", "adventure", "crime", "western"},
    "mindbender": {"триллер", "детектив", "драма", "ужасы", "нуар", "thriller", "mystery", "drama", "horror"},
    "cozy": {"комедия", "мелодрама", "семейный", "мультфильм", "музыка", "comedy", "romance", "family", "animation", "music"},
    "scifi": {"фантастика", "фэнтези", " аниме", "аниме", "sci-fi", "science fiction", "fantasy", "anime"},
}


def _best_item_rating(item: Dict[str, Any]) -> float:
    if not isinstance(item, dict):
        return 0.0
    kin = item.get("kinorium") if isinstance(item.get("kinorium"), dict) else {}
    rats = item.get("ratings") if isinstance(item.get("ratings"), dict) else {}
    try:
        k_val = float(kin.get("kinorium_rating") or rats.get("kinorium") or 0.0)
    except (ValueError, TypeError):
        k_val = 0.0
    try:
        i_val = float(rats.get("imdb") or 0.0)
    except (ValueError, TypeError):
        i_val = 0.0
    return max(k_val, i_val)


def handle_catalog_recommendations(handler, qs, parsed, ctx):
    mood = str(qs.get("mood", ["all"])[0] or "all").strip().lower()
    media_type = str(qs.get("media_type", ["all"])[0] or "all").strip().lower()
    app_lang = ctx.app_prefs.get("app_lang", "ru")
    req_lang = ctx.norm_app_lang(qs.get("lang", [app_lang])[0], app_lang)

    try:
        cat_payload = ctx.aggregator.get_catalog(
            provider_filter="all",
            media_type_filter=media_type if media_type in ("movie", "series") else "all",
            kinorium_section="all",
            lang=req_lang,
        )
    except Exception:
        cat_payload = build_offline_catalog_payload(ctx, media_type=media_type, lang=req_lang)

    if not isinstance(cat_payload, dict):
        cat_payload = {"items": []}

    prof_mgr = getattr(ctx, "profile_manager", None)
    if prof_mgr and hasattr(prof_mgr, "is_kids_mode_active") and prof_mgr.is_kids_mode_active():
        cat_payload = prof_mgr.filter_catalog_payload_for_kids(cat_payload)

    all_items: List[Dict[str, Any]] = [
        it for it in (cat_payload.get("items") or []) if isinstance(it, dict)
    ]
    unwatched: List[Dict[str, Any]] = []
    high_rated_anchors: List[Dict[str, Any]] = []
    fav_directors: Dict[str, str] = {}
    fav_actors: Dict[str, str] = {}
    fav_genres: Dict[str, int] = {}

    for it in all_items:
        kin = it.get("kinorium") if isinstance(it.get("kinorium"), dict) else {}
        u_score = 0
        try:
            u_score = int(kin.get("user_rating") or 0)
        except (ValueError, TypeError):
            u_score = 0
        is_watched = bool(kin.get("watched") or u_score > 0)
        if u_score >= 7:
            if u_score >= 8:
                high_rated_anchors.append(it)
            for d_name in (it.get("directors") or []):
                d_clean = str(d_name or "").strip()
                if d_clean:
                    fav_directors[d_clean.lower()] = d_clean
            for a_name in (it.get("actors") or [])[:5]:
                a_clean = str(a_name or "").strip()
                if a_clean:
                    fav_actors[a_clean.lower()] = a_clean
            for g_name in (it.get("genres") or []):
                g_clean = str(g_name or "").strip().lower()
                if g_clean and g_clean not in ("фильм", "сериал", "movie", "series"):
                    fav_genres[g_clean] = fav_genres.get(g_clean, 0) + (3 if u_score >= 8 else 1)
        if not is_watched:
            if media_type in ("movie", "series") and it.get("media_type") != media_type:
                continue
            unwatched.append(it)

    is_en = req_lang == "en"
    recommended_for_you: List[Dict[str, Any]] = []
    scored_recs = []
    for it in unwatched:
        it_genres = [str(g or "").strip().lower() for g in (it.get("genres") or []) if g]
        it_dirs = [str(d or "").strip() for d in (it.get("directors") or []) if d]
        it_acts = [str(a or "").strip() for a in (it.get("actors") or []) if a]
        g_val = sum(fav_genres.get(g, 0) for g in it_genres)
        matched_dir = next((fav_directors[d.lower()] for d in it_dirs if d.lower() in fav_directors), "")
        matched_act = next((fav_actors[a.lower()] for a in it_acts if a.lower() in fav_actors), "")
        d_val = 1.0 if matched_dir else 0.0
        c_val = 1.0 if matched_act else 0.0
        r_val = _best_item_rating(it)
        # Score(M) = w_genre * G(M) + w_director * D(M) + w_cast * C(M) + w_rating * R(M)
        total_score = 1.5 * g_val + 6.0 * d_val + 3.5 * c_val + 1.0 * r_val
        if total_score > r_val:
            reason = ""
            if matched_dir:
                reason = f"Director: {matched_dir}" if is_en else f"Режиссёр: {matched_dir}"
            elif matched_act:
                reason = f"Cast: {matched_act}" if is_en else f"В ролях: {matched_act}"
            elif it_genres:
                top_g = max(it_genres, key=lambda g: fav_genres.get(g, 0))
                reason = f"Genre: {top_g}" if is_en else f"Жанр: {top_g}"
            rec_copy = dict(it)
            rec_copy["recommendation_score"] = round(total_score, 2)
            rec_copy["recommendation_reason"] = reason
            scored_recs.append((total_score, rec_copy))
    scored_recs.sort(key=lambda pair: pair[0], reverse=True)
    recommended_for_you = [pair[1] for pair in scored_recs[:14]]

    mood_genres = _MOOD_GENRE_MAP.get(mood)
    mood_items: List[Dict[str, Any]] = []
    if mood_genres:
        for it in unwatched:
            g_set = {str(g or "").strip().lower() for g in (it.get("genres") or []) if g}
            if g_set & mood_genres:
                mood_items.append(it)
        mood_items.sort(key=_best_item_rating, reverse=True)
    else:
        mood_items = sorted(unwatched, key=_best_item_rating, reverse=True)

    anchor_title = ""
    because_you_liked: List[Dict[str, Any]] = []
    if high_rated_anchors:
        high_rated_anchors.sort(
            key=lambda x: (int((x.get("kinorium") or {}).get("user_rating") or 0), _best_item_rating(x)),
            reverse=True,
        )
        anchor = high_rated_anchors[0]
        anchor_title = str(anchor.get("title") or anchor.get("orig_title") or "").strip()
        anchor_genres = {
            str(g or "").strip().lower()
            for g in (anchor.get("genres") or [])
            if str(g or "").strip().lower() not in ("", "фильм", "сериал", "movie", "series")
        }
        anchor_dirs = {str(d or "").strip().lower() for d in (anchor.get("directors") or []) if d}
        scored_sim = []
        for it in unwatched:
            if it.get("id") == anchor.get("id"):
                continue
            it_genres = {str(g or "").strip().lower() for g in (it.get("genres") or []) if g}
            it_dirs = {str(d or "").strip().lower() for d in (it.get("directors") or []) if d}
            shared_g = len(anchor_genres & it_genres)
            shared_d = len(anchor_dirs & it_dirs)
            if shared_g > 0 or shared_d > 0:
                sim_score = shared_g * 3.0 + shared_d * 5.0 + _best_item_rating(it)
                scored_sim.append((sim_score, it))
        scored_sim.sort(key=lambda pair: pair[0], reverse=True)
        because_you_liked = [pair[1] for pair in scored_sim[:14]]

    director_picks: List[Dict[str, Any]] = []
    if fav_directors:
        for it in unwatched:
            it_dirs = {str(d or "").strip().lower() for d in (it.get("directors") or []) if d}
            if it_dirs & set(fav_directors.keys()):
                director_picks.append(it)
        director_picks.sort(key=_best_item_rating, reverse=True)

    handler._send_json(
        {
            "ok": True,
            "mood": mood,
            "anchor_title": anchor_title,
            "recommended_for_you": recommended_for_you,
            "because_you_liked": because_you_liked[:14],
            "favorite_directors": director_picks[:14],
            "mood_items": mood_items[:20],
        }
    )
    return True
