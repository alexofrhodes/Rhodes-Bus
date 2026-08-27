(function (global) {
    let pickerState = null;

    function pad2(n) {
        return String(n).padStart(2, '0');
    }

    function parseTimeValue(value) {
        const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
        if (!match) {
            const now = new Date();
            return { hour: now.getHours(), minute: now.getMinutes() };
        }
        return {
            hour: Math.min(23, Math.max(0, Number(match[1]))),
            minute: Math.min(59, Math.max(0, Number(match[2])))
        };
    }

    function formatTime(hour, minute) {
        return `${pad2(hour)}:${pad2(minute)}`;
    }

    function ensurePickerDom() {
        let root = document.getElementById('clock-time-picker');
        if (root) return root;

        root = document.createElement('div');
        root.id = 'clock-time-picker';
        root.className = 'clock-picker-mask';
        root.hidden = true;
        root.innerHTML = `
            <div class="clock-picker-dialog" role="dialog" aria-modal="true" aria-label="Pick time">
                <div class="clock-picker-display">
                    <button type="button" class="clock-picker-unit" data-mode="hour" id="clock-picker-hour">00</button>
                    <span class="clock-picker-colon">:</span>
                    <button type="button" class="clock-picker-unit" data-mode="minute" id="clock-picker-minute">00</button>
                </div>
                <div class="clock-picker-face" id="clock-picker-face"></div>
                <div class="clock-picker-actions">
                    <button type="button" class="clock-picker-text-btn" data-action="clear">Clear</button>
                    <div class="clock-picker-actions-end">
                        <button type="button" class="clock-picker-text-btn" data-action="cancel">Cancel</button>
                        <button type="button" class="clock-picker-text-btn clock-picker-ok" data-action="ok">OK</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(root);

        root.addEventListener('click', (event) => {
            if (event.target === root) closeClockTimePicker(false);
        });

        root.querySelectorAll('[data-mode]').forEach((btn) => {
            btn.addEventListener('click', () => {
                if (!pickerState) return;
                pickerState.mode = btn.getAttribute('data-mode') === 'minute' ? 'minute' : 'hour';
                renderClockFace();
                syncDisplay();
            });
        });

        root.querySelectorAll('[data-action]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const action = btn.getAttribute('data-action');
                if (action === 'cancel') closeClockTimePicker(false);
                else if (action === 'clear') closeClockTimePicker(true, '');
                else if (action === 'ok') {
                    closeClockTimePicker(true, formatTime(pickerState.hour, pickerState.minute));
                }
            });
        });

        return root;
    }

    function syncDisplay() {
        if (!pickerState) return;
        const hourBtn = document.getElementById('clock-picker-hour');
        const minuteBtn = document.getElementById('clock-picker-minute');
        if (hourBtn) {
            hourBtn.textContent = pad2(pickerState.hour);
            hourBtn.classList.toggle('is-active', pickerState.mode === 'hour');
        }
        if (minuteBtn) {
            minuteBtn.textContent = pad2(pickerState.minute);
            minuteBtn.classList.toggle('is-active', pickerState.mode === 'minute');
        }
    }

    function pointForIndex(index, total, radiusPct) {
        const angle = ((index % total) / total) * Math.PI * 2;
        return {
            x: 50 + radiusPct * Math.sin(angle),
            y: 50 - radiusPct * Math.cos(angle)
        };
    }

    function renderClockFace() {
        const face = document.getElementById('clock-picker-face');
        if (!face || !pickerState) return;
        face.innerHTML = '';

        const hand = document.createElement('div');
        hand.className = 'clock-picker-hand';
        face.appendChild(hand);

        const hub = document.createElement('div');
        hub.className = 'clock-picker-hub';
        face.appendChild(hub);

        let handAngle = 0;
        let handLen = '39%';

        if (pickerState.mode === 'hour') {
            for (let hour = 0; hour < 24; hour++) {
                const isInner = hour >= 12;
                const index = hour % 12;
                const radius = isInner ? 26 : 39;
                const point = pointForIndex(index, 12, radius);
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = `clock-picker-num${hour === pickerState.hour ? ' is-selected' : ''}`;
                btn.style.left = `${point.x}%`;
                btn.style.top = `${point.y}%`;
                btn.textContent = String(hour);
                btn.addEventListener('click', () => {
                    pickerState.hour = hour;
                    pickerState.mode = 'minute';
                    syncDisplay();
                    renderClockFace();
                });
                face.appendChild(btn);
            }
            handAngle = (pickerState.hour % 12) * 30;
            handLen = pickerState.hour >= 12 ? '26%' : '39%';
        } else {
            for (let step = 0; step < 12; step++) {
                const minute = step * 5;
                const point = pointForIndex(step, 12, 39);
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = `clock-picker-num${pickerState.minute === minute ? ' is-selected' : ''}`;
                btn.style.left = `${point.x}%`;
                btn.style.top = `${point.y}%`;
                btn.textContent = pad2(minute);
                btn.addEventListener('click', () => {
                    pickerState.minute = minute;
                    syncDisplay();
                    renderClockFace();
                });
                face.appendChild(btn);
            }
            handAngle = pickerState.minute * 6;
            handLen = '39%';
        }

        hand.style.setProperty('--hand-angle', `${handAngle}deg`);
        hand.style.setProperty('--hand-len', handLen);
    }

    function closeClockTimePicker(apply, value) {
        const root = document.getElementById('clock-time-picker');
        if (root) root.hidden = true;

        if (!pickerState) return;
        const inputId = pickerState.inputId;
        const onDone = pickerState.onDone;
        pickerState = null;

        if (!apply) return;
        const input = document.getElementById(inputId);
        if (input) {
            input.value = value == null ? '' : value;
            input.dispatchEvent(new Event('change', { bubbles: true }));
        }
        syncClockTriggerLabels();
        if (typeof onDone === 'function') onDone(value == null ? '' : value);
    }

    function openClockTimePicker(inputId, options = {}) {
        const input = document.getElementById(inputId);
        const parsed = parseTimeValue(input?.value || options.initial || '');
        pickerState = {
            inputId,
            hour: parsed.hour,
            minute: parsed.minute,
            mode: 'hour',
            onDone: options.onDone || null
        };

        const root = ensurePickerDom();
        root.hidden = false;
        syncDisplay();
        renderClockFace();
    }

    function syncClockTriggerLabels() {
        document.querySelectorAll('[data-clock-input]').forEach((btn) => {
            const inputId = btn.getAttribute('data-clock-input');
            const input = document.getElementById(inputId);
            const value = input?.value || '';
            btn.textContent = value || '--:--';
            btn.classList.toggle('has-value', Boolean(value));
        });
    }

    global.ClockTimePicker = {
        open: openClockTimePicker,
        syncTriggers: syncClockTriggerLabels,
        close: () => closeClockTimePicker(false)
    };
})(window);
