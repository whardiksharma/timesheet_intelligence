/**
 * TimesheetSync: AppSheet-Style Unified Sync Engine
 * Consolidates Sync and Queue into a single dynamic widget with per-item error handling and conditional discard.
 */

class TimesheetSync {
  constructor() {
    this.isOnline = navigator.onLine;
    this.isSyncing = false;
    this.onStatusChangeCallbacks = [];
    this.onDataSyncedCallbacks = [];

    this.initListeners();
  }

  initListeners() {
    window.addEventListener('online', () => {
      this.isOnline = true;
      this.notifyStatusChange('reconnected');
      this.drainQueue();
    });

    window.addEventListener('offline', () => {
      this.isOnline = false;
      this.notifyStatusChange('offline');
      this.updateSyncBadgeUI();
    });

    // Listen to messages from Service Worker background sync
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'TRIGGER_BACKGROUND_SYNC') {
          this.drainQueue();
        }
      });
    }
  }

  onStatusChange(callback) {
    this.onStatusChangeCallbacks.push(callback);
  }

  onDataSynced(callback) {
    this.onDataSyncedCallbacks.push(callback);
  }

  notifyStatusChange(state) {
    this.onStatusChangeCallbacks.forEach((cb) => cb(state, this));
  }

  // Fetch complete bundle and cache in IndexedDB
  async refreshMetadataBundle() {
    if (!navigator.onLine) {
      return await window.TimesheetDB.getMetadata();
    }

    try {
      const response = await fetch('/api/method/timesheet_intelligence.api.get_offline_bundle');
      if (response.ok) {
        const data = await response.json();
        const bundle = data.message || data;
        await window.TimesheetDB.saveMetadata(bundle);
        return bundle;
      }
    } catch (err) {
      console.warn('Network error fetching metadata, falling back to local cache:', err);
    }
    return await window.TimesheetDB.getMetadata();
  }

  // Push all pending offline mutations to Frappe
  async drainQueue() {
    if (this.isSyncing || !navigator.onLine) {
      await this.updateSyncBadgeUI();
      return;
    }

    const queue = await window.TimesheetDB.getQueue();
    if (!queue || queue.length === 0) {
      this.notifyStatusChange('synced');
      await this.updateSyncBadgeUI();
      return;
    }

    this.isSyncing = true;
    await this.updateSyncBadgeUI();
    this.notifyStatusChange('syncing');

    try {
      const response = await fetch('/api/method/timesheet_intelligence.api.sync_offline_queue', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Frappe-CSRF-Token': window.csrf_token || ''
        },
        body: JSON.stringify({ queue: queue })
      });

      if (response.ok) {
        const result = await response.json();
        const message = result.message || result;
        const processedIds = message.processed_ids || queue.map((q) => q.client_uuid);

        // Remove synced items from local queue
        await window.TimesheetDB.removeQueueItems(processedIds);

        // Refresh recent logs
        await this.fetchLatestTimesheets();

        this.notifyStatusChange('synced');
        this.onDataSyncedCallbacks.forEach((cb) => cb(processedIds.length));
      } else {
        const errJson = await response.json().catch(() => ({}));
        const errMsg = errJson._server_messages || errJson.exc || `Server rejected request (${response.status})`;
        console.warn('Sync rejected with error:', errMsg);

        // Mark items as failed
        for (const item of queue) {
          item.sync_status = 'failed';
          item.error_message = typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg);
          await window.TimesheetDB.updateQueueItem(item);
        }
        this.notifyStatusChange('error');
      }
    } catch (err) {
      console.error('Failed to drain sync queue:', err);
      this.notifyStatusChange('offline');
    } finally {
      this.isSyncing = false;
      await this.updateSyncBadgeUI();
    }
  }

  // Discard stuck item from IndexedDB queue
  async discardQueueItem(clientUuid) {
    await window.TimesheetDB.deleteQueueItem(clientUuid);
    await this.updateSyncBadgeUI();
    this.notifyStatusChange('item_discarded');
    return true;
  }

  // Retry stuck item
  async retryQueueItem(clientUuid) {
    const queue = await window.TimesheetDB.getQueue();
    const item = queue.find((q) => q.client_uuid === clientUuid);
    if (item) {
      item.sync_status = 'pending';
      item.error_message = null;
      item.retry_count = (item.retry_count || 0) + 1;
      await window.TimesheetDB.updateQueueItem(item);
      await this.updateSyncBadgeUI();
      await this.drainQueue();
    }
  }

  // Fetch recent timesheets
  async fetchLatestTimesheets() {
    if (!navigator.onLine) {
      return await window.TimesheetDB.getCachedTimesheets();
    }

    try {
      const response = await fetch('/api/method/timesheet_intelligence.api.get_my_timesheets?limit=30');
      if (response.ok) {
        const data = await response.json();
        const logs = (data.message && data.message.logs) || [];
        await window.TimesheetDB.cacheTimesheets(logs);
        return logs;
      }
    } catch (e) {
      console.warn('Using cached timesheets due to network error:', e);
    }
    return await window.TimesheetDB.getCachedTimesheets();
  }

  // Update AppSheet-Style Unified Widget in DOM
  async updateSyncBadgeUI() {
    const widget = document.getElementById('appsheet-sync-widget');
    const iconEl = document.getElementById('sync-widget-icon');
    const textEl = document.getElementById('sync-widget-text');
    const countEl = document.getElementById('sync-widget-count');
    if (!widget) return;

    const counts = await window.TimesheetDB.getQueueCounts();

    // 1. STATE D: Sync Error / Stuck Items (Highest Priority)
    if (counts.failed > 0) {
      widget.className = 'appsheet-sync-pill failed';
      widget.setAttribute('title', `${counts.failed} change${counts.failed > 1 ? 's' : ''} failed to sync. Tap to review.`);
      widget.setAttribute('aria-label', `Sync Warning: ${counts.failed} items failed to save.`);
      if (iconEl) iconEl.textContent = '⚠️';
      if (textEl) textEl.textContent = `${counts.failed} Stuck`;
      if (countEl) {
        countEl.style.display = 'inline-block';
        countEl.textContent = counts.failed;
      }
      return;
    }

    // 2. STATE C: Syncing Active
    if (this.isSyncing) {
      widget.className = 'appsheet-sync-pill syncing';
      widget.setAttribute('title', 'Syncing changes with server...');
      widget.setAttribute('aria-label', 'Sync in progress');
      if (iconEl) iconEl.textContent = '🔄';
      if (textEl) textEl.textContent = 'Syncing...';
      if (countEl) countEl.style.display = 'none';
      return;
    }

    // 3. STATE B: Pending Queue (Unsaved Local Changes)
    if (counts.total > 0) {
      widget.className = 'appsheet-sync-pill pending';
      widget.setAttribute('title', `${counts.total} unsaved change${counts.total > 1 ? 's' : ''} queued. Tap to view.`);
      widget.setAttribute('aria-label', `${counts.total} items queued for sync.`);
      if (iconEl) iconEl.textContent = '🔄';
      if (textEl) textEl.textContent = 'Queued';
      if (countEl) {
        countEl.style.display = 'inline-block';
        countEl.textContent = counts.total;
      }
      return;
    }

    // 4. STATE A: Idle & Clean (All Synced)
    widget.className = 'appsheet-sync-pill synced';
    widget.setAttribute('title', 'All changes saved to server');
    widget.setAttribute('aria-label', 'All changes synced with cloud');
    if (iconEl) iconEl.textContent = '✓';
    if (textEl) textEl.textContent = 'Synced';
    if (countEl) countEl.style.display = 'none';
  }
}

window.TimesheetSync = new TimesheetSync();
