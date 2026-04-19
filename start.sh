#!/bin/bash
set -e

echo "🧬 SystematicAI — Starting up..."

# Install dependencies if needed
if [ ! -d "backend/node_modules" ]; then
  echo "📦 Installing backend dependencies..."
  cd backend && npm install && cd ..
fi

if [ ! -d "frontend/node_modules" ]; then
  echo "📦 Installing frontend dependencies..."
  cd frontend && npm install && cd ..
fi

echo ""
echo "🚀 Starting backend on http://localhost:3001"
echo "🌐 Starting frontend on http://localhost:5173"
echo ""
echo "Open http://localhost:5173 in your browser"
echo "Press Ctrl+C to stop both servers"
echo ""

# Start both concurrently
(cd backend && npx ts-node-dev --respawn --transpile-only src/index.ts) &
BACKEND_PID=$!

(cd frontend && npx vite) &
FRONTEND_PID=$!

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null" EXIT INT TERM
wait
