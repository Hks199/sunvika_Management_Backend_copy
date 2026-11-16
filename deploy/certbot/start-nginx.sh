#!/bin/sh
set -eu

docker compose -f /opt/sunvika-backend/docker-compose.yml start nginx
