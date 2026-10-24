import json
import re
import time
import urllib.parse
from typing import Any, Dict, List, Optional, Set

from .doh import DoHSplitNetworkClient
from .en_metadata import (
    EnglishMetadataResolver,
    RU_GENRES_TO_EN,
    _names_match_ru_en,
    has_cyrillic,
    resolve_original_poster_url,
    translate_birth_date_en,
    translate_birth_place_en,
    translate_career_role_en,
    translate_kinorium_extra_desc_to_en,
    transliterate_cyrillic,
)
from .hdrezka import HDRezkaClient
from .kinorium import KinoriumService, _norm_title, _title_variants


class UnifiedCinemaAggregator:
    """
    Unified Catalog & Search Engine for Poland (PL):
    Includes Apple TV+, Netflix, Prime Video, Disney+, Max, Player.pl, HDRezka, and 4K Remux.
    Supports filtering by provider AND by media_type ('all', 'movie', 'series').
    """

    PROVIDERS_META = {
        "hdrezka": {
            "id": "hdrezka",
            "name": "HDRezka",
            "short": "HDRezka",
            "type": "native",
            "requires_login": False,
        },
        "appletv": {
            "id": "appletv",
            "name": "Apple TV+",
            "short": "Apple TV+",
            "type": "drm_webview",
            "requires_login": True,
        },
        "netflix": {
            "id": "netflix",
            "name": "Netflix",
            "short": "Netflix",
            "type": "drm_webview",
            "requires_login": True,
        },
        "prime": {
            "id": "prime",
            "name": "Prime Video",
            "short": "Prime",
            "type": "drm_webview",
            "requires_login": True,
        },
        "disney": {
            "id": "disney",
            "name": "Disney+",
            "short": "Disney+",
            "type": "drm_webview",
            "requires_login": True,
        },
        "max": {
            "id": "max",
            "name": "Max (HBO)",
            "short": "Max",
            "type": "drm_webview",
            "requires_login": True,
        },
        "playerpl": {
            "id": "playerpl",
            "name": "Player.pl",
            "short": "Player.pl",
            "type": "drm_webview",
            "requires_login": True,
        },
        "backup4k": {
            "id": "backup4k",
            "name": "4K Remux",
            "short": "4K HDR",
            "type": "native_backup",
            "requires_login": False,
        },
        "stremio": {
            "id": "stremio",
            "name": "Stremio",
            "short": "Stremio",
            "type": "native_stremio",
            "requires_login": False,
        },
    }

    CURATED_CATALOG: List[Dict[str, Any]] = [
        # --- SERIES ---
        {
            "id": "tt3581920",
            "rezka_id": "53465",
            "rezka_url": "https://hdrezka-home.tv/series/adventures/53465-odni-iz-nas-2023-latest.html",
            "title": "Одни из нас",
            "title_pl": "The Last of Us",
            "orig_title": "The Last of Us",
            "year": 2023,
            "media_type": "series",
            "seasons_count": 2,
            "episodes_per_season": 9,
            "duration_min": 58,
            "genres": ["Драма", "Фантастика", "Приключения"],
            "description": (
                "Закаленный в борьбе за выживание Джоэл нанят, чтобы вывести 14-летнюю Элли "
                "из карантинной зоны в разрушенной пандемией кордицепса Америке."
            ),
            "description_en": (
                "After a global fungal pandemic destroys civilization, hardened survivor Joel is hired "
                "to smuggle 14-year-old Ellie out of an oppressive quarantine zone across America."
            ),
            "poster": "https://images.justwatch.com/poster/302743227/s592/the-last-of-us.webp",
            "poster_en": "https://images.justwatch.com/poster/302743227/s592/the-last-of-us.webp",
            "backdrop": "https://images.justwatch.com/backdrop/302127018/s1920/the-last-of-us.webp",
            "ambient_color": "#3f6212",
            "ratings": {"critics": 96, "imdb": 8.7, "kinorium": 8.2},
            "providers": [
                {"id": "hdrezka", "available": True, "quality": "1080p • 29 озвучек", "url": "https://hdrezka-home.tv/series/adventures/53465-odni-iz-nas-2023-latest.html"},
                {"id": "max", "available": True, "quality": "4K Dolby Vision", "url": "https://play.max.com/search?q=The%20Last%20of%20Us"},
                {"id": "playerpl", "available": True, "quality": "Pakiet HBO", "url": "https://player.pl/hbo"},
                {"id": "backup4k", "available": True, "quality": "4K UHD HDR", "url": "native://backup4k/tt3581920"},
            ],
            "featured": True,
        },
        {
            "id": "tt11280740",
            "rezka_id": "46416",
            "rezka_url": "https://hdrezka-home.tv/series/fiction/46416-razdelenie-2022-latest.html",
            "title": "Разделение",
            "title_pl": "Rozdzielenie",
            "orig_title": "Severance",
            "year": 2022,
            "media_type": "series",
            "seasons_count": 2,
            "episodes_per_season": 10,
            "duration_min": 52,
            "genres": ["Триллер", "Фантастика", "Драма"],
            "description": (
                "Корпорация Lumon Industries разделяет рабочие и личные воспоминания сотрудников "
                "с помощью хирургической процедуры. «Офисная» личность Марка начинает подозревать заговор."
            ),
            "description_en": (
                "Mark leads a team of office workers whose memories have been surgically divided between "
                "their work and personal lives, until a mysterious colleague unravels the truth."
            ),
            "poster": "https://images.justwatch.com/poster/338187880/s592/severance.webp",
            "poster_en": "https://images.justwatch.com/poster/338187880/s592/severance.webp",
            "backdrop": "https://images.justwatch.com/backdrop/324479719/s1920/severance.webp",
            "ambient_color": "#0284c7",
            "ratings": {"critics": 97, "imdb": 8.7, "kinorium": 8.5},
            "providers": [
                {"id": "hdrezka", "available": True, "quality": "1080p • RHS / HDRezka", "url": "https://hdrezka-home.tv/series/fiction/46416-razdelenie-2022-latest.html"},
                {"id": "appletv", "available": True, "quality": "4K Dolby Vision", "url": "https://tv.apple.com/pl/show/severance/umc.cmc.1srk2goyh2q2zdxcx605w8vtx"},
                {"id": "prime", "available": True, "quality": "4K HDR", "url": "https://www.primevideo.com/search?phrase=Severance"},
                {"id": "backup4k", "available": True, "quality": "4K Dolby Vision", "url": "native://backup4k/tt11280740"},
            ],
            "featured": True,
        },
        {
            "id": "tt14688458",
            "rezka_id": "55680",
            "rezka_url": "https://hdrezka-home.tv/series/drama/55680-ukrytie-2023-latest.html",
            "title": "Укрытие",
            "title_pl": "Silos",
            "orig_title": "Silo",
            "year": 2023,
            "media_type": "series",
            "seasons_count": 2,
            "episodes_per_season": 10,
            "duration_min": 55,
            "genres": ["Фантастика", "Драма", "Триллер"],
            "description": (
                "В отравленном будущем последние десять тысяч человек на Земле живут в гигантском подземном бункере "
                "глубиной в 144 этажа, не зная, кто и когда его построил."
            ),
            "description_en": (
                "In a ruined and toxic future, ten thousand survivors live inside a giant underground silo "
                "plunging 144 stories deep, bound by strict rules meant to protect them."
            ),
            "poster": "https://images.justwatch.com/poster/348411456/s592/silos.webp",
            "poster_en": "https://images.metahub.space/poster/medium/tt14688458/img",
            "backdrop": "https://images.justwatch.com/backdrop/346257620/s1920/silos.webp",
            "ambient_color": "#78350f",
            "ratings": {"critics": 90, "imdb": 8.1, "kinorium": 8.0},
            "providers": [
                {"id": "hdrezka", "available": True, "quality": "1080p • HDRezka / LostFilm", "url": "https://hdrezka-home.tv/series/drama/55680-ukrytie-2023-latest.html"},
                {"id": "appletv", "available": True, "quality": "4K Dolby Vision", "url": "https://tv.apple.com/pl/show/silo/umc.cmc.3yksgc857px0k0rqe5zd4jice"},
                {"id": "backup4k", "available": True, "quality": "4K UHD HDR", "url": "native://backup4k/tt14688458"},
            ],
            "featured": False,
        },
        {
            "id": "tt5875444",
            "rezka_id": "47752",
            "rezka_url": "https://hdrezka-home.tv/series/thriller/47752-medlennye-loshadi-2022-latest.html",
            "title": "Медленные лошади",
            "title_pl": "Kulawe konie",
            "orig_title": "Slow Horses",
            "year": 2022,
            "media_type": "series",
            "seasons_count": 4,
            "episodes_per_season": 6,
            "duration_min": 50,
            "genres": ["Триллер", "Шпионаж", "Драма"],
            "description": (
                "Отдел провинившихся агентов британской разведки МИ-5 в Слау-Хаус под руководством "
                "циничного Джексона Лэма оказывается втянут в опаснейшие заговоры."
            ),
            "description_en": (
                "Follow a dysfunctional team of MI5 agents and their obnoxious boss, the notorious "
                "Jackson Lamb, as they navigate the espionage world's smoke and mirrors."
            ),
            "poster": "https://images.justwatch.com/poster/354752337/s592/slow-horses.webp",
            "poster_en": "https://images.justwatch.com/poster/349310634/s592/slow-horses.webp",
            "backdrop": "https://images.justwatch.com/backdrop/272750278/s1920/slow-horses.webp",
            "ambient_color": "#334155",
            "ratings": {"critics": 98, "imdb": 8.4, "kinorium": 8.3},
            "providers": [
                {"id": "hdrezka", "available": True, "quality": "1080p • HDRezka / TVShows", "url": "https://hdrezka-home.tv/series/thriller/47752-medlennye-loshadi-2022-latest.html"},
                {"id": "appletv", "available": True, "quality": "4K Dolby Vision", "url": "https://tv.apple.com/pl/show/slow-horses/umc.cmc.2szz3fdt71tl1ulnbp8utgq5o"},
                {"id": "backup4k", "available": True, "quality": "4K UHD HDR", "url": "native://backup4k/tt5875444"},
            ],
            "featured": False,
        },
        {
            "id": "tt10986410",
            "rezka_id": "35084",
            "rezka_url": "https://hdrezka-home.tv/series/comedy/35084-ted-lasso-2020-latest.html",
            "title": "Тед Лассо",
            "title_pl": "Ted Lasso",
            "orig_title": "Ted Lasso",
            "year": 2020,
            "media_type": "series",
            "seasons_count": 3,
            "episodes_per_season": 12,
            "duration_min": 45,
            "genres": ["Комедия", "Спорт", "Драма"],
            "description": (
                "Тренер студенческой команды по американскому футболу из Канзаса приезжает в Лондон "
                "тренировать клуб английской Премьер-лиги, ничего не зная о европейском футболе."
            ),
            "description_en": (
                "American college football coach Ted Lasso heads to London to manage AFC Richmond, "
                "a struggling English Premier League soccer team."
            ),
            "poster": "https://images.justwatch.com/poster/348176644/s592/ted-lasso.webp",
            "poster_en": "https://images.justwatch.com/poster/348176644/s592/ted-lasso.webp",
            "backdrop": "https://images.justwatch.com/backdrop/348176663/s1920/ted-lasso.webp",
            "ambient_color": "#1d4ed8",
            "ratings": {"critics": 90, "imdb": 8.7, "kinorium": 8.5},
            "providers": [
                {"id": "hdrezka", "available": True, "quality": "1080p • Jaskier / HDRezka", "url": "https://hdrezka-home.tv/series/comedy/35084-ted-lasso-2020-latest.html"},
                {"id": "appletv", "available": True, "quality": "4K Dolby Vision", "url": "https://tv.apple.com/pl/show/ted-lasso/umc.cmc.vtoh0mn0xn7t3c643xqonfzy"},
                {"id": "backup4k", "available": True, "quality": "4K UHD HDR", "url": "native://backup4k/tt10986410"},
            ],
            "featured": False,
        },
        {
            "id": "tt5180504",
            "rezka_id": "32556",
            "rezka_url": "https://hdrezka-home.tv/series/action/32556-vedmak-2019-latest.html",
            "title": "Ведьмак",
            "title_pl": "Wiedźmin",
            "orig_title": "The Witcher",
            "year": 2019,
            "media_type": "series",
            "seasons_count": 3,
            "episodes_per_season": 8,
            "duration_min": 60,
            "genres": ["Фэнтези", "Приключения", "Боевик"],
            "description": (
                "Геральт из Ривии, мутант и охотник на чудовищ, ищет свое предназначение в мире, "
                "где люди зачастую оказываются куда коварнее монстров."
            ),
            "description_en": (
                "Geralt of Rivia, a mutated monster-hunter for hire, journeys toward his destiny "
                "in a turbulent world where people often prove more wicked than beasts."
            ),
            "poster": "https://images.justwatch.com/poster/306098268/s592/wiedzmin.webp",
            "poster_en": "https://images.metahub.space/poster/medium/tt5180504/img",
            "backdrop": "https://images.justwatch.com/backdrop/162398451/s1920/wiedzmin.webp",
            "ambient_color": "#475569",
            "ratings": {"critics": 80, "imdb": 8.0, "kinorium": 7.6},
            "providers": [
                {"id": "hdrezka", "available": True, "quality": "1080p • Дубляж", "url": "https://hdrezka-home.tv/series/action/32556-vedmak-2019-latest.html"},
                {"id": "netflix", "available": True, "quality": "4K Dolby Vision", "url": "https://www.netflix.com/title/80189685"},
                {"id": "backup4k", "available": True, "quality": "4K UHD HDR", "url": "native://backup4k/tt5180504"},
            ],
            "featured": False,
        },
        {
            "id": "tt11126994",
            "rezka_id": "43477",
            "rezka_url": "https://hdrezka-home.tv/cartoons/fiction/43477-arkein-2021-latest.html",
            "title": "Аркейн",
            "title_pl": "Arcane",
            "orig_title": "Arcane",
            "year": 2021,
            "media_type": "series",
            "seasons_count": 2,
            "episodes_per_season": 9,
            "duration_min": 42,
            "genres": ["Фантастика", "Боевик", "Драма"],
            "description": (
                "История двух сестер — Вай и Паудер — на фоне нарастающего противостояния между "
                "богатым утопическим городом Пилтовер и мрачным подземным Зауном."
            ),
            "description_en": (
                "Amid the stark discord of twin cities Piltover and Zaun, two sisters fight on rival "
                "sides of a war between arcane technologies and clashing convictions."
            ),
            "poster": "https://images.justwatch.com/poster/306350502/s592/arcane.webp",
            "poster_en": "https://images.justwatch.com/poster/306350502/s592/arcane.webp",
            "backdrop": "https://images.justwatch.com/backdrop/324530335/s1920/arcane.webp",
            "ambient_color": "#6d28d9",
            "ratings": {"critics": 100, "imdb": 9.0, "kinorium": 8.9},
            "providers": [
                {"id": "hdrezka", "available": True, "quality": "1080p • Дубляж / TVShows", "url": "https://hdrezka-home.tv/cartoons/fiction/43477-arkein-2021-latest.html"},
                {"id": "netflix", "available": True, "quality": "4K Dolby Vision", "url": "https://www.netflix.com/title/81435684"},
                {"id": "backup4k", "available": True, "quality": "4K UHD HDR", "url": "native://backup4k/tt11126994"},
            ],
            "featured": False,
        },
        {
            "id": "tt4574334",
            "rezka_id": "17109",
            "rezka_url": "https://hdrezka-home.tv/series/thriller/17109-ochen-strannye-dela-2016-latest.html",
            "title": "Очень странные дела",
            "title_pl": "Stranger Things",
            "orig_title": "Stranger Things",
            "year": 2016,
            "media_type": "series",
            "seasons_count": 4,
            "episodes_per_season": 9,
            "duration_min": 55,
            "genres": ["Фантастика", "Триллер", "Детектив"],
            "description": (
                "В тихом провинциальном городке Хоукинс бесследно исчезает мальчик Уилл, а его друзья "
                "встречают загадочную девочку со сверхспособностями."
            ),
            "description_en": (
                "When a young boy vanishes in the small town of Hawkins, his friends and family uncover "
                "classified experiments, supernatural forces, and one extraordinary girl."
            ),
            "poster": "https://images.justwatch.com/poster/45891575/s592/stranger-things.webp",
            "poster_en": "https://images.justwatch.com/poster/45891575/s592/stranger-things.webp",
            "backdrop": "https://images.justwatch.com/backdrop/102141616/s1920/stranger-things.webp",
            "ambient_color": "#991b1b",
            "ratings": {"critics": 92, "imdb": 8.6, "kinorium": 8.5},
            "providers": [
                {"id": "hdrezka", "available": True, "quality": "1080p • Дубляж / RHS", "url": "https://hdrezka-home.tv/series/thriller/17109-ochen-strannye-dela-2016-latest.html"},
                {"id": "netflix", "available": True, "quality": "4K Dolby Vision", "url": "https://www.netflix.com/title/80057281"},
                {"id": "backup4k", "available": True, "quality": "4K UHD HDR", "url": "native://backup4k/tt4574334"},
            ],
            "featured": False,
        },
        {
            "id": "tt1190634",
            "rezka_id": "31432",
            "rezka_url": "https://hdrezka-home.tv/series/action/31432-pacany-2019-latest.html",
            "title": "Пацаны",
            "title_pl": "The Boys",
            "orig_title": "The Boys",
            "year": 2019,
            "media_type": "series",
            "seasons_count": 4,
            "episodes_per_season": 8,
            "duration_min": 62,
            "genres": ["Фантастика", "Боевик", "Черная комедия"],
            "description": (
                "Отряд линчевателей во главе с Билли Бутчером противостоит коррумпированным супергероям "
                "могущественной корпорации Vought International."
            ),
            "description_en": (
                "A group of vigilantes led by Billy Butcher sets out to take down corrupt superheroes "
                "who abuse their superpowers behind the corporate facade of Vought International."
            ),
            "poster": "https://images.justwatch.com/poster/244471218/s592/the-boys.webp",
            "poster_en": "https://images.justwatch.com/poster/244471218/s592/the-boys.webp",
            "backdrop": "https://images.justwatch.com/backdrop/109745293/s1920/the-boys.webp",
            "ambient_color": "#be123c",
            "ratings": {"critics": 93, "imdb": 8.7, "kinorium": 8.4},
            "providers": [
                {"id": "hdrezka", "available": True, "quality": "1080p • Кубик в Кубе", "url": "https://hdrezka-home.tv/series/action/31432-pacany-2019-latest.html"},
                {"id": "prime", "available": True, "quality": "4K HDR10+", "url": "https://www.primevideo.com/search?phrase=The+Boys"},
                {"id": "backup4k", "available": True, "quality": "4K UHD HDR", "url": "native://backup4k/tt1190634"},
            ],
            "featured": False,
        },
        {
            "id": "tt2788316",
            "rezka_id": "66689",
            "rezka_url": "https://hdrezka-home.tv/series/drama/66689-segun-2024-latest.html",
            "title": "Сёгун",
            "title_pl": "Szōgun",
            "orig_title": "Shōgun",
            "year": 2024,
            "media_type": "series",
            "seasons_count": 1,
            "episodes_per_season": 10,
            "duration_min": 65,
            "genres": ["История", "Драма", "Приключения"],
            "description": (
                "1600 год. Английский штурман Джон Блэкторн попадает в феодальную Японию на пороге "
                "гражданской войны и становится пешкой в игре могущественного даймё Торанаги."
            ),
            "description_en": (
                "In 1600 Japan, Lord Yoshii Toranaga fights for his life as his enemies on the Council of "
                "Regents unite against him, when a mysterious European ship is found marooned nearby."
            ),
            "poster": "https://images.justwatch.com/poster/312643992/s592/szogun.webp",
            "poster_en": "https://images.metahub.space/poster/medium/tt2788316/img",
            "backdrop": "https://images.justwatch.com/backdrop/312644053/s1920/szogun.webp",
            "ambient_color": "#92400e",
            "ratings": {"critics": 99, "imdb": 8.7, "kinorium": 8.6},
            "providers": [
                {"id": "hdrezka", "available": True, "quality": "1080p • HDRezka Studio", "url": "https://hdrezka-home.tv/series/drama/66689-segun-2024-latest.html"},
                {"id": "disney", "available": True, "quality": "4K Dolby Vision", "url": "https://www.disneyplus.com/pl-pl"},
                {"id": "backup4k", "available": True, "quality": "4K Dolby Vision", "url": "native://backup4k/tt2788316"},
            ],
            "featured": False,
        },
        {
            "id": "tt11198330",
            "rezka_id": "48758",
            "rezka_url": "https://hdrezka-home.tv/series/fantasy/48758-dom-drakona-2022-latest.html",
            "title": "Дом Дракона",
            "title_pl": "Ród Smoka",
            "orig_title": "House of the Dragon",
            "year": 2022,
            "media_type": "series",
            "seasons_count": 2,
            "episodes_per_season": 8,
            "duration_min": 64,
            "genres": ["Фэнтези", "Драма", "Боевик"],
            "description": (
                "Хроника падения великого дома Таргариенов и кровопролитной гражданской войны "
                "за Железный трон за 200 лет до событий «Игры престолов»."
            ),
            "description_en": (
                "Set 200 years before the events of Game of Thrones, House Targaryen spirals into a "
                "devastating civil war of succession known as the Dance of the Dragons."
            ),
            "poster": "https://images.justwatch.com/poster/306593765/s592/house-of-the-dragon.webp",
            "poster_en": "https://images.justwatch.com/poster/306593765/s592/house-of-the-dragon.webp",
            "backdrop": "https://images.justwatch.com/backdrop/346254544/s1920/house-of-the-dragon.webp",
            "ambient_color": "#991b1b",
            "ratings": {"critics": 90, "imdb": 8.4, "kinorium": 8.2},
            "providers": [
                {"id": "hdrezka", "available": True, "quality": "1080p • RHS / Дубляж", "url": "https://hdrezka-home.tv/series/fantasy/48758-dom-drakona-2022-latest.html"},
                {"id": "max", "available": True, "quality": "4K Dolby Vision", "url": "https://play.max.com/search?q=House%20of%20the%20Dragon"},
                {"id": "playerpl", "available": True, "quality": "Player.pl (HBO)", "url": "https://player.pl/hbo"},
                {"id": "backup4k", "available": True, "quality": "4K UHD HDR10", "url": "native://backup4k/tt11198330"},
            ],
            "featured": False,
        },
        {
            "id": "tt12637874",
            "rezka_id": "64703",
            "rezka_url": "https://hdrezka-home.tv/series/fiction/64703-follaut-2024-latest.html",
            "title": "Фоллаут",
            "title_pl": "Fallout",
            "orig_title": "Fallout",
            "year": 2024,
            "media_type": "series",
            "seasons_count": 1,
            "episodes_per_season": 8,
            "duration_min": 60,
            "genres": ["Фантастика", "Боевик", "Приключения"],
            "description": (
                "Через 200 лет после ядерного апокалипсиса жительница Убежища 33 Люси "
                "выходит на поверхность жестокой радиоактивной Пустоши."
            ),
            "description_en": (
                "Two hundred years after the apocalypse, a sheltered Vault dweller is forced to step out "
                "into the irradiated, ruthless Wasteland her ancestors left behind."
            ),
            "poster": "https://images.justwatch.com/poster/343776817/s592/fallout.webp",
            "poster_en": "https://images.justwatch.com/poster/343776817/s592/fallout.webp",
            "backdrop": "https://images.justwatch.com/backdrop/313866794/s1920/fallout.webp",
            "ambient_color": "#1d4ed8",
            "ratings": {"critics": 94, "imdb": 8.4, "kinorium": 8.1},
            "providers": [
                {"id": "hdrezka", "available": True, "quality": "1080p • Кубик в Кубе", "url": "https://hdrezka-home.tv/series/fiction/64703-follaut-2024-latest.html"},
                {"id": "prime", "available": True, "quality": "4K HDR10+", "url": "https://www.primevideo.com/search?phrase=Fallout"},
                {"id": "backup4k", "available": True, "quality": "4K UHD HDR", "url": "native://backup4k/tt12637874"},
            ],
            "featured": False,
        },
        {
            "id": "tt29420686",
            "rezka_id": "65095",
            "rezka_url": "https://hdrezka-home.tv/series/comedy/65095-1670-2023-latest.html",
            "title": "1670",
            "title_pl": "1670",
            "orig_title": "1670",
            "year": 2023,
            "media_type": "series",
            "seasons_count": 2,
            "episodes_per_season": 8,
            "duration_min": 35,
            "genres": ["Комедия", "История", "Сатира"],
            "description": (
                "Сатирическое мокьюментари о польском шляхтиче Яне Павле Адамчевском, "
                "который мечтает стать самым знаменитым Яном Павлом в истории Польши."
            ),
            "description_en": (
                "In this satirical mockumentary set in 17th-century Poland, eccentric nobleman Jan Pawel "
                "navigates family feuds and peasant revolts to become the most famous Jan Pawel in history."
            ),
            "poster": "https://images.justwatch.com/poster/347352015/s592/1670.webp",
            "poster_en": "https://images.justwatch.com/poster/347352015/s592/1670.webp",
            "backdrop": "https://images.justwatch.com/backdrop/309059408/s1920/1670.webp",
            "ambient_color": "#a16207",
            "ratings": {"critics": 88, "imdb": 8.0, "kinorium": 8.1},
            "providers": [
                {"id": "hdrezka", "available": True, "quality": "1080p • RU + PL", "url": "https://hdrezka-home.tv/series/comedy/65095-1670-2023-latest.html"},
                {"id": "netflix", "available": True, "quality": "4K Dolby Vision", "url": "https://www.netflix.com/title/81553469"},
                {"id": "backup4k", "available": True, "quality": "4K Web-DL", "url": "native://backup4k/tt29420686"},
            ],
            "featured": False,
        },
        {
            "id": "tt14417144",
            "rezka_id": "50983",
            "rezka_url": "https://hdrezka-home.tv/series/drama/50983-zaklyuchennaya-2021.html",
            "title": "Заключенная (Skazana)",
            "title_pl": "Skazana",
            "orig_title": "Skazana",
            "year": 2021,
            "media_type": "series",
            "seasons_count": 4,
            "episodes_per_season": 8,
            "duration_min": 45,
            "genres": ["Криминал", "Драма", "Триллер"],
            "description": (
                "Судья Алиция Мазур, известная своей суровостью к преступникам, попадает в тюрьму "
                "по ложному обвинению в убийстве — к осужденным ею же женщинам."
            ),
            "description_en": (
                "Judge Alicja Mazur, known for her harshness toward criminals, is framed for murder and "
                "sent to the very prison populated by the women she sentenced."
            ),
            "poster": "https://images.justwatch.com/poster/250485870/s592/skazana.webp",
            "poster_en": "https://images.justwatch.com/poster/250485870/s592/skazana.webp",
            "backdrop": "https://images.justwatch.com/backdrop/319968549/s1920/skazana.webp",
            "ambient_color": "#4338ca",
            "ratings": {"critics": 82, "imdb": 7.5, "kinorium": 7.7},
            "providers": [
                {"id": "hdrezka", "available": True, "quality": "1080p • RU + PL", "url": "https://hdrezka-home.tv/series/drama/50983-zaklyuchennaya-2021.html"},
                {"id": "playerpl", "available": True, "quality": "Player.pl Original", "url": "https://player.pl/seriale-online/skazana-odcinki,31954"},
                {"id": "max", "available": True, "quality": "1080p (Max PL)", "url": "https://play.max.com/search?q=Skazana"},
                {"id": "backup4k", "available": True, "quality": "1080p Web-DL", "url": "native://backup4k/tt14417144"},
            ],
            "featured": False,
        },
        # --- MOVIES ---
        {
            "id": "tt15239678",
            "rezka_id": "57233",
            "rezka_url": "https://hdrezka-home.tv/films/fiction/57233-dyuna-chast-vtoraya-2024.html",
            "title": "Дюна: Часть вторая",
            "title_pl": "Diuna: Część druga",
            "orig_title": "Dune: Part Two",
            "year": 2024,
            "media_type": "movie",
            "seasons_count": 1,
            "episodes_per_season": 1,
            "duration_min": 166,
            "genres": ["Фантастика", "Боевик", "Драма"],
            "description": (
                "Пол Атрейдес объединяется с Чани и фрименами Арракиса, чтобы отомстить заговорщикам, "
                "уничтожившим его семью, и предотвратить священную войну."
            ),
            "description_en": (
                "Paul Atreides unites with Chani and the Fremen of Arrakis while seeking revenge against "
                "the conspirators who destroyed his family."
            ),
            "poster": "https://images.justwatch.com/poster/320515895/s592/diuna-czesc-druga.webp",
            "poster_en": "https://images.metahub.space/poster/medium/tt15239678/img",
            "backdrop": "https://images.justwatch.com/backdrop/310569186/s1920/diuna-czesc-druga.webp",
            "ambient_color": "#d97706",
            "ratings": {"critics": 92, "imdb": 8.5, "kinorium": 8.4},
            "providers": [
                {"id": "hdrezka", "available": True, "quality": "1080p • Дубляж", "url": "https://hdrezka-home.tv/films/fiction/57233-dyuna-chast-vtoraya-2024.html"},
                {"id": "max", "available": True, "quality": "4K Dolby Vision", "url": "https://play.max.com/search?q=Dune%20Part%20Two"},
                {"id": "playerpl", "available": True, "quality": "4K (Player.pl)", "url": "https://player.pl/playerplus/filmy-online,2/diuna-czesc-druga"},
                {"id": "prime", "available": True, "quality": "4K UHD", "url": "https://www.primevideo.com/search?phrase=Dune+Part+Two"},
                {"id": "appletv", "available": True, "quality": "4K Dolby Vision", "url": "https://tv.apple.com/pl"},
                {"id": "backup4k", "available": True, "quality": "4K BDRemux", "url": "native://backup4k/tt15239678"},
            ],
            "featured": False,
        },
        {
            "id": "tt15398776",
            "rezka_id": "54016",
            "rezka_url": "https://hdrezka-home.tv/films/drama/54016-oppengeymer-2023-latest.html",
            "title": "Оппенгеймер",
            "title_pl": "Oppenheimer",
            "orig_title": "Oppenheimer",
            "year": 2023,
            "media_type": "movie",
            "seasons_count": 1,
            "episodes_per_season": 1,
            "duration_min": 180,
            "genres": ["Биография", "Драма", "История"],
            "description": (
                "История жизни американского физика-теоретика Роберта Оппенгеймера, который стоял "
                "во главе Манхэттенского проекта и создания первой атомной бомбы."
            ),
            "description_en": (
                "The story of American theoretical physicist J. Robert Oppenheimer and his pivotal role "
                "leading the Manhattan Project to develop the first atomic bomb."
            ),
            "poster": "https://images.justwatch.com/poster/306573499/s592/oppenheimer.webp",
            "poster_en": "https://images.justwatch.com/poster/306573499/s592/oppenheimer.webp",
            "backdrop": "https://images.justwatch.com/backdrop/312741101/s1920/oppenheimer.webp",
            "ambient_color": "#c2410c",
            "ratings": {"critics": 93, "imdb": 8.3, "kinorium": 8.2},
            "providers": [
                {"id": "hdrezka", "available": True, "quality": "1080p • Дубляж", "url": "https://hdrezka-home.tv/films/drama/54016-oppengeymer-2023-latest.html"},
                {"id": "prime", "available": True, "quality": "4K UHD", "url": "https://www.primevideo.com/search?phrase=Oppenheimer"},
                {"id": "netflix", "available": True, "quality": "4K UHD", "url": "https://www.netflix.com/search?q=Oppenheimer"},
                {"id": "appletv", "available": True, "quality": "4K HDR", "url": "https://tv.apple.com/pl"},
                {"id": "playerpl", "available": True, "quality": "Player.pl Wypożyczalnia", "url": "https://player.pl"},
                {"id": "backup4k", "available": True, "quality": "4K IMAX BDRemux", "url": "native://backup4k/tt15398776"},
            ],
            "featured": False,
        },
        {
            "id": "tt0816692",
            "rezka_id": "2259",
            "rezka_url": "https://hdrezka-home.tv/films/fiction/2259-interstellar-2014.html",
            "title": "Интерстеллар",
            "title_pl": "Interstellar",
            "orig_title": "Interstellar",
            "year": 2014,
            "media_type": "movie",
            "seasons_count": 1,
            "episodes_per_season": 1,
            "duration_min": 169,
            "genres": ["Фантастика", "Драма", "Приключения"],
            "description": (
                "Когда засуха и пыльные бури приводят человечество к продовольственному кризису, "
                "команда исследователей отправляется сквозь червоточину в поисках нового дома."
            ),
            "description_en": (
                "When Earth becomes uninhabitable in the future, a team of explorers travels through a "
                "newly discovered wormhole in space to ensure humanity's survival."
            ),
            "poster": "https://images.justwatch.com/poster/320862420/s592/interstellar.webp",
            "poster_en": "https://images.justwatch.com/poster/320862420/s592/interstellar.webp",
            "backdrop": "https://images.justwatch.com/backdrop/324966555/s1920/interstellar.webp",
            "ambient_color": "#0369a1",
            "ratings": {"critics": 73, "imdb": 8.7, "kinorium": 8.6},
            "providers": [
                {"id": "hdrezka", "available": True, "quality": "1080p • Дубляж", "url": "https://hdrezka-home.tv/films/fiction/2259-interstellar-2014.html"},
                {"id": "max", "available": True, "quality": "4K UHD", "url": "https://play.max.com/search?q=Interstellar"},
                {"id": "netflix", "available": True, "quality": "1080p / 4K", "url": "https://www.netflix.com/search?q=Interstellar"},
                {"id": "prime", "available": True, "quality": "4K HDR", "url": "https://www.primevideo.com/search?phrase=Interstellar"},
                {"id": "backup4k", "available": True, "quality": "4K IMAX BDRemux", "url": "native://backup4k/tt0816692"},
            ],
            "featured": False,
        },
        {
            "id": "tt6263850",
            "rezka_id": "67133",
            "rezka_url": "https://hdrezka-home.tv/films/action/67133-dedpul-i-rosomaha-2024.html",
            "title": "Дэдпул и Росомаха",
            "title_pl": "Deadpool & Wolverine",
            "orig_title": "Deadpool & Wolverine",
            "year": 2024,
            "media_type": "movie",
            "seasons_count": 1,
            "episodes_per_season": 1,
            "duration_min": 128,
            "genres": ["Боевик", "Комедия", "Фантастика"],
            "description": (
                "Уэйд Уилсон вынужден оставить спокойную жизнь и объединиться с неохотным Росомахой, "
                "чтобы спасти свою вселенную от уничтожения."
            ),
            "description_en": (
                "Wade Wilson leaves his quiet life behind and teams up with a reluctant Wolverine "
                "on a multiverse-spanning mission to save his home world from extinction."
            ),
            "poster": "https://images.justwatch.com/poster/337845410/s592/deadpool-3.webp",
            "poster_en": "https://images.justwatch.com/poster/337845410/s592/deadpool-3.webp",
            "backdrop": "https://images.justwatch.com/backdrop/321241775/s1920/deadpool-3.webp",
            "ambient_color": "#dc2626",
            "ratings": {"critics": 78, "imdb": 7.6, "kinorium": 7.5},
            "providers": [
                {"id": "hdrezka", "available": True, "quality": "1080p • Red Head Sound", "url": "https://hdrezka-home.tv/films/action/67133-dedpul-i-rosomaha-2024.html"},
                {"id": "disney", "available": True, "quality": "4K IMAX Enhanced", "url": "https://www.disneyplus.com/pl-pl"},
                {"id": "appletv", "available": True, "quality": "4K Dolby Vision", "url": "https://tv.apple.com/pl"},
                {"id": "backup4k", "available": True, "quality": "4K Dolby Vision", "url": "native://backup4k/tt6263850"},
            ],
            "featured": False,
        },
        {
            "id": "tt5537002",
            "rezka_id": "57603",
            "rezka_url": "https://hdrezka-home.tv/films/thriller/57603-ubiycy-cvetochnoy-luny-2023.html",
            "title": "Убийцы цветочной луны",
            "title_pl": "Czas krwawego księżyca",
            "orig_title": "Killers of the Flower Moon",
            "year": 2023,
            "media_type": "movie",
            "seasons_count": 1,
            "episodes_per_season": 1,
            "duration_min": 206,
            "genres": ["Драма", "Криминал", "История"],
            "description": (
                "В 1920-х годах в Оклахоме после открытия богатых месторождений нефти начинается серия "
                "загадочных убийств представителей индейского племени осейдж."
            ),
            "description_en": (
                "In 1920s Oklahoma, members of the oil-wealthy Osage Nation are murdered under mysterious "
                "circumstances, sparking a major FBI investigation led by J. Edgar Hoover."
            ),
            "poster": "https://images.justwatch.com/poster/307456859/s592/killers-of-the-flower-moon.webp",
            "poster_en": "https://images.justwatch.com/poster/307456859/s592/killers-of-the-flower-moon.webp",
            "backdrop": "https://images.justwatch.com/backdrop/355739049/s1920/killers-of-the-flower-moon.webp",
            "ambient_color": "#78350f",
            "ratings": {"critics": 93, "imdb": 7.6, "kinorium": 7.5},
            "providers": [
                {"id": "hdrezka", "available": True, "quality": "1080p • Jaskier / RHS", "url": "https://hdrezka-home.tv/films/thriller/57603-ubiycy-cvetochnoy-luny-2023.html"},
                {"id": "appletv", "available": True, "quality": "4K Dolby Vision (Apple Original)", "url": "https://tv.apple.com/pl/movie/killers-of-the-flower-moon/umc.cmc.5x1fg9v92s73g86110t65c82h"},
                {"id": "backup4k", "available": True, "quality": "4K UHD HDR", "url": "native://backup4k/tt5537002"},
            ],
            "featured": False,
        },
        {
            "id": "tt1877830",
            "rezka_id": "43217",
            "rezka_url": "https://hdrezka-home.tv/films/action/43217-betmen-2022.html",
            "title": "Бэтмен",
            "title_pl": "Batman",
            "orig_title": "The Batman",
            "year": 2022,
            "media_type": "movie",
            "seasons_count": 1,
            "episodes_per_season": 1,
            "duration_min": 176,
            "genres": ["Детектив", "Криминал", "Боевик"],
            "description": (
                "После двух лет поисков правосудия на улицах Готэма Бэтмен выходит на след "
                "серийного убийцы Загадочника, ведущего охоту на элиту города."
            ),
            "description_en": (
                "When a sadistic serial killer begins murdering key political figures in Gotham, "
                "Batman is forced to investigate the city's hidden corruption."
            ),
            "poster": "https://images.justwatch.com/poster/271794605/s592/batman-2022.webp",
            "poster_en": "https://images.justwatch.com/poster/271794605/s592/batman-2022.webp",
            "backdrop": "https://images.justwatch.com/backdrop/201892308/s1920/batman-2022.webp",
            "ambient_color": "#991b1b",
            "ratings": {"critics": 85, "imdb": 7.8, "kinorium": 7.8},
            "providers": [
                {"id": "hdrezka", "available": True, "quality": "1080p • Дубляж", "url": "https://hdrezka-home.tv/films/action/43217-betmen-2022.html"},
                {"id": "max", "available": True, "quality": "4K Dolby Vision", "url": "https://play.max.com/search?q=The%20Batman"},
                {"id": "netflix", "available": True, "quality": "4K UHD", "url": "https://www.netflix.com/search?q=The%20Batman"},
                {"id": "playerpl", "available": True, "quality": "Player.pl (HBO)", "url": "https://player.pl"},
                {"id": "backup4k", "available": True, "quality": "4K Dolby Vision", "url": "native://backup4k/tt1877830"},
            ],
            "featured": False,
        },
        {
            "id": "tt8367814",
            "rezka_id": "33026",
            "rezka_url": "https://hdrezka-home.tv/films/action/33026-dzhentlmeny-2020-latest.html",
            "title": "Джентльмены",
            "title_pl": "Dżentelmeni",
            "orig_title": "The Gentlemen",
            "year": 2020,
            "media_type": "movie",
            "seasons_count": 1,
            "episodes_per_season": 1,
            "duration_min": 113,
            "genres": ["Криминал", "Комедия", "Боевик"],
            "description": (
                "Талантливый выпускник Оксфорда строит нелегальную империю на поместьях обедневшей "
                "английской аристократии, но попытка продать бизнес запускает цепь интриг."
            ),
            "description_en": (
                "An American expat tries to sell off his highly profitable marijuana empire in London, "
                "triggering plots, schemes, bribery, and blackmail."
            ),
            "poster": "https://images.justwatch.com/poster/312778672/s592/dzentelmeni.webp",
            "poster_en": "https://images.metahub.space/poster/medium/tt8367814/img",
            "backdrop": "https://images.justwatch.com/backdrop/189936535/s1920/dzentelmeni.webp",
            "ambient_color": "#065f46",
            "ratings": {"critics": 75, "imdb": 7.8, "kinorium": 8.3},
            "providers": [
                {"id": "hdrezka", "available": True, "quality": "1080p • Дубляж / Гоблин", "url": "https://hdrezka-home.tv/films/action/33026-dzhentlmeny-2020-latest.html"},
                {"id": "netflix", "available": True, "quality": "4K UHD", "url": "https://www.netflix.com/search?q=The%20Gentlemen"},
                {"id": "prime", "available": True, "quality": "4K UHD", "url": "https://www.primevideo.com/search?phrase=The+Gentlemen"},
                {"id": "playerpl", "available": True, "quality": "Player.pl", "url": "https://player.pl"},
                {"id": "backup4k", "available": True, "quality": "4K BDRemux", "url": "native://backup4k/tt8367814"},
            ],
            "featured": False,
        },
        {
            "id": "tt9218128",
            "rezka_id": "72254",
            "rezka_url": "https://hdrezka-home.tv/films/action/72254-gladiator-2-2024.html",
            "title": "Гладиатор 2",
            "title_pl": "Gladiator II",
            "orig_title": "Gladiator II",
            "year": 2024,
            "media_type": "movie",
            "seasons_count": 1,
            "episodes_per_season": 1,
            "duration_min": 148,
            "genres": ["Боевик", "Драма", "Приключения"],
            "description": (
                "Спустя годы после гибели Максимуса повзрослевший Луций вынужден выйти на арену "
                "Колизея, чтобы вернуть славу Риму."
            ),
            "description_en": (
                "Years after witnessing the death of the revered hero Maximus, Lucius is forced to enter "
                "the Colosseum after his home is conquered by tyrannical emperors."
            ),
            "poster": "https://images.justwatch.com/poster/323203736/s592/gladiator-2.webp",
            "poster_en": "https://images.justwatch.com/poster/323203736/s592/gladiator-2.webp",
            "backdrop": "https://images.justwatch.com/backdrop/344681921/s1920/gladiator-2.webp",
            "ambient_color": "#b45309",
            "ratings": {"critics": 71, "imdb": 6.7, "kinorium": 6.6},
            "providers": [
                {"id": "hdrezka", "available": True, "quality": "1080p • Дубляж / RHS", "url": "https://hdrezka-home.tv/films/action/72254-gladiator-2-2024.html"},
                {"id": "appletv", "available": True, "quality": "4K Dolby Vision", "url": "https://tv.apple.com/pl"},
                {"id": "prime", "available": True, "quality": "4K UHD", "url": "https://www.primevideo.com/search?phrase=Gladiator+II"},
                {"id": "playerpl", "available": True, "quality": "Player.pl", "url": "https://player.pl"},
                {"id": "backup4k", "available": True, "quality": "4K UHD HDR10", "url": "native://backup4k/tt9218128"},
            ],
            "featured": False,
        },
        {
            "id": "tt12037194",
            "rezka_id": "64667",
            "rezka_url": "https://hdrezka-home.tv/films/fiction/64667-furiosa-hroniki-bezumnogo-maksa-2024-latest.html",
            "title": "Фуриоса: Хроники Безумного Макса",
            "title_pl": "Furiosa: Saga Mad Max",
            "orig_title": "Furiosa: A Mad Max Saga",
            "year": 2024,
            "media_type": "movie",
            "seasons_count": 1,
            "episodes_per_season": 1,
            "duration_min": 148,
            "genres": ["Боевик", "Фантастика", "Приключения"],
            "description": (
                "Юную Фуриосу похищают из Зеленых Земель многих матерей, и она попадает в руки "
                "байкерской орды под предводительством военачальника Дементуса."
            ),
            "description_en": (
                "Snatched from the Green Place of Many Mothers, young Furiosa falls into the hands of "
                "a great Biker Horde led by the Warlord Dementus across the Wasteland."
            ),
            "poster": "https://images.justwatch.com/poster/316152514/s592/furiosa.webp",
            "poster_en": "https://images.metahub.space/poster/medium/tt12037194/img",
            "backdrop": "https://images.justwatch.com/backdrop/309901741/s1920/furiosa.webp",
            "ambient_color": "#c2410c",
            "ratings": {"critics": 90, "imdb": 7.5, "kinorium": 7.4},
            "providers": [
                {"id": "hdrezka", "available": True, "quality": "1080p • Дубляж / RHS", "url": "https://hdrezka-home.tv/films/fiction/64667-furiosa-hroniki-bezumnogo-maksa-2024-latest.html"},
                {"id": "max", "available": True, "quality": "4K Dolby Vision", "url": "https://play.max.com/search?q=Furiosa"},
                {"id": "playerpl", "available": True, "quality": "Player.pl (Max)", "url": "https://player.pl"},
                {"id": "appletv", "available": True, "quality": "4K HDR", "url": "https://tv.apple.com/pl"},
                {"id": "backup4k", "available": True, "quality": "4K UHD HDR", "url": "native://backup4k/tt12037194"},
            ],
            "featured": False,
        },
    ]

    def __init__(
        self,
        net_client: DoHSplitNetworkClient,
        rezka_client: HDRezkaClient,
        kinorium_service: KinoriumService,
        stremio_engine: Any = None,
        en_meta_resolver: Optional[EnglishMetadataResolver] = None,
    ):
        self.net = net_client
        self.rezka = rezka_client
        self.kinorium = kinorium_service
        self.stremio = stremio_engine
        self.en_meta = en_meta_resolver
        self._premieres_cache: List[Dict[str, Any]] = []
        self._premieres_cache_ts: float = 0.0
        self._premieres_cache_key: tuple = ()
        self._catalog_cache: Dict[tuple, Dict[str, Any]] = {}
        self._person_raw_cache: Dict[str, Any] = {}

    def is_service_enabled(self, service_id: str) -> bool:
        return self.kinorium.is_service_enabled(service_id)

    def _filter_item_by_enabled_services(
        self, item: Dict[str, Any], allow_empty_providers: bool = False
    ) -> Any:
        raw_provs = list(item.get("providers") or [])
        if self.is_service_enabled("stremio") and not any(
            str(p.get("id") or "") == "stremio" for p in raw_provs
        ):
            raw_provs.append(
                {
                    "id": "stremio",
                    "available": True,
                    "quality": "Torrentio · 4K/1080p",
                    "url": f"native://stremio/{item.get('id', '')}",
                }
            )
        if not raw_provs:
            return item
        enabled_provs = [
            p for p in raw_provs if self.is_service_enabled(str(p.get("id") or ""))
        ]
        if not enabled_provs and not allow_empty_providers:
            return None
        copied = dict(item)
        copied["providers"] = enabled_provs
        return copied

    def _filter_items_list(
        self, items: List[Dict[str, Any]], allow_empty_providers: bool = False
    ) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        for it in items or []:
            filtered = self._filter_item_by_enabled_services(
                it, allow_empty_providers=allow_empty_providers
            )
            if filtered is not None:
                out.append(filtered)
        return out

    def enrich_item(self, item: Dict[str, Any]) -> Dict[str, Any]:
        enriched = dict(item)
        k_status = self.kinorium.get_item_status(
            item["id"],
            base_kinorium_rating=item.get("ratings", {}).get("kinorium", 8.0),
            title=item.get("title", ""),
            orig_title=item.get("orig_title", ""),
        )
        enriched["kinorium"] = k_status
        kid_val = str(k_status.get("kinorium_id") or "")
        if kid_val and not enriched.get("kinorium_id"):
            enriched["kinorium_id"] = kid_val
        if kid_val.isdigit():
            cur_poster = str(enriched.get("poster") or "")
            if not cur_poster or "hdrezka" in cur_poster.lower():
                enriched["poster"] = f"https://ru-images.kinorium.com/movie/600/{kid_val}.jpg"
                enriched["backdrop"] = f"https://ru-images.kinorium.com/movie/1080/{kid_val}.jpg"
        w_info = k_status.get("watched_info")
        if isinstance(w_info, dict):
            if w_info.get("genres"):
                cur_g = enriched.get("genres") or []
                if not cur_g or cur_g in (["Фильм"], ["Сериал"]):
                    enriched["genres"] = w_info["genres"]
            if w_info.get("orig_title") and (
                not enriched.get("orig_title") or enriched.get("orig_title") == enriched.get("title")
            ):
                enriched["orig_title"] = w_info["orig_title"]
            if w_info.get("seasons_count") and enriched.get("media_type") == "series":
                if enriched.get("seasons_count") in (None, 1, 2, 3):
                    enriched["seasons_count"] = w_info["seasons_count"]
        if not enriched.get("rezka_id"):
            live_m = self.kinorium.get_series_live_meta(
                item_id=str(enriched.get("id") or ""),
                title=str(enriched.get("title") or ""),
                orig_title=str(enriched.get("orig_title") or ""),
                kid=kid_val,
            )
            if live_m and not live_m.get("not_found"):
                if live_m.get("rezka_id"):
                    enriched["rezka_id"] = live_m["rezka_id"]
                if live_m.get("rezka_url") and not enriched.get("rezka_url"):
                    enriched["rezka_url"] = live_m["rezka_url"]

        rats = dict(enriched.get("ratings") or {})
        rats.pop("kp", None)
        if rats.get("critics") is None and k_status.get("critics_rating") is not None:
            rats["critics"] = int(k_status["critics_rating"])

        if self.en_meta is not None:
            cached_en = self.en_meta.get_cached(
                item_id=str(enriched.get("id") or ""),
                title=str(enriched.get("title") or ""),
                orig_title=str(enriched.get("orig_title") or ""),
                year=int(enriched.get("year") or 0),
                media_type=str(enriched.get("media_type") or ""),
                imdb_id=str(enriched.get("imdb_id") or ""),
            )
            if cached_en and cached_en.get("ok"):
                if cached_en.get("description_en"):
                    enriched["description_en"] = cached_en["description_en"]
                if cached_en.get("poster_en"):
                    enriched["poster_en"] = cached_en["poster_en"]
                if cached_en.get("title_en") and (
                    not enriched.get("orig_title") or has_cyrillic(str(enriched.get("orig_title") or ""))
                ):
                    enriched["orig_title"] = cached_en["title_en"]
                if rats.get("critics") is None and cached_en.get("critics_pct") is not None:
                    rats["critics"] = int(cached_en["critics_pct"])
                if cached_en.get("directors_en"):
                    enriched["directors_en"] = cached_en["directors_en"]
                if cached_en.get("actors_en"):
                    enriched["actors_en"] = cached_en["actors_en"]

        enriched["ratings"] = rats
        enriched["poster_en"] = resolve_original_poster_url(enriched)
        if not enriched.get("description_en") and enriched.get("description"):
            raw_desc = str(enriched["description"])
            enriched["description_en"] = (
                translate_kinorium_extra_desc_to_en(raw_desc) if has_cyrillic(raw_desc) else raw_desc
            )
        return enriched

    def _prewarm_en_metadata_for_items(self, items: List[Dict[str, Any]], max_items: int = 8) -> None:
        if self.en_meta is None or not items:
            return
        to_resolve: List[Dict[str, Any]] = []
        for it in items:
            if len(to_resolve) >= max_items:
                break
            desc_en = str(it.get("description_en") or "").strip()
            orig_val = str(it.get("orig_title") or "").strip()
            needs_en_title = not orig_val or has_cyrillic(orig_val)
            needs_plot = (
                not desc_en
                or "•" in desc_en
                or len(desc_en) < 42
                or has_cyrillic(desc_en)
                or re.search(r"\(\d{4}\b.*\)$", desc_en) is not None
            )
            if needs_plot or needs_en_title or not it.get("poster_en"):
                to_resolve.append(it)
        if not to_resolve:
            return
        from concurrent.futures import ThreadPoolExecutor

        def _resolve_one(target: Dict[str, Any]) -> None:
            res = self.en_meta.resolve(
                item_id=str(target.get("id") or ""),
                title=str(target.get("title") or ""),
                orig_title=str(target.get("orig_title") or ""),
                year=int(target.get("year") or 0),
                media_type=str(target.get("media_type") or ""),
                imdb_id=str(target.get("imdb_id") or ""),
                kinorium_id=str(target.get("kinorium_id") or ""),
                need_episodes=False,
            )
            if not res or not res.get("ok"):
                return
            if res.get("description_en"):
                target["description_en"] = res["description_en"]
            if res.get("poster_en"):
                target["poster_en"] = res["poster_en"]
            if res.get("title_en") and (
                not target.get("orig_title") or has_cyrillic(str(target.get("orig_title") or ""))
            ):
                target["orig_title"] = res["title_en"]
            if res.get("critics_pct") is not None:
                rats = dict(target.get("ratings") or {})
                if rats.get("critics") is None:
                    rats["critics"] = int(res["critics_pct"])
                    target["ratings"] = rats
            if res.get("directors_en"):
                target["directors_en"] = res["directors_en"]
            if res.get("actors_en"):
                target["actors_en"] = res["actors_en"]

        with ThreadPoolExecutor(max_workers=min(8, len(to_resolve))) as pool:
            futs = [pool.submit(_resolve_one, t) for t in to_resolve]
            for f in futs:
                try:
                    f.result(timeout=4.5)
                except Exception:
                    pass

    def _enrich_from_curated(self, items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        curated_by_title = {}
        for c_it in self.CURATED_CATALOG:
            curated_by_title[c_it.get("title", "").strip().lower()] = c_it
            if c_it.get("orig_title"):
                curated_by_title[c_it["orig_title"].strip().lower()] = c_it

        for it in items:
            c_match = curated_by_title.get(it.get("title", "").strip().lower()) or curated_by_title.get(
                it.get("orig_title", "").strip().lower()
            )
            if c_match:
                it["rezka_id"] = c_match.get("rezka_id", "")
                it["rezka_url"] = c_match.get("rezka_url", "")
                it["providers"] = c_match.get("providers", it.get("providers", []))
                it["ambient_color"] = c_match.get("ambient_color", it.get("ambient_color", "#1e293b"))
                if c_match.get("description"):
                    it["description"] = c_match["description"]
                if c_match.get("description_en"):
                    it["description_en"] = c_match["description_en"]
                if c_match.get("poster_en"):
                    it["poster_en"] = c_match["poster_en"]
                c_rats = c_match.get("ratings") or {}
                if c_rats.get("critics") is not None:
                    rats = dict(it.get("ratings") or {})
                    rats.pop("kp", None)
                    if rats.get("critics") is None:
                        rats["critics"] = c_rats["critics"]
                    it["ratings"] = rats
            live_m = self.kinorium.get_series_live_meta(
                item_id=str(it.get("id") or ""),
                title=str(it.get("title") or ""),
                orig_title=str(it.get("orig_title") or ""),
                kid=str(it.get("kinorium_id") or ""),
            )
            if live_m and not live_m.get("not_found"):
                if live_m.get("rezka_id") and not it.get("rezka_id"):
                    it["rezka_id"] = live_m["rezka_id"]
                if live_m.get("rezka_url") and not it.get("rezka_url"):
                    it["rezka_url"] = live_m["rezka_url"]
        return items

    def _get_online_premieres(self) -> List[Dict[str, Any]]:
        now = time.time()
        kin_premieres = self.kinorium.fetch_online_premieres()
        if kin_premieres:
            self._enrich_from_curated(kin_premieres)
            enriched = [self.enrich_item(it) for it in kin_premieres]
            return self._filter_items_list(enriched, allow_empty_providers=True)

        pkg_service_pairs = [
            ("nfx", "netflix"),
            ("atp", "appletv"),
            ("prv", "prime"),
            ("dnp", "disney"),
            ("mxx", "max"),
            ("plp", "playerpl"),
        ]
        pkgs = [code for code, srv_id in pkg_service_pairs if self.is_service_enabled(srv_id)]
        cache_key = tuple(pkgs)

        if self._premieres_cache and self._premieres_cache_key == cache_key and (now - self._premieres_cache_ts) < 900:
            return self._filter_items_list(
                [self.enrich_item(it) for it in self._premieres_cache], allow_empty_providers=True
            )

        jw_movies = (
            self._query_justwatch_graphql(
                {"objectTypes": ["MOVIE"], "releaseYear": {"min": 2025}, "packages": pkgs},
                first=25,
            )
            if pkgs
            else []
        )
        jw_shows = (
            self._query_justwatch_graphql(
                {"objectTypes": ["SHOW"], "releaseYear": {"min": 2025}, "packages": pkgs},
                first=25,
            )
            if pkgs
            else []
        )

        combined: List[Dict[str, Any]] = []
        seen_ids = set()
        seen_titles = set()
        for jw in jw_movies + jw_shows:
            t_low = jw.get("title", "").strip().lower()
            if jw["id"] not in seen_ids and t_low not in seen_titles:
                combined.append(jw)
                seen_ids.add(jw["id"])
                seen_titles.add(t_low)

        if combined:
            self._premieres_cache = combined
            self._premieres_cache_ts = now
            self._premieres_cache_key = cache_key
        return self._filter_items_list([self.enrich_item(it) for it in combined], allow_empty_providers=True)

    def get_catalog(
        self,
        provider_filter: str = "all",
        media_type_filter: str = "all",
        kinorium_section: str = "all",
        lang: str = "ru",
    ) -> Dict[str, Any]:
        ui_lang = "en" if str(lang or "").strip().lower().startswith("en") else "ru"
        if provider_filter and provider_filter != "all" and not self.is_service_enabled(provider_filter):
            provider_filter = "all"

        kin_enabled = self.is_service_enabled("kinorium")
        if not kin_enabled and kinorium_section in ("watching", "watchlist", "watched", "never"):
            kinorium_section = "all"

        cache_key = (
            provider_filter,
            media_type_filter,
            kinorium_section,
            ui_lang,
            getattr(self.kinorium, "_state_version", 0),
            int(time.time() // 120),
        )
        cached_base = self._catalog_cache.get(cache_key)
        if cached_base is not None:
            cw_list = self._build_continue_watching_list()
            resp = dict(cached_base)
            resp["continue_watching"] = cw_list[:24]
            return resp

        if kinorium_section in ("watching", "watchlist", "watched", "never"):
            premieres_all = []
            premieres_count = self.kinorium.get_online_premieres_count()
        else:
            premieres_all = self._get_online_premieres()
            premieres_count = len(premieres_all)

        if kinorium_section == "premieres":
            items = list(premieres_all)
            if provider_filter and provider_filter not in ("all", "hdrezka", "backup4k"):
                items = [
                    it
                    for it in items
                    if any(p["id"] == provider_filter and p.get("available") for p in it.get("providers", []))
                ]
            if media_type_filter in ("movie", "series"):
                items = [it for it in items if it.get("media_type") == media_type_filter]

        elif kinorium_section in ("watching", "watchlist", "watched", "never"):
            items = self.kinorium.get_section_catalog_items(
                section=kinorium_section,
                media_type_filter=media_type_filter,
                query="",
            )
            self._enrich_from_curated(items)
            items = [self.enrich_item(it) for it in items]
            items = self._filter_items_list(items, allow_empty_providers=True)

            if provider_filter and provider_filter not in ("all", "hdrezka", "backup4k"):
                items = [
                    it
                    for it in items
                    if any(p["id"] == provider_filter and p.get("available") for p in it.get("providers", []))
                ]
        else:
            # Main Screen ('all'):
            # 1. Include series the user is watching ('Смотрю') that have new/unwatched episodes!
            # 2. Exclude movies/series where the user has ALREADY watched everything (`watched == True` and no new episodes)
            #    or marked 'Не буду смотреть' (`not_watching == True`).
            watching_new_eps = (
                self._enrich_from_curated(self.kinorium.get_watching_with_new_episodes())
                if kin_enabled
                else []
            )
            base_curated = [self.enrich_item(it) for it in self.CURATED_CATALOG]

            merged: List[Dict[str, Any]] = []
            seen_ids = set()
            seen_titles = set()

            def _add_if_unwatched_main(candidate: Dict[str, Any]):
                filtered_cand = self._filter_item_by_enabled_services(candidate)
                if filtered_cand is None:
                    return
                ks = filtered_cand.get("kinorium") or {}
                if kin_enabled:
                    if ks.get("not_watching"):
                        return
                    if ks.get("watched") and not ks.get("has_new_episode"):
                        return
                t_low = filtered_cand.get("title", "").strip().lower()
                if filtered_cand["id"] in seen_ids or (t_low and t_low in seen_titles):
                    return
                seen_ids.add(filtered_cand["id"])
                if t_low:
                    seen_titles.add(t_low)
                merged.append(filtered_cand)

            # First place unwatched curated items and active series with new episodes
            for it in base_curated:
                _add_if_unwatched_main(it)
            for it in watching_new_eps:
                _add_if_unwatched_main(it)
            # Also supplement with unwatched online premieres so the main screen always has fresh movies & series
            for it in premieres_all:
                _add_if_unwatched_main(it)

            if provider_filter and provider_filter != "all":
                extra_jw = self._fetch_justwatch_by_provider(provider_filter)
                for jw in extra_jw:
                    _add_if_unwatched_main(self.enrich_item(jw))
                items = [
                    it
                    for it in merged
                    if any(p["id"] == provider_filter and p.get("available") for p in it.get("providers", []))
                ]
            else:
                items = merged

            if media_type_filter in ("movie", "series"):
                items = [it for it in items if it.get("media_type") == media_type_filter]

        if ui_lang == "en" and items:
            self._prewarm_en_metadata_for_items(items[:10], max_items=8)

        cw_list = self._build_continue_watching_list()
        enabled_providers_meta = {
            k: v for k, v in self.PROVIDERS_META.items() if self.is_service_enabled(k)
        }

        base_payload = {
            "region": "PL",
            "providers_meta": enabled_providers_meta,
            "integrations": self.kinorium.get_integrations(),
            "kinorium_account": self.kinorium.get_account_summary(),
            "kinorium_friends": self.kinorium.state.get("friends", []) if kin_enabled else [],
            "kinorium_counts": self.kinorium.get_sections_counts(premieres_count=premieres_count),
            "continue_watching": cw_list[:24],
            "similar_pool": self._filter_items_list([self.enrich_item(it) for it in self.CURATED_CATALOG]),
            "items": items,
        }
        if len(self._catalog_cache) >= 24:
            self._catalog_cache.clear()
        self._catalog_cache[cache_key] = base_payload
        return base_payload

    def _build_continue_watching_list(self) -> List[Dict[str, Any]]:
        """
        Builds 'Новые серии и Продолжить просмотр' (continue_watching):
        - Only includes items that are NOT completely watched (`not watched` or `has_new_episode`)
        - Automatically includes series from 'Смотрю' that have new/unwatched episodes!
        """
        if (
            not self.is_service_enabled("hdrezka")
            and not self.is_service_enabled("backup4k")
            and not self.is_service_enabled("stremio")
        ):
            return []

        kin_enabled = self.is_service_enabled("kinorium")
        cw_list: List[Dict[str, Any]] = []
        cw_seen_titles = set()
        cw_seen_ids = set()
        cw_dismissed = set(self.kinorium.state.get("cw_dismissed") or [])

        for cw in self.kinorium.state.get("continue_watching", []):
            cw_id = cw.get("id", "")
            cw_norm_t = (cw.get("title", "") or "").strip().lower()
            if cw_id in cw_dismissed or (cw_norm_t and f"title:{cw_norm_t}" in cw_dismissed):
                continue
            if float(cw.get("current_time") or 0) < 15.0 and not cw.get("is_new_episode"):
                continue
            k_st = self.kinorium.get_item_status(
                cw.get("id", ""),
                title=cw.get("title", ""),
                orig_title=cw.get("orig_title", ""),
            )
            if kin_enabled and (
                k_st.get("not_watching") or (k_st.get("watched") and not k_st.get("has_new_episode"))
            ):
                continue
            cw_copy = dict(cw)
            matched_cat = next(
                (
                    c
                    for c in self.CURATED_CATALOG
                    if c["id"] == cw.get("id") or c.get("title", "").lower() == cw.get("title", "").lower()
                ),
                None,
            )
            if matched_cat:
                cw_copy["poster"] = matched_cat["poster"]
                cw_copy["poster_en"] = matched_cat.get("poster_en") or resolve_original_poster_url(matched_cat)
                cw_copy["backdrop"] = matched_cat["backdrop"]
            else:
                cw_copy["poster_en"] = resolve_original_poster_url(
                    {
                        **cw_copy,
                        "kinorium_id": str(k_st.get("kinorium_id") or cw_copy.get("kinorium_id") or ""),
                    }
                )
            if cw_copy.get("is_new_episode") and k_st.get("episode_verified"):
                cw_copy["season"] = k_st.get("next_season") or cw_copy.get("season") or 1
                cw_copy["episode"] = k_st.get("next_episode") or cw_copy.get("episode") or 1
            cw_copy["episode_verified"] = bool(
                k_st.get("episode_verified") or not cw_copy.get("is_new_episode")
            )
            if k_st.get("studios_summary") and (
                not cw_copy.get("studio") or cw_copy.get("studio") == "Новая серия"
            ):
                cw_copy["studio"] = k_st["studios_summary"]
            cw_copy["kinorium"] = k_st
            cw_list.append(cw_copy)
            cw_seen_ids.add(cw_copy.get("id", ""))
            cw_seen_titles.add(cw_copy.get("title", "").strip().lower())

        if kin_enabled and self.is_service_enabled("hdrezka"):
            for w_ep in self._enrich_from_curated(self.kinorium.get_watching_with_new_episodes()):
                t_low = w_ep.get("title", "").strip().lower()
                if w_ep["id"] in cw_dismissed or (t_low and f"title:{t_low}" in cw_dismissed):
                    continue
                if w_ep["id"] in cw_seen_ids or (t_low and t_low in cw_seen_titles):
                    continue
                ks = w_ep.get("kinorium") or {}
                cw_list.append(
                    {
                        "id": w_ep["id"],
                        "title": w_ep["title"],
                        "orig_title": w_ep.get("orig_title", ""),
                        "rezka_id": w_ep.get("rezka_id", ""),
                        "rezka_url": w_ep.get("rezka_url", ""),
                        "poster": w_ep.get("poster", ""),
                        "poster_en": w_ep.get("poster_en") or resolve_original_poster_url(w_ep),
                        "backdrop": w_ep.get("backdrop") or w_ep.get("poster", ""),
                        "media_type": "series",
                        "season": ks.get("next_season") or w_ep.get("seasons_count") or 1,
                        "episode": ks.get("next_episode") or 1,
                        "episode_verified": bool(ks.get("episode_verified")),
                        "latest_season": ks.get("latest_season"),
                        "latest_episode": ks.get("latest_episode"),
                        "current_time": 0.0,
                        "duration": 3300.0,
                        "progress": 0.0,
                        "is_new_episode": True,
                        "source": "HDRezka",
                        "studio": ks.get("studios_summary") or "HDRezka",
                        "kinorium": ks,
                    }
                )
                cw_seen_ids.add(w_ep["id"])
                if t_low:
                    cw_seen_titles.add(t_low)
        return cw_list

    def unified_search(
        self,
        query: str,
        provider_filter: str = "all",
        media_type_filter: str = "all",
        kinorium_section: str = "all",
        lang: str = "ru",
    ) -> Dict[str, Any]:
        ui_lang = "en" if str(lang or "").strip().lower().startswith("en") else "ru"
        q_clean = query.strip()
        if not q_clean:
            return self.get_catalog(provider_filter, media_type_filter, kinorium_section, lang=ui_lang)

        if provider_filter and provider_filter != "all" and not self.is_service_enabled(provider_filter):
            provider_filter = "all"

        kin_enabled = self.is_service_enabled("kinorium")
        if not kin_enabled and kinorium_section in ("watching", "watchlist", "watched", "never"):
            kinorium_section = "all"

        premieres_all = self._get_online_premieres()
        premieres_count = len(premieres_all)
        cw_list = self._build_continue_watching_list()
        enabled_providers_meta = {
            k: v for k, v in self.PROVIDERS_META.items() if self.is_service_enabled(k)
        }
        sim_pool = self._filter_items_list([self.enrich_item(it) for it in self.CURATED_CATALOG])

        if kinorium_section == "premieres":
            q_low = q_clean.lower()
            matched = [
                it
                for it in premieres_all
                if q_low in it.get("title", "").lower() or q_low in it.get("orig_title", "").lower()
            ]
            if media_type_filter in ("movie", "series"):
                matched = [it for it in matched if it.get("media_type") == media_type_filter]
            similar_items = self._build_search_similar_items(
                matched=matched,
                extra_candidates=[],
                sim_pool=sim_pool,
                premieres_all=premieres_all,
                provider_filter=provider_filter,
                media_type_filter=media_type_filter,
                kin_enabled=kin_enabled,
            )
            return {
                "query": q_clean,
                "region": "PL",
                "providers_meta": enabled_providers_meta,
                "integrations": self.kinorium.get_integrations(),
                "kinorium_account": self.kinorium.get_account_summary(),
                "kinorium_friends": self.kinorium.state.get("friends", []) if kin_enabled else [],
                "kinorium_counts": self.kinorium.get_sections_counts(premieres_count=premieres_count),
                "continue_watching": cw_list[:24],
                "similar_pool": sim_pool,
                "similar_items": similar_items,
                "items": matched,
            }

        if kinorium_section in ("watching", "watchlist", "watched", "never"):
            matched = self._filter_items_list(
                self._enrich_from_curated(
                    self.kinorium.get_section_catalog_items(
                        section=kinorium_section,
                        media_type_filter=media_type_filter,
                        query=q_clean,
                    )
                ),
                allow_empty_providers=True,
            )
            similar_items = self._build_search_similar_items(
                matched=matched,
                extra_candidates=[],
                sim_pool=sim_pool,
                premieres_all=premieres_all,
                provider_filter=provider_filter,
                media_type_filter=media_type_filter,
                kin_enabled=kin_enabled,
            )
            return {
                "query": q_clean,
                "region": "PL",
                "providers_meta": enabled_providers_meta,
                "integrations": self.kinorium.get_integrations(),
                "kinorium_account": self.kinorium.get_account_summary(),
                "kinorium_friends": self.kinorium.state.get("friends", []) if kin_enabled else [],
                "kinorium_counts": self.kinorium.get_sections_counts(premieres_count=premieres_count),
                "continue_watching": cw_list[:24],
                "similar_pool": sim_pool,
                "similar_items": similar_items,
                "items": matched,
            }

        q_lower = q_clean.lower()
        q_norm = _norm_title(q_clean)
        stop_words = {
            "в",
            "на",
            "и",
            "с",
            "по",
            "из",
            "за",
            "к",
            "о",
            "у",
            "от",
            "до",
            "для",
            "the",
            "a",
            "an",
            "of",
            "in",
            "on",
            "to",
            "and",
        }
        raw_words = [w for w in q_norm.split() if w]
        sig_tokens = [w for w in raw_words if w not in stop_words and len(w) >= 2]
        if not sig_tokens:
            sig_tokens = raw_words

        is_person_search = q_lower in self.rezka.person_url_by_name
        known_genres = {
            str(g).strip().lower()
            for c_it in self.CURATED_CATALOG
            for g in (c_it.get("genres") or [])
            if g
        }
        is_genre_search = len(sig_tokens) == 1 and q_norm in known_genres

        merged_pool: List[Dict[str, Any]] = []

        def _add_or_merge_candidate(raw_cand: Dict[str, Any], allow_empty_providers: bool = False):
            filtered_cand = self._filter_item_by_enabled_services(
                raw_cand, allow_empty_providers=allow_empty_providers
            )
            if filtered_cand is None:
                return
            for idx, existing in enumerate(merged_pool):
                if self._is_same_work(existing, filtered_cand):
                    merged_pool[idx] = self._merge_two_search_items(existing, filtered_cand, sig_tokens)
                    return
            merged_pool.append(filtered_cand)

        for item in self.CURATED_CATALOG:
            title_hay = " ".join(
                [
                    item.get("title", ""),
                    item.get("title_pl", ""),
                    item.get("orig_title", ""),
                ]
            ).lower()
            genre_hay = " ".join(item.get("genres", [])).lower() if is_genre_search else ""
            if q_lower in title_hay or (is_genre_search and q_lower in genre_hay):
                _add_or_merge_candidate(self.enrich_item(item))

        if kin_enabled:
            for sec in ("watching", "watchlist", "watched", "never"):
                for k_item in self.kinorium.get_section_catalog_items(sec, "all", q_clean):
                    _add_or_merge_candidate(k_item, allow_empty_providers=True)

        want_rz = self.is_service_enabled("hdrezka")
        want_kn = bool(kin_enabled and not is_person_search)
        want_jw = bool(
            not is_person_search
            and any(self.is_service_enabled(s) for s in ("appletv", "netflix", "prime", "disney", "max", "playerpl"))
        )
        want_st = bool(self.stremio is not None and self.is_service_enabled("stremio") and not is_person_search)
        active_search_tasks = sum([1 if want_rz else 0, 1 if want_kn else 0, 1 if want_jw else 0, 1 if want_st else 0])
        rz_hits: List[Dict[str, Any]] = []
        kn_hits: List[Dict[str, Any]] = []
        jw_hits: List[Dict[str, Any]] = []
        st_hits: List[Dict[str, Any]] = []

        if active_search_tasks > 1:
            from concurrent.futures import ThreadPoolExecutor

            with ThreadPoolExecutor(max_workers=active_search_tasks) as search_pool:
                fut_rz = search_pool.submit(self._search_hdrezka_live, q_clean) if want_rz else None
                fut_kn = search_pool.submit(self._search_kinorium_live, q_clean) if want_kn else None
                fut_jw = search_pool.submit(self._search_justwatch_poland, q_clean) if want_jw else None
                fut_st = (
                    search_pool.submit(self.stremio.search_cinemeta, q_clean, media_type_filter)
                    if want_st
                    else None
                )
                if fut_rz is not None:
                    try:
                        rz_hits = fut_rz.result(timeout=9.0) or []
                    except Exception:
                        rz_hits = []
                if fut_kn is not None:
                    try:
                        kn_hits = fut_kn.result(timeout=7.5) or []
                    except Exception:
                        kn_hits = []
                if fut_jw is not None:
                    try:
                        jw_hits = fut_jw.result(timeout=6.0) or []
                    except Exception:
                        jw_hits = []
                if fut_st is not None:
                    try:
                        st_hits = fut_st.result(timeout=5.5) or []
                    except Exception:
                        st_hits = []
        else:
            if want_rz:
                rz_hits = self._search_hdrezka_live(q_clean)
            if want_kn:
                kn_hits = self._search_kinorium_live(q_clean)
            if want_jw:
                jw_hits = self._search_justwatch_poland(q_clean)
            if want_st:
                st_hits = self.stremio.search_cinemeta(q_clean, media_type_filter)

        for rz_item in rz_hits:
            rz_enriched = self.enrich_item(rz_item)
            rz_enriched["_from_hdrezka"] = True
            _add_or_merge_candidate(rz_enriched)

        for kn_item in kn_hits:
            _add_or_merge_candidate(self.enrich_item(kn_item), allow_empty_providers=True)

        for jw in jw_hits:
            _add_or_merge_candidate(self.enrich_item(jw))

        for st_item in st_hits:
            _add_or_merge_candidate(self.enrich_item(st_item))

        extra_for_similar: List[Dict[str, Any]] = []

        if is_person_search or is_genre_search or not sig_tokens:
            relevant_items = list(merged_pool)
        else:
            strict_hits: List[Dict[str, Any]] = []
            partial_hits: List[Dict[str, Any]] = []
            longest_tok = max(sig_tokens, key=len)

            for cand in merged_pool:
                aliases_set = self._extract_item_aliases(cand)
                alias_words = {w for a in aliases_set for w in a.split()}

                def _matches_tok(tok: str) -> bool:
                    return any(
                        w == tok
                        or (len(tok) >= 3 and w.startswith(tok))
                        or (len(tok) >= 5 and tok in w)
                        for w in alias_words
                    )

                matched_count = sum(1 for tok in sig_tokens if _matches_tok(tok))
                if matched_count == len(sig_tokens):
                    strict_hits.append(cand)
                elif matched_count > 0:
                    partial_hits.append(cand)
                    extra_for_similar.append(cand)

            if strict_hits:
                relevant_items = strict_hits
            else:
                # Fallback 1: match longest distinctive token (e.g. if one service omitted a prefix word)
                fallback_longest = (
                    [
                        c
                        for c in partial_hits
                        if len(longest_tok) >= 4
                        and any(
                            w == longest_tok or w.startswith(longest_tok)
                            for a in self._extract_item_aliases(c)
                            for w in a.split()
                        )
                    ]
                    if partial_hits
                    else []
                )
                if fallback_longest:
                    relevant_items = fallback_longest
                else:
                    # Fallback 2: user manually typed a director/actor name into search -> keep HDRezka filmography hits
                    hdrezka_person_hits = [c for c in merged_pool if c.get("_from_hdrezka")]
                    relevant_items = hdrezka_person_hits if hdrezka_person_hits else partial_hits

            def _relevance_rank(cand: Dict[str, Any]) -> float:
                aliases_set = self._extract_item_aliases(cand)
                sc = 0.0
                if q_norm in aliases_set:
                    sc += 120.0
                elif any(a.startswith(q_norm) for a in aliases_set):
                    sc += 80.0
                elif any(q_norm in a for a in aliases_set):
                    sc += 50.0
                if cand.get("rezka_id"):
                    sc += 15.0
                ks = cand.get("kinorium") or {}
                if ks.get("watching") or ks.get("in_watchlist") or ks.get("watched"):
                    sc += 10.0
                try:
                    kr = float(ks.get("kinorium_rating") or (cand.get("ratings") or {}).get("kinorium") or 7.5)
                except (ValueError, TypeError):
                    kr = 7.5
                sc += min(10.0, kr)
                return sc

            relevant_items.sort(key=_relevance_rank, reverse=True)

        matched = [self._strip_internal_search_keys(it) for it in relevant_items]

        if provider_filter and provider_filter != "all":
            matched = [
                it
                for it in matched
                if any(p["id"] == provider_filter and p.get("available") for p in it.get("providers", []))
            ]

        if media_type_filter in ("movie", "series"):
            matched = [it for it in matched if it.get("media_type") == media_type_filter]

        if ui_lang == "en" and matched:
            self._prewarm_en_metadata_for_items(matched[:6], max_items=6)

        similar_items = self._build_search_similar_items(
            matched=matched,
            extra_candidates=extra_for_similar,
            sim_pool=sim_pool,
            premieres_all=premieres_all,
            provider_filter=provider_filter,
            media_type_filter=media_type_filter,
            kin_enabled=kin_enabled,
        )

        return {
            "query": q_clean,
            "region": "PL",
            "providers_meta": enabled_providers_meta,
            "integrations": self.kinorium.get_integrations(),
            "kinorium_account": self.kinorium.get_account_summary(),
            "kinorium_friends": self.kinorium.state.get("friends", []) if kin_enabled else [],
            "kinorium_counts": self.kinorium.get_sections_counts(premieres_count=premieres_count),
            "continue_watching": cw_list[:24],
            "similar_pool": sim_pool,
            "similar_items": similar_items,
            "items": matched,
        }

    COUNTRY_STOPWORDS = {
        "сша",
        "великобритания",
        "россия",
        "ссср",
        "франция",
        "германия",
        "италия",
        "испания",
        "канада",
        "япония",
        "южная корея",
        "корея",
        "китай",
        "польша",
        "австралия",
        "швеция",
        "дания",
        "норвегия",
        "бельгия",
        "нидерланды",
        "ирландия",
        "мексика",
        "бразилия",
        "индия",
        "турция",
        "украина",
        "чехия",
        "финляндия",
        "швейцария",
        "австрия",
        "новая зеландия",
        "гонконг",
        "тайвань",
        "аргентина",
        "зарубежные",
        "русские",
    }

    GENERIC_SIMILAR_WORDS = {
        "фильм",
        "сериал",
        "сезон",
        "часть",
        "история",
        "жизнь",
        "любовь",
        "война",
        "город",
        "время",
        "черный",
        "белый",
        "новый",
        "последний",
        "первый",
        "большой",
        "маленький",
        "тайна",
        "дело",
        "дом",
        "путь",
        "мир",
        "день",
        "ночь",
        "человек",
        "люди",
        "семья",
        "клан",
        "movie",
        "series",
        "story",
        "world",
        "house",
        "black",
        "white",
        "night",
        "first",
    }

    GENRE_CANONICAL_MAP = {
        "драмы": "Драма",
        "драма": "Драма",
        "триллеры": "Триллер",
        "триллер": "Триллер",
        "комедии": "Комедия",
        "комедия": "Комедия",
        "боевики": "Боевик",
        "боевик": "Боевик",
        "детективы": "Детектив",
        "детектив": "Детектив",
        "мелодрамы": "Мелодрама",
        "мелодрама": "Мелодрама",
        "ужасы": "Ужасы",
        "фантастика": "Фантастика",
        "фэнтези": "Фэнтези",
        "криминал": "Криминал",
        "приключения": "Приключения",
        "документальные": "Документальный",
        "документальный": "Документальный",
        "биографические": "Биография",
        "биография": "Биография",
        "исторические": "История",
        "история": "История",
        "военные": "Военный",
        "военный": "Военный",
        "семейные": "Семейный",
        "семейный": "Семейный",
        "мультфильмы": "Мультфильм",
        "мультфильм": "Мультфильм",
        "аниме": "Аниме",
        "спортивные": "Спорт",
        "спорт": "Спорт",
        "вестерны": "Вестерн",
        "вестерн": "Вестерн",
        "мюзиклы": "Мюзикл",
        "мюзикл": "Мюзикл",
    }

    @classmethod
    def _canonical_genre(cls, raw_genre: str) -> str:
        gs = str(raw_genre or "").strip()
        if not gs:
            return ""
        return cls.GENRE_CANONICAL_MAP.get(gs.lower(), gs)

    @staticmethod
    def _extract_item_aliases(item: Dict[str, Any]) -> Set[str]:
        aliases: Set[str] = set()

        def _push_variant(v: str):
            if not v:
                return
            aliases.add(v)
            stripped = re.sub(
                r"\b(?:фильм|сериал|кино)\s+по\s+мотивам(?:\s+сериала|\s+фильма)?\s+",
                "",
                v,
            ).strip()
            stripped = re.sub(r"\s+", " ", stripped)
            if stripped and stripped != v:
                aliases.add(stripped)

        for field in ("title", "orig_title", "title_pl"):
            for v in _title_variants(str(item.get(field) or "")):
                _push_variant(v)
        for raw_a in item.get("_aliases") or []:
            for v in _title_variants(str(raw_a or "")):
                _push_variant(v)
        ks = item.get("kinorium")
        if isinstance(ks, dict):
            w_info = ks.get("watched_info")
            if isinstance(w_info, dict):
                for field in ("ru_title", "orig_title", "title"):
                    for v in _title_variants(str(w_info.get(field) or "")):
                        _push_variant(v)
        return aliases

    @staticmethod
    def _poster_quality_score(url: str, is_backdrop: bool = False) -> int:
        u = (url or "").strip().lower()
        if not u:
            return 0
        if "hdrezka" in u or "rezka" in u:
            return 1
        score = 3 if any(h in u for h in ("images.justwatch.com", "ru-images.kinorium.com", "image.tmdb.org", "unsplash.com")) else 2
        if is_backdrop and any(w in u for w in ("1080", "1920", "backdrop", "original")):
            score += 2
        return score

    @classmethod
    def _is_same_work(cls, a: Dict[str, Any], b: Dict[str, Any]) -> bool:
        id_a = str(a.get("id") or "")
        id_b = str(b.get("id") or "")
        if id_a and id_a == id_b:
            return True
        rid_a = str(a.get("rezka_id") or "")
        rid_b = str(b.get("rezka_id") or "")
        if rid_a and rid_a == rid_b:
            return True
        kid_a = str(a.get("kinorium_id") or (a.get("kinorium") or {}).get("kinorium_id") or "")
        kid_b = str(b.get("kinorium_id") or (b.get("kinorium") or {}).get("kinorium_id") or "")
        if kid_a and kid_a == kid_b:
            return True
        if a.get("media_type") != b.get("media_type"):
            return False
        yr_a = int(a.get("year") or 0)
        yr_b = int(b.get("year") or 0)
        if yr_a and yr_b and abs(yr_a - yr_b) > 1:
            return False
        aliases_a = cls._extract_item_aliases(a)
        aliases_b = cls._extract_item_aliases(b)
        return bool(aliases_a and aliases_b and (aliases_a & aliases_b))

    def _merge_two_search_items(
        self,
        base: Dict[str, Any],
        inc: Dict[str, Any],
        q_tokens: List[str],
    ) -> Dict[str, Any]:
        merged = dict(base)

        def _id_rank(val: str) -> int:
            if not val:
                return 0
            if val.startswith("tt"):
                return 4
            if val.startswith("kin_"):
                return 3
            if not val.startswith("rezka_"):
                return 2
            return 1

        if _id_rank(str(inc.get("id") or "")) > _id_rank(str(merged.get("id") or "")):
            merged["id"] = inc["id"]

        for key in ("rezka_id", "rezka_url", "kinorium_id"):
            if not merged.get(key) and inc.get(key):
                merged[key] = inc[key]

        def _title_score(t: str) -> float:
            s = (t or "").strip()
            if not s:
                return -1.0
            sc = 0.0
            if re.search(r"[А-Яа-яЁё]", s):
                sc += 10.0
            if "/" not in s:
                sc += 3.0
            t_words = set(_norm_title(s).split())
            for qt in q_tokens:
                if any(w == qt or (len(qt) >= 3 and w.startswith(qt)) for w in t_words):
                    sc += 5.0
            return sc

        if _title_score(str(inc.get("title") or "")) > _title_score(str(merged.get("title") or "")):
            merged["title"] = inc["title"]

        def _orig_score(orig: str, ru_t: str) -> int:
            o = (orig or "").strip()
            if not o:
                return 0
            sc = 1
            if _norm_title(o) != _norm_title(ru_t):
                sc += 2
            if re.search(r"[A-Za-z]", o):
                sc += 4
            return sc

        cur_ru = str(merged.get("title") or "")
        if _orig_score(str(inc.get("orig_title") or ""), cur_ru) > _orig_score(
            str(merged.get("orig_title") or ""), cur_ru
        ):
            merged["orig_title"] = inc["orig_title"]

        if inc.get("title_pl") and (
            not merged.get("title_pl") or merged.get("title_pl") == merged.get("title")
        ):
            merged["title_pl"] = inc["title_pl"]

        if self._poster_quality_score(str(inc.get("poster") or ""), False) > self._poster_quality_score(
            str(merged.get("poster") or ""), False
        ):
            merged["poster"] = inc["poster"]

        if self._poster_quality_score(str(inc.get("backdrop") or ""), True) > self._poster_quality_score(
            str(merged.get("backdrop") or ""), True
        ):
            merged["backdrop"] = inc["backdrop"]

        combined_genres: List[str] = []
        for g in list(merged.get("genres") or []) + list(inc.get("genres") or []):
            gs = self._canonical_genre(str(g or ""))
            gl = gs.lower()
            if not gs or gl in ("фильм", "сериал") or gl in self.COUNTRY_STOPWORDS:
                continue
            if not any(existing.lower() == gl for existing in combined_genres):
                combined_genres.append(gs)
        if combined_genres:
            merged["genres"] = combined_genres[:4]

        def _desc_score(d: str) -> int:
            ds = (d or "").strip()
            if not ds:
                return 0
            if re.match(r"^[^()]{1,70}\s*\([^()]{1,90}\)$", ds):
                return 1
            return min(500, len(ds))

        if _desc_score(str(inc.get("description") or "")) > _desc_score(str(merged.get("description") or "")):
            merged["description"] = inc["description"]

        base_is_rezka_placeholder = str(base.get("id") or "").startswith("rezka_")
        inc_is_rezka_placeholder = str(inc.get("id") or "").startswith("rezka_")
        if base_is_rezka_placeholder and not inc_is_rezka_placeholder and inc.get("ratings"):
            merged["ratings"] = dict(inc["ratings"])

        prov_by_id: Dict[str, Dict[str, Any]] = {}
        for p in list(merged.get("providers") or []) + list(inc.get("providers") or []):
            pid = str(p.get("id") or "")
            if not pid:
                continue
            if pid not in prov_by_id or (p.get("url") and not prov_by_id[pid].get("url")):
                prov_by_id[pid] = dict(p)
        if prov_by_id:
            merged["providers"] = list(prov_by_id.values())

        raw_aliases = list(merged.get("_aliases") or []) + [
            merged.get("title", ""),
            merged.get("orig_title", ""),
            merged.get("title_pl", ""),
            inc.get("title", ""),
            inc.get("orig_title", ""),
            inc.get("title_pl", ""),
        ] + list(inc.get("_aliases") or [])
        merged["_aliases"] = list(dict.fromkeys([str(a).strip() for a in raw_aliases if str(a or "").strip()]))
        merged["_from_hdrezka"] = bool(merged.get("_from_hdrezka") or inc.get("_from_hdrezka"))
        return self.enrich_item(merged)

    @staticmethod
    def _strip_internal_search_keys(item: Dict[str, Any]) -> Dict[str, Any]:
        cleaned = {k: v for k, v in item.items() if not k.startswith("_")}
        ks = cleaned.get("kinorium")
        if isinstance(ks, dict) and ks.get("kinorium_rating"):
            rats = dict(cleaned.get("ratings") or {})
            rats["kinorium"] = ks["kinorium_rating"]
            cleaned["ratings"] = rats
        return cleaned

    def _build_search_similar_items(
        self,
        matched: List[Dict[str, Any]],
        extra_candidates: List[Dict[str, Any]],
        sim_pool: List[Dict[str, Any]],
        premieres_all: List[Dict[str, Any]],
        provider_filter: str = "all",
        media_type_filter: str = "all",
        kin_enabled: bool = True,
        limit: int = 18,
    ) -> List[Dict[str, Any]]:
        if not matched:
            return []

        excluded_ids: Set[str] = set()
        excluded_aliases: Set[str] = set()
        for m_it in matched:
            if m_it.get("id"):
                excluded_ids.add(str(m_it["id"]))
            if m_it.get("kinorium_id"):
                excluded_ids.add(f"kin_{m_it['kinorium_id']}")
            excluded_aliases.update(self._extract_item_aliases(m_it))

        target_genres: Dict[str, float] = {}
        for idx, m_it in enumerate(matched[:3]):
            weight = 1.0 if idx == 0 else 0.6
            for g in m_it.get("genres") or []:
                gl = str(g or "").strip().lower()
                if gl and gl not in ("фильм", "сериал") and gl not in self.COUNTRY_STOPWORDS:
                    target_genres[gl] = target_genres.get(gl, 0.0) + weight

        primary_mtype = matched[0].get("media_type")
        franchise_tokens: Set[str] = set()
        for alias in self._extract_item_aliases(matched[0]):
            for w in alias.split():
                if len(w) >= 5 and w not in self.GENERIC_SIMILAR_WORDS:
                    franchise_tokens.add(w)

        raw_pool: List[Dict[str, Any]] = []
        raw_pool.extend(sim_pool or [])
        raw_pool.extend(premieres_all or [])
        if kin_enabled:
            wl_items = self.kinorium.get_section_catalog_items("watchlist", media_type_filter="all", query="")
            wt_items = self.kinorium.get_section_catalog_items("watching", media_type_filter="all", query="")
            raw_pool.extend(wl_items[:90])
            raw_pool.extend(wt_items[:45])
        raw_pool.extend(extra_candidates or [])

        seen_sim_ids: Set[str] = set()
        seen_sim_aliases: Set[str] = set()
        scored_out: List[tuple] = []

        for cand in raw_pool:
            if not cand or not cand.get("title"):
                continue
            cid = str(cand.get("id") or "")
            ckid = str(cand.get("kinorium_id") or (cand.get("kinorium") or {}).get("kinorium_id") or "")
            if cid in excluded_ids or (ckid and f"kin_{ckid}" in excluded_ids):
                continue
            cand_aliases = self._extract_item_aliases(cand)
            if cand_aliases & excluded_aliases:
                continue
            if cid in seen_sim_ids or (cand_aliases & seen_sim_aliases):
                continue

            poster_u = str(cand.get("poster") or "")
            if not poster_u or "hdrezka" in poster_u.lower():
                continue

            filtered_cand = self._filter_item_by_enabled_services(cand, allow_empty_providers=False)
            if filtered_cand is None:
                continue
            if provider_filter and provider_filter != "all":
                if not any(
                    p.get("id") == provider_filter and p.get("available")
                    for p in filtered_cand.get("providers", [])
                ):
                    continue
            if media_type_filter in ("movie", "series") and filtered_cand.get("media_type") != media_type_filter:
                continue

            ks = filtered_cand.get("kinorium") or {}
            if kin_enabled and ks.get("not_watching"):
                continue

            cand_words = {w for a in cand_aliases for w in a.split()}
            has_franchise = bool(franchise_tokens and (franchise_tokens & cand_words))

            cand_genres = [
                str(g or "").strip().lower()
                for g in (filtered_cand.get("genres") or [])
                if str(g or "").strip().lower() not in ("фильм", "сериал", "")
                and str(g or "").strip().lower() not in self.COUNTRY_STOPWORDS
            ]
            matched_genre_count = 0
            genre_score = 0.0
            for cg in cand_genres:
                if cg in target_genres:
                    matched_genre_count += 1
                    genre_score += 4.5 * min(1.5, target_genres[cg])

            if target_genres and matched_genre_count == 0 and not has_franchise:
                continue
            if cand in (extra_candidates or []) and not has_franchise and matched_genre_count < 2:
                continue

            score = genre_score
            if matched_genre_count >= 2:
                score += 3.5
            if has_franchise:
                score += 11.0
            if primary_mtype and filtered_cand.get("media_type") == primary_mtype:
                score += 3.5
            if not ks.get("watched"):
                score += 2.2
            if ks.get("in_watchlist") or ks.get("watching"):
                score += 1.2
            kr = float(ks.get("kinorium_rating") or (filtered_cand.get("ratings") or {}).get("kinorium") or 7.5)
            score += min(9.5, kr) * 0.45

            seen_sim_ids.add(cid)
            seen_sim_aliases.update(cand_aliases)
            scored_out.append((score, self._strip_internal_search_keys(filtered_cand)))

        scored_out.sort(key=lambda pair: pair[0], reverse=True)
        return [it for _, it in scored_out[:limit]]

    def _fetch_justwatch_by_provider(self, provider_id: str) -> List[Dict[str, Any]]:
        if not self.is_service_enabled(provider_id):
            return []
        pkg_map = {
            "netflix": ["nfx"],
            "appletv": ["atp"],
            "prime": ["prv"],
            "disney": ["dnp"],
            "max": ["mxx"],
            "playerpl": ["plp"],
        }
        packages = pkg_map.get(provider_id)
        if not packages:
            return []
        return self._query_justwatch_graphql({"packages": packages}, first=10)

    def _search_hdrezka_live(self, query: str) -> List[Dict[str, Any]]:
        import re as _re

        out: List[Dict[str, Any]] = []
        try:
            raw_list = self.rezka.search_live(query)
        except Exception:
            raw_list = []
        for r in raw_list[:18]:
            rid = str(r.get("rezka_id") or "")
            rurl = str(r.get("url") or "")
            raw_title = str(r.get("title") or "").strip()
            info = str(r.get("info") or "").strip()
            poster = str(r.get("poster") or "")
            if not rid or not raw_title:
                continue
            slash_parts = [p.strip() for p in raw_title.split("/") if p.strip()]
            display_title = slash_parts[0] if slash_parts else raw_title
            latin_part = next((p for p in slash_parts[1:] if _re.search(r"[A-Za-z]", p)), "")
            orig_t = latin_part or (slash_parts[-1] if len(slash_parts) > 1 else display_title)

            ym = _re.search(r"\b(19\d\d|20\d\d)\b", info)
            year = int(ym.group(1)) if ym else 2024
            mtype = (
                "series"
                if ("/series/" in rurl or "/animation/" in rurl or "сериал" in info.lower())
                else "movie"
            )
            info_parts = [p.strip() for p in info.split(",") if p.strip() and not p.strip().isdigit()]
            genres: List[str] = []
            for p in info_parts:
                if _re.search(r"\b(19\d\d|20\d\d)\b", p) or p.lower() in self.COUNTRY_STOPWORDS or "..." in p:
                    continue
                cg = self._canonical_genre(p)
                if cg and not any(x.lower() == cg.lower() for x in genres):
                    genres.append(cg)
            genres = genres[:3]
            if not genres:
                genres = ["Сериал"] if mtype == "series" else ["Фильм"]
            out.append(
                {
                    "id": f"rezka_{rid}",
                    "rezka_id": rid,
                    "rezka_url": rurl,
                    "title": display_title,
                    "orig_title": orig_t,
                    "title_pl": orig_t,
                    "_aliases": slash_parts if len(slash_parts) > 1 else [display_title],
                    "year": year,
                    "media_type": mtype,
                    "seasons_count": 2 if mtype == "series" else 1,
                    "episodes_per_season": 8 if mtype == "series" else 1,
                    "genres": genres,
                    "description": f"{display_title} ({info})" if info else display_title,
                    "poster": poster,
                    "backdrop": poster,
                    "ambient_color": "#1e293b",
                    "ratings": {"kinorium": 7.8, "imdb": 7.8},
                    "providers": [
                        {"id": "hdrezka", "available": True, "quality": "1080p", "audio": "RU/EN"},
                        {"id": "backup4k", "available": True, "quality": "4K Remux", "audio": "RU/EN"},
                    ],
                }
            )
        return out

    def _search_kinorium_live(self, query: str) -> List[Dict[str, Any]]:
        import re as _re
        import urllib.parse as _up

        out: List[Dict[str, Any]] = []
        try:
            q_enc = _up.quote(query.strip())
            raw = self.kinorium.fetch_kinorium_html(
                f"https://ru.kinorium.com/handlers/Search/?str={q_enc}",
                extra_headers={
                    "X-Requested-With": "XMLHttpRequest",
                    "Referer": "https://ru.kinorium.com/",
                },
            )
            data = json.loads(raw)
        except Exception:
            return []
        for entry in (data.get("list") or [])[:12]:
            if entry.get("mixtype") != "movie" or not entry.get("id"):
                continue
            kid = str(entry["id"])
            ru_title = str(entry.get("name") or "").strip()
            orig_title = str(entry.get("name_orig") or entry.get("orig") or ru_title).strip()
            if not ru_title:
                continue
            yr_raw = str(entry.get("year") or "2024")
            ym = _re.search(r"\b(19\d\d|20\d\d)\b", yr_raw)
            year = int(ym.group(1)) if ym else 2024
            if year > 2026:
                continue
            mtype = "series" if ("сериал" in yr_raw.lower() or "–" in yr_raw or "-" in yr_raw or entry.get("isSerial")) else "movie"
            rating_str = str(entry.get("rating") or "7.6")
            rm = _re.search(r"(\d+(?:\.\d+)?)", rating_str)
            kr = float(rm.group(1)) if rm else 7.6
            out.append(
                {
                    "id": f"kin_{kid}",
                    "kinorium_id": kid,
                    "title": ru_title,
                    "orig_title": orig_title,
                    "title_pl": orig_title,
                    "year": year,
                    "media_type": mtype,
                    "seasons_count": 2 if mtype == "series" else 1,
                    "episodes_per_season": 8 if mtype == "series" else 1,
                    "genres": ["Сериал"] if mtype == "series" else ["Фильм"],
                    "description": f"{ru_title} ({orig_title}, {yr_raw})",
                    "poster": f"https://ru-images.kinorium.com/movie/600/{kid}.jpg",
                    "poster_en": f"https://en-images.kinorium.com/movie/600/{kid}.jpg",
                    "backdrop": f"https://ru-images.kinorium.com/movie/1080/{kid}.jpg",
                    "ambient_color": "#1e293b",
                    "ratings": {"kinorium": kr, "imdb": kr},
                    "providers": [
                        {"id": "hdrezka", "available": True, "quality": "1080p", "audio": "RU/EN"},
                        {"id": "backup4k", "available": True, "quality": "4K Remux", "audio": "RU/EN"},
                    ],
                }
            )
        return out

    def _search_justwatch_poland(self, query: str) -> List[Dict[str, Any]]:
        return self._query_justwatch_graphql({"searchQuery": query}, first=12)

    def _query_justwatch_graphql(self, title_filter: Dict[str, Any], first: int = 10) -> List[Dict[str, Any]]:
        graphql_url = "https://apis.justwatch.com/graphql"
        gql_query = """
        query GetSearchTitles($country: Country!, $language: Language!, $first: Int!, $filter: TitleFilter) {
          popularTitles(country: $country, first: $first, filter: $filter) {
            edges {
              node {
                id
                objectId
                objectType
                content(country: $country, language: $language) {
                  title
                  originalReleaseYear
                  shortDescription
                  posterUrl
                  backdrops {
                    backdropUrl
                  }
                  externalIds {
                    imdbId
                  }
                  scoring {
                    imdbScore
                    tomatoMeter
                  }
                  genres {
                    shortName
                  }
                }
                origContent: content(country: "US", language: "en") {
                  title
                  shortDescription
                  posterUrl
                }
                plContent: content(country: "PL", language: "pl") {
                  title
                }
                offers(country: $country, platform: WEB) {
                  monetizationType
                  standardWebURL
                  package {
                    shortName
                    clearName
                  }
                }
              }
            }
          }
        }
        """
        payload = {
            "operationName": "GetSearchTitles",
            "variables": {
                "country": "PL",
                "language": "ru",
                "first": first,
                "filter": title_filter,
            },
            "query": gql_query,
        }
        status, body, _ = self.net.request(
            graphql_url,
            method="POST",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            spoof_geo_country="DIRECT",
            timeout=5,
        )
        results: List[Dict[str, Any]] = []
        if status != 200 or not body:
            return results

        jw_map = {
            "nfx": "netflix",
            "atp": "appletv",
            "prv": "prime",
            "dnp": "disney",
            "mxx": "max",
            "hbm": "max",
            "plp": "playerpl",
        }

        jw_genre_map = {
            "drm": "Драма",
            "scf": "Фантастика",
            "act": "Боевик",
            "cmy": "Комедия",
            "trl": "Триллер",
            "crm": "Криминал",
            "fnt": "Фэнтези",
            "ani": "Мультфильм",
            "hrr": "Ужасы",
            "mys": "Детектив",
            "rma": "Мелодрама",
            "hst": "История",
            "doc": "Документальный",
            "war": "Военный",
            "fml": "Семейный",
            "wsn": "Приключения",
            "spt": "Биография",
        }

        try:
            data = json.loads(body)
            edges = data.get("data", {}).get("popularTitles", {}).get("edges", [])
            for edge in edges:
                node = edge.get("node", {})
                content = node.get("content") or {}
                title = content.get("title") or ""
                if not title:
                    continue
                year = content.get("originalReleaseYear") or 2024
                imdb_id = (content.get("externalIds") or {}).get("imdbId") or node.get("id", f"jw_{node.get('objectId')}")
                imdb_score = (content.get("scoring") or {}).get("imdbScore") or 7.8
                poster_path = content.get("posterUrl") or ""
                if not poster_path:
                    continue

                poster_url = "https://images.justwatch.com" + poster_path.replace("{profile}", "s592").replace("{format}", "webp")
                bds = content.get("backdrops") or []
                if bds and bds[0].get("backdropUrl"):
                    backdrop_url = "https://images.justwatch.com" + bds[0]["backdropUrl"].replace("{profile}", "s1920").replace("{format}", "webp")
                else:
                    backdrop_url = poster_url

                media_type = "series" if node.get("objectType") == "SHOW" else "movie"
                parsed_genres = []
                for g_obj in content.get("genres") or []:
                    g_ru = jw_genre_map.get(str(g_obj.get("shortName") or "").lower())
                    if g_ru and g_ru not in parsed_genres:
                        parsed_genres.append(g_ru)
                if not parsed_genres:
                    parsed_genres = ["Сериал" if media_type == "series" else "Фильм"]

                providers = [
                    {
                        "id": "hdrezka",
                        "available": True,
                        "quality": "1080p",
                        "url": "",
                    }
                ]
                seen_prov = {"hdrezka"}
                for offer in node.get("offers") or []:
                    pkg = offer.get("package") or {}
                    short_name = pkg.get("shortName", "")
                    mapped_id = jw_map.get(short_name)
                    if mapped_id and mapped_id not in seen_prov:
                        seen_prov.add(mapped_id)
                        providers.append(
                            {
                                "id": mapped_id,
                                "available": True,
                                "quality": pkg.get("clearName", mapped_id),
                                "url": offer.get("standardWebURL", "https://www.justwatch.com/pl"),
                            }
                        )

                providers.append(
                    {
                        "id": "backup4k",
                        "available": True,
                        "quality": "4K HDR",
                        "url": f"native://backup4k/{imdb_id}",
                    }
                )

                orig_content = node.get("origContent") or {}
                orig_title_val = orig_content.get("title") or title
                pl_title_val = (node.get("plContent") or {}).get("title") or orig_title_val
                orig_poster_rel = orig_content.get("posterUrl") or ""
                poster_en_url = (
                    "https://images.justwatch.com"
                    + orig_poster_rel.replace("{profile}", "s592").replace("{format}", "webp")
                    if orig_poster_rel
                    else poster_url
                )
                tomato_raw = (content.get("scoring") or {}).get("tomatoMeter")
                jw_rats: Dict[str, Any] = {
                    "imdb": round(float(imdb_score), 1),
                    "kinorium": round(float(imdb_score), 1),
                }
                if tomato_raw is not None:
                    try:
                        tm_int = int(round(float(tomato_raw)))
                        if 0 < tm_int <= 100:
                            jw_rats["critics"] = tm_int
                    except Exception:
                        pass

                results.append(
                    {
                        "id": imdb_id,
                        "rezka_id": "",
                        "rezka_url": "",
                        "title": title,
                        "title_pl": pl_title_val,
                        "orig_title": orig_title_val,
                        "year": year,
                        "media_type": media_type,
                        "seasons_count": 3 if media_type == "series" else 1,
                        "episodes_per_season": 8 if media_type == "series" else 1,
                        "duration_min": 55 if media_type == "series" else 125,
                        "genres": parsed_genres,
                        "description": content.get("shortDescription") or f"{title} ({year})",
                        "description_en": orig_content.get("shortDescription") or f"{orig_title_val} ({year})",
                        "poster": poster_url,
                        "poster_en": poster_en_url,
                        "backdrop": backdrop_url,
                        "ambient_color": "#334155",
                        "ratings": jw_rats,
                        "providers": providers,
                        "featured": False,
                    }
                )
        except Exception:
            pass

        return results

    def get_person_profile(
        self,
        name: str,
        person_url: str = "",
        hint_title: str = "",
        hint_orig: str = "",
        lang: str = "ru",
    ) -> Dict[str, Any]:
        ui_lang = "en" if str(lang or "").strip().lower().startswith("en") else "ru"
        clean_low = (name or "").strip().lower()
        cache_key = (person_url or clean_low).strip().lower()
        now_ts = time.time()
        cached_raw_entry = self._person_raw_cache.get(cache_key) if cache_key else None
        if cached_raw_entry and (now_ts - cached_raw_entry[0]) < 1800:
            raw = cached_raw_entry[1]
        else:
            if not person_url and clean_low:
                person_url = self.rezka.find_cached_person_url(name)

            if not person_url and clean_low and (hint_title or hint_orig):
                try:
                    self.rezka._resolve_page_metadata("", hint_title, hint_orig, None)
                except Exception:
                    pass
                person_url = self.rezka.find_cached_person_url(name)

            if not person_url and clean_low:
                for c_it in self.CURATED_CATALOG:
                    cand_names = [
                        str(x).strip()
                        for x in (
                            list(c_it.get("directors") or [])
                            + list(c_it.get("actors") or [])
                            + list(c_it.get("directors_en") or [])
                            + list(c_it.get("actors_en") or [])
                        )
                        if str(x).strip()
                    ]
                    if any(
                        cn.lower() == clean_low or _names_match_ru_en(cn, name) >= 0.76
                        for cn in cand_names
                    ):
                        try:
                            self.rezka._resolve_page_metadata(
                                "",
                                str(c_it.get("title") or ""),
                                str(c_it.get("orig_title") or ""),
                                None,
                                year=int(c_it.get("year") or 2024),
                                media_type=str(c_it.get("media_type") or "movie"),
                            )
                        except Exception:
                            pass
                        person_url = self.rezka.find_cached_person_url(name)
                        if person_url:
                            break

            raw = self.rezka.get_person_details(name=name, hint_url=person_url)
            if cache_key and raw and (raw.get("sections") or raw.get("bio") or raw.get("bio_en") or raw.get("photo")):
                if len(self._person_raw_cache) > 120:
                    self._person_raw_cache.clear()
                self._person_raw_cache[cache_key] = (now_ts, raw)
                if raw.get("person_url"):
                    self._person_raw_cache[str(raw["person_url"]).strip().lower()] = (now_ts, raw)
                if raw.get("name"):
                    self._person_raw_cache[str(raw["name"]).strip().lower()] = (now_ts, raw)
                if raw.get("orig_name"):
                    self._person_raw_cache[str(raw["orig_name"]).strip().lower()] = (now_ts, raw)
        kin_enabled = self.is_service_enabled("kinorium")

        curated_by_norm: Dict[str, Dict[str, Any]] = {}
        for c_it in self.CURATED_CATALOG:
            for v in _title_variants(str(c_it.get("title") or "")) + _title_variants(
                str(c_it.get("orig_title") or "")
            ):
                if v:
                    curated_by_norm[v] = c_it

        def _convert_raw_work(r: Dict[str, Any]) -> Optional[Dict[str, Any]]:
            rid = str(r.get("rezka_id") or "")
            rurl = str(r.get("url") or "")
            raw_title = str(r.get("title") or "").strip()
            info = str(r.get("info") or "").strip()
            poster = str(r.get("poster") or "")
            if not rid or not raw_title:
                return None

            slash_parts = [p.strip() for p in raw_title.split("/") if p.strip()]
            display_title = slash_parts[0] if slash_parts else raw_title
            latin_part = next((p for p in slash_parts[1:] if re.search(r"[A-Za-z]", p)), "")
            orig_t = latin_part or (slash_parts[-1] if len(slash_parts) > 1 else display_title)

            ym = re.search(r"\b(19\d\d|20\d\d)\b", info)
            year = int(ym.group(1)) if ym else 2024
            mtype = (
                "series"
                if ("/series/" in rurl or "/animation/" in rurl or "сериал" in info.lower())
                else "movie"
            )
            info_parts = [p.strip() for p in info.split(",") if p.strip() and not p.strip().isdigit()]
            genres: List[str] = []
            for p in info_parts:
                if re.search(r"\b(19\d\d|20\d\d)\b", p) or p.lower() in self.COUNTRY_STOPWORDS or "..." in p:
                    continue
                cg = self._canonical_genre(p)
                if cg and not any(x.lower() == cg.lower() for x in genres):
                    genres.append(cg)
            if not genres:
                genres = ["Сериал"] if mtype == "series" else ["Фильм"]

            item_dict: Dict[str, Any] = {
                "id": f"rezka_{rid}",
                "rezka_id": rid,
                "rezka_url": rurl,
                "title": display_title,
                "orig_title": orig_t,
                "title_pl": orig_t,
                "_aliases": slash_parts if len(slash_parts) > 1 else [display_title],
                "year": year,
                "media_type": mtype,
                "seasons_count": 2 if mtype == "series" else 1,
                "episodes_per_season": 8 if mtype == "series" else 1,
                "genres": genres[:3],
                "description": f"{display_title} ({info})" if info else display_title,
                "poster": poster,
                "backdrop": poster,
                "ambient_color": "#1e293b",
                "ratings": {},
                "providers": [
                    {"id": "hdrezka", "available": True, "quality": "1080p", "audio": "RU/EN"},
                    {"id": "backup4k", "available": True, "quality": "4K Remux", "audio": "RU/EN"},
                ],
            }

            for v in _title_variants(raw_title):
                c_match = curated_by_norm.get(v)
                if c_match and c_match.get("media_type") == mtype:
                    item_dict["poster"] = c_match.get("poster") or item_dict["poster"]
                    item_dict["poster_en"] = c_match.get("poster_en") or ""
                    item_dict["backdrop"] = c_match.get("backdrop") or item_dict["backdrop"]
                    item_dict["orig_title"] = c_match.get("orig_title") or item_dict["orig_title"]
                    item_dict["genres"] = c_match.get("genres") or item_dict["genres"]
                    item_dict["description"] = c_match.get("description") or item_dict["description"]
                    item_dict["description_en"] = c_match.get("description_en") or ""
                    item_dict["ratings"] = dict(c_match.get("ratings") or item_dict["ratings"])
                    item_dict["providers"] = list(c_match.get("providers") or item_dict["providers"])
                    break

            enriched = self.enrich_item(item_dict)
            filtered = self._filter_item_by_enabled_services(enriched, allow_empty_providers=True)
            if filtered is None:
                return None
            return self._strip_internal_search_keys(filtered)

        enriched_sections: List[Dict[str, Any]] = []
        unique_works_by_key: Dict[str, Dict[str, Any]] = {}

        for sec in raw.get("sections") or []:
            conv_items: List[Dict[str, Any]] = []
            for r_it in sec.get("items") or []:
                c_it = _convert_raw_work(r_it)
                if c_it:
                    conv_items.append(c_it)
                    ukey = str(c_it.get("rezka_id") or c_it.get("id") or c_it.get("title"))
                    if ukey not in unique_works_by_key:
                        unique_works_by_key[ukey] = c_it
            if conv_items:
                conv_items.sort(key=lambda x: int(x.get("year") or 0), reverse=True)
                s_key = sec.get("key", "works")
                s_lbl = sec.get("label", "Фильмография")
                if ui_lang == "en":
                    s_lbl = translate_career_role_en(s_lbl) or "Filmography"
                enriched_sections.append(
                    {
                        "key": s_key,
                        "role_key": s_key,
                        "label": s_lbl,
                        "role_label": s_lbl,
                        "count": len(conv_items),
                        "items": conv_items,
                    }
                )

        all_items = sorted(
            unique_works_by_key.values(),
            key=lambda x: int(x.get("year") or 0),
            reverse=True,
        )

        if ui_lang == "en" and all_items:
            self._prewarm_en_metadata_for_items(all_items[:16], max_items=16)
            if len(all_items) > 16 and self.en_meta is not None:
                import threading

                tail_items = list(all_items[16:44])
                threading.Thread(
                    target=self._prewarm_en_metadata_for_items,
                    args=(tail_items, 28),
                    daemon=True,
                ).start()

            def _apply_en_work_fields(work: Dict[str, Any]) -> None:
                orig_t = str(work.get("orig_title") or "").strip()
                if orig_t and not has_cyrillic(orig_t):
                    work["title"] = orig_t
                elif has_cyrillic(str(work.get("title") or "")):
                    work["title"] = transliterate_cyrillic(str(work.get("title") or ""))
                best_en_poster = resolve_original_poster_url(work)
                if best_en_poster:
                    work["poster_en"] = best_en_poster
                    work["poster"] = best_en_poster
                en_genres: List[str] = []
                for g in work.get("genres") or []:
                    gl = str(g or "").strip().lower()
                    if gl == "сериал":
                        en_g = "Series"
                    elif gl == "фильм":
                        en_g = "Movie"
                    else:
                        en_g = RU_GENRES_TO_EN.get(gl, g if not has_cyrillic(str(g)) else transliterate_cyrillic(str(g)).title())
                    if en_g and en_g not in en_genres:
                        en_genres.append(en_g)
                if en_genres:
                    work["genres"] = en_genres
                if work.get("description_en"):
                    work["description"] = work["description_en"]

            seen_obj_ids = set()
            for w in all_items:
                seen_obj_ids.add(id(w))
                _apply_en_work_fields(w)
            for sec_obj in enriched_sections:
                for w in sec_obj.get("items") or []:
                    if id(w) not in seen_obj_ids:
                        seen_obj_ids.add(id(w))
                        _apply_en_work_fields(w)

        total_count = len(all_items)
        watched_count = 0
        watching_count = 0
        watchlist_count = 0
        user_scores: List[float] = []

        if kin_enabled:
            for w in all_items:
                ks = w.get("kinorium") or {}
                if ks.get("watched"):
                    watched_count += 1
                if ks.get("watching"):
                    watching_count += 1
                if ks.get("in_watchlist"):
                    watchlist_count += 1
                if ks.get("user_rating"):
                    try:
                        user_scores.append(float(ks["user_rating"]))
                    except Exception:
                        pass

        avg_user = round(sum(user_scores) / len(user_scores), 1) if user_scores else None
        watched_pct = round((watched_count / total_count) * 100) if total_count > 0 else 0

        ru_name = raw.get("name") or name
        orig_name_val = raw.get("orig_name") or (name if not has_cyrillic(name) else "")
        photo_hint = raw.get("photo") or ""
        photo_endpoint = f"/api/person-photo?name={urllib.parse.quote(ru_name)}" + (
            f"&url={urllib.parse.quote(photo_hint)}" if photo_hint else ""
        )
        career_str = str(raw.get("career_roles") or "")
        career_list = [c.strip() for c in career_str.split(",") if c.strip()]

        out_name = ru_name
        out_birth_date = str(raw.get("birth_date") or "")
        out_birth_place = str(raw.get("birth_place") or "")
        out_bio = str(raw.get("bio") or "")
        out_bio_en = str(raw.get("bio_en") or "")

        if ui_lang == "en":
            out_name = orig_name_val or (ru_name if not has_cyrillic(ru_name) else transliterate_cyrillic(ru_name))
            en_careers: List[str] = []
            for c in career_list:
                tc = translate_career_role_en(c)
                if tc and tc not in en_careers:
                    en_careers.append(tc)
            career_list = en_careers
            career_str = ", ".join(career_list)
            out_birth_date = translate_birth_date_en(out_birth_date)
            out_birth_place = translate_birth_place_en(out_birth_place)
            out_bio = out_bio_en or (out_bio if not has_cyrillic(out_bio) else "")

        return {
            "name": out_name,
            "ru_name": ru_name if has_cyrillic(ru_name) else "",
            "orig_name": orig_name_val,
            "person_url": raw.get("person_url") or person_url,
            "photo": photo_hint,
            "photo_endpoint": photo_endpoint,
            "career": career_list,
            "career_roles": career_str,
            "birth_date": out_birth_date,
            "birth_place": out_birth_place,
            "bio": out_bio,
            "bio_en": out_bio_en,
            "kinorium_enabled": kin_enabled,
            "stats": {
                "total_count": total_count,
                "watched_count": watched_count,
                "watching_count": watching_count,
                "watchlist_count": watchlist_count,
                "rated_count": len(user_scores),
                "avg_user_rating": avg_user,
                "watched_pct": watched_pct,
            },
            "roles": enriched_sections,
            "sections": enriched_sections,
            "all_items": all_items,
        }
