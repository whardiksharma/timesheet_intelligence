/**
 * TimesheetDB: IndexedDB Local Database Wrapper
 * Manages 100% Offline Data, Mutation Queue with per-item status, and Cached Timesheets.
 */

const DB_NAME = 'TimesheetPWA_DB';
const DB_VERSION = 2;

class TimesheetDB {
  constructor() {
    this.db = null;
  }

  async init() {
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
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
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };

      request.onerror = (event) => {
        console.error('IndexedDB init error:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  // --- Metadata Caching ---
  async saveMetadata(bundle) {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['metadata'], 'readwrite');
      const store = tx.objectStore('metadata');
      store.put({ key: 'offline_bundle', data: bundle, updated_at: new Date().toISOString() });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  async getMetadata() {
    const db = await this.init();
    return new Promise((resolve) => {
      const tx = db.transaction(['metadata'], 'readonly');
      const store = tx.objectStore('metadata');
      const request = store.get('offline_bundle');
      request.onsuccess = () => {
        resolve(request.result ? request.result.data : null);
      };
      request.onerror = () => resolve(null);
    });
  }

  // --- Offline Queue ---
  async addToQueue(item) {
    const db = await this.init();
    if (!item.client_uuid) {
      item.client_uuid = 'uuid_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
    }
    item.timestamp = item.timestamp || new Date().toISOString();
    item.sync_status = item.sync_status || 'pending'; // 'pending' | 'syncing' | 'failed'
    item.error_message = item.error_message || null;
    item.retry_count = item.retry_count || 0;

    return new Promise((resolve, reject) => {
      const tx = db.transaction(['offline_queue'], 'readwrite');
      const store = tx.objectStore('offline_queue');
      store.put(item);
      tx.oncomplete = () => resolve(item);
      tx.onerror = () => reject(tx.error);
    });
  }

  async updateQueueItem(item) {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['offline_queue'], 'readwrite');
      const store = tx.objectStore('offline_queue');
      store.put(item);
      tx.oncomplete = () => resolve(item);
      tx.onerror = () => reject(tx.error);
    });
  }

  async deleteQueueItem(clientUuid) {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['offline_queue'], 'readwrite');
      const store = tx.objectStore('offline_queue');
      store.delete(clientUuid);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  async getQueue() {
    const db = await this.init();
    return new Promise((resolve) => {
      const tx = db.transaction(['offline_queue'], 'readonly');
      const store = tx.objectStore('offline_queue');
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => resolve([]);
    });
  }

  async removeQueueItems(clientUuids) {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['offline_queue'], 'readwrite');
      const store = tx.objectStore('offline_queue');
      clientUuids.forEach((uuid) => store.delete(uuid));
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  async getQueueCounts() {
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
  }

  async getQueueCount() {
    const counts = await this.getQueueCounts();
    return counts.total;
  }

  // --- Local Timesheets Cache ---
  async cacheTimesheets(logs) {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['cached_timesheets'], 'readwrite');
      const store = tx.objectStore('cached_timesheets');
      store.clear();
      logs.forEach((log) => {
        if (!log.name) log.name = log.client_uuid || 'TS_' + Date.now();
        store.put(log);
      });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  async getCachedTimesheets() {
    const db = await this.init();
    return new Promise((resolve) => {
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
    });
  }

  async clearCachedTimesheets() {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['cached_timesheets'], 'readwrite');
      tx.objectStore('cached_timesheets').clear();
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  async clearAllUserData() {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['cached_timesheets', 'offline_queue'], 'readwrite');
      tx.objectStore('cached_timesheets').clear();
      tx.objectStore('offline_queue').clear();
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }
}

window.TimesheetDB = new TimesheetDB();
