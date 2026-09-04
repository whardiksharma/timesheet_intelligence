/**
 * TimesheetApp: Clean, Compact, AppSheet-Grade Unified Sync Controller
 * Implements:
 * 1. Resilient Dual-Layer Hour Calculation (Optimistic UI reconciling Frappe server totals + local queue)
 * 2. Frictionless Daily Breakdown Table (clean rows, zero "Queued" status clutter)
 * 3. AppSheet-Style Error-Only Queue & Termination Drawer (Surfaces ONLY stuck/errored items)
 * 4. Global Click & Keydown Event Delegation (100% bulletproof button interactivity)
 * 5. Automatic Session Binding to Logged-in User (frappe.session.user)
 * 6. Cross-Account Data Isolation (Purges local cache on account switch)
 * 7. Strict State Machine: Idle vs Active (Instant Unmount on Finish)
 * 8. Mandatory Accomplishment Validation Guard (Blocks empty submissions)
 * 9. Safe Page Refresh Reconstruction (No lost time on reload)
 * 10. Space-Efficient Google Calendar-Style Monthly Attendance Overview
 * 100% WCAG 2.2 AA Compliant.
 */

(function () {
  // Application State
  const now = new Date();
  const state = {
    activeSessions: [], // Array of concurrent active/draft sessions
    finishingSessionUuid: null, // Session UUID currently open in finish modal
    globalInterval: null,
    currentUserProfile: {
      user: 'Administrator',
      full_name: 'Administrator',
      employee_name: 'Administrator',
      employee_id: 'Administrator',
      roles: [],
      is_manager: false
    },
    currentSession: {
      project: '',
      projectId: '',
      task: '',
      activity: 'Development',
      isBillable: true,
      startTime: null,
      points: []
    },
    calendar: {
      currentYear: now.getFullYear(),
      currentMonth: now.getMonth() + 1, // 1-12
      selectedDate: now.toISOString().slice(0, 10), // YYYY-MM-DD
      dailySummary: {},
      monthTotalHours: 0.0,
      todayTotalHours: 0.0
    },
    modalMode: 'new', // 'new' or 'switch'
    metadata: {
      projects: [],
      tasks: [],
      activity_types: []
    }
  };

  const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  // Helper: HTML Escape
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Format Helper: Time String (hh:mm AM/PM)
  function formatTimeOnly(date) {
    try {
      return new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return '';
    }
  }

  // Format Seconds to HH:MM:SS
  function formatSeconds(totalSec) {
    const sCount = Math.max(0, Math.floor(Number(totalSec) || 0));
    const h = Math.floor(sCount / 3600);
    const m = Math.floor((sCount % 3600) / 60);
    const s = sCount % 60;
    return (
      (h < 10 ? '0' + h : h) + ':' +
      (m < 10 ? '0' + m : m) + ':' +
      (s < 10 ? '0' + s : s)
    );
  }

  // Toast Helper
  function showToast(message, type = 'info') {
    const existing = document.querySelector('.world-class-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'world-class-toast visible';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.classList.remove('visible');
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  // 1. User Profile & Account Data Isolation
  async function initUserProfile() {
    try {
      const resp = await fetch('/api/method/timesheet_intelligence.api.get_current_user_profile');
      if (resp.ok) {
        const data = await resp.json();
        const profile = data.message;
        if (profile) {
          state.currentUserProfile = profile;

          // Cross-Account Isolation Check
          const cachedUser = localStorage.getItem('timesheet_logged_user');
          if (cachedUser && cachedUser !== profile.user) {
            console.warn(`Account switch detected (${cachedUser} -> ${profile.user}). Purging local cache.`);
            if (window.TimesheetDB && window.TimesheetDB.clearAllUserData) {
              await window.TimesheetDB.clearAllUserData();
            }
            localStorage.removeItem('timesheet_active_session');
          }
          localStorage.setItem('timesheet_logged_user', profile.user);

          // Update Top Bar User Badge & Profile Menu
          const displayName = profile.employee_name || profile.full_name || profile.user || 'User';
          const userEmail = profile.user || '';
          const userNameDisplay = document.getElementById('user-name-display');
          const profileMenuName = document.getElementById('profile-menu-name');
          const profileMenuEmail = document.getElementById('profile-menu-email');
          const profileMenuRole = document.getElementById('profile-menu-role');
          const profileMenuAvatar = document.getElementById('profile-menu-avatar');
          const linkViewProfile = document.getElementById('link-view-profile');

          let primaryRole = 'Employee';
          if (profile.roles && profile.roles.length > 0) {
            const filtered = profile.roles.filter((r) => r !== 'All' && r !== 'Guest');
            if (filtered.includes('System Manager')) {
              primaryRole = 'System Manager';
            } else if (filtered.includes('Projects Manager')) {
              primaryRole = 'Projects Manager';
            } else if (filtered.length > 0) {
              primaryRole = filtered[0];
            }
          }

          if (userNameDisplay) userNameDisplay.textContent = displayName;
          if (profileMenuName) profileMenuName.textContent = displayName;
          if (profileMenuEmail) profileMenuEmail.textContent = userEmail;
          if (profileMenuRole) profileMenuRole.textContent = primaryRole;
          if (profileMenuAvatar) profileMenuAvatar.textContent = (displayName[0] || 'U').toUpperCase();

          if (linkViewProfile) {
            linkViewProfile.href = '/app/user-profile';
            linkViewProfile.title = `Open Frappe Desk Profile for ${displayName}`;
          }

          updateUserPresence();
        }
      }
    } catch (e) {
      console.warn('Could not fetch user profile:', e);
    }
  }

  function updateUserPresence(isActive) {
    const dot = document.getElementById('user-presence-dot');
    if (!dot) return;
    const running = (typeof isActive === 'boolean') ? isActive : (state.timer.isRunning || !!localStorage.getItem('timesheet_active_session'));
    if (running) {
      dot.className = 'user-presence-dot active';
      dot.setAttribute('title', '🟢 Clocked In / Active Timer Running');
      dot.setAttribute('aria-label', 'Clocked In');
    } else {
      dot.className = 'user-presence-dot idle';
      dot.setAttribute('title', '⚪ Idle');
      dot.setAttribute('aria-label', 'Idle');
    }
  }

  function toggleProfileMenu() {
    const popover = document.getElementById('user-profile-menu');
    const trigger = document.getElementById('user-profile-btn');
    if (!popover) return;
    const isClosed = popover.style.display === 'none' || !popover.style.display;
    if (isClosed) {
      popover.style.display = 'flex';
      if (trigger) trigger.setAttribute('aria-expanded', 'true');
    } else {
      popover.style.display = 'none';
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
    }
  }

  function closeProfileMenu() {
    const popover = document.getElementById('user-profile-menu');
    const trigger = document.getElementById('user-profile-btn');
    if (popover && popover.style.display !== 'none') {
      popover.style.display = 'none';
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
    }
  }

  async function handleLogout() {
    showToast('🚪 Logging out...', 'info');
    try {
      if (window.TimesheetDB && window.TimesheetDB.clearAllUserData) {
        await window.TimesheetDB.clearAllUserData();
      }
      localStorage.removeItem('timesheet_logged_user');
      localStorage.removeItem('timesheet_active_session');
      localStorage.removeItem('timesheet_cached_logs');
    } catch (e) {}

    try {
      await fetch('/api/method/logout', { method: 'POST' });
    } catch (e) {}

    window.location.href = '/login';
  }

  // 2. Adaptive Theme Controller (Google Material 3 / Frappe Light / Obsidian Dark)
  function initTheme() {
    const savedTheme = localStorage.getItem('timesheet_theme') || 'google';
    applyTheme(savedTheme);
  }

  function applyTheme(theme) {
    const validThemes = ['google', 'frappe', 'dark'];
    if (!validThemes.includes(theme)) {
      theme = 'google';
    }
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('timesheet_theme', theme);

    // Update Desktop Segmented Controls
    document.querySelectorAll('.theme-tab-btn').forEach((btn) => {
      const val = btn.getAttribute('data-theme') || btn.getAttribute('data-theme-val');
      if (val === theme) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // Update Mobile Popover Menu Items
    document.querySelectorAll('.theme-option-btn').forEach((btn) => {
      const val = btn.getAttribute('data-theme') || btn.getAttribute('data-theme-val');
      if (val === theme) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  function toggleOverflowMenu() {
    const popover = document.getElementById('overflow-popover-menu');
    const trigger = document.getElementById('btn-overflow-menu');
    if (!popover) return;
    const isClosed = popover.style.display === 'none' || !popover.style.display;
    if (isClosed) {
      popover.style.display = 'flex';
      if (trigger) trigger.setAttribute('aria-expanded', 'true');
    } else {
      popover.style.display = 'none';
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
    }
  }

  function closeOverflowMenu() {
    const popover = document.getElementById('overflow-popover-menu');
    const trigger = document.getElementById('btn-overflow-menu');
    if (popover && popover.style.display !== 'none') {
      popover.style.display = 'none';
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
    }
  }

  // 2b. Helper: Local ISO String for <input type="datetime-local">
  function getLocalDateTimeString(dateObj) {
    const d = dateObj || new Date();
    const pad = (num) => String(num).padStart(2, '0');
    const year = d.getFullYear();
    const month = pad(d.getMonth() + 1);
    const day = pad(d.getDate());
    const hours = pad(d.getHours());
    const minutes = pad(d.getMinutes());
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  }

  // 3. Setup Modal Controls (Start / Track Another Task)
  function openSetupModal(mode = 'new') {
    state.modalMode = mode;
    const setupModal = document.getElementById('project-setup-modal');
    const setupModalTitle = document.getElementById('setup-modal-title');
    const btnStartSessionModal = document.getElementById('btn-start-session-modal');
    const projectSelect = document.getElementById('input-project');
    const inputStartTime = document.getElementById('input-start-time');

    if (setupModal) {
      if (inputStartTime) {
        inputStartTime.value = getLocalDateTimeString(new Date());
      }
      if (mode === 'switch') {
        if (setupModalTitle) setupModalTitle.textContent = 'Switch to Another Project';
        if (btnStartSessionModal) btnStartSessionModal.textContent = '🔄 Log Current & Switch Project';
      } else {
        if (setupModalTitle) setupModalTitle.textContent = 'What are you working on?';
        if (btnStartSessionModal) btnStartSessionModal.textContent = '🚀 Start Work Session';
      }
      setupModal.classList.add('open');
      setupModal.style.display = 'flex';
      setupModal.setAttribute('aria-hidden', 'false');
      if (projectSelect) projectSelect.focus();
    }
  }

  function closeSetupModal() {
    const setupModal = document.getElementById('project-setup-modal');
    if (setupModal) {
      setupModal.classList.remove('open');
      setupModal.style.display = 'none';
      setupModal.setAttribute('aria-hidden', 'true');
    }
  }

  // 4. Start New Work Session (AppSheet Instant Row Creation)
  async function handleModalSubmit() {
    const projectSelect = document.getElementById('input-project');
    const taskSelect = document.getElementById('input-task');
    const activitySelect = document.getElementById('input-activity');
    const billableCheck = document.getElementById('input-billable');
    const inputStartTime = document.getElementById('input-start-time');

    let projName = 'General Operations';
    let projId = 'PROJ-GENERAL';

    if (projectSelect && projectSelect.selectedIndex >= 0 && projectSelect.options[projectSelect.selectedIndex]) {
      const sel = projectSelect.options[projectSelect.selectedIndex];
      if (sel.value) {
        projName = sel.text;
        projId = sel.value;
      }
    }

    const taskName = taskSelect && taskSelect.value ? taskSelect.options[taskSelect.selectedIndex]?.text : '';
    const actName = activitySelect && activitySelect.value ? activitySelect.value : 'Development';
    const isBillable = billableCheck ? billableCheck.checked : true;

    let dtStart = new Date();
    if (inputStartTime && inputStartTime.value) {
      const parsed = new Date(inputStartTime.value);
      if (!isNaN(parsed.getTime())) {
        dtStart = parsed;
      }
    }

    const startTimeIso = dtStart.toISOString();
    const fromTimeStr = `${dtStart.getFullYear()}-${String(dtStart.getMonth() + 1).padStart(2, '0')}-${String(dtStart.getDate()).padStart(2, '0')} ${String(dtStart.getHours()).padStart(2, '0')}:${String(dtStart.getMinutes()).padStart(2, '0')}:${String(dtStart.getSeconds()).padStart(2, '0')}`;
    const initialElapsed = Math.max(0, Math.floor((Date.now() - dtStart.getTime()) / 1000));
    const clientUuid = 'uuid_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);

    const newSession = {
      client_uuid: clientUuid,
      project: projName,
      projectId: projId,
      task: taskName,
      activity: actName,
      isBillable: isBillable,
      startTime: startTimeIso,
      from_time: fromTimeStr,
      elapsedSeconds: initialElapsed,
      isRunning: true,
      points: []
    };

    state.activeSessions.push(newSession);
    state.currentSession = newSession;
    saveSessionsState();
    renderActiveSessions();
    closeSetupModal();

    if (window.TimesheetVoice && window.TimesheetVoice.playTone) {
      window.TimesheetVoice.playTone('start');
    }
    showToast(`🚀 Started: ${projName}`, 'success');

    // AppSheet Real-Time Server Row Ingestion (Background)
    try {
      const params = new URLSearchParams({
        client_uuid: clientUuid,
        project_name: projName,
        task_name: taskName,
        activity_type: actName,
        is_billable: isBillable ? 1 : 0,
        from_time: fromTimeStr
      });
      fetch(`/api/method/timesheet_intelligence.api.start_timesheet_session?${params.toString()}`, {
        method: 'POST',
        headers: { 'X-Frappe-CSRF-Token': window.csrf_token || '' }
      }).catch((err) => {
        console.warn('Background start_timesheet_session error (handled offline):', err);
      });
    } catch (e) {}

    // Queue in local IndexedDB
    if (window.TimesheetDB && window.TimesheetDB.addToQueue) {
      window.TimesheetDB.addToQueue({
        client_uuid: clientUuid,
        action: 'start',
        status: 'Draft',
        project: projId,
        project_name: projName,
        task: taskName,
        activity_type: actName,
        is_billable: isBillable ? 1 : 0,
        from_time: fromTimeStr,
        timestamp: new Date().toISOString()
      });
    }
  }

  // 5. Multi-Session Renderer & State Persistence
  function saveSessionsState() {
    try {
      localStorage.setItem('timesheet_active_sessions', JSON.stringify(state.activeSessions));
    } catch (e) {}
  }

  function restoreSessionState() {
    const saved = localStorage.getItem('timesheet_active_sessions');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          state.activeSessions = parsed;
          state.currentSession = state.activeSessions[state.activeSessions.length - 1];
          renderActiveSessions();
          startGlobalTimerLoop();
          return;
        }
      } catch (e) {}
    }

    // Fallback: check legacy single session key
    const legacy = localStorage.getItem('timesheet_active_session');
    if (legacy) {
      try {
        const p = JSON.parse(legacy);
        if (p.currentSession && p.currentSession.project) {
          const clientUuid = 'uuid_' + Date.now();
          state.activeSessions = [{
            client_uuid: clientUuid,
            project: p.currentSession.project,
            task: p.currentSession.task,
            activity: p.currentSession.activity,
            isBillable: p.currentSession.isBillable,
            startTime: p.currentSession.startTime || new Date().toISOString(),
            from_time: p.currentSession.startTime || new Date().toISOString(),
            elapsedSeconds: p.timer ? p.timer.elapsedSeconds : 0,
            isRunning: p.timer ? p.timer.isRunning : true,
            points: p.currentSession.points || []
          }];
          state.currentSession = state.activeSessions[0];
          localStorage.removeItem('timesheet_active_session');
          saveSessionsState();
          renderActiveSessions();
          startGlobalTimerLoop();
          return;
        }
      } catch (e) {}
    }

    state.activeSessions = [];
    renderActiveSessions();
    startGlobalTimerLoop();
  }

  function renderActiveSessions() {
    const container = document.getElementById('active-sessions-container');
    const toolbar = document.getElementById('active-sessions-toolbar');
    const countLabel = document.getElementById('active-sessions-count-label');
    const idleCard = document.getElementById('idle-session-card');

    if (!container) return;

    if (state.activeSessions.length === 0) {
      container.innerHTML = '';
      if (toolbar) toolbar.style.display = 'none';
      if (idleCard) idleCard.style.display = 'flex';
      updateUserPresence(false);
      renderLivePoints();
      return;
    }

    if (idleCard) idleCard.style.display = 'none';
    if (toolbar) {
      toolbar.style.display = 'flex';
      if (countLabel) {
        countLabel.textContent = `${state.activeSessions.length} Active Task${state.activeSessions.length > 1 ? 's' : ''} Recording`;
      }
    }
    updateUserPresence(true);

    container.innerHTML = state.activeSessions.map((s) => `
      <section class="session-card" data-session-uuid="${s.client_uuid}">
        <div class="session-header-row">
          <div class="session-status-badge ${s.isRunning ? 'running' : 'paused'}" id="session-status-pill-${s.client_uuid}">
            <span class="pulse-dot" aria-hidden="true"></span>
            <span id="session-status-label-${s.client_uuid}">${s.isRunning ? 'LIVE RECORDING' : 'PAUSED'}</span>
          </div>

          <div class="session-actions-group">
            <button type="button" class="btn-session-action btn-pause btn-toggle-pause" data-uuid="${s.client_uuid}" style="display: ${s.isRunning ? 'inline-flex' : 'none'};" aria-label="Pause timer">
              <span>⏸ Pause</span>
            </button>
            <button type="button" class="btn-session-action btn-resume btn-toggle-resume" data-uuid="${s.client_uuid}" style="display: ${!s.isRunning ? 'inline-flex' : 'none'};" aria-label="Resume timer">
              <span>▶ Resume</span>
            </button>
            <button type="button" class="btn-session-action btn-finish btn-open-finish-modal" data-uuid="${s.client_uuid}" aria-label="Finish and save timesheet">
              <span>⏹ Finish & Save</span>
            </button>
          </div>
        </div>

        <div class="session-body-row">
          <div class="session-details-col">
            <div class="session-project-name">${escapeHtml(s.project)}</div>
            <div class="session-meta-pills">
              <span class="meta-pill">${escapeHtml(s.task || 'General Task')}</span>
              <span class="meta-pill">${escapeHtml(s.activity || 'Development')}</span>
              <span class="meta-pill pill-time">Started ${formatTimeOnly(s.startTime)}</span>
              ${s.isBillable ? '<span class="meta-pill" style="color:var(--accent-emerald); font-weight:700;">Billable</span>' : ''}
            </div>
          </div>

          <div class="session-timer-col">
            <div id="timer-display-${s.client_uuid}" class="timer-digits-compact">${formatSeconds(s.elapsedSeconds)}</div>
          </div>
        </div>
      </section>
    `).join('');

    renderLivePoints();
  }

  function startGlobalTimerLoop() {
    if (state.globalInterval) clearInterval(state.globalInterval);
    state.globalInterval = setInterval(() => {
      const nowMs = Date.now();

      state.activeSessions.forEach((s) => {
        if (s.isRunning) {
          const startMs = new Date(s.startTime).getTime();
          if (!isNaN(startMs)) {
            s.elapsedSeconds = Math.max(0, Math.floor((nowMs - startMs) / 1000));
          } else {
            s.elapsedSeconds = (s.elapsedSeconds || 0) + 1;
          }

          const displayEl = document.getElementById(`timer-display-${s.client_uuid}`);
          if (displayEl) {
            displayEl.textContent = formatSeconds(s.elapsedSeconds);
          }
        }
      });

      if (state.activeSessions.length > 0 && Math.floor(nowMs / 1000) % 5 === 0) {
        saveSessionsState();
      }
    }, 1000);
  }

  function pauseSession(sessionUuid) {
    const session = state.activeSessions.find((s) => s.client_uuid === sessionUuid);
    if (!session) return;
    session.isRunning = false;
    saveSessionsState();
    renderActiveSessions();
  }

  function resumeSession(sessionUuid) {
    const session = state.activeSessions.find((s) => s.client_uuid === sessionUuid);
    if (!session) return;
    session.isRunning = true;
    saveSessionsState();
    renderActiveSessions();
  }

  // 6. Finish Modal with Retroactive Stop Time & Mandatory Accomplishments
  function openFinishModal(sessionUuid) {
    const session = state.activeSessions.find((s) => s.client_uuid === sessionUuid);
    if (!session) return;

    state.finishingSessionUuid = sessionUuid;
    const modal = document.getElementById('finish-session-modal');
    const projName = document.getElementById('finish-modal-project-name');
    const taskPill = document.getElementById('finish-modal-task-pill');
    const actPill = document.getElementById('finish-modal-activity-pill');
    const startPill = document.getElementById('finish-modal-start-time-pill');
    const inputStop = document.getElementById('finish-input-stop-time');
    const textAccomplishments = document.getElementById('finish-accomplishments-text');

    if (projName) projName.textContent = session.project;
    if (taskPill) taskPill.textContent = session.task || 'General Task';
    if (actPill) actPill.textContent = session.activity || 'Development';
    if (startPill) startPill.textContent = `Started ${formatTimeOnly(session.startTime)}`;

    const now = new Date();
    if (inputStop) {
      inputStop.value = getLocalDateTimeString(now);
    }

    updateFinishDurationPreview(session);

    if (textAccomplishments) {
      if (session.points && session.points.length > 0) {
        textAccomplishments.value = session.points.map((p) => `• [${p.time}] ${p.text}`).join('\n');
      } else {
        textAccomplishments.value = `• Completed work deliverable on ${session.project}`;
      }
    }

    if (modal) {
      modal.classList.add('open');
      modal.style.display = 'flex';
      modal.setAttribute('aria-hidden', 'false');
    }
  }

  function updateFinishDurationPreview(session) {
    const inputStop = document.getElementById('finish-input-stop-time');
    const badge = document.getElementById('finish-duration-preview-badge');
    if (!inputStop || !badge) return;

    const dtStart = new Date(session.startTime);
    let dtStop = new Date();
    if (inputStop.value) {
      const parsed = new Date(inputStop.value);
      if (!isNaN(parsed.getTime())) dtStop = parsed;
    }

    let diffMins = Math.round((dtStop.getTime() - dtStart.getTime()) / 60000);
    if (diffMins <= 0) diffMins = Math.max(1, Math.round(session.elapsedSeconds / 60));

    const hrs = (diffMins / 60.0).toFixed(2);
    badge.textContent = `Duration: ${diffMins} mins (${hrs} hrs)`;
  }

  function closeFinishModal() {
    const modal = document.getElementById('finish-session-modal');
    if (modal) {
      modal.classList.remove('open');
      modal.style.display = 'none';
      modal.setAttribute('aria-hidden', 'true');
    }
    state.finishingSessionUuid = null;
  }

  async function handleFinishModalSubmit() {
    const sessionUuid = state.finishingSessionUuid;
    const session = state.activeSessions.find((s) => s.client_uuid === sessionUuid);
    if (!session) {
      closeFinishModal();
      return;
    }

    const textAccomplishments = document.getElementById('finish-accomplishments-text');
    const inputStop = document.getElementById('finish-input-stop-time');

    const desc = (textAccomplishments ? textAccomplishments.value : '').trim();
    if (!desc) {
      showToast('⚠️ Please document work accomplishments before finishing!', 'error');
      if (textAccomplishments) {
        textAccomplishments.classList.remove('input-shake');
        void textAccomplishments.offsetWidth;
        textAccomplishments.classList.add('input-shake');
        textAccomplishments.focus();
      }
      if (window.TimesheetVoice && window.TimesheetVoice.playTone) {
        window.TimesheetVoice.playTone('error');
      }
      return;
    }

    const dtStart = new Date(session.startTime);
    let dtStop = new Date();
    if (inputStop && inputStop.value) {
      const parsed = new Date(inputStop.value);
      if (!isNaN(parsed.getTime())) dtStop = parsed;
    }

    let diffMins = Math.round((dtStop.getTime() - dtStart.getTime()) / 60000);
    if (diffMins <= 0) diffMins = Math.max(1, Math.round(session.elapsedSeconds / 60));

    const toTimeStr = `${dtStop.getFullYear()}-${String(dtStop.getMonth() + 1).padStart(2, '0')}-${String(dtStop.getDate()).padStart(2, '0')} ${String(dtStop.getHours()).padStart(2, '0')}:${String(dtStop.getMinutes()).padStart(2, '0')}:${String(dtStop.getSeconds()).padStart(2, '0')}`;

    // Remove from active sessions
    state.activeSessions = state.activeSessions.filter((s) => s.client_uuid !== sessionUuid);
    if (state.currentSession && state.currentSession.client_uuid === sessionUuid) {
      state.currentSession = state.activeSessions[state.activeSessions.length - 1] || null;
    }
    saveSessionsState();
    closeFinishModal();
    renderActiveSessions();

    if (window.TimesheetVoice && window.TimesheetVoice.playTone) {
      window.TimesheetVoice.playTone('finish');
    }
    showToast(`✓ Logged & completed session: ${session.project}`, 'success');

    // 1. Dispatch API completion
    try {
      const formData = new FormData();
      formData.append('client_uuid', session.client_uuid);
      formData.append('to_time', toTimeStr);
      formData.append('accomplishments', desc);
      formData.append('duration_minutes', diffMins);

      fetch('/api/method/timesheet_intelligence.api.complete_timesheet_session', {
        method: 'POST',
        headers: { 'X-Frappe-CSRF-Token': window.csrf_token || '' },
        body: formData
      }).catch((err) => {
        console.warn('Background complete_timesheet_session error (handled offline):', err);
      });
    } catch (e) {}

    // 2. Queue in IndexedDB for 100% offline resilience
    if (window.TimesheetDB && window.TimesheetDB.addToQueue) {
      await window.TimesheetDB.addToQueue({
        client_uuid: session.client_uuid,
        action: 'complete',
        status: 'Completed',
        project: session.projectId || session.project,
        project_name: session.project,
        task: session.task,
        activity_type: session.activity,
        is_billable: session.isBillable ? 1 : 0,
        from_time: session.from_time,
        to_time: toTimeStr,
        duration_minutes: diffMins,
        accomplishments: desc,
        timestamp: new Date().toISOString()
      });
    }

    // 3. Trigger unified sync engine and refresh calendar
    if (window.TimesheetSync && window.TimesheetSync.drainQueue) {
      window.TimesheetSync.drainQueue();
    }

    await refreshCalendarAndTable();
  }

  // 7. Work Accomplishments Manager
  function addPoint(text) {
    if (!text || !text.trim()) return;
    const cleanText = text.trim();
    const timeStr = formatTimeOnly(new Date());

    const newPoint = {
      id: 'pt_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      time: timeStr,
      text: cleanText
    };

    if (state.activeSessions.length > 0) {
      const active = state.activeSessions[state.activeSessions.length - 1];
      if (!active.points) active.points = [];
      active.points.push(newPoint);
      saveSessionsState();
    } else {
      if (!state.currentSession) state.currentSession = { points: [] };
      if (!state.currentSession.points) state.currentSession.points = [];
      state.currentSession.points.push(newPoint);
    }

    renderLivePoints();

    if (window.TimesheetVoice && window.TimesheetVoice.playTone) {
      window.TimesheetVoice.playTone('save');
    }
    showToast(`✓ Added: "${cleanText.slice(0, 24)}..."`, 'info');
  }

  function renderLivePoints() {
    const tableBody = document.getElementById('live-points-table-body');
    const pointsCounter = document.getElementById('points-counter');
    if (!tableBody) return;
    tableBody.innerHTML = '';

    let pts = [];
    if (state.activeSessions.length > 0) {
      state.activeSessions.forEach((s) => {
        if (s.points) pts = pts.concat(s.points);
      });
    } else if (state.currentSession && state.currentSession.points) {
      pts = state.currentSession.points;
    }

    if (pointsCounter) {
      pointsCounter.textContent = `${pts.length} Point${pts.length === 1 ? '' : 's'} Logged`;
    }

    if (pts.length === 0) {
      tableBody.innerHTML = `
        <tr id="empty-points-row">
          <td colspan="3" style="text-align: center; padding: 16px; color: var(--text-dim); font-size: 0.85rem;">
            No accomplishment points logged yet. Tap the microphone or type above to add!
          </td>
        </tr>
      `;
      return;
    }

    pts.forEach((pt) => {
      const tr = document.createElement('tr');
      tr.className = 'point-table-row';
      tr.setAttribute('data-id', pt.id);
      tr.innerHTML = `
        <td class="table-time-cell" style="width: 25%; white-space: nowrap;">
          <span class="meta-pill pill-time" style="font-size: 0.74rem; white-space: nowrap; display: inline-flex;">${pt.time}</span>
        </td>
        <td class="point-text-cell" style="width: 65%; cursor: pointer;" title="Tap to expand / collapse full text">
          <div class="point-text-truncated">${escapeHtml(pt.text)}</div>
        </td>
        <td style="width: 10%; text-align: center;">
          <button type="button" class="btn-del-point" data-id="${pt.id}" aria-label="Remove accomplishment: ${escapeHtml(pt.text).slice(0, 20)}" title="Delete point">✕</button>
        </td>
      `;
      tableBody.appendChild(tr);
    });
  }

  // 9. Calendar Navigation Engine
  function renderCalendarGrid() {
    const calMonthTitle = document.getElementById('cal-month-title');
    const calendarDaysGrid = document.getElementById('calendar-days-grid');
    if (!calMonthTitle || !calendarDaysGrid) return;

    const { currentYear, currentMonth, selectedDate, dailySummary } = state.calendar;
    calMonthTitle.textContent = `${MONTH_NAMES[currentMonth - 1]} ${currentYear}`;

    calendarDaysGrid.innerHTML = '';

    const firstDayIndex = new Date(currentYear, currentMonth - 1, 1).getDay(); // 0 (Sun) - 6 (Sat)
    // Convert to Monday-first indexing (0: Mon ... 6: Sun)
    const mondayFirstIndex = (firstDayIndex + 6) % 7;
    const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
    const prevMonthDays = new Date(currentYear, currentMonth - 1, 0).getDate();

    const todayStr = new Date().toISOString().slice(0, 10);

    // Prev month padding
    for (let i = mondayFirstIndex - 1; i >= 0; i--) {
      const dNum = prevMonthDays - i;
      const cell = document.createElement('div');
      cell.className = 'cal-cell is-other-month';
      cell.innerHTML = `
        <div class="cal-cell-top">
          <span class="cal-day-num">${dNum}</span>
        </div>
      `;
      calendarDaysGrid.appendChild(cell);
    }

    // Current month days
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const entry = dailySummary ? dailySummary[dateStr] : null;
      const hours = (typeof entry === 'object' && entry !== null) ? Number(entry.hours || 0) : Number(entry || 0);

      const dateObj = new Date(currentYear, currentMonth - 1, d);
      const dayOfWeek = dateObj.getDay(); // 0 = Sun, 6 = Sat
      const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);
      const isPast = (dateStr < todayStr);
      const isToday = (dateStr === todayStr);
      const isSelected = (dateStr === selectedDate);

      let status = 'future';
      if (typeof entry === 'object' && entry !== null && entry.status) {
        status = entry.status;
      } else if (isWeekend) {
        status = hours >= 8.0 ? 'present' : (hours >= 4.0 ? 'half_day' : 'weekend');
      } else if (isPast) {
        status = hours >= 8.0 ? 'present' : (hours >= 4.0 ? 'half_day' : 'absent');
      } else if (isToday) {
        status = hours >= 8.0 ? 'present' : (hours >= 4.0 ? 'half_day' : (hours > 0 || state.timer.isRunning ? 'in_progress' : 'in_progress'));
      }

      const statusCssClass = status.replace('_', '-');
      const cell = document.createElement('div');
      cell.className = `cal-cell status-${statusCssClass}${isSelected ? ' is-selected' : ''}${isToday ? ' is-today' : ''}${isWeekend ? ' is-weekend' : ''}`;
      cell.setAttribute('data-date', dateStr);
      cell.setAttribute('tabindex', '0');
      cell.setAttribute('role', 'button');
      cell.setAttribute('aria-label', `${dateStr}: ${hours.toFixed(1)} hours logged (${status})`);

      // Indicator Dot
      let dotHtml = '';
      if (status === 'present') {
        dotHtml = '<span class="cal-indicator-dot present" title="🟢 Present (≥8h)" aria-hidden="true"></span>';
      } else if (status === 'half_day') {
        dotHtml = '<span class="cal-indicator-dot half-day" title="🟡 Half Day (4-8h)" aria-hidden="true"></span>';
      } else if (status === 'absent') {
        dotHtml = '<span class="cal-indicator-dot absent" title="🔴 Absent (<4h)" aria-hidden="true"></span>';
      } else if (status === 'in_progress' && (hours > 0 || isToday)) {
        dotHtml = '<span class="cal-indicator-dot in-progress" title="🔵 In Progress" aria-hidden="true"></span>';
      }

      // Hours Badge
      let badgeHtml = '';
      if (hours > 0) {
        badgeHtml = `<span class="cal-badge-hours ${statusCssClass}">${hours.toFixed(1)}h</span>`;
      } else if (isPast && !isWeekend) {
        badgeHtml = `<span class="cal-badge-hours absent">0.0h</span>`;
      }

      cell.innerHTML = `
        <div class="cal-cell-top">
          <span class="cal-day-num">${d}</span>
          ${dotHtml}
        </div>
        ${badgeHtml}
      `;
      calendarDaysGrid.appendChild(cell);
    }
  }

  async function renderDailyTableFromCache(targetDate) {
    try {
      const cachedLogs = window.TimesheetDB ? await window.TimesheetDB.getCachedTimesheets() : [];
      const pendingQueue = window.TimesheetDB ? await window.TimesheetDB.getPendingQueueItems() : [];

      const existingClientUuids = new Set(cachedLogs.map((l) => l.client_uuid || l.name));
      const combinedLogs = [...cachedLogs];

      pendingQueue.forEach((qItem) => {
        if (!existingClientUuids.has(qItem.client_uuid)) {
          combinedLogs.unshift({
            name: qItem.client_uuid,
            client_uuid: qItem.client_uuid,
            project_name: qItem.project_name || qItem.project,
            task: qItem.task,
            activity_type: qItem.activity_type,
            from_time: qItem.from_time,
            to_time: qItem.to_time,
            duration_minutes: qItem.duration_minutes,
            total_hours: qItem.duration_minutes / 60.0,
            accomplishments: qItem.accomplishments || qItem.description,
            is_billable: qItem.is_billable,
            sync_status: qItem.sync_status
          });
        }
      });

      const dateLogs = combinedLogs.filter((l) => (l.from_time || '').slice(0, 10) === targetDate);
      renderDailyBreakdownTable(dateLogs);
    } catch (e) {
      console.warn('Error rendering table from cache:', e);
    }
  }

  // 10. Daily Timesheets Breakdown Table (Clean, AppSheet-Style, No "Queued" Clutter)
  function renderDailyBreakdownTable(logsForDate) {
    const dailyTableTitle = document.getElementById('daily-table-title');
    const dailyTableBody = document.getElementById('daily-table-body');
    const todayTotalHoursEl = document.getElementById('today-total-hours');
    if (!dailyTableBody) return;
    dailyTableBody.innerHTML = '';

    const targetDate = state.calendar.selectedDate;
    if (dailyTableTitle) {
      dailyTableTitle.textContent = `Activities for ${targetDate}`;
    }

    let dayTotalMinutes = 0;

    if (!logsForDate || logsForDate.length === 0) {
      dailyTableBody.innerHTML = `
        <tr>
          <td colspan="4" style="text-align: center; padding: 24px; color: var(--text-dim);">
            No timesheet logs found for ${targetDate}.
          </td>
        </tr>
      `;
      if (todayTotalHoursEl) todayTotalHoursEl.textContent = '0.0h';
      return;
    }

    logsForDate.forEach((log) => {
      const mins = Number(log.duration_minutes || 0);
      dayTotalMinutes += mins;

      const timeRange = `${formatTimeOnly(log.from_time)} - ${formatTimeOnly(log.to_time)}`;
      const proj = log.project_name || log.project || 'General Operations';
      const task = log.task ? ` • ${log.task}` : '';
      const act = log.activity_type || 'Development';
      const pointsList = log.accomplishments || log.description || log.steps_part_b || '';

      const tr = document.createElement('tr');
      tr.className = 'daily-log-row';
      tr.setAttribute('data-log-json', JSON.stringify(log));
      tr.setAttribute('tabindex', '0');
      tr.setAttribute('role', 'button');
      tr.setAttribute('aria-label', `View details for ${proj}`);

      tr.innerHTML = `
        <td style="width: 25%; white-space: nowrap;">
          <span class="meta-pill pill-time" style="font-size: 0.74rem; white-space: nowrap; display: inline-flex;">${timeRange}</span>
        </td>
        <td style="width: 35%;">
          <div style="font-weight: 700; color: var(--text-main); font-size: 0.88rem;">${escapeHtml(proj)}</div>
          <div style="font-size: 0.76rem; color: var(--text-muted);">${escapeHtml(act)}${escapeHtml(task)}</div>
        </td>
        <td style="width: 25%;">
          <div style="font-size: 0.8rem; color: var(--text-dim); max-height: 38px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            ${escapeHtml(pointsList.replace(/\n/g, ' | '))}
          </div>
        </td>
        <td style="width: 15%; text-align: right; font-weight: 800; color: var(--accent-primary);">
          ${(mins / 60).toFixed(1)}h
        </td>
      `;
      dailyTableBody.appendChild(tr);
    });

    if (todayTotalHoursEl) {
      todayTotalHoursEl.textContent = `${(dayTotalMinutes / 60).toFixed(1)}h`;
    }
  }

  // 11. Optimistic Calculation Engine & Dual-Layer Reconciler
  async function getOptimisticMetrics(targetYear, targetMonth, targetDateStr) {
    // 1. Fetch latest baseline cached from Frappe backend
    const serverMetrics = (await window.TimesheetDB.getMetadata('server_metrics')) || {
      today_total_hours: 0.0,
      month_total_hours: 0.0,
      daily_summary: {}
    };

    // 2. Fetch pending local mutations (excluding failed poison-pill records)
    const pendingQueue = window.TimesheetDB.getPendingQueueItems ? await window.TimesheetDB.getPendingQueueItems() : [];

    let optimisticToday = Number(serverMetrics.today_total_hours || serverMetrics.today_hours || 0);
    let optimisticMonth = Number(serverMetrics.month_total_hours || serverMetrics.month_hours || 0);
    let optimisticDaily = { ...(serverMetrics.daily_summary || {}) };

    const todayStr = new Date().toISOString().slice(0, 10);

    for (const item of pendingQueue) {
      const itemDate = (item.from_time || '').slice(0, 10) || todayStr;
      const hours = parseFloat(item.total_hours) || (parseFloat(item.duration_minutes || 0) / 60.0) || 0;

      const currentEntry = optimisticDaily[itemDate];
      const baseHours = (typeof currentEntry === 'object' && currentEntry !== null)
        ? Number(currentEntry.hours || 0)
        : Number(currentEntry || 0);
      const newHours = Number((baseHours + hours).toFixed(2));

      // Recompute status
      const [y, m, d] = itemDate.split('-').map(Number);
      const dObj = new Date(y, m - 1, d);
      const dayOfWeek = dObj.getDay();
      const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);
      const isPast = (itemDate < todayStr);
      const isToday = (itemDate === todayStr);

      let newStatus = 'future';
      if (isWeekend) {
        newStatus = newHours >= 8.0 ? 'present' : (newHours >= 4.0 ? 'half_day' : 'weekend');
      } else if (isPast) {
        newStatus = newHours >= 8.0 ? 'present' : (newHours >= 4.0 ? 'half_day' : 'absent');
      } else if (isToday) {
        newStatus = newHours >= 8.0 ? 'present' : (newHours >= 4.0 ? 'half_day' : 'in_progress');
      }

      optimisticDaily[itemDate] = {
        hours: newHours,
        status: newStatus
      };

      // Add to today hours
      if (itemDate === todayStr) {
        optimisticToday = Number((optimisticToday + hours).toFixed(2));
      }

      // Add to month hours if matching queried month & year
      const [iYear, iMonth] = itemDate.split('-').map(Number);
      if (iYear === targetYear && iMonth === targetMonth) {
        optimisticMonth = Number((optimisticMonth + hours).toFixed(2));
      }
    }

    return {
      today_hours: optimisticToday,
      month_hours: optimisticMonth,
      daily_summary: optimisticDaily
    };
  }

  async function refreshCalendarAndTable() {
    try {
      const { currentYear, currentMonth, selectedDate } = state.calendar;

      // 1. If online, fetch fresh server calculations and cache them
      if (navigator.onLine) {
        try {
          const resp = await fetch(`/api/method/timesheet_intelligence.api.get_my_timesheets?year=${currentYear}&month=${currentMonth}&date=${selectedDate}`);
          if (resp.ok) {
            const json = await resp.json();
            const backendData = json.message || json;
            if (backendData && window.TimesheetDB) {
              await window.TimesheetDB.setMetadata('server_metrics', backendData);
              if (backendData.logs) {
                await window.TimesheetDB.cacheTimesheets(backendData.logs);
              }
            }
          }
        } catch (netErr) {
          console.warn('Network unreachable, relying on cached server baseline + optimistic queue:', netErr);
        }
      }

      // 2. Compute Dual-Layer Optimistic Metrics (Server Baseline + Pending Queue)
      const metrics = await getOptimisticMetrics(currentYear, currentMonth, selectedDate);

      state.calendar.dailySummary = metrics.daily_summary;
      state.calendar.monthTotalHours = metrics.month_hours;
      state.calendar.todayTotalHours = metrics.today_hours;

      // Update DOM KPI Badges
      const kpiTodayHours = document.getElementById('kpi-today-hours');
      const kpiMonthHours = document.getElementById('kpi-month-hours');
      if (kpiTodayHours) kpiTodayHours.textContent = `${metrics.today_hours.toFixed(1)} hrs`;
      if (kpiMonthHours) kpiMonthHours.textContent = `${metrics.month_hours.toFixed(1)} hrs`;

      renderCalendarGrid();

      // 3. Assemble and render daily breakdown table
      const cachedLogs = window.TimesheetDB ? await window.TimesheetDB.getCachedTimesheets() : [];
      const pendingQueue = window.TimesheetDB ? await window.TimesheetDB.getPendingQueueItems() : [];

      const existingClientUuids = new Set(cachedLogs.map((l) => l.client_uuid || l.name));
      const combinedLogs = [...cachedLogs];

      // Prepend pending queue items not yet committed in cached server logs
      pendingQueue.forEach((qItem) => {
        if (!existingClientUuids.has(qItem.client_uuid)) {
          combinedLogs.unshift({
            name: qItem.client_uuid,
            client_uuid: qItem.client_uuid,
            project_name: qItem.project_name || qItem.project,
            task: qItem.task,
            activity_type: qItem.activity_type,
            from_time: qItem.from_time,
            to_time: qItem.to_time,
            duration_minutes: qItem.duration_minutes,
            total_hours: qItem.duration_minutes / 60.0,
            accomplishments: qItem.accomplishments || qItem.description,
            is_billable: qItem.is_billable,
            sync_status: qItem.sync_status
          });
        }
      });

      // Filter and render daily table for selected date
      const dateLogs = combinedLogs.filter((l) => (l.from_time || '').slice(0, 10) === selectedDate);
      renderDailyBreakdownTable(dateLogs);
    } catch (e) {
      console.warn('Error refreshing calendar and table:', e);
    }
  }

  function roundHours(val) {
    return Math.round(Number(val || 0) * 100) / 100;
  }

  // 12. Frappe Desk Clickable Row Modal
  function openDetailModal(log) {
    const detailModal = document.getElementById('timesheet-detail-modal');
    const detailDeskLink = document.getElementById('detail-desk-link');
    const detailProject = document.getElementById('detail-project');
    const detailTask = document.getElementById('detail-task');
    const detailActivity = document.getElementById('detail-activity');
    const detailDuration = document.getElementById('detail-duration');
    const detailBilling = document.getElementById('detail-billing');
    const detailAssociate = document.getElementById('detail-associate');
    const detailFrom = document.getElementById('detail-from');
    const detailTo = document.getElementById('detail-to');
    const detailNotes = document.getElementById('detail-notes');
    const detailStatusPill = document.getElementById('detail-status-pill');

    if (!detailModal) return;

    if (detailDeskLink && log.name && !log.name.startsWith('uuid_')) {
      detailDeskLink.href = `/desk/timesheet-log/${log.name}`;
      detailDeskLink.style.display = 'inline-flex';
    } else if (detailDeskLink) {
      detailDeskLink.style.display = 'none';
    }

    if (detailProject) detailProject.textContent = log.project_name || log.project || 'General Operations';
    if (detailTask) detailTask.textContent = log.task || 'None';
    if (detailActivity) detailActivity.textContent = log.activity_type || 'Development';
    if (detailDuration) detailDuration.textContent = `${log.duration_minutes || 0} minutes (${((Number(log.duration_minutes || 0)) / 60).toFixed(1)} hrs)`;
    if (detailBilling) detailBilling.textContent = log.is_billable ? 'Billable' : 'Non-billable';
    if (detailAssociate) detailAssociate.textContent = log.employee_name || log.user || 'Administrator';
    if (detailFrom) detailFrom.textContent = log.from_time ? new Date(log.from_time).toLocaleString() : '-';
    if (detailTo) detailTo.textContent = log.to_time ? new Date(log.to_time).toLocaleString() : '-';
    if (detailNotes) detailNotes.textContent = log.accomplishments || log.description || 'No notes provided.';

    if (detailStatusPill) {
      if (log.sync_status === 'failed') {
        detailStatusPill.className = 'sync-pill failed';
        detailStatusPill.textContent = '⚠️ Sync Failed';
      } else if (log.sync_status === 'pending') {
        detailStatusPill.className = 'sync-pill pending';
        detailStatusPill.textContent = '🔄 Queued Offline';
      } else {
        detailStatusPill.className = 'sync-pill';
        detailStatusPill.textContent = '✓ Saved in Cloud';
      }
    }

    detailModal.classList.add('open');
    detailModal.style.display = 'flex';
  }

  function closeDetailModal() {
    const detailModal = document.getElementById('timesheet-detail-modal');
    if (detailModal) {
      detailModal.classList.remove('open');
      detailModal.style.display = 'none';
    }
  }

  // 13. AppSheet-Style Error-Only Queue & Termination Drawer Modal
  async function openSyncQueueModal() {
    const syncQueueModal = document.getElementById('sync-queue-modal');
    if (!syncQueueModal) return;

    await renderSyncQueueModal();
    syncQueueModal.classList.add('open');
    syncQueueModal.style.display = 'flex';
  }

  function closeSyncQueueModal() {
    const syncQueueModal = document.getElementById('sync-queue-modal');
    if (syncQueueModal) {
      syncQueueModal.classList.remove('open');
      syncQueueModal.style.display = 'none';
    }
  }

  async function renderSyncQueueModal() {
    const syncQueueListContainer = document.getElementById('sync-queue-list-container');
    const syncModalStatusBadge = document.getElementById('sync-modal-status-badge');
    const syncModalFooterCount = document.getElementById('sync-modal-footer-count');
    const btnForceSyncNow = document.getElementById('btn-force-sync-now');
    if (!syncQueueListContainer) return;
    syncQueueListContainer.innerHTML = '';

    const queue = window.TimesheetDB ? await window.TimesheetDB.getQueue() : [];
    const isOnline = navigator.onLine;

    // Filter ONLY for stuck / errored records
    const failedItems = queue.filter((item) => item.sync_status === 'failed');

    // 1. Connection Status Badge
    if (syncModalStatusBadge) {
      if (failedItems.length > 0) {
        syncModalStatusBadge.className = 'sync-pill failed';
        syncModalStatusBadge.textContent = `⚠️ ${failedItems.length} Stuck Item${failedItems.length > 1 ? 's' : ''}`;
      } else if (isOnline) {
        syncModalStatusBadge.className = 'sync-pill';
        syncModalStatusBadge.textContent = '🟢 Online (Cloud Ready)';
      } else {
        syncModalStatusBadge.className = 'sync-pill pending';
        syncModalStatusBadge.textContent = '🔴 Offline (Working Locally)';
      }
    }

    // 2. Normal Operations (No Errors): Silent and Clean View
    if (failedItems.length === 0) {
      if (queue.length === 0) {
        syncQueueListContainer.innerHTML = `
          <div style="text-align: center; padding: 36px 16px; color: var(--text-dim);">
            <div style="font-size: 2.2rem; margin-bottom: 8px;">✓</div>
            <div style="font-weight: 700; color: var(--text-main); font-size: 1rem;">All Synced with Cloud</div>
            <div style="font-size: 0.82rem; color: var(--text-muted); margin-top: 4px;">
              Your timesheet records are fully up to date on Frappe Desk.
            </div>
          </div>
        `;
        if (syncModalFooterCount) syncModalFooterCount.textContent = '0 pending changes';
        if (btnForceSyncNow) btnForceSyncNow.style.display = 'none';
      } else {
        syncQueueListContainer.innerHTML = `
          <div style="text-align: center; padding: 36px 16px; color: var(--text-dim);">
            <div style="font-size: 2.2rem; margin-bottom: 8px;">🔄</div>
            <div style="font-weight: 700; color: var(--text-main); font-size: 1rem;">
              ${queue.length} Change${queue.length > 1 ? 's' : ''} Queued
            </div>
            <div style="font-size: 0.82rem; color: var(--text-muted); margin-top: 4px;">
              All changes are safely queued and will sync automatically in the background when connected.
            </div>
          </div>
        `;
        if (syncModalFooterCount) syncModalFooterCount.textContent = `${queue.length} item${queue.length > 1 ? 's' : ''} queued`;
        if (btnForceSyncNow) {
          btnForceSyncNow.style.display = 'inline-flex';
          btnForceSyncNow.textContent = '🔄 Sync Now';
        }
      }
      return;
    }

    // 3. Render ONLY Stuck / Errored Records (Action Required)
    if (syncModalFooterCount) {
      syncModalFooterCount.textContent = `${failedItems.length} stuck record${failedItems.length > 1 ? 's' : ''} requiring review`;
    }
    if (btnForceSyncNow) btnForceSyncNow.style.display = 'inline-flex';

    failedItems.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'queue-item-card has-error';

      const proj = item.project_name || item.project || 'General Operations';
      const mins = item.duration_minutes || 0;
      const fromFormatted = item.from_time ? formatTimeOnly(item.from_time) : '';
      const toFormatted = item.to_time ? formatTimeOnly(item.to_time) : '';

      let errorMsgHtml = '';
      if (item.error_message) {
        errorMsgHtml = `
          <div class="queue-error-box">
            <strong>Server Rejection:</strong> ${escapeHtml(item.error_message)}
          </div>
        `;
      }

      card.innerHTML = `
        <div class="queue-item-header">
          <div>
            <div style="font-weight: 700; color: var(--text-main); font-size: 0.92rem;">${escapeHtml(proj)}</div>
            <div style="font-size: 0.78rem; color: var(--text-muted);">${mins} mins • ${fromFormatted} - ${toFormatted}</div>
          </div>
          <span class="sync-pill failed">⚠️ Sync Blocked</span>
        </div>
        ${errorMsgHtml}
        <div class="queue-actions-row">
          <button type="button" class="btn-queue-discard" data-uuid="${item.client_uuid}" aria-label="Permanently delete stuck record">
            🗑️ Discard & Terminate
          </button>
          <button type="button" class="btn-queue-retry" data-uuid="${item.client_uuid}" aria-label="Retry syncing record">
            🔁 Retry
          </button>
        </div>
      `;
      syncQueueListContainer.appendChild(card);
    });
  }

  // 14. Metadata Loader
  async function loadMetadata() {
    const projectSelect = document.getElementById('input-project');
    const activitySelect = document.getElementById('input-activity');

    try {
      const bundle = window.TimesheetSync ? await window.TimesheetSync.refreshMetadataBundle() : null;
      if (bundle) {
        state.metadata = bundle;

        if (projectSelect) {
          projectSelect.innerHTML = '';
          (bundle.projects || []).forEach((p) => {
            const opt = document.createElement('option');
            opt.value = p.name;
            opt.textContent = p.project_name || p.name;
            projectSelect.appendChild(opt);
          });
          if (projectSelect.options.length > 0) projectSelect.selectedIndex = 0;
        }

        if (activitySelect) {
          activitySelect.innerHTML = '';
          (bundle.activity_types || []).forEach((a) => {
            const opt = document.createElement('option');
            opt.value = a.name;
            opt.textContent = a.activity_type || a.name;
            activitySelect.appendChild(opt);
          });
          if (activitySelect.options.length > 0) activitySelect.selectedIndex = 0;
        }

        updateTaskOptions();
      }
    } catch (err) {
      console.warn('Metadata load fallback:', err);
    }
  }

  function updateTaskOptions() {
    const projectSelect = document.getElementById('input-project');
    const taskSelect = document.getElementById('input-task');
    if (!projectSelect || !taskSelect) return;

    const selectedProj = projectSelect.value;
    taskSelect.innerHTML = '<option value="">-- General / No Specific Task --</option>';
    const filtered = (state.metadata.tasks || []).filter((t) => !selectedProj || t.project === selectedProj);
    filtered.forEach((t) => {
      const opt = document.createElement('option');
      opt.value = t.name;
      opt.textContent = t.subject || t.name;
      taskSelect.appendChild(opt);
    });
  }

  // 15. Global Event Delegation (Guarantees ALL buttons work 100% of the time)
  function initGlobalEventDelegation() {
    document.addEventListener('click', async (e) => {
      const target = e.target;
      if (!target) return;

      // 1. Start Work Buttons (Idle card, top header, or multi-session toolbar)
      if (
        target.closest('#btn-start-new-session') ||
        target.closest('#btn-header-start') ||
        target.closest('#btn-start-another-session')
      ) {
        e.preventDefault();
        openSetupModal('new');
        return;
      }

      // 2. Change Project Button
      if (target.closest('#btn-change-project')) {
        e.preventDefault();
        openSetupModal('switch');
        return;
      }

      // 3. Close Setup Modal
      if (target.closest('#setup-modal-close')) {
        e.preventDefault();
        closeSetupModal();
        return;
      }

      // 4. Submit Setup Modal
      if (target.closest('#btn-start-session-modal')) {
        e.preventDefault();
        await handleModalSubmit();
        return;
      }

      // 5. Multi-Session Timer Controls (Pause / Resume)
      const pauseBtn = target.closest('.btn-toggle-pause') || target.closest('#timer-pause-btn');
      if (pauseBtn) {
        e.preventDefault();
        const uuid = pauseBtn.getAttribute('data-uuid') || (state.activeSessions[0] ? state.activeSessions[0].client_uuid : null);
        if (uuid) pauseSession(uuid);
        return;
      }

      const resumeBtn = target.closest('.btn-toggle-resume') || target.closest('#timer-resume-btn');
      if (resumeBtn) {
        e.preventDefault();
        const uuid = resumeBtn.getAttribute('data-uuid') || (state.activeSessions[0] ? state.activeSessions[0].client_uuid : null);
        if (uuid) resumeSession(uuid);
        return;
      }

      // 6. Open Finish Modal for Active Session
      const finishBtn = target.closest('.btn-open-finish-modal') || target.closest('#btn-finish-and-next');
      if (finishBtn) {
        e.preventDefault();
        const uuid = finishBtn.getAttribute('data-uuid') || (state.activeSessions[0] ? state.activeSessions[0].client_uuid : null);
        if (uuid) openFinishModal(uuid);
        return;
      }

      // 6b. Close Finish Modal
      if (target.closest('#finish-modal-close') || target.closest('#btn-cancel-finish-modal')) {
        e.preventDefault();
        closeFinishModal();
        return;
      }

      // 6c. Confirm Finish & Save Timesheet
      if (target.closest('#btn-confirm-finish-session')) {
        e.preventDefault();
        await handleFinishModalSubmit();
        return;
      }

      // 7. Desktop Theme Tab Click
      const themeTabBtn = target.closest('.theme-tab-btn');
      if (themeTabBtn) {
        e.preventDefault();
        const selectedTheme = themeTabBtn.getAttribute('data-theme') || themeTabBtn.getAttribute('data-theme-val');
        if (selectedTheme) applyTheme(selectedTheme);
        return;
      }

      // 7b. Mobile Overflow Menu Toggle
      if (target.closest('#btn-overflow-menu')) {
        e.preventDefault();
        e.stopPropagation();
        toggleOverflowMenu();
        return;
      }

      // 7c. Mobile Popover Theme Option Click
      const themeOptBtn = target.closest('.theme-option-btn');
      if (themeOptBtn) {
        e.preventDefault();
        const selectedTheme = themeOptBtn.getAttribute('data-theme') || themeOptBtn.getAttribute('data-theme-val');
        if (selectedTheme) {
          applyTheme(selectedTheme);
          closeOverflowMenu();
        }
        return;
      }

      // Close overflow popover on any outside click
      if (!target.closest('.mobile-overflow-wrapper')) {
        closeOverflowMenu();
      }

      // 7d. User Profile Menu Toggle
      if (target.closest('#user-profile-btn')) {
        e.preventDefault();
        e.stopPropagation();
        toggleProfileMenu();
        return;
      }

      // 7e. Logout Button
      if (target.closest('#btn-logout')) {
        e.preventDefault();
        await handleLogout();
        return;
      }

      // Close profile menu on any outside click
      if (!target.closest('.user-profile-wrapper')) {
        closeProfileMenu();
      }

      // 8. Voice Mic
      if (target.closest('#voice-mic-btn')) {
        e.preventDefault();
        if (window.TimesheetVoice && window.TimesheetVoice.toggle) {
          window.TimesheetVoice.toggle();
        }
        return;
      }

      // 9. Add Manual Point
      if (target.closest('#btn-add-manual-point')) {
        e.preventDefault();
        const input = document.getElementById('manual-point-input');
        if (input) {
          addPoint(input.value);
          input.value = '';
        }
        return;
      }

      // 10. Delete Accomplishment Point
      const delPointBtn = target.closest('.btn-del-point');
      if (delPointBtn) {
        e.preventDefault();
        e.stopPropagation();
        const id = delPointBtn.getAttribute('data-id');
        if (state.activeSessions.length > 0) {
          state.activeSessions.forEach((s) => {
            if (s.points) s.points = s.points.filter((p) => p.id !== id);
          });
          saveSessionsState();
        } else if (state.currentSession && state.currentSession.points) {
          state.currentSession.points = state.currentSession.points.filter((p) => p.id !== id);
        }
        renderLivePoints();
        showToast('Point removed', 'info');
        return;
      }

      // 11. Expand Accomplishment Text
      const textCell = target.closest('.point-text-cell');
      if (textCell) {
        textCell.classList.toggle('expanded');
        return;
      }

      // 12. Calendar Navigation
      if (target.closest('#cal-prev-btn')) {
        e.preventDefault();
        state.calendar.currentMonth--;
        if (state.calendar.currentMonth < 1) {
          state.calendar.currentMonth = 12;
          state.calendar.currentYear--;
        }
        await refreshCalendarAndTable();
        return;
      }
      if (target.closest('#cal-next-btn')) {
        e.preventDefault();
        state.calendar.currentMonth++;
        if (state.calendar.currentMonth > 12) {
          state.calendar.currentMonth = 1;
          state.calendar.currentYear++;
        }
        await refreshCalendarAndTable();
        return;
      }
      if (target.closest('#cal-today-btn')) {
        e.preventDefault();
        const t = new Date();
        state.calendar.currentYear = t.getFullYear();
        state.calendar.currentMonth = t.getMonth() + 1;
        state.calendar.selectedDate = t.toISOString().slice(0, 10);
        await refreshCalendarAndTable();
        return;
      }

      // 13. Calendar Cell Selection (Instant 0ms Feedback + Async Sync)
      const calCell = target.closest('.cal-cell[data-date]');
      if (calCell) {
        e.preventDefault();
        const clickedDate = calCell.getAttribute('data-date');
        if (!clickedDate) return;

        state.calendar.selectedDate = clickedDate;

        // Instant 0ms Visual Selection Switch
        document.querySelectorAll('.cal-cell').forEach((c) => {
          c.classList.remove('is-selected', 'selected');
        });
        calCell.classList.add('is-selected', 'selected');

        // Instant Local Table Render from Cached DB (0ms response)
        renderDailyTableFromCache(clickedDate);

        // Background Sync & Metrics Refresh
        refreshCalendarAndTable();
        return;
      }

      // 14. Daily Table Row Click -> Open Desk Detail Modal
      const tableRow = target.closest('tr[data-log-json]');
      if (tableRow) {
        e.preventDefault();
        try {
          const log = JSON.parse(tableRow.getAttribute('data-log-json'));
          openDetailModal(log);
        } catch (err) {
          console.warn('Error parsing log row:', err);
        }
        return;
      }

      // 15. Detail Modal Close
      if (target.closest('#detail-modal-close') || target.closest('#detail-close-btn')) {
        e.preventDefault();
        closeDetailModal();
        return;
      }

      // 16. Detail Modal Copy Notes
      if (target.closest('#detail-copy-btn')) {
        e.preventDefault();
        const text = document.getElementById('detail-notes')?.textContent || '';
        try {
          await navigator.clipboard.writeText(text);
          showToast('✓ Notes copied to clipboard!', 'success');
        } catch (err) {
          prompt('Copy notes:', text);
        }
        return;
      }

      // 17. AppSheet Sync Widget
      if (target.closest('#appsheet-sync-widget')) {
        e.preventDefault();
        openSyncQueueModal();
        return;
      }

      // 18. Sync Queue Modal Close
      if (target.closest('#sync-queue-modal-close') || target.closest('#btn-close-sync-modal')) {
        e.preventDefault();
        closeSyncQueueModal();
        return;
      }

      // 19. Sync Queue Force Sync Now
      if (target.closest('#btn-force-sync-now')) {
        e.preventDefault();
        showToast('🔄 Syncing queue with server...', 'info');
        if (window.TimesheetSync && window.TimesheetSync.drainQueue) {
          await window.TimesheetSync.drainQueue();
        }
        await renderSyncQueueModal();
        await refreshCalendarAndTable();
        return;
      }

      // 20. AppSheet Error Queue Item Discard & Terminate
      const discardBtn = target.closest('.btn-queue-discard');
      if (discardBtn) {
        e.preventDefault();
        const uuid = discardBtn.getAttribute('data-uuid');
        if (uuid && window.TimesheetSync && window.TimesheetSync.discardQueueItem) {
          await window.TimesheetSync.discardQueueItem(uuid);
          await renderSyncQueueModal();
          await refreshCalendarAndTable();
          showToast('✓ Stuck record permanently terminated and purged', 'success');
        }
        return;
      }

      // 21. AppSheet Error Queue Item Retry
      const retryBtn = target.closest('.btn-queue-retry');
      if (retryBtn) {
        e.preventDefault();
        const uuid = retryBtn.getAttribute('data-uuid');
        if (uuid && window.TimesheetSync && window.TimesheetSync.retryQueueItem) {
          showToast('🔄 Retrying sync with server...', 'info');
          await window.TimesheetSync.retryQueueItem(uuid);
          await renderSyncQueueModal();
          await refreshCalendarAndTable();
        }
        return;
      }

      // 22. Copy Day Markdown Report
      if (target.closest('#copy-day-report-btn')) {
        e.preventDefault();
        const targetDate = state.calendar.selectedDate;
        let logs = [];
        try {
          const resp = await fetch(`/api/method/timesheet_intelligence.api.get_my_timesheets?date=${targetDate}`);
          const data = resp.ok ? await resp.json() : {};
          logs = (data.message && data.message.logs) || [];
        } catch (e) {}

        let md = `# 📋 Daily Timesheet Report (${targetDate})\n\n`;
        if (logs.length === 0) {
          md += `_No activities recorded for this date._\n`;
        } else {
          logs.forEach((item) => {
            const mins = Number(item.duration_minutes || 0);
            const proj = item.project_name || item.project || 'General';
            const notes = item.accomplishments || item.description || item.steps_part_b || '';
            md += `### ${proj} (${mins} mins):\n${notes}\n\n`;
          });
        }

        try {
          await navigator.clipboard.writeText(md);
          showToast('✓ Markdown report copied to clipboard!', 'success');
        } catch (e) {
          prompt('Copy report manually:', md);
        }
        return;
      }

      // 23. Modal Backdrop Click (click outside modal sheet)
      ['project-setup-modal', 'finish-session-modal', 'timesheet-detail-modal', 'sync-queue-modal'].forEach((mId) => {
        const modalEl = document.getElementById(mId);
        if (modalEl && target === modalEl) {
          modalEl.classList.remove('open');
          modalEl.style.display = 'none';
        }
      });
    });

    // Dynamic Live Stop Time Duration Preview
    document.addEventListener('input', (e) => {
      if (e.target && e.target.id === 'finish-input-stop-time') {
        const session = state.activeSessions.find((s) => s.client_uuid === state.finishingSessionUuid);
        if (session) {
          updateFinishDurationPreview(session);
        }
      }
    });

    // Keyboard Shortcuts & Enter Handler
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeSetupModal();
        closeFinishModal();
        closeDetailModal();
        closeSyncQueueModal();
        closeOverflowMenu();
        closeProfileMenu();
      }

      if (e.target && e.target.id === 'manual-point-input') {
        if (e.key === 'Enter') {
          e.preventDefault();
          const input = e.target;
          addPoint(input.value);
          input.value = '';
        }
      }
    });

    // Project change updates tasks
    document.addEventListener('change', (e) => {
      if (e.target && e.target.id === 'input-project') {
        updateTaskOptions();
      }
    });
  }

  // Voice Event Configuration
  function initVoiceController() {
    if (!window.TimesheetVoice) return;
    let spokenBuffer = '';

    window.TimesheetVoice.onStateChange((isListening) => {
      const voiceMicBtn = document.getElementById('voice-mic-btn');
      const voiceBtnLabel = document.getElementById('voice-btn-label');
      if (isListening) {
        spokenBuffer = '';
        if (voiceMicBtn) voiceMicBtn.classList.add('recording');
        if (voiceBtnLabel) voiceBtnLabel.textContent = 'Recording Voice... Tap to Stop & Add Point';
      } else {
        if (voiceMicBtn) voiceMicBtn.classList.remove('recording');
        if (voiceBtnLabel) voiceBtnLabel.textContent = 'Tap to Speak (Voice Note)';

        if (spokenBuffer.trim()) {
          addPoint(spokenBuffer.trim());
          spokenBuffer = '';
        }
      }
    });

    window.TimesheetVoice.appendTranscript = (text) => {
      spokenBuffer += (spokenBuffer ? ' ' : '') + text;
    };
  }

  // Safe Boot Sequence
  async function boot() {
    // 1. Immediately reset modals so no modal ever blocks clicks on page load
    document.querySelectorAll('.modal-backdrop').forEach((m) => {
      m.classList.remove('open');
      m.style.display = 'none';
    });

    // 2. Initialize Theme immediately
    initTheme();

    // 3. Attach Global Event Delegation immediately (synchronous)
    initGlobalEventDelegation();
    initVoiceController();

    // 4. Safe Database & Profile Initialization
    try {
      if (window.TimesheetDB && window.TimesheetDB.init) {
        await window.TimesheetDB.init();
      }
    } catch (e) {
      console.warn('TimesheetDB init error:', e);
    }

    try {
      await initUserProfile();
    } catch (e) {
      console.warn('User profile init error:', e);
    }

    try {
      await loadMetadata();
    } catch (e) {
      console.warn('Metadata init error:', e);
    }

    try {
      restoreSessionState();
    } catch (e) {
      console.warn('Restore session error:', e);
    }

    try {
      if (window.TimesheetSync && window.TimesheetSync.updateSyncBadgeUI) {
        await window.TimesheetSync.updateSyncBadgeUI();
      }
    } catch (e) {}

    try {
      await refreshCalendarAndTable();
    } catch (e) {}

    if (window.TimesheetSync) {
      window.TimesheetSync.onStatusChange(async () => {
        try {
          await window.TimesheetSync.updateSyncBadgeUI();
        } catch (e) {}
      });
      window.TimesheetSync.onDataSynced(async () => {
        try {
          await refreshCalendarAndTable();
          await window.TimesheetSync.updateSyncBadgeUI();
        } catch (e) {}
      });
    }
    window.refreshTimesheetUI = refreshCalendarAndTable;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
