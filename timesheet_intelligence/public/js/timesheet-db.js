/**
 * TimesheetDB: IndexedDB v2 Local Storage Schema & Mutation Queue
 * Provides 100% Offline-First transaction logging, per-item status tracking,
 * server aggregate caching, and automated zero-throw localStorage fallback.
 */

const DB_NAME = 'TimesheetPWA_DB';
const DB_VERSION = 2;

class TimesheetDB {
  constructor() {
    this.db = null;
    this.useFallback = false;
    this.memoryQueue = [];
    this.memoryMetadata = {};
    this.memoryCachedTimesheets = [];
  }

  async init() {
    if (this.db) return this.db;
    if (this.useFallback) return null;

    return new Promise((resolve) => {
      try {
        if (!window.indexedDB) {
          console.warn('IndexedDB unavailable, activating fallback storage');
          this.useFallback = true;
          return resolve(null);
        }

        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
          try {
            const db = event.target.result;

            // 1. Metadata Store (keyPath: 'key')
            if (!db.objectStoreNames.contains('metadata')) {
              db.createObjectStore('metadata', { keyPath: 'key' });
            }
            if (!db.objectStoreNames.contains('cached_metadata')) {
              db.createObjectStore('cached_metadata', { keyPath: 'key' });
            }

            // 2. Offline Mutation Queue Store
            if (!db.objectStoreNames.contains('offline_queue')) {
              const queueStore = db.createObjectStore('offline_queue', { keyPath: 'id', autoIncrement: true });
              queueStore.createIndex('client_uuid', 'client_uuid', { unique: true });
              queueStore.createIndex('sync_status', 'sync_status', { unique: false });
              queueStore.createIndex('timestamp', 'timestamp', { unique: false });
            }

            // 3. Cached Timesheets Store
            if (db.objectStoreNames.contains('cached_timesheets')) {
              db.deleteObjectStore('cached_timesheets');
            }
            const timesheetsStore = db.createObjectStore('cached_timesheets', { keyPath: 'name' });
            timesheetsStore.createIndex('from_time', 'from_time', { unique: false });
          } catch (upgradeErr) {
            console.warn('IndexedDB upgrade error:', upgradeErr);
          }
        };

        request.onsuccess = (event) => {
          this.db = event.target.result;
          resolve(this.db);
        };

        request.onerror = (event) => {
          console.warn('IndexedDB open error, falling back to localStorage:', event?.target?.error);
          this.useFallback = true;
          resolve(null);
        };

        request.onblocked = () => {
          console.warn('IndexedDB open blocked, falling back to localStorage');
          this.useFallback = true;
          resolve(null);
        };
      } catch (err) {
        console.warn('IndexedDB initialization exception:', err);
        this.useFallback = true;
        resolve(null);
      }
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 1. METADATA & BASELINE AGGREGATE STORE (cached_metadata / metadata)
  // ───────────────────────────────────────────────────────────────────────────

  async setMetadata(key, value) {
    try {
      const db = await this.init();
      if (!db || this.useFallback) {
        this.memoryMetadata[key] = value;
        localStorage.setItem(`ts_meta_${key}`, JSON.stringify(value));
        return true;
      }
      return new Promise((resolve) => {
        try {
          const storeName = db.objectStoreNames.contains('cached_metadata') ? 'cached_metadata' : 'metadata';
          const tx = db.transaction([storeName], 'readwrite');
          const store = tx.objectStore(storeName);
          store.put({ key: key, data: value, updated_at: new Date().toISOString() });
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => {
            // Local fallback
            localStorage.setItem(`ts_meta_${key}`, JSON.stringify(value));
            resolve(true);
          };
        } catch (e) {
          localStorage.setItem(`ts_meta_${key}`, JSON.stringify(value));
          resolve(true);
        }
      });
    } catch (e) {
      localStorage.setItem(`ts_meta_${key}`, JSON.stringify(value));
      return true;
    }
  }

  async getMetadata(key) {
    try {
      const db = await this.init();
      if (!db || this.useFallback) {
        if (this.memoryMetadata[key] !== undefined) return this.memoryMetadata[key];
        const raw = localStorage.getItem(`ts_meta_${key}`);
        return raw ? JSON.parse(raw) : null;
      }
      return new Promise((resolve) => {
        try {
          const storeName = db.objectStoreNames.contains('cached_metadata') ? 'cached_metadata' : 'metadata';
          const tx = db.transaction([storeName], 'readonly');
          const store = tx.objectStore(storeName);
          const request = store.get(key);
          request.onsuccess = () => {
            if (request.result && request.result.data !== undefined) {
              resolve(request.result.data);
            } else {
              const raw = localStorage.getItem(`ts_meta_${key}`);
              resolve(raw ? JSON.parse(raw) : null);
            }
          };
          request.onerror = () => {
            const raw = localStorage.getItem(`ts_meta_${key}`);
            resolve(raw ? JSON.parse(raw) : null);
          };
        } catch (e) {
          const raw = localStorage.getItem(`ts_meta_${key}`);
          resolve(raw ? JSON.parse(raw) : null);
        }
      });
    } catch (e) {
      const raw = localStorage.getItem(`ts_meta_${key}`);
      return raw ? JSON.parse(raw) : null;
    }
  }

  // Convenience aliases for backward compatibility
  async saveMetadata(bundle) {
    return await this.setMetadata('offline_bundle', bundle);
  }

  async saveCachedAggregates(aggregates) {
    return await this.setMetadata('server_metrics', aggregates);
  }

  async getCachedAggregates() {
    return await this.getMetadata('server_metrics');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 2. OFFLINE MUTATION QUEUE (offline_queue)
  // ───────────────────────────────────────────────────────────────────────────

  async addToQueue(item) {
    if (!item.client_uuid) {
      item.client_uuid = 'uuid_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
    }
    item.timestamp = item.timestamp || Date.now();
    item.sync_status = item.sync_status || 'pending'; // 'pending' | 'syncing' | 'failed'
    item.error_message = item.error_message || null;
    item.retry_count = Number(item.retry_count || 0);

    const durMins = parseFloat(item.duration_minutes || 0);
    if (!item.total_hours && durMins > 0) {
      item.total_hours = Number((durMins / 60.0).toFixed(2));
    }

    try {
      const db = await this.init();
      if (!db || this.useFallback) {
        const queue = await this.getAllQueueItems();
        queue.push(item);
        localStorage.setItem('timesheet_offline_queue', JSON.stringify(queue));
        return item;
      }
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(['offline_queue'], 'readwrite');
          const store = tx.objectStore('offline_queue');
          const req = store.put(item);
          tx.oncomplete = () => resolve(item);
          tx.onerror = () => {
            // Fallback
            const queue = this._getLocalStorageQueue();
            queue.push(item);
            localStorage.setItem('timesheet_offline_queue', JSON.stringify(queue));
            resolve(item);
          };
        } catch (e) {
          const queue = this._getLocalStorageQueue();
          queue.push(item);
          localStorage.setItem('timesheet_offline_queue', JSON.stringify(queue));
          resolve(item);
        }
      });
    } catch (e) {
      return item;
    }
  }

  async getAllQueueItems() {
    try {
      const db = await this.init();
      if (!db || this.useFallback) {
        return this._getLocalStorageQueue();
      }
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(['offline_queue'], 'readonly');
          const store = tx.objectStore('offline_queue');
          const request = store.getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => resolve(this._getLocalStorageQueue());
        } catch (e) {
          resolve(this._getLocalStorageQueue());
        }
      });
    } catch (e) {
      return this._getLocalStorageQueue();
    }
  }

  // Alias for backward compatibility
  async getQueue() {
    return await this.getAllQueueItems();
  }

  async getPendingQueueItems() {
    const all = await this.getAllQueueItems();
    return all.filter((item) => item.sync_status !== 'failed');
  }

  async getFailedQueueItems() {
    const all = await this.getAllQueueItems();
    return all.filter((item) => item.sync_status === 'failed');
  }

  async updateQueueItemStatus(clientUuid, status, errorMessage = null) {
    try {
      const db = await this.init();
      if (!db || this.useFallback) {
        let queue = this._getLocalStorageQueue();
        queue = queue.map((q) => {
          if (q.client_uuid === clientUuid) {
            q.sync_status = status;
            q.error_message = errorMessage;
            if (status === 'pending') q.retry_count = (q.retry_count || 0) + 1;
          }
          return q;
        });
        localStorage.setItem('timesheet_offline_queue', JSON.stringify(queue));
        return true;
      }
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(['offline_queue'], 'readwrite');
          const store = tx.objectStore('offline_queue');
          const req = store.getAll();
          req.onsuccess = () => {
            const items = req.result || [];
            const item = items.find((q) => q.client_uuid === clientUuid);
            if (item) {
              item.sync_status = status;
              item.error_message = errorMessage;
              if (status === 'pending') item.retry_count = (item.retry_count || 0) + 1;
              store.put(item);
            }
            tx.oncomplete = () => resolve(true);
          };
          req.onerror = () => resolve(false);
        } catch (e) {
          resolve(false);
        }
      });
    } catch (e) {
      return false;
    }
  }

  async updateQueueItem(item) {
    try {
      const db = await this.init();
      if (!db || this.useFallback) {
        let queue = this._getLocalStorageQueue();
        queue = queue.map((q) => (q.client_uuid === item.client_uuid ? item : q));
        localStorage.setItem('timesheet_offline_queue', JSON.stringify(queue));
        return item;
      }
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(['offline_queue'], 'readwrite');
          const store = tx.objectStore('offline_queue');
          store.put(item);
          tx.oncomplete = () => resolve(item);
          tx.onerror = () => resolve(item);
        } catch (e) {
          resolve(item);
        }
      });
    } catch (e) {
      return item;
    }
  }

  async removeQueueItem(clientUuid) {
    try {
      const db = await this.init();
      if (!db || this.useFallback) {
        let queue = this._getLocalStorageQueue();
        queue = queue.filter((q) => q.client_uuid !== clientUuid);
        localStorage.setItem('timesheet_offline_queue', JSON.stringify(queue));
        return true;
      }
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(['offline_queue'], 'readwrite');
          const store = tx.objectStore('offline_queue');
          // If keyPath is client_uuid, delete directly; otherwise find and delete by id
          const req = store.getAll();
          req.onsuccess = () => {
            const items = req.result || [];
            const match = items.find((q) => q.client_uuid === clientUuid);
            if (match && match.id !== undefined) {
              store.delete(match.id);
            } else {
              store.delete(clientUuid);
            }
            tx.oncomplete = () => resolve(true);
          };
          req.onerror = () => resolve(false);
        } catch (e) {
          resolve(false);
        }
      });
    } catch (e) {
      return false;
    }
  }

  // Alias
  async deleteQueueItem(clientUuid) {
    return await this.removeQueueItem(clientUuid);
  }

  async removeQueueItems(clientUuids) {
    if (!clientUuids || clientUuids.length === 0) return true;
    for (const uuid of clientUuids) {
      await this.removeQueueItem(uuid);
    }
    return true;
  }

  async getQueueCounts() {
    try {
      const queue = await this.getAllQueueItems();
      const total = queue.length;
      let failed = 0;
      let pending = 0;
      let syncing = 0;

      queue.forEach((q) => {
        if (q.sync_status === 'failed') failed++;
        else if (q.sync_status === 'syncing') syncing++;
        else pending++;
      });

      return { total, pending, failed, syncing };
    } catch (e) {
      return { total: 0, pending: 0, failed: 0, syncing: 0 };
    }
  }

  async getQueueCount() {
    const counts = await this.getQueueCounts();
    return counts.total;
  }

  _getLocalStorageQueue() {
    try {
      const raw = localStorage.getItem('timesheet_offline_queue');
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 3. CACHED TIMESHEETS (cached_timesheets)
  // ───────────────────────────────────────────────────────────────────────────

  async cacheTimesheets(logs) {
    try {
      const db = await this.init();
      if (!db || this.useFallback) {
        localStorage.setItem('timesheet_cached_logs', JSON.stringify(logs));
        return true;
      }
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(['cached_timesheets'], 'readwrite');
          const store = tx.objectStore('cached_timesheets');
          store.clear();
          logs.forEach((log) => {
            if (!log.name) log.name = log.client_uuid || 'TS_' + Date.now();
            store.put(log);
          });
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
        } catch (e) {
          resolve(false);
        }
      });
    } catch (e) {
      return false;
    }
  }

  async getCachedTimesheets() {
    try {
      const db = await this.init();
      if (!db || this.useFallback) {
        const raw = localStorage.getItem('timesheet_cached_logs');
        const list = raw ? JSON.parse(raw) : [];
        return list.sort((a, b) => new Date(b.from_time || b.creation || 0) - new Date(a.from_time || a.creation || 0));
      }
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(['cached_timesheets'], 'readonly');
          const store = tx.objectStore('cached_timesheets');
          const request = store.getAll();
          request.onsuccess = () => {
            const sorted = (request.result || []).sort((a, b) => {
              return new Date(b.from_time || b.creation || 0) - new Date(a.from_time || a.creation || 0);
            });
            resolve(sorted);
          };
          request.onerror = () => resolve([]);
        } catch (e) {
          resolve([]);
        }
      });
    } catch (e) {
      return [];
    }
  }

  async clearCachedTimesheets() {
    try {
      const db = await this.init();
      if (!db || this.useFallback) {
        localStorage.removeItem('timesheet_cached_logs');
        return true;
      }
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(['cached_timesheets'], 'readwrite');
          tx.objectStore('cached_timesheets').clear();
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
        } catch (e) {
          resolve(false);
        }
      });
    } catch (e) {
      return false;
    }
  }

  async clearAllUserData() {
    try {
      localStorage.removeItem('timesheet_cached_logs');
      localStorage.removeItem('timesheet_offline_queue');
      localStorage.removeItem('timesheet_cached_metadata');
      localStorage.removeItem('ts_meta_server_metrics');
      localStorage.removeItem('ts_meta_offline_bundle');
      localStorage.removeItem('ts_meta_user_profile');
      const db = await this.init();
      if (db && !this.useFallback) {
        return new Promise((resolve) => {
          try {
            const tx = db.transaction(['cached_timesheets', 'offline_queue', 'metadata'], 'readwrite');
            tx.objectStore('cached_timesheets').clear();
            tx.objectStore('offline_queue').clear();
            tx.objectStore('metadata').clear();
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => resolve(false);
          } catch (e) {
            resolve(false);
          }
        });
      }
      return true;
    } catch (e) {
      return false;
    }
  }
}

window.TimesheetDB = new TimesheetDB();
