#!/usr/bin/env node
/**
 * Buffer Dashboard — session health monitor
 * Shows context usage, session state, boot payload, and Buffer zones.
 * Usage: node context-monitor-server.mjs [port]
 * Default port: 8111
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, readdirSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';

const PORT = parseInt(process.argv[2]) || 8111;
const __dir = dirname(fileURLToPath(import.meta.url));
const SESSIONS_FILE = join(homedir(), '.openclaw/agents/main/sessions/sessions.json');
const HTML_FILE = join(__dir, 'buffer-dashboard.html');
const WORKSPACE = join(homedir(), '.openclaw/workspace');

const WORKSPACE_KEY = 'agent:main:discord:channel:1470820351674945606';

function getLatestUsageFromJSONL(sessionId) {
  const jsonlPath = join(homedir(), `.openclaw/agents/main/sessions/${sessionId}.jsonl`);
  if (!existsSync(jsonlPath)) return null;

  try {
    const tail = execSync(`tail -20 "${jsonlPath}"`, { encoding: 'utf8', timeout: 3000 });
    const lines = tail.trim().split('\n').reverse();

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        const usage = findUsage(entry);
        if (usage) {
          const context = (usage.input || 0) + (usage.cacheRead || 0) + (usage.cacheWrite || 0);
          return { context, input: usage.input, cacheRead: usage.cacheRead, cacheWrite: usage.cacheWrite, output: usage.output };
        }
      } catch { continue; }
    }
  } catch { /* ignore */ }
  return null;
}

function findUsage(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (obj.usage && typeof obj.usage === 'object' && ('input' in obj.usage || 'cacheRead' in obj.usage)) return obj.usage;
  for (const v of Object.values(obj)) {
    if (typeof v === 'object') {
      const r = findUsage(v);
      if (r) return r;
    }
  }
  return null;
}

function getLiveSession(sessionStart) {
  const path = join(WORKSPACE, 'scratch/live-session.json');
  if (!existsSync(path)) return null;
  try {
    const content = readFileSync(path, 'utf8');
    const data = JSON.parse(content);
    // Stale check: if live-session was last updated before the current session started, ignore it
    if (sessionStart && data.updatedAt) {
      const liveTime = new Date(data.updatedAt).getTime();
      const sessTime = new Date(sessionStart).getTime();
      if (liveTime < sessTime) {
        // Clean up stale file so dashboard never shows old data
        try { unlinkSync(path); } catch {}
        return null;
      }
    }
    return data;
  } catch { return null; }
}

function getHandoff() {
  const path = join(WORKSPACE, 'HANDOFF.md');
  if (!existsSync(path)) return null;
  try {
    const content = readFileSync(path, 'utf8');
    const sections = {};
    let currentSection = null;

    for (const line of content.split('\n')) {
      if (line.startsWith('## ')) {
        currentSection = line.replace('## ', '').trim();
        sections[currentSection] = [];
      } else if (currentSection && line.trim()) {
        sections[currentSection].push(line.replace(/^[-*]\s*/, '').trim());
      }
    }

    return {
      currentWork: sections['Current Work']?.[0] || null,
      stoppingPoint: sections['Stopping Point']?.[0] || null,
      nextSteps: sections['Next Steps']?.slice(0, 3) || [],
      openQuestions: (sections['Open Questions'] || []).length,
      size: Buffer.byteLength(content),
      mtime: statSync(path).mtime.toISOString()
    };
  } catch { return null; }
}

function getBootPayload() {
  const files = ['AGENTS.md', 'SOUL.md', 'USER.md', 'MEMORY.md', 'HANDOFF.md', 'IDENTITY.md'];
  const results = [];
  let total = 0;

  for (const f of files) {
    const p = join(WORKSPACE, f);
    if (existsSync(p)) {
      const size = statSync(p).size;
      total += size;
      const limits = { 'AGENTS.md': 4000, 'MEMORY.md': 1500, 'HANDOFF.md': 2000 };
      results.push({ name: f, size, limit: limits[f] || 1500, over: limits[f] ? size > limits[f] : false });
    }
  }

  // Count memory files
  const memDir = join(WORKSPACE, 'memory');
  let memCount = 0;
  let memSize = 0;
  if (existsSync(memDir)) {
    const memFiles = readdirSync(memDir).filter(f => f.endsWith('.md'));
    memCount = memFiles.length;
    for (const f of memFiles) {
      try { memSize += statSync(join(memDir, f)).size; } catch {}
    }
  }

  // Count skills
  let skillCount = 0;
  const skillDirs = [
    join(WORKSPACE, 'skills'),
    '/opt/homebrew/lib/node_modules/openclaw/skills'
  ];
  for (const d of skillDirs) {
    if (existsSync(d)) {
      try { skillCount += readdirSync(d).filter(f => !f.startsWith('.')).length; } catch {}
    }
  }

  return { files: results, total, memoryFiles: memCount, memorySize: memSize, skills: skillCount };
}

function getSessionAge(sessionId) {
  const jsonlPath = join(homedir(), `.openclaw/agents/main/sessions/${sessionId}.jsonl`);
  if (!existsSync(jsonlPath)) return null;
  try {
    const head = execSync(`head -1 "${jsonlPath}"`, { encoding: 'utf8', timeout: 3000 });
    const entry = JSON.parse(head.trim());
    if (entry.timestamp) return entry.timestamp;
    if (entry.ts) return entry.ts;
    // Fallback to file creation time
    return statSync(jsonlPath).birthtime.toISOString();
  } catch {
    try { return statSync(jsonlPath).birthtime.toISOString(); } catch { return null; }
  }
}

function getSessionData() {
  const sessions = JSON.parse(readFileSync(SESSIONS_FILE, 'utf8'));
  const ws = sessions[WORKSPACE_KEY];
  if (!ws) return { error: 'Workspace session not found' };

  const usage = getLatestUsageFromJSONL(ws.sessionId);
  const sessionStart = getSessionAge(ws.sessionId);
  const live = getLiveSession(sessionStart);
  const handoff = getHandoff();
  const boot = getBootPayload();
  const contextWindow = ws.contextTokens || 1000000;

  const velocity = usage ? updateVelocity(usage.context) : 0;
  const wrapThreshold = contextWindow * 0.5;
  const tokensToWrap = usage ? wrapThreshold - usage.context : null;
  const minutesToWrap = (velocity > 100 && tokensToWrap > 0) ? Math.round(tokensToWrap / velocity) : null;

  return {
    label: ws.label || ws.displayName || 'Workspace',
    model: ws.model || 'unknown',
    contextWindow,
    updatedAt: ws.updatedAt,
    sessionStart,
    contextUsed: usage ? usage.context : null,
    contextSource: usage ? 'jsonl' : 'unavailable',
    usage,
    handoff,
    live,
    boot,
    velocity: Math.round(velocity),
    minutesToWrap
  };
}

// Track velocity across polls
let lastUsage = null;
let lastUsageTime = null;
let velocityPerMin = 0;

function updateVelocity(currentUsage) {
  const now = Date.now();
  if (lastUsage !== null && lastUsageTime !== null) {
    const elapsed = (now - lastUsageTime) / 60000; // minutes
    if (elapsed > 0.1) { // at least 6 seconds between samples
      const delta = currentUsage - lastUsage;
      const instantVelocity = delta / elapsed;
      // Smooth with exponential moving average
      velocityPerMin = velocityPerMin === 0 ? instantVelocity : velocityPerMin * 0.7 + instantVelocity * 0.3;
    }
  }
  lastUsage = currentUsage;
  lastUsageTime = now;
  return velocityPerMin;
}

const server = createServer((req, res) => {
  if (req.url === '/api/handoff') {
    try {
      const handoffPath = join(WORKSPACE, 'HANDOFF.md');
      if (!existsSync(handoffPath)) {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ content: 'No HANDOFF.md file found.' }));
        return;
      }
      const content = readFileSync(handoffPath, 'utf8');
      const mtime = statSync(handoffPath).mtime.toISOString();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ content, mtime }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
  } else if (req.url === '/api/context') {
    try {
      const data = getSessionData();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache, no-store' });
      res.end(JSON.stringify(data));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
  } else {
    const html = readFileSync(HTML_FILE, 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Buffer Dashboard on http://127.0.0.1:${PORT}`);
  console.log(`Use Tailscale Serve to expose externally.`);
});
