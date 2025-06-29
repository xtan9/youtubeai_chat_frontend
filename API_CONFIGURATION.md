# API Configuration Guide

This guide explains how to configure the frontend to work with different API environments.

## 🔧 Environment-Based Configuration

The frontend now uses environment variables to determine which API endpoint to use, instead of hardcoded URLs.

### Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `NEXT_PUBLIC_API_URL` | Base URL for the YouTube AI API | `http://localhost:8001` |

## 🎯 Available API Endpoints

| Environment | URL | Use Case |
|-------------|-----|----------|
| **Development** | `http://localhost:8001` | Local development with backend dev environment |
| **Production Local** | `http://localhost` | Testing production backend locally |
| **Production Public** | `https://api.youtubeai.chat` | Public production deployment |

## 🚀 Quick Setup

### 1. Development Setup
```bash
# Switch to development API
./scripts/switch-api.sh dev

# Or manually update .env.local
echo "NEXT_PUBLIC_API_URL=http://localhost:8001" >> .env.local
```

### 2. Production Testing (Local)
```bash
# Switch to local production API
./scripts/switch-api.sh prod-local
```

### 3. Production Deployment
```bash
# Switch to public production API
./scripts/switch-api.sh prod-public
```

## 📋 API Switcher Scripts

### Bash Script (Recommended)
```bash
./scripts/switch-api.sh dev          # Development
./scripts/switch-api.sh prod-local   # Local production
./scripts/switch-api.sh prod-public  # Public production
./scripts/switch-api.sh status       # Show current config
```

### Node.js Script
```bash
node scripts/switch-api.js dev
node scripts/switch-api.js status
```

## 🔍 Check Current Configuration

```bash
./scripts/switch-api.sh status
```

Output:
```
🔗 Current API Configuration:
   NEXT_PUBLIC_API_URL=http://localhost:8001

📋 Available endpoints:
   dev: http://localhost:8001 (current)
   prod-local: http://localhost
   prod-public: https://api.youtubeai.chat
```

## 🛠 Development Workflow

### Typical Development Flow:
1. **Start backend development environment:**
   ```bash
   cd ../youtubeai_chat_backend
   ./scripts/manage-environments.sh dev-start
   ```

2. **Configure frontend for development:**
   ```bash
   ./scripts/switch-api.sh dev
   ```

3. **Start frontend development:**
   ```bash
   pnpm dev
   ```

### Testing Production Locally:
1. **Start backend production environment:**
   ```bash
   cd ../youtubeai_chat_backend
   ./scripts/manage-environments.sh prod-start
   ```

2. **Configure frontend for local production:**
   ```bash
   ./scripts/switch-api.sh prod-local
   ```

3. **Test frontend:**
   ```bash
   pnpm build && pnpm start
   ```

## 🔧 Manual Configuration

If you prefer to manually configure the environment:

### .env.local
```bash
# Development
NEXT_PUBLIC_API_URL=http://localhost:8001

# Production Local
NEXT_PUBLIC_API_URL=http://localhost

# Production Public
NEXT_PUBLIC_API_URL=https://api.youtubeai.chat
```

## 🚨 Important Notes

1. **Restart Required**: After changing `NEXT_PUBLIC_API_URL`, you must restart your Next.js development server.

2. **Environment Precedence**: Next.js loads environment variables in this order:
   - `.env.local` (highest priority)
   - `.env.development` / `.env.production`
   - `.env`

3. **NEXT_PUBLIC_ Prefix**: Environment variables must start with `NEXT_PUBLIC_` to be available in the browser.

4. **Production Deployment**: For production deployments (Vercel, Netlify, etc.), set the environment variable in your deployment platform's settings.

## 🔗 Related Files

- `lib/config/api.ts` - API configuration utilities
- `lib/hooks/useYouTubeSummarizer.ts` - Main API hook (updated to use env vars)
- `.env.local` - Local environment configuration
- `.env.example` - Environment configuration template
- `scripts/switch-api.*` - API endpoint switcher scripts

## 🐛 Troubleshooting

### API Not Responding
1. Check current API configuration: `./scripts/switch-api.sh status`
2. Verify backend is running on the correct port
3. Check browser console for CORS errors

### Environment Variable Not Working
1. Ensure the variable starts with `NEXT_PUBLIC_`
2. Restart the Next.js development server
3. Check that `.env.local` exists and contains the variable

### CORS Issues
1. Ensure the backend CORS configuration allows your frontend domain
2. For development, the backend should allow `http://localhost:3000`