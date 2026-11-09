"""
Velarium Curated Flagship Catalog & Provider Metadata.

Contains the predefined catalog items with poster art, ratings, backdrop URLs,
and provider mappings for the default catalog experience.
"""

from typing import Any, Dict, List

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
