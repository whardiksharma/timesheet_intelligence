/**
 * TimesheetDB: IndexedDB Local Database Wrapper with Safe Fallback
 * Manages 100% Offline Data, Mutation Queue with per-item status, and Cached Timesheets.
 * Includes automatic localStorage fallback if IndexedDB is unavailable or blocked.
 */

const DB_NAME = 'TimesheetPWA_DB';
const DB_VERSION = 2;

class TimesheetDB {
  constructor() {
    this.db = null;
    this.useFallback = false;
    this.memoryQueue = [];
    this.memoryCachedTimesheets = [];
    this.memoryMetadata = null;
  }

  async init() {
    if (this.db) return this.db;
    if (this.useFallback) return null;

    return new Promise((resolve) => {
      try {
        if (!window.indexedDB) {
          console.warn('IndexedDB not supported, using fallback storage');
          this.useFallback = true;
          return resolve(null);
        }

        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
          try {
            const db = event.target.result;

            // 1. Metadata Store (Projects, Tasks, Activities, Employees)
            if (!db.objectStoreNames.contains('metadata')) {
              db.createObjectStore('metadata', { keyPath: 'key' });
            }

            // 2. Offline Mutation Queue
            if (!db.objectStoreNames.contains('offline_queue')) {
              const queueStore = db.createObjectStore('offline_queue', { keyPath: 'client_uuid' });
              queueStore.createIndex('timestamp', 'timestamp', { unique: false });
              queueStore.createIndex('status', 'status', { unique: false });
            }

            // 3. Cached Timesheets
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
          console.warn('IndexedDB open failed, falling back to localStorage:', event?.target?.error);
          this.useFallback = true;
          resolve(null);
        };

        request.onblocked = () => {
          console.warn('IndexedDB open blocked, using fallback');
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

  // --- Metadata Caching ---
  async saveMetadata(bundle) {
    try {
      const db = await this.init();
      if (!db || this.useFallback) {
        localStorage.setItem('timesheet_cached_metadata', JSON.stringify(bundle));
        this.memoryMetadata = bundle;
        return true;
      }
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(['metadata'], 'readwrite');
          const store = tx.objectStore('metadata');
          store.put({ key: 'offline_bundle', data: bundle, updated_at: new Date().toISOString() });
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

  async getMetadata() {
    try {
      const db = await this.init();
      if (!db || this.useFallback) {
        if (this.memoryMetadata) return this.memoryMetadata;
        const raw = localStorage.getItem('timesheet_cached_metadata');
        return raw ? JSON.parse(raw) : null;
      }
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(['metadata'], 'readonly');
          const store = tx.objectStore('metadata');
          const request = store.get('offline_bundle');
          request.onsuccess = () => resolve(request.result ? request.result.data : null);
          request.onerror = () => resolve(null);
        } catch (e) {
          resolve(null);
        }
      });
    } catch (e) {
      return null;
    }
  }

  // --- Offline Queue ---
  async addToQueue(item) {
    if (!item.client_uuid) {
      item.client_uuid = 'uuid_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
    }
    item.timestamp = item.timestamp || new Date().toISOString();
    item.sync_status = item.sync_status || 'pending';
    item.error_message = item.error_message || null;
    item.retry_count = item.retry_count || 0;

    try {
      const db = await this.init();
      if (!db || this.useFallback) {
        const queue = await this.getQueue();
        queue.push(item);
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

  async updateQueueItem(item) {
    try {
      const db = await this.init();
      if (!db || this.useFallback) {
        let queue = await this.getQueue();
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

  async deleteQueueItem(clientUuid) {
    try {
      const db = await this.init();
      if (!db || this.useFallback) {
        let queue = await this.getQueue();
        queue = queue.filter((q) => q.client_uuid !== clientUuid);
        localStorage.setItem('timesheet_offline_queue', JSON.stringify(queue));
        return true;
      }
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(['offline_queue'], 'readwrite');
          const store = tx.objectStore('offline_queue');
          store.delete(clientUuid);
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

  async getQueue() {
    try {
      const db = await this.init();
      if (!db || this.useFallback) {
        const raw = localStorage.getItem('timesheet_offline_queue');
        return raw ? JSON.parse(raw) : [];
      }
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(['offline_queue'], 'readonly');
          const store = tx.objectStore('offline_queue');
          const request = store.getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => resolve([]);
        } catch (e) {
          resolve([]);
        }
      });
    } catch (e) {
      return [];
    }
  }

  async removeQueueItems(clientUuids) {
    try {
      const db = await this.init();
      if (!db || this.useFallback) {
        let queue = await this.getQueue();
        const uuidSet = new Set(clientUuids);
        queue = queue.filter((q) => !uuidSet.has(q.client_uuid));
        localStorage.setItem('timesheet_offline_queue', JSON.stringify(queue));
        return true;
      }
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(['offline_queue'], 'readwrite');
          const store = tx.objectStore('offline_queue');
          clientUuids.forEach((uuid) => store.delete(uuid));
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

  async getQueueCounts() {
    try {
      const queue = await this.getQueue();
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

  // --- Local Timesheets Cache ---
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
      const db = await this.init();
      if (db && !this.useFallback) {
        return new Promise((resolve) => {
          try {
            const tx = db.transaction(['cached_timesheets', 'offline_queue'], 'readwrite');
            tx.objectStore('cached_timesheets').clear();
            tx.objectStore('offline_queue').clear();
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
