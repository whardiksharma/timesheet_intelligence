/**
 * TimesheetApp: Clean, Compact, AppSheet-Grade Unified Sync Controller
 * Implements:
 * 1. AppSheet-Style Unified Sync Indicator Widget (#appsheet-sync-widget)
 * 2. Mobile Navbar Optimization (Hides top "+ Start Work" on mobile viewports)
 * 3. Offline Queue Drawer with Conditional Discard (Discard & Retry ONLY on failed/stuck items)
 * 4. Automatic Session Binding to Logged-in User (frappe.session.user)
 * 5. Cross-Account Data Isolation (Purges local cache on account switch)
 * 6. Strict State Machine: Idle vs Active (Instant Unmount on Finish)
 * 7. Mandatory Accomplishment Validation Guard (Shakes input, blocks empty submissions)
 * 8. Safe Page Refresh Reconstruction (No lost time on reload)
 * 9. Google Calendar-Style Monthly Attendance Overview (< Prev / Next >, KPI Badges, Date Filtering)
 * 10. Daily Breakdown Table with Clickable Row -> Frappe Desk Modal
 * 100% WCAG 2.2 AA Compliant.
 */

document.addEventListener('DOMContentLoaded', async () => {
  // Initialize Database
  await window.TimesheetDB.init();

  // Application State
  const now = new Date();
  const state = {
    timer: {
      interval: null,
      startTime: null, // timestamp in ms
      elapsedSeconds: 0,
      isRunning: false
    },
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
    return new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // Format Seconds to HH:MM:SS
  function formatSeconds(totalSec) {
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return (
      (h < 10 ? '0' + h : h) + ':' +
      (m < 10 ? '0' + m : m) + ':' +
      (s < 10 ? '0' + s : s)
    );
  }

  const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  // DOM Elements
  const themeToggleBtn = document.getElementById('theme-toggle-btn');
  const userProfileBadge = document.getElementById('user-profile-badge');
  const btnHeaderStart = document.getElementById('btn-header-start');
  const appsheetSyncWidget = document.getElementById('appsheet-sync-widget');

  const activeSessionCard = document.getElementById('active-session-card');
  const idleSessionCard = document.getElementById('idle-session-card');
  const sessionStatusPill = document.getElementById('session-status-pill');
  const sessionStatusLabel = document.getElementById('session-status-label');
  const timerDisplay = document.getElementById('timer-display');
  const timerPauseBtn = document.getElementById('timer-pause-btn');
  const timerResumeBtn = document.getElementById('timer-resume-btn');
  const btnFinishAndNext = document.getElementById('btn-finish-and-next');
  const btnChangeProject = document.getElementById('btn-change-project');
  const btnStartNewSession = document.getElementById('btn-start-new-session');

  const activeProjectLabel = document.getElementById('active-project-label');
  const activeTaskLabel = document.getElementById('active-task-label');
  const activeActivityLabel = document.getElementById('active-activity-label');
  const activeStartTimeLabel = document.getElementById('active-start-time-label');

  const setupModal = document.getElementById('project-setup-modal');
  const setupModalClose = document.getElementById('setup-modal-close');
  const setupModalTitle = document.getElementById('setup-modal-title');
  const btnStartSessionModal = document.getElementById('btn-start-session-modal');

  const projectSelect = document.getElementById('input-project');
  const taskSelect = document.getElementById('input-task');
  const activitySelect = document.getElementById('input-activity');
  const billableCheck = document.getElementById('input-billable');

  const voiceMicBtn = document.getElementById('voice-mic-btn');
  const voiceBtnLabel = document.getElementById('voice-btn-label');
  const manualPointInput = document.getElementById('manual-point-input');
  const btnAddManualPoint = document.getElementById('btn-add-manual-point');
  const livePointsTableBody = document.getElementById('live-points-table-body');
  const pointsCounter = document.getElementById('points-counter');

  // Calendar DOM Elements
  const calPrevBtn = document.getElementById('cal-prev-btn');
  const calNextBtn = document.getElementById('cal-next-btn');
  const calTodayBtn = document.getElementById('cal-today-btn');
  const calMonthTitle = document.getElementById('cal-month-title');
  const kpiTodayHours = document.getElementById('kpi-today-hours');
  const kpiMonthHours = document.getElementById('kpi-month-hours');
  const calendarDaysGrid = document.getElementById('calendar-days-grid');

  // Daily Table DOM Elements
  const dailyTableTitle = document.getElementById('daily-table-title');
  const dailyTableBody = document.getElementById('daily-table-body');
  const todayTotalHoursEl = document.getElementById('today-total-hours');
  const copyDayReportBtn = document.getElementById('copy-day-report-btn');

  // Details Modal Elements
  const detailModal = document.getElementById('timesheet-detail-modal');
  const detailModalClose = document.getElementById('detail-modal-close');
  const detailCloseBtn = document.getElementById('detail-close-btn');
  const detailCopyBtn = document.getElementById('detail-copy-btn');
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

  // AppSheet Sync Queue Modal Elements
  const syncQueueModal = document.getElementById('sync-queue-modal');
  const syncQueueModalClose = document.getElementById('sync-queue-modal-close');
  const syncModalStatusBadge = document.getElementById('sync-modal-status-badge');
  const syncQueueListContainer = document.getElementById('sync-queue-list-container');
  const syncModalFooterCount = document.getElementById('sync-modal-footer-count');
  const btnForceSyncNow = document.getElementById('btn-force-sync-now');
  const btnCloseSyncModal = document.getElementById('btn-close-sync-modal');

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
            await window.TimesheetDB.clearAllUserData();
            localStorage.removeItem('timesheet_active_session');
          }
          localStorage.setItem('timesheet_logged_user', profile.user);

          // Update Top Bar User Badge
          if (userProfileBadge) {
            userProfileBadge.textContent = `👤 ${profile.full_name || profile.user}`;
            userProfileBadge.title = `Logged in as ${profile.user} (${profile.employee_name || 'Standard Employee'})`;
          }
        }
      }
    } catch (e) {
      console.warn('Could not fetch user profile:', e);
    }
  }

  // 2. Theme Controller (Dark / Light)
  function initTheme() {
    const savedTheme = localStorage.getItem('timesheet_theme') || 'dark';
    applyTheme(savedTheme);
  }

  function applyTheme(theme) {
    if (theme === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
      if (themeToggleBtn) themeToggleBtn.textContent = '☀️ Light';
    } else {
      document.documentElement.removeAttribute('data-theme');
      if (themeToggleBtn) themeToggleBtn.textContent = '🌙 Dark';
    }
    localStorage.setItem('timesheet_theme', theme);
  }

  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
      applyTheme(current === 'light' ? 'dark' : 'light');
    });
  }

  // 3. Setup Modal Controls (Start / Switch)
  function openSetupModal(mode = 'new') {
    state.modalMode = mode;
    if (setupModal) {
      if (mode === 'switch') {
        setupModalTitle.textContent = 'Switch to Another Project';
        btnStartSessionModal.textContent = '🔄 Log Current & Switch Project';
      } else {
        setupModalTitle.textContent = 'What are you working on?';
        btnStartSessionModal.textContent = '🚀 Start Work Session';
      }
      setupModal.classList.add('open');
      setupModal.style.display = 'flex';
      setupModal.setAttribute('aria-hidden', 'false');
      if (projectSelect) projectSelect.focus();
    }
  }

  function closeSetupModal() {
    if (setupModal) {
      setupModal.classList.remove('open');
      setupModal.style.display = 'none';
      setupModal.setAttribute('aria-hidden', 'true');
    }
  }

  if (setupModalClose) setupModalClose.addEventListener('click', closeSetupModal);
  if (btnHeaderStart) btnHeaderStart.addEventListener('click', () => openSetupModal('new'));
  if (btnStartNewSession) btnStartNewSession.addEventListener('click', () => openSetupModal('new'));
  if (btnChangeProject) btnChangeProject.addEventListener('click', () => openSetupModal('switch'));

  // 4. Start or Switch Working Session
  async function handleModalSubmit() {
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

    // IF SWITCHING: Cleanly log and save previous project first!
    if (state.modalMode === 'switch' && state.currentSession.project && state.timer.elapsedSeconds > 0) {
      await saveCurrentSessionToLog(`Switched project to ${projName}`);
      showToast(`✓ Logged previous project! Switched to ${projName}`, 'info');
    }

    const now = new Date();
    state.currentSession = {
      project: projName,
      projectId: projId,
      task: taskName,
      activity: actName,
      isBillable: isBillable,
      startTime: now.toISOString(),
      points: []
    };

    // Update UI Elements
    if (activeProjectLabel) activeProjectLabel.textContent = projName;
    if (activeTaskLabel) activeTaskLabel.textContent = taskName || 'General Task';
    if (activeActivityLabel) activeActivityLabel.textContent = actName;
    if (activeStartTimeLabel) activeStartTimeLabel.textContent = `Started ${formatTimeOnly(now)}`;

    // Transition State: Mount Active Card, Unmount Idle Card
    if (idleSessionCard) idleSessionCard.style.display = 'none';
    if (activeSessionCard) activeSessionCard.style.display = 'block';

    // Clear points and start stopwatch
    renderLivePoints();
    resetTimer();
    startTimer();

    // Close Modal
    closeSetupModal();
    saveSessionState();

    if (window.TimesheetVoice && window.TimesheetVoice.playTone) {
      window.TimesheetVoice.playTone('start');
    }
    showToast(`🚀 Started: ${projName}`, 'success');
  }

  if (btnStartSessionModal) {
    btnStartSessionModal.addEventListener('click', handleModalSubmit);
  }

  // 5. Timer Logic with Safe Page Refresh Reconstruction
  function saveSessionState() {
    localStorage.setItem('timesheet_active_session', JSON.stringify({
      currentSession: state.currentSession,
      timer: {
        isRunning: state.timer.isRunning,
        startTime: state.timer.startTime,
        elapsedSeconds: state.timer.elapsedSeconds
      }
    }));
  }

  function restoreSessionState() {
    const saved = localStorage.getItem('timesheet_active_session');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.currentSession && parsed.currentSession.project) {
          state.currentSession = parsed.currentSession;
          if (activeProjectLabel) activeProjectLabel.textContent = state.currentSession.project;
          if (activeTaskLabel) activeTaskLabel.textContent = state.currentSession.task || 'General Task';
          if (activeActivityLabel) activeActivityLabel.textContent = state.currentSession.activity || 'Development';
          if (activeStartTimeLabel && state.currentSession.startTime) {
            activeStartTimeLabel.textContent = `Started ${formatTimeOnly(state.currentSession.startTime)}`;
          }

          renderLivePoints();

          // SAFE PAGE REFRESH RECONSTRUCTION:
          if (parsed.timer && parsed.timer.isRunning && parsed.timer.startTime) {
            const now = Date.now();
            state.timer.elapsedSeconds = Math.max(1, Math.floor((now - parsed.timer.startTime) / 1000));
            state.timer.startTime = parsed.timer.startTime;

            if (idleSessionCard) idleSessionCard.style.display = 'none';
            if (activeSessionCard) activeSessionCard.style.display = 'block';
            startTimerLoop();
            return;
          } else if (parsed.timer && parsed.timer.elapsedSeconds > 0) {
            state.timer.elapsedSeconds = parsed.timer.elapsedSeconds;
            if (timerDisplay) timerDisplay.textContent = formatSeconds(state.timer.elapsedSeconds);
            if (idleSessionCard) idleSessionCard.style.display = 'none';
            if (activeSessionCard) activeSessionCard.style.display = 'block';
            setTimerVisualState('paused');
            return;
          }
        }
      } catch (e) {
        console.warn('Error restoring session:', e);
      }
    }

    // Default: Idle State
    if (idleSessionCard) idleSessionCard.style.display = 'flex';
    if (activeSessionCard) activeSessionCard.style.display = 'none';
  }

  function setTimerVisualState(status) {
    if (status === 'running') {
      if (timerPauseBtn) timerPauseBtn.style.display = 'inline-flex';
      if (timerResumeBtn) timerResumeBtn.style.display = 'none';
      if (sessionStatusPill) {
        sessionStatusPill.className = 'session-status-badge running';
        sessionStatusLabel.textContent = 'LIVE RECORDING';
      }
      if (timerDisplay) {
        timerDisplay.style.color = 'var(--accent-cyan)';
      }
    } else if (status === 'paused') {
      if (timerPauseBtn) timerPauseBtn.style.display = 'none';
      if (timerResumeBtn) timerResumeBtn.style.display = 'inline-flex';
      if (sessionStatusPill) {
        sessionStatusPill.className = 'session-status-badge paused';
        sessionStatusLabel.textContent = 'PAUSED';
      }
      if (timerDisplay) {
        timerDisplay.style.color = 'var(--text-muted)';
      }
    }
  }

  function startTimerLoop() {
    if (state.timer.interval) clearInterval(state.timer.interval);
    state.timer.interval = setInterval(() => {
      state.timer.elapsedSeconds++;
      if (timerDisplay) timerDisplay.textContent = formatSeconds(state.timer.elapsedSeconds);
      if (state.timer.elapsedSeconds % 5 === 0) {
        saveSessionState();
      }
    }, 1000);

    state.timer.isRunning = true;
    setTimerVisualState('running');
  }

  function startTimer() {
    state.timer.isRunning = true;
    state.timer.startTime = Date.now() - state.timer.elapsedSeconds * 1000;
    startTimerLoop();
    saveSessionState();
  }

  function pauseTimer() {
    state.timer.isRunning = false;
    clearInterval(state.timer.interval);
    state.timer.interval = null;
    setTimerVisualState('paused');
    saveSessionState();
  }

  function resetTimer() {
    if (state.timer.isRunning) pauseTimer();
    state.timer.elapsedSeconds = 0;
    state.timer.startTime = null;
    if (timerDisplay) timerDisplay.textContent = '00:00:00';
    saveSessionState();
  }

  if (timerPauseBtn) timerPauseBtn.addEventListener('click', pauseTimer);
  if (timerResumeBtn) timerResumeBtn.addEventListener('click', startTimer);

  // 6. Work Accomplishments Manager
  function addPoint(text) {
    if (!text || !text.trim()) return;
    const cleanText = text.trim();
    const timeStr = formatTimeOnly(new Date());

    const newPoint = {
      id: 'pt_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      time: timeStr,
      text: cleanText
    };

    state.currentSession.points.push(newPoint);
    renderLivePoints();
    saveSessionState();

    if (window.TimesheetVoice && window.TimesheetVoice.playTone) {
      window.TimesheetVoice.playTone('save');
    }
    showToast(`✓ Added: "${cleanText.slice(0, 24)}..."`, 'info');
  }

  function renderLivePoints() {
    const tableBody = document.getElementById('live-points-table-body');
    if (!tableBody) return;
    tableBody.innerHTML = '';

    const pts = state.currentSession.points || [];
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
        <td class="table-time-cell" style="width: 25%;">
          <span class="meta-pill pill-time" style="font-size: 0.74rem;">${pt.time}</span>
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

  // EVENT DELEGATION: Accomplishments Table Body (Delete point & Expand text)
  if (livePointsTableBody) {
    livePointsTableBody.addEventListener('click', (e) => {
      const delBtn = e.target.closest('.btn-del-point');
      if (delBtn) {
        e.stopPropagation();
        const id = delBtn.getAttribute('data-id');
        state.currentSession.points = state.currentSession.points.filter((p) => p.id !== id);
        renderLivePoints();
        saveSessionState();
        showToast('Point removed', 'info');
        return;
      }

      const textCell = e.target.closest('.point-text-cell');
      if (textCell) {
        textCell.classList.toggle('expanded');
      }
    });
  }

  if (btnAddManualPoint && manualPointInput) {
    btnAddManualPoint.addEventListener('click', () => {
      addPoint(manualPointInput.value);
      manualPointInput.value = '';
    });

    manualPointInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || ((e.ctrlKey || e.metaKey) && e.key === 'Enter')) {
        e.preventDefault();
        addPoint(manualPointInput.value);
        manualPointInput.value = '';
      }
    });
  }

  // Voice Recording
  if (voiceMicBtn) {
    let spokenBuffer = '';

    window.TimesheetVoice.onStateChange((isListening) => {
      if (isListening) {
        spokenBuffer = '';
        voiceMicBtn.classList.add('recording');
        if (voiceBtnLabel) voiceBtnLabel.textContent = 'Recording Voice... Tap to Stop & Add Point';
      } else {
        voiceMicBtn.classList.remove('recording');
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

    voiceMicBtn.addEventListener('click', () => {
      window.TimesheetVoice.toggle();
    });
  }

  // 7. Save Current Session: Bind Logged-in User Profile Automatically
  async function saveCurrentSessionToLog(customDefaultDesc = '') {
    const now = new Date();
    const fromTime = state.currentSession.startTime || new Date(now.getTime() - Math.max(1, state.timer.elapsedSeconds) * 1000).toISOString();
    const toTime = now.toISOString();
    const durationMinutes = Math.max(1, Math.round(state.timer.elapsedSeconds / 60));

    let description = '';
    if (state.currentSession.points && state.currentSession.points.length > 0) {
      description = state.currentSession.points.map((p) => `• [${p.time}] ${p.text}`).join('\n');
    } else {
      description = customDefaultDesc || `Completed work on ${state.currentSession.project || 'General Operations'}`;
    }

    const logItem = {
      client_uuid: 'uuid_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9),
      project: state.currentSession.projectId || 'PROJ-GENERAL',
      project_name: state.currentSession.project || 'General Operations',
      task: state.currentSession.task,
      task_name: state.currentSession.task,
      activity_type: state.currentSession.activity || 'Development',
      employee_id: state.currentUserProfile.employee_id || state.currentUserProfile.user || 'Administrator',
      employee_name: state.currentUserProfile.employee_name || state.currentUserProfile.full_name || 'Administrator',
      user: state.currentUserProfile.user || 'Administrator',
      from_time: fromTime,
      to_time: toTime,
      duration_minutes: durationMinutes,
      is_billable: state.currentSession.isBillable ? 1 : 0,
      description: description,
      timestamp: now.toISOString(),
      sync_status: 'pending',
      error_message: null,
      retry_count: 0
    };

    // Save to Local DB
    await window.TimesheetDB.addToQueue(logItem);

    if (window.TimesheetVoice && window.TimesheetVoice.playTone) {
      window.TimesheetVoice.playTone('save');
    }

    // Drain queue in background to sync to Frappe
    await window.TimesheetSync.updateSyncBadgeUI();
    window.TimesheetSync.drainQueue();
    return logItem;
  }

  // 8. Finish Session: MANDATORY ACCOMPLISHMENT GUARD -> UNMOUNT & HIDE ACTIVE CARD
  async function finishSessionAndUnmount() {
    // 1. MANDATORY ACCOMPLISHMENT VALIDATION
    if (!state.currentSession.points || state.currentSession.points.length === 0) {
      showToast('⚠️ Please add at least one work accomplishment point before finishing.', 'warning');
      if (manualPointInput) {
        manualPointInput.classList.add('input-error-shake');
        manualPointInput.focus();
        setTimeout(() => manualPointInput.classList.remove('input-error-shake'), 600);
      }
      return;
    }

    if (state.timer.isRunning) pauseTimer();

    const durationMinutes = Math.max(1, Math.round(state.timer.elapsedSeconds / 60));
    await saveCurrentSessionToLog();

    showToast(`✓ Completed & saved ${durationMinutes} mins!`, 'success');

    // Reset session and timer
    resetTimer();
    state.currentSession = {
      project: '',
      projectId: '',
      task: '',
      activity: 'Development',
      isBillable: true,
      startTime: null,
      points: []
    };
    renderLivePoints();
    localStorage.removeItem('timesheet_active_session');

    // UNMOUNT ACTIVE CARD & REVERT TO IDLE CARD
    if (activeSessionCard) activeSessionCard.style.display = 'none';
    if (idleSessionCard) idleSessionCard.style.display = 'flex';

    // Refresh Calendar & Table
    await refreshCalendarAndTable();
  }

  if (btnFinishAndNext) {
    btnFinishAndNext.addEventListener('click', finishSessionAndUnmount);
  }

  // 9. Google Calendar Engine (Monthly Attendance Overview)
  async function refreshCalendarAndTable() {
    const { currentYear, currentMonth, selectedDate } = state.calendar;

    try {
      const resp = await fetch(`/api/method/timesheet_intelligence.api.get_my_timesheets?year=${currentYear}&month=${currentMonth}&date=${selectedDate}`);
      if (resp.ok) {
        const data = await resp.json();
        const res = data.message || {};
        state.calendar.dailySummary = res.daily_summary || {};
        state.calendar.monthTotalHours = res.month_total_hours || 0.0;
        state.calendar.todayTotalHours = res.today_total_hours || 0.0;

        renderCalendarGrid();
        renderDailyTable(res.logs || []);
        return;
      }
    } catch (e) {
      console.warn('Failed to load online timesheets:', e);
    }

    // Fallback: render from local cache
    renderCalendarGrid();
    const cached = await window.TimesheetDB.getCachedTimesheets();
    renderDailyTable(cached);
  }

  function renderCalendarGrid() {
    const { currentYear, currentMonth, selectedDate, dailySummary, monthTotalHours, todayTotalHours } = state.calendar;

    // Update Header
    if (calMonthTitle) {
      calMonthTitle.textContent = `${MONTH_NAMES[currentMonth - 1]} ${currentYear}`;
    }
    if (kpiTodayHours) {
      kpiTodayHours.textContent = `${todayTotalHours.toFixed(1)} hrs`;
    }
    if (kpiMonthHours) {
      kpiMonthHours.textContent = `${monthTotalHours.toFixed(1)} hrs`;
    }

    if (!calendarDaysGrid) return;
    calendarDaysGrid.innerHTML = '';

    const firstDayIndex = new Date(currentYear, currentMonth - 1, 1).getDay();
    const adjustedFirstDay = (firstDayIndex + 6) % 7;
    const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
    const todayStr = new Date().toISOString().slice(0, 10);

    // 1. Previous Month Padding Days
    const prevMonthDays = new Date(currentYear, currentMonth - 1, 0).getDate();
    for (let i = adjustedFirstDay - 1; i >= 0; i--) {
      const dayNum = prevMonthDays - i;
      const cell = document.createElement('div');
      cell.className = 'cal-cell other-month';
      cell.innerHTML = `<div class="cal-cell-top"><span class="cal-date-num">${dayNum}</span></div>`;
      calendarDaysGrid.appendChild(cell);
    }

    // 2. Current Month Days
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const dayOfWeek = new Date(currentYear, currentMonth - 1, day).getDay();
      const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);
      const isToday = (dateStr === todayStr);
      const isSelected = (dateStr === selectedDate);

      const hours = dailySummary[dateStr] || 0.0;
      const isPresent = hours >= 4.0;
      const isPartial = hours > 0 && hours < 4.0;

      const cell = document.createElement('div');
      cell.className = `cal-cell ${isWeekend ? 'weekend' : ''} ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''}`;
      cell.setAttribute('data-date', dateStr);
      cell.setAttribute('role', 'button');
      cell.setAttribute('tabindex', '0');
      cell.setAttribute('aria-label', `${MONTH_NAMES[currentMonth - 1]} ${day}, ${currentYear}: ${hours.toFixed(1)} hours logged`);

      let badgeHtml = '';
      if (hours > 0) {
        badgeHtml = `<span class="cal-hours-badge ${isPresent ? 'present' : 'partial'}">${hours.toFixed(1)}h</span>`;
      }

      let dotHtml = '';
      if (isPresent) {
        dotHtml = '<span class="cal-indicator-dot present" title="Present (≥ 4h)"></span>';
      } else if (isPartial) {
        dotHtml = '<span class="cal-indicator-dot partial" title="Partial (< 4h)"></span>';
      }

      cell.innerHTML = `
        <div class="cal-cell-top">
          <span class="cal-date-num">${day}</span>
          ${dotHtml}
        </div>
        ${badgeHtml}
      `;

      calendarDaysGrid.appendChild(cell);
    }
  }

  // EVENT DELEGATION: Calendar Days Grid (Click date -> filter table)
  if (calendarDaysGrid) {
    calendarDaysGrid.addEventListener('click', (e) => {
      const cell = e.target.closest('.cal-cell[data-date]');
      if (cell && !cell.classList.contains('other-month')) {
        const dateStr = cell.getAttribute('data-date');
        if (dateStr) {
          state.calendar.selectedDate = dateStr;
          renderCalendarGrid();
          filterTableByDate(dateStr);
        }
      }
    });

    calendarDaysGrid.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        const cell = e.target.closest('.cal-cell[data-date]');
        if (cell && !cell.classList.contains('other-month')) {
          e.preventDefault();
          const dateStr = cell.getAttribute('data-date');
          if (dateStr) {
            state.calendar.selectedDate = dateStr;
            renderCalendarGrid();
            filterTableByDate(dateStr);
          }
        }
      }
    });
  }

  // Month Navigation Listeners
  if (calPrevBtn) {
    calPrevBtn.addEventListener('click', () => {
      state.calendar.currentMonth--;
      if (state.calendar.currentMonth < 1) {
        state.calendar.currentMonth = 12;
        state.calendar.currentYear--;
      }
      refreshCalendarAndTable();
    });
  }

  if (calNextBtn) {
    calNextBtn.addEventListener('click', () => {
      state.calendar.currentMonth++;
      if (state.calendar.currentMonth > 12) {
        state.calendar.currentMonth = 1;
        state.calendar.currentYear++;
      }
      refreshCalendarAndTable();
    });
  }

  if (calTodayBtn) {
    calTodayBtn.addEventListener('click', () => {
      const today = new Date();
      state.calendar.currentYear = today.getFullYear();
      state.calendar.currentMonth = today.getMonth() + 1;
      state.calendar.selectedDate = today.toISOString().slice(0, 10);
      refreshCalendarAndTable();
    });
  }

  // 10. Daily Breakdown Table Controller
  async function filterTableByDate(targetDate) {
    try {
      const resp = await fetch(`/api/method/timesheet_intelligence.api.get_my_timesheets?date=${targetDate}`);
      if (resp.ok) {
        const data = await resp.json();
        const logs = (data.message && data.message.logs) || [];
        renderDailyTable(logs, targetDate);
        return;
      }
    } catch (e) {
      console.warn('Failed to fetch logs for date:', e);
    }

    const cached = await window.TimesheetDB.getCachedTimesheets();
    const filteredCached = cached.filter((c) => (c.from_time || '').slice(0, 10) === targetDate);
    renderDailyTable(filteredCached, targetDate);
  }

  async function renderDailyTable(logs, activeDate = state.calendar.selectedDate) {
    if (!dailyTableBody) return;
    dailyTableBody.innerHTML = '';

    const queue = await window.TimesheetDB.getQueue();
    const filteredQueue = queue.filter((q) => (q.from_time || '').slice(0, 10) === activeDate);

    // Update Title
    const formattedDate = new Date(activeDate + 'T00:00:00').toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
    if (dailyTableTitle) {
      dailyTableTitle.textContent = `Timesheets for ${formattedDate}`;
    }

    let totalFilteredMins = 0;
    const combined = [
      ...filteredQueue.map((q) => ({ ...q, is_queued: true })),
      ...logs.map((l) => ({ ...l, is_queued: false }))
    ];

    if (combined.length === 0) {
      dailyTableBody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align: center; padding: 28px; color: var(--text-dim); font-size: 0.9rem;">
            No timesheets recorded for ${formattedDate}. Tap "Start Work" above to begin!
          </td>
        </tr>
      `;
      if (todayTotalHoursEl) todayTotalHoursEl.textContent = '0.00 hrs';
      return;
    }

    combined.forEach((item) => {
      const mins = Number(item.duration_minutes || (item.total_hours ? item.total_hours * 60 : 0));
      totalFilteredMins += mins;

      const fromStr = item.from_time ? formatTimeOnly(item.from_time) : '--';
      const toStr = item.to_time ? formatTimeOnly(item.to_time) : '--';

      const tr = document.createElement('tr');
      tr.setAttribute('data-log-json', JSON.stringify(item));
      tr.setAttribute('tabindex', '0');
      tr.setAttribute('role', 'button');
      tr.setAttribute('aria-label', `View details for ${item.project_name || item.project || 'General Operations'}, ${mins} minutes`);
      tr.innerHTML = `
        <td>
          <div class="table-project-cell">
            <span style="color:var(--accent-cyan);">⚡</span>
            <span>${escapeHtml(item.project_name || item.project || 'General Operations')}</span>
          </div>
        </td>
        <td>
          <div class="table-task-cell">
            ${item.task_name || item.task ? `<strong>${escapeHtml(item.task_name || item.task)}</strong> • ` : ''}
            <span>${escapeHtml(item.activity_type || 'Development')}</span>
          </div>
        </td>
        <td class="table-time-cell">${fromStr}</td>
        <td class="table-time-cell">${toStr}</td>
        <td class="table-duration-cell">${mins}m (${(mins/60).toFixed(2)}h)</td>
        <td>
          <span class="sync-pill ${item.is_queued ? 'offline' : ''}">
            ${item.is_queued ? (item.sync_status === 'failed' ? '⚠️ Failed' : 'Queued Offline') : 'Synced'}
          </span>
        </td>
      `;
      dailyTableBody.appendChild(tr);
    });

    if (todayTotalHoursEl) {
      todayTotalHoursEl.textContent = `${(totalFilteredMins / 60).toFixed(2)} hrs`;
    }
  }

  // EVENT DELEGATION: Daily Breakdown Table Row Click
  if (dailyTableBody) {
    dailyTableBody.addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-log-json]');
      if (tr) {
        const raw = tr.getAttribute('data-log-json');
        if (raw) {
          try {
            const data = JSON.parse(raw);
            openDetailModal(data);
          } catch (err) {
            console.error('Error parsing row JSON:', err);
          }
        }
      }
    });

    dailyTableBody.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        const tr = e.target.closest('tr[data-log-json]');
        if (tr) {
          e.preventDefault();
          const raw = tr.getAttribute('data-log-json');
          if (raw) {
            try {
              const data = JSON.parse(raw);
              openDetailModal(data);
            } catch (err) {
              console.error('Error parsing row JSON:', err);
            }
          }
        }
      }
    });
  }

  // 11. Full Details Inspection Modal
  function openDetailModal(data) {
    if (!detailModal) return;

    detailProject.textContent = data.project_name || data.project || 'General Operations';
    detailTask.textContent = data.task_name || data.task ? `Task: ${data.task_name || data.task}` : 'Task: General / No Specific Task';
    detailActivity.textContent = data.activity_type || 'Development';
    detailBilling.textContent = (data.is_billable === 1 || data.is_billable === true) ? 'Client Billable' : 'Non-Billable';

    const mins = Number(data.duration_minutes || (data.total_hours ? data.total_hours * 60 : 0));
    const hrs = (mins / 60).toFixed(2);
    detailDuration.textContent = `${mins} mins (${hrs} hrs)`;

    detailAssociate.textContent = data.employee_name || data.employee_id || state.currentUserProfile.full_name || 'Associate';
    detailFrom.textContent = data.from_time ? new Date(data.from_time).toLocaleString() : '--';
    detailTo.textContent = data.to_time ? new Date(data.to_time).toLocaleString() : '--';
    detailNotes.textContent = data.accomplishments || data.description || data.steps_part_b || data.summary_part_a || 'No notes logged';

    if (data.is_queued) {
      detailStatusPill.className = 'sync-pill offline';
      detailStatusPill.textContent = data.sync_status === 'failed' ? '⚠️ Sync Failed' : 'Queued Offline';
      if (detailDeskLink) detailDeskLink.style.display = 'none';
    } else {
      detailStatusPill.className = 'sync-pill';
      detailStatusPill.textContent = 'Synced with Cloud';
      if (detailDeskLink) {
        if (data.name) {
          detailDeskLink.style.display = 'inline-flex';
          detailDeskLink.href = `/app/timesheet-log/${data.name}`;
        } else {
          detailDeskLink.style.display = 'none';
        }
      }
    }

    detailModal.classList.add('open');
    detailModal.style.display = 'flex';
  }

  function closeDetailModal() {
    if (detailModal) {
      detailModal.classList.remove('open');
      detailModal.style.display = 'none';
    }
  }

  if (detailModalClose) detailModalClose.addEventListener('click', closeDetailModal);
  if (detailCloseBtn) detailCloseBtn.addEventListener('click', closeDetailModal);
  if (detailCopyBtn) {
    detailCopyBtn.addEventListener('click', async () => {
      const text = detailNotes.textContent;
      try {
        await navigator.clipboard.writeText(text);
        showToast('✓ Notes copied to clipboard!', 'success');
      } catch (e) {
        prompt('Copy notes:', text);
      }
    });
  }

  // 12. AppSheet-Style Unified Sync Queue Drawer Modal (With Conditional Discard)
  async function openSyncQueueModal() {
    if (!syncQueueModal) return;

    await renderSyncQueueModal();
    syncQueueModal.classList.add('open');
    syncQueueModal.style.display = 'flex';
  }

  function closeSyncQueueModal() {
    if (syncQueueModal) {
      syncQueueModal.classList.remove('open');
      syncQueueModal.style.display = 'none';
    }
  }

  async function renderSyncQueueModal() {
    if (!syncQueueListContainer) return;
    syncQueueListContainer.innerHTML = '';

    const queue = await window.TimesheetDB.getQueue();
    const isOnline = navigator.onLine;

    // 1. Connection Status Badge
    if (syncModalStatusBadge) {
      if (isOnline) {
        syncModalStatusBadge.className = 'sync-pill';
        syncModalStatusBadge.textContent = '🟢 Online';
      } else {
        syncModalStatusBadge.className = 'sync-pill offline';
        syncModalStatusBadge.textContent = '🔴 Offline';
      }
    }

    // 2. Footer Count
    if (syncModalFooterCount) {
      const failedCount = queue.filter((q) => q.sync_status === 'failed').length;
      if (failedCount > 0) {
        syncModalFooterCount.textContent = `${queue.length} items (${failedCount} failed)`;
      } else {
        syncModalFooterCount.textContent = `${queue.length} item${queue.length === 1 ? '' : 's'} queued`;
      }
    }

    // 3. Render Cards
    if (queue.length === 0) {
      syncQueueListContainer.innerHTML = `
        <div style="text-align: center; padding: 32px 16px; color: var(--text-dim);">
          <div style="font-size: 2rem; margin-bottom: 8px;">✓</div>
          <div style="font-weight: 700; color: var(--text-main);">All Synced</div>
          <div style="font-size: 0.82rem; margin-top: 4px;">No unsaved local changes waiting to upload.</div>
        </div>
      `;
      return;
    }

    queue.forEach((q) => {
      const isFailed = q.sync_status === 'failed';
      const card = document.createElement('div');
      card.className = `queue-item-card ${isFailed ? 'failed' : ''}`;
      card.setAttribute('data-uuid', q.client_uuid);

      let statusPillHtml = '';
      if (isFailed) {
        statusPillHtml = `<span class="sync-pill offline" style="font-size: 0.72rem;">⚠️ Sync Failed</span>`;
      } else if (q.sync_status === 'syncing') {
        statusPillHtml = `<span class="sync-pill syncing" style="font-size: 0.72rem;">🔄 Syncing...</span>`;
      } else {
        statusPillHtml = `<span class="sync-pill pending" style="font-size: 0.72rem; color: var(--accent-amber); border-color: rgba(245, 158, 11, 0.4);">⏳ Queued Offline</span>`;
      }

      let actionsHtml = '';
      let errorBoxHtml = '';

      // APPSHEET CONDITIONAL DISCARD: Action buttons appear ONLY on failed / stuck items!
      if (isFailed) {
        errorBoxHtml = `
          <div class="queue-error-box">
            <strong>Error:</strong> ${escapeHtml(q.error_message || 'Server rejected submission. Please review or discard.')}
          </div>
        `;
        actionsHtml = `
          <div style="display: flex; gap: 6px; margin-top: 10px; justify-content: flex-end;">
            <button type="button" class="btn-queue-retry" data-uuid="${q.client_uuid}">🔁 Retry</button>
            <button type="button" class="btn-queue-discard" data-uuid="${q.client_uuid}">🗑️ Discard</button>
          </div>
        `;
      }

      card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
          <div>
            <div style="font-weight: 800; font-size: 0.95rem; color: var(--text-main);">
              ${escapeHtml(q.project_name || q.project || 'General Operations')}
            </div>
            <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 2px;">
              ${escapeHtml(q.activity_type || 'Development')} • ${q.duration_minutes} mins
            </div>
          </div>
          ${statusPillHtml}
        </div>
        <div style="font-size: 0.78rem; color: var(--text-dim); margin-top: 6px; font-family: var(--font-mono);">
          ${new Date(q.timestamp || Date.now()).toLocaleTimeString()} (${q.client_uuid.slice(0, 12)}...)
        </div>
        ${errorBoxHtml}
        ${actionsHtml}
      `;

      syncQueueListContainer.appendChild(card);
    });
  }

  // EVENT DELEGATION: Sync Queue Modal Item Actions (Discard & Retry)
  if (syncQueueListContainer) {
    syncQueueListContainer.addEventListener('click', async (e) => {
      const discardBtn = e.target.closest('.btn-queue-discard');
      if (discardBtn) {
        const uuid = discardBtn.getAttribute('data-uuid');
        if (uuid) {
          await window.TimesheetSync.discardQueueItem(uuid);
          await renderSyncQueueModal();
          await refreshCalendarAndTable();
          showToast('🗑️ Discarded corrupted queue item', 'info');
        }
        return;
      }

      const retryBtn = e.target.closest('.btn-queue-retry');
      if (retryBtn) {
        const uuid = retryBtn.getAttribute('data-uuid');
        if (uuid) {
          showToast('🔄 Retrying item sync...', 'info');
          await window.TimesheetSync.retryQueueItem(uuid);
          await renderSyncQueueModal();
          await refreshCalendarAndTable();
        }
        return;
      }
    });
  }

  // Open Queue Modal on Widget Click
  if (appsheetSyncWidget) {
    appsheetSyncWidget.addEventListener('click', openSyncQueueModal);
  }

  if (syncQueueModalClose) syncQueueModalClose.addEventListener('click', closeSyncQueueModal);
  if (btnCloseSyncModal) btnCloseSyncModal.addEventListener('click', closeSyncQueueModal);

  if (btnForceSyncNow) {
    btnForceSyncNow.addEventListener('click', async () => {
      showToast('🔄 Syncing queue with server...', 'info');
      await window.TimesheetSync.drainQueue();
      await renderSyncQueueModal();
      await refreshCalendarAndTable();
    });
  }

  // Modal Backdrop Click to Close
  [setupModal, detailModal, syncQueueModal].forEach((m) => {
    if (m) {
      m.addEventListener('click', (e) => {
        if (e.target === m) {
          m.classList.remove('open');
          m.style.display = 'none';
        }
      });
    }
  });

  // Global Escape Key to Close Modals
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeSetupModal();
      closeDetailModal();
      closeSyncQueueModal();
    }
  });

  // 13. Load Metadata
  async function loadMetadata() {
    try {
      const bundle = await window.TimesheetSync.refreshMetadataBundle();
      if (bundle) {
        state.metadata = bundle;

        projectSelect.innerHTML = '';
        (bundle.projects || []).forEach((p) => {
          const opt = document.createElement('option');
          opt.value = p.name;
          opt.textContent = p.project_name || p.name;
          projectSelect.appendChild(opt);
        });

        activitySelect.innerHTML = '';
        (bundle.activity_types || []).forEach((a) => {
          const opt = document.createElement('option');
          opt.value = a.name;
          opt.textContent = a.activity_type || a.name;
          activitySelect.appendChild(opt);
        });

        if (projectSelect.options.length > 0) projectSelect.selectedIndex = 0;
        updateTaskOptions();
        if (activitySelect.options.length > 0) activitySelect.selectedIndex = 0;
      }
    } catch (err) {
      console.warn('Metadata load fallback:', err);
    }
  }

  function updateTaskOptions() {
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

  projectSelect.addEventListener('change', updateTaskOptions);

  // Copy Markdown Day Report
  if (copyDayReportBtn) {
    copyDayReportBtn.addEventListener('click', async () => {
      const targetDate = state.calendar.selectedDate;
      const resp = await fetch(`/api/method/timesheet_intelligence.api.get_my_timesheets?date=${targetDate}`);
      const data = resp.ok ? await resp.json() : {};
      const logs = (data.message && data.message.logs) || [];

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
    });
  }

  // ─── BOOT-TIME MODAL SAFETY RESET ──────────────────────────────────────────
  // Guarantee all modals are CLOSED on every page load.
  // Prevents a stale open modal (e.g. sync-queue-modal left open from a prior
  // session) from acting as an invisible full-screen overlay that blocks clicks.
  (function resetAllModalsOnBoot() {
    document.querySelectorAll('.modal-backdrop').forEach((m) => {
      m.classList.remove('open');
      m.style.display = 'none';
    });
  })();
  // ────────────────────────────────────────────────────────────────────────────

  // Bootstrap
  initTheme();
  await initUserProfile();
  await loadMetadata();
  restoreSessionState();
  await window.TimesheetSync.updateSyncBadgeUI();
  await refreshCalendarAndTable();

  window.TimesheetSync.onStatusChange(async () => {
    await window.TimesheetSync.updateSyncBadgeUI();
  });
  window.TimesheetSync.onDataSynced(async () => {
    await refreshCalendarAndTable();
    await window.TimesheetSync.updateSyncBadgeUI();
  });
});
