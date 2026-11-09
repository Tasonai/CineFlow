"""
Velarium Streams & Media Route Handlers
Dispatches /api/hdrezka/*, /api/stremio/*, /api/remux-probe, /api/remux-subtitle.
"""

import time
import urllib.parse
from typing import Any, Dict, List


def handle_hdrezka_streams(handler, qs: Dict[str, Any], parsed, ctx) -> bool:
    item_id = qs.get("id", [""])[0].strip()
    rezka_id = qs.get("rezka_id", [""])[0].strip()
    title = qs.get("title", [""])[0].strip()
    orig_title = qs.get("orig_title", [""])[0].strip()
    year = ctx.qs_int(qs, "year", 0)
    media_type = qs.get("media_type", [""])[0].strip()
    translator_id = qs.get("translator_id", [""])[0].strip()
    season = max(1, ctx.qs_int(qs, "season", 1))
    episode = max(1, ctx.qs_int(qs, "episode", 1))
    rezka_url = qs.get("rezka_url", [""])[0].strip()
    force_refresh = qs.get("nocache", ["0"])[0].strip().lower() in ("1", "true", "yes")
    if getattr(ctx, "verbose_log", False):
        ctx.safe_log(
            f"[Velarium-DEBUG] streams req: id={item_id} t={title} s={season} e={episode} tr={translator_id} nocache={force_refresh}\n"
        )
    if not media_type:
        is_known_series = False
        if (rezka_url and "/series/" in rezka_url.lower()) or season > 1 or episode > 1:
            is_known_series = True
        else:
            cand_entry = (
                ctx.aggregator.lookup_cached_item(item_id)
                if hasattr(ctx.aggregator, "lookup_cached_item")
                else (getattr(ctx.aggregator, "_catalog_by_id", {}) or {}).get(item_id)
            )
            if cand_entry and cand_entry.get("media_type") == "series":
                is_known_series = True
            elif cand_entry and cand_entry.get("media_type") == "movie":
                is_known_series = False
            else:
                kin_meta = ctx.kinorium_service.get_series_live_meta(
                    item_id=item_id, title=title, orig_title=orig_title, media_type="series"
                )
                if kin_meta and not kin_meta.get("not_found"):
                    is_known_series = True
        media_type = "series" if is_known_series else "movie"
    elif media_type == "movie":
        if (rezka_url and "/series/" in rezka_url.lower()) or season > 1 or episode > 1:
            media_type = "series"
    force_refresh = qs.get("nocache", ["0"])[0].strip().lower() in ("1", "true", "yes")
    req_prof_id_st = str(getattr(ctx.kinorium_service, "_profile_id", "main") or "main")
    req_lang = ctx.norm_app_lang(qs.get("lang", [ctx.app_prefs.get("app_lang", "ru")])[0], ctx.app_prefs.get("app_lang", "ru"))
    explicit_pref_orig = qs.get("prefer_original", [""])[0].strip().lower()
    act_audio_pref = str(ctx.profile_manager.get_active_profile(lang=req_lang).get("default_audio_pref") or "auto")
    if explicit_pref_orig in ("1", "true", "yes"):
        prefer_orig = True
    elif explicit_pref_orig in ("0", "false", "no") and "prefer_original" in qs:
        prefer_orig = False
    elif not translator_id and act_audio_pref == "original":
        prefer_orig = True
    elif not translator_id and act_audio_pref == "ru_dub":
        prefer_orig = False
    else:
        prefer_orig = bool(req_lang == "en" and not translator_id)

    data = ctx.rezka_client.get_streams_for_title(
        item_id=item_id,
        rezka_id=rezka_id,
        title=title,
        orig_title=orig_title,
        year=year,
        media_type=media_type,
        translator_id=translator_id,
        season=season,
        episode=episode,
        rezka_url=rezka_url,
        prefer_original=prefer_orig,
        lang=req_lang,
        force_refresh=force_refresh,
    )
    if ctx.profile_manager.is_kids_mode_active():
        cand_item = ctx.build_trusted_item_for_kids_check(
            item_id=item_id,
            title=title,
            orig_title=orig_title,
            media_type=media_type,
            server_genres=data.get("genres") or [],
            server_age=str(data.get("age_rating") or ""),
            server_description=str(data.get("description") or ""),
        )
        if not ctx.profile_manager.is_item_kids_safe(cand_item):
            handler._send_json(
                {"ok": False, "error": ctx.msg("Контент недоступен в детском профиле", "Content restricted in Kids Mode", req_lang)},
                status=403,
            )
            return True

    if ctx.is_stub_description(data.get("description"), title, orig_title):
        fb_desc = ctx.lookup_fallback_description(item_id=item_id, title=title, orig_title=orig_title)
        if fb_desc:
            data["description"] = fb_desc

    # Guard against resolving P2P/Stremio streams for episodes that have not aired yet
    is_ep_unreleased = bool(data.get("is_unreleased"))
    if (
        not is_ep_unreleased
        and media_type == "series"
        and not data.get("default_stream_url")
        and not data.get("is_prem_locked")
    ):
        is_ep_unreleased = ctx.is_known_episode_unreleased(
            item_id=item_id,
            title=title,
            orig_title=orig_title,
            year=year,
            season=season,
            episode=episode,
        )
    if is_ep_unreleased:
        data["is_unreleased"] = True
        data["episode_unavailable"] = True
        data["qualities"] = {}
        data["default_quality"] = ""
        data["default_stream_url"] = ""
        data["error"] = ctx.msg(
            f"Серия {episode} сезона {season} ещё не вышла",
            f"Season {season}, Episode {episode} has not aired yet",
            req_lang,
        )
    elif (not data.get("default_stream_url")) or (
        data.get("needs_original_fallback") and data.get("original_preferred")
    ):
        was_missing_rezka_stream = not bool(data.get("default_stream_url"))
        orig_fb = ctx.backup_stream_engine.resolve_original_audio_fallback(
            title=title,
            orig_title=orig_title,
            year=year,
            media_type=media_type,
            season=season,
            episode=episode,
            remux_engine=ctx.remux_engine,
        )
        if not orig_fb:
            orig_fb = ctx.stremio_engine.resolve_original_audio_fallback(
                item_id=item_id,
                title=title,
                orig_title=orig_title,
                year=year,
                media_type=media_type,
                season=season,
                episode=episode,
                remux_engine=ctx.remux_engine,
                lang=req_lang,
            )
        if orig_fb:
            data["ok"] = True
            data["stream_unavailable"] = False
            data["episode_unavailable"] = False
            data["is_prem_locked"] = False
            data["qualities"] = orig_fb["qualities"]
            data["default_quality"] = orig_fb["default_quality"]
            data["default_stream_url"] = orig_fb["default_stream_url"]
            if orig_fb.get("subtitles"):
                data["subtitles"] = orig_fb["subtitles"]
            data["remux_session"] = orig_fb["remux_session"]
            if was_missing_rezka_stream and not prefer_orig:
                fb_status_txt = (
                    "Auto-fallback 1080p/4K • Direct stream"
                    if req_lang == "en"
                    else "Авто-резерв 1080p/4K • Прямой поток"
                )
            else:
                fb_status_txt = (
                    "Original 1080p • Direct stream + subtitles"
                    if req_lang == "en"
                    else "Оригинал 1080p • Прямой поток + субтитры"
                )
            data["geo_bypass"] = {
                **(data.get("geo_bypass") or {}),
                "status_text": fb_status_txt,
            }
    if media_type == "series":
        cur_d_sm = {
            str(sk): sorted({int(e) for e in (sv or []) if str(e).isdigit() and int(e) > 0})
            for sk, sv in (data.get("seasons_map") or {}).items()
            if isinstance(sv, list)
        }
        cur_d_em = {
            str(sk): (
                {
                    str(ek): (dict(ev) if isinstance(ev, dict) else ev)
                    for ek, ev in sv.items()
                }
                if isinstance(sv, dict)
                else {}
            )
            for sk, sv in (data.get("episodes_meta") or {}).items()
        }
        prem_s_map = data.get("prem_episodes_map")
        _unrel_memo: Dict[Tuple[int, int], bool] = {}

        def _check_ep_unreleased(s_i: int, e_i: int) -> bool:
            k_unrel = (s_i, e_i)
            cached_u = _unrel_memo.get(k_unrel)
            if cached_u is not None:
                return cached_u
            res_u = bool(
                ctx.is_known_episode_unreleased(
                    item_id=item_id,
                    title=title,
                    orig_title=orig_title,
                    year=year,
                    season=s_i,
                    episode=e_i,
                )
            )
            _unrel_memo[k_unrel] = res_u
            return res_u

        if isinstance(prem_s_map, dict) and prem_s_map:
            for sn_k, prem_list in prem_s_map.items():
                sn_s = str(sn_k)
                s_eps = cur_d_sm.setdefault(sn_s, [])
                s_em = cur_d_em.setdefault(sn_s, {})
                sn_int = int(sn_s) if sn_s.isdigit() else season
                for ep_p in prem_list or []:
                    if not str(ep_p).isdigit() or int(ep_p) <= 0:
                        continue
                    ep_pi = int(ep_p)
                    if _check_ep_unreleased(sn_int, ep_pi):
                        s_em.setdefault(str(ep_pi), {})["is_future"] = True
                        continue
                    s_em.setdefault(str(ep_pi), {})["is_prem_locked"] = True
                    if ep_pi not in s_eps:
                        s_eps.append(ep_pi)
                if s_eps:
                    s_eps.sort()
        if cur_d_sm:
            filtered_stream_sm: Dict[str, List[int]] = {}
            for sn_s, ep_list in cur_d_sm.items():
                s_em = cur_d_em.setdefault(sn_s, {})
                sn_int = int(sn_s) if sn_s.isdigit() else season
                kept_eps: List[int] = []
                for ep_n in ep_list:
                    ep_info_cur = s_em.get(str(ep_n))
                    if isinstance(ep_info_cur, dict) and ep_info_cur.get("is_future"):
                        continue
                    if _check_ep_unreleased(sn_int, int(ep_n)):
                        s_em.setdefault(str(ep_n), {})["is_future"] = True
                        continue
                    kept_eps.append(int(ep_n))
                if kept_eps:
                    filtered_stream_sm[sn_s] = sorted(set(kept_eps))
            data["seasons_map"] = filtered_stream_sm
            data["episodes_meta"] = cur_d_em
            num_sk = [int(k) for k in filtered_stream_sm.keys() if str(k).isdigit() and filtered_stream_sm.get(k)]
            if num_sk:
                max_rs = max(num_sk)
                data["latest_season"] = max_rs
                data["latest_episode"] = max(filtered_stream_sm[str(max_rs)])
    resolved_r_url = str(data.get("rezka_url") or "")
    if (
        media_type == "series"
        and data.get("seasons_map")
        and not (item_id and item_id.isdigit())
        and title.strip().lower() not in ("", "фильм", "сериал", "видео", "movie", "series")
        and "/films/" not in resolved_r_url.lower()
        and str(getattr(ctx.kinorium_service, "_profile_id", "main") or "main") == req_prof_id_st
    ):
        st_names = [s.get("name", "") for s in (data.get("studios") or []) if s.get("name")][:4]
        ctx.kinorium_service.save_series_live_meta(
            [
                {
                    "id": item_id,
                    "title": title,
                    "orig_title": orig_title,
                    "year": year,
                    "media_type": "series",
                    "rezka_id": data.get("rezka_id", ""),
                    "rezka_url": resolved_r_url,
                    "latest_season": data.get("latest_season", season),
                    "latest_episode": data.get("latest_episode", episode),
                    "seasons_map": data.get("seasons_map", {}),
                    "is_completed": bool(data.get("is_completed", False)),
                    "series_status_text": data.get("series_status_text", ""),
                    "studios_summary": ", ".join(st_names) if st_names else "HDRezka",
                    "studios_count": len(data.get("studios") or []),
                    "not_found": False,
                }
            ]
        )
    qualities_map = data.get("qualities") or {}
    if not data.get("remux_session") and qualities_map:
        data["raw_qualities"] = dict(qualities_map)
        proxied_qualities = {
            q_label: ctx.wrap_voidboost_stream_url(q_url, absolute_loopback=False)
            for q_label, q_url in qualities_map.items()
            if q_url
        }
        data["qualities"] = proxied_qualities
        if data.get("default_stream_url"):
            data["default_stream_url"] = ctx.wrap_voidboost_stream_url(
                str(data["default_stream_url"]),
                absolute_loopback=False,
            )
    backup_q_map = data.get("backup_qualities") or {}
    if not data.get("remux_session") and backup_q_map:
        data["raw_backup_qualities"] = dict(backup_q_map)
        wrapped_backups: Dict[str, Any] = {}
        for q_label, q_val in backup_q_map.items():
            if isinstance(q_val, list):
                w_list = [
                    ctx.wrap_voidboost_stream_url(str(u), absolute_loopback=False)
                    for u in q_val
                    if str(u or "").strip()
                ]
                if w_list:
                    wrapped_backups[q_label] = w_list
            elif str(q_val or "").strip():
                wrapped_backups[q_label] = [
                    ctx.wrap_voidboost_stream_url(str(q_val), absolute_loopback=False)
                ]
        data["backup_qualities"] = wrapped_backups
    data["minted_at"] = time.time()

    # Attach external OpenSubtitles when HDRezka stream lacks subtitles or in English mode
    existing_subs = list(data.get("subtitles") or [])
    if len(existing_subs) < 2:
        ext_subs = ctx.stremio_engine.get_subtitles_only(
            item_id=item_id,
            title=title,
            orig_title=orig_title,
            year=year,
            media_type=media_type,
            season=season,
            episode=episode,
            lang=req_lang,
        )
        seen_sub_urls = {str(s.get("url") or "") for s in existing_subs}
        for es in ext_subs[:8]:
            raw_u = str(es.get("raw_url") or es.get("url") or "").strip()
            if not raw_u:
                continue
            if raw_u.startswith("/api/proxy-vtt?"):
                proxied_u = raw_u if "ss=" in raw_u else f"{raw_u}&ss=0"
            else:
                proxied_u = f"/api/proxy-vtt?url={urllib.parse.quote(raw_u, safe='')}&ss=0"
            if proxied_u in seen_sub_urls or raw_u in seen_sub_urls:
                continue
            seen_sub_urls.add(proxied_u)
            seen_sub_urls.add(raw_u)
            sub_label = (
                str(es.get("lang") or es.get("label") or es.get("lang_code") or "").strip()
                or "Subtitles"
            )
            existing_subs.append(
                {
                    "lang": sub_label,
                    "url": proxied_u,
                    "direct_vtt": True,
                }
            )
        data["subtitles"] = existing_subs

    if req_lang == "en":
        en_m = ctx.en_meta_resolver.resolve(
            item_id=item_id,
            title=title,
            orig_title=orig_title,
            year=year,
            media_type=media_type,
            need_episodes=(media_type == "series"),
        )
        if en_m and en_m.get("ok"):
            if en_m.get("description_en"):
                data["description"] = en_m["description_en"]
            elif ctx.has_cyrillic(str(data.get("description") or "")):
                data["description"] = ctx.translate_kinorium_extra_desc_to_en(str(data.get("description") or ""))
            en_cast = ctx.build_english_cast_people(en_m, data.get("cast_people"))
            data["cast_people"] = en_cast
            data["directors"] = [p["name"] for p in en_cast if p.get("is_director")]
            data["actors"] = [p["name"] for p in en_cast if not p.get("is_director")]
            if en_m.get("poster_en"):
                data["poster_en"] = en_m["poster_en"]
            if en_m.get("runtime_min"):
                data["duration_label"] = f"{int(en_m['runtime_min'])} min"
            if en_m.get("episodes_titles_en"):
                merged_ep_t = dict(data.get("episodes_titles") or {})
                for sn_k, ep_dict in en_m["episodes_titles_en"].items():
                    cur_sn = dict(merged_ep_t.get(sn_k) or {})
                    cur_sn.update(ep_dict)
                    merged_ep_t[sn_k] = cur_sn
                data["episodes_titles"] = merged_ep_t
            if en_m.get("episodes_meta_en"):
                merged_ep_m = dict(data.get("episodes_meta") or {})
                for sn_k, ep_dict in en_m["episodes_meta_en"].items():
                    cur_sn_m = dict(merged_ep_m.get(sn_k) or {})
                    for ep_k, ep_info in ep_dict.items():
                        base_ep = dict(cur_sn_m.get(ep_k) or {})
                        was_future = bool(base_ep.get("is_future"))
                        base_ep.update({k: v for k, v in ep_info.items() if v or isinstance(v, bool)})
                        if was_future:
                            base_ep["is_future"] = True
                        cur_sn_m[ep_k] = base_ep
                    merged_ep_m[sn_k] = cur_sn_m
                data["episodes_meta"] = merged_ep_m
                if media_type == "series" and isinstance(data.get("seasons_map"), dict):
                    en_filtered_sm: Dict[str, List[int]] = {}
                    for sn_s, ep_nums in data["seasons_map"].items():
                        s_em = merged_ep_m.get(str(sn_s)) or {}
                        kept = [
                            int(ep_n)
                            for ep_n in (ep_nums or [])
                            if str(ep_n).isdigit() and not bool((s_em.get(str(ep_n)) or {}).get("is_future"))
                        ]
                        if kept:
                            en_filtered_sm[str(sn_s)] = sorted(set(kept))
                    data["seasons_map"] = en_filtered_sm
                    num_sk_en = [int(k) for k in en_filtered_sm.keys() if str(k).isdigit() and en_filtered_sm.get(k)]
                    if num_sk_en:
                        max_rs_en = max(num_sk_en)
                        data["latest_season"] = max_rs_en
                        data["latest_episode"] = max(en_filtered_sm[str(max_rs_en)])
        data["episodes_titles"], data["episodes_meta"] = ctx.scrub_cyrillic_episode_dicts(
            data.get("episodes_titles"), data.get("episodes_meta")
        )

    if getattr(ctx, "verbose_log", False):
        ctx.safe_log(
            f"[Velarium-DEBUG] streams resp: qualities={len(data.get('qualities') or {})} def_url={bool(data.get('default_stream_url'))} tr={data.get('selected_translator_id')} err={data.get('error')}\n"
        )
    handler._send_json(data)
    return True


def handle_hdrezka_check_watching_updates(handler, qs: Dict[str, Any], parsed, ctx) -> bool:
    if not ctx.kinorium_service.is_service_enabled("hdrezka") or not ctx.kinorium_service.is_service_enabled("kinorium"):
        handler._send_json(
            {
                "ok": True,
                "checked_count": 0,
                "remaining_unchecked": 0,
                "updates": [],
            }
        )
        return True

    has_upd_auth = handler._is_loopback_client() or ctx.remote_broker.verify_key(qs.get("k", [""])[0].strip())
    force_refresh = qs.get("force", ["0"])[0] in ("1", "true", "yes") and has_upd_auth
    req_profile_id = str(getattr(ctx.kinorium_service, "_profile_id", "main") or "main")
    all_watching_series = ctx.aggregator._enrich_from_curated(
        ctx.kinorium_service.get_section_catalog_items(
            section="watching",
            media_type_filter="series",
            query="",
            include_caught_up=True,
        )
    )
    if ctx.profile_manager.is_kids_mode_active():
        all_watching_series = [
            it
            for it in all_watching_series
            if ctx.profile_manager.is_item_kids_safe(
                it
                if (it.get("genres") or it.get("description") or it.get("age_rating"))
                else {**it, "genres": ["семейный"]}
            )
        ]
    max_check_yr = time.localtime().tm_year + 1
    active_candidates = [
        it
        for it in all_watching_series
        if not (it.get("kinorium") or {}).get("not_watching")
        and (ctx.safe_int(it.get("year"), 0) == 0 or ctx.safe_int(it.get("year"), 0) <= max_check_yr)
    ]

    now_ts = time.time()
    ttl_sec = 21600.0  # 6 hours
    cached_valid = []
    to_check = []

    for it in active_candidates:
        ks = it.get("kinorium") or {}
        cached_m = ctx.kinorium_service.get_series_live_meta(
            item_id=str(it.get("id") or ""),
            title=str(it.get("title") or ""),
            orig_title=str(it.get("orig_title") or ""),
            kid=ks.get("kinorium_id"),
        )
        is_fresh = bool(
            cached_m
            and not force_refresh
            and (now_ts - float(cached_m.get("updated_at") or 0.0)) < ttl_sec
        )
        if is_fresh:
            if not cached_m.get("not_found"):
                cached_valid.append(cached_m)
        else:
            to_check.append(it)

    batch_size = 8
    fresh_results = ctx.rezka_client.check_series_latest_episodes(to_check[:batch_size], batch_limit=batch_size)
    if fresh_results and str(getattr(ctx.kinorium_service, "_profile_id", "main") or "main") == req_profile_id:
        ctx.kinorium_service.save_series_live_meta(fresh_results)

    fresh_valid = [u for u in fresh_results if not u.get("not_found")]
    combined_updates = cached_valid + fresh_valid
    remaining = max(0, len(to_check) - len(to_check[:batch_size]))

    handler._send_json(
        {
            "ok": True,
            "checked_count": len(combined_updates),
            "newly_checked": len(fresh_results),
            "remaining_unchecked": remaining,
            "updates": combined_updates,
            "kinorium_counts": ctx.kinorium_service.get_sections_counts(),
        }
    )
    return True


def handle_stremio_addons_get(handler, qs: Dict[str, Any], parsed, ctx) -> bool:
    req_lang = ctx.norm_app_lang(qs.get("lang", [ctx.app_prefs.get("app_lang", "ru")])[0], ctx.app_prefs.get("app_lang", "ru"))
    addons_out = ctx.redact_stremio_addons_for_client(
        ctx.stremio_engine.get_addons(lang=req_lang),
        handler._is_loopback_client(),
    )
    handler._send_json({"ok": True, "addons": addons_out})
    return True


def handle_stremio_streams_get(handler, qs: Dict[str, Any], parsed, ctx) -> bool:
    item_id = qs.get("id", [""])[0]
    imdb_id = qs.get("imdb_id", [""])[0].strip()
    title = qs.get("title", [""])[0]
    orig_title = qs.get("orig_title", [""])[0]
    year = ctx.qs_int(qs, "year", 0)
    media_type = qs.get("media_type", ["movie"])[0]
    season = max(1, ctx.qs_int(qs, "season", 1))
    episode = max(1, ctx.qs_int(qs, "episode", 1))
    req_lang = ctx.norm_app_lang(qs.get("lang", [ctx.app_prefs.get("app_lang", "ru")])[0], ctx.app_prefs.get("app_lang", "ru"))
    if ctx.profile_manager.is_kids_mode_active():
        cand_item = ctx.build_trusted_item_for_kids_check(
            item_id=item_id or imdb_id,
            title=title,
            orig_title=orig_title,
            media_type=media_type,
        )
        probe_st = (
            cand_item
            if (cand_item.get("genres") or cand_item.get("description") or cand_item.get("age_rating"))
            else {**cand_item, "genres": ["семейный"]}
        )
        if not (cand_item.get("title") or cand_item.get("orig_title") or cand_item.get("genres")) or not ctx.profile_manager.is_item_kids_safe(probe_st):
            handler._send_json({"ok": False, "error": ctx.msg("Контент недоступен в детском профиле", "Content restricted in Kids Mode", req_lang)}, status=403)
            return True
    st_data = ctx.stremio_engine.get_streams_for_title(
        item_id=item_id,
        title=title,
        orig_title=orig_title,
        year=year,
        media_type=media_type,
        season=season,
        episode=episode,
        lang=req_lang,
        imdb_id=imdb_id,
    )
    st_data["remux_available"] = ctx.remux_engine.is_available()
    if getattr(ctx.net_client, "local_media_proxy", False) and st_data.get("streams"):
        proxied_streams = []
        for s in st_data["streams"]:
            sc = dict(s)
            if sc.get("stream_kind") == "direct_http":
                du = str(sc.get("direct_url") or "").strip()
                if du and ctx.is_allowed_media_source_url(du, allow_torrserver_loopback=False):
                    sc["direct_url"] = ctx.wrap_voidboost_stream_url(du)
            proxied_streams.append(sc)
        st_data = dict(st_data)
        st_data["streams"] = proxied_streams
    handler._send_json(st_data)
    return True


def handle_remux_probe(handler, qs: Dict[str, Any], parsed, ctx) -> bool:
    src_url = (qs.get("src") or qs.get("url") or [""])[0].strip()
    if not ctx.is_allowed_media_source_url(src_url, allow_torrserver_loopback=True):
        handler._send_json({"ok": False, "error": "Disallowed media source URL"}, status=400)
        return True
    req_lang = ctx.norm_app_lang(qs.get("lang", [ctx.app_prefs.get("app_lang", "ru")])[0], ctx.app_prefs.get("app_lang", "ru"))
    is_full = qs.get("full", ["0"])[0].strip().lower() in ("1", "true", "yes")
    handler._send_json(ctx.remux_engine.probe_media(src_url, fast_probe=not is_full, lang=req_lang))
    return True


def handle_remux_subtitle(handler, qs: Dict[str, Any], parsed, ctx) -> bool:
    src_url = qs.get("src", [""])[0].strip()
    if not ctx.is_allowed_media_source_url(src_url, allow_torrserver_loopback=True):
        handler._send_json({"error": "Disallowed subtitle source URL"}, status=400)
        return True
    stream_idx = max(0, ctx.qs_int(qs, "si", 0))
    start_sec = max(0.0, ctx.qs_float(qs, "ss", 0.0))
    window_sec = max(60.0, min(600.0, ctx.qs_float(qs, "dur", 150.0)))
    vtt_text = ctx.remux_engine.extract_subtitle_vtt(
        src_url,
        stream_idx,
        start_sec=start_sec,
        window_sec=window_sec,
    )
    vtt_bytes = vtt_text.encode("utf-8")
    handler.send_response(200)
    handler.send_header("Content-Type", "text/vtt; charset=utf-8")
    handler.send_header("Content-Length", str(len(vtt_bytes)))
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.end_headers()
    handler.wfile.write(vtt_bytes)
    return True


# ---------------------------------------------------------------------------
# POST Handlers
# ---------------------------------------------------------------------------

def handle_stremio_addons_post(handler, qs: Dict[str, Any], parsed, body: Dict[str, Any], ctx) -> bool:
    req_lang = ctx.norm_app_lang(body.get("lang", ctx.app_prefs.get("app_lang", "ru")), ctx.app_prefs.get("app_lang", "ru"))
    if not handler._require_authorized_client_if_lan(body, req_lang):
        return True
    if not handler._require_kids_pin_if_locked(
        str(body.get("pin") or body.get("current_pin") or ""),
        lang=req_lang,
    ):
        return True
    is_local_st = handler._is_loopback_client()
    action = str(body.get("action") or "add").strip().lower()
    if action in ("add", "remove", "restore") and not is_local_st:
        handler._send_json(
            {
                "ok": False,
                "error": ctx.msg(
                    "Установка и удаление аддонов разрешены только на основном компьютере",
                    "Installing or removing addons is only allowed on the host computer",
                    req_lang,
                ),
            },
            status=403,
        )
        return True
    if action == "add":
        res = ctx.stremio_engine.add_addon_by_url(str(body.get("manifest_url") or ""), lang=req_lang)
        if isinstance(res.get("addons"), list):
            res["addons"] = ctx.stremio_engine.get_addons(lang=req_lang)
        ctx.aggregator.invalidate_catalog_cache()
        handler._send_json(res, status=200 if res.get("ok") else 400)
        return True
    if action == "toggle":
        res = ctx.stremio_engine.toggle_addon(
            str(body.get("manifest_url") or body.get("id") or ""),
            bool(body.get("enabled", True)),
        )
        res["addons"] = ctx.redact_stremio_addons_for_client(
            ctx.stremio_engine.get_addons(lang=req_lang),
            is_local_st,
        )
        ctx.aggregator.invalidate_catalog_cache()
        handler._send_json(res)
        return True
    if action == "remove":
        res = ctx.stremio_engine.remove_addon(str(body.get("manifest_url") or body.get("id") or ""))
        res["addons"] = ctx.stremio_engine.get_addons(lang=req_lang)
        ctx.aggregator.invalidate_catalog_cache()
        handler._send_json(res)
        return True
    if action == "restore":
        ctx.stremio_engine.restore_addons(body.get("addons"))
        ctx.aggregator.invalidate_catalog_cache()
        handler._send_json({"ok": True, "addons": ctx.stremio_engine.get_addons(lang=req_lang)})
        return True
    handler._send_json({"ok": False, "error": "Unknown action"}, status=400)
    return True


def handle_stremio_resolve_post(handler, qs: Dict[str, Any], parsed, body: Dict[str, Any], ctx) -> bool:
    req_lang = ctx.norm_app_lang(body.get("lang", ctx.app_prefs.get("app_lang", "ru")), ctx.app_prefs.get("app_lang", "ru"))
    if not handler._require_authorized_client_if_lan(body, lang=req_lang):
        return True
    raw_fidx = body.get("file_idx")
    file_idx_val = int(raw_fidx) if isinstance(raw_fidx, int) and not isinstance(raw_fidx, bool) and raw_fidx >= 0 else None
    magnet_val = str(body.get("magnet") or "").strip()
    info_hash_val = str(body.get("info_hash") or "").strip()
    if not magnet_val and info_hash_val and len(info_hash_val) >= 32:
        magnet_val = f"magnet:?xt=urn:btih:{info_hash_val}"
    if ctx.profile_manager.is_kids_mode_active():
        dn_sr = ctx.extract_magnet_display_name(magnet_val)
        cand_sr = ctx.build_trusted_item_for_kids_check(
            item_id=str(body.get("id") or ""),
            title=str(body.get("title") or body.get("filename_hint") or dn_sr or ""),
            orig_title=str(body.get("orig_title") or ""),
            media_type=str(body.get("media_type") or "movie"),
        )
        probe_sr = (
            cand_sr
            if (cand_sr.get("genres") or cand_sr.get("description") or cand_sr.get("age_rating"))
            else {**cand_sr, "genres": ["семейный"]}
        )
        if not (cand_sr.get("title") or cand_sr.get("orig_title") or cand_sr.get("genres")) or not ctx.profile_manager.is_item_kids_safe(probe_sr):
            handler._send_json({"ok": False, "error": ctx.msg("Контент недоступен в детском профиле", "Content restricted in Kids Mode", req_lang)}, status=403)
            return True
    res = ctx.stremio_engine.resolve_stream_to_playable_url(
        magnet=magnet_val,
        filename_hint=str(body.get("filename_hint") or ""),
        file_idx=file_idx_val,
        media_type=str(body.get("media_type") or "movie"),
        season=max(1, ctx.safe_int(body.get("season"), 1)),
        episode=max(1, ctx.safe_int(body.get("episode"), 1)),
        lang=req_lang,
        year=ctx.safe_int(body.get("year"), 0),
        title=str(body.get("title") or ""),
        orig_title=str(body.get("orig_title") or ""),
    )
    handler._send_json(res, status=200 if res.get("ok") else 400)
    return True
