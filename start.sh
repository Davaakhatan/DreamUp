#!/bin/bash

# Quick Start Script for DreamUp QA Dashboard

source ~/.nvm/nvm.sh 2>/dev/null || true

echo "═══════════════════════════════════════════════════════════"
echo "  DreamUp QA Dashboard - Starting..."
echo "═══════════════════════════════════════════════════════════"
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found!"
    echo "   Please install Node.js or run: source ~/.nvm/nvm.sh"
    exit 1
fi

# Check .env
if [ ! -f .env ]; then
    echo "⚠️  Warning: .env file not found"
    echo "   Make sure your API keys are configured"
    echo ""
fi

# Check if built
if [ ! -d "dist" ]; then
    echo "🔨 Building project..."
    npm run build
    echo ""
fi

# Check if dashboard is already running
if lsof -ti:3000 > /dev/null 2>&1; then
    echo "⚠️  Port 3000 is already in use"
    echo "   Stopping existing process..."
    pkill -f "cli dashboard"
    sleep 2
fi

# Start dashboard
echo "🚀 Starting dashboard..."
echo ""
echo "📊 Dashboard will be available at:"
echo "   → http://localhost:3000"
echo ""
echo "Press Ctrl+C to stop"
echo ""
echo "═══════════════════════════════════════════════════════════"
echo ""

npm run cli dashboard

