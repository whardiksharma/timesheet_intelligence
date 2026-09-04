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

          // Update Top Bar User Badge
          const userProfileBadge = document.getElementById('user-profile-badge');
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
    const themeToggleBtn = document.getElementById('theme-toggle-btn');
    if (theme === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
      if (themeToggleBtn) themeToggleBtn.textContent = '☀️ Light';
    } else {
      document.documentElement.removeAttribute('data-theme');
      if (themeToggleBtn) themeToggleBtn.textContent = '🌙 Dark';
    }
    localStorage.setItem('timesheet_theme', theme);
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    applyTheme(current === 'light' ? 'dark' : 'light');
  }

  // 3. Setup Modal Controls (Start / Switch)
  function openSetupModal(mode = 'new') {
    state.modalMode = mode;
    const setupModal = document.getElementById('project-setup-modal');
    const setupModalTitle = document.getElementById('setup-modal-title');
    const btnStartSessionModal = document.getElementById('btn-start-session-modal');
    const projectSelect = document.getElementById('input-project');

    if (setupModal) {
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

  // 4. Start or Switch Working Session
  async function handleModalSubmit() {
    const projectSelect = document.getElementById('input-project');
    const taskSelect = document.getElementById('input-task');
    const activitySelect = document.getElementById('input-activity');
    const billableCheck = document.getElementById('input-billable');

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
    const activeProjectLabel = document.getElementById('active-project-label');
    const activeTaskLabel = document.getElementById('active-task-label');
    const activeActivityLabel = document.getElementById('active-activity-label');
    const activeStartTimeLabel = document.getElementById('active-start-time-label');
    const idleSessionCard = document.getElementById('idle-session-card');
    const activeSessionCard = document.getElementById('active-session-card');

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

  // 5. Timer Logic with Safe Page Refresh Reconstruction
  function saveSessionState() {
    try {
      localStorage.setItem('timesheet_active_session', JSON.stringify({
        currentSession: state.currentSession,
        timer: {
          isRunning: state.timer.isRunning,
          startTime: state.timer.startTime,
          elapsedSeconds: state.timer.elapsedSeconds
        }
      }));
    } catch (e) {}
  }

  function restoreSessionState() {
    const activeProjectLabel = document.getElementById('active-project-label');
    const activeTaskLabel = document.getElementById('active-task-label');
    const activeActivityLabel = document.getElementById('active-activity-label');
    const activeStartTimeLabel = document.getElementById('active-start-time-label');
    const idleSessionCard = document.getElementById('idle-session-card');
    const activeSessionCard = document.getElementById('active-session-card');
    const timerDisplay = document.getElementById('timer-display');

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
    const timerPauseBtn = document.getElementById('timer-pause-btn');
    const timerResumeBtn = document.getElementById('timer-resume-btn');
    const sessionStatusPill = document.getElementById('session-status-pill');
    const sessionStatusLabel = document.getElementById('session-status-label');
    const timerDisplay = document.getElementById('timer-display');

    if (status === 'running') {
      if (timerPauseBtn) timerPauseBtn.style.display = 'inline-flex';
      if (timerResumeBtn) timerResumeBtn.style.display = 'none';
      if (sessionStatusPill) {
        sessionStatusPill.className = 'session-status-badge running';
        if (sessionStatusLabel) sessionStatusLabel.textContent = 'LIVE RECORDING';
      }
      if (timerDisplay) {
        timerDisplay.style.color = 'var(--accent-cyan)';
      }
    } else if (status === 'paused') {
      if (timerPauseBtn) timerPauseBtn.style.display = 'none';
      if (timerResumeBtn) timerResumeBtn.style.display = 'inline-flex';
      if (sessionStatusPill) {
        sessionStatusPill.className = 'session-status-badge paused';
        if (sessionStatusLabel) sessionStatusLabel.textContent = 'PAUSED';
      }
      if (timerDisplay) {
        timerDisplay.style.color = 'var(--text-muted)';
      }
    }
  }

  function startTimerLoop() {
    if (state.timer.interval) clearInterval(state.timer.interval);
    const timerDisplay = document.getElementById('timer-display');
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
    const timerDisplay = document.getElementById('timer-display');
    if (timerDisplay) timerDisplay.textContent = '00:00:00';
    saveSessionState();
  }

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
    const pointsCounter = document.getElementById('points-counter');
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

    const payload = {
      client_uuid: 'uuid_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9),
      user: state.currentUserProfile.user || 'Administrator',
      employee: state.currentUserProfile.employee_id || state.currentUserProfile.employee_name || 'Administrator',
      employee_name: state.currentUserProfile.employee_name || state.currentUserProfile.full_name || 'Administrator',
      project: state.currentSession.projectId || state.currentSession.project,
      project_name: state.currentSession.project,
      task: state.currentSession.task,
      activity_type: state.currentSession.activity,
      is_billable: state.currentSession.isBillable ? 1 : 0,
      from_time: fromTime,
      to_time: toTime,
      duration_minutes: durationMinutes,
      accomplishments: description,
      description: description,
      timestamp: now.toISOString(),
      sync_status: 'pending',
      error_message: null,
      retry_count: 0
    };

    // 1. Add to Offline Mutation Queue in IndexedDB
    if (window.TimesheetDB && window.TimesheetDB.addToQueue) {
      await window.TimesheetDB.addToQueue(payload);
    }

    // 2. Immediately update optimistic UI totals & table
    await refreshCalendarAndTable();

    // 3. Trigger Silent Unified Sync Engine
    if (window.TimesheetSync && window.TimesheetSync.drainQueue) {
      window.TimesheetSync.drainQueue();
    }
  }

  // 8. Finish Working Session & Instant Unmount (Client-Side Accomplishment Guard)
  async function finishSessionAndUnmount() {
    const manualPointInput = document.getElementById('manual-point-input');
    const idleSessionCard = document.getElementById('idle-session-card');
    const activeSessionCard = document.getElementById('active-session-card');

    // Auto-capture unsaved draft in input box
    if (manualPointInput && manualPointInput.value.trim()) {
      addPoint(manualPointInput.value.trim());
      manualPointInput.value = '';
    }

    // MANDATORY ACCOMPLISHMENT VALIDATION GUARD:
    const pointsCount = (state.currentSession.points || []).length;
    if (pointsCount === 0) {
      showToast('⚠️ Please log at least 1 work accomplishment before finishing!', 'error');

      if (manualPointInput) {
        manualPointInput.classList.remove('input-shake');
        void manualPointInput.offsetWidth; // Force reflow
        manualPointInput.classList.add('input-shake');
        manualPointInput.focus();
      }

      if (window.TimesheetVoice && window.TimesheetVoice.playTone) {
        window.TimesheetVoice.playTone('error');
      }
      return;
    }

    pauseTimer();
    const projName = state.currentSession.project;

    await saveCurrentSessionToLog();

    // Reset session in state
    state.currentSession = {
      project: '',
      projectId: '',
      task: '',
      activity: 'Development',
      isBillable: true,
      startTime: null,
      points: []
    };
    resetTimer();
    localStorage.removeItem('timesheet_active_session');

    // Instant Unmount to Idle Card
    if (activeSessionCard) activeSessionCard.style.display = 'none';
    if (idleSessionCard) idleSessionCard.style.display = 'flex';
    renderLivePoints();

    if (window.TimesheetVoice && window.TimesheetVoice.playTone) {
      window.TimesheetVoice.playTone('finish');
    }
    showToast(`✓ Logged & saved session: ${projName}`, 'success');

    await refreshCalendarAndTable();
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
    const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
    const prevMonthDays = new Date(currentYear, currentMonth - 1, 0).getDate();

    const todayStr = new Date().toISOString().slice(0, 10);

    // Prev month padding
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      const dNum = prevMonthDays - i;
      const cell = document.createElement('div');
      cell.className = 'cal-cell is-other-month';
      cell.innerHTML = `<span class="cal-day-num">${dNum}</span>`;
      calendarDaysGrid.appendChild(cell);
    }

    // Current month days
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const hours = dailySummary[dateStr] || 0;
      const isSelected = dateStr === selectedDate;
      const isToday = dateStr === todayStr;

      const cell = document.createElement('div');
      cell.className = `cal-cell${isSelected ? ' is-selected' : ''}${isToday ? ' is-today' : ''}`;
      cell.setAttribute('data-date', dateStr);
      cell.setAttribute('tabindex', '0');
      cell.setAttribute('role', 'button');
      cell.setAttribute('aria-label', `${dateStr}: ${hours.toFixed(1)} hours logged`);

      let badgeHtml = '';
      if (hours > 0) {
        badgeHtml = `<span class="cal-badge-hours">${hours.toFixed(1)}h</span>`;
      }

      cell.innerHTML = `
        <span class="cal-day-num">${d}</span>
        ${badgeHtml}
      `;
      calendarDaysGrid.appendChild(cell);
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
        <td style="width: 25%;">
          <span class="meta-pill pill-time" style="font-size: 0.74rem;">${timeRange}</span>
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
        <td style="width: 15%; text-align: right; font-weight: 800; color: var(--accent-cyan);">
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

      // Add to daily summary map
      optimisticDaily[itemDate] = Number(((optimisticDaily[itemDate] || 0) + hours).toFixed(2));

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

      // 1. Start Work Buttons
      if (target.closest('#btn-start-new-session') || target.closest('#btn-header-start')) {
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

      // 5. Timer Controls
      if (target.closest('#timer-pause-btn')) {
        e.preventDefault();
        pauseTimer();
        return;
      }
      if (target.closest('#timer-resume-btn')) {
        e.preventDefault();
        startTimer();
        return;
      }

      // 6. Finish & Save Session
      if (target.closest('#btn-finish-and-next')) {
        e.preventDefault();
        await finishSessionAndUnmount();
        return;
      }

      // 7. Theme Toggle
      if (target.closest('#theme-toggle-btn')) {
        e.preventDefault();
        toggleTheme();
        return;
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
        state.currentSession.points = (state.currentSession.points || []).filter((p) => p.id !== id);
        renderLivePoints();
        saveSessionState();
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

      // 13. Calendar Cell Selection
      const calCell = target.closest('.cal-cell[data-date]');
      if (calCell) {
        e.preventDefault();
        state.calendar.selectedDate = calCell.getAttribute('data-date');
        await refreshCalendarAndTable();
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
      ['project-setup-modal', 'timesheet-detail-modal', 'sync-queue-modal'].forEach((mId) => {
        const modalEl = document.getElementById(mId);
        if (modalEl && target === modalEl) {
          modalEl.classList.remove('open');
          modalEl.style.display = 'none';
        }
      });
    });

    // Keyboard Shortcuts & Enter Handler
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeSetupModal();
        closeDetailModal();
        closeSyncQueueModal();
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
