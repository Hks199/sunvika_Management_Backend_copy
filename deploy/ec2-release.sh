#!/bin/sh
set -eu

# Invoked with sudo by the GitHub Actions SSH user.
cd /opt/sunvika-backend
test -s .env.production
test -s /etc/letsencrypt/live/sunvikamanagementhub.sunvika.in/fullchain.pem
test -s /etc/letsencrypt/live/sunvikamanagementhub.sunvika.in/privkey.pem
chmod 600 .env.production
mkdir -p acme/.well-known/acme-challenge
docker compose config --quiet
docker compose up -d --no-build --wait --wait-timeout 120 app
# Recreate Nginx to mount the newly extracted config and resolve the new app IP.
docker compose up -d --no-build --force-recreate --wait --wait-timeout 60 nginx
docker compose exec -T nginx nginx -t
install -d -m 755 /etc/letsencrypt/renewal-hooks/deploy
install -m 755 deploy/certbot/reload-nginx.sh /etc/letsencrypt/renewal-hooks/deploy/sunvika-reload-nginx
systemctl enable --now certbot.timer
docker compose ps
