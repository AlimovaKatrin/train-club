#!/usr/bin/env bash
set -euo pipefail
umask 077
cd /opt/train-club
exec 9>/run/lock/train-club-backup.lock
flock -n 9 || exit 0
directory=/var/backups/train-club
mkdir -p "$directory"
destination="$directory/$(date -u +%Y%m%dT%H%M%SZ).dump.enc"
trap 'rm -f "$destination.partial"' EXIT
docker compose --env-file .env.server.local -f compose.production.yaml exec -T db \
  pg_dump -U postgres -d train_club --format=custom \
  | openssl cms -encrypt -binary -aes256 -outform DER \
      -out "$destination.partial" /etc/train-club/backup-cert.pem
mv "$destination.partial" "$destination"
# Only completed encrypted dumps created by this script are expired.
find "$directory" -maxdepth 1 -type f -name '*.dump.enc' -mtime +14 -delete
printf 'Created encrypted PostgreSQL backup: %s\n' "$(basename "$destination")"
