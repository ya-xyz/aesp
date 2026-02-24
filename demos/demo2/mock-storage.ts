/**
 * AESP Demo — In-Memory Storage Adapter
 *
 * Browser-compatible mock storage for demo purposes.
 * Identical to tests/helpers.ts MockStorage.
 */

import type { StorageAdapter } from '../src/types/common.js';

export class MockStorage implements StorageAdapter {
  private store: Map<string, unknown> = new Map();

  async get<T>(key: string): Promise<T | null> {
    return (this.store.get(key) as T) ?? null;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async keys(prefix?: string): Promise<string[]> {
    const allKeys = Array.from(this.store.keys());
    if (prefix) {
      return allKeys.filter((k) => k.startsWith(prefix));
    }
    return allKeys;
  }

  clear(): void {
    this.store.clear();
  }
}
