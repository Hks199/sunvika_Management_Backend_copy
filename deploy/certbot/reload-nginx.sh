#!/bin/sh
set -eu

cd /opt/sunvika-backend
docker compose exec -T nginx nginx -t
docker compose exec -T nginx nginx -s reload
