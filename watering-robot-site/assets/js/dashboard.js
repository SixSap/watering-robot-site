// dashboard.js
// Watering Robot Dashboard (mock device + UI logic)
// Place this file as assets/js/dashboard.js and reference it from your HTML (e.g. <script src="assets/js/dashboard.js" defer></script>)

(() => {
    // ---- Constants ----
    const STORAGE_KEY = 'wateringRobotStateV1';
    const UI_UPDATE_MS = 1000;
    const SCHEDULE_CHECK_MS = 5000;
    const MAX_ACTIVITY = 100;
    const WATER_PER_SEC_AT_100 = 2.5; // soil% per second at 100% flow
    const TANK_USAGE_FACTOR = 0.5; // how many tank% used per soil% added

    // ---- Default state ----
    const defaultState = {
        connected: false,
        soil: 50, // %
        tank: 80, // %
        lastWatered: null,
        watering: false,
        flowRate: 60, // %
        dryRate: 1, // units for drying simulation
        schedules: [], // { id, time: 'HH:MM', duration, repeatDaily, lastRunDate? }
        activity: []
    };

    // ---- App State ----
    let state = loadState();
    let simInterval = null;
    let scheduleInterval = null;
    let wateringTimer = null;

    // ---- DOM Elements ----
    const el = {
        connectBtn: document.getElementById('connectBtn'),
        soilValue: document.getElementById('soilValue'),
        tankValue: document.getElementById('tankValue'),
        lastWatered: document.getElementById('lastWatered'),
        nextSchedule: document.getElementById('nextSchedule'),
        activityLog: document.getElementById('activityLog'),
        durationRange: document.getElementById('duration'),
        durationVal: document.getElementById('durationVal'),
        waterNowBtn: document.getElementById('waterNowBtn'),
        stopWaterBtn: document.getElementById('stopWaterBtn'),
        flowRate: document.getElementById('flowRate'),
        flowVal: document.getElementById('flowVal'),
        dryRate: document.getElementById('dryRate'),
        resetBtn: document.getElementById('resetBtn'),
        scheduleForm: document.getElementById('scheduleForm'),
        timeInput: document.getElementById('timeInput'),
        durationInput: document.getElementById('durationInput'),
        repeatDaily: document.getElementById('repeatDaily'),
        scheduleList: document.getElementById('scheduleList'),
        navHome: document.getElementById('nav-home'),
        navControl: document.getElementById('nav-control'),
        viewHome: document.getElementById('home'),
        viewControl: document.getElementById('control'),
    };

    // ---- Helpers: Storage, Formatting, Activity ----
    function saveState() {
        try {
            const minimal = {
                soil: state.soil,
                tank: state.tank,
                lastWatered: state.lastWatered,
                schedules: state.schedules,
                activity: state.activity,
                flowRate: state.flowRate,
                dryRate: state.dryRate
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(minimal));
        } catch (err) {
            console.error('Failed to save state', err);
        }
    }

    function loadState() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return { ...defaultState };
            const parsed = JSON.parse(raw);
            return {
                ...defaultState,
                ...parsed
            };
        } catch (err) {
            console.error('Failed to load state', err);
            return { ...defaultState };
        }
    }

    function formatTime(ts) {
        if (!ts) return '—';
        const d = new Date(ts);
        return d.toLocaleString();
    }

    function nowHHMM() {
        const d = new Date();
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        return `${hh}:${mm}`;
    }

    function todayYMD() {
        const d = new Date();
        return `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2,'0')}-${d.getDate().toString().padStart(2,'0')}`;
    }

    function logActivity(text) {
        const entry = { ts: Date.now(), text };
        state.activity.unshift(entry);
        if (state.activity.length > MAX_ACTIVITY) state.activity.length = MAX_ACTIVITY;
        renderActivity();
        saveState();
    }

    // ---- Rendering ----
    function render() {
        // UI -> state mapping
        el.flowVal.textContent = Math.round(state.flowRate);
        el.durationVal.textContent = el.durationRange.value; // slider drives display here
        el.soilValue.textContent = `${Math.round(state.soil)} %`;
        el.tankValue.textContent = `${Math.round(state.tank)} %`;
        el.lastWatered.textContent = state.lastWatered ? formatTime(state.lastWatered) : '—';
        // Button labels and connected state
        el.connectBtn.textContent = state.connected ? 'Disconnect' : 'Connect';
        el.connectBtn.classList.toggle('connected', state.connected);
        el.stopWaterBtn.disabled = !state.watering;
        el.waterNowBtn.disabled = state.watering || !state.connected;
        // Danger color for low tank
        el.tankValue.classList.toggle('low', state.tank <= 15);
        el.soilValue.classList.toggle('dry', state.soil <= 20);
        renderScheduleList();
        renderActivity();
        updateNextScheduleText();
    }

    function renderActivity() {
        el.activityLog.innerHTML = '';
        for (const a of state.activity.slice(0, 50)) {
            const li = document.createElement('li');
            li.textContent = `${new Date(a.ts).toLocaleTimeString()} · ${a.text}`;
            el.activityLog.appendChild(li);
        }
    }

    function renderScheduleList() {
        el.scheduleList.innerHTML = '';
        state.schedules.forEach((s) => {
            const li = document.createElement('li');
            li.className = 'schedule-item';
            li.innerHTML = `
                <div class="schedule-time">${escapeHtml(s.time)}</div>
                <div class="schedule-meta">${s.duration}s ${s.repeatDaily ? '• daily' : ''}</div>
            `;
            const removeBtn = document.createElement('button');
            removeBtn.className = 'btn small outline';
            removeBtn.textContent = 'Remove';
            removeBtn.addEventListener('click', () => {
                removeSchedule(s.id);
            });
            li.appendChild(removeBtn);
            el.scheduleList.appendChild(li);
        });
    }

    function escapeHtml(str) {
        return String(str).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    }

    function updateNextScheduleText() {
        const next = computeNextSchedule();
        el.nextSchedule.textContent = next ? formatTime(next) : '—';
    }

    // ---- Simulation / Device Logic ----
    function startSimulation() {
        if (simInterval) return;
        simInterval = setInterval(simTick, UI_UPDATE_MS);
        scheduleInterval = setInterval(checkSchedules, SCHEDULE_CHECK_MS);
        logActivity('Connected to mock device.');
    }

    function stopSimulation() {
        if (simInterval) {
            clearInterval(simInterval);
            simInterval = null;
        }
        if (scheduleInterval) {
            clearInterval(scheduleInterval);
            scheduleInterval = null;
        }
        logActivity('Disconnected from mock device.');
    }

    function simTick() {
        // Drying when not watering
        if (!state.watering) {
            const dryPerSecond = state.dryRate * 0.02; // small %
            state.soil -= dryPerSecond;
            if (state.soil < 0) state.soil = 0;
        }
        // When watering, handled separately by wateringTimer logic; but ensure limits
        state.soil = Math.min(100, Math.max(0, state.soil));
        state.tank = Math.min(100, Math.max(0, state.tank));
        render();
        saveState();
    }

    // Start watering for duration seconds
    function startWatering(durationSeconds, source = 'manual') {
        if (state.watering) {
            logActivity('Already watering — ignoring new command.');
            return;
        }
        if (!state.connected) {
            logActivity('Cannot water: device not connected.');
            return;
        }
        if (state.tank <= 0) {
            logActivity('Cannot water: tank empty.');
            return;
        }
        state.watering = true;
        const flowScale = state.flowRate / 100;
        let remaining = Math.max(1, Math.floor(durationSeconds));
        logActivity(`Started watering (${remaining}s, ${Math.round(state.flowRate)}% flow) [${source}]`);
        // Interval per-second for watering effects
        wateringTimer = setInterval(() => {
            if (remaining <= 0 || state.tank <= 0) {
                stopWatering('completed');
                return;
            }
            const waterPerSec = flowScale * WATER_PER_SEC_AT_100;
            state.soil += waterPerSec;
            const tankUse = waterPerSec * TANK_USAGE_FACTOR;
            state.tank -= tankUse;
            state.soil = Math.min(100, state.soil);
            state.tank = Math.max(0, state.tank);
            remaining -= 1;
            render();
            // Warnings & auto-stop conditions
            if (state.tank <= 5) {
                logActivity('Warning: Tank low.');
            }
            saveState();
        }, 1000);

        // Record lastWatered
        state.lastWatered = Date.now();
        saveState();
    }

    function stopWatering(reason = 'stopped') {
        if (!state.watering) {
            return;
        }
        state.watering = false;
        if (wateringTimer) {
            clearInterval(wateringTimer);
            wateringTimer = null;
        }
        logActivity(`Watering ${reason}.`);
        state.lastWatered = Date.now();
        saveState();
        render();
    }

    // ---- Schedule Management ----
    function addSchedule(time, duration, repeatDaily) {
        const id = cryptoRandomId();
        const item = { id, time, duration: Number(duration), repeatDaily: !!repeatDaily, lastRunDate: null };
        state.schedules.push(item);
        saveState();
        renderScheduleList();
        logActivity(`Added schedule ${time} for ${duration}s${repeatDaily ? ' (daily)' : ''}.`);
        updateNextScheduleText();
    }

    function removeSchedule(id) {
        const idx = state.schedules.findIndex(s => s.id === id);
        if (idx >= 0) {
            const [removed] = state.schedules.splice(idx, 1);
            saveState();
            renderScheduleList();
            logActivity(`Removed schedule ${removed.time} (${removed.duration}s).`);
            updateNextScheduleText();
        }
    }

    function computeNextSchedule() {
        if (!state.schedules.length) return null;
        // compute next absolute Date from now for each schedule
        const now = new Date();
        const candidates = [];
        for (const s of state.schedules) {
            const [hh, mm] = s.time.split(':').map(v => Number(v));
            const dt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0, 0);
            if (dt <= now) {
                // if it's already past today, schedule for tomorrow (if repeat) or next day
                dt.setDate(dt.getDate() + 1);
            }
            candidates.push(dt);
        }
        if (!candidates.length) return null;
        candidates.sort((a, b) => a - b);
        return candidates[0];
    }

    function checkSchedules() {
        const hhmm = nowHHMM();
        const ymd = todayYMD();
        for (const s of state.schedules) {
            if (s.time === hhmm) {
                // already ran today?
                if (s.lastRunDate === ymd) continue;
                // If not repeat daily and schedule triggered, still run then remove after
                if (!s.repeatDaily) {
                    // run once, then remove from schedule list
                    logActivity(`Executing one-time schedule ${s.time} (${s.duration}s).`);
                    startWatering(s.duration, 'schedule');
                    s.lastRunDate = ymd;
                    // remove once executed
                    setTimeout(() => {
                        removeSchedule(s.id);
                    }, 200);
                } else {
                    // repeat daily
                    logActivity(`Executing schedule ${s.time} (${s.duration}s).`);
                    startWatering(s.duration, 'schedule');
                    s.lastRunDate = ymd;
                }
                saveState();
            }
        }
        updateNextScheduleText();
    }

    // ---- Utilities ----
    function cryptoRandomId() {
        // small random id
        return Math.random().toString(36).slice(2, 10);
    }

    // ---- UI Event Wiring ----
    function wireEvents() {
        // Navigation
        el.navHome.addEventListener('click', (e) => { e.preventDefault(); showView('home'); });
        el.navControl.addEventListener('click', (e) => { e.preventDefault(); showView('control'); });

        // Connect
        el.connectBtn.addEventListener('click', () => {
            state.connected = !state.connected;
            render();
            if (state.connected) startSimulation(); else {
                stopSimulation();
                if (state.watering) stopWatering('device disconnected');
            }
            saveState();
        });

        // Duration slider
        el.durationRange.addEventListener('input', () => {
            el.durationVal.textContent = el.durationRange.value;
        });

        // Water Now
        el.waterNowBtn.addEventListener('click', () => {
            const duration = Number(el.durationRange.value);
            startWatering(duration, 'manual');
        });

        el.stopWaterBtn.addEventListener('click', () => {
            stopWatering('manually stopped');
        });

        // Flow rate
        el.flowRate.addEventListener('input', (e) => {
            state.flowRate = Number(e.target.value);
            el.flowVal.textContent = Math.round(state.flowRate);
            render();
            saveState();
        });

        // Dry rate (simulation)
        el.dryRate.addEventListener('input', (e) => {
            state.dryRate = Number(e.target.value);
            saveState();
        });

        // Reset
        el.resetBtn.addEventListener('click', () => {
            state = { ...defaultState };
            saveState();
            if (simInterval) stopSimulation();
            logActivity('Mock state reset.');
            render();
        });

        // Schedule form
        el.scheduleForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const time = el.timeInput.value;
            if (!/^\d{2}:\d{2}$/.test(time)) {
                alert('Time must be in HH:MM format.');
                return;
            }
            const duration = Number(el.durationInput.value);
            const repeat = el.repeatDaily.checked;
            addSchedule(time, duration, repeat);
            el.scheduleForm.reset();
            el.repeatDaily.checked = true;
        });

        // Setup control defaults from state
        el.flowRate.value = state.flowRate;
        el.dryRate.value = state.dryRate;
        el.durationRange.value = Number(el.durationRange.value) || 10;
        el.durationVal.textContent = el.durationRange.value;
    }

    // ---- View Navigation ----
    function showView(name) {
        if (name === 'home') {
            el.viewHome.classList.remove('hidden');
            el.viewControl.classList.add('hidden');
            el.navHome.classList.add('active');
            el.navControl.classList.remove('active');
        } else {
            el.viewControl.classList.remove('hidden');
            el.viewHome.classList.add('hidden');
            el.navHome.classList.remove('active');
            el.navControl.classList.add('active');
        }
    }

    // ---- Init ----
    function init() {
        wireEvents();
        render();
        if (state.connected) startSimulation();
        // Ensure schedule checking is active after load (only if we want it while disconnected, but leaving disabled by default)
        // start schedule check only when connected. If you want schedule to function while disconnected, remove condition.
        if (state.connected && !scheduleInterval) scheduleInterval = setInterval(checkSchedules, SCHEDULE_CHECK_MS);
        // Safety: stop watering if water is 0
        if (state.tank <= 0 && state.watering) stopWatering('tank empty');
        // If lastWatered is null, keep it as is
        logActivity('Dashboard ready.');
        render();
    }

    // Kick off
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();