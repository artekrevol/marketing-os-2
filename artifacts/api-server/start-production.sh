#!/bin/sh
# Production launcher: runs the BullMQ worker in the background and the
# API server in the foreground. Both share the same environment variables.
# If the API server exits (crash or SIGTERM), the worker is also stopped.
set -e

echo "[launcher] starting BullMQ worker..."
node --enable-source-maps lib/worker/dist/index.mjs &
WORKER_PID=$!

echo "[launcher] starting API server..."
node --enable-source-maps artifacts/api-server/dist/index.mjs &
API_PID=$!

# Forward SIGTERM to both child processes so Replit's graceful-stop
# signal propagates cleanly.
trap 'kill $WORKER_PID $API_PID 2>/dev/null; wait $WORKER_PID $API_PID 2>/dev/null' TERM INT

# Wait for either process to exit; if either dies, kill the other.
wait -n $WORKER_PID $API_PID 2>/dev/null || true
kill $WORKER_PID $API_PID 2>/dev/null || true
wait $WORKER_PID $API_PID 2>/dev/null || true
