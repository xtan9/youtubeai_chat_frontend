#!/usr/bin/env node

/**
 * API Environment Switcher
 * Quickly switch between different API endpoints for development and testing
 */

const fs = require('fs');
const path = require('path');

const ENV_FILE = path.join(__dirname, '..', '.env.local');

const API_ENDPOINTS = {
  dev: 'http://localhost:8001',
  'prod-local': 'http://localhost',
  'prod-public': 'https://api.youtubeai.chat',
};

function updateApiUrl(endpoint) {
  if (!fs.existsSync(ENV_FILE)) {
    console.error('❌ .env.local file not found');
    process.exit(1);
  }

  let content = fs.readFileSync(ENV_FILE, 'utf8');
  
  // Update or add NEXT_PUBLIC_API_URL
  const apiUrlRegex = /^NEXT_PUBLIC_API_URL=.*$/m;
  const newLine = `NEXT_PUBLIC_API_URL=${endpoint}`;
  
  if (apiUrlRegex.test(content)) {
    content = content.replace(apiUrlRegex, newLine);
  } else {
    content += `\n${newLine}\n`;
  }
  
  fs.writeFileSync(ENV_FILE, content);
  console.log(`✅ API URL updated to: ${endpoint}`);
  console.log('🔄 Please restart your Next.js development server');
}

function showStatus() {
  if (!fs.existsSync(ENV_FILE)) {
    console.log('❌ .env.local file not found');
    return;
  }

  const content = fs.readFileSync(ENV_FILE, 'utf8');
  const match = content.match(/^NEXT_PUBLIC_API_URL=(.*)$/m);
  const currentUrl = match ? match[1] : 'Not set';
  
  console.log('🔗 Current API Configuration:');
  console.log(`   NEXT_PUBLIC_API_URL=${currentUrl}`);
  console.log('');
  console.log('📋 Available endpoints:');
  Object.entries(API_ENDPOINTS).forEach(([name, url]) => {
    const current = currentUrl === url ? ' (current)' : '';
    console.log(`   ${name}: ${url}${current}`);
  });
}

function showHelp() {
  console.log(`
🚀 YouTube AI Chat - API Environment Switcher

Usage: node scripts/switch-api.js <command>

Commands:
  dev          Switch to development API (localhost:8001)
  prod-local   Switch to local production API (localhost:80)
  prod-public  Switch to public production API (api.youtubeai.chat)
  status       Show current API configuration
  help         Show this help message

Examples:
  node scripts/switch-api.js dev
  node scripts/switch-api.js prod-local
  node scripts/switch-api.js status

Note: You need to restart your Next.js development server after switching.
`);
}

// Main execution
const command = process.argv[2];

switch (command) {
  case 'dev':
    updateApiUrl(API_ENDPOINTS.dev);
    break;
  case 'prod-local':
    updateApiUrl(API_ENDPOINTS['prod-local']);
    break;
  case 'prod-public':
    updateApiUrl(API_ENDPOINTS['prod-public']);
    break;
  case 'status':
    showStatus();
    break;
  case 'help':
  case '-h':
  case '--help':
    showHelp();
    break;
  default:
    if (command) {
      console.error(`❌ Unknown command: ${command}`);
    }
    showHelp();
    process.exit(1);
}