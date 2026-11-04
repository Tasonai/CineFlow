**Что нового в CineFlow 2.7.0:**
• **Полная модульная архитектура бэкенда**: монолитный сервер разделен на 20+ независимых сервисов и маршрутизаторов (`backend/routes/`, `backend/app_factory.py`, `backend/bootstrap.py`, `backend/server_lifecycle.py`), размер `server.py` сокращён на 87% с сохранением 100% совместимости API.
• **Оптимизация графа связей фронтенда**: полностью устранены циклические зависимости в модулях каталога и плеера, компоненты обращаются напрямую к специализированным подсистемам, ускорена загрузка и отклик интерфейса.
• **Усиленная изоляция данных и безопасность**: мастер-ключи шифрования хранилища и локальные базы данных изолированы от репозитория, обновлены механизмы защиты от несанкционированного доступа.
• **Стабильность стриминга и синхронизация медиа**: повышенная плавность прямого ремуксирования потоков без рассинхронизации аудио и видео, автоматический перезапуск зависших аппаратных сессий декодирования.

<!-- EN -->

**What's new in CineFlow 2.7.0:**
• **Complete Modular Backend Architecture**: the monolithic server has been restructured into 20+ decoupled services and route modules (`backend/routes/`, `backend/app_factory.py`, `backend/bootstrap.py`, `backend/server_lifecycle.py`), reducing `server.py` by 87% while preserving 100% API compatibility.
• **Frontend Acyclic Dependency Graph**: circular import cycles across catalog and player modules have been completely resolved, allowing components to communicate directly with specialized subsystems and accelerating SPA startup.
• **Hardened Data Security & Vault Isolation**: encryption keys and local databases are strictly excluded from source control, strengthening runtime credential protection.
• **Streaming Stability & A/V Sync**: improved live remuxing pipeline reliability with zero-jitter PTS alignment and automated recovery against frozen hardware video decoders.
