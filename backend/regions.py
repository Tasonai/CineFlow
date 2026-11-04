from typing import Any, Dict, List, Optional

# Complete European Countries Registry (50 countries across all of Europe)
# Defines regional streaming availability, ISP/DPI censorship characteristics,
# P2P legal enforcement, DNS-over-HTTPS routing, media stream relay rules,
# and optimal HDRezka studio/mirror routing per European country.

_RAW_EU_COUNTRIES: List[Dict[str, Any]] = [
    {"code": "AT", "ru": "Австрия", "en": "Austria", "lang": "de-AT,de;q=0.9", "profile": "at_nl_isp_dns", "jw": "AT"},
    {"code": "AZ", "ru": "Азербайджан", "en": "Azerbaijan", "lang": "az-AZ,ru;q=0.9", "profile": "cis_direct", "jw": "PL"},
    {"code": "AL", "ru": "Албания", "en": "Albania", "lang": "sq-AL,en;q=0.8", "profile": "eu_standard", "jw": "AL"},
    {"code": "AD", "ru": "Андорра", "en": "Andorra", "lang": "ca-AD,es;q=0.9", "profile": "es_pt_laliga_ip", "jw": "ES"},
    {"code": "AM", "ru": "Армения", "en": "Armenia", "lang": "hy-AM,ru;q=0.9", "profile": "cis_direct", "jw": "PL"},
    {"code": "BY", "ru": "Беларусь", "en": "Belarus", "lang": "ru-BY,be;q=0.9", "profile": "by_isp_filter", "jw": "PL"},
    {"code": "BE", "ru": "Бельгия", "en": "Belgium", "lang": "nl-BE,fr-BE;q=0.9", "profile": "fr_arcom_dns", "jw": "BE"},
    {"code": "BG", "ru": "Болгария", "en": "Bulgaria", "lang": "bg-BG,en;q=0.8", "profile": "at_nl_isp_dns", "jw": "BG"},
    {"code": "BA", "ru": "Босния и Герцеговина", "en": "Bosnia and Herzegovina", "lang": "bs-BA,hr;q=0.8", "profile": "eu_standard", "jw": "BA"},
    {"code": "VA", "ru": "Ватикан", "en": "Vatican City", "lang": "it-VA,it;q=0.9", "profile": "it_piracy_shield", "jw": "IT"},
    {"code": "GB", "ru": "Великобритания", "en": "United Kingdom", "lang": "en-GB,en;q=0.9", "profile": "uk_isp_block", "jw": "GB"},
    {"code": "HU", "ru": "Венгрия", "en": "Hungary", "lang": "hu-HU,en;q=0.8", "profile": "eu_standard", "jw": "HU"},
    {"code": "DE", "ru": "Германия", "en": "Germany", "lang": "de-DE,de;q=0.9", "profile": "de_strict_p2p", "jw": "DE"},
    {"code": "GR", "ru": "Греция", "en": "Greece", "lang": "el-GR,en;q=0.8", "profile": "at_nl_isp_dns", "jw": "GR"},
    {"code": "GE", "ru": "Грузия", "en": "Georgia", "lang": "ka-GE,ru;q=0.8", "profile": "cis_direct", "jw": "PL"},
    {"code": "DK", "ru": "Дания", "en": "Denmark", "lang": "da-DK,en;q=0.9", "profile": "nordic_isp_dns", "jw": "DK"},
    {"code": "IE", "ru": "Ирландия", "en": "Ireland", "lang": "en-IE,en;q=0.9", "profile": "uk_isp_block", "jw": "IE"},
    {"code": "IS", "ru": "Исландия", "en": "Iceland", "lang": "is-IS,en;q=0.9", "profile": "eu_standard", "jw": "IS"},
    {"code": "ES", "ru": "Испания", "en": "Spain", "lang": "es-ES,es;q=0.9", "profile": "es_pt_laliga_ip", "jw": "ES"},
    {"code": "IT", "ru": "Италия", "en": "Italy", "lang": "it-IT,it;q=0.9", "profile": "it_piracy_shield", "jw": "IT"},
    {"code": "CY", "ru": "Кипр", "en": "Cyprus", "lang": "el-CY,en;q=0.9", "profile": "eu_standard", "jw": "CY"},
    {"code": "XK", "ru": "Косово", "en": "Kosovo", "lang": "sq-XK,en;q=0.8", "profile": "eu_standard", "jw": "AL"},
    {"code": "LV", "ru": "Латвия", "en": "Latvia", "lang": "lv-LV,ru;q=0.8", "profile": "baltic_block", "jw": "LV"},
    {"code": "LT", "ru": "Литва", "en": "Lithuania", "lang": "lt-LT,ru;q=0.8", "profile": "baltic_block", "jw": "LT"},
    {"code": "LI", "ru": "Лихтенштейн", "en": "Liechtenstein", "lang": "de-LI,de;q=0.9", "profile": "eu_standard", "jw": "CH"},
    {"code": "LU", "ru": "Люксембург", "en": "Luxembourg", "lang": "fr-LU,de-LU;q=0.9", "profile": "eu_standard", "jw": "LU"},
    {"code": "MT", "ru": "Мальта", "en": "Malta", "lang": "mt-MT,en;q=0.9", "profile": "eu_standard", "jw": "MT"},
    {"code": "MD", "ru": "Молдова", "en": "Moldova", "lang": "ro-MD,ru;q=0.9", "profile": "cis_moldova", "jw": "MD"},
    {"code": "MC", "ru": "Монако", "en": "Monaco", "lang": "fr-MC,fr;q=0.9", "profile": "fr_arcom_dns", "jw": "FR"},
    {"code": "NL", "ru": "Нидерланды", "en": "Netherlands", "lang": "nl-NL,en;q=0.9", "profile": "at_nl_isp_dns", "jw": "NL"},
    {"code": "NO", "ru": "Норвегия", "en": "Norway", "lang": "nb-NO,en;q=0.9", "profile": "nordic_isp_dns", "jw": "NO"},
    {"code": "PL", "ru": "Польша", "en": "Poland", "lang": "pl-PL,pl;q=0.9", "profile": "pl_cee_dns", "jw": "PL"},
    {"code": "PT", "ru": "Португалия", "en": "Portugal", "lang": "pt-PT,pt;q=0.9", "profile": "es_pt_laliga_ip", "jw": "PT"},
    {"code": "RU", "ru": "Россия", "en": "Russia", "lang": "ru-RU,ru;q=0.9", "profile": "ru_rkn_dpi", "jw": "PL"},
    {"code": "RO", "ru": "Румыния", "en": "Romania", "lang": "ro-RO,en;q=0.8", "profile": "at_nl_isp_dns", "jw": "RO"},
    {"code": "SM", "ru": "Сан-Марино", "en": "San Marino", "lang": "it-SM,it;q=0.9", "profile": "it_piracy_shield", "jw": "IT"},
    {"code": "MK", "ru": "Северная Македония", "en": "North Macedonia", "lang": "mk-MK,en;q=0.8", "profile": "eu_standard", "jw": "MK"},
    {"code": "RS", "ru": "Сербия", "en": "Serbia", "lang": "sr-RS,en;q=0.8", "profile": "eu_standard", "jw": "RS"},
    {"code": "SK", "ru": "Словакия", "en": "Slovakia", "lang": "sk-SK,cs;q=0.8", "profile": "pl_cee_dns", "jw": "SK"},
    {"code": "SI", "ru": "Словения", "en": "Slovenia", "lang": "sl-SI,en;q=0.8", "profile": "eu_standard", "jw": "SI"},
    {"code": "TR", "ru": "Турция", "en": "Turkey", "lang": "tr-TR,en;q=0.8", "profile": "tr_btk_dns", "jw": "TR"},
    {"code": "UA", "ru": "Украина", "en": "Ukraine", "lang": "uk-UA,ru;q=0.8", "profile": "ua_dpi_block", "jw": "UA"},
    {"code": "FI", "ru": "Финляндия", "en": "Finland", "lang": "fi-FI,en;q=0.9", "profile": "nordic_isp_dns", "jw": "FI"},
    {"code": "FR", "ru": "Франция", "en": "France", "lang": "fr-FR,fr;q=0.9", "profile": "fr_arcom_dns", "jw": "FR"},
    {"code": "HR", "ru": "Хорватия", "en": "Croatia", "lang": "hr-HR,en;q=0.8", "profile": "eu_standard", "jw": "HR"},
    {"code": "ME", "ru": "Черногория", "en": "Montenegro", "lang": "sr-ME,en;q=0.8", "profile": "eu_standard", "jw": "ME"},
    {"code": "CZ", "ru": "Чехия", "en": "Czechia", "lang": "cs-CZ,en;q=0.8", "profile": "pl_cee_dns", "jw": "CZ"},
    {"code": "CH", "ru": "Швейцария", "en": "Switzerland", "lang": "de-CH,fr-CH;q=0.9", "profile": "eu_standard", "jw": "CH"},
    {"code": "SE", "ru": "Швеция", "en": "Sweden", "lang": "sv-SE,en;q=0.9", "profile": "nordic_isp_dns", "jw": "SE"},
    {"code": "EE", "ru": "Эстония", "en": "Estonia", "lang": "et-EE,ru;q=0.8", "profile": "baltic_block", "jw": "EE"},
]

_BYPASS_PROFILES: Dict[str, Dict[str, Any]] = {
    "de_strict_p2p": {
        "doh_enabled": True,
        "hdrezka_spoof": "KZ",
        "p2p_strict": True,
        "local_media_proxy": False,
        "kinorium_domain_fallback": True,
        "mirror_priority": ["https://hdrezka-home.tv", "https://hdrezka.me", "https://hdrezka.ag", "https://rezka.ag"],
        "restrictions_ru": "Юридический мониторинг открытых торрент-сетей P2P (штрафы Abmahnung), DNS-блокировки провайдеров CUII и региональная фильтрация озвучек",
        "restrictions_en": "Strict legal P2P swarm monitoring (Abmahnung fines), CUII ISP DNS blocks, and EU studio geo-filtering",
        "summary_ru": "DoH-обход блокировок CUII (1.1.1.1 / 8.8.8.8), защита от P2P (автоотключение открытого торрента в пользу HTTPS / Debrid) и разблокировка озвучек HDRezka",
        "summary_en": "DoH bypass for CUII ISP blocks (1.1.1.1 / 8.8.8.8), anti-P2P protection (HTTPS / Debrid only, bare torrent swarm disabled), and HDRezka studio unlock",
        "tags_ru": ["Защита от P2P (HTTPS вместо торрентов)", "Шифрованный DoH CUII", "Разблокировка студий (KZ)"],
        "tags_en": ["Anti-P2P Mode (HTTPS Only)", "CUII Encrypted DoH", "Studio Geo-Unlock (KZ)"],
    },
    "it_piracy_shield": {
        "doh_enabled": True,
        "hdrezka_spoof": "KZ",
        "p2p_strict": False,
        "local_media_proxy": True,
        "kinorium_domain_fallback": True,
        "mirror_priority": ["https://hdrezka-home.tv", "https://hdrezka.me", "https://hdrezka.ag", "https://rezka.ag"],
        "restrictions_ru": "Национальная система AGCOM Piracy Shield (динамические блокировки доменов и CDN-узлов по DNS и IP)",
        "restrictions_en": "AGCOM Piracy Shield national DNS and CDN IP blackholing",
        "summary_ru": "Обход фильтрации AGCOM Piracy Shield через многоканальный DNS-over-HTTPS, локальный прокси-релей потоков и нейтральный регион HDRezka",
        "summary_en": "Multi-resolver DNS-over-HTTPS bypass for AGCOM Piracy Shield, local stream relay, and neutral HDRezka routing",
        "tags_ru": ["Обход Piracy Shield (DoH)", "Локальный прокси потоков", "Разблокировка студий (KZ)"],
        "tags_en": ["Piracy Shield DoH Bypass", "Local Stream Relay", "Studio Geo-Unlock (KZ)"],
    },
    "ru_rkn_dpi": {
        "doh_enabled": True,
        "hdrezka_spoof": "KZ",
        "p2p_strict": False,
        "local_media_proxy": True,
        "kinorium_domain_fallback": True,
        "mirror_priority": ["https://hdrezka-home.tv", "https://hdrezka.me", "https://hdrezka.ag", "https://rezka.ag"],
        "restrictions_ru": "Реестровые блокировки Роскомнадзора, фильтрация ТСПУ (DPI / SNI) зеркал, трекеров и ограничение зарубежных студий дубляжа",
        "restrictions_en": "Roskomnadzor registry blocks, TSPU DPI / SNI filtering on mirrors and trackers, and studio geo-locks",
        "summary_ru": "Шифрованный DoH (Cloudflare / Google / Quad9), локальный релей видеопотоков, ротация рабочих зеркал и нейтральный регион KZ для открытия всех студий озвучки",
        "summary_en": "Encrypted DoH (Cloudflare / Google / Quad9), local media stream relay, mirror rotation, and KZ geo-routing to unlock all dubbing studios",
        "tags_ru": ["Обход РКН и DPI (DoH)", "Локальный прокси потоков", "Все студии дубляжа (KZ)"],
        "tags_en": ["RKN & DPI DoH Bypass", "Local Stream Relay", "All Dubbing Studios (KZ)"],
    },
    "ua_dpi_block": {
        "doh_enabled": True,
        "hdrezka_spoof": "KZ",
        "p2p_strict": False,
        "local_media_proxy": True,
        "kinorium_domain_fallback": True,
        "mirror_priority": ["https://hdrezka-home.tv", "https://hdrezka.me", "https://hdrezka.ag", "https://rezka.ag"],
        "restrictions_ru": "Провайдерская DPI и DNS-фильтрация доменов НЦУ (включая зеркала HDRezka, трекеры и домены Kinorium)",
        "restrictions_en": "ISP DPI and NCEC DNS domain filtering across mirrors, trackers, and Kinorium domains",
        "summary_ru": "Обход провайдерских DPI и DNS-блокировок через шифрованный DoH, резервный маршрут к Kinorium, локальный прокси потоков и разблокировка студий HDRezka",
        "summary_en": "Encrypted DoH bypass for ISP DPI and DNS blocks, resilient Kinorium routing, local stream relay, and HDRezka studio unlock",
        "tags_ru": ["Обход DPI и DNS (DoH)", "Маршрут Kinorium", "Разблокировка студий (KZ)"],
        "tags_en": ["ISP DPI & DoH Bypass", "Kinorium Fallback Route", "Studio Geo-Unlock (KZ)"],
    },
    "by_isp_filter": {
        "doh_enabled": True,
        "hdrezka_spoof": "KZ",
        "p2p_strict": False,
        "local_media_proxy": False,
        "kinorium_domain_fallback": False,
        "mirror_priority": ["https://hdrezka-home.tv", "https://hdrezka.me", "https://rezka.ag", "https://hdrezka.ag"],
        "restrictions_ru": "Республиканский список ограничения доступа (DNS и SNI-фильтрация основных зеркал видеосервисов)",
        "restrictions_en": "National ISP DNS and SNI access restriction list on primary streaming mirrors",
        "summary_ru": "Обход блокировок зеркал через DNS-over-HTTPS, автоподбор рабочего зеркала HDRezka и прямой доступ к торрент-трекерам",
        "summary_en": "DNS-over-HTTPS mirror unblock, automatic HDRezka mirror selection, and direct tracker access",
        "tags_ru": ["Шифрованный DoH", "Авторотация зеркал", "Разблокировка студий (KZ)"],
        "tags_en": ["Encrypted DoH", "Auto Mirror Rotation", "Studio Geo-Unlock (KZ)"],
    },
    "baltic_block": {
        "doh_enabled": True,
        "hdrezka_spoof": "KZ",
        "p2p_strict": False,
        "local_media_proxy": True,
        "kinorium_domain_fallback": True,
        "mirror_priority": ["https://hdrezka-home.tv", "https://hdrezka.me", "https://hdrezka.ag", "https://rezka.ag"],
        "restrictions_ru": "Национальные реестры блокировок регуляторов (NEPLP, LRTK, TTJA) на уровне DNS провайдеров и гео-блокировки ЕС",
        "restrictions_en": "National regulator DNS blacklists (NEPLP, LRTK, TTJA) and EU studio geo-restrictions",
        "summary_ru": "Обход реестровых DNS и SNI-блокировок доменов через DoH, резервный маршрут к Kinorium, прокси потоков и разблокировка студий HDRezka",
        "summary_en": "DoH bypass for national registry DNS and SNI domain blocks, fallback Kinorium routing, stream relay, and HDRezka studio unlock",
        "tags_ru": ["Обход реестров Балтии (DoH)", "Маршрут Kinorium", "Разблокировка студий (KZ)"],
        "tags_en": ["Baltic Registry DoH Bypass", "Kinorium Fallback Route", "Studio Geo-Unlock (KZ)"],
    },
    "tr_btk_dns": {
        "doh_enabled": True,
        "hdrezka_spoof": "KZ",
        "p2p_strict": False,
        "local_media_proxy": True,
        "kinorium_domain_fallback": True,
        "mirror_priority": ["https://hdrezka-home.tv", "https://hdrezka.me", "https://hdrezka.ag", "https://rezka.ag"],
        "restrictions_ru": "Фильтрация доменов регулятором BTK, перехват системного DNS у провайдеров и ограничения зарубежных CDN",
        "restrictions_en": "BTK domain filtering, ISP DNS interception, and foreign CDN restrictions",
        "summary_ru": "Обход перехвата DNS регулятора BTK через шифрованный DoH, локальный прокси потоков и нейтральная маршрутизация студий HDRezka",
        "summary_en": "Encrypted DoH bypass for BTK DNS interception, local stream relay, and neutral HDRezka studio routing",
        "tags_ru": ["Обход фильтрации BTK (DoH)", "Локальный прокси потоков", "Разблокировка студий (KZ)"],
        "tags_en": ["BTK Encrypted DoH", "Local Stream Relay", "Studio Geo-Unlock (KZ)"],
    },
    "uk_isp_block": {
        "doh_enabled": True,
        "hdrezka_spoof": "KZ",
        "p2p_strict": False,
        "local_media_proxy": False,
        "kinorium_domain_fallback": True,
        "mirror_priority": ["https://hdrezka-home.tv", "https://hdrezka.me", "https://hdrezka.ag", "https://rezka.ag"],
        "restrictions_ru": "Судебные блокировки High Court ISP WebBlocking (Sky, BT, Virgin, Eir) для торрент-индексаторов, аддонов Torrentio и зеркал",
        "restrictions_en": "High Court ISP WebBlocking (Sky, BT, Virgin, Eir) on torrent indexers, Torrentio addons, and streaming mirrors",
        "summary_ru": "Обход провайдерского WebBlocking через шифрованный DoH (1.1.1.1 / 8.8.8.8) для Torrentio, JacRed и HDRezka + снятие гео-ограничений озвучек",
        "summary_en": "Encrypted DoH bypass (1.1.1.1 / 8.8.8.8) for ISP WebBlocking on Torrentio, JacRed, and HDRezka + studio geo-unlock",
        "tags_ru": ["Обход ISP WebBlocking (DoH)", "Доступ к Torrentio и JacRed", "Разблокировка студий (KZ)"],
        "tags_en": ["ISP WebBlocking DoH Bypass", "Torrentio & JacRed Unlock", "Studio Geo-Unlock (KZ)"],
    },
    "nordic_isp_dns": {
        "doh_enabled": True,
        "hdrezka_spoof": "KZ",
        "p2p_strict": False,
        "local_media_proxy": False,
        "kinorium_domain_fallback": True,
        "mirror_priority": ["https://hdrezka-home.tv", "https://hdrezka.me", "https://hdrezka.ag", "https://rezka.ag"],
        "restrictions_ru": "Скандинавские DNS-блокировки провайдеров (Rettighetsalliansen и суды по авторским правам) для трекеров и стриминговых зеркал",
        "restrictions_en": "Nordic ISP DNS blocks (Rettighetsalliansen & IP courts) on trackers and streaming mirrors",
        "summary_ru": "Шифрованный DoH в обход DNS-фильтров скандинавских операторов и нейтральный регион KZ для всех озвучек и оригинала HDRezka",
        "summary_en": "Encrypted DoH bypassing Nordic ISP DNS filters plus KZ geo-routing for full HDRezka studio and original audio access",
        "tags_ru": ["Шифрованный DoH (Скандинавия)", "Разблокировка трекеров", "Разблокировка студий (KZ)"],
        "tags_en": ["Nordic Encrypted DoH", "Tracker & Addon Unlock", "Studio Geo-Unlock (KZ)"],
    },
    "fr_arcom_dns": {
        "doh_enabled": True,
        "hdrezka_spoof": "KZ",
        "p2p_strict": False,
        "local_media_proxy": False,
        "kinorium_domain_fallback": True,
        "mirror_priority": ["https://hdrezka-home.tv", "https://hdrezka.me", "https://hdrezka.ag", "https://rezka.ag"],
        "restrictions_ru": "Динамические DNS-предписания регулятора ARCOM и провайдерские блокировки зеркал во Франции, Бельгии и Монако",
        "restrictions_en": "ARCOM dynamic ISP DNS blocking orders on streaming mirrors and indexers",
        "summary_ru": "Обход динамических DNS-блокировок ARCOM через шифрованный DoH, приоритет незаблокированных зеркал и снятие гео-блокировок студий ЕС",
        "summary_en": "Encrypted DoH bypass for ARCOM dynamic DNS blocks, unblocked mirror priority, and EU studio geo-unlock",
        "tags_ru": ["Обход ARCOM DNS (DoH)", "Приоритет зеркал", "Разблокировка студий (KZ)"],
        "tags_en": ["ARCOM DoH Bypass", "Mirror Priority", "Studio Geo-Unlock (KZ)"],
    },
    "es_pt_laliga_ip": {
        "doh_enabled": True,
        "hdrezka_spoof": "KZ",
        "p2p_strict": False,
        "local_media_proxy": True,
        "kinorium_domain_fallback": True,
        "mirror_priority": ["https://hdrezka-home.tv", "https://hdrezka.me", "https://hdrezka.ag", "https://rezka.ag"],
        "restrictions_ru": "Динамические блокировки CDN и DNS у операторов Испании и Португалии (Telefónica, IGAC) и гео-ограничения ЕС",
        "restrictions_en": "Dynamic ISP CDN and DNS blocks in Spain and Portugal (Telefónica, IGAC) and EU studio geo-locks",
        "summary_ru": "Шифрованный DoH, локальный прокси-релей видеопотоков против обрывов CDN и нейтральная маршрутизация озвучек HDRezka",
        "summary_en": "Encrypted DoH, local media stream relay against ISP CDN drops, and neutral HDRezka studio routing",
        "tags_ru": ["Шифрованный DoH", "Локальный прокси CDN", "Разблокировка студий (KZ)"],
        "tags_en": ["Encrypted DoH", "Local CDN Stream Relay", "Studio Geo-Unlock (KZ)"],
    },
    "pl_cee_dns": {
        "doh_enabled": True,
        "hdrezka_spoof": "KZ",
        "p2p_strict": False,
        "local_media_proxy": False,
        "kinorium_domain_fallback": True,
        "mirror_priority": ["https://hdrezka-home.tv", "https://hdrezka.ag", "https://rezka.ag", "https://hdrezka.me"],
        "restrictions_ru": "Провайдерские DNS-заглушки в Центральной Европе и региональная блокировка дубляжа и оригинальных дорожек в ЕС",
        "restrictions_en": "Central European ISP DNS warning pages and EU geo-restrictions on dubbing and original audio tracks",
        "summary_ru": "Шифрованный DoH-обход провайдерских DNS-блокировок, авторешение защиты Anubis и разблокировка всех студий HDRezka без VPN",
        "summary_en": "Encrypted DoH bypass for ISP DNS blocks, automatic Anubis challenge solver, and full HDRezka studio unlock without VPN",
        "tags_ru": ["Шифрованный DoH (1.1.1.1)", "Автообход Anubis", "Разблокировка студий (KZ)"],
        "tags_en": ["Encrypted DoH (1.1.1.1)", "Anubis PoW Solver", "Studio Geo-Unlock (KZ)"],
    },
    "at_nl_isp_dns": {
        "doh_enabled": True,
        "hdrezka_spoof": "KZ",
        "p2p_strict": False,
        "local_media_proxy": False,
        "kinorium_domain_fallback": True,
        "mirror_priority": ["https://hdrezka-home.tv", "https://hdrezka.me", "https://hdrezka.ag", "https://rezka.ag"],
        "restrictions_ru": "DNS-блокировки европейских операторов связи (BREIN, Telekom Austria и локальные реестры) для торрент-аддонов и зеркал",
        "restrictions_en": "European ISP DNS blocks (BREIN, Telekom Austria, and local registries) on torrent addons and mirrors",
        "summary_ru": "Обход провайдерских DNS-блокировок (Torrentio, JacRed, HDRezka) через шифрованный DoH и снятие гео-ограничений студий озвучки",
        "summary_en": "Encrypted DoH bypass for European ISP DNS blocks (Torrentio, JacRed, HDRezka) and studio geo-restriction unlock",
        "tags_ru": ["Обход DNS провайдера (DoH)", "Доступ к Torrentio и JacRed", "Разблокировка студий (KZ)"],
        "tags_en": ["ISP DNS DoH Bypass", "Torrentio & JacRed Unlock", "Studio Geo-Unlock (KZ)"],
    },
    "eu_standard": {
        "doh_enabled": True,
        "hdrezka_spoof": "KZ",
        "p2p_strict": False,
        "local_media_proxy": False,
        "kinorium_domain_fallback": False,
        "mirror_priority": ["https://hdrezka-home.tv", "https://hdrezka.ag", "https://rezka.ag", "https://hdrezka.me"],
        "restrictions_ru": "Региональные DMCA-ограничения для европейских IP-адресов на выбор студий озвучки и оригинальной дорожки",
        "restrictions_en": "Regional European IP DMCA restrictions on dubbing studios and original audio tracks",
        "summary_ru": "Резервный DNS-over-HTTPS и нейтральная гео-маршрутизация HDRezka (регион KZ) для прямого доступа ко всем озвучкам в 1080p и 4K",
        "summary_en": "Resilient DNS-over-HTTPS and neutral HDRezka geo-routing (KZ) for direct 1080p and 4K studio access",
        "tags_ru": ["Резервный DoH", "Прямой P2P 4K HDR", "Разблокировка студий (KZ)"],
        "tags_en": ["Resilient DoH", "Direct 4K HDR P2P", "Studio Geo-Unlock (KZ)"],
    },
    "cis_moldova": {
        "doh_enabled": False,
        "hdrezka_spoof": "MD",
        "p2p_strict": False,
        "local_media_proxy": False,
        "kinorium_domain_fallback": False,
        "mirror_priority": ["https://hdrezka.ag", "https://hdrezka-home.tv", "https://rezka.ag", "https://hdrezka.me"],
        "restrictions_ru": "Минимальные сетевые ограничения; возможны временные сбои DNS у отдельных домашних операторов",
        "restrictions_en": "Minimal network restrictions; occasional ISP DNS hiccups on individual mirrors",
        "summary_ru": "Нативная региональная маршрутизация Молдовы (MD) с минимальной задержкой и автоматический DoH при сбоях провайдера",
        "summary_en": "Native Moldova (MD) low-latency routing with automatic DoH fallback on ISP errors",
        "tags_ru": ["Прямой маршрут MD", "Авторезерв DoH", "Прямой P2P 4K HDR"],
        "tags_en": ["Direct MD Routing", "Auto DoH Fallback", "Direct 4K HDR P2P"],
    },
    "cis_direct": {
        "doh_enabled": False,
        "hdrezka_spoof": "AM",
        "p2p_strict": False,
        "local_media_proxy": False,
        "kinorium_domain_fallback": False,
        "mirror_priority": ["https://hdrezka.ag", "https://hdrezka-home.tv", "https://rezka.ag", "https://hdrezka.me"],
        "restrictions_ru": "Отсутствуют жёсткие блокировки стримингов; прямой доступ к CDN-узлам без промежуточного проксирования",
        "restrictions_en": "No strict streaming blocks; direct low-latency CDN access without intermediate proxying",
        "summary_ru": "Прямое подключение к CDN (регион AM) с минимальной задержкой без гео-ограничений и резервный DoH при недоступности домена",
        "summary_en": "Low-latency direct CDN connection (AM region) without geo-blocks and automatic DoH fallback if a domain fails",
        "tags_ru": ["Прямой CDN (AM)", "Минимальная задержка", "Прямой P2P 4K HDR"],
        "tags_en": ["Direct CDN (AM)", "Lowest Latency", "Direct 4K HDR P2P"],
    },
}

EU_COUNTRIES_BY_CODE: Dict[str, Dict[str, Any]] = {
    row["code"]: row for row in _RAW_EU_COUNTRIES
}


_COUNTRY_CODE_ALIASES: Dict[str, str] = {
    "UK": "GB",
    "EL": "GR",
}

_SERVICE_URL_COUNTRY_MAP: Dict[str, str] = {
    "XK": "al",
    "VA": "it",
    "SM": "it",
    "AD": "es",
    "LI": "ch",
    "MC": "fr",
}


def normalize_country_code(code: Optional[str], default: str = "PL") -> str:
    raw = str(code or "").split(".", 1)[0].split("@", 1)[0].strip().upper()
    if raw in _COUNTRY_CODE_ALIASES:
        raw = _COUNTRY_CODE_ALIASES[raw]
    if raw in EU_COUNTRIES_BY_CODE:
        return raw
    if "-" in raw or "_" in raw:
        parts = [p.strip() for p in raw.replace("_", "-").split("-") if p.strip()]
        # Only inspect region subtags (parts[1:]), never language subtag parts[0]
        # (prevents e.g. 'uk_UA.UTF-8' -> 'UK' -> 'GB' or 'be_BY.UTF-8' -> 'BE').
        for part in reversed(parts[1:]):
            if len(part) != 2:
                continue
            mapped = _COUNTRY_CODE_ALIASES.get(part, part)
            if mapped in EU_COUNTRIES_BY_CODE:
                return mapped
    norm_def = str(default or "PL").split(".", 1)[0].split("@", 1)[0].strip().upper()
    norm_def = _COUNTRY_CODE_ALIASES.get(norm_def, norm_def)
    return norm_def if norm_def in EU_COUNTRIES_BY_CODE else "PL"


def get_country_profile(code: Optional[str], lang: str = "ru") -> Dict[str, Any]:
    norm = normalize_country_code(code)
    entry = EU_COUNTRIES_BY_CODE[norm]
    prof = _BYPASS_PROFILES.get(entry["profile"], _BYPASS_PROFILES["eu_standard"])
    is_en = str(lang or "").lower().startswith("en")
    url_cc = _SERVICE_URL_COUNTRY_MAP.get(norm, norm.lower())

    tags = list(prof["tags_en"] if is_en else prof["tags_ru"])
    tags.append(f"Catalog: {norm}" if is_en else f"Каталог: {norm}")

    return {
        "code": norm,
        "profile_id": entry["profile"],
        "name": entry["en"] if is_en else entry["ru"],
        "name_ru": entry["ru"],
        "name_en": entry["en"],
        "accept_language": entry["lang"],
        "justwatch_country": entry["jw"],
        "doh_enabled": bool(prof["doh_enabled"]),
        "hdrezka_spoof": str(prof["hdrezka_spoof"]),
        "p2p_strict": bool(prof["p2p_strict"]),
        "local_media_proxy": bool(prof.get("local_media_proxy", False)),
        "kinorium_domain_fallback": bool(prof["kinorium_domain_fallback"]),
        "mirror_priority": list(prof["mirror_priority"]),
        "local_services": ["playerpl"] if norm == "PL" else [],
        "restrictions": prof["restrictions_en"] if is_en else prof["restrictions_ru"],
        "restrictions_ru": prof["restrictions_ru"],
        "restrictions_en": prof["restrictions_en"],
        "bypass_summary": prof["summary_en"] if is_en else prof["summary_ru"],
        "bypass_summary_ru": prof["summary_ru"],
        "bypass_summary_en": prof["summary_en"],
        "bypass_tags": tags,
        "bypass_tags_ru": list(prof["tags_ru"]) + [f"Каталог: {norm}"],
        "bypass_tags_en": list(prof["tags_en"]) + [f"Catalog: {norm}"],
        "service_urls": {
            "appletv": f"https://tv.apple.com/{url_cc}",
            "netflix": f"https://www.netflix.com/{url_cc}/login",
            "prime": "https://www.primevideo.com/",
            "disney": f"https://www.disneyplus.com/{url_cc}/login",
            "max": "https://play.max.com/",
            "playerpl": "https://player.pl/",
        },
    }


def get_european_countries_list(lang: str = "ru") -> List[Dict[str, Any]]:
    is_en = str(lang or "").lower().startswith("en")
    items = [get_country_profile(c["code"], lang=lang) for c in _RAW_EU_COUNTRIES]
    items.sort(key=lambda x: x["name_en"] if is_en else x["name_ru"])
    return items
