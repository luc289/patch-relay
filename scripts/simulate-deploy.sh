#!/usr/bin/env bash
# Déploiement simulé : démarre le service et valide la sonde /health.
set -euo pipefail

PORT="${PORT:-3000}"
APP_ENV="${APP_ENV:-local}"
echo "Déploiement de patch-relay sur l'environnement ${APP_ENV}..."

PORT="$PORT" APP_ENV="$APP_ENV" node src/server.js > server.log 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null || true' EXIT

for _ in $(seq 1 20); do
  if body=$(curl -fsS "http://127.0.0.1:${PORT}/health" 2>/dev/null); then
    echo "Sonde de santé OK : ${body}"
    if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
      echo "- ${APP_ENV} : déployé, /health -> \`${body}\`" >> "$GITHUB_STEP_SUMMARY"
    fi
    exit 0
  fi
  sleep 1
done

echo "La sonde de santé a échoué." >&2
cat server.log >&2
exit 1
