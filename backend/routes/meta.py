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

import concurrent.futures
import copy
import json
import re
import threading
import time
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Tuple

from backend.hdrezka import HDRezkaClient

_XRAY_CACHE_LOCK = threading.Lock()
_XRAY_CACHE: Dict[str, Tuple[float, Dict[str, Any]]] = {}
_META_EXECUTOR = concurrent.futures.ThreadPoolExecutor(max_workers=12)

_CURATED_SOUNDTRACKS: Dict[str, List[Dict[str, str]]] = {
    "breaking bad": [
        {"title": "Breaking Bad Main Title Theme (Extended)", "artist": "Dave Porter", "album": "Breaking Bad (Original Score)", "scene_ru": "Открывающие титры", "scene_en": "Opening Credits"},
        {"title": "Baby Blue", "artist": "Badfinger", "album": "Straight Up", "scene_ru": "Финальная сцена сериала", "scene_en": "Series Finale Scene"},
        {"title": "Crystal Blue Persuasion", "artist": "Tommy James & The Shondells", "album": "Crimson & Clover", "scene_ru": "Монтаж лаборатории", "scene_en": "Lab Montage Sequence"},
        {"title": "DLZ", "artist": "TV on the Radio", "album": "Dear Science", "scene_ru": "Сцена на парковке («Stay out of my territory»)", "scene_en": "Parking Lot Confrontation"},
    ],
    "ted lasso": [
        {"title": "Ted Lasso Theme", "artist": "Marcus Mumford & Tom Howe", "album": "Ted Lasso (Apple TV+ Original Soundtrack)", "scene_ru": "Вступительная заставка", "scene_en": "Main Title Theme"},
        {"title": "Forever", "artist": "Mumford & Sons", "album": "Delta", "scene_ru": "Эмоциональный финал матча", "scene_en": "Post-Match Montage"},
        {"title": "She's a Rainbow", "artist": "The Rolling Stones", "album": "Their Satanic Majesties Request", "scene_ru": "Сцена Роя Кента и Кили на стадионе", "scene_en": "Roy Kent Stadium Entrance"},
    ],
    "interstellar": [
        {"title": "Cornfield Chase", "artist": "Hans Zimmer", "album": "Interstellar (Original Motion Picture Soundtrack)", "scene_ru": "Погоня через кукурузное поле", "scene_en": "Cornfield Chase Sequence"},
        {"title": "No Time for Caution", "artist": "Hans Zimmer", "album": "Interstellar (Original Motion Picture Soundtrack)", "scene_ru": "Стыковка со станцией «Эндьюранс»", "scene_en": "Endurance Docking Scene"},
        {"title": "Stay", "artist": "Hans Zimmer", "album": "Interstellar (Original Motion Picture Soundtrack)", "scene_ru": "Прощание Купера с Мёрф", "scene_en": "Cooper & Murph Farewell"},
    ],
    "oppenheimer": [
        {"title": "Can You Hear the Music", "artist": "Ludwig Göransson", "album": "Oppenheimer (Original Motion Picture Soundtrack)", "scene_ru": "Квантовый мир и учёба в Европе", "scene_en": "Quantum Visions Montage"},
        {"title": "Destroyer of Worlds", "artist": "Ludwig Göransson", "album": "Oppenheimer (Original Motion Picture Soundtrack)", "scene_ru": "Финальный диалог у пруда", "scene_en": "Final Pond Conversation"},
        {"title": "Trinity", "artist": "Ludwig Göransson", "album": "Oppenheimer (Original Motion Picture Soundtrack)", "scene_ru": "Испытание «Тринити» в пустыне", "scene_en": "Trinity Test Sequence"},
    ],
    "dune": [
        {"title": "Paul's Dream", "artist": "Hans Zimmer", "album": "Dune (Original Motion Picture Soundtrack)", "scene_ru": "Видения Пола Атрейдеса", "scene_en": "Paul's Visions of Arrakis"},
        {"title": "Gom Jabbar", "artist": "Hans Zimmer", "album": "Dune (Original Motion Picture Soundtrack)", "scene_ru": "Испытание Бене Гессерит", "scene_en": "Bene Gesserit Test Scene"},
        {"title": "Ripples in the Sand", "artist": "Hans Zimmer", "album": "Dune (Original Motion Picture Soundtrack)", "scene_ru": "Встреча с песчаным червём", "scene_en": "Sandworm Encounter"},
    ],
    "severance": [
        {"title": "Main Titles", "artist": "Theodore Shapiro", "album": "Severance: Season 1 (Apple TV+ Original Series Soundtrack)", "scene_ru": "Главная тема Lumon Industries", "scene_en": "Lumon Main Titles"},
        {"title": "Labor of Love", "artist": "Theodore Shapiro", "album": "Severance: Season 1 (Apple TV+ Original Series Soundtrack)", "scene_ru": "Коридоры этажа разделения", "scene_en": "Severed Floor Hallways"},
        {"title": "Music Dance Experience", "artist": "Theodore Shapiro", "album": "Severance: Season 1 (Apple TV+ Original Series Soundtrack)", "scene_ru": "Музыкально-танцевальная пауза в отделе МД", "scene_en": "MDR Music Dance Experience"},
    ],
    "arcane": [
        {"title": "Enemy", "artist": "Imagine Dragons & JID", "album": "Arcane League of Legends (Soundtrack)", "scene_ru": "Открывающая заставка", "scene_en": "Opening Title Sequence"},
        {"title": "What Could Have Been", "artist": "Sting feat. Ray Chen", "album": "Arcane League of Legends (Soundtrack)", "scene_ru": "Финальная сцена первого сезона", "scene_en": "Season 1 Finale Climax"},
        {"title": "Dynasties and Dystopia", "artist": "Denzel Curry, Gizzle & Bren Joy", "album": "Arcane League of Legends (Soundtrack)", "scene_ru": "Бой Экко и Джинкс на мосту", "scene_en": "Bridge Duel Scene"},
    ],
    "stranger things": [
        {"title": "Stranger Things", "artist": "Kyle Dixon & Michael Stein", "album": "Stranger Things, Vol. 1", "scene_ru": "Неоновая заставка", "scene_en": "Opening Synth Credits"},
        {"title": "Running Up That Hill (A Deal with God)", "artist": "Kate Bush", "album": "Hounds of Love", "scene_ru": "Побег Макс из Изнанки", "scene_en": "Max Escaping Vecna"},
        {"title": "Master of Puppets", "artist": "Metallica", "album": "Master of Puppets", "scene_ru": "Гитарное соло Эдди Мансона", "scene_en": "Eddie Munson Upside Down Solo"},
    ],
    "silo": [
        {"title": "Silo Main Title", "artist": "Atli Örvarsson", "album": "Silo: Season 1 (Apple TV+ Original Series Soundtrack)", "scene_ru": "Вступительные титры", "scene_en": "Opening Title Sequence"},
        {"title": "Juliette", "artist": "Atli Örvarsson", "album": "Silo: Season 1 (Apple TV+ Original Series Soundtrack)", "scene_ru": "Тема Джульетты Николс", "scene_en": "Juliette Nichols Theme"},
        {"title": "The Generator", "artist": "Atli Örvarsson", "album": "Silo: Season 1 (Apple TV+ Original Series Soundtrack)", "scene_ru": "Механический сектор на глубине бункера", "scene_en": "Down Deep Mechanical Sector"},
        {"title": "We Do Not Know", "artist": "Atli Örvarsson", "album": "Silo: Season 1 (Apple TV+ Original Series Soundtrack)", "scene_ru": "Финальный выход к внешнему миру", "scene_en": "Final Walk Toward the Surface"},
    ],
    "the last of us": [
        {"title": "The Last of Us", "artist": "Gustavo Santaolalla", "album": "The Last of Us (HBO Original Series Soundtrack)", "scene_ru": "Главная тема на ронроко", "scene_en": "Opening Credits Theme"},
        {"title": "Never Let Me Down Again", "artist": "Depeche Mode", "album": "Music for the Masses", "scene_ru": "Радиосигнал конца первой серии («Проблемы в 80-х»)", "scene_en": "Episode 1 Radio Code Ending"},
        {"title": "Long, Long Time", "artist": "Linda Ronstadt", "album": "Silk Purse", "scene_ru": "История Билла и Фрэнка за пианино", "scene_en": "Bill & Frank Piano Scene"},
        {"title": "All Gone (No Escape)", "artist": "Gustavo Santaolalla", "album": "The Last of Us (HBO Original Series Soundtrack)", "scene_ru": "Финал в госпитале Солт-Лейк-Сити", "scene_en": "Salt Lake Hospital Climax"},
    ],
    "fallout": [
        {"title": "I Don't Want to Set the World on Fire", "artist": "The Ink Spots", "album": "The Anthology", "scene_ru": "Выход Люси из Убежища 33", "scene_en": "Vault 33 Surface Reveal"},
        {"title": "Crawl Out Through the Fallout", "artist": "Sheldon Allman", "album": "Folk Songs for the 21st Century", "scene_ru": "Перестрелка в Филли", "scene_en": "Filly Shootout Sequence"},
        {"title": "Brotherhood of Steel", "artist": "Ramin Djawadi", "album": "Fallout (Prime Video Original Series Soundtrack)", "scene_ru": "Прибытие силовой брони Братства Стали", "scene_en": "Power Armor Arrival"},
    ],
    "the gentlemen": [
        {"title": "Cumberland Gap", "artist": "David Rawlings", "album": "Poor David's Almanack", "scene_ru": "Вступительные титры поместья Холстед", "scene_en": "Halstead Manor Opening Credits"},
        {"title": "That's Entertainment", "artist": "The Jam", "album": "Sound Affects", "scene_ru": "Операция Эдди и Сюзи", "scene_en": "Eddie & Susie Heist Montage"},
        {"title": "The Gentlemen Theme", "artist": "Christopher Benstead", "album": "The Gentlemen (Original Soundtrack)", "scene_ru": "Переговоры в лондонском клубе", "scene_en": "London Club Negotiation"},
    ],
    "inception": [
        {"title": "Time", "artist": "Hans Zimmer", "album": "Inception (Music from the Motion Picture)", "scene_ru": "Пробуждение в самолёте и вращающийся волчок", "scene_en": "Awakening & Spinning Top Finale"},
        {"title": "Dream Is Collapsing", "artist": "Hans Zimmer", "album": "Inception (Music from the Motion Picture)", "scene_ru": "Разрушение уровней сна", "scene_en": "Collapsing Dream Layers"},
        {"title": "Non, je ne regrette rien", "artist": "Édith Piaf", "album": "Édith Piaf", "scene_ru": "Сигнал «выброса» из сна", "scene_en": "Synchronized Kick Signal"},
    ],
    "the dark knight": [
        {"title": "Why So Serious?", "artist": "Hans Zimmer & James Newton Howard", "album": "The Dark Knight (Original Motion Picture Soundtrack)", "scene_ru": "Ограбление банка в начале фильма", "scene_en": "Opening Bank Heist"},
        {"title": "Like a Dog Chasing Cars", "artist": "Hans Zimmer & James Newton Howard", "scene_ru": "Ночная погоня на Бэтподе по Готэму", "scene_en": "Gotham Batpod Chase"},
        {"title": "A Dark Knight", "artist": "Hans Zimmer & James Newton Howard", "scene_ru": "Финальный монолог комиссара Гордона", "scene_en": "Gordon's Final Monologue"},
    ],
}

_CURATED_TRIVIA: Dict[str, List[Dict[str, str]]] = {
    "breaking bad": [
        {"badge_ru": "Съёмки", "badge_en": "Production", "text_ru": "Формула в вступительных титрах C10H15N (молекулярная масса 149.24) — реальная химическая формула метамфетамина, а зеленые символы элементов складываются в имена создателей и актёров.", "text_en": "The chemical formula C10H15N (molecular weight 149.24) in the opening credits is the real formula of methamphetamine, while the periodic elements highlight cast names."},
        {"badge_ru": "Пасхалка", "badge_en": "Easter Egg", "text_ru": "Координаты лотерейного билета Уолтера Уайта (34°59′20″ с. ш. 106°36′52″ з. д.) ведут не в пустыню, а прямо к павильону студии Q Studios в Альбукерке, где снимался сериал.", "text_en": "Walter White's lottery ticket coordinates point directly to Studio Q in Albuquerque where the series was filmed."},
        {"badge_ru": "Деталь сцены", "badge_en": "Scene Detail", "text_ru": "Цветовая палитра одежды персонажей меняется по мере развития сюжета: Уолтер постепенно переходит от бежевых тонов к тёмным оттенкам Хайзенберга.", "text_en": "Vince Gilligan designed a strict color-coding system for every character's wardrobe reflecting their moral arc."},
    ],
    "ted lasso": [
        {"badge_ru": "Съёмки", "badge_en": "Production", "text_ru": "Рецепт фирменного печенья Теда Лассо («Biscuits with the Boss») разрабатывался специально для съёмок: это классическое шотландское песочное печенье shortbread с крупной солью.", "text_en": "Ted's famous pink-box 'Biscuits with the Boss' are authentic buttery shortbread custom-baked daily for the set."},
        {"badge_ru": "Деталь сцены", "badge_en": "Scene Detail", "text_ru": "Стадион клуба «Ричмонд» (Nelson Road) на самом деле снимался на домашней арене английского клуба «Кристал Пэлас» — Selhurst Park в Южном Лондоне.", "text_en": "AFC Richmond's Nelson Road stadium scenes were filmed on location at Crystal Palace's Selhurst Park in London."},
    ],
    "interstellar": [
        {"badge_ru": "Научный факт", "badge_en": "Science Fact", "text_ru": "Визуализация чёрной дыры «Гаргантюа» рассчитывалась астрофизиком Кипом Торном: уравнения гравитационного линзирования дали настолько точную модель, что по итогам работы вышли научные статьи.", "text_en": "Astrophysicist Kip Thorne's equations for the Gargantua black hole produced new scientific discoveries in gravitational lensing."},
        {"badge_ru": "Деталь сцены", "badge_en": "Scene Detail", "text_ru": "На водной планете Миллер каждые 1.25 секунды в саундтреке Ханса Циммера звучит отчётливый тик — каждый такой удар равен одним земным суткам.", "text_en": "On Miller's planet, Hans Zimmer's score ticks once every 1.25 seconds—each tick representing a full day passing on Earth."},
    ],
    "oppenheimer": [
        {"badge_ru": "Плёнка IMAX", "badge_en": "IMAX Film", "text_ru": "Кристофер Нолан снимал сцены с точки зрения Оппенгеймера в цвете, а объективные исторические слушания с участием Льюиса Штраусса — на специально созданную 65-мм чёрно-белую плёнку Kodak IMAX.", "text_en": "Kodak engineered the first-ever 65mm black-and-white IMAX film stock specifically for the objective Lewis Strauss sequences."},
        {"badge_ru": "Практические эффекты", "badge_en": "Practical FX", "text_ru": "Взрыв испытания «Тринити» был снят полностью без компьютерной графики (CGI) с использованием масштабных пиротехнических зарядов, магния и высокоскоростных камер.", "text_en": "The Trinity nuclear test sequence was recreated entirely in-camera using practical miniatures and pyrotechnics without CGI."},
    ],
    "dune": [
        {"badge_ru": "Дизайн звука", "badge_en": "Sound Design", "text_ru": "Глухой ритмичный звук «манок» (thumper) и движение песчаных червей записывались путём погружения гидрофонов глубоко в настоящие песчаные дюны Долины Смерти.", "text_en": "Sound designers buried hydrophones deep inside Death Valley sand dunes to record authentic low-frequency sandworm vibrations."},
        {"badge_ru": "Локации", "badge_en": "Locations", "text_ru": "Пейзажи Арракиса снимались в пустыне Вади-Рам в Иордании и оазисе Лива в ОАЭ на рассвете и закате, чтобы избежать резких полуденных теней.", "text_en": "Arrakis exteriors were filmed in Wadi Rum, Jordan and the Liwa Oasis in the UAE during golden hour."},
    ],
    "severance": [
        {"badge_ru": "Архитектура", "badge_en": "Architecture", "text_ru": "Здание штаб-квартиры Lumon Industries снималось в реальном комплексе Bell Labs Holmdel в Нью-Джерси, спроектированном архитектором Ээро Саариненом в 1962 году.", "text_en": "Lumon Industries headquarters was filmed at the iconic Eero Saarinen-designed Bell Labs Holmdel Complex in New Jersey."},
        {"badge_ru": "Деталь сцены", "badge_en": "Scene Detail", "text_ru": "На этаже разделения используются только винтажные мониторы и клавиатуры без клавиши Escape — символ того, что у внутренних личностей («инни») нет выхода.", "text_en": "The terminals in Macrodata Refinement were custom-built without an Escape key to symbolize the innies' lack of control."},
    ],
    "silo": [
        {"badge_ru": "Декорации", "badge_en": "Production Design", "text_ru": "Центральная винтовая лестница бункера была построена в натуральную величину высотой в три этажа на студии Hoddesdon в Великобритании, что позволило снимать длинные проходки без склеек.", "text_en": "The massive spiral staircase of the Silo was constructed as a practical three-story physical set at Hoddesdon Studios in the UK."},
        {"badge_ru": "Литературная основа", "badge_en": "Literary Origin", "text_ru": "Сериал основан на трилогии романов Хью Хауи «Укрытие» («Wool», «Shift», «Dust»), которую автор изначально опубликовал самостоятельно в виде короткого рассказа.", "text_en": "Adapted from Hugh Howey's dystopian 'Wool' trilogy, which originally began as a self-published short story in 2011."},
    ],
    "the last of us": [
        {"badge_ru": "Грим и эффекты", "badge_en": "Practical Makeup", "text_ru": "Щелкуны (Clickers) и топляки создавались мастером пластического грима Барри Гоуэром вручную: актёры-каскадёры разучивали пластику движений на основе оригинальной игры Naughty Dog.", "text_en": "Prosthetics designer Barrie Gower sculpted practical Cordyceps suits worn by contortionists trained in the original game's movement."},
        {"badge_ru": "Саундтрек", "badge_en": "Soundtrack", "text_ru": "По радио в машине Джоэла песни 1960–70-х годов означают безопасность, а хиты 1980-х (например, Depeche Mode) служат зашифрованным сигналом опасности от контрабандистов.", "text_en": "By smuggler radio code, 60s and 70s songs signal nothing new, while 1980s tracks warn of active trouble."},
    ],
    "fallout": [
        {"badge_ru": "Реквизит", "badge_en": "Props & Design", "text_ru": "Наручный компьютер Pip-Boy на руке Люси был собран с работающим OLED-дисплеем и настоящими кнопками, чтобы актёры могли взаимодействовать с интерфейсом прямо в кадре.", "text_en": "Lucy's wrist-mounted Pip-Boy featured a functional screen and physical dials operated live on camera."},
        {"badge_ru": "Локации", "badge_en": "Locations", "text_ru": "Заброшенные пустоши снимались на Алмазном берегу Намибии в заброшенном шахтёрском городе Колманскоп, занесённом настоящими песками пустыни Намиб.", "text_en": "Wasteland exteriors were filmed on location in Kolmanskop, an abandoned diamond-mining ghost town in Namibia."},
    ],
    "inception": [
        {"badge_ru": "Музыка и время", "badge_en": "Music & Time", "text_ru": "Ханс Циммер построил весь саундтрек «Начала» путём экстремального замедления медных духовых из песни Эдит Пиаф «Non, je ne regrette rien», отражая замедление времени во сне.", "text_en": "Hans Zimmer derived the entire brass motif of the score by slowing down Édith Piaf's 'Non, je ne regrette rien' to match dream-time dilation."},
        {"badge_ru": "Практическая сцена", "badge_en": "Practical Set", "text_ru": "Драка в невесомости с Артуром снималась без тросов внутри вращающегося на 360 градусов коридора длиной 30 метров, собранного в ангаре дирижаблей Кардингтон.", "text_en": "The zero-gravity hotel hallway fight was filmed inside a giant 100-foot rotating centrifuge rig built inside a British airship hangar."},
    ],
    "the dark knight": [
        {"badge_ru": "Камера IMAX", "badge_en": "IMAX First", "text_ru": "«Тёмный рыцарь» стал первым художественным фильмом в истории Голливуда, ключевые экшен-сцены которого (включая ограбление банка в прологе) снимались на 70-мм камеры IMAX.", "text_en": "The Dark Knight was the first major feature film in history to shoot action sequences—including the opening bank heist—on 70mm IMAX cameras."},
        {"badge_ru": "Актёрская игра", "badge_en": "Method Acting", "text_ru": "Хит Леджер в течение шести недель перед съёмками вёл дневник персонажа в номере отеля, разрабатывая характерный тембр голоса и пластику Джокера.", "text_en": "Heath Ledger isolated himself in a hotel room for six weeks keeping an in-character diary to develop the Joker's voice and posture."},
    ],
    "the gentlemen": [
        {"badge_ru": "Локации", "badge_en": "Locations", "text_ru": "Родовое поместье герцога Холстед снималось в реальном английском загородном доме Badminton House в Глостершире, принадлежащем герцогам Бофорт с XVII века.", "text_en": "Halstead Manor was filmed at Badminton House in Gloucestershire, the historic seat of the Dukes of Beaufort since the 17th century."},
        {"badge_ru": "Костюмы", "badge_en": "Costume Design", "text_ru": "Клетчатые спортивные костюмы тренера и его учеников шились на заказ художником по костюмам Майклом Уилкинсоном из классического британского твида Lovat Mill.", "text_en": "Coach's signature plaid tracksuits were custom-tailored by costume designer Michael Wilkinson using authentic Scottish estate tweed."},
    ],
    "arcane": [
        {"badge_ru": "Анимация", "badge_en": "Animation Craft", "text_ru": "Французская студия Fortiche работала над первым сезоном «Аркейна» более шести лет, сочетая трёхмерные модели персонажей с расписанными вручную 2D-текстурами и эффектами дыма.", "text_en": "French studio Fortiche spent six years crafting Season 1, blending 3D character rigs with hand-painted 2D textures and non-photorealistic lighting."},
    ],
    "stranger things": [
        {"badge_ru": "Саундтрек", "badge_en": "Chart Revival", "text_ru": "После выхода четвёртого сезона песня Кейт Буш «Running Up That Hill» (1985) впервые за 37 лет возглавила мировые чарты, став ключевым лейтмотивом спасения Макс.", "text_en": "Featured as Max's lifeline against Vecna, Kate Bush's 1985 single 'Running Up That Hill' surged to #1 globally 37 years after its release."},
    ],
}

_CURATED_TITLE_ALIASES: Dict[str, str] = {
    "во все тяжкие": "breaking bad",
    "тед лассо": "ted lasso",
    "интерстеллар": "interstellar",
    "оппенгеймер": "oppenheimer",
    "дюна": "dune",
    "разделение": "severance",
    "аркейн": "arcane",
    "очень странные дела": "stranger things",
    "укрытие": "silo",
    "бункер": "silo",
    "одни из нас": "the last of us",
    "фоллаут": "fallout",
    "джентльмены": "the gentlemen",
    "начало": "inception",
    "темный рыцарь": "the dark knight",
}



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
    strict_photo = qs.get("strict", ["0"])[0].strip().lower() in ("1", "true", "yes") or qs.get(
        "no_initials", ["0"]
    )[0].strip().lower() in ("1", "true", "yes")
    name_key = name.lower().replace("ё", "е").strip()
    cache_key = (hint_url or name_key).strip()
    cached_hit = None
    if cache_key or name_key:
        with ctx.person_photo_lock:
            cached_hit = (
                ctx.person_photo_cache.get(cache_key)
                if cache_key
                else None
            ) or (
                ctx.person_photo_cache.get(name_key)
                if name_key
                else None
            )
    if cached_hit:
        cached_ctype, cached_bytes = cached_hit
        if strict_photo and "svg" in str(cached_ctype).lower():
            try:
                handler.send_response(404)
                handler.send_header("Content-Type", "text/plain; charset=utf-8")
                handler.send_header("Cache-Control", "public, max-age=600")
                handler.send_header("Content-Length", "0")
                handler.end_headers()
            except (BrokenPipeError, ConnectionResetError):
                pass
            return True
        try:
            handler.send_response(200)
            handler.send_header("Content-Type", cached_ctype)
            handler.send_header("X-Content-Type-Options", "nosniff")
            handler.send_header("Content-Security-Policy", "sandbox; default-src 'none'")
            handler.send_header("Content-Length", str(len(cached_bytes)))
            handler.send_header("Cache-Control", "public, max-age=86400")
            handler.end_headers()
            handler.wfile.write(cached_bytes)
        except (BrokenPipeError, ConnectionResetError):
            pass
        return True

    candidate_urls = []

    def _add_photo_candidate(raw_u: str) -> None:
        u = str(raw_u or "").strip()
        if not u:
            return
        if (
            ctx.is_allowed_media_source_url(u, allow_torrserver_loopback=False)
            and ctx.rezka_client._is_valid_person_photo_url(u)
            and u not in candidate_urls
        ):
            candidate_urls.append(u)
        try:
            p_cand = urllib.parse.urlparse(u)
            if re.match(r"^/i/\d+/\d+/\d+/", p_cand.path or ""):
                static_alt = f"https://statichdrezka.ac{p_cand.path}"
                if (
                    static_alt not in candidate_urls
                    and ctx.is_allowed_media_source_url(static_alt, allow_torrserver_loopback=False)
                    and ctx.rezka_client._is_valid_person_photo_url(static_alt)
                ):
                    candidate_urls.append(static_alt)
                mirror_base = str(getattr(ctx.rezka_client, "base_url", "") or "").rstrip("/")
                if mirror_base.startswith("http"):
                    mirror_alt = f"{mirror_base}{p_cand.path}"
                    if (
                        mirror_alt not in candidate_urls
                        and ctx.is_allowed_media_source_url(mirror_alt, allow_torrserver_loopback=False)
                        and ctx.rezka_client._is_valid_person_photo_url(mirror_alt)
                    ):
                        candidate_urls.append(mirror_alt)
        except Exception:
            pass

    if hint_url:
        _add_photo_candidate(hint_url)
    resolved_url = ctx.rezka_client.resolve_person_photo(name)
    if resolved_url:
        _add_photo_candidate(resolved_url)

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
                final_resp_url = str(getattr(resp, "url", "") or resp.geturl() or p_url)
                if not ctx.rezka_client._is_valid_person_photo_url(final_resp_url):
                    continue
                raw_img = resp.read(524288)
                sniff_ctype = ctx.sniff_raster_image_type(raw_img)
                if resp.status == 200 and raw_img and len(raw_img) >= 512 and sniff_ctype:
                    out_ctype = sniff_ctype
                    with ctx.person_photo_lock:
                        if len(ctx.person_photo_cache) > 350:
                            for k_old in list(ctx.person_photo_cache.keys())[:88]:
                                ctx.person_photo_cache.pop(k_old, None)
                        if cache_key:
                            ctx.person_photo_cache[cache_key] = (out_ctype, raw_img)
                        if name_key:
                            ctx.person_photo_cache[name_key] = (out_ctype, raw_img)
                    try:
                        handler.send_response(200)
                        handler.send_header("Content-Type", out_ctype)
                        handler.send_header("X-Content-Type-Options", "nosniff")
                        handler.send_header("Content-Security-Policy", "sandbox; default-src 'none'")
                        handler.send_header("Content-Length", str(len(raw_img)))
                        handler.send_header("Cache-Control", "public, max-age=86400")
                        handler.end_headers()
                        handler.wfile.write(raw_img)
                    except (BrokenPipeError, ConnectionResetError):
                        pass
                    return True
        except Exception:
            continue

    if strict_photo:
        try:
            handler.send_response(404)
            handler.send_header("Content-Type", "text/plain; charset=utf-8")
            handler.send_header("Cache-Control", "public, max-age=600")
            handler.send_header("Content-Length", "0")
            handler.end_headers()
        except (BrokenPipeError, ConnectionResetError):
            pass
        return True

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
    with ctx.person_photo_lock:
        if len(ctx.person_photo_cache) > 350:
            for k_old in list(ctx.person_photo_cache.keys())[:88]:
                ctx.person_photo_cache.pop(k_old, None)
        if cache_key:
            ctx.person_photo_cache[cache_key] = ("image/svg+xml; charset=utf-8", svg)
        if name_key:
            ctx.person_photo_cache[name_key] = ("image/svg+xml; charset=utf-8", svg)
    try:
        handler.send_response(200)
        handler.send_header("Content-Type", "image/svg+xml; charset=utf-8")
        handler.send_header("Content-Length", str(len(svg)))
        handler.send_header("Cache-Control", "public, max-age=3600")
        handler.end_headers()
        handler.wfile.write(svg)
    except (BrokenPipeError, ConnectionResetError):
        pass
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

    reconcile_fut = None
    if media_type == "series" and ctx.kinorium_service.is_service_enabled("kinorium"):
        reconcile_fut = _META_EXECUTOR.submit(
            ctx.kinorium_service.reconcile_series_episodes,
            item_id=kin_item_id,
            title=title,
            orig_title=orig_title,
            kid=kin_kid or None,
        )

    kin_extras_lock = threading.Lock()
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
            desc_val = str(extras.get("description") or "").strip() if extras.get("description") else ""
            with kin_extras_lock:
                kin_extras_holder["pct"] = extras.get("critics_pct")
                if extras.get("kinorium_id"):
                    kin_extras_holder["kinorium_id"] = extras["kinorium_id"]
                kin_extras_holder["similar_raw"] = extras.get("similar_raw")
                if desc_val:
                    kin_extras_holder["description"] = desc_val
                eff_k_ep = str(kin_extras_holder.get("kinorium_id") or kin_kid or "").strip()
            if (
                eff_k_ep.isdigit()
                and desc_val
                and str(getattr(ctx.kinorium_service, "_profile_id", "main") or "main") == req_prof_id_tm
            ):
                with ctx.kinorium_service._state_lock:
                    ctx.kinorium_service.state.setdefault("descriptions_by_kid", {})[eff_k_ep] = desc_val
            if (
                media_type == "series"
                and reconcile_fut is None
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

    critics_fut = _META_EXECUTOR.submit(_fetch_kin_extras_bg)
    jw_offers_fut = _META_EXECUTOR.submit(_fetch_jw_offers_bg)
    en_fut = None
    if req_lang == "en" or media_type == "series":
        en_fut = _META_EXECUTOR.submit(_fetch_en_bg)

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
    for fut in (reconcile_fut, critics_fut, jw_offers_fut, en_fut):
        if fut is not None and not fut.done():
            rem = max(0.05, bg_deadline - time.time())
            try:
                fut.result(timeout=rem)
            except Exception:
                pass

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
    else:
        if not resp_payload["directors"] and isinstance(en_data, dict):
            resp_payload["directors"] = list(en_data.get("directors") or en_data.get("directors_en") or [])
        if not resp_payload["actors"] and isinstance(en_data, dict):
            resp_payload["actors"] = list(en_data.get("actors") or en_data.get("actors_en") or [])
        if not resp_payload["cast_people"] and (resp_payload["directors"] or resp_payload["actors"]):
            synth_cast: List[Dict[str, Any]] = []
            seen_synth = set()
            for d_nm in resp_payload["directors"][:4]:
                d_str = str(d_nm or "").strip()
                if not d_str or d_str.lower() in seen_synth:
                    continue
                seen_synth.add(d_str.lower())
                with ctx.rezka_client._cache_lock:
                    ph_d = ctx.rezka_client.person_photo_by_name.get(d_str.lower(), "")
                synth_cast.append({"name": d_str, "role": "Режиссёр", "is_director": True, "photo": ph_d})
            for a_nm in resp_payload["actors"][:14]:
                a_str = str(a_nm or "").strip()
                if not a_str or a_str.lower() in seen_synth:
                    continue
                seen_synth.add(a_str.lower())
                with ctx.rezka_client._cache_lock:
                    ph_a = ctx.rezka_client.person_photo_by_name.get(a_str.lower(), "")
                synth_cast.append({"name": a_str, "role": "В ролях", "is_director": False, "photo": ph_a})
            resp_payload["cast_people"] = synth_cast

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
        allow_network=bool(eff_kin_id_str and kin_extras_holder.get("similar_raw") is None),
        lang=req_lang,
        limit=12,
    )
    sim_items = sim_bundle.get("items", [])
    if ctx.profile_manager.is_kids_mode_active():
        sim_items = ctx.profile_manager.filter_items_for_kids(sim_items)
    resp_payload["similar_items"] = sim_items
    resp_payload["similar_source"] = sim_bundle.get("source", "curated")
    fr_bundle = ctx.aggregator.resolve_franchise_for_title(
        item_id=kin_item_id or item_id,
        rezka_id=str(resp_payload.get("rezka_id") or num_id or explicit_rezka_id or ""),
        title=title,
        orig_title=orig_title,
        year=year,
        media_type=media_type,
        preloaded_parts=(meta.get("franchise_parts") if isinstance(meta, dict) else None),
        lang=req_lang,
    )
    fr_items = fr_bundle.get("items", [])
    if ctx.profile_manager.is_kids_mode_active() and len(fr_items) >= 2:
        fr_items = ctx.profile_manager.filter_items_for_kids(fr_items)
    resp_payload["franchise_items"] = fr_items if len(fr_items) >= 2 else []
    resp_payload["franchise_source"] = fr_bundle.get("source", "none")
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
        en_cached = (
            en_data
            if isinstance(en_data, dict)
            else (
                ctx.en_meta_resolver.get_cached(
                    item_id=kin_item_id or item_id,
                    title=title,
                    orig_title=orig_title,
                    year=year,
                    media_type=media_type,
                    kinorium_id=eff_kin_id_str or kin_kid,
                    include_episodes=False,
                )
                if en_fut is not None
                else ctx.en_meta_resolver.resolve(
                    item_id=kin_item_id or item_id,
                    title=title,
                    orig_title=orig_title,
                    year=year,
                    media_type=media_type,
                    kinorium_id=eff_kin_id_str or kin_kid,
                    need_episodes=False,
                )
            )
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
    xray_inline = _build_xray_payload(
        title=title,
        orig_title=orig_title,
        year=year,
        media_type=media_type,
        directors=(resp_payload.get("directors_en") if req_lang == "en" else None) or resp_payload.get("directors") or [],
        actors=(resp_payload.get("actors_en") if req_lang == "en" else None) or resp_payload.get("actors") or [],
        genres=(resp_payload.get("genres_en") if req_lang == "en" else None) or resp_payload.get("genres") or [],
        countries=(resp_payload.get("countries_en") if req_lang == "en" else None) or resp_payload.get("countries") or [],
        kinorium_rating=kin_rating,
        imdb_rating=imdb_rating,
        critics_rating=final_critics,
        lang=req_lang,
        allow_network=False,
    )
    resp_payload["soundtrack"] = xray_inline["soundtrack"]
    resp_payload["trivia"] = xray_inline["trivia"]
    handler._send_json(resp_payload)
    return True


_CURATED_KEY_PATTERNS: Dict[str, Any] = {}
_CURATED_KEY_PATTERNS_LOCK = threading.Lock()


def _matches_curated_key(norm_key: str, cur_key: str) -> bool:
    if norm_key == cur_key:
        return True
    if cur_key not in norm_key:
        return False
    with _CURATED_KEY_PATTERNS_LOCK:
        pat = _CURATED_KEY_PATTERNS.get(cur_key)
    if pat is None:
        pat = re.compile(r"(?:^|\b)" + re.escape(cur_key) + r"(?:\b|$)")
        with _CURATED_KEY_PATTERNS_LOCK:
            if len(_CURATED_KEY_PATTERNS) < 512:
                _CURATED_KEY_PATTERNS[cur_key] = pat
    return bool(pat.search(norm_key))


def _safe_year_int(val: Any) -> int:
    if not val:
        return 0
    if isinstance(val, int):
        return val if 1880 <= val <= 2100 else 0
    m = re.search(r"\b(19\d\d|20\d\d)\b", str(val))
    return int(m.group(1)) if m else 0


def _build_xray_payload(
    *,
    title: str,
    orig_title: str,
    year: int = 0,
    media_type: str = "movie",
    directors: List[str] | None = None,
    actors: List[str] | None = None,
    genres: List[str] | None = None,
    countries: List[str] | None = None,
    kinorium_rating: Any = None,
    imdb_rating: Any = None,
    critics_rating: Any = None,
    lang: str = "ru",
    allow_network: bool = True,
) -> Dict[str, Any]:
    is_en = str(lang or "ru").lower().startswith("en")
    norm_keys: List[str] = []
    _series_only_aliases = {"укрытие", "бункер", "разделение", "аркейн"}
    for raw_t in (orig_title, title):
        cleaned = re.sub(r"[^a-zа-яё0-9\s]", " ", str(raw_t or "").lower()).strip()
        cleaned = re.sub(r"\s+", " ", cleaned)
        cleaned_yo = cleaned.replace("ё", "е")
        for ck in (cleaned, cleaned_yo):
            if ck and ck not in norm_keys:
                norm_keys.append(ck)
            if ck in _series_only_aliases and media_type != "series":
                continue
            alias_target = _CURATED_TITLE_ALIASES.get(ck)
            if alias_target and alias_target not in norm_keys:
                norm_keys.append(alias_target)

    cache_key = f"{'|'.join(norm_keys)}:{year}:{media_type}:{'en' if is_en else 'ru'}:{'net' if allow_network else 'local'}"
    now = time.time()
    with _XRAY_CACHE_LOCK:
        cached = _XRAY_CACHE.get(cache_key)
        if cached and (now - cached[0]) < 86400:
            base = dict(cached[1])
            base["soundtrack"] = list(base.get("soundtrack") or [])
            base["trivia"] = list(base.get("trivia") or [])
            return base

    soundtrack: List[Dict[str, str]] = []
    for nk in norm_keys:
        for cur_k, tracks in _CURATED_SOUNDTRACKS.items():
            if _matches_curated_key(nk, cur_k):
                for tr in tracks:
                    q_pair = urllib.parse.quote(f"{tr['artist']} {tr['title']}")
                    soundtrack.append(
                        {
                            "title": tr["title"],
                            "artist": tr["artist"],
                            "album": tr.get("album", ""),
                            "scene": tr.get("scene_en" if is_en else "scene_ru", ""),
                            "preview_url": tr.get("preview_url", ""),
                            "artwork_url": tr.get("artwork_url", ""),
                            "apple_music_url": f"https://music.apple.com/search?term={q_pair}",
                            "spotify_url": f"https://open.spotify.com/search/{q_pair}",
                            "youtube_url": f"https://music.youtube.com/search?q={q_pair}",
                        }
                    )
                break
        if soundtrack:
            break

    used_synthetic_fallback = False
    itunes_network_failed = False
    needs_itunes_enrichment = len(soundtrack) < 4 or any(not t.get("preview_url") for t in soundtrack)
    if allow_network and needs_itunes_enrichment and (orig_title or title):
        target_q = (orig_title or title).strip()
        search_q = f"{target_q} soundtrack"
        itunes_url = (
            f"https://itunes.apple.com/search?term={urllib.parse.quote(search_q)}"
            f"&media=music&entity=song&limit=10"
        )
        try:
            req = urllib.request.Request(
                itunes_url,
                headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Velarium/2.7"},
            )
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            with opener.open(req, timeout=2.4) as resp:
                data = json.loads(resp.read(524288).decode("utf-8", errors="replace"))
            results = data.get("results") if isinstance(data, dict) else []
            title_tokens = [
                tok
                for tok in re.split(r"\s+", re.sub(r"[^a-zа-яё0-9\s]", " ", target_q.lower()).strip())
                if len(tok) >= 3 and tok not in ("the", "and", "for", "from", "part", "season")
            ]
            existing_by_title = {t["title"].lower(): t for t in soundtrack}
            seen_titles = set(existing_by_title.keys())
            matched_candidates: List[Dict[str, str]] = []
            fallback_candidates: List[Dict[str, str]] = []
            for r in results or []:
                if not isinstance(r, dict):
                    continue
                t_name = str(r.get("trackName") or "").strip()
                a_name = str(r.get("artistName") or "").strip()
                c_name = str(r.get("collectionName") or "Original Soundtrack").strip()
                if not t_name or not a_name:
                    continue
                t_lower = t_name.lower()
                hi_res_art = str(r.get("artworkUrl100") or "").replace("100x100bb", "300x300bb")
                if t_lower in existing_by_title:
                    cur_tr = existing_by_title[t_lower]
                    if not cur_tr.get("preview_url") and r.get("previewUrl"):
                        cur_tr["preview_url"] = str(r["previewUrl"])
                    if not cur_tr.get("artwork_url") and hi_res_art:
                        cur_tr["artwork_url"] = hi_res_art
                    continue
                if t_lower in seen_titles:
                    continue
                seen_titles.add(t_lower)
                q_pair = urllib.parse.quote(f"{a_name} {t_name}")
                cand_entry = {
                    "title": t_name,
                    "artist": a_name,
                    "album": c_name,
                    "scene": "Official Soundtrack" if is_en else "Официальный саундтрек",
                    "preview_url": str(r.get("previewUrl") or ""),
                    "artwork_url": hi_res_art,
                    "apple_music_url": str(r.get("trackViewUrl") or f"https://music.apple.com/search?term={q_pair}"),
                    "spotify_url": f"https://open.spotify.com/search/{q_pair}",
                    "youtube_url": f"https://music.youtube.com/search?q={q_pair}",
                }
                haystack = f"{c_name} {t_name} {a_name}".lower()
                if not title_tokens or any(tok in haystack for tok in title_tokens):
                    matched_candidates.append(cand_entry)
                else:
                    fallback_candidates.append(cand_entry)
            chosen_pool = matched_candidates if matched_candidates else (fallback_candidates[:3] if not soundtrack else [])
            for cand_tr in chosen_pool:
                if len(soundtrack) >= 8:
                    break
                soundtrack.append(cand_tr)
        except Exception:
            itunes_network_failed = True

    disp_title = (orig_title or title or "Velarium").strip() if is_en else (title or orig_title or "Velarium").strip()
    orig_disp = (orig_title or disp_title).strip()
    if not soundtrack:
        used_synthetic_fallback = True
        q_ost = urllib.parse.quote(f"{orig_disp} Original Soundtrack")
        soundtrack = [
            {
                "title": f"{orig_disp} (Original Soundtrack)" if is_en else f"Саундтрек к «{disp_title}»",
                "artist": "Official Motion Picture Audio" if is_en else "Поиск альбома в музыкальных сервисах",
                "album": f"{orig_disp} (OST)",
                "scene": "Official Soundtrack" if is_en else "Официальный саундтрек",
                "preview_url": "",
                "is_search_fallback": True,
                "apple_music_url": f"https://music.apple.com/search?term={q_ost}",
                "spotify_url": f"https://open.spotify.com/search/{q_ost}",
                "youtube_url": f"https://music.youtube.com/search?q={q_ost}",
            },
        ]

    trivia: List[Dict[str, str]] = []
    for nk in norm_keys:
        for cur_k, facts in _CURATED_TRIVIA.items():
            if _matches_curated_key(nk, cur_k):
                for fc in facts:
                    trivia.append(
                        {
                            "badge": fc.get("badge_en" if is_en else "badge_ru", "Trivia"),
                            "text": fc.get("text_en" if is_en else "text_ru", ""),
                        }
                    )
                break
        if trivia:
            break

    if allow_network and len(trivia) < 4 and (title or orig_title):
        wiki_facts = _fetch_wikipedia_xray_trivia(
            title=title,
            orig_title=orig_title,
            year=year,
            media_type=media_type,
            is_en=is_en,
        )
        seen_tr_txt = {t["text"][:48].lower() for t in trivia if t.get("text")}
        for wf in wiki_facts:
            wf_txt = str(wf.get("text") or "").strip()
            if wf_txt and wf_txt[:48].lower() not in seen_tr_txt:
                seen_tr_txt.add(wf_txt[:48].lower())
                trivia.append(wf)
                if len(trivia) >= 6:
                    break

    dirs_clean = [str(d).strip() for d in (directors or []) if str(d).strip()]
    acts_clean = [str(a).strip() for a in (actors or []) if str(a).strip()]
    genres_clean = [str(g).strip() for g in (genres or []) if str(g).strip()]
    countries_clean = [str(c).strip() for c in (countries or []) if str(c).strip()]

    if len(trivia) < 3 and orig_title and title and orig_title.strip().lower() != title.strip().lower():
        meta_bits_ru = [f"Оригинальное название: «{orig_title}»"]
        meta_bits_en = [f"Original release title: \"{orig_title}\""]
        if year:
            meta_bits_ru.append(f"год выхода: {year}")
            meta_bits_en.append(f"release year: {year}")
        if countries_clean:
            meta_bits_ru.append(f"страна: {', '.join(countries_clean[:2])}")
            meta_bits_en.append(f"country: {', '.join(countries_clean[:2])}")
        if dirs_clean:
            meta_bits_ru.append(f"режиссёр: {', '.join(dirs_clean[:2])}")
            meta_bits_en.append(f"directed by {', '.join(dirs_clean[:2])}")
        trivia.append(
            {
                "badge": "Release Info" if is_en else "Паспорт релиза",
                "text": ("; ".join(meta_bits_en) + ".") if is_en else ("; ".join(meta_bits_ru) + "."),
            }
        )
    if len(trivia) < 3 and (kinorium_rating or imdb_rating or critics_rating):
        parts_ru = []
        parts_en = []
        if kinorium_rating:
            parts_ru.append(f"Kinorium {kinorium_rating}")
            parts_en.append(f"Kinorium {kinorium_rating}")
        if imdb_rating:
            parts_ru.append(f"IMDb {imdb_rating}")
            parts_en.append(f"IMDb {imdb_rating}")
        if critics_rating:
            parts_ru.append(f"критики {critics_rating}%")
            parts_en.append(f"Critics {critics_rating}%")
        trivia.append(
            {
                "badge": "Reception" if is_en else "Оценки и приём",
                "text": (
                    f"Audience and critical ratings for {disp_title}: {', '.join(parts_en)}."
                    if is_en
                    else f"Рейтинг у зрителей и прессы для «{disp_title}»: {', '.join(parts_ru)}."
                ),
            }
        )
    if not trivia:
        summary_parts_ru = [f"«{disp_title}»"]
        summary_parts_en = [disp_title]
        if year:
            summary_parts_ru.append(f"({year})")
            summary_parts_en.append(f"({year})")
        if dirs_clean:
            summary_parts_ru.append(f"— режиссёр {', '.join(dirs_clean[:2])}")
            summary_parts_en.append(f"— directed by {', '.join(dirs_clean[:2])}")
        if acts_clean:
            summary_parts_ru.append(f"в главных ролях: {', '.join(acts_clean[:3])}")
            summary_parts_en.append(f"starring {', '.join(acts_clean[:3])}")
        trivia.append(
            {
                "badge": "Production" if is_en else "О проекте",
                "text": (" ".join(summary_parts_en) + ".") if is_en else (" ".join(summary_parts_ru) + "."),
            }
        )

    payload = {
        "ok": True,
        "soundtrack": soundtrack[:8],
        "trivia": trivia[:7],
    }
    if not itunes_network_failed:
        with _XRAY_CACHE_LOCK:
            if len(_XRAY_CACHE) > 400:
                oldest_keys = sorted(_XRAY_CACHE.keys(), key=lambda k: _XRAY_CACHE[k][0])[:100]
                for ok_k in oldest_keys:
                    _XRAY_CACHE.pop(ok_k, None)
            cache_ts = (now - 86100.0) if used_synthetic_fallback else now
            _XRAY_CACHE[cache_key] = (cache_ts, copy.deepcopy(payload))
    return payload


def _fetch_wikipedia_xray_trivia(
    *,
    title: str,
    orig_title: str,
    year: int = 0,
    media_type: str = "movie",
    is_en: bool = False,
) -> List[Dict[str, str]]:
    wiki_lang = "en" if is_en else "ru"
    primary_q = (orig_title or title).strip() if is_en else (title or orig_title).strip()
    if not primary_q:
        return []
    type_hint = (
        ("TV series" if media_type == "series" else "film")
        if is_en
        else ("сериал" if media_type == "series" else "фильм")
    )
    search_q = f"{primary_q} {year} {type_hint}".strip() if year else f"{primary_q} {type_hint}".strip()
    url = (
        f"https://{wiki_lang}.wikipedia.org/w/api.php?action=query&generator=search"
        f"&gsrsearch={urllib.parse.quote(search_q)}&gsrlimit=2"
        f"&prop=extracts&explaintext=1&exsectionformat=wiki&exchars=5500&format=json"
    )
    try:
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "VelariumCinema/2.7 (https://127.0.0.1:8765)",
                "Accept": "application/json",
            },
        )
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(req, timeout=2.2) as resp:
            data = json.loads(resp.read(524288).decode("utf-8", errors="replace"))
        pages = ((data.get("query") or {}).get("pages") or {}) if isinstance(data, dict) else {}
        if not isinstance(pages, dict) or not pages:
            return []
        sorted_pages = sorted(
            pages.values(),
            key=lambda p: int(p.get("index", 999)) if isinstance(p, dict) else 999,
        )
        target_extract = ""
        p_norm = re.sub(r"[^a-zа-яё0-9]+", "", primary_q.lower())
        o_norm = re.sub(r"[^a-zа-яё0-9]+", "", (orig_title or "").lower())
        for pg in sorted_pages:
            if not isinstance(pg, dict):
                continue
            pg_title = str(pg.get("title") or "").strip()
            pg_base = re.sub(r"\s*\([^)]*\)\s*", "", pg_title).strip()
            pg_norm = re.sub(r"[^a-zа-яё0-9]+", "", pg_base.lower())
            if not pg_norm:
                continue
            if (p_norm and (p_norm in pg_norm or pg_norm in p_norm)) or (o_norm and (o_norm in pg_norm or pg_norm in o_norm)):
                target_extract = str(pg.get("extract") or "").strip()
                if target_extract:
                    break
        if not target_extract:
            return []

        section_badges_ru = {
            "съёмки": "Съёмки",
            "съемки": "Съёмки",
            "производство": "Производство",
            "история создания": "История создания",
            "разработка": "Разработка",
            "кастинг": "Кастинг",
            "подбор актёров": "Кастинг",
            "музыка": "Саундтрек",
            "саундтрек": "Саундтрек",
            "визуальные эффекты": "Визуальные эффекты",
            "декорации": "Декорации",
            "локации": "Локации",
            "интересные факты": "Интересный факт",
            "факты": "Интересный факт",
            "восприятие": "Критика и приём",
            "критика": "Критика и приём",
            "награды": "Награды и признание",
        }
        section_badges_en = {
            "production": "Production",
            "filming": "Filming",
            "development": "Development",
            "casting": "Casting",
            "music": "Music & Score",
            "soundtrack": "Soundtrack",
            "visual effects": "Visual Effects",
            "design": "Production Design",
            "reception": "Critical Reception",
            "accolades": "Accolades",
        }
        badge_map = section_badges_en if is_en else section_badges_ru

        results: List[Dict[str, str]] = []
        intro_paragraphs: List[str] = []
        in_intro = True
        current_badge = ""
        for raw_line in target_extract.splitlines():
            line = raw_line.strip()
            if not line:
                continue
            m_sec = re.match(r"^={2,4}\s*(.+?)\s*={2,4}$", line)
            if m_sec:
                in_intro = False
                sec_name = m_sec.group(1).strip().lower()
                matched_b = ""
                for k_sec, v_badge in badge_map.items():
                    if k_sec in sec_name:
                        matched_b = v_badge
                        break
                current_badge = matched_b
                continue
            clean_p = re.sub(r"\s+", " ", line).strip()
            if len(clean_p) < 75:
                continue
            if len(clean_p) > 310:
                sentences = re.split(r"(?<=[.!?])\s+", clean_p)
                acc = ""
                for s_part in sentences:
                    if not acc:
                        acc = s_part
                    elif len(acc) + 1 + len(s_part) <= 300:
                        acc = f"{acc} {s_part}"
                    else:
                        break
                clean_p = acc if len(acc) >= 75 else clean_p[:295].rsplit(" ", 1)[0] + "…"
            if in_intro:
                intro_paragraphs.append(clean_p)
                continue
            if not current_badge:
                continue
            results.append({"badge": current_badge, "text": clean_p})
            if len(results) >= 4:
                break
        if len(results) < 2 and intro_paragraphs:
            for idx_p, ip in enumerate(intro_paragraphs[1:] if len(intro_paragraphs) > 1 else intro_paragraphs):
                results.append(
                    {
                        "badge": ("History & Release" if idx_p == 0 else "Overview")
                        if is_en
                        else ("История релиза" if idx_p == 0 else "О проекте"),
                        "text": ip,
                    }
                )
                if len(results) >= 3:
                    break
        return results
    except Exception:
        return []


def handle_xray(handler: Any, qs: Dict[str, Any], parsed: Any, ctx: Any) -> bool:
    item_id = qs.get("id", [""])[0].strip()
    kinorium_id = qs.get("kinorium_id", [""])[0].strip()
    title = qs.get("title", [""])[0].strip()
    orig_title = qs.get("orig_title", [""])[0].strip()
    year = ctx.qs_int(qs, "year", 0)
    media_type = qs.get("media_type", ["movie"])[0].strip() or "movie"
    req_lang = ctx.norm_app_lang(qs.get("lang", [ctx.app_prefs.get("app_lang", "ru")])[0], ctx.app_prefs.get("app_lang", "ru"))
    allow_net = qs.get("allow_network", ["1"])[0].strip() not in ("0", "false", "no")

    if ctx.profile_manager.is_kids_mode_active():
        cand_item = ctx.build_trusted_item_for_kids_check(
            item_id=item_id or kinorium_id,
            title=title,
            orig_title=orig_title,
            media_type=media_type,
        )
        probe_xr = (
            cand_item
            if (cand_item and (cand_item.get("genres") or cand_item.get("description") or cand_item.get("age_rating")))
            else {
                **(cand_item if isinstance(cand_item, dict) else {}),
                "id": item_id or kinorium_id,
                "title": title,
                "orig_title": orig_title,
                "media_type": media_type,
                "genres": ["семейный"],
            }
        )
        if not ctx.profile_manager.is_item_kids_safe(probe_xr):
            handler._send_json({"ok": False, "error": "kids_restricted", "soundtrack": [], "trivia": []}, status=403)
            return True

    cand = None
    if hasattr(ctx, "aggregator") and hasattr(ctx.aggregator, "lookup_cached_item"):
        cand = ctx.aggregator.lookup_cached_item(item_id) or (
            ctx.aggregator.lookup_cached_item(f"kin_{kinorium_id}") if kinorium_id else None
        )
    is_en_req = req_lang == "en"
    directors = (
        ((cand.get("directors_en") if is_en_req else None) or cand.get("directors"))
        if isinstance(cand, dict)
        else None
    ) or []
    actors = (
        ((cand.get("actors_en") if is_en_req else None) or cand.get("actors"))
        if isinstance(cand, dict)
        else None
    ) or []
    genres = (
        ((cand.get("genres_en") if is_en_req else None) or cand.get("genres"))
        if isinstance(cand, dict)
        else None
    ) or []
    countries = (
        ((cand.get("countries_en") if is_en_req else None) or cand.get("countries"))
        if isinstance(cand, dict)
        else None
    ) or []
    ratings = (cand.get("ratings") if isinstance(cand, dict) else None) or {}
    payload = _build_xray_payload(
        title=title or (cand.get("title") if isinstance(cand, dict) else "") or "",
        orig_title=orig_title or (cand.get("orig_title") if isinstance(cand, dict) else "") or "",
        year=year or _safe_year_int(cand.get("year") if isinstance(cand, dict) else 0),
        media_type=media_type,
        directors=directors,
        actors=actors,
        genres=genres,
        countries=countries,
        kinorium_rating=ratings.get("kinorium"),
        imdb_rating=ratings.get("imdb"),
        critics_rating=ratings.get("critics"),
        lang=req_lang,
        allow_network=allow_net,
    )
    if isinstance(cand, dict):
        if cand.get("cast_people"):
            payload["cast_people"] = cand.get("cast_people")
        if cand.get("cast_people_en"):
            payload["cast_people_en"] = cand.get("cast_people_en")
        if directors:
            payload["directors"] = directors
        if actors:
            payload["actors"] = actors
    if not payload.get("cast_people") and allow_net and hasattr(ctx, "rezka_client") and (title or orig_title):
        try:
            num_id_xr = HDRezkaClient._extract_safe_rezka_id(
                item_id=item_id,
                explicit_rezka_id=str((cand or {}).get("rezka_id") or ""),
                rezka_url=str((cand or {}).get("rezka_url") or ""),
            )
            rz_meta = ctx.rezka_client._resolve_page_metadata(
                num_id_xr,
                title or str((cand or {}).get("title") or ""),
                orig_title or str((cand or {}).get("orig_title") or ""),
                str((cand or {}).get("rezka_url") or "") or None,
                year=year or _safe_year_int((cand or {}).get("year")),
                media_type=media_type,
            )
            if isinstance(rz_meta, dict):
                if rz_meta.get("cast_people"):
                    payload["cast_people"] = rz_meta["cast_people"]
                if rz_meta.get("directors") and not payload.get("directors"):
                    directors = rz_meta["directors"]
                    payload["directors"] = directors
                if rz_meta.get("actors") and not payload.get("actors"):
                    actors = rz_meta["actors"]
                    payload["actors"] = actors
        except Exception:
            pass
    if not payload.get("cast_people") and (directors or actors):
        synth_xr: List[Dict[str, Any]] = []
        seen_xr = set()
        for d_nm in directors[:4]:
            d_str = str(d_nm or "").strip()
            if not d_str or d_str.lower() in seen_xr:
                continue
            seen_xr.add(d_str.lower())
            with ctx.rezka_client._cache_lock:
                ph_d = ctx.rezka_client.person_photo_by_name.get(d_str.lower(), "")
            synth_xr.append({"name": d_str, "role": "Director" if is_en_req else "Режиссёр", "is_director": True, "photo": ph_d})
        for a_nm in actors[:12]:
            a_str = str(a_nm or "").strip()
            if not a_str or a_str.lower() in seen_xr:
                continue
            seen_xr.add(a_str.lower())
            with ctx.rezka_client._cache_lock:
                ph_a = ctx.rezka_client.person_photo_by_name.get(a_str.lower(), "")
            synth_xr.append({"name": a_str, "role": "Actor" if is_en_req else "В ролях", "is_director": False, "photo": ph_a})
        payload["cast_people"] = synth_xr
    _enrich_xray_payload_with_saved_tracks(payload, ctx)
    handler._send_json(payload)
    return True


def _compute_xray_track_id(track: Dict[str, Any]) -> str:
    explicit = str(track.get("track_id") or "").strip().lower()
    if explicit:
        return explicit
    title_norm = re.sub(r"[^a-zа-яё0-9]+", "-", str(track.get("title") or "").strip().lower()).strip("-")
    artist_norm = re.sub(r"[^a-zа-яё0-9]+", "-", str(track.get("artist") or "").strip().lower()).strip("-")
    combined = f"{artist_norm}--{title_norm}".strip("-")
    return combined or "unknown-track"


def _get_active_profile_id_for_xray(ctx: Any) -> str:
    try:
        pm = getattr(ctx, "profile_manager", None)
        if pm and hasattr(pm, "get_active_profile"):
            prof = pm.get_active_profile() or {}
            pid = str(prof.get("id") or "").strip()
            if pid:
                return pid
    except Exception:
        pass
    return "default"


_XRAY_SAVED_TRACKS_MEM: Dict[str, List[Dict[str, Any]]] = {}
_XRAY_SAVED_TRACKS_LOCK = threading.RLock()
_XRAY_PROF_ID_RE = re.compile(r"^[a-zA-Z0-9_-]{1,64}$")


def _norm_xray_profile_id(raw_id: Any, ctx: Any) -> str:
    active_id = _get_active_profile_id_for_xray(ctx)
    try:
        pm = getattr(ctx, "profile_manager", None)
        if pm and hasattr(pm, "is_kids_mode_active") and pm.is_kids_mode_active():
            return active_id if _XRAY_PROF_ID_RE.match(active_id) else "default"
    except Exception:
        pass
    cand = str(raw_id or "").strip()
    if cand and _XRAY_PROF_ID_RE.match(cand):
        return cand
    return active_id if _XRAY_PROF_ID_RE.match(active_id) else "default"


def _clean_xray_http_url(raw_url: Any) -> str:
    s = str(raw_url or "").strip()
    if not s or any(ord(c) < 32 for c in s):
        return ""
    if s.lower().startswith(("https://", "http://")):
        return s[:1024]
    return ""


def _get_saved_xray_tracks(ctx: Any, profile_id: str) -> List[Dict[str, Any]]:
    profile_id = _norm_xray_profile_id(profile_id, ctx)
    with _XRAY_SAVED_TRACKS_LOCK:
        d = getattr(ctx, "__dict__", {})
        storage_db = d.get("storage_db") if isinstance(d, dict) and "storage_db" in d else getattr(type(ctx), "storage_db", None)
        if storage_db is None and not hasattr(ctx, "_main_module"):
            storage_db = getattr(ctx, "storage_db", None)
        if storage_db and hasattr(storage_db, "get_kv"):
            try:
                raw = storage_db.get_kv("xray_saved_tracks", profile_id, default=[])
                if isinstance(raw, list):
                    return [dict(x) for x in raw if isinstance(x, dict)]
            except Exception:
                pass
        raw_mem = _XRAY_SAVED_TRACKS_MEM.get(profile_id, [])
        if isinstance(raw_mem, list):
            return [dict(x) for x in raw_mem if isinstance(x, dict)]
        return []


def _save_xray_tracks_list(ctx: Any, profile_id: str, items: List[Dict[str, Any]]) -> None:
    profile_id = _norm_xray_profile_id(profile_id, ctx)
    clean = [dict(x) for x in items if isinstance(x, dict)][:250]
    with _XRAY_SAVED_TRACKS_LOCK:
        d = getattr(ctx, "__dict__", {})
        storage_db = d.get("storage_db") if isinstance(d, dict) and "storage_db" in d else getattr(type(ctx), "storage_db", None)
        if storage_db is None and not hasattr(ctx, "_main_module"):
            storage_db = getattr(ctx, "storage_db", None)
        if storage_db and hasattr(storage_db, "set_kv"):
            try:
                storage_db.set_kv("xray_saved_tracks", profile_id, clean)
            except Exception:
                pass
        if profile_id not in _XRAY_SAVED_TRACKS_MEM and len(_XRAY_SAVED_TRACKS_MEM) >= 32:
            oldest_prof = next(iter(_XRAY_SAVED_TRACKS_MEM))
            _XRAY_SAVED_TRACKS_MEM.pop(oldest_prof, None)
        _XRAY_SAVED_TRACKS_MEM[profile_id] = clean


def _enrich_xray_payload_with_saved_tracks(payload: Dict[str, Any], ctx: Any) -> None:
    if not isinstance(payload, dict):
        return
    prof_id = _get_active_profile_id_for_xray(ctx)
    saved_list = _get_saved_xray_tracks(ctx, prof_id)
    saved_ids = {str(x.get("track_id") or _compute_xray_track_id(x)) for x in saved_list}
    ost = payload.get("soundtrack")
    if isinstance(ost, list):
        enriched_ost: List[Dict[str, Any]] = []
        for tr in ost:
            if not isinstance(tr, dict):
                continue
            tr_copy = dict(tr)
            tid = _compute_xray_track_id(tr_copy)
            tr_copy["track_id"] = tid
            tr_copy["is_saved"] = tid in saved_ids
            enriched_ost.append(tr_copy)
        payload["soundtrack"] = enriched_ost
    payload["saved_tracks"] = saved_list
    payload["saved_tracks_count"] = len(saved_list)


def handle_xray_saved_tracks_get(handler: Any, qs: Dict[str, Any], parsed: Any, ctx: Any) -> bool:
    if hasattr(handler, "_require_authorized_client_if_lan") and not handler._require_authorized_client_if_lan():
        return True
    prof_id = _norm_xray_profile_id(qs.get("profile_id", [""])[0], ctx)
    saved = _get_saved_xray_tracks(ctx, prof_id)
    handler._send_json(
        {
            "ok": True,
            "profile_id": prof_id,
            "count": len(saved),
            "items": saved,
        }
    )
    return True


def handle_xray_saved_tracks_post(handler: Any, qs: Dict[str, Any], parsed: Any, body: Dict[str, Any], ctx: Any) -> bool:
    if hasattr(handler, "_require_authorized_client_if_lan") and not handler._require_authorized_client_if_lan(body):
        return True
    prof_id = _norm_xray_profile_id(body.get("profile_id"), ctx)
    action = str(body.get("action") or "toggle").strip().lower()
    track_in = body.get("track") if isinstance(body.get("track"), dict) else body
    title = str(track_in.get("title") or "").strip()[:240]
    artist = str(track_in.get("artist") or "").strip()[:240]
    track_id = _compute_xray_track_id({"track_id": track_in.get("track_id"), "title": title, "artist": artist})
    if not title and not track_in.get("track_id"):
        handler._send_json({"ok": False, "error": "Track title is required"}, status=400)
        return True
    with _XRAY_SAVED_TRACKS_LOCK:
        saved = _get_saved_xray_tracks(ctx, prof_id)
        existing_idx = next(
            (idx for idx, item in enumerate(saved) if str(item.get("track_id") or _compute_xray_track_id(item)) == track_id),
            -1,
        )
        if action == "remove" or (action == "toggle" and existing_idx >= 0):
            if existing_idx >= 0:
                saved.pop(existing_idx)
            is_saved = False
        else:
            entry = {
                "track_id": track_id,
                "title": title or str((saved[existing_idx] if existing_idx >= 0 else {}).get("title") or ""),
                "artist": artist or str((saved[existing_idx] if existing_idx >= 0 else {}).get("artist") or ""),
                "album": str(track_in.get("album") or "").strip()[:240],
                "scene": str(track_in.get("scene") or "").strip()[:500],
                "media_title": str(track_in.get("media_title") or body.get("media_title") or "").strip()[:240],
                "media_id": str(track_in.get("media_id") or body.get("media_id") or "").strip()[:120],
                "preview_url": _clean_xray_http_url(track_in.get("preview_url")),
                "artwork_url": _clean_xray_http_url(track_in.get("artwork_url")),
                "apple_music_url": _clean_xray_http_url(track_in.get("apple_music_url")),
                "spotify_url": _clean_xray_http_url(track_in.get("spotify_url")),
                "youtube_url": _clean_xray_http_url(track_in.get("youtube_url")),
                "saved_at": int(time.time()),
            }
            if existing_idx >= 0:
                saved[existing_idx] = entry
            else:
                saved.insert(0, entry)
            is_saved = True
        _save_xray_tracks_list(ctx, prof_id, saved)
    handler._send_json(
        {
            "ok": True,
            "profile_id": prof_id,
            "track_id": track_id,
            "is_saved": is_saved,
            "count": len(saved),
            "items": saved,
        }
    )
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
    "/api/xray": handle_xray,
    "/api/xray/soundtracks": handle_xray,
    "/api/xray/saved-tracks": handle_xray_saved_tracks_get,
    "/api/user/saved-tracks": handle_xray_saved_tracks_get,
    "/api/provider-link": handle_provider_link,
    "/api/skip-intro": handle_skip_intro,
    "/api/subtitles/search": handle_subtitles_search,
    "/api/subtitles/translate": handle_subtitles_translate,
    "/api/calendar": handle_calendar,
}

META_POST_ROUTES = {
    "/api/xray/saved-tracks": handle_xray_saved_tracks_post,
    "/api/user/saved-tracks": handle_xray_saved_tracks_post,
}
