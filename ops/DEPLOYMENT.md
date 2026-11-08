# Развёртывание Train Club на собственном сервере

Приложение, PostgreSQL 17 и Caddy запускаются через `compose.production.yaml`.
Публичны только порты Caddy 80/443 и SSH. PostgreSQL и Next.js не публикуют порты
хоста. Vercel и Supabase не участвуют в работе приложения.

## Конфигурация

Рабочий каталог сервера — `/opt/train-club`. Все `.env*` исключены из Git и образа.
Требуются три файла:

- `.env.server.local`: `POSTGRES_ADMIN_PASSWORD`, `TRAIN_CLUB_IMAGE`, `SITE_ADDRESS`.
- `.env.app.local`: `DATABASE_URL` для роли `train_club_app`, адрес базы `db:5432`.
- `.env.migrations.local`: `DATABASE_URL` для роли `train_club_migrate` на той же базе.

Каталог имеет режим `0700`, файлы — `0600`. Файл миграций должен принадлежать UID
1001, под которым работает одноразовый контейнер. Используются разные случайные
пароли. При первом запуске администратор создаёт обе роли без SUPERUSER, CREATEDB
и CREATEROLE; мигратору даёт CONNECT на базу и USAGE, CREATE на схему public.
Роль приложения получает доступ после миграций через `ops/runtime-access.sql`.
Она может читать программу, записывать занятия и продвигать очередь, но не
изменять структуру базы или состав программы. RLS включён с явными политиками
для этой роли. Отсутствие входа в интерфейс — согласованное продуктовое решение.

## Сборка и доставка

На Mac собирается Linux/amd64-образ; сервер с 1 ГБ RAM не выполняет сборку.
Исходники для выпуска берутся из конкретного коммита (`git archive`), без
локальных черновиков и секретов. Например:

```sh
release=$(git rev-parse --short HEAD)
build_dir=$(mktemp -d)
git archive HEAD | tar -x -C "$build_dir"
docker build --platform linux/amd64 -t "train-club:$release" "$build_dir"
docker save "train-club:$release" | gzip | \
  ssh -i ~/.ssh/train_club_hoster root@SERVER 'gunzip | docker load'
```

Доставить `compose.production.yaml` и `ops/` из того же коммита. На сервере
сохранить прежнее значение `TRAIN_CLUB_IMAGE`, записать новый тег в
`.env.server.local` и выполнить:

```sh
cd /opt/train-club
# Перед обновлением существующей базы:
./ops/backup.sh
docker compose --env-file .env.server.local -f compose.production.yaml up -d db
docker compose --env-file .env.server.local -f compose.production.yaml run --rm migrate
docker compose --env-file .env.server.local -f compose.production.yaml exec -T db \
  psql -X -v ON_ERROR_STOP=1 -U postgres -d train_club < ops/runtime-access.sql
docker compose --env-file .env.server.local -f compose.production.yaml up -d --wait app caddy
```

Одноразовый мигратор применяет миграции и персональную программу в транзакции.
Демо-наполнение в рабочую базу не загружается. Проверить `/api/bootstrap`, HTTPS
и состояние контейнеров. При неудачном запуске вернуть прежний тег и повторить
`up -d --wait app caddy`. Это откат приложения; он не отменяет миграции базы.
Перед несовместимыми миграциями нужен отдельный план отката. Не выполнять
`docker compose down -v`: том базы содержит дневник.

Контейнеры перезапускаются после перезагрузки сервера. Логи ограничены 3 × 10 МБ
на сервис. Healthcheck приложения проверяет соединение с базой через bootstrap;
статус `unhealthy` виден в `docker compose ps`, но сам по себе не отправляет
уведомления и не перезапускает контейнер. Обновления образов выполняются явно
после проверок, а не автоматически при каждом рестарте.

## Резервные копии

`train-club-backup.timer` ежедневно около 02:00 UTC запускает `ops/backup.sh`.
Скрипт делает согласованный `pg_dump` и шифрует его публичным сертификатом
`/etc/train-club/backup-cert.pem`. На сервере остаются копии за 14 дней.
Приватного ключа расшифрования на сервере нет.

На Mac ключ и копии хранятся в `~/Library/Application Support/Train Club/`:

- `secrets/backup-key.pem` — ключ расшифрования, режим `0600`;
- `secrets/backup-cert.pem` — сертификат шифрования;
- `backups/` — скачанные зашифрованные копии, без автоматического удаления;
- `backup-sync.log` — журнал скачивания;
- `backups/last-success.txt` — имя последней доступной копии.

LaunchAgent `local.train-club.backup-sync` запускает `ops/pull-backups.py` при
входе пользователя и затем раз в час. Mac должен быть включён, пользователь
вошедшим в систему, а сеть и SSH-ключ доступными. После длительного отключения
скачаются только оставшиеся на сервере копии. Для постоянной защиты независимо
от Mac потребуется отдельное внешнее хранилище. Ключ необходимо сохранить вместе
с резервной копией Mac: без него `.dump.enc` восстановить нельзя.

Проверка расписания: `systemctl list-timers train-club-backup.timer` на сервере и
`launchctl print gui/$(id -u)/local.train-club.backup-sync` на Mac.

## Восстановление

Сначала восстанавливать в отдельную пустую тестовую базу, а не поверх дневника.
Пример расшифрования в поток на Mac:

```sh
openssl cms -decrypt -binary -inform DER \
  -in "$HOME/Library/Application Support/Train Club/backups/BACKUP.dump.enc" \
  -inkey "$HOME/Library/Application Support/Train Club/secrets/backup-key.pem" \
  | pg_restore --no-owner --no-privileges --exit-on-error --dbname=RESTORE_TEST_URL
```

Перед восстановлением должны существовать роли, на которые ссылаются политики,
в частности `train_club_app`. После восстановления проверить число занятий,
программу и очередь. Для новой рабочей базы восстановить владельца объектов и
права ролей; `--no-owner` выше предназначен для проверки в изолированной базе.
Глобальные роли и пароли в `pg_dump` не входят, их создают из защищённой
конфигурации отдельно. Автоматическое переключение на восстановленную базу не
выполняется.
