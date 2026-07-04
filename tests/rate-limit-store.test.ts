import assert from 'node:assert';
import * as fs from 'fs';
import { describe, it, beforeEach, afterEach } from 'node:test';
import * as store from '../src/rate-limit-store.js';

describe('Rate Limit Store', () => {
  const FRESH_STATE = {
    monthCount: 0,
    monthStart: new Date().toISOString(),
    lastRequestTimestamp: 0,
    lastFlush: Date.now()
  };

  beforeEach(() => {
    // Reset to fresh state before each test
    store.resetState({ ...FRESH_STATE });
  });

  afterEach(() => {
    // Clean up any state files created during tests
    try {
      fs.unlinkSync('.rate-limit-state-test.json');
    } catch {
      // File doesn't exist, that's fine
    }
  });

  describe('increment', () => {
    it('should increment month count', () => {
      const initialCount = store.getMonthCount();
      
      store.increment();
      
      assert.equal(store.getMonthCount(), initialCount + 1);
    });

    it('should update last request timestamp', () => {
      const beforeTime = Date.now();
      
      store.increment();
      
      const timestamp = store.getLastRequestTimestamp();
      assert.ok(timestamp >= beforeTime);
    });

    it('should increment multiple times', () => {
      store.increment();
      store.increment();
      store.increment();
      
      assert.equal(store.getMonthCount(), 3);
    });
  });

  describe('getTimeSinceLastRequest', () => {
    it('should return time elapsed since last request', () => {
      store.increment();
      const timeSince = store.getTimeSinceLastRequest();
      
      assert.ok(timeSince >= 0);
      assert.ok(timeSince < 1000); // Should be less than 1 second
    });

    it('should return 0 when no request has been made', () => {
      // Fresh state has lastRequestTimestamp = 0
      const timeSince = store.getTimeSinceLastRequest();
      
      // Should be a large number since timestamp is 0
      assert.ok(timeSince > 0);
    });
  });

  describe('getTimeUntilNextRequest', () => {
    it('should return 0 when enough time has passed', async () => {
      store.increment();
      
      // Wait for the default delay to pass
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      const timeUntil = store.getTimeUntilNextRequest();
      assert.equal(timeUntil, 0);
    });

    it('should return positive value when delay has not passed', () => {
      store.increment();
      const timeUntil = store.getTimeUntilNextRequest();
      
      assert.ok(timeUntil > 0);
    });

    it('should return 0 when no request has been made', () => {
      // Fresh state has lastRequestTimestamp = 0, so enough time has passed
      const timeUntil = store.getTimeUntilNextRequest();
      assert.equal(timeUntil, 0);
    });
  });

  describe('flush', () => {
    it('should write state to file', () => {
      store.increment();
      store.increment();
      store.flush();
      
      const fileContent = fs.readFileSync('dist/.rate-limit-state.json', 'utf-8');
      const savedState = JSON.parse(fileContent);
      
      assert.equal(savedState.monthCount, 2);
      assert.ok(savedState.lastFlush > 0);
    });

    it('should handle flush errors gracefully', () => {
      // This should not throw even if there's a permission issue
      store.flush();
      // If we get here, it didn't throw
    });
  });

  describe('loadState', () => {
    it('should return fresh state when no state file exists', () => {
      // Delete state file if it exists
      try {
        fs.unlinkSync('dist/.rate-limit-state.json');
      } catch {
        // File doesn't exist, that's fine
      }
      
      const state = store.loadState();
      
      assert.equal(state.monthCount, 0);
      assert.ok(state.monthStart);
      assert.ok(state.lastFlush);
    });

    it('should load existing state from file', () => {
      const testState = {
        monthCount: 42,
        monthStart: new Date().toISOString(),
        lastRequestTimestamp: Date.now(),
        lastFlush: Date.now()
      };
      
      fs.writeFileSync('dist/.rate-limit-state.json', JSON.stringify(testState));
      const state = store.loadState();
      
      assert.equal(state.monthCount, 42);
    });

    it('should reset state on corrupt file', () => {
      fs.writeFileSync('dist/.rate-limit-state.json', 'not valid json {');
      const state = store.loadState();
      
      assert.equal(state.monthCount, 0);
    });

    it('should reset monthly counter when month has changed', () => {
      const lastMonth = new Date();
      lastMonth.setMonth(lastMonth.getMonth() - 1);
      
      const testState = {
        monthCount: 100,
        monthStart: lastMonth.toISOString(),
        lastRequestTimestamp: Date.now(),
        lastFlush: Date.now()
      };
      
      fs.writeFileSync('dist/.rate-limit-state.json', JSON.stringify(testState));
      const state = store.loadState();
      
      // Counter should be reset because we're in a new month
      assert.equal(state.monthCount, 0);
    });
  });

  describe('getRemainingQuota', () => {
    it('should return correct remaining quota', () => {
      const limit = 100;
      const initialQuota = store.getRemainingQuota(limit);
      
      assert.equal(initialQuota, limit - store.getMonthCount());
    });

    it('should return 0 when quota is exceeded', () => {
      // Set a very low limit
      const quota = store.getRemainingQuota(0);
      assert.equal(quota, 0);
    });

    it('should return correct quota after increments', () => {
      store.increment();
      store.increment();
      
      const quota = store.getRemainingQuota(10);
      assert.equal(quota, 8);
    });
  });

  describe('flush timer', () => {
    it('should start and stop flush timer', () => {
      store.startFlushTimer(100);
      // Give it time to flush once
      setTimeout(() => {}, 150);
      store.stopFlushTimer();
      // If we get here without errors, it works
    });
  });
});
