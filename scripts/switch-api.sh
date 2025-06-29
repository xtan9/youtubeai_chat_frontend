#!/bin/bash

# YouTube AI Chat - API Environment Switcher (Bash version)
# Quick script to switch API endpoints

cd "$(dirname "$0")/.."

case "${1:-help}" in
    "dev")
        echo "🔧 Switching to development API..."
        node scripts/switch-api.js dev
        ;;
    "prod-local")
        echo "🏠 Switching to local production API..."
        node scripts/switch-api.js prod-local
        ;;
    "prod-public")
        echo "🌍 Switching to public production API..."
        node scripts/switch-api.js prod-public
        ;;
    "status")
        node scripts/switch-api.js status
        ;;
    "help"|"-h"|"--help")
        node scripts/switch-api.js help
        ;;
    *)
        echo "❌ Unknown command: $1"
        node scripts/switch-api.js help
        exit 1
        ;;
esac