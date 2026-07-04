import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

export interface RateLimitState {
  monthCount: number;
  monthStart: string;
  lastRequestTimestamp: number;
  lastFlush: number;
}

const DEFAULT_REQUEST_DELAY_MS = 1000;
const REQUEST_DELAY_MS = parseInt(process.env.RATE_LIMIT_REQUEST_DELAY_MS || '', 10) || DEFAULT_REQUEST_DELAY_MS;

let state: RateLimitState = {
  monthCount: 0,
  monthStart: new Date().toISOString(),
  lastRequestTimestamp: 0,
  lastFlush: Date.now()
};

let flushTimer: NodeJS.Timeout | null = null;
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_STATE_FILE = path.join(MODULE_DIR, '..', '.rate-limit-state.json');
const STATE_FILE = process.env.RATE_LIMIT_STATE_FILE || DEFAULT_STATE_FILE;
const TMP_FILE = STATE_FILE + '.tmp';

export function loadState(): RateLimitState {
  try {
    const statePath = path.resolve(STATE_FILE);
    if (fs.existsSync(statePath)) {
      const data = fs.readFileSync(statePath, 'utf-8');
      const parsed = JSON.parse(data) as RateLimitState;
      
      // Check if we're in a new calendar month
      const monthStart = new Date(parsed.monthStart);
      const now = new Date();
      if (monthStart.getMonth() !== now.getMonth() || 
          monthStart.getFullYear() !== now.getFullYear()) {
        // New month, reset counter
        state = {
          monthCount: 0,
          monthStart: now.toISOString(),
          lastRequestTimestamp: parsed.lastRequestTimestamp || 0,
          lastFlush: Date.now()
        };
      } else {
        state = parsed;
      }
    }
  } catch (error) {
    // File is corrupt or unreadable, start fresh
    console.error('Warning: Could not load rate limit state, starting fresh:', error);
    state = {
      monthCount: 0,
      monthStart: new Date().toISOString(),
      lastRequestTimestamp: 0,
      lastFlush: Date.now()
    };
  }
  
  return state;
}

export function increment(): void {
  state.monthCount++;
  state.lastRequestTimestamp = Date.now();
}

export function recordSuccess(): void {
  state.lastRequestTimestamp = Date.now();
}

export function getMonthCount(): number {
  return state.monthCount;
}

export function getRemainingQuota(limit: number = 1000): number {
  return Math.max(0, limit - state.monthCount);
}

export function getLastRequestTimestamp(): number {
  return state.lastRequestTimestamp;
}

export function getTimeSinceLastRequest(): number {
  return Date.now() - state.lastRequestTimestamp;
}

export function getTimeUntilNextRequest(): number {
  const elapsed = getTimeSinceLastRequest();
  const remaining = REQUEST_DELAY_MS - elapsed;
  return Math.max(0, remaining);
}

export function flush(): void {
  try {
    const statePath = path.resolve(STATE_FILE);
    const tmpPath = path.resolve(TMP_FILE);
    
    const dataToWrite = JSON.stringify({
      monthCount: state.monthCount,
      monthStart: state.monthStart,
      lastRequestTimestamp: state.lastRequestTimestamp,
      lastFlush: Date.now()
    }, null, 2);
    
    // Write to temp file first, then rename for atomicity
    fs.writeFileSync(tmpPath, dataToWrite, 'utf-8');
    fs.renameSync(tmpPath, statePath);
    state.lastFlush = Date.now();
  } catch (error) {
    console.error('Warning: Could not flush rate limit state:', error);
  }
}

export function startFlushTimer(intervalMs: number = 5000): void {
  if (flushTimer) {
    clearInterval(flushTimer);
  }
  flushTimer = setInterval(() => {
    flush();
  }, intervalMs);
}

export function stopFlushTimer(): void {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
}

export function resetState(newState: RateLimitState): void {
  state = newState;
}

// Initialize on module load
loadState();
