#!/bin/bash
set -e

# Démarrer Xvfb
Xvfb :99 -screen 0 1920x1080x24 -ac +extension GLX +render -noreset &
XVFB_PID=$!

# Vérifier que Xvfb est bien démarré
echo "Waiting for Xvfb to start..."
for i in $(seq 1 10); do
  if xdpyinfo -display :99 >/dev/null 2>&1; then
    echo "Xvfb started successfully."
    break
  fi
  echo "Waiting for Xvfb... $i"
  sleep 1
  if [ $i -eq 10 ]; then
    echo "Failed to start Xvfb!"
    exit 1
  fi
done

# Démarrer l'application
echo "Starting application..."
npx ts-node src/http-server.ts

# Nettoyer les processus à la fin
kill $XVFB_PID 