let activeDataset = [];
let activeScope = 'contacts';
let activeScopeConfig = null;
let currentLayoutMode = 'cards';
let signsPageReturnLayout = 'cards';
let activeFilterState = {};
let leafletMap = null;
let busClusterGroup = null;
let mapClusterGroup = null;
let calendarInstance = null;
let currentCalendarViewMode = 'dayGridMonth';

let fieldVisibility = {};
let globalBusMasonryInstance = null;
let dataProvider = null;
let deferredInstallPrompt = null;
let activeDataLoadError = null;
let tablePaginationState = {
    pageSize: '30',
    currentPage: 1
};
let cardsPaginationState = {
    mode: 'load-more',
    pageSize: 30,
    loadedCount: 30,
    autoLoading: false,
    scopeKey: ''
};
let cardsInfiniteObserver = null;
let syncScrollAwareHeaderState = null;
let scopeLayoutPreferences = {};
let flipbookInstance = null;
let deckInstance = null;
let ganttInstance = null;
let timelineInstance = null;
let chartsInstance = null;
let latestMapBounds = null;

let viewEnhancementState = {
    cardsSort: 'default',
    cardsDensity: 'compact',
    tableDense: true,
    tableFitMode: 'page',
    calendarViewMode: 'dayGridMonth',
    posterSize: 'md',
    mapAutoFit: true,
    tablePageSizeByScope: {},
    cardsPageSizeByScope: {}
};

let currentFlipbookPages = [];
let kanbanLayoutStateByScope = {};
const KANBAN_LAYOUT_STORAGE_KEY = 'myWebsite.kanban.layout.v1';
const FLIPBOOK_PROGRESS_STORAGE_KEY = 'myWebsite.flipbook.progress.v1';
const SCOPE_LAYOUT_PREF_STORAGE_KEY = 'myWebsite.scope.layout.preferences.v1';
const DASHBOARD_LAYOUT_STORAGE_KEY = 'myWebsite.dashboard.layouts.v1';
const VIEW_ENHANCEMENT_STORAGE_KEY = 'myWebsite.view.enhancements.v1';
const BOOKING_API_BASE_STORAGE_KEY = 'myWebsite.booking.api.base';
const BOOKING_API_CANDIDATES = [
    'http://127.0.0.1:8000',
    'http://localhost:8000',
    'http://127.0.0.1:8010',
    'http://localhost:8010'
];
let calendarMonthPickerInstance = null;
let dashboardRenderSequence = 0;
let dashboardPanelsByScope = {};
let bookingAdminState = {
    loading: false,
    currentBooking: null,
    recent: []
};
let bookingApiStatusState = {
    level: 'unknown',
    text: 'Booking API: checking',
    detail: ''
};

function setBookingApiStatus(level, text, detail = '') {
    bookingApiStatusState = {
        level: String(level || 'unknown'),
        text: String(text || 'Booking API: unknown'),
        detail: String(detail || '')
    };

    const node = document.getElementById('booking-api-status');
    if (!node) return;
    node.className = `booking-api-status booking-api-status-${bookingApiStatusState.level}`;
    node.textContent = bookingApiStatusState.text;
    if (bookingApiStatusState.detail) {
        node.title = bookingApiStatusState.detail;
    } else {
        node.removeAttribute('title');
    }
}

async function refreshBookingApiStatus() {
    const tried = [];
    const current = getBookingApiBase();
    const candidates = [current, ...BOOKING_API_CANDIDATES].filter((value, index, list) => {
        const normalized = String(value || '').replace(/\/+$/, '');
        if (!normalized || tried.includes(normalized)) return false;
        tried.push(normalized);
        return list.findIndex((item) => String(item || '').replace(/\/+$/, '') === normalized) === index;
    });

    for (const base of candidates) {
        const endpoint = `${base}/health`;
        try {
            const response = await fetch(endpoint, { method: 'GET' });
            if (!response.ok) continue;
            if (base !== current) {
                window.localStorage.setItem(BOOKING_API_BASE_STORAGE_KEY, base);
            }
            setBookingApiStatus('ok', 'Booking API: online', endpoint);
            return true;
        } catch (error) {
            continue;
        }
    }

    setBookingApiStatus('off', 'Booking API: offline', 'Start run-booking-api.bat (port 8000)');
    return false;
}

function getBookingApiBase() {
    const stored = window.localStorage.getItem(BOOKING_API_BASE_STORAGE_KEY);
    const fallback = window.BOOKING_API_BASE || BOOKING_API_CANDIDATES[0];
    return String(stored || fallback).replace(/\/+$/, '');
}

function isPlaceholderUrl(url) {
    const raw = String(url || '').trim().toLowerCase();
    if (!raw) return true;
    return raw.includes('example.com') || raw.includes('foodsample.local') || raw === '#';
}

function normalizeExternalUrl(url) {
    const raw = String(url || '').trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    return `https://${raw}`;
}

async function requestBookingApi(path, options = {}) {
    const endpoint = `${getBookingApiBase()}${path}`;
    const method = String(options.method || 'GET').toUpperCase();
    const headers = { ...(options.headers || {}) };
    if (options.body && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
    }

    let response;
    try {
        response = await fetch(endpoint, {
            ...options,
            method,
            headers
        });
    } catch (error) {
        const recovered = await refreshBookingApiStatus();
        if (recovered) {
            return requestBookingApi(path, options);
        }
        const base = getBookingApiBase();
        setBookingApiStatus('off', 'Booking API: offline', `${base}${path}`);
        throw new Error(`Cannot reach booking API at ${base}. Run run-booking-api.bat and keep it on port 8000.`);
    }

    let payload = null;
    try {
        payload = await response.json();
    } catch (error) {
        payload = null;
    }

    if (!response.ok) {
        const detail = payload?.detail || payload?.message || `Booking API request failed (${response.status})`;
        setBookingApiStatus('warn', `Booking API: HTTP ${response.status}`, `${endpoint} | ${detail}`);
        throw new Error(String(detail));
    }
    setBookingApiStatus('ok', 'Booking API: online', endpoint);
    return payload;
}

function normalizeBookingScope(scopeValue = '') {
    const value = String(scopeValue || '').trim().toLowerCase();
    if (!value) return '';
    if (value === 'activity') return 'activities';
    if (value === 'event') return 'events';
    if (value === 'restaurant') return 'restaurants';
    return value;
}

function resolveBookingScopeFromRow(row, action = {}) {
    const actionScope = normalizeBookingScope(resolveActionValue(action.scope || action.scopeKey || '', row));
    if (actionScope) return actionScope;

    const inferredFromScope = normalizeBookingScope(activeScope);
    if (inferredFromScope === 'events' || inferredFromScope === 'restaurants') {
        return inferredFromScope;
    }

    const inferredType = String(resolveFieldValue(row, ['type', 'category']) || '').toLowerCase();
    if (/restaurant|taverna|cafe|bar|dining|food/.test(inferredType)) return 'restaurants';
    if (/activity|tour|excursion|adventure/.test(inferredType)) return 'activities';
    if (/event|festival|concert|show/.test(inferredType)) return 'events';
    return '';
}

function resolveBookingTitleFromRow(row, action = {}) {
    const actionTitle = resolveActionValue(action.itemTitle || action.title || '', row);
    if (actionTitle) return String(actionTitle);

    const fieldNames = action.itemTitleField || action.field || ['title', 'name'];
    return String(resolveFieldValue(row, fieldNames) || '').trim();
}

function localIsoDate(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function resolveBookingDateFromRow(row, action = {}) {
    const dateField = action.dateField || 'start';
    const raw = resolveFieldValue(row, dateField);
    const today = localIsoDate();
    if (!raw) return today;

    const parsed = new Date(String(raw));
    let candidate = '';
    if (Number.isFinite(parsed.getTime())) {
        candidate = localIsoDate(parsed);
    } else {
        const fallback = String(raw).slice(0, 10);
        candidate = /^\d{4}-\d{2}-\d{2}$/.test(fallback) ? fallback : today;
    }
    return candidate < today ? today : candidate;
}

function findBookableItemByTitle(items, title) {
    if (!title) return items[0] || null;
    const normalize = (value) => String(value || '').trim().toLowerCase();
    const wanted = normalize(title);
    const exactTitle = items.find((item) => normalize(item.title) === wanted);
    if (exactTitle) return exactTitle;
    const exactProvider = items.find((item) => normalize(item.provider_name || item.provider) === wanted);
    if (exactProvider) return exactProvider;
    return items.find((item) => {
        const haystack = `${item.title || ''} ${item.provider_name || ''} ${item.description || ''}`;
        return normalize(haystack).includes(wanted) || wanted.includes(normalize(item.title));
    }) || items[0] || null;
}

function offsetIsoDate(dateStr, days) {
    const seed = new Date(`${dateStr}T00:00:00`);
    if (Number.isNaN(seed.getTime())) return '';
    seed.setDate(seed.getDate() + days);
    return seed.toISOString().slice(0, 10);
}

async function findNextAvailableSlot(itemId, dateInput, partySize, maxDays = 30) {
    const offsets = [0];
    for (let step = 1; step <= maxDays; step += 1) {
        offsets.push(step, -step);
    }

    for (const dayOffset of offsets) {
        const candidateDate = offsetIsoDate(dateInput, dayOffset);
        if (!candidateDate) continue;
        const availability = await requestBookingApi(`/api/bookables/${itemId}/availability?date=${encodeURIComponent(candidateDate)}`);
        const slots = Array.isArray(availability?.slots)
            ? availability.slots
            : (Array.isArray(availability) ? availability : []);
        const availableSlot = slots.find((slot) => Number(slot.remaining_capacity) >= partySize);
        if (availableSlot) {
            return {
                slot: availableSlot,
                date: candidateDate,
                searchedDays: dayOffset,
            };
        }
    }
    return null;
}

async function runBookingAction(row, action = {}) {
    const scope = resolveBookingScopeFromRow(row, action);
    if (!scope) {
        openBookingRequestModal({
            status: 'Unable to infer booking scope for this entry.',
            isError: true
        });
        return;
    }

    const title = resolveBookingTitleFromRow(row, action);
    const defaultDate = resolveBookingDateFromRow(row, action);

    openBookingRequestModal({
        scope,
        itemTitle: title,
        defaultDate,
        defaultPartySize: Number(action.defaultPartySize || 2)
    });
}

function closeBookingRequestModal() {
    const modal = document.getElementById('lightbox');
    const target = document.getElementById('modal-body-target');
    if (target) target.classList.remove('booking-request-card');
    if (!modal) return;
    modal.style.display = 'none';
}

function setBookingRequestStatus(message, isError = false) {
    const node = document.getElementById('booking-request-status');
    if (!node) return;
    node.textContent = String(message || '');
    node.classList.toggle('error', isError);
}

function formatSlotChipLabel(slot) {
    const startRaw = String(slot?.start_local || slot?.start_utc || '').trim();
    const endRaw = String(slot?.end_local || slot?.end_utc || '').trim();
    const start = startRaw.includes('T') ? startRaw.slice(11, 16) : startRaw.slice(0, 5);
    const end = endRaw.includes('T') ? endRaw.slice(11, 16) : endRaw.slice(0, 5);
    const remaining = Number(slot?.remaining_capacity);
    const capacityNote = Number.isFinite(remaining) ? ` · ${remaining} left` : '';
    if (start && end) return `${start}–${end}${capacityNote}`;
    return `Slot ${slot?.slot_id || '?'}${capacityNote}`;
}

async function resolveBookableItemForModal(scope, title) {
    const selectedId = Number(document.getElementById('booking-request-item')?.value || 0);
    const bookables = await requestBookingApi(`/api/bookables?scope=${encodeURIComponent(scope)}`);
    const bookableItems = Array.isArray(bookables?.items)
        ? bookables.items
        : (Array.isArray(bookables) ? bookables : []);
    if (selectedId) {
        const selected = bookableItems.find((item) => Number(item.id) === selectedId);
        if (selected) return selected;
    }
    return findBookableItemByTitle(bookableItems, title);
}

function fillBookingItemSelect(items, preferredTitle) {
    const select = document.getElementById('booking-request-item');
    if (!select) return;
    const preferred = findBookableItemByTitle(items, preferredTitle);
    select.innerHTML = items.map((item) => {
        const label = escapeHtml(`${item.title || 'Item'}${item.provider_name ? ` · ${item.provider_name}` : ''}`);
        const selected = preferred && Number(preferred.id) === Number(item.id) ? ' selected' : '';
        return `<option value="${escapeAttr(String(item.id))}"${selected}>${label}</option>`;
    }).join('');
}

async function refreshBookingRequestSlots({ autoSelect = true } = {}) {
    const scope = String(document.getElementById('booking-request-scope')?.value || '').trim();
    const title = String(document.getElementById('booking-request-title')?.value || '').trim();
    const dateInput = String(document.getElementById('booking-request-date')?.value || '').trim();
    const partySize = Number(document.getElementById('booking-request-party')?.value || 0);
    const slotHost = document.getElementById('booking-request-slots');
    const slotInput = document.getElementById('booking-request-slot-id');
    if (!slotHost || !slotInput) return;

    if (!scope || !dateInput || !Number.isFinite(partySize) || partySize < 1) {
        slotHost.innerHTML = '<span class="booking-slot-empty">Pick a date and party size.</span>';
        slotInput.value = '';
        return;
    }

    slotHost.innerHTML = '<span class="booking-slot-empty">Loading slots…</span>';
    try {
        const item = await resolveBookableItemForModal(scope, title);
        if (!item) {
            slotHost.innerHTML = '<span class="booking-slot-empty">No matching bookable item.</span>';
            slotInput.value = '';
            return;
        }

        const availability = await requestBookingApi(
            `/api/bookables/${item.id}/availability?date=${encodeURIComponent(dateInput)}`
        );
        const slots = Array.isArray(availability?.slots)
            ? availability.slots
            : (Array.isArray(availability) ? availability : []);
        const openSlots = slots.filter((slot) => Number(slot.remaining_capacity) >= partySize);

        if (!openSlots.length) {
            slotHost.innerHTML = '<span class="booking-slot-empty">No open slots this day. Try another date.</span>';
            slotInput.value = '';
            return;
        }

        const previous = String(slotInput.value || '');
        slotHost.innerHTML = openSlots.map((slot) => {
            const id = String(slot.slot_id);
            const selected = previous === id ? 'is-selected' : '';
            return `<button type="button" class="booking-slot-chip ${selected}" data-slot-id="${escapeAttr(id)}">${escapeHtml(formatSlotChipLabel(slot))}</button>`;
        }).join('');

        slotHost.querySelectorAll('[data-slot-id]').forEach((button) => {
            button.addEventListener('click', () => {
                slotHost.querySelectorAll('.booking-slot-chip').forEach((node) => node.classList.remove('is-selected'));
                button.classList.add('is-selected');
                slotInput.value = button.dataset.slotId || '';
                setBookingRequestStatus(`Slot ${button.dataset.slotId} selected.`);
            });
        });

        if (autoSelect) {
            const preferred = openSlots.find((slot) => String(slot.slot_id) === previous) || openSlots[0];
            const preferredId = String(preferred.slot_id);
            slotInput.value = preferredId;
            slotHost.querySelectorAll('.booking-slot-chip').forEach((node) => {
                node.classList.toggle('is-selected', node.dataset.slotId === preferredId);
            });
        }
    } catch (error) {
        slotHost.innerHTML = `<span class="booking-slot-empty">Could not load slots: ${escapeHtml(error?.message || error)}</span>`;
        slotInput.value = '';
    }
}

async function submitBookingRequestFromModal() {
    const scope = String(document.getElementById('booking-request-scope')?.value || '').trim();
    const title = String(document.getElementById('booking-request-title')?.value || '').trim();
    const dateInput = String(document.getElementById('booking-request-date')?.value || '').trim();
    const partySize = Number(document.getElementById('booking-request-party')?.value || 0);
    const customerName = String(document.getElementById('booking-request-name')?.value || '').trim();
    const customerEmail = String(document.getElementById('booking-request-email')?.value || '').trim() || null;
    const customerPhone = String(document.getElementById('booking-request-phone')?.value || '').trim() || null;
    const selectedSlotId = Number(document.getElementById('booking-request-slot-id')?.value || 0);

    if (!scope || !dateInput || !Number.isFinite(partySize) || partySize < 1 || !customerName) {
        setBookingRequestStatus('Please fill date, party size, and your name.', true);
        return;
    }

    setBookingRequestStatus('Submitting request...');
    try {
        let slotId = selectedSlotId;
        if (!Number.isFinite(slotId) || slotId < 1) {
            const item = await resolveBookableItemForModal(scope, title);
            if (!item) {
                setBookingRequestStatus(`No local bookable items found for scope: ${scope}`, true);
                return;
            }
            const nextAvailable = await findNextAvailableSlot(item.id, dateInput, partySize, 30);
            if (!nextAvailable || !nextAvailable.slot) {
                setBookingRequestStatus('No slot has enough remaining capacity for this date range.', true);
                return;
            }
            slotId = Number(nextAvailable.slot.slot_id);
            if (nextAvailable.date !== dateInput) {
                const dateField = document.getElementById('booking-request-date');
                if (dateField) dateField.value = nextAvailable.date;
                setBookingRequestStatus(`Selected date is full. Using next available on ${nextAvailable.date}.`);
            }
        }

        const payload = {
            client_request_id: `web-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            slot_id: Number(slotId),
            party_size: partySize,
            customer_name: customerName,
            customer_email: customerEmail,
            customer_phone: customerPhone,
            notes: `Requested from ${activeScope} cards UI`
        };

        const created = await requestBookingApi('/api/bookings/request', {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        setBookingRequestStatus(`Created ${created.reference} (${created.status}).`);
        const refInput = document.getElementById('booking-admin-reference');
        if (refInput) {
            refInput.value = created.reference || '';
        }
    } catch (error) {
        console.error('Booking action failed', error);
        setBookingRequestStatus(`Booking failed: ${error.message || error}`, true);
    }
}

function openBookingRequestModal(config = {}) {
    const target = document.getElementById('modal-body-target');
    const modal = document.getElementById('lightbox');
    if (!target || !modal) return;

    const scope = escapeHtml(config.scope || '');
    const itemTitle = escapeHtml(config.itemTitle || '');
    const defaultDate = escapeHtml(config.defaultDate || localIsoDate());
    const defaultPartySize = Number(config.defaultPartySize || 2);
    const emptyDefaults = window.getUiLayoutConfig?.()?.booking?.emptyCustomerDefaults !== false;

    target.classList.add('booking-request-card');
    target.innerHTML = `
        <button class="close-modal" onclick="closeBookingRequestModal()">&times;</button>
        <div class="booking-request-shell">
            <div class="booking-request-head">
                <span class="booking-request-kicker">${scope || 'booking'}</span>
                <h3 class="booking-request-title">${itemTitle || 'Request a booking'}</h3>
                <p class="booking-request-sub">Pick a slot, then send a request for confirmation.</p>
            </div>
            <input id="booking-request-scope" type="hidden" value="${scope}">
            <input id="booking-request-title" type="hidden" value="${itemTitle}">
            <input id="booking-request-slot-id" type="hidden" value="">
            <div class="booking-request-grid">
                <label class="span-2">Offering
                    <select id="booking-request-item" class="table-pagination-select">
                        <option value="">Loading…</option>
                    </select>
                </label>
                <label>Date<input id="booking-request-date" class="table-pagination-select" type="date" value="${defaultDate}"></label>
                <label>Party<input id="booking-request-party" class="table-pagination-select" type="number" min="1" value="${defaultPartySize}"></label>
            </div>
            <div class="booking-slot-block">
                <div class="booking-slot-label">Available slots</div>
                <div id="booking-request-slots" class="booking-slot-row" aria-live="polite">
                    <span class="booking-slot-empty">Loading slots…</span>
                </div>
            </div>
            <div class="booking-request-grid">
                <label class="span-2">Name<input id="booking-request-name" class="table-pagination-select" type="text" placeholder="Your name" value="${emptyDefaults ? '' : 'Local Tester'}" autocomplete="name"></label>
                <label>Email<input id="booking-request-email" class="table-pagination-select" type="email" placeholder="optional" value="" autocomplete="email"></label>
                <label>Phone<input id="booking-request-phone" class="table-pagination-select" type="tel" placeholder="optional" value="" autocomplete="tel"></label>
            </div>
            <div class="booking-request-actions">
                <button type="button" class="compact-btn booking-request-primary" id="booking-request-submit">Request booking</button>
                <button type="button" class="compact-btn" onclick="closeBookingRequestModal()">Cancel</button>
            </div>
            <div id="booking-request-status" class="booking-request-status"></div>
        </div>
    `;

    const submitBtn = target.querySelector('#booking-request-submit');
    submitBtn?.addEventListener('click', () => {
        void submitBookingRequestFromModal();
    });

    const dateField = target.querySelector('#booking-request-date');
    const partyField = target.querySelector('#booking-request-party');
    const itemField = target.querySelector('#booking-request-item');
    itemField?.addEventListener('change', () => {
        const selected = itemField.options[itemField.selectedIndex];
        const titleField = document.getElementById('booking-request-title');
        if (titleField && selected) {
            titleField.value = selected.textContent.split(' · ')[0] || selected.textContent;
        }
        void refreshBookingRequestSlots();
    });
    dateField?.addEventListener('change', () => {
        void refreshBookingRequestSlots();
    });
    partyField?.addEventListener('change', () => {
        void refreshBookingRequestSlots();
    });

    if (config.status) {
        setBookingRequestStatus(config.status, config.isError === true);
    }

    modal.style.display = 'flex';
    if (config.scope && !config.isError) {
        void (async () => {
            try {
                const bookables = await requestBookingApi(`/api/bookables?scope=${encodeURIComponent(config.scope)}`);
                const items = Array.isArray(bookables?.items)
                    ? bookables.items
                    : (Array.isArray(bookables) ? bookables : []);
                fillBookingItemSelect(items, config.itemTitle || '');
                await refreshBookingRequestSlots();
            } catch (error) {
                setBookingRequestStatus(error?.message || String(error), true);
                const slotHost = document.getElementById('booking-request-slots');
                if (slotHost) {
                    slotHost.innerHTML = '<span class="booking-slot-empty">Booking API is offline. Run run-booking-api.bat.</span>';
                }
            }
        })();
    }
}

function setBookingAdminStatus(message, isError = false) {
    const target = document.getElementById('booking-admin-status');
    if (!target) return;
    target.textContent = String(message || '');
    target.classList.toggle('error', isError);
}

function renderBookingAdminCurrent() {
    const host = document.getElementById('booking-admin-current');
    if (!host) return;
    const booking = bookingAdminState.currentBooking;
    if (!booking) {
        host.innerHTML = '<div class="inline-muted">No booking loaded.</div>';
        return;
    }

    const canConfirm = booking.status === 'pending_request';
    const canReject = booking.status === 'pending_request';
    const canCancel = booking.status === 'pending_request' || booking.status === 'confirmed';
    const canReopen = booking.status === 'rejected' || booking.status === 'cancelled';

    const statusClass = `booking-status-pill status-${escapeAttr(String(booking.status || 'unknown').replace(/_/g, '-'))}`;
    host.innerHTML = `
        <div class="booking-admin-summary">
            <div class="booking-admin-summary-main">
                <span class="booking-admin-ref">${escapeHtml(booking.reference || '-')}</span>
                <span class="${statusClass}">${escapeHtml(booking.status || '-')}</span>
            </div>
            <div class="booking-admin-summary-meta">${escapeHtml(booking.item_title || '-')} · ${escapeHtml(booking.customer_name || '-')}</div>
        </div>
        <div class="booking-admin-current-grid">
            <div><span>Party</span><strong>${escapeHtml(String(booking.party_size ?? '-'))}</strong></div>
            <div><span>Scope</span><strong>${escapeHtml(booking.scope || '-')}</strong></div>
            <div><span>Provider</span><strong>${escapeHtml(booking.provider_name || '-')}</strong></div>
            <div><span>Slot</span><strong>${escapeHtml(`${booking.start_utc || '-'} → ${booking.end_utc || '-'}`)}</strong></div>
        </div>
        <div class="booking-admin-action-row">
            <button type="button" class="compact-btn booking-action-confirm" data-booking-admin-action="confirm" ${canConfirm ? '' : 'disabled'}>Confirm</button>
            <button type="button" class="compact-btn" data-booking-admin-action="reject" ${canReject ? '' : 'disabled'}>Reject</button>
            <button type="button" class="compact-btn" data-booking-admin-action="cancel" ${canCancel ? '' : 'disabled'}>Cancel</button>
            <button type="button" class="compact-btn" data-booking-admin-action="reopen" ${canReopen ? '' : 'disabled'}>Re-enable</button>
        </div>
    `;

    host.querySelectorAll('[data-booking-admin-action]').forEach((button) => {
        button.addEventListener('click', () => {
            const action = button.dataset.bookingAdminAction;
            if (!action) return;
            void runBookingAdminTransition(action);
        });
    });
}

function renderBookingAdminRecent() {
    const host = document.getElementById('booking-admin-recent');
    if (!host) return;
    const rows = bookingAdminState.recent || [];
    if (!rows.length) {
        host.innerHTML = '<div class="inline-muted">No recent bookings yet.</div>';
        return;
    }

    host.innerHTML = rows.map((row) => {
        return `<button type="button" class="booking-admin-recent-item" data-booking-reference="${escapeAttr(row.reference)}">
            <span class="booking-admin-ref">${escapeHtml(row.reference || '-')}</span>
            <span class="booking-admin-meta">${escapeHtml(row.status || '-')} | ${escapeHtml(row.scope || '-')} | ${escapeHtml(row.customer_name || '-')}</span>
        </button>`;
    }).join('');

    host.querySelectorAll('[data-booking-reference]').forEach((button) => {
        button.addEventListener('click', () => {
            const input = document.getElementById('booking-admin-reference');
            if (!input) return;
            input.value = button.dataset.bookingReference || '';
            void runBookingAdminLookup();
        });
    });
}

async function refreshBookingAdminRecent() {
    try {
        const payload = await requestBookingApi('/api/bookings?limit=20');
        bookingAdminState.recent = Array.isArray(payload.bookings) ? payload.bookings : [];
        renderBookingAdminRecent();
    } catch (error) {
        setBookingAdminStatus(`Recent load failed: ${error.message || error}`, true);
    }
}

async function runBookingAdminLookup() {
    const referenceInput = document.getElementById('booking-admin-reference');
    const reference = String(referenceInput?.value || '').trim();
    if (!reference) {
        setBookingAdminStatus('Enter a booking reference first.', true);
        return;
    }

    setBookingAdminStatus('Loading booking...');
    try {
        const payload = await requestBookingApi(`/api/bookings/${encodeURIComponent(reference)}`);
        bookingAdminState.currentBooking = payload.booking || null;
        renderBookingAdminCurrent();
        setBookingAdminStatus(`Loaded ${reference}.`);
    } catch (error) {
        bookingAdminState.currentBooking = null;
        renderBookingAdminCurrent();
        setBookingAdminStatus(`Lookup failed: ${error.message || error}`, true);
    }
}

async function runBookingAdminTransition(action) {
    const booking = bookingAdminState.currentBooking;
    if (!booking || !booking.id) {
        setBookingAdminStatus('Load a booking before running actions.', true);
        return;
    }

    const actionPath = action === 'confirm' ? 'confirm' : action === 'reject' ? 'reject' : action === 'reopen' ? 'reopen' : 'cancel';
    setBookingAdminStatus(`Submitting ${actionPath}...`);
    try {
        await requestBookingApi(`/api/bookings/${booking.id}/${actionPath}`, { method: 'POST' });
        setBookingAdminStatus(`Booking ${actionPath}ed successfully.`);
        await runBookingAdminLookup();
        await refreshBookingAdminRecent();
    } catch (error) {
        setBookingAdminStatus(`Action failed: ${error.message || error}`, true);
    }
}

async function openBookingAdminPanel() {
    const modal = document.getElementById('booking-admin-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    setBookingAdminStatus('Booking admin ready.');
    renderBookingAdminCurrent();
    renderBookingAdminRecent();
    await refreshBookingAdminRecent();
}

function closeBookingAdminPanel(event) {
    if (event && event.target && event.target.id !== 'booking-admin-modal') return;
    const modal = document.getElementById('booking-admin-modal');
    if (!modal) return;
    modal.style.display = 'none';
}

function wireBookingAdminEvents() {
    const lookupBtn = document.getElementById('booking-admin-lookup');
    const refreshBtn = document.getElementById('booking-admin-refresh');
    const closeBtn = document.getElementById('booking-admin-close');
    const referenceInput = document.getElementById('booking-admin-reference');

    lookupBtn?.addEventListener('click', () => {
        void runBookingAdminLookup();
    });

    refreshBtn?.addEventListener('click', () => {
        void refreshBookingAdminRecent();
    });

    closeBtn?.addEventListener('click', () => closeBookingAdminPanel());
    referenceInput?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            void runBookingAdminLookup();
        }
    });
}

function loadViewEnhancementStateFromStorage() {
    try {
        const payload = window.localStorage.getItem(VIEW_ENHANCEMENT_STORAGE_KEY);
        if (!payload) return;
        const parsed = JSON.parse(payload);
        if (!parsed || typeof parsed !== 'object') return;
        viewEnhancementState = {
            ...viewEnhancementState,
            ...parsed
        };
        currentCalendarViewMode = viewEnhancementState.calendarViewMode || currentCalendarViewMode;
    } catch (error) {
        console.warn('Failed to load view enhancement state.', error);
    }
}

function saveViewEnhancementStateToStorage() {
    try {
        window.localStorage.setItem(VIEW_ENHANCEMENT_STORAGE_KEY, JSON.stringify(viewEnhancementState));
    } catch (error) {
        console.warn('Failed to persist view enhancement state.', error);
    }
}

function loadKanbanLayoutStateFromStorage() {
    try {
        const payload = window.localStorage.getItem(KANBAN_LAYOUT_STORAGE_KEY);
        if (!payload) return;
        const parsed = JSON.parse(payload);
        if (parsed && typeof parsed === 'object') {
            kanbanLayoutStateByScope = parsed;
        }
    } catch (error) {
        console.warn('Failed to load kanban layout state.', error);
    }
}

function saveKanbanLayoutStateToStorage() {
    try {
        window.localStorage.setItem(KANBAN_LAYOUT_STORAGE_KEY, JSON.stringify(kanbanLayoutStateByScope));
    } catch (error) {
        console.warn('Failed to persist kanban layout state.', error);
    }
}

function loadScopeLayoutPreferencesFromStorage() {
    try {
        const payload = window.localStorage.getItem(SCOPE_LAYOUT_PREF_STORAGE_KEY);
        if (!payload) return;
        const parsed = JSON.parse(payload);
        if (parsed && typeof parsed === 'object') {
            scopeLayoutPreferences = parsed;
        }
    } catch (error) {
        console.warn('Failed to load scope layout preferences.', error);
    }
}

function saveScopeLayoutPreferencesToStorage() {
    try {
        window.localStorage.setItem(SCOPE_LAYOUT_PREF_STORAGE_KEY, JSON.stringify(scopeLayoutPreferences));
    } catch (error) {
        console.warn('Failed to persist scope layout preferences.', error);
    }
}

function loadDashboardPanelsFromStorage() {
    try {
        const payload = window.localStorage.getItem(DASHBOARD_LAYOUT_STORAGE_KEY);
        if (!payload) return;
        const parsed = JSON.parse(payload);
        if (parsed && typeof parsed === 'object') {
            dashboardPanelsByScope = parsed;
        }
    } catch (error) {
        console.warn('Failed to load dashboard layouts.', error);
    }
}

function saveDashboardPanelsToStorage() {
    try {
        window.localStorage.setItem(DASHBOARD_LAYOUT_STORAGE_KEY, JSON.stringify(dashboardPanelsByScope));
    } catch (error) {
        console.warn('Failed to persist dashboard layouts.', error);
    }
}

function getActiveScopeFilters() {
    const filters = activeScopeConfig?.filters || [];
    if (!filters.length) return [];

    const hiddenByLayout = activeScopeConfig?.hiddenFiltersByLayout || {};
    const hiddenSet = new Set(hiddenByLayout[currentLayoutMode] || []);
    return filters.filter((filterDef) => !hiddenSet.has(filterDef.id));
}

function getKanbanScopeState(scopeKey = activeScope) {
    const existing = kanbanLayoutStateByScope[scopeKey];
    if (existing && existing.orderByStatus && existing.statusByCard) {
        return existing;
    }

    const migrated = {
        orderByStatus: {},
        statusByCard: {}
    };

    if (existing && typeof existing === 'object') {
        Object.keys(existing).forEach((key) => {
            const value = existing[key];
            if (Array.isArray(value)) {
                migrated.orderByStatus[key] = value.map((item) => String(item));
            }
        });
    }

    kanbanLayoutStateByScope[scopeKey] = migrated;
    return migrated;
}

function isCompactViewport() {
    return window.matchMedia('(max-width: 767px)').matches;
}

function getRowDisplayTitle(row) {
    return String(resolveFieldValue(row, ['title', 'name', 'FirstName', 'to']) || '').trim();
}

function getRowChronologicalValue(row) {
    const source = resolveFieldValue(row, ['start', 'date', 'due', 'publishedAt', 'pageNumber', 'page', 'index']);
    if (source === '' || source === null || source === undefined) return null;

    const asDate = new Date(String(source).replace(' ', 'T'));
    if (!Number.isNaN(asDate.getTime())) {
        return asDate.getTime();
    }

    const asNumber = Number(source);
    if (Number.isFinite(asNumber)) {
        return asNumber;
    }

    return null;
}

function sortDatasetByMode(dataset, mode) {
    if (!Array.isArray(dataset) || mode === 'default') return dataset.slice();

    const sorted = dataset.slice();

    if (mode === 'title-asc' || mode === 'title-desc') {
        sorted.sort((left, right) => {
            const a = getRowDisplayTitle(left);
            const b = getRowDisplayTitle(right);
            return mode === 'title-asc' ? a.localeCompare(b) : b.localeCompare(a);
        });
        return sorted;
    }

    if (mode === 'date-asc' || mode === 'date-desc') {
        sorted.sort((left, right) => {
            const a = getRowChronologicalValue(left);
            const b = getRowChronologicalValue(right);
            if (a === null && b === null) return 0;
            if (a === null) return 1;
            if (b === null) return -1;
            return mode === 'date-asc' ? a - b : b - a;
        });
        return sorted;
    }

    return sorted;
}

function getDefaultCardsPreference(scopeConfig = activeScopeConfig) {
    const defaults = scopeConfig?.cardsLayoutDefaults || {};
    return {
        interior: defaults.interior || 'horizontal',
        label: defaults.label || 'stack',
        maxColumns: defaults.maxColumns || 'auto'
    };
}

function getDefaultRailsPreference(scopeConfig = activeScopeConfig) {
    const defaults = scopeConfig?.railsLayoutDefaults || {};
    return {
        interior: defaults.interior || 'horizontal',
        label: defaults.label || 'stack'
    };
}

function getScopeLayoutPreference(scopeKey = activeScope) {
    if (!scopeLayoutPreferences[scopeKey]) {
        const scopeConfig = SCOPE_DEFINITIONS?.[scopeKey] || activeScopeConfig || {};
        scopeLayoutPreferences[scopeKey] = {
            cards: getDefaultCardsPreference(scopeConfig),
            rails: getDefaultRailsPreference(scopeConfig)
        };
    }
    return scopeLayoutPreferences[scopeKey];
}

function getActiveLayoutPreference() {
    const scopePref = getScopeLayoutPreference(activeScope);
    if (currentLayoutMode === 'rails') {
        return { ...scopePref.rails, maxColumns: 'auto' };
    }
    return { ...scopePref.cards };
}

function normalizeCardsBatchSize(value) {
    if (value === 'all') return 'all';
    const numeric = Number(value);
    if (Number.isInteger(numeric) && numeric > 0) return numeric;
    return 30;
}

function disconnectCardsInfiniteObserver() {
    if (cardsInfiniteObserver) {
        cardsInfiniteObserver.disconnect();
        cardsInfiniteObserver = null;
    }
}

function initializeCardsPaginationState() {
    const cfg = activeScopeConfig?.cardPagination || {};
    const preferredByScope = viewEnhancementState?.cardsPageSizeByScope?.[activeScope];
    const pageSize = normalizeCardsBatchSize(preferredByScope ?? cfg.pageSize ?? 30);
    cardsPaginationState = {
        mode: 'load-more',
        pageSize,
        loadedCount: pageSize === 'all' ? Number.MAX_SAFE_INTEGER : pageSize,
        autoLoading: false,
        scopeKey: activeScope
    };
    disconnectCardsInfiniteObserver();
}

function getFieldCandidates(fieldSpec, scopeConfig = activeScopeConfig) {
    const sourceCandidates = Array.isArray(fieldSpec) ? fieldSpec : [fieldSpec];
    const aliases = scopeConfig?.schemaAliases || scopeConfig?.fieldAliases || {};
    const candidates = [];
    const seen = new Set();

    const addCandidate = (value) => {
        if (value === null || value === undefined || value === '') return;
        const candidate = String(value);
        if (seen.has(candidate)) return;
        seen.add(candidate);
        candidates.push(candidate);
    };

    sourceCandidates.forEach((candidate) => {
        if (candidate && typeof candidate === 'object') {
            addCandidate(candidate.field);
            addCandidate(candidate.name);
            addCandidate(candidate.key);
            (Array.isArray(candidate.fields) ? candidate.fields : []).forEach(addCandidate);
            (Array.isArray(candidate.aliases) ? candidate.aliases : []).forEach(addCandidate);
            return;
        }

        addCandidate(candidate);

        if (typeof candidate === 'string' && Array.isArray(aliases[candidate])) {
            aliases[candidate].forEach(addCandidate);
        }
    });

    return candidates;
}

function shouldUseEventsEditorialMode() {
    return activeScope === 'events'
    && currentLayoutMode === 'cards';
}

let SCOPE_DEFINITIONS = {};
let rawScopeDataCache = {};
let augmentedScopeDataCache = {};

function formatBusDayLabel(day, region) {
    const value = String(day || '').trim();
    if (!value) return '';
    if (value.toLowerCase() === 'all') return 'Every day';
    return value;
}

function initializeScopeDefinitions() {
    if (!window.ScopeDefinitionsFactory?.create) {
        throw new Error('ScopeDefinitionsFactory is not available.');
    }

    SCOPE_DEFINITIONS = window.ScopeDefinitionsFactory.create({
        escapeHtml,
        escapeAttr,
        formatBusDayLabel,
        getImageFallback,
        getDisplayName,
        normalizeTimeList,
        renderArtistLinks,
        renderContactPerformanceLink,
        renderContactGenres,
        renderContactArtistName,
        renderLocationLinkForContact,
        renderLocationContacts,
        renderLocationTags
    });
}

function initializeScrollAwareHeaderCollapse() {
    const canvas = document.querySelector('.view-canvas');
    if (!canvas || canvas.dataset.scrollAwareInit === '1') return;

    let lastScrollTop = 0;
    let rafScheduled = false;

    const syncHeaderState = () => {
        const current = canvas.scrollTop;
        const compactMode = window.innerWidth <= 1023;
        const mapLayout = currentLayoutMode === 'map';
        const disableCondenseForScope = activeScope === 'events' || Boolean(window.__STANDALONE_BUS__);

        if (!compactMode || mapLayout || disableCondenseForScope) {
            document.body.classList.remove('header-condensed');
            lastScrollTop = current;
            return;
        }

        // Use hysteresis thresholds to avoid condensed-header flicker around the top edge.
        if (current >= 44) {
            document.body.classList.add('header-condensed');
        } else if (current <= 16) {
            document.body.classList.remove('header-condensed');
        }

        lastScrollTop = current;
    };

    const scheduleSync = () => {
        if (rafScheduled) return;
        rafScheduled = true;
        requestAnimationFrame(() => {
            rafScheduled = false;
            syncHeaderState();
        });
    };

    canvas.addEventListener('scroll', scheduleSync, { passive: true });
    window.addEventListener('resize', scheduleSync);
    syncScrollAwareHeaderState = scheduleSync;
    canvas.dataset.scrollAwareInit = '1';
    syncHeaderState();
}

const BUS_CARD_MIN_WIDTH = 228;
const BUS_CARD_MIN_WIDTH_FLOOR = 160;
const BUS_PILL_MIN_PX = 34;
const BUS_PILL_MAX_PX = 48;
const BUS_PILL_GAP_PX = 4;
const BUS_PILL_MAX_COLUMNS = 12;
const BUS_LAYOUT_HYSTERESIS_PX = 28;

let busMasonryLayoutCache = { columns: 0, lastWidth: 0 };

function getBusMasonryAvailableWidth(container) {
    const canvas = container?.closest('.view-canvas');
    if (canvas) {
        const styles = window.getComputedStyle(canvas);
        const padL = parseFloat(styles.paddingLeft) || 0;
        const padR = parseFloat(styles.paddingRight) || 0;
        return Math.max(0, Math.floor(canvas.clientWidth - padL - padR));
    }
    return Math.max(0, Math.floor(container?.parentElement?.clientWidth || container?.clientWidth || window.innerWidth));
}

function busMasonryWidthForColumns(columns, gutter) {
    return columns * BUS_CARD_MIN_WIDTH + Math.max(0, columns - 1) * gutter;
}

function resolveBusMasonryColumns(width, gutter) {
    const maxCols = Math.max(1, Math.floor((width + gutter) / (BUS_CARD_MIN_WIDTH + gutter)));

    if (!busMasonryLayoutCache.columns) {
        busMasonryLayoutCache.columns = maxCols;
        busMasonryLayoutCache.lastWidth = width;
        return maxCols;
    }

    if (Math.abs(width - busMasonryLayoutCache.lastWidth) > 140) {
        busMasonryLayoutCache.columns = maxCols;
        busMasonryLayoutCache.lastWidth = width;
        return maxCols;
    }

    let columns = busMasonryLayoutCache.columns;
    while (columns < maxCols && width >= busMasonryWidthForColumns(columns + 1, gutter) + BUS_LAYOUT_HYSTERESIS_PX) {
        columns += 1;
    }
    while (columns > maxCols) {
        columns -= 1;
    }
    while (columns > 1 && width < busMasonryWidthForColumns(columns, gutter) - BUS_LAYOUT_HYSTERESIS_PX) {
        columns -= 1;
    }

    busMasonryLayoutCache.columns = columns;
    busMasonryLayoutCache.lastWidth = width;
    return columns;
}

function getBusPillMinRem(columnWidth) {
    const width = Math.max(0, Math.floor(columnWidth));
    let pillCols = Math.max(1, Math.floor((width + BUS_PILL_GAP_PX) / (BUS_PILL_MIN_PX + BUS_PILL_GAP_PX)));
    pillCols = Math.min(pillCols, BUS_PILL_MAX_COLUMNS);

    let pillMinPx = (width - BUS_PILL_GAP_PX * (pillCols - 1)) / pillCols;
    while (pillMinPx > BUS_PILL_MAX_PX && pillCols < BUS_PILL_MAX_COLUMNS) {
        pillCols += 1;
        pillMinPx = (width - BUS_PILL_GAP_PX * (pillCols - 1)) / pillCols;
    }

    pillMinPx = Math.max(BUS_PILL_MIN_PX, pillMinPx);
    return Math.round((pillMinPx / 16) * 100) / 100;
}

function getBusMasonryLayout(container) {
    const width = getBusMasonryAvailableWidth(container);
    const gutter = width < 640 ? 8 : 12;
    const columns = resolveBusMasonryColumns(width, gutter);
    const columnWidth = columns === 1
        ? width
        : Math.floor((width - gutter * (columns - 1)) / columns);

    const resolvedWidth = Math.max(BUS_CARD_MIN_WIDTH_FLOOR, columnWidth);
    return {
        columnWidth: resolvedWidth,
        columns,
        gutter,
        pillMinRem: getBusPillMinRem(resolvedWidth),
        pillColumns: Math.max(1, Math.floor((resolvedWidth + BUS_PILL_GAP_PX) / (BUS_PILL_MIN_PX + BUS_PILL_GAP_PX)))
    };
}

function layoutBusMasonry(container) {
    if (!container || !container.children.length || typeof Masonry !== 'function') return;

    const canvas = container.closest('.view-canvas');
    const savedScrollTop = canvas ? canvas.scrollTop : 0;

    container.style.width = '100%';
    container.style.maxWidth = '100%';

    const layout = getBusMasonryLayout(container);
    container.style.setProperty('--bus-card-width', `${layout.columnWidth}px`);
    container.style.setProperty('--bus-pill-min', `${layout.pillMinRem}rem`);
    container.dataset.masonryColumns = String(layout.columns);
    container.dataset.pillColumns = String(layout.pillColumns);

    container.querySelectorAll('.profile-card').forEach((card) => {
        card.style.width = `${layout.columnWidth}px`;
    });

    if (globalBusMasonryInstance) {
        try { globalBusMasonryInstance.destroy(); } catch (error) {}
        globalBusMasonryInstance = null;
    }

    globalBusMasonryInstance = new Masonry(container, {
        itemSelector: '.profile-card',
        columnWidth: layout.columnWidth,
        gutter: layout.gutter
    });

    const restoreScroll = () => {
        if (canvas) canvas.scrollTop = savedScrollTop;
    };
    try {
        globalBusMasonryInstance.once('layoutComplete', restoreScroll);
    } catch (error) {
        /* Masonry 4 may lack once */
    }
    requestAnimationFrame(restoreScroll);
}

let busMasonryResizeTimer = null;
let busMasonryResizeObs = null;
function scheduleBusMasonryRelayout() {
    if (activeScope !== 'bus_schedule' || currentLayoutMode !== 'cards') return;
    clearTimeout(busMasonryResizeTimer);
    busMasonryResizeTimer = setTimeout(() => {
        const container = document.getElementById('view-cards');
        if (container?.classList.contains('layout-masonry-buses') && container.children.length) {
            layoutBusMasonry(container);
        }
    }, 160);
}

function wireBusMasonryResize() {
    if (busMasonryResizeObs || window.__busMasonryResizeWired) return;
    window.__busMasonryResizeWired = true;

    const canvas = document.querySelector('.view-canvas');
    if (canvas && typeof ResizeObserver !== 'undefined') {
        busMasonryResizeObs = new ResizeObserver(() => scheduleBusMasonryRelayout());
        busMasonryResizeObs.observe(canvas);
    }
    window.addEventListener('resize', scheduleBusMasonryRelayout);
}

function initializeStandaloneFiltersCollapse() {
    if (!window.__STANDALONE_BUS__) return;

    const canvas = document.querySelector('.view-canvas');
    if (!canvas || canvas.dataset.filtersCollapseInit === '1') return;

    const isCompact = () => window.innerWidth <= 768;
    let filtersCollapsed = false;

    const sync = () => {
        if (!isCompact()) {
            document.body.classList.remove('filters-collapsed');
            filtersCollapsed = false;
            return;
        }
        const top = canvas.scrollTop;
        if (!filtersCollapsed && top > 56) filtersCollapsed = true;
        else if (filtersCollapsed && top < 20) filtersCollapsed = false;
        document.body.classList.toggle('filters-collapsed', filtersCollapsed);
    };

    canvas.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync);
    canvas.dataset.filtersCollapseInit = '1';
    sync();
}

async function bootApp() {
    const standaloneBus = Boolean(window.__STANDALONE_BUS__);
    const query = new URLSearchParams(window.location.search || '');
    const requestedScope = standaloneBus ? 'bus_schedule' : (query.get('scope') || 'dashboard_home');
    const requestedLayout = query.get('layout') || '';

    if (typeof window.applyUiLayoutTokens === 'function') {
        window.applyUiLayoutTokens();
    }

    initializeScopeDefinitions();
    loadKanbanLayoutStateFromStorage();
    loadScopeLayoutPreferencesFromStorage();
    loadViewEnhancementStateFromStorage();
    loadDashboardPanelsFromStorage();

    const preferredSource = window.resolveDataSourceForScope?.(requestedScope);
    if (window.DataProviderFactory) {
        dataProvider = window.DataProviderFactory.create({
            mode: preferredSource?.mode === 'api' ? 'local' : 'local',
            sourceId: preferredSource?.id || 'local_files'
        });
    }

    buildSidebarNavigation();
    const initialScope = SCOPE_DEFINITIONS[requestedScope]
        ? requestedScope
        : (SCOPE_DEFINITIONS.bus_schedule ? 'bus_schedule' : 'dashboard_home');

    const restoredStandalone = standaloneBus ? loadStandaloneBusState() : null;
    if (standaloneBus) suppressStandalonePersist = true;
    await setScope(initialScope);

    if (standaloneBus) {
        wireDestinationPicker();
        if (!applyStandaloneBusState(restoredStandalone)) {
            if (requestedLayout && activeScopeConfig?.layouts?.includes(requestedLayout)) {
                setLayout(requestedLayout);
            }
        }
        suppressStandalonePersist = false;
        saveStandaloneBusState();
        wireStandaloneInstallPrompt();
        syncSearchClearButton();
        startStandaloneLiveClock();
        window.ClockTimePicker?.syncTriggers();
    } else if (requestedLayout && activeScopeConfig?.layouts?.includes(requestedLayout)) {
        setLayout(requestedLayout);
    }

    initializeScrollAwareHeaderCollapse();
    initializeStandaloneFiltersCollapse();
    wireBusMasonryResize();
    initializeScrollTopButton();
    if (!standaloneBus) {
        wireBookingAdminEvents();
        document.getElementById('booking-api-retry')?.addEventListener('click', () => {
            void refreshBookingApiStatus();
        });
        setBookingApiStatus(bookingApiStatusState.level, bookingApiStatusState.text, bookingApiStatusState.detail);
        void refreshBookingApiStatus();
        setInterval(() => {
            void refreshBookingApiStatus();
        }, 45000);
    }
    if (standaloneBus) {
        wireStandalonePrintMenu();
    } else {
        document.getElementById('master-print')?.addEventListener('click', (event) => {
            event.preventDefault();
            triggerSystemPrint();
        });
    }
    document.getElementById('about-info-btn')?.addEventListener('click', () => {
        openStandaloneAboutInfo();
    });
    document.getElementById('signs-info-btn')?.addEventListener('click', () => {
        openBusSignsInfo();
    });
    setInterval(() => {
        if (activeScope === 'bus_schedule' && currentLayoutMode === 'cards') {
            filterAndRenderEngine();
        }
    }, 30000);
}

function buildSidebarNavigation() {
    const scopeLinks = document.getElementById('scope-nav-links');
    if (!scopeLinks) return;
    scopeLinks.innerHTML = '';

    Object.entries(SCOPE_DEFINITIONS).forEach(([scopeKey, config]) => {
        const button = document.createElement('button');
        button.id = `lnk-${scopeKey}`;
        button.className = `nav-link ${activeScope === scopeKey ? 'active' : ''}`;
        button.dataset.scope = scopeKey;
        button.textContent = config.title;
        button.onclick = () => setScope(scopeKey);
        scopeLinks.appendChild(button);
    });
}

async function fetchRawScopeData(scopeKey) {
    if (rawScopeDataCache[scopeKey]) {
        return rawScopeDataCache[scopeKey];
    }

    const scopeConfig = SCOPE_DEFINITIONS[scopeKey];
    if (!scopeConfig) {
        rawScopeDataCache[scopeKey] = [];
        return [];
    }

    let payload = [];
    if (dataProvider) {
        payload = await dataProvider.getScopeData(scopeConfig);
    } else {
        const response = await fetch(`${scopeConfig.file}?v=${Date.now()}`);
        const parsedPayload = await response.json();
        payload = Array.isArray(parsedPayload)
            ? parsedPayload
            : Array.isArray(parsedPayload.items)
                ? parsedPayload.items
                : [];
    }

    rawScopeDataCache[scopeKey] = payload;
    return payload;
}

async function fetchScopeData(scopeKey) {
    if (augmentedScopeDataCache[scopeKey]) {
        return augmentedScopeDataCache[scopeKey];
    }

    const rawDataset = await fetchRawScopeData(scopeKey);
    const clonedDataset = rawDataset.map((item) => ({ ...item }));
    const augmented = await augmentScopeData(scopeKey, clonedDataset);
    augmentedScopeDataCache[scopeKey] = augmented;
    return augmented;
}

function createDefaultFilterState(scopeConfig) {
    const nextState = {};
    (scopeConfig?.filters || []).forEach((filterDef) => {
        if (filterDef.special === 'busDay') {
            nextState[filterDef.id] = 'Weekdays';
        } else {
            nextState[filterDef.id] = 'ALL';
        }
    });
    return nextState;
}

async function setScope(scope) {
    if (!SCOPE_DEFINITIONS[scope]) return;

    activeScope = scope;
    activeScopeConfig = SCOPE_DEFINITIONS[scope];
    activeFilterState = createDefaultFilterState(activeScopeConfig);
    fieldVisibility = {};
    tablePaginationState = {
        pageSize: String(viewEnhancementState?.tablePageSizeByScope?.[scope] || '30'),
        currentPage: 1
    };
    initializeCardsPaginationState();
    (activeScopeConfig.headerControls || []).forEach((control) => {
        if (control.type === 'toggle') {
            fieldVisibility[control.id] = control.defaultOn !== false;
        }
    });

    nukeViewContainers();
    updateActiveScopeButtons();
    document.getElementById('canvas-title').innerText = window.__STANDALONE_BUS__
        ? 'Bus Schedule'
        : activeScopeConfig.title;
    renderLayoutTabs();
    injectCompactControlsHeaderBar();
    applyHeaderControlDefaults();
    activeDataLoadError = null;

    try {
        activeDataset = await fetchScopeData(activeScope);
        const availableModes = activeScopeConfig.layouts || ['cards'];
        const preferredLayout = activeScopeConfig.defaultLayout || 'cards';
        const initialLayout = availableModes.includes(preferredLayout)
            ? preferredLayout
            : (availableModes[0] || 'cards');
        setLayout(initialLayout);
        buildDynamicSlicers();
        filterAndRenderEngine();
    } catch (err) {
        activeDataLoadError = err;
        renderScopeLoadError(err);
    }
}

function renderScopeLoadError(error) {
    const container = document.getElementById('view-cards');
    if (!container) return;

    const title = activeScopeConfig?.title || 'this scope';
    const details = escapeHtml(error?.message || `Unable to load ${activeScopeConfig?.file || 'the data file'}`);
    container.className = 'view-container';
    container.innerHTML = `
        <div class="view-empty-state view-error-state">
            <div class="view-error-title">Unable to load ${escapeHtml(title)}</div>
            <div class="view-error-message">${details}</div>
            <div class="view-error-hint">Check the source file, schema aliases, or parser support, then reload the scope.</div>
        </div>`;
}

function updateActiveScopeButtons() {
    document.querySelectorAll('.nav-link').forEach((el) => el.classList.toggle('active', el.id === `lnk-${activeScope}`));
}

function renderLayoutTabs() {
    const target = document.getElementById('layout-toggles');
    if (!target) return;
    target.innerHTML = '';

    const modes = activeScopeConfig.layouts || ['cards', 'table', 'calendar', 'map'];
    const labels = {
        cards: 'Cards',
        rails: 'Rails',
        table: 'Table',
        calendar: 'Calendar',
        map: 'Map',
        posters: 'Posters',
        flipbook: 'Flipbook',
        deck: 'Deck',
        timeline: 'Timeline',
        gantt: 'Gantt',
        kanban: 'Kanban',
        charts: 'Charts',
        'chartjs-lab': 'Chart.js Lab',
        'gridjs-table': 'Grid.js Table',
        'advanced-table': 'Tabulator',
        dashboard: 'Dashboard'
    };

    modes.forEach((mode) => {
        const button = document.createElement('button');
        button.id = `tab-${mode}`;
        button.className = `view-tab ${currentLayoutMode === mode ? 'active' : ''}`;
        button.textContent = labels[mode] || mode;
        button.onclick = () => setLayout(mode);
        target.appendChild(button);
    });

    if (!window.__STANDALONE_BUS__ && (currentLayoutMode === 'cards' || currentLayoutMode === 'rails')) {
        const pref = getActiveLayoutPreference();
        const inCardsLayout = currentLayoutMode === 'cards';
        const controls = document.createElement('div');
        controls.className = 'cards-layout-switches';
        controls.innerHTML = `
            <label class="cards-layout-switch-label" for="cards-interior-mode">Interior</label>
            <select id="cards-interior-mode" class="cards-layout-select" aria-label="Card interior mode">
                <option value="adaptive" ${pref.interior === 'adaptive' ? 'selected' : ''}>Adaptive</option>
                <option value="horizontal" ${pref.interior === 'horizontal' ? 'selected' : ''}>Horizontal</option>
                <option value="vertical" ${pref.interior === 'vertical' ? 'selected' : ''}>Vertical</option>
            </select>
            <label class="cards-layout-switch-label" for="cards-label-layout">Label/Data</label>
            <select id="cards-label-layout" class="cards-layout-select" aria-label="Card label and data layout">
                <option value="stack" ${pref.label === 'stack' ? 'selected' : ''}>Below</option>
                <option value="row" ${pref.label === 'row' ? 'selected' : ''}>Same row</option>
            </select>
            <label class="cards-layout-switch-label" for="cards-max-columns">Max/row</label>
            <select id="cards-max-columns" class="cards-layout-select" aria-label="Maximum cards per row" ${inCardsLayout ? '' : 'disabled'}>
                <option value="auto" ${pref.maxColumns === 'auto' ? 'selected' : ''}>Auto</option>
                <option value="2" ${pref.maxColumns === '2' ? 'selected' : ''}>2</option>
                <option value="3" ${pref.maxColumns === '3' ? 'selected' : ''}>3</option>
                <option value="4" ${pref.maxColumns === '4' ? 'selected' : ''}>4</option>
                <option value="5" ${pref.maxColumns === '5' ? 'selected' : ''}>5</option>
            </select>
        `;

        const interiorSelect = controls.querySelector('#cards-interior-mode');
    const labelLayoutSelect = controls.querySelector('#cards-label-layout');
        const columnsSelect = controls.querySelector('#cards-max-columns');

        interiorSelect?.addEventListener('change', (event) => {
            setCardsInteriorMode(event.target.value);
        });

        labelLayoutSelect?.addEventListener('change', (event) => {
            setCardsLabelLayout(event.target.value);
        });

        columnsSelect?.addEventListener('change', (event) => {
            setCardsMaxColumns(event.target.value);
        });

        target.appendChild(controls);
    }
}

function setCardsInteriorMode(mode) {
    const allowed = new Set(['adaptive', 'horizontal', 'vertical']);
    const value = allowed.has(mode) ? mode : 'horizontal';
    const scopePref = getScopeLayoutPreference(activeScope);
    if (currentLayoutMode === 'rails') {
        scopePref.rails.interior = value;
    } else {
        scopePref.cards.interior = value;
    }
    saveScopeLayoutPreferencesToStorage();
    if (currentLayoutMode === 'cards' || currentLayoutMode === 'rails') {
        filterAndRenderEngine();
    }
}

function setCardsMaxColumns(value) {
    const allowed = new Set(['auto', '2', '3', '4', '5']);
    const scopePref = getScopeLayoutPreference(activeScope);
    scopePref.cards.maxColumns = allowed.has(value) ? value : 'auto';
    saveScopeLayoutPreferencesToStorage();
    if (currentLayoutMode === 'cards') {
        filterAndRenderEngine();
    }
}

function setCardsLabelLayout(value) {
    const allowed = new Set(['row', 'stack']);
    const layout = allowed.has(value) ? value : 'stack';
    const scopePref = getScopeLayoutPreference(activeScope);
    if (currentLayoutMode === 'rails') {
        scopePref.rails.label = layout;
    } else {
        scopePref.cards.label = layout;
    }
    saveScopeLayoutPreferencesToStorage();
    if (currentLayoutMode === 'cards' || currentLayoutMode === 'rails') {
        filterAndRenderEngine();
    }
}

function renderPassedControlGroup() {
    const greyOn = !!fieldVisibility['btn-grey'];
    const hideOn = !!fieldVisibility['btn-rem'];
    const sparseOn = !!fieldVisibility['btn-hide-sparse-west'];
    return `<div class="passed-control-group" role="group" aria-label="Schedule display">
        <span class="control-group-label">Passed:</span>
        <button type="button" id="btn-grey" class="compact-chip${greyOn ? ' active' : ''}" onclick="toggleFieldVisibility('btn-grey')" aria-pressed="${greyOn ? 'true' : 'false'}">Gray</button>
        <button type="button" id="btn-rem" class="compact-chip${hideOn ? ' active' : ''}" onclick="toggleFieldVisibility('btn-rem')" aria-pressed="${hideOn ? 'true' : 'false'}">Hide</button>
        <span class="control-group-divider" aria-hidden="true"></span>
        <button type="button" id="btn-hide-sparse-west" class="compact-chip${sparseOn ? ' active' : ''}" onclick="toggleFieldVisibility('btn-hide-sparse-west')" aria-pressed="${sparseOn ? 'true' : 'false'}" title="Hide West routes with only 1–2 departures in either direction">Sparse West</button>
    </div>`;
}

function injectCompactControlsHeaderBar() {
    const target = document.getElementById('dynamic-bar-controls');
    if (!target) return;
    target.innerHTML = '';

    const headerControls = activeScopeConfig.headerControls || [];
    const standalone = Boolean(window.__STANDALONE_BUS__);
    const passedToggleIds = new Set(['btn-rem', 'btn-grey', 'btn-hide-sparse-west']);
    let html = '';
    let timePairOpen = false;

    const closeTimePair = () => {
        if (timePairOpen) {
            html += '</div>';
            timePairOpen = false;
        }
    };

    if (standalone && headerControls.some((control) => passedToggleIds.has(control.id))) {
        html += renderPassedControlGroup();
    }

    headerControls.forEach((control) => {
        if (control.type === 'toggle') {
            if (standalone && passedToggleIds.has(control.id)) return;
            closeTimePair();
            const isOn = !!fieldVisibility[control.id];
            html += `<button id="${control.id}" class="compact-btn ${isOn ? 'active' : ''}" onclick="toggleFieldVisibility('${control.id}')">${escapeHtml(control.label)}: ${isOn ? 'ON' : 'OFF'}</button>`;
        } else if (control.type === 'date') {
            closeTimePair();
            html += `<input type="date" id="${control.id}" onchange="filterAndRenderEngine()" title="${escapeHtml(control.label)}"/>`;
        } else if (control.type === 'time') {
            if (standalone && !timePairOpen) {
                html += '<div class="time-window-pair">';
                timePairOpen = true;
            }
            const timeLabel = standalone
                ? (control.id === 'time-filter-end' ? 'To' : '')
                : control.label;
            if (standalone) {
                if (timeLabel) {
                    html += `<span class="time-window-label">${escapeHtml(timeLabel)}</span>`;
                }
                html += `<input type="hidden" id="${control.id}" value=""/>`;
                html += `<button type="button" class="clock-time-trigger" data-clock-input="${control.id}" aria-label="${escapeHtml(control.id === 'time-filter-start' ? 'From' : control.id === 'time-filter-end' ? 'To' : control.label)} time">--:--</button>`;
            } else {
                html += `<input type="time" id="${control.id}" onchange="filterAndRenderEngine()" title="${escapeHtml(control.label)}"/>`;
            }
        } else if (control.type === 'clearBtn') {
            html += `<button type="button" class="compact-btn clear-times-btn" onclick="${control.onClick}()" aria-label="Clear times">&times;</button>`;
            closeTimePair();
        }
    });
    closeTimePair();
    target.innerHTML = html;

    if (standalone) {
        target.querySelectorAll('[data-clock-input]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const inputId = btn.getAttribute('data-clock-input');
                window.ClockTimePicker?.open(inputId, {
                    onDone: () => {
                        filterAndRenderEngine();
                        saveStandaloneBusState();
                    }
                });
            });
        });
        target.querySelectorAll('input[type="hidden"][id^="time-filter"]').forEach((input) => {
            input.addEventListener('change', () => {
                window.ClockTimePicker?.syncTriggers();
                filterAndRenderEngine();
                saveStandaloneBusState();
            });
        });
        window.ClockTimePicker?.syncTriggers();
    }
}

function startStandaloneLiveClock() {
    const target = document.getElementById('live-datetime');
    if (!target || !window.__STANDALONE_BUS__) return;

    const tick = () => {
        const now = new Date();
        const compact = window.matchMedia('(max-width: 768px)').matches;
        target.textContent = now.toLocaleString(undefined, compact ? {
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        } : {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
    };

    tick();
    if (startStandaloneLiveClock._timer) {
        clearInterval(startStandaloneLiveClock._timer);
    }
    startStandaloneLiveClock._timer = setInterval(tick, 1000);
    if (!startStandaloneLiveClock._resizeBound) {
        window.addEventListener('resize', tick);
        startStandaloneLiveClock._resizeBound = true;
    }
}

const STANDALONE_BUS_STATE_KEY = 'standalone-bus.state.v1';
let suppressStandalonePersist = false;
let selectedDestinations = new Set();
let destinationPickerOpen = false;
let starredBusRoutes = new Set();

function getBusRouteStarKey(row) {
    return [
        normalizeText(resolveFieldValue(row, ['region', 'Region'])),
        normalizeText(resolveFieldValue(row, ['to', 'To'])),
        normalizeText(resolveFieldValue(row, ['day', 'Day']))
    ].join('|');
}

function isBusRouteStarred(rowOrKey) {
    const key = typeof rowOrKey === 'string' ? rowOrKey : getBusRouteStarKey(rowOrKey);
    return Boolean(key) && starredBusRoutes.has(key);
}

function renderBusFavButtonHtml(row, { floating = false } = {}) {
    const key = getBusRouteStarKey(row);
    const starred = isBusRouteStarred(key);
    const classes = [
        'bus-fav-btn',
        floating ? 'is-floating' : 'is-table',
        starred ? 'is-starred' : ''
    ].filter(Boolean).join(' ');
    return `<button type="button" class="${classes}" data-star-key="${escapeAttr(key)}" aria-pressed="${starred ? 'true' : 'false'}" aria-label="${starred ? 'Remove from starred' : 'Add to starred'}" title="${starred ? 'Starred' : 'Star'}">★</button>`;
}

function toggleBusRouteStar(key, event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    const starKey = String(key || '').trim();
    if (!starKey) return;
    if (starredBusRoutes.has(starKey)) starredBusRoutes.delete(starKey);
    else starredBusRoutes.add(starKey);
    sanitizeBusStarredFilterSelection();
    saveStandaloneBusState();
    filterAndRenderEngine();
}

function clearStarredBusRoutes() {
    if (!starredBusRoutes.size) return;
    starredBusRoutes.clear();
    if (activeFilterState.starred && activeFilterState.starred !== 'ALL') {
        activeFilterState.starred = 'ALL';
    }
    saveStandaloneBusState();
    filterAndRenderEngine();
}

function loadStandaloneBusState() {
    try {
        const raw = window.localStorage.getItem(STANDALONE_BUS_STATE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (error) {
        console.warn('Failed to load standalone bus state.', error);
        return null;
    }
}

function saveStandaloneBusState() {
    if (!window.__STANDALONE_BUS__ || suppressStandalonePersist) return;
    try {
        const payload = {
            search: document.getElementById('app-search')?.value || '',
            destinations: Array.from(selectedDestinations),
            starred: Array.from(starredBusRoutes),
            layout: (currentLayoutMode === 'signs' ? signsPageReturnLayout : currentLayoutMode) || 'cards',
            filters: { ...activeFilterState },
            toggles: { ...fieldVisibility },
            timeStart: document.getElementById('time-filter-start')?.value || '',
            timeEnd: document.getElementById('time-filter-end')?.value || ''
        };
        window.localStorage.setItem(STANDALONE_BUS_STATE_KEY, JSON.stringify(payload));
    } catch (error) {
        console.warn('Failed to save standalone bus state.', error);
    }
}

function applyStandaloneBusState(state) {
    if (!window.__STANDALONE_BUS__ || !state) return false;

    if (state.filters && typeof state.filters === 'object') {
        activeFilterState = { ...activeFilterState, ...state.filters };
    }
    if (state.toggles && typeof state.toggles === 'object') {
        fieldVisibility = { ...fieldVisibility, ...state.toggles };
    }

    const searchInput = document.getElementById('app-search');
    if (searchInput && typeof state.search === 'string') {
        searchInput.value = state.search;
    }
    if (Array.isArray(state.destinations)) {
        selectedDestinations = new Set(state.destinations.filter((d) => typeof d === 'string' && d.trim()));
    } else {
        selectedDestinations = new Set();
    }
    if (Array.isArray(state.starred)) {
        starredBusRoutes = new Set(state.starred.filter((key) => typeof key === 'string' && key.trim()));
    } else {
        starredBusRoutes = new Set();
    }

    injectCompactControlsHeaderBar();
    renderLayoutTabs();

    const start = document.getElementById('time-filter-start');
    const end = document.getElementById('time-filter-end');
    if (start && typeof state.timeStart === 'string') start.value = state.timeStart;
    if (end && typeof state.timeEnd === 'string') end.value = state.timeEnd;
    window.ClockTimePicker?.syncTriggers();

    const available = activeScopeConfig?.layouts || ['cards'];
    const nextLayout = available.includes(state.layout) ? state.layout : (activeScopeConfig?.defaultLayout || available[0] || 'cards');
    setLayout(nextLayout);
    syncSearchClearButton();
    syncDestinationPickerUI();
    return true;
}

function getLogoUrl(fileName) {
    try {
        return new URL(`logos/${fileName}`, window.location.href).href;
    } catch (error) {
        return `logos/${fileName}`;
    }
}

function getPrintLogoHtml(fileName, className = 'print-logo') {
    const src = escapeHtml(getLogoUrl(fileName));
    return `<img class="${escapeHtml(className)}" src="${src}" alt="" width="36" height="36" />`;
}

function isStandaloneAppDisplay() {
    return window.matchMedia('(display-mode: standalone)').matches
        || window.navigator.standalone === true;
}

function isInstallBarDismissed() {
    try {
        return window.localStorage.getItem('standalone-bus.install-bar.dismissed') === '1';
    } catch (error) {
        return false;
    }
}

function setInstallBarDismissed() {
    try {
        window.localStorage.setItem('standalone-bus.install-bar.dismissed', '1');
    } catch (error) {
        /* ignore */
    }
}

function syncInstallAppBar() {
    const bar = document.getElementById('install-app-bar');
    if (!bar) return;
    const hide = isStandaloneAppDisplay() || isInstallBarDismissed() || !deferredInstallPrompt;
    bar.hidden = hide;
}

function wireStandaloneInstallPrompt() {
    const bar = document.getElementById('install-app-bar');
    const actionBtn = document.getElementById('install-app-bar-action');
    const dismissBtn = document.getElementById('install-app-bar-dismiss');
    if (!bar || !actionBtn || !dismissBtn) return;

    window.addEventListener('beforeinstallprompt', (event) => {
        event.preventDefault();
        deferredInstallPrompt = event;
        syncInstallAppBar();
    });

    window.addEventListener('appinstalled', () => {
        deferredInstallPrompt = null;
        setInstallBarDismissed();
        syncInstallAppBar();
    });

    actionBtn.addEventListener('click', async () => {
        if (!deferredInstallPrompt) {
            openStandaloneAboutInfo();
            return;
        }
        deferredInstallPrompt.prompt();
        try {
            await deferredInstallPrompt.userChoice;
        } catch (error) {
            /* ignore */
        }
        deferredInstallPrompt = null;
        syncInstallAppBar();
    });

    dismissBtn.addEventListener('click', () => {
        setInstallBarDismissed();
        syncInstallAppBar();
    });

    syncInstallAppBar();
}

function openStandaloneAboutInfo() {
    const target = document.getElementById('modal-body-target');
    const lightbox = document.getElementById('lightbox');
    if (!target || !lightbox) return;

    const canInstall = Boolean(deferredInstallPrompt);
    const isStandaloneDisplay = isStandaloneAppDisplay();

    target.className = 'modal-card standalone-about-card';
    target.innerHTML = `
        <button class="close-modal" type="button" onclick="document.getElementById('lightbox').style.display='none'">&times;</button>
        <div class="standalone-about">
            <p class="standalone-about-kicker">About</p>
            <h3>Alex of Rhodes</h3>
            <div class="standalone-about-links">
                <a class="standalone-about-link" href="mailto:alexofrhodes@gmail.com">
                    <span class="standalone-about-link-label">Email</span>
                    <span class="standalone-about-link-value">alexofrhodes@gmail.com</span>
                </a>
                <a class="standalone-about-link" href="https://github.com/alexofrhodes" target="_blank" rel="noopener">
                    <span class="standalone-about-link-label">GitHub</span>
                    <span class="standalone-about-link-value">github.com/alexofrhodes</span>
                </a>
            </div>
            <div class="standalone-about-divider" role="separator"></div>
            <div class="standalone-about-links">
                <a class="standalone-about-link" href="https://www.ktelrodou.gr" target="_blank" rel="noopener">
                    <span class="standalone-about-link-label">East</span>
                    <span class="standalone-about-link-value">www.ktelrodou.gr</span>
                </a>
                <a class="standalone-about-link" href="https://www.rhodes.gr/sygkinonies-metafores-stin-poli-ke-sto-nisi/" target="_blank" rel="noopener">
                    <span class="standalone-about-link-label">West</span>
                    <span class="standalone-about-link-value">rhodes.gr · συγκοινωνίες</span>
                </a>
            </div>
            ${isStandaloneDisplay ? '' : `
            <div class="standalone-about-install">
                <p class="standalone-about-link-label">Install app</p>
                ${canInstall ? `
                <p class="standalone-about-install-hint">Use the bar at the bottom, or:</p>
                <button type="button" class="compact-btn primary" id="about-install-btn">Install now</button>
                ` : `
                <ul class="standalone-about-install-steps">
                    <li><span class="standalone-about-install-platform">iPhone / iPad</span><span class="standalone-about-install-how">Share → Add to Home Screen</span></li>
                    <li><span class="standalone-about-install-platform">Android / Chrome</span><span class="standalone-about-install-how">Menu → Install app</span></li>
                </ul>
                `}
            </div>`}
        </div>
    `;
    lightbox.style.display = 'flex';

    document.getElementById('about-install-btn')?.addEventListener('click', async () => {
        if (!deferredInstallPrompt) return;
        deferredInstallPrompt.prompt();
        try {
            await deferredInstallPrompt.userChoice;
        } catch (error) {
            /* ignore */
        }
        deferredInstallPrompt = null;
        syncInstallAppBar();
        lightbox.style.display = 'none';
    });
}

const BUS_SIGN_EAST = [
    { dest: 'Rhodes', codes: ['15'] },
    { dest: 'Faliraki', codes: ['40'] },
    { dest: 'Kalithies', codes: ['46', 'P'] },
    { dest: 'Kalithea', codes: ['F'] },
    { dest: 'Lindos', codes: ['30'] },
    { dest: 'Archangelos', codes: ['43', 'R'] },
    { dest: 'Kolimbia Beach', codes: ['20', 'K'] },
    { dest: 'Tsambika Beach', codes: ['21', 'T'] },
    { dest: 'Seven Springs', codes: ['22', 'E'] },
    { dest: 'Ladiko · Anthony Quinn', codes: ['45', 'L'] },
    { dest: 'Mantomata', codes: ['18', 'M'] },
    { dest: 'Afantou Center', codes: ['A'] },
    { dest: 'Afantou Beach', codes: ['B'] },
    { dest: 'Stegna Beach', codes: ['44'] },
    { dest: 'Vlicha', codes: ['29', 'V'] },
    { dest: 'Charaki Beach', codes: ['H'] },
    { dest: 'Malona · Massari', codes: ['S'] },
    { dest: 'Lardos', codes: ['31', 'D'] },
    { dest: 'Pilona', codes: ['Y'] },
    { dest: 'Psinthos', codes: ['16'] },
    { dest: 'Laerma', codes: ['32'] },
    { dest: 'Kiotari', codes: ['70'] },
    { dest: 'Gennadi', codes: ['75'] },
    { dest: 'Prasonisi', codes: ['76'] },
    { dest: 'Katavia', codes: ['77'] },
    { dest: 'Apolakia', codes: ['78'] },
    { dest: 'Plimiri', codes: ['71'] }
];

const BUS_SIGN_WEST = [
    { dest: 'Ixia · Ialysos', codes: ['10', '12', '13', '50', '51', '56', '57', '59', '61', '65'] },
    { dest: 'Kremasti', codes: ['12', '13', '50', '51', '56', '57', '59', '61', '65'] },
    { dest: 'Pastida · Maritsa', codes: ['13'] },
    { dest: 'Airport', codes: ['50', '51', '56', '57', '59', '61', '63', '64'] },
    { dest: 'Paradisi', codes: ['51', '56', '57', '59', '61', '63', '64'] },
    { dest: 'Butterfly Valley', codes: ['55'] },
    { dest: 'Theologos', codes: ['56', '57', '59', '61', '63', '64'] },
    { dest: 'Soroni', codes: ['57', '59', '61', '63', '64', '65'] },
    { dest: 'Fanes', codes: ['58', '59', '61', '63', '64'] },
    { dest: 'Kalavarda', codes: ['59', '61', '63', '64'] }
];

function getBusSignsSortMode() {
    try {
        return localStorage.getItem('standalone-bus.signs-sort') === 'number' ? 'number' : 'destination';
    } catch (error) {
        return 'destination';
    }
}

function setBusSignsSortMode(mode) {
    try {
        localStorage.setItem('standalone-bus.signs-sort', mode === 'number' ? 'number' : 'destination');
    } catch (error) {
        /* ignore */
    }
}

function busSignCodeSortKey(codes) {
    const nums = (codes || []).map((c) => Number.parseInt(c, 10)).filter((n) => Number.isFinite(n));
    if (nums.length) return Math.min(...nums);
    const letter = String(codes?.[0] || '').toUpperCase();
    return 1000 + (letter.charCodeAt(0) || 0);
}

function sortBusSignRows(rows, mode) {
    const copy = rows.slice();
    if (mode === 'number') {
        copy.sort((a, b) => {
            const byCode = busSignCodeSortKey(a.codes) - busSignCodeSortKey(b.codes);
            return byCode || a.dest.localeCompare(b.dest);
        });
    } else {
        copy.sort((a, b) => a.dest.localeCompare(b.dest) || busSignCodeSortKey(a.codes) - busSignCodeSortKey(b.codes));
    }
    return copy;
}

function formatBusSignCodes(codes) {
    return (codes || []).join(', ');
}

function renderBusSignList(rows, { destFirst }) {
    return `<ul class="bus-signs-list${destFirst ? ' dest-first' : ''}">${rows.map((row) => {
        const codes = escapeHtml(formatBusSignCodes(row.codes));
        const dest = escapeHtml(row.dest);
        return destFirst
            ? `<li><span class="bus-signs-dest">${dest}</span><span class="bus-signs-codes">${codes}</span></li>`
            : `<li><span class="bus-signs-codes">${codes}</span><span class="bus-signs-dest">${dest}</span></li>`;
    }).join('')}</ul>`;
}

function closeBusSignsPage() {
    document.body.classList.remove('signs-page-open');
    const page = document.getElementById('view-signs');
    if (page) {
        page.style.display = 'none';
        page.hidden = true;
        page.innerHTML = '';
    }
    const restore = signsPageReturnLayout === 'signs' ? 'cards' : (signsPageReturnLayout || 'cards');
    if (currentLayoutMode === 'signs') {
        setLayout(restore);
    } else {
        filterAndRenderEngine();
    }
}

function renderBusSignsPage() {
    const page = document.getElementById('view-signs');
    if (!page) return;
    const mode = getBusSignsSortMode();
    const east = sortBusSignRows(BUS_SIGN_EAST, mode);
    const west = sortBusSignRows(BUS_SIGN_WEST, mode);
    page.innerHTML = `
        <div class="bus-signs bus-signs-page-inner">
            <div class="bus-signs-page-top">
                <button type="button" class="bus-signs-back" data-signs-back>← Back</button>
                <h2 class="bus-signs-page-title">Bus destination signs</h2>
            </div>
            <p class="bus-signs-hint">Buses usually show the destination on the front. Line numbers and letters are extra route info — they may also appear on the display.</p>
            <div class="bus-signs-sort" role="group" aria-label="Sort signs">
                <button type="button" class="compact-chip${mode === 'destination' ? ' active' : ''}" data-signs-sort="destination">Destination</button>
                <button type="button" class="compact-chip${mode === 'number' ? ' active' : ''}" data-signs-sort="number">Number</button>
            </div>
            <div class="bus-signs-grid">
                <section class="bus-signs-panel">
                    <p class="bus-signs-title">KTEL · East</p>
                    ${renderBusSignList(east, { destFirst: false })}
                </section>
                <section class="bus-signs-panel">
                    <p class="bus-signs-title">RODA · West</p>
                    ${renderBusSignList(west, { destFirst: true })}
                </section>
            </div>
        </div>
    `;
    page.querySelector('[data-signs-back]')?.addEventListener('click', () => closeBusSignsPage());
    page.querySelectorAll('[data-signs-sort]').forEach((btn) => {
        btn.addEventListener('click', () => {
            setBusSignsSortMode(btn.getAttribute('data-signs-sort'));
            renderBusSignsPage();
        });
    });
}

function openBusSignsInfo() {
    const page = document.getElementById('view-signs');
    if (!page) return;
    if (currentLayoutMode !== 'signs') {
        signsPageReturnLayout = currentLayoutMode || 'cards';
    }
    document.body.classList.add('signs-page-open');
    ['cards', 'rails', 'table', 'calendar', 'posters', 'flipbook', 'deck', 'timeline', 'gantt', 'kanban', 'charts', 'chartjs-lab', 'gridjs-table', 'advanced-table', 'dashboard', 'map'].forEach((viewKey) => {
        const el = document.getElementById(`view-${viewKey}`);
        if (el) el.style.display = 'none';
    });
    const pills = document.getElementById('inline-filter-pills');
    if (pills) {
        pills.innerHTML = '';
        pills.style.display = 'none';
    }
    page.hidden = false;
    page.style.display = '';
    currentLayoutMode = 'signs';
    document.querySelectorAll('.view-tab').forEach((el) => el.classList.remove('active'));
    renderBusSignsPage();
}

function formatDateInputValue(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function resolveHeaderControlDefaultValue(control) {
    const raw = control?.defaultValue;
    if (raw === undefined || raw === null || raw === '') return '';

    if (typeof raw === 'function') {
        return String(raw());
    }

    if (typeof raw !== 'string') {
        return String(raw);
    }

    const token = raw.trim().toLowerCase();
    if (token === 'today') {
        return formatDateInputValue(new Date());
    }

    const offsetMatch = token.match(/^today([+-]\d+)$/);
    if (offsetMatch) {
        const date = new Date();
        date.setDate(date.getDate() + Number(offsetMatch[1]));
        return formatDateInputValue(date);
    }

    return raw;
}

function applyHeaderControlDefaults() {
    const controls = activeScopeConfig?.headerControls || [];
    controls.forEach((control) => {
        if (!control?.id) return;
        if (!Object.prototype.hasOwnProperty.call(control, 'defaultValue')) return;

        const el = document.getElementById(control.id);
        if (!el || el.value) return;

        const resolved = resolveHeaderControlDefaultValue(control);
        if (resolved === '') return;
        el.value = resolved;
    });
}

function toggleFieldVisibility(controlId) {
    fieldVisibility[controlId] = !fieldVisibility[controlId];
    const btn = document.getElementById(controlId);
    const control = (activeScopeConfig.headerControls || []).find((c) => c.id === controlId);
    if (btn && control) {
        btn.classList.toggle('active', fieldVisibility[controlId]);
        if (window.__STANDALONE_BUS__ && (controlId === 'btn-rem' || controlId === 'btn-grey' || controlId === 'btn-hide-sparse-west')) {
            btn.setAttribute('aria-pressed', fieldVisibility[controlId] ? 'true' : 'false');
        } else {
            btn.innerText = `${control.label}: ${fieldVisibility[controlId] ? 'ON' : 'OFF'}`;
        }
    }
    filterAndRenderEngine();
    saveStandaloneBusState();
}

function clearBusTimeFilters() {
    const start = document.getElementById('time-filter-start');
    const end = document.getElementById('time-filter-end');
    if (start) start.value = '';
    if (end) end.value = '';
    window.ClockTimePicker?.syncTriggers();
    filterAndRenderEngine();
    saveStandaloneBusState();
}

function clearDateFilters() {
    const start = document.getElementById('filter-start');
    const end = document.getElementById('filter-end');
    if (start) start.value = '';
    if (end) end.value = '';
    filterAndRenderEngine();
}

function syncSearchClearButton() {
    const searchInput = document.getElementById('app-search');
    const clearButton = document.getElementById('app-search-clear');
    if (!searchInput || !clearButton) return;
    if (window.__STANDALONE_BUS__) {
        clearButton.hidden = false;
        clearButton.disabled = !searchInput.value.trim();
        return;
    }
    clearButton.hidden = !searchInput.value.trim();
}

function handleSearchInput() {
    syncSearchClearButton();
    filterAndRenderEngine();
    saveStandaloneBusState();
}

function clearSearchQuery() {
    const searchInput = document.getElementById('app-search');
    if (searchInput) {
        searchInput.value = '';
        searchInput.focus();
    }
    syncSearchClearButton();
    filterAndRenderEngine();
    saveStandaloneBusState();
}

function nukeViewContainers() {
    disconnectCardsInfiniteObserver();

    if (globalBusMasonryInstance) {
        try { globalBusMasonryInstance.destroy(); } catch (e) {}
        globalBusMasonryInstance = null;
    }

    const cardsView = document.getElementById('view-cards');
    const railsView = document.getElementById('view-rails');
    const tableView = document.getElementById('view-table');
    const calendarView = document.getElementById('view-calendar');
    const postersView = document.getElementById('view-posters');
    const flipbookView = document.getElementById('view-flipbook');
    const deckView = document.getElementById('view-deck');
    const timelineView = document.getElementById('view-timeline');
    const ganttView = document.getElementById('view-gantt');
    const kanbanView = document.getElementById('view-kanban');
    const chartsView = document.getElementById('view-charts');
    const chartJsLabView = document.getElementById('view-chartjs-lab');
    const gridJsTableView = document.getElementById('view-gridjs-table');
    const advancedTableView = document.getElementById('view-advanced-table');
    const dashboardView = document.getElementById('view-dashboard');
    const mapView = document.getElementById('view-map');

    if (cardsView) {
        cardsView.innerHTML = '';
        cardsView.className = 'view-container';
        cardsView.removeAttribute('style');
    }
    if (railsView) {
        railsView.innerHTML = '';
        railsView.className = 'view-container';
        railsView.removeAttribute('style');
    }
    if (tableView) {
        tableView.innerHTML = '';
        tableView.className = 'view-container';
        tableView.removeAttribute('style');
    }
    if (calendarView) {
        calendarView.className = 'view-container';
        calendarView.removeAttribute('style');
    }
    if (postersView) {
        postersView.innerHTML = '';
        postersView.className = 'view-container';
        postersView.removeAttribute('style');
    }
    if (flipbookView) {
        flipbookView.innerHTML = '';
        flipbookView.className = 'view-container';
        flipbookView.removeAttribute('style');
    }
    if (deckView) {
        deckView.innerHTML = '';
        deckView.className = 'view-container';
        deckView.removeAttribute('style');
    }
    if (timelineView) {
        timelineView.innerHTML = '';
        timelineView.className = 'view-container';
        timelineView.removeAttribute('style');
    }
    if (ganttView) {
        ganttView.innerHTML = '';
        ganttView.className = 'view-container';
        ganttView.removeAttribute('style');
    }
    if (kanbanView) {
        kanbanView.innerHTML = '';
        kanbanView.className = 'view-container';
        kanbanView.removeAttribute('style');
    }
    if (chartsView) {
        chartsView.innerHTML = '';
        chartsView.className = 'view-container';
        chartsView.removeAttribute('style');
    }
    if (chartJsLabView) {
        chartJsLabView.innerHTML = '';
        chartJsLabView.className = 'view-container';
        chartJsLabView.removeAttribute('style');
    }
    if (gridJsTableView) {
        gridJsTableView.innerHTML = '';
        gridJsTableView.className = 'view-container';
        gridJsTableView.removeAttribute('style');
    }
    if (advancedTableView) {
        advancedTableView.innerHTML = '';
        advancedTableView.className = 'view-container';
        advancedTableView.removeAttribute('style');
    }
    if (dashboardView) {
        dashboardView.innerHTML = '';
        dashboardView.className = 'view-container';
        dashboardView.removeAttribute('style');
    }
    if (mapView) {
        mapView.className = 'view-container';
        mapView.removeAttribute('style');
    }

    if (calendarInstance) {
        calendarInstance.destroy();
        calendarInstance = null;
    }
    const calendarHost = document.getElementById('calendar-container');
    if (calendarHost) calendarHost.innerHTML = '';

    if (leafletMap) {
        leafletMap.remove();
        leafletMap = null;
    }

    if (timelineInstance) {
        try { timelineInstance.destroy(); } catch (e) {}
        timelineInstance = null;
    }

    if (chartsInstance) {
        try { chartsInstance.dispose(); } catch (e) {}
        chartsInstance = null;
    }

    if (flipbookInstance) {
        try { flipbookInstance.destroy?.(); } catch (e) {}
        flipbookInstance = null;
    }

    if (deckInstance) {
        try { deckInstance.destroy(true, true); } catch (e) {}
        deckInstance = null;
    }

    if (ganttInstance) {
        ganttInstance = null;
    }
    const mapHost = document.getElementById('map-container');
    if (mapHost) mapHost.innerHTML = '';

    if (busClusterGroup) {
        busClusterGroup = null;
    }
    if (mapClusterGroup) {
        mapClusterGroup = null;
    }

    const pillsStrip = document.getElementById('inline-filter-pills');
    if (pillsStrip) {
        pillsStrip.innerHTML = '';
        pillsStrip.style.display = 'none';
    }
}

function toggleMobileDrawer(open) {
    const sidebar = document.getElementById('sidebar');
    const mask = document.getElementById('sidebar-mask');
    if (sidebar) sidebar.classList.toggle('open', open);
    if (mask) mask.classList.toggle('open', open);
}

function setLayout(mode) {
    if (mode !== 'signs') {
        document.body.classList.remove('signs-page-open');
        const signsPage = document.getElementById('view-signs');
        if (signsPage) {
            signsPage.style.display = 'none';
            signsPage.hidden = true;
        }
    }
    currentLayoutMode = mode;
    document.body.classList.toggle('map-layout-mode', mode === 'map');
    if (mode === 'map') {
        document.body.classList.remove('header-condensed');
    }
    if (mode !== 'cards') {
        disconnectCardsInfiniteObserver();
    }
    document.querySelectorAll('.view-tab').forEach((el) => el.classList.remove('active'));
    const targetedTab = document.getElementById(`tab-${mode}`);
    if (targetedTab) targetedTab.classList.add('active');
    buildDynamicSlicers();
    filterAndRenderEngine();
    if (typeof syncScrollAwareHeaderState === 'function') {
        syncScrollAwareHeaderState();
    }
    saveStandaloneBusState();
}

function setScopeFilterValue(filterId, value) {
    if (!Object.prototype.hasOwnProperty.call(activeFilterState, filterId)) return;
    activeFilterState[filterId] = value;
    buildDynamicSlicers();
    filterAndRenderEngine();
    saveStandaloneBusState();
}

function shouldRenderInlineFilters() {
    if (activeScopeConfig?.showInlineFilters === false) return false;
    return getActiveScopeFilters().length > 0;
}

function shouldRenderSidebarFilters() {
    if (typeof activeScopeConfig?.showSidebarFilters === 'boolean') {
        return activeScopeConfig.showSidebarFilters;
    }
    return !activeScopeConfig?.hideSidebarFilters;
}

function renderInlineFilterPills() {
    const container = document.getElementById('inline-filter-pills');
    if (!container) return;

    sanitizeBusRegionFilterSelection();
    sanitizeBusDayFilterSelection();
    sanitizeBusStarredFilterSelection();

    const filters = getActiveScopeFilters();
    if (!filters.length || !shouldRenderInlineFilters()) {
        container.innerHTML = '';
        container.style.display = 'none';
        return;
    }

    container.innerHTML = '';
    let renderedSections = 0;

    filters.forEach((filterDef) => {
        const options = getFilterOptions(filterDef, filterDef.id);
        const nonAllOptions = options.filter((option) => option !== 'ALL');
        if (filterDef.special !== 'busDay' && filterDef.special !== 'busStarred' && !nonAllOptions.length) {
            return;
        }

        const section = document.createElement('section');
        section.className = 'inline-filter-group';

        const label = document.createElement('div');
        label.className = 'inline-filter-label';
        label.textContent = filterDef.label;
        section.appendChild(label);

        const row = document.createElement('div');
        row.className = 'inline-filter-row';

        const selected = activeFilterState[filterDef.id] || 'ALL';

        if (filterDef.special !== 'busDay') {
            const allChip = document.createElement('button');
            allChip.className = `inline-filter-chip ${selected === 'ALL' ? 'active' : ''}`;
            allChip.textContent = 'All';
            allChip.onclick = () => setScopeFilterValue(filterDef.id, 'ALL');
            row.appendChild(allChip);
        }

        const optionList = (activeScope === 'bus_schedule' && filterDef.id === 'region')
            ? getAllBusRegionOptions()
            : options.filter((option) => option !== 'ALL');

        optionList.forEach((option) => {
            const chip = document.createElement('button');
            const available = isFilterOptionAvailable(filterDef, option);
            chip.className = `inline-filter-chip ${selected === option ? 'active' : ''}${available ? '' : ' is-disabled'}`;
            chip.textContent = option;
            chip.disabled = !available;
            if (available) {
                chip.onclick = () => setScopeFilterValue(filterDef.id, option);
            }
            row.appendChild(chip);
        });

        if (filterDef.special === 'busStarred' && starredBusRoutes.size > 0) {
            const clearChip = document.createElement('button');
            clearChip.className = 'inline-filter-chip inline-filter-clear';
            clearChip.textContent = 'Clear';
            clearChip.title = 'Clear all starred routes';
            clearChip.onclick = () => clearStarredBusRoutes();
            row.appendChild(clearChip);
        }

        section.appendChild(row);
        container.appendChild(section);
        renderedSections += 1;
    });

    container.style.display = renderedSections > 0 ? '' : 'none';
    syncInlineFilterRowFadeState(container);
}

function syncInlineFilterRowFadeState(container) {
    if (!container) return;
    const rows = container.querySelectorAll('.inline-filter-row');

    rows.forEach((row) => {
        const applyEndState = () => {
            const max = Math.max(0, row.scrollWidth - row.clientWidth);
            const atEnd = max <= 1 || row.scrollLeft >= (max - 1);
            row.classList.toggle('at-end', atEnd);
        };

        if (row.dataset.fadeInit !== '1') {
            row.addEventListener('scroll', applyEndState, { passive: true });
            window.addEventListener('resize', applyEndState);
            row.dataset.fadeInit = '1';
        }

        requestAnimationFrame(applyEndState);
    });
}

function normalizeListValue(value) {
    if (Array.isArray(value)) return value.filter((item) => item !== null && item !== undefined && String(item).trim() !== '');
    if (typeof value === 'string' && value.trim().startsWith('[')) {
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            return [value];
        }
    }
    if (value === null || value === undefined || value === '') return [];
    return [value];
}

function getArtistDisplayName(contact) {
    return contact?.StageName || getDisplayName(contact);
}

function formatCompactDate(value) {
    if (!value) return '';
    const parsed = new Date(String(value).replace(' ', 'T'));
    if (Number.isNaN(parsed.getTime())) return String(value);
    return new Intl.DateTimeFormat('en-GB', {
        day: '2-digit',
        month: 'short'
    }).format(parsed);
}

async function augmentScopeData(scopeKey, dataset) {
    if (scopeKey === 'events') {
        const contacts = await fetchRawScopeData('contacts');
        const contactById = new Map(contacts.map((contact) => [String(contact.id), contact]));

        return dataset.map((eventItem) => {
            const artistIds = normalizeListValue(eventItem.artist_ids || eventItem.artistIds);
            const artistContacts = artistIds
                .map((artistId) => contactById.get(String(artistId)))
                .filter(Boolean);
            const artistNames = eventItem.artist_names && normalizeListValue(eventItem.artist_names).length
                ? normalizeListValue(eventItem.artist_names)
                : artistContacts.map((contact) => getArtistDisplayName(contact));

            return {
                ...eventItem,
                artist_ids: artistIds,
                artist_names: artistNames,
                artistsLabel: artistNames.join(', '),
                artist_contacts: artistContacts.map((contact) => ({
                    id: contact.id,
                    name: getArtistDisplayName(contact)
                }))
            };
        });
    }

    if (scopeKey === 'contacts') {
        const events = await fetchRawScopeData('events');
        const locationsRaw = await fetchRawScopeData('locations').catch(() => []);
        const locations = Array.isArray(locationsRaw) ? locationsRaw : [];
        const locationById = new Map(locations.map((location) => [String(location.id), location]));

        return dataset.map((contact) => {
            const artistKey = getArtistDisplayName(contact);
            const linkedLocation = locationById.get(String(contact.location_id)) || null;
            const linkedEvents = events
                .filter((eventItem) => {
                    const artistIds = normalizeListValue(eventItem.artist_ids || eventItem.artistIds).map(String);
                    const artistNames = normalizeListValue(eventItem.artist_names).map((name) => normalizeText(name));
                    return artistIds.includes(String(contact.id)) || artistNames.includes(normalizeText(artistKey));
                })
                .sort((left, right) => new Date(String(left.start).replace(' ', 'T')) - new Date(String(right.start).replace(' ', 'T')));

            const nextPerformance = linkedEvents.find((eventItem) => {
                const parsed = new Date(String(eventItem.start).replace(' ', 'T'));
                return !Number.isNaN(parsed.getTime()) && parsed >= new Date();
            }) || null;

            return {
                ...contact,
                location_name: linkedLocation?.name || '',
                location_type: linkedLocation?.type || '',
                performanceEvents: linkedEvents,
                performanceCount: linkedEvents.length,
                performanceSummary: linkedEvents.map((eventItem) => eventItem.title).join(', '),
                nextPerformanceTitle: nextPerformance?.title || '',
                nextPerformanceDate: nextPerformance?.start || ''
            };
        });
    }

    if (scopeKey === 'locations') {
        const contacts = await fetchRawScopeData('contacts');

        return dataset.map((location) => {
            const linkedContacts = contacts
                .filter((contact) => String(contact.location_id) === String(location.id))
                .map((contact) => ({
                    id: contact.id,
                    name: getArtistDisplayName(contact),
                    fullName: getDisplayName(contact)
                }));

            return {
                ...location,
                linkedContacts,
                linkedContactCount: linkedContacts.length,
                linkedContactNames: linkedContacts.map((contact) => contact.name).join(', ')
            };
        });
    }

    return dataset;
}

function renderArtistLinks(row) {
    const names = normalizeListValue(row.artist_names);
    const contacts = Array.isArray(row.artist_contacts) ? row.artist_contacts : [];
    if (!names.length) return '<span class="inline-muted">TBA</span>';

    const chips = names.map((name, index) => {
        const linkedContact = contacts[index];
        if (linkedContact?.id !== undefined) {
            return `<button class="inline-link-btn inline-chip-button" onclick="openLinkedContactById('${escapeAttr(linkedContact.id)}')">${escapeHtml(name)}</button>`;
        }
        return `<span class="inline-chip">${escapeHtml(name)}</span>`;
    }).join(' ');

    return `<div class="inline-chip-group">${chips}</div>`;
}

function renderContactGenres(row) {
    const genres = normalizeListValue(row.Genres || row.genres);
    if (!genres.length) return '<span class="inline-muted">-</span>';
    return `<div class="inline-chip-group">${genres.map((genre) => `<span class="inline-chip">${escapeHtml(genre)}</span>`).join(' ')}</div>`;
}

function renderLocationTags(row) {
    const tags = normalizeListValue(row.tags);
    if (!tags.length) return '<span class="inline-muted">-</span>';

    const clickableTags = !!activeScopeConfig?.clickableTags;
    const chips = tags.map((tag) => {
        if (clickableTags) {
            return `<button class="inline-chip inline-chip-button" onclick="setScopeFilterValue('tags', '${escapeAttr(tag)}')">${escapeHtml(tag)}</button>`;
        }
        return `<span class="inline-chip">${escapeHtml(tag)}</span>`;
    }).join(' ');

    return `<div class="inline-chip-group">${chips}</div>`;
}

function renderContactArtistName(row) {
    if (!row.StageName) return '<span class="inline-muted">-</span>';
    return `<span class="inline-artist-name">${escapeHtml(row.StageName)}</span>`;
}

function renderLocationLinkForContact(row) {
    if (!row.location_id) return '<span class="inline-muted">No location</span>';
    const label = row.location_name || `Location ${row.location_id}`;
    return `<button class="inline-link-btn" onclick="openLocationsForId('${escapeAttr(row.location_id)}')">${escapeHtml(label)}</button>`;
}

function renderLocationContacts(row) {
    const linkedContacts = Array.isArray(row.linkedContacts) ? row.linkedContacts : [];
    if (!linkedContacts.length) return '<span class="inline-muted">No linked contacts</span>';

    const links = linkedContacts.slice(0, 4).map((contact) => {
        const label = contact.name || contact.fullName;
        return `<button class="inline-link-btn inline-chip-button" onclick="openLinkedContactById('${escapeAttr(contact.id)}')">${escapeHtml(label)}</button>`;
    }).join(' ');

    if (linkedContacts.length <= 4) {
        return `<div class="inline-chip-group">${links}</div>`;
    }

    return `<div class="inline-chip-group">${links} <button class="inline-link-btn inline-chip-button" onclick="openContactsForLocationId('${escapeAttr(row.id)}')">+${linkedContacts.length - 4} more</button></div>`;
}

function renderContactPerformanceLink(row) {
    if (!row.performanceCount) return '<span class="inline-muted">No linked events</span>';
    const label = row.nextPerformanceTitle
        ? `${escapeHtml(row.nextPerformanceTitle)} · ${escapeHtml(formatCompactDate(row.nextPerformanceDate))}`
        : `${row.performanceCount} linked events`;
    const artistName = getArtistDisplayName(row);
    return `<button class="inline-link-btn" onclick="openEventsForArtistName('${escapeAttr(artistName)}')">${label}</button>`;
}

async function openLinkedContactById(contactId) {
    const contacts = await fetchScopeData('contacts');
    const linkedContact = contacts.find((contact) => String(contact.id) === String(contactId));
    await setScope('contacts');
    const searchInput = document.getElementById('app-search');
    if (searchInput) {
        searchInput.value = linkedContact ? getDisplayName(linkedContact) : String(contactId);
    }
    syncSearchClearButton();
    filterAndRenderEngine();
}

async function openEventsForArtistName(artistName) {
    await setScope('events');
    activeFilterState.artist = artistName;
    buildDynamicSlicers();
    filterAndRenderEngine();
}

async function openLocationsForId(locationId) {
    const locations = await fetchScopeData('locations');
    const linkedLocation = locations.find((location) => String(location.id) === String(locationId));
    await setScope('locations');

    const searchInput = document.getElementById('app-search');
    if (searchInput) {
        searchInput.value = linkedLocation?.name || String(locationId);
    }
    syncSearchClearButton();
    filterAndRenderEngine();
}

async function openContactsForLocationId(locationId) {
    const locations = await fetchScopeData('locations');
    const linkedLocation = locations.find((location) => String(location.id) === String(locationId));
    await setScope('contacts');

    if (linkedLocation?.name) {
        activeFilterState.location = linkedLocation.name;
        buildDynamicSlicers();
    }
    filterAndRenderEngine();
}

function buildDynamicSlicers() {
    const container = document.getElementById('slicer-box');
    if (!container) return;

    container.innerHTML = '';
    if (!shouldRenderSidebarFilters()) return;
    if (shouldUseEventsEditorialMode() && activeScopeConfig?.showSidebarFilters !== true) return;

    const filters = getActiveScopeFilters();
    if (!filters.length) return;
    let hasRenderableFilter = false;

    filters.forEach((filterDef) => {
        const options = getFilterOptions(filterDef, filterDef.id);
        const nonAllOptions = options.filter((option) => option !== 'ALL');
        if (filterDef.special !== 'busDay' && !nonAllOptions.length) {
            return;
        }

        if (!hasRenderableFilter) {
            const title = document.createElement('div');
            title.className = 'section-label';
            title.innerText = activeScope === 'bus_schedule' ? 'Filters' : 'Filters';
            container.appendChild(title);
            hasRenderableFilter = true;
        }

        const section = document.createElement('div');
        section.className = 'slicer-section';

        const label = document.createElement('div');
        label.className = 'section-label';
        label.innerText = filterDef.label;
        section.appendChild(label);

        const wrapper = document.createElement('div');
        wrapper.className = 'slicer-flex';

        const selected = activeFilterState[filterDef.id] || 'ALL';

        if (filterDef.special !== 'busDay') {
            const allNode = document.createElement('div');
            allNode.className = `slicer-node ${selected === 'ALL' ? 'active' : ''}`;
            allNode.innerText = 'Show All';
            allNode.onclick = () => {
                activeFilterState[filterDef.id] = 'ALL';
                buildDynamicSlicers();
                filterAndRenderEngine();
                toggleMobileDrawer(true);
            };
            wrapper.appendChild(allNode);
        }

        options.forEach((option) => {
            if (option === 'ALL') return;
            const node = document.createElement('div');
            node.className = `slicer-node ${selected === option ? 'active' : ''}`;
            node.innerText = option;
            node.onclick = () => {
                activeFilterState[filterDef.id] = option;
                buildDynamicSlicers();
                filterAndRenderEngine();
                toggleMobileDrawer(true);
            };
            wrapper.appendChild(node);
        });

        section.appendChild(wrapper);
        container.appendChild(section);
    });
}

function doesRowMatchFilterSelection(row, filterDef, selected) {
    if (filterDef.special === 'busDay') {
        if (!selected || selected === 'ALL') return true;
        const rowDay = resolveFieldValue(row, filterDef.field);
        return busDayMatchesSelection(rowDay, selected);
    }

    if (filterDef.special === 'busStarred') {
        if (!selected || selected === 'ALL') return true;
        return selected === 'Starred' ? isBusRouteStarred(row) : true;
    }

    if (selected === 'ALL') return true;
    if (filterDef.type === 'date') {
        const rowDate = String(resolveFieldValue(row, filterDef.field)).split(' ')[0];
        return rowDate === selected;
    }
    if (filterDef.type === 'time') {
        return String(resolveFieldValue(row, filterDef.field)) === selected;
    }

    const rowValues = normalizeListValue(resolveFieldValue(row, filterDef.field)).map((value) => normalizeText(value));
    return rowValues.includes(normalizeText(selected));
}

function doesRowMatchActiveFilters(row, excludedFilterId = null) {
    return getActiveScopeFilters().every((filterDef) => {
        if (excludedFilterId && filterDef.id === excludedFilterId) {
            return true;
        }
        const selected = activeFilterState[filterDef.id] || 'ALL';
        return doesRowMatchFilterSelection(row, filterDef, selected);
    });
}

function getAllBusRegionOptions() {
    const regions = new Set();
    activeDataset.forEach((row) => {
        const value = String(resolveFieldValue(row, ['region', 'Region']) || '').trim();
        if (value) regions.add(value);
    });
    return Array.from(regions).sort((a, b) => a.localeCompare(b));
}

function isFilterOptionAvailable(filterDef, option) {
    if (option === 'ALL') return true;
    return activeDataset.some((row) => {
        if (!doesRowMatchActiveFilters(row, filterDef.id)) return false;
        if (filterDef.special === 'busDay') {
            const rowDay = resolveFieldValue(row, filterDef.field);
            return busDayMatchesSelection(rowDay, option);
        }
        if (filterDef.special === 'busStarred') {
            return option === 'Starred' ? isBusRouteStarred(row) : true;
        }
        const values = normalizeListValue(resolveFieldValue(row, filterDef.field));
        return values.some((value) => String(value) === option);
    });
}

function sanitizeBusDayFilterSelection() {
    if (activeScope !== 'bus_schedule') return;
    const dayFilter = getActiveScopeFilters().find((filterDef) => filterDef.id === 'day');
    if (!dayFilter) return;
    const selected = activeFilterState.day || 'Weekdays';
    if (!isFilterOptionAvailable(dayFilter, selected)) {
        activeFilterState.day = 'Weekdays';
    }
}

function sanitizeBusStarredFilterSelection() {
    if (activeScope !== 'bus_schedule') return;
    const starredFilter = getActiveScopeFilters().find((filterDef) => filterDef.id === 'starred');
    if (!starredFilter) return;
    const selected = activeFilterState.starred || 'ALL';
    if (selected === 'ALL') return;
    if (!isFilterOptionAvailable(starredFilter, selected)) {
        activeFilterState.starred = 'ALL';
    }
}

function sanitizeBusRegionFilterSelection() {
    if (activeScope !== 'bus_schedule') return;
    const regionFilter = getActiveScopeFilters().find((filterDef) => filterDef.id === 'region');
    if (!regionFilter) return;
    const selected = activeFilterState.region || 'ALL';
    if (selected === 'ALL') return;
    if (!isFilterOptionAvailable(regionFilter, selected)) {
        activeFilterState.region = 'ALL';
    }
}

function getFilterOptions(filterDef, excludedFilterId = null) {
    if (filterDef.special === 'busDay') {
        return ['Weekdays', 'Saturday', 'Sunday'];
    }
    if (filterDef.special === 'busStarred') {
        return ['ALL', 'Starred'];
    }

    const sourceRows = excludedFilterId
        ? activeDataset.filter((row) => doesRowMatchActiveFilters(row, excludedFilterId))
        : activeDataset;

    const values = new Set();
    sourceRows.forEach((row) => {
        const resolved = resolveFieldValue(row, filterDef.field);
        const valueList = normalizeListValue(resolved);
        valueList.forEach((value) => {
            if (value === '' || value === null || value === undefined) return;
            if (filterDef.type === 'date') {
                values.add(String(value).split(' ')[0]);
            } else if (filterDef.type === 'time' && typeof value === 'string') {
                values.add(value);
            } else {
                values.add(String(value));
            }
        });
    });
    return ['ALL', ...Array.from(values).sort((a, b) => a.localeCompare(b))];
}

function getRowDestination(row) {
    return String(resolveFieldValue(row, ['to', 'To']) || '').trim();
}

function parseSearchTerms(raw) {
    return String(raw || '')
        .split(',')
        .map((term) => term.trim().toLowerCase())
        .filter(Boolean);
}

function rowMatchesSearchTerms(row, terms) {
    if (!terms.length) return true;
    const haystack = (activeScopeConfig?.searchFields || [])
        .map((field) => String(resolveFieldValue(row, field) || ''))
        .join(' ')
        .toLowerCase();
    return terms.some((term) => haystack.includes(term));
}

function rowMatchesBusTimeWindow(row) {
    if (activeScope !== 'bus_schedule') return true;
    const timeStart = document.getElementById('time-filter-start')?.value || '';
    const timeEnd = document.getElementById('time-filter-end')?.value || '';
    if (!timeStart && !timeEnd) return true;
    const timesOutbound = normalizeTimeList(resolveFieldValue(row, ['timesOut', 'outbound', 'times']));
    const timesInbound = normalizeTimeList(resolveFieldValue(row, ['timesBack', 'inbound', 'returns']));
    return timesOutbound.concat(timesInbound).some((time) => isTimeInWindow(time, timeStart, timeEnd));
}

function matchesRowFilters(row, { includeSearch = true, includeDestinations = true, skipDay = false } = {}) {
    if (!doesRowMatchActiveFilters(row, skipDay ? 'day' : null)) return false;

    if (activeScopeConfig?.headerControls?.length) {
        const startControl = activeScopeConfig.headerControls.find((c) => c.operator === 'gte');
        const endControl = activeScopeConfig.headerControls.find((c) => c.operator === 'lte');
        const startMin = startControl ? document.getElementById(startControl.id)?.value || '' : '';
        const endMax = endControl ? document.getElementById(endControl.id)?.value || '' : '';

        if (startMin || endMax) {
            const rowDate = String(resolveFieldValue(row, startControl?.field || 'start')).split(' ')[0];
            if (startMin && rowDate && rowDate < startMin) return false;
            if (endMax && rowDate && rowDate > endMax) return false;
        }
    }

    if (!rowMatchesBusTimeWindow(row)) return false;

    if (fieldVisibility['btn-hide-sparse-west'] && isSparseWestRoute(row)) return false;

    if (includeDestinations && selectedDestinations.size > 0) {
        if (!selectedDestinations.has(getRowDestination(row))) return false;
    }

    if (includeSearch) {
        const terms = parseSearchTerms(document.getElementById('app-search')?.value);
        if (!rowMatchesSearchTerms(row, terms)) return false;
    }

    return true;
}

function getRecordsForDestinationPicker() {
    if (activeDataLoadError) return [];
    return activeDataset.filter((row) => matchesRowFilters(row, { includeSearch: false, includeDestinations: false }));
}

function getAvailableDestinations() {
    const names = new Set();
    getRecordsForDestinationPicker().forEach((row) => {
        const dest = getRowDestination(row);
        if (dest) names.add(dest);
    });
    return Array.from(names).sort((a, b) => a.localeCompare(b));
}

function pruneSelectedDestinations() {
    if (!selectedDestinations.size) return;
    const available = new Set(getAvailableDestinations());
    selectedDestinations.forEach((dest) => {
        if (!available.has(dest)) selectedDestinations.delete(dest);
    });
}

function syncDestinationPickerButton() {
    const btn = document.getElementById('dest-picker-btn');
    if (!btn) return;
    const count = selectedDestinations.size;
    btn.textContent = count ? `Dest (${count})` : 'Dest';
    btn.classList.toggle('has-selection', count > 0);
    btn.setAttribute('aria-expanded', destinationPickerOpen ? 'true' : 'false');
}

function renderDestinationPickerPanel() {
    const panel = document.getElementById('dest-picker-panel');
    if (!panel) return;

    pruneSelectedDestinations();
    const destinations = getAvailableDestinations();
    const selectedCount = selectedDestinations.size;

    if (!destinations.length) {
        panel.innerHTML = '<div class="dest-picker-empty">No destinations match current filters.</div>';
        return;
    }

    const items = destinations.map((dest, index) => {
        const checked = selectedDestinations.has(dest);
        const id = `dest-opt-${index}`;
        return `<label class="dest-picker-item" for="${id}">
            <input type="checkbox" id="${id}" value="${escapeHtml(dest)}"${checked ? ' checked' : ''}/>
            <span>${escapeHtml(dest)}</span>
        </label>`;
    }).join('');

    panel.innerHTML = `
        <div class="dest-picker-head">
            <span class="dest-picker-title">${escapeHtml(String(destinations.length))} stops</span>
            <div class="dest-picker-actions">
                <button type="button" class="dest-picker-ok">OK</button>
                <button type="button" class="dest-picker-clear"${selectedCount ? '' : ' disabled'}>Clear</button>
            </div>
        </div>
        <div class="dest-picker-list">${items}</div>`;

    panel.querySelector('.dest-picker-ok')?.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        setDestinationPickerOpen(false);
    });

    panel.querySelector('.dest-picker-clear')?.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        selectedDestinations.clear();
        syncDestinationPickerButton();
        renderDestinationPickerPanel();
        filterAndRenderEngine();
        saveStandaloneBusState();
    });

    panel.querySelectorAll('input[type="checkbox"]').forEach((input) => {
        input.addEventListener('change', () => {
            const dest = input.value;
            if (input.checked) selectedDestinations.add(dest);
            else selectedDestinations.delete(dest);
            syncDestinationPickerButton();
            const clearBtn = panel.querySelector('.dest-picker-clear');
            if (clearBtn) clearBtn.disabled = selectedDestinations.size === 0;
            filterAndRenderEngine();
            saveStandaloneBusState();
        });
    });
}

function setDestinationPickerOpen(open) {
    destinationPickerOpen = open;
    const panel = document.getElementById('dest-picker-panel');
    const btn = document.getElementById('dest-picker-btn');
    if (!panel || !btn) return;

    if (open) {
        renderDestinationPickerPanel();
        panel.hidden = false;
    } else {
        panel.hidden = true;
    }
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function wireDestinationPicker() {
    if (!window.__STANDALONE_BUS__) return;
    const btn = document.getElementById('dest-picker-btn');
    const panel = document.getElementById('dest-picker-panel');
    if (!btn || !panel || btn.dataset.wired === '1') return;

    btn.dataset.wired = '1';
    syncDestinationPickerButton();

    btn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        setDestinationPickerOpen(panel.hidden);
    });

    document.addEventListener('click', (event) => {
        if (!destinationPickerOpen) return;
        if (event.target.closest('.dest-picker-wrap')) return;
        setDestinationPickerOpen(false);
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && destinationPickerOpen) {
            setDestinationPickerOpen(false);
        }
    });
}

function syncDestinationPickerUI() {
    if (!window.__STANDALONE_BUS__) return;
    syncDestinationPickerButton();
    if (destinationPickerOpen) {
        renderDestinationPickerPanel();
    }
}

function getFilteredRecords() {
    if (activeDataLoadError) return [];
    const rows = activeDataset.filter((row) => matchesRowFilters(row));
    if (activeScope === 'bus_schedule') return sortBusScheduleRows(rows);
    return rows;
}

function getBusScheduleTableRecords() {
    if (activeDataLoadError) return [];
    const rows = activeDataset.filter((row) => matchesRowFilters(row, { skipDay: true }));
    return sortBusScheduleRows(rows);
}

function getTimetablePrintRecords() {
    if (activeDataLoadError) return [];
    return activeDataset.filter((row) => matchesRowFilters(row, { skipDay: true }));
}

function getBusPrintRecords() {
    const rows = getTimetablePrintRecords();
    return sortBusScheduleRows(rows);
}

function getBusRegionSortKey(region) {
    const value = normalizeText(region);
    if (value === 'east') return 0;
    if (value === 'west') return 1;
    return 2;
}

function getBusDayBand(row) {
    const day = normalizeText(resolveFieldValue(row, ['day', 'Day']));
    if (day === 'saturday') return 'saturday';
    if (day === 'sunday') return 'sunday';
    return 'weekdays';
}

function getBusDayBandSortKey(band) {
    if (band === 'weekdays') return 0;
    if (band === 'saturday') return 1;
    if (band === 'sunday') return 2;
    return 3;
}

function getBusRegionSectionLabel(region) {
    const value = normalizeText(region);
    if (value === 'east') return 'East';
    if (value === 'west') return 'West';
    return String(region || 'Other').trim() || 'Other';
}

function getBusDayBandSectionLabel(region, band) {
    if (band === 'weekdays') {
        return normalizeText(region) === 'west' ? 'Mon–Fri' : 'Every day';
    }
    if (band === 'saturday') return 'Saturday';
    return 'Sunday';
}

function sortBusScheduleRowsWithinBand(list) {
    return list.slice().sort((a, b) => String(a.to || '').localeCompare(String(b.to || '')));
}

function sortBusScheduleRows(list) {
    return list.slice().sort((a, b) => {
        const byRegion = getBusRegionSortKey(a.region) - getBusRegionSortKey(b.region);
        if (byRegion !== 0) return byRegion;
        const byDay = getBusDayBandSortKey(getBusDayBand(a)) - getBusDayBandSortKey(getBusDayBand(b));
        if (byDay !== 0) return byDay;
        return String(a.to || '').localeCompare(String(b.to || ''));
    });
}

function getBusScheduleTableSections(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const sections = [];
    const regionKeys = ['east', 'west'];
    const dayBands = ['weekdays', 'saturday', 'sunday'];

    regionKeys.forEach((regionKey) => {
        const regionRows = list.filter((row) => normalizeText(row.region) === regionKey);
        dayBands.forEach((band) => {
            const bandRows = sortBusScheduleRowsWithinBand(regionRows.filter((row) => getBusDayBand(row) === band));
            if (!bandRows.length) return;
            sections.push({
                title: `${getBusRegionSectionLabel(regionKey)} · ${getBusDayBandSectionLabel(regionKey, band)}`,
                bandClass: regionKey === 'east' ? 'east' : 'west',
                regionKey,
                rows: bandRows
            });
        });
    });

    const otherRows = list.filter((row) => {
        const region = normalizeText(row.region);
        return region && region !== 'east' && region !== 'west';
    });
    if (otherRows.length) {
        sections.push({
            title: 'Other',
            bandClass: '',
            rows: sortBusScheduleRowsWithinBand(otherRows)
        });
    }

    return sections;
}

const BUS_OUTBOUND_LABEL = 'OUTBOUND FROM RHODES TOWN';
const BUS_RETURN_LABEL = 'RETURN TO RHODES TOWN';

function getRouteTimeCounts(row) {
    const out = normalizeTimeList(row.timesOut || row.outbound || row.times || []).filter(Boolean);
    const back = normalizeTimeList(row.timesBack || row.inbound || row.returns || []).filter(Boolean);
    return { out: out.length, back: back.length };
}

function isSparseWestRoute(row) {
    if (String(row.region || '').trim().toLowerCase() !== 'west') return false;
    const { out, back } = getRouteTimeCounts(row);
    return (out >= 1 && out <= 2) || (back >= 1 && back <= 2);
}

function getBusTableRowClass(row) {
    const regionKey = String(row.region || '').trim().toLowerCase().replace(/\s+/g, '-');
    const routeTitle = String(row.to || '').trim().toLowerCase();
    const splitFaliraki = routeTitle === 'kalithea-faliraki';
    if (splitFaliraki) return 'bus-table-row region-split-faliraki';
    if (regionKey === 'east') return 'bus-table-row region-east';
    if (regionKey === 'west') return 'bus-table-row region-west';
    return 'bus-table-row';
}

function getTablePaginationConfig(totalItems) {
    if (activeScopeConfig?.tablePagination?.enabled === false) {
        return {
            enabled: false,
            items: { startIndex: 0, endIndex: totalItems },
            pageSize: 'all',
            currentPage: 1,
            totalPages: 1,
            totalItems
        };
    }
    const pageSizeRaw = tablePaginationState.pageSize;
    const normalizedPageSize = pageSizeRaw === 'all' ? totalItems || 1 : Math.max(1, Number(pageSizeRaw) || 30);
    const totalPages = pageSizeRaw === 'all' ? 1 : Math.max(1, Math.ceil(totalItems / normalizedPageSize));
    const currentPage = Math.min(Math.max(1, tablePaginationState.currentPage), totalPages);
    tablePaginationState.currentPage = currentPage;

    const startIndex = pageSizeRaw === 'all' ? 0 : (currentPage - 1) * normalizedPageSize;
    const endIndex = pageSizeRaw === 'all' ? totalItems : startIndex + normalizedPageSize;

    return {
        enabled: true,
        items: {
            startIndex,
            endIndex
        },
        pageSize: pageSizeRaw,
        currentPage,
        totalPages,
        totalItems
    };
}

function setTablePageSize(value) {
    tablePaginationState.pageSize = value;
    tablePaginationState.currentPage = 1;
    if (!viewEnhancementState.tablePageSizeByScope || typeof viewEnhancementState.tablePageSizeByScope !== 'object') {
        viewEnhancementState.tablePageSizeByScope = {};
    }
    viewEnhancementState.tablePageSizeByScope[activeScope] = String(value || '30');
    saveViewEnhancementStateToStorage();
    if (currentLayoutMode === 'table') {
        filterAndRenderEngine();
    }
}

function setTablePage(page) {
    tablePaginationState.currentPage = Math.max(1, Number(page) || 1);
    if (currentLayoutMode === 'table') {
        filterAndRenderEngine();
    }
}

function getCardsPaginationConfig(totalItems) {
    const cfg = activeScopeConfig?.cardPagination;
    if (!cfg?.enabled) {
        return {
            enabled: false,
            mode: 'none',
            startIndex: 0,
            endIndex: totalItems,
            loadedCount: totalItems,
            totalItems,
            hasMore: false,
            currentPage: 1,
            totalPages: 1,
            pageSize: totalItems
        };
    }

    const pageSize = normalizeCardsBatchSize(cardsPaginationState.pageSize ?? cfg.pageSize ?? 30);
    cardsPaginationState.pageSize = pageSize;
    cardsPaginationState.mode = 'load-more';
    const mode = cardsPaginationState.mode;

    const minBatch = pageSize === 'all' ? totalItems : pageSize;
    const loadedCount = pageSize === 'all'
        ? totalItems
        : Math.min(totalItems, Math.max(minBatch, Number(cardsPaginationState.loadedCount) || minBatch));
    cardsPaginationState.loadedCount = loadedCount;

    return {
        enabled: true,
        mode,
        pageSize,
        startIndex: 0,
        endIndex: loadedCount,
        loadedCount,
        totalItems,
        hasMore: loadedCount < totalItems
    };
}

function isCompactCardsPaginationLayout() {
    return window.innerWidth <= 767;
}

function setCardsPageSize(value) {
    const size = normalizeCardsBatchSize(value);
    cardsPaginationState.pageSize = size;
    cardsPaginationState.loadedCount = size === 'all' ? Number.MAX_SAFE_INTEGER : size;
    if (!viewEnhancementState.cardsPageSizeByScope || typeof viewEnhancementState.cardsPageSizeByScope !== 'object') {
        viewEnhancementState.cardsPageSizeByScope = {};
    }
    viewEnhancementState.cardsPageSizeByScope[activeScope] = size;
    saveViewEnhancementStateToStorage();
    if (currentLayoutMode === 'cards') {
        filterAndRenderEngine();
    }
}

function loadMoreCards() {
    if (cardsPaginationState.pageSize === 'all') return;
    cardsPaginationState.loadedCount += normalizeCardsBatchSize(cardsPaginationState.pageSize);
    if (currentLayoutMode === 'cards') {
        filterAndRenderEngine();
    }
}

function renderCardsPaginationControls(pagination) {
    if (!pagination?.enabled) return;

    const controls = document.createElement('div');
    controls.className = 'cards-pagination-bar';

    const currentSize = String(pagination.pageSize || '30');
    controls.innerHTML = `
        <div class="cards-pagination-summary">${pagination.loadedCount} of ${pagination.totalItems} cards loaded</div>
        <div class="table-pagination-controls">
            <label class="table-pagination-label" for="cards-page-size">Items</label>
            <select id="cards-page-size" class="table-pagination-select" onchange="setCardsPageSize(this.value)">
                <option value="30" ${currentSize === '30' ? 'selected' : ''}>30</option>
                <option value="60" ${currentSize === '60' ? 'selected' : ''}>60</option>
                <option value="100" ${currentSize === '100' ? 'selected' : ''}>100</option>
                <option value="all" ${currentSize === 'all' ? 'selected' : ''}>All</option>
            </select>
        </div>
    `;

    return controls;
}

function renderCardsInfiniteSentinel(container, pagination) {
    if (pagination.mode !== 'load-more' || !pagination.hasMore) {
        disconnectCardsInfiniteObserver();
        return;
    }

    const sentinel = document.createElement('div');
    sentinel.className = 'cards-infinite-sentinel';
    container.appendChild(sentinel);

    disconnectCardsInfiniteObserver();
    const scrollRoot = container.closest('.view-canvas') || null;
    cardsInfiniteObserver = new IntersectionObserver((entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting || cardsPaginationState.autoLoading) return;
        cardsPaginationState.autoLoading = true;
        loadMoreCards();
        cardsPaginationState.autoLoading = false;
    }, { root: scrollRoot, rootMargin: '160px 0px', threshold: 0 });
    cardsInfiniteObserver.observe(sentinel);
}

function resolveActionValue(value, row) {
    if (typeof value === 'function') return value(row);
    return value;
}

async function runCardAction(row, action, card, cfg) {
    if (!action) return;
    const resolvedAction = typeof action === 'function' ? action(row) : action;
    if (!resolvedAction) return;

    const actionType = typeof resolvedAction === 'string' ? resolvedAction : resolvedAction.type || 'lightbox';

    if (actionType === 'url') {
        const url = resolveActionValue(resolvedAction.url || resolvedAction.href || resolvedAction.link || '', row);
        const normalized = normalizeExternalUrl(url);
        if (!normalized || isPlaceholderUrl(normalized)) {
            openBookingRequestModal({
                status: 'This link is a placeholder in sample data.',
                isError: true
            });
            return;
        }
        const target = resolvedAction.target || '_blank';
        window.open(String(normalized), target, 'noopener');
        return;
    }

    if (actionType === 'scope') {
        const targetScope = resolveActionValue(resolvedAction.scope || resolvedAction.scopeKey || '', row);
        if (!targetScope) return;
        await setScope(String(targetScope));

        if (resolvedAction.layout) {
            setLayout(String(resolvedAction.layout));
        }

        const searchInput = document.getElementById('app-search');
        const query = resolveActionValue(resolvedAction.searchValue || resolvedAction.query || resolvedAction.search || '', row);
        if (searchInput && query) {
            searchInput.value = String(query);
        }
        syncSearchClearButton();

        const filterId = resolvedAction.filterId;
        if (filterId) {
            activeFilterState[filterId] = resolveActionValue(resolvedAction.filterValue || resolvedAction.value || '', row) || 'ALL';
            buildDynamicSlicers();
        }

        filterAndRenderEngine();
        return;
    }

    if (actionType === 'search') {
        const searchInput = document.getElementById('app-search');
        const query = resolveActionValue(resolvedAction.query || resolvedAction.search || resolvedAction.value || '', row);
        if (searchInput && query) {
            searchInput.value = String(query);
        }
        syncSearchClearButton();
        filterAndRenderEngine();
        return;
    }

    if (actionType === 'booking') {
        await runBookingAction(row, resolvedAction);
        return;
    }

    if (actionType === 'details-popup') {
        const title = resolveActionValue(resolvedAction.title || '', row)
            || cfg?.title?.render?.(row)
            || resolveFieldValue(row, ['title', 'name'])
            || 'Details';

        const imageId = resolveActionValue(resolvedAction.imageId || resolvedAction.image || '', row);
        const imageSelector = imageId ? `[data-img-id="${escapeAttr(imageId)}"]` : 'img[data-img-id]';
        const imageEl = card?.querySelector(imageSelector) || card?.querySelector('img[data-img-id]');
        const source = resolveActionValue(resolvedAction.path || resolvedAction.src || '', row) || imageEl?.src || 'event_placeholder.png';

        const detailFields = Array.isArray(resolvedAction.fields) ? resolvedAction.fields : [];
        const detailLines = detailFields.map((fieldDef) => {
            if (typeof fieldDef === 'string') {
                const value = resolveFieldValue(row, fieldDef);
                if (value === '' || value === null || value === undefined) return null;
                return `${fieldDef}: ${String(value)}`;
            }

            if (!fieldDef || typeof fieldDef !== 'object') return null;
            const value = resolveFieldValue(row, fieldDef.field || fieldDef.key || fieldDef.id || '');
            if ((value === '' || value === null || value === undefined) && fieldDef.showEmpty !== true) return null;
            return `${fieldDef.label || fieldDef.field || 'Field'}: ${String(value ?? '-')}`;
        }).filter(Boolean);

        const caption = detailLines.length
            ? detailLines.join('\n')
            : resolveActionValue(resolvedAction.caption || '', row) || cfg?.subtitle?.render?.(row) || '';

        triggerLightboxPopup(source, title, caption);
        return;
    }

    const imageId = resolveActionValue(resolvedAction.imageId || resolvedAction.image || resolvedAction.field || '', row);
    const imageSelector = imageId ? `[data-img-id="${escapeAttr(imageId)}"]` : 'img[data-img-id]';
    const imageEl = card?.querySelector(imageSelector) || card?.querySelector('img[data-img-id]');
    const source = resolveActionValue(resolvedAction.path || resolvedAction.src || resolvedAction.imagePath || '', row) || imageEl?.src || '';
    const title = resolveActionValue(resolvedAction.title || resolvedAction.name || resolvedAction.label || '', row) || cfg?.title?.render?.(row) || resolveFieldValue(row, ['title', 'name']) || 'Item';
    const caption = resolveActionValue(resolvedAction.caption || resolvedAction.typeLabel || resolvedAction.subtitle || '', row) || cfg?.subtitle?.render?.(row) || '';
    triggerLightboxPopup(source || 'event_placeholder.png', title, caption);
}

function attachCardAction(card, row, cfg, action = null) {
    if (!card) return;

    const resolvedAction = action || cfg?.clickAction || null;
    const fallbackImage = (cfg?.images || []).find((imgDef) => {
        const visible = imgDef.visibilityToggleId ? !!fieldVisibility[imgDef.visibilityToggleId] : true;
        return visible && imgDef.popup;
    });

    const cardAction = resolvedAction || (fallbackImage ? { type: 'lightbox', imageId: fallbackImage.id } : null);
    if (!cardAction) return;

    card.classList.add('card-clickable');
    card.tabIndex = 0;
    card.setAttribute('role', 'button');

    const activate = () => {
        void runCardAction(row, cardAction, card, cfg);
    };

    card.addEventListener('click', (event) => {
        if (event.target.closest('button,a,input,textarea,select')) return;
        activate();
    });

    card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            activate();
        }
    });
}

async function runWithTemporaryScopeContext(scopeKey, layoutMode, callback) {
    const prev = {
        activeScope,
        activeScopeConfig,
        currentLayoutMode,
        activeFilterState
    };

    activeScope = scopeKey;
    activeScopeConfig = SCOPE_DEFINITIONS[scopeKey] || activeScopeConfig;
    currentLayoutMode = layoutMode;
    activeFilterState = createDefaultFilterState(activeScopeConfig);

    try {
        return await callback();
    } finally {
        activeScope = prev.activeScope;
        activeScopeConfig = prev.activeScopeConfig;
        currentLayoutMode = prev.currentLayoutMode;
        activeFilterState = prev.activeFilterState;
    }
}

function applyDashboardPanelFilter(dataset, panel) {
    if (!Array.isArray(dataset)) return [];
    const filter = panel?.filter;
    if (!filter || typeof filter !== 'object') return dataset;

    const fieldSpec = filter.field || filter.key || filter.fields;
    const expectedValue = String(filter.value ?? '').trim();
    if (!fieldSpec || !expectedValue) return dataset;

    return dataset.filter((row) => {
        const rowValues = normalizeListValue(resolveFieldValue(row, fieldSpec)).map((value) => normalizeText(value));
        return rowValues.includes(normalizeText(expectedValue));
    });
}

function getDashboardPanelsForScope(scopeKey = activeScope) {
    if (Object.prototype.hasOwnProperty.call(dashboardPanelsByScope, scopeKey)) {
        const persisted = dashboardPanelsByScope[scopeKey];
        if (Array.isArray(persisted)) {
            return persisted.map((panel) => ({ ...panel }));
        }
    }

    const defaults = Array.isArray(SCOPE_DEFINITIONS?.[scopeKey]?.dashboardViews)
        ? SCOPE_DEFINITIONS[scopeKey].dashboardViews
        : [];
    return defaults.map((panel) => ({ ...panel }));
}

function setDashboardPanelsForScope(scopeKey, panels) {
    if (!scopeKey) return;
    if (!Array.isArray(panels)) {
        dashboardPanelsByScope[scopeKey] = [];
    } else {
        dashboardPanelsByScope[scopeKey] = panels.map((panel) => ({ ...panel }));
    }
    saveDashboardPanelsToStorage();
}

const DASHBOARD_SIMPLE_MODE_STRIP_SELECTORS = Object.freeze({
    rails: ['.rails-section-nav'],
    posters: ['.posters-toolbar'],
    flipbook: ['.flipbook-controls'],
    deck: ['.deck-toolbar', '.deck-thumbs'],
    timeline: ['.timeline-toolbar'],
    gantt: ['.timeline-toolbar'],
    kanban: ['.kanban-toolbar', '.kanban-lane-snapbar'],
    charts: ['.charts-toolbar'],
    'advanced-table': ['.advanced-table-toolbar']
});

function collectDashboardPanelToolbars(target, drawerBody, viewKey) {
    if (!target || !drawerBody) return false;
    const selectors = DASHBOARD_SIMPLE_MODE_STRIP_SELECTORS[viewKey] || [];
    let hasControls = false;

    drawerBody.innerHTML = '';

    selectors.forEach((selector) => {
        target.querySelectorAll(selector).forEach((node) => {
            if (!node || node.closest('.dashboard-panel-drawer-body')) return;
            drawerBody.appendChild(node);
            hasControls = true;
        });
    });

    return hasControls;
}

function applyDashboardSimpleModePostProcess(target, drawerBody, viewKey) {
    if (!target) return false;
    return collectDashboardPanelToolbars(target, drawerBody, viewKey);
}

function normalizeDashboardPanelFilters(value) {
    if (!value || typeof value !== 'object') return {};
    const next = {};
    Object.entries(value).forEach(([key, selected]) => {
        const val = String(selected || '').trim();
        if (key && val && val !== 'ALL') {
            next[key] = val;
        }
    });
    return next;
}

function doesRowMatchPanelFilters(row, filtersById, scopeConfig, excludedFilterId = null) {
    const filterDefs = Array.isArray(scopeConfig?.filters) ? scopeConfig.filters : [];
    return filterDefs.every((filterDef) => {
        if (!filterDef?.id) return true;
        if (excludedFilterId && filterDef.id === excludedFilterId) return true;
        const selected = filtersById[filterDef.id] || 'ALL';
        return doesRowMatchFilterSelection(row, filterDef, selected);
    });
}

function getDashboardPanelFilterOptions(dataset, scopeConfig, filterDef, filtersById) {
    if (!filterDef) return ['ALL'];
    if (filterDef.special === 'busDay') {
        return ['Weekdays', 'Saturday', 'Sunday'];
    }

    const sourceRows = (Array.isArray(dataset) ? dataset : [])
        .filter((row) => doesRowMatchPanelFilters(row, filtersById, scopeConfig, filterDef.id));

    const values = new Set();
    sourceRows.forEach((row) => {
        const resolved = resolveFieldValue(row, filterDef.field);
        const valueList = normalizeListValue(resolved);
        valueList.forEach((value) => {
            if (value === '' || value === null || value === undefined) return;
            if (filterDef.type === 'date') {
                values.add(String(value).split(' ')[0]);
            } else if (filterDef.type === 'time' && typeof value === 'string') {
                values.add(value);
            } else {
                values.add(String(value));
            }
        });
    });

    return ['ALL', ...Array.from(values).sort((a, b) => a.localeCompare(b))];
}

function applyDashboardPanelFilters(dataset, scopeConfig, panelFilters) {
    const filterDefs = Array.isArray(scopeConfig?.filters) ? scopeConfig.filters : [];
    if (!filterDefs.length) return Array.isArray(dataset) ? dataset : [];
    const normalized = normalizeDashboardPanelFilters(panelFilters);
    if (!Object.keys(normalized).length) return Array.isArray(dataset) ? dataset : [];

    return (Array.isArray(dataset) ? dataset : []).filter((row) => {
        return filterDefs.every((filterDef) => {
            if (!filterDef?.id) return true;
            const selected = normalized[filterDef.id] || 'ALL';
            return doesRowMatchFilterSelection(row, filterDef, selected);
        });
    });
}

function renderDashboardPanelFiltersDrawer(drawerBody, dataset, scopeConfig, panelFilters, onUpdate) {
    if (!drawerBody) return false;

    const filterDefs = Array.isArray(scopeConfig?.filters) ? scopeConfig.filters : [];
    if (!filterDefs.length) return false;

    const normalized = normalizeDashboardPanelFilters(panelFilters);
    const section = document.createElement('div');
    section.className = 'dashboard-panel-filters';
    section.innerHTML = '<div class="dashboard-panel-filters-title">Filters</div>';

    let hasRenderable = false;
    filterDefs.forEach((filterDef) => {
        if (!filterDef?.id) return;
        const options = getDashboardPanelFilterOptions(dataset, scopeConfig, filterDef, normalized);
        const nonAllOptions = options.filter((option) => option !== 'ALL');
        if (filterDef.special !== 'busDay' && !nonAllOptions.length) {
            return;
        }

        hasRenderable = true;
        const row = document.createElement('label');
        row.className = 'dashboard-panel-filter-row';

        const label = document.createElement('span');
        label.className = 'dashboard-panel-filter-label';
        label.textContent = String(filterDef.label || filterDef.id);

        const select = document.createElement('select');
        select.className = 'table-pagination-select dashboard-panel-filter-select';
        select.innerHTML = options.map((option) => {
            const selected = (normalized[filterDef.id] || 'ALL') === option ? 'selected' : '';
            const text = option === 'ALL' ? 'Show All' : option;
            return `<option value="${escapeAttr(option)}" ${selected}>${escapeHtml(text)}</option>`;
        }).join('');

        select.addEventListener('change', () => {
            const next = { ...normalized };
            const picked = String(select.value || 'ALL');
            if (picked === 'ALL') {
                delete next[filterDef.id];
            } else {
                next[filterDef.id] = picked;
            }
            if (typeof onUpdate === 'function') {
                onUpdate(next);
            }
        });

        row.appendChild(label);
        row.appendChild(select);
        section.appendChild(row);
    });

    if (!hasRenderable) {
        return false;
    }

    drawerBody.appendChild(section);
    return true;
}

function getDefaultPanelHeaderControlState(scopeConfig) {
    const controls = Array.isArray(scopeConfig?.headerControls) ? scopeConfig.headerControls : [];
    const state = {};
    controls.forEach((control) => {
        if (!control?.id) return;
        if (control.type === 'toggle') {
            state[control.id] = control.defaultOn !== false;
        } else if (control.type === 'date' || control.type === 'time') {
            state[control.id] = resolveHeaderControlDefaultValue(control) || '';
        }
    });
    return state;
}

function normalizeDashboardPanelHeaderState(scopeConfig, value) {
    const defaults = getDefaultPanelHeaderControlState(scopeConfig);
    if (!value || typeof value !== 'object') return defaults;

    const next = { ...defaults };
    const controls = Array.isArray(scopeConfig?.headerControls) ? scopeConfig.headerControls : [];
    controls.forEach((control) => {
        if (!control?.id || !Object.prototype.hasOwnProperty.call(value, control.id)) return;
        if (control.type === 'toggle') {
            next[control.id] = value[control.id] !== false;
        } else if (control.type === 'date' || control.type === 'time') {
            next[control.id] = String(value[control.id] || '');
        }
    });

    return next;
}

function buildPanelFieldVisibility(scopeConfig, headerState) {
    const controls = Array.isArray(scopeConfig?.headerControls) ? scopeConfig.headerControls : [];
    const visibility = {};
    controls.forEach((control) => {
        if (control?.type !== 'toggle' || !control?.id) return;
        visibility[control.id] = headerState?.[control.id] !== false;
    });
    return visibility;
}

function applyDashboardPanelHeaderControls(dataset, scopeConfig, headerState) {
    const controls = Array.isArray(scopeConfig?.headerControls) ? scopeConfig.headerControls : [];
    if (!controls.length) return Array.isArray(dataset) ? dataset : [];

    const startControl = controls.find((control) => control?.type === 'date' && control?.operator === 'gte');
    const endControl = controls.find((control) => control?.type === 'date' && control?.operator === 'lte');
    const timeStartControl = controls.find((control) => control?.type === 'time' && /start/i.test(String(control.id || '')));
    const timeEndControl = controls.find((control) => control?.type === 'time' && /end/i.test(String(control.id || '')));

    const startMin = startControl ? String(headerState?.[startControl.id] || '') : '';
    const endMax = endControl ? String(headerState?.[endControl.id] || '') : '';
    const timeStart = timeStartControl ? String(headerState?.[timeStartControl.id] || '') : '';
    const timeEnd = timeEndControl ? String(headerState?.[timeEndControl.id] || '') : '';

    return (Array.isArray(dataset) ? dataset : []).filter((row) => {
        if (startMin || endMax) {
            const rowDate = String(resolveFieldValue(row, startControl?.field || 'start')).split(' ')[0];
            if (startMin && rowDate && rowDate < startMin) return false;
            if (endMax && rowDate && rowDate > endMax) return false;
        }

        if (timeStart || timeEnd) {
            const timesOutbound = normalizeTimeList(resolveFieldValue(row, ['timesOut', 'outbound', 'times']));
            const timesInbound = normalizeTimeList(resolveFieldValue(row, ['timesBack', 'inbound', 'returns']));
            const hasWindowMatch = timesOutbound.concat(timesInbound).some((time) => isTimeInWindow(time, timeStart, timeEnd));
            if (!hasWindowMatch) return false;
        }

        return true;
    });
}

function renderDashboardPanelHeaderControlsDrawer(drawerBody, scopeConfig, headerState, onUpdate) {
    if (!drawerBody) return false;
    const controls = Array.isArray(scopeConfig?.headerControls) ? scopeConfig.headerControls : [];
    if (!controls.length) return false;

    const section = document.createElement('div');
    section.className = 'dashboard-panel-filters';
    section.innerHTML = '<div class="dashboard-panel-filters-title">Controls</div>';

    controls.forEach((control) => {
        if (!control?.id) return;

        if (control.type === 'toggle') {
            const row = document.createElement('div');
            row.className = 'dashboard-panel-control-row';
            const button = document.createElement('button');
            button.type = 'button';
            const isOn = headerState[control.id] !== false;
            button.className = `compact-btn ${isOn ? 'active' : ''}`;
            button.textContent = `${control.label}: ${isOn ? 'ON' : 'OFF'}`;
            button.addEventListener('click', () => {
                const next = { ...headerState, [control.id]: !isOn };
                if (typeof onUpdate === 'function') onUpdate(next);
            });
            row.appendChild(button);
            section.appendChild(row);
            return;
        }

        if (control.type === 'date' || control.type === 'time') {
            const row = document.createElement('label');
            row.className = 'dashboard-panel-filter-row';
            const label = document.createElement('span');
            label.className = 'dashboard-panel-filter-label';
            label.textContent = String(control.label || control.id);

            const input = document.createElement('input');
            input.type = control.type;
            input.className = 'table-pagination-select dashboard-panel-filter-select';
            input.value = String(headerState[control.id] || '');
            input.addEventListener('change', () => {
                const next = { ...headerState, [control.id]: String(input.value || '') };
                if (typeof onUpdate === 'function') onUpdate(next);
            });

            row.appendChild(label);
            row.appendChild(input);
            section.appendChild(row);
            return;
        }

        if (control.type === 'clearBtn') {
            const row = document.createElement('div');
            row.className = 'dashboard-panel-control-row';
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'compact-btn';
            button.textContent = control.label || 'Clear';
            button.addEventListener('click', () => {
                const next = { ...headerState };
                controls.forEach((candidate) => {
                    if (candidate?.id && (candidate.type === 'date' || candidate.type === 'time')) {
                        next[candidate.id] = '';
                    }
                });
                if (typeof onUpdate === 'function') onUpdate(next);
            });
            row.appendChild(button);
            section.appendChild(row);
        }
    });

    drawerBody.appendChild(section);
    return true;
}

async function renderDashboardCardsSimple(dataset, target, scopeConfig) {
    if (!target) return false;
    if (!window.ViewModules?.renderTableView) return false;

    target.innerHTML = '';
    const tableHost = document.createElement('div');
    tableHost.id = `${target.id}-cards-fallback-table`;
    target.appendChild(tableHost);
    window.ViewModules.renderTableView(dataset, {
        activeScopeConfig: scopeConfig,
        fieldVisibility,
        escapeHtml,
        resolveFieldValue,
        pagination: {
            enabled: false,
            items: null,
            pageSize: 'all',
            currentPage: 1,
            totalPages: 1,
            totalItems: dataset.length
        },
        containerId: tableHost.id
    });
    return true;
}

async function renderDashboardCardsFull(dataset, target, scopeConfig) {
    if (!target) return false;
    return renderDashboardFixedView(dataset, target, scopeConfig, 'cards', renderCardsView);
}

async function renderDashboardCalendarFull(dataset, target, scopeConfig) {
    if (!target) return false;
    if (!window.FullCalendar?.Calendar) {
        target.innerHTML = '<div class="view-empty-state">FullCalendar is not available for calendar panel.</div>';
        return true;
    }

    const eventsPayload = (Array.isArray(dataset) ? dataset : [])
        .map((item, index) => {
            const startRaw = resolveFieldValue(item, ['start']);
            if (!startRaw) return null;
            return {
                id: String(index + 1),
                title: resolveFieldValue(item, ['title', 'name']) || 'Event',
                start: String(startRaw).replace(' ', 'T'),
                end: resolveFieldValue(item, ['end']) ? String(resolveFieldValue(item, ['end'])).replace(' ', 'T') : null,
                extendedProps: {
                    subtitle: resolveFieldValue(item, ['subtitle']),
                    location: resolveFieldValue(item, ['location']),
                    room: resolveFieldValue(item, ['room']),
                    poster: getImageFallback(resolveFieldValue(item, ['posterpath', 'poster']) || 'event_placeholder.png', 'event_placeholder.png')
                }
            };
        })
        .filter(Boolean);

    if (!eventsPayload.length) {
        target.innerHTML = '<div class="view-empty-state">No calendar events available for this panel.</div>';
        return true;
    }

    target.innerHTML = '';
    const toolbar = document.createElement('div');
    toolbar.className = 'timeline-toolbar';
    toolbar.innerHTML = `
        <button type="button" class="compact-btn ${viewEnhancementState.calendarViewMode === 'dayGridMonth' ? 'active' : ''}" data-calendar-mode="dayGridMonth">Month Grid</button>
        <button type="button" class="compact-btn ${viewEnhancementState.calendarViewMode === 'timeGridWeek' ? 'active' : ''}" data-calendar-mode="timeGridWeek">Week</button>
        <button type="button" class="compact-btn ${viewEnhancementState.calendarViewMode === 'listMonth' ? 'active' : ''}" data-calendar-mode="listMonth">Agenda View</button>
    `;
    const host = document.createElement('div');
    host.className = 'dashboard-calendar-host';
    host.style.minHeight = '420px';
    host.style.height = 'min(68vh, 640px)';
    target.appendChild(toolbar);
    target.appendChild(host);

    if (target.__dashboardCalendarInstance) {
        try { target.__dashboardCalendarInstance.destroy(); } catch (error) {}
        target.__dashboardCalendarInstance = null;
    }

    const instance = new window.FullCalendar.Calendar(host, {
        initialView: viewEnhancementState.calendarViewMode || 'dayGridMonth',
        headerToolbar: { left: 'prev,next today', center: 'title', right: '' },
        events: eventsPayload,
        height: '100%',
        eventClick: (info) => {
            const p = info.event.extendedProps;
            triggerLightboxPopup(p.poster, info.event.title, `${p.subtitle || ''}\n${p.location || ''}${p.room ? ` (${p.room})` : ''}`);
        }
    });
    instance.render();
    target.__dashboardCalendarInstance = instance;

    toolbar.querySelectorAll('[data-calendar-mode]').forEach((button) => {
        button.addEventListener('click', () => {
            const nextMode = button.dataset.calendarMode || 'dayGridMonth';
            viewEnhancementState.calendarViewMode = nextMode;
            saveViewEnhancementStateToStorage();
            toolbar.querySelectorAll('[data-calendar-mode]').forEach((node) => node.classList.toggle('active', node === button));
            instance.changeView(nextMode);
        });
    });

    return true;
}

async function renderDashboardMapFull(dataset, target, scopeConfig) {
    if (!target) return false;
    if (!window.L) {
        target.innerHTML = '<div class="view-empty-state">Leaflet is not available for map view.</div>';
        return true;
    }

    target.innerHTML = '';
    const toolbar = document.createElement('div');
    toolbar.className = 'map-toolbar';
    toolbar.innerHTML = `
        <button type="button" class="compact-btn" data-map-action="fit">Fit Markers</button>
        <button type="button" class="compact-btn" data-map-action="reset">Reset Area</button>
        <button type="button" class="compact-btn ${viewEnhancementState.mapAutoFit ? 'active' : ''}" data-map-action="autofit">Auto Fit</button>
    `;
    const host = document.createElement('div');
    host.className = 'dashboard-map-host';
    host.style.width = '100%';
    host.style.minHeight = '320px';
    host.style.height = 'min(52vh, 460px)';
    target.appendChild(toolbar);
    target.appendChild(host);

    const panelMap = target.__dashboardLeafletMap;
    const map = panelMap && panelMap._container === host
        ? panelMap
        : window.L.map(host, { preferCanvas: true, zoomControl: true }).setView([36.4349, 28.2175], 11);

    if (!target.__dashboardLeafletMap || target.__dashboardLeafletMap !== map) {
        window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        }).addTo(map);
        target.__dashboardLeafletMap = map;
    }

    if (!target.__dashboardMapLayerGroup) {
        target.__dashboardMapLayerGroup = window.L.layerGroup().addTo(map);
    }
    const group = target.__dashboardMapLayerGroup;
    group.clearLayers();

    const rows = Array.isArray(dataset) ? dataset : [];
    const points = rows
        .map((row) => {
            const lat = Number(getCoordinateValue(row, ['Latitude', 'latitude', 'lat'], null));
            const lng = Number(getCoordinateValue(row, ['Longitude', 'longitude', 'lng', 'lon'], null));
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
            const title = resolveFieldValue(row, ['title', 'name']) || 'Location';
            return { lat, lng, title: String(title) };
        })
        .filter(Boolean);

    if (!points.length) {
        target.innerHTML = '<div class="view-empty-state">No coordinates available for this panel.</div>';
        return true;
    }

    const bounds = window.L.latLngBounds([]);
    points.forEach((point) => {
        const marker = window.L.circleMarker([point.lat, point.lng], {
            radius: 7,
            fillColor: '#ff5e5b',
            color: '#ffffff',
            weight: 2,
            opacity: 1,
            fillOpacity: 0.9
        }).bindPopup(`<strong>${escapeHtml(point.title)}</strong>`);
        marker.addTo(group);
        bounds.extend([point.lat, point.lng]);
    });

    toolbar.querySelector('[data-map-action="fit"]')?.addEventListener('click', () => {
        if (bounds.isValid()) {
            map.fitBounds(bounds, { padding: [20, 20], maxZoom: 13 });
        }
    });
    toolbar.querySelector('[data-map-action="reset"]')?.addEventListener('click', () => {
        map.setView([36.4349, 28.2175], 11, { animate: true });
    });
    toolbar.querySelector('[data-map-action="autofit"]')?.addEventListener('click', (event) => {
        viewEnhancementState.mapAutoFit = !viewEnhancementState.mapAutoFit;
        saveViewEnhancementStateToStorage();
        event.currentTarget.classList.toggle('active', viewEnhancementState.mapAutoFit);
        if (viewEnhancementState.mapAutoFit && bounds.isValid()) {
            map.fitBounds(bounds, { padding: [20, 20], maxZoom: 13 });
        }
    });

    map.invalidateSize();
    if (viewEnhancementState.mapAutoFit && bounds.isValid()) {
        map.fitBounds(bounds, { padding: [20, 20], maxZoom: 13 });
    }
    return true;
}

async function renderDashboardTableBase(dataset, target, scopeConfig) {
    if (!window.ViewModules?.renderTableView) return false;
    window.ViewModules.renderTableView(dataset, {
        activeScopeConfig: scopeConfig,
        fieldVisibility,
        escapeHtml,
        resolveFieldValue,
        pagination: {
            enabled: false,
            items: null,
            pageSize: 'all',
            currentPage: 1,
            totalPages: 1,
            totalItems: dataset.length
        },
        containerId: target.id
    });
    return true;
}

async function renderDashboardTableSimple(dataset, target, scopeConfig) {
    const rendered = await renderDashboardTableBase(dataset, target, scopeConfig);
    return rendered;
}

function enhanceDashboardPanelTableView(container, dataset, scopeKey) {
    if (!container || !dataset.length) return;

    container.classList.toggle('table-density-compact', viewEnhancementState.tableDense);
    container.classList.add('table-fit-page');
    container.classList.remove('table-fit-content');
}

async function renderDashboardTableFull(dataset, target, scopeConfig) {
    const rendered = await renderDashboardTableBase(dataset, target, scopeConfig);
    if (!rendered) return false;
    enhanceDashboardPanelTableView(target, dataset, scopeConfig?.id || activeScope);
    return true;
}

const DASHBOARD_VIEW_RENDERERS = {
    table: {
        render: async (dataset, target, scopeConfig) => {
            return renderDashboardTableSimple(dataset, target, scopeConfig);
        }
    },
    'chartjs-lab': {
        render: async (dataset, target, scopeConfig) => {
            if (!window.ViewModules?.renderChartJsLabView) return false;
            window.ViewModules.renderChartJsLabView(dataset, {
                activeScopeConfig: scopeConfig,
                resolveFieldValue,
                containerId: target.id
            });
            return true;
        }
    },
    'gridjs-table': {
        render: async (dataset, target, scopeConfig) => {
            if (!window.ViewModules?.renderGridJsTableView) return false;
            window.ViewModules.renderGridJsTableView(dataset, {
                activeScopeConfig: scopeConfig,
                resolveFieldValue,
                escapeHtml,
                containerId: target.id
            });
            return true;
        }
    },
    calendar: {
        render: async (dataset, target, scopeConfig) => {
            if (!target) return false;
            if (!window.FullCalendar?.Calendar) {
                target.innerHTML = '<div class="view-empty-state">FullCalendar is not available for calendar panel.</div>';
                return true;
            }

            target.innerHTML = '';
            const host = document.createElement('div');
            host.className = 'dashboard-calendar-host';
            host.style.minHeight = '420px';
            host.style.height = 'min(68vh, 640px)';
            target.appendChild(host);

            const eventsPayload = (Array.isArray(dataset) ? dataset : [])
                .map((item, index) => {
                    const startRaw = resolveFieldValue(item, ['start']);
                    if (!startRaw) return null;
                    return {
                        id: String(index + 1),
                        title: resolveFieldValue(item, ['title', 'name']) || 'Event',
                        start: String(startRaw).replace(' ', 'T'),
                        end: resolveFieldValue(item, ['end']) ? String(resolveFieldValue(item, ['end'])).replace(' ', 'T') : null
                    };
                })
                .filter(Boolean);

            if (!eventsPayload.length) {
                target.innerHTML = '<div class="view-empty-state">No calendar events available for this panel.</div>';
                return true;
            }

            if (target.__dashboardCalendarInstance) {
                try { target.__dashboardCalendarInstance.destroy(); } catch (error) {}
                target.__dashboardCalendarInstance = null;
            }

            const instance = new window.FullCalendar.Calendar(host, {
                initialView: 'dayGridMonth',
                headerToolbar: { left: 'prev,next', center: 'title', right: '' },
                events: eventsPayload,
                height: 'auto'
            });

            instance.render();
            target.__dashboardCalendarInstance = instance;
            return true;
        }
    },
    cards: {
        render: async (dataset, target, scopeConfig) => {
            const rendered = await renderDashboardCardsFull(dataset, target, scopeConfig);
            if (rendered) return true;
            return renderDashboardCardsSimple(dataset, target, scopeConfig);
        }
    },
    rails: { render: async (dataset, target, scopeConfig) => renderDashboardFixedView(dataset, target, scopeConfig, 'rails', renderRailsView) },
    posters: { render: async (dataset, target, scopeConfig) => renderDashboardFixedView(dataset, target, scopeConfig, 'posters', renderPostersView) },
    flipbook: { render: async (dataset, target, scopeConfig) => renderDashboardFixedView(dataset, target, scopeConfig, 'flipbook', renderFlipbookView) },
    deck: { render: async (dataset, target, scopeConfig) => renderDashboardFixedView(dataset, target, scopeConfig, 'deck', renderDeckView) },
    timeline: { render: async (dataset, target, scopeConfig) => renderDashboardFixedView(dataset, target, scopeConfig, 'timeline', renderTimelineView) },
    gantt: { render: async (dataset, target, scopeConfig) => renderDashboardFixedView(dataset, target, scopeConfig, 'gantt', renderGanttView) },
    kanban: { render: async (dataset, target, scopeConfig) => renderDashboardFixedView(dataset, target, scopeConfig, 'kanban', renderKanbanView) },
    charts: { render: async (dataset, target, scopeConfig) => renderDashboardFixedView(dataset, target, scopeConfig, 'charts', renderChartsView) },
    'advanced-table': { render: async (dataset, target, scopeConfig) => renderDashboardFixedView(dataset, target, scopeConfig, 'advanced-table', renderAdvancedTableView) },
    map: {
        render: async (dataset, target, scopeConfig) => {
            if (!target) return false;
            if (!window.L) {
                target.innerHTML = '<div class="view-empty-state">Leaflet is not available for map view.</div>';
                return true;
            }

            target.innerHTML = '';
            const mapHost = document.createElement('div');
            mapHost.className = 'dashboard-map-host';
            mapHost.style.width = '100%';
            mapHost.style.minHeight = '280px';
            mapHost.style.height = 'min(48vh, 420px)';
            target.appendChild(mapHost);

            // Keep one Leaflet instance per dashboard panel host.
            const panelMap = target.__dashboardLeafletMap;
            const map = panelMap && panelMap._container === mapHost
                ? panelMap
                : window.L.map(mapHost, { preferCanvas: true, zoomControl: true }).setView([36.4349, 28.2175], 11);

            if (!target.__dashboardLeafletMap || target.__dashboardLeafletMap !== map) {
                window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                    maxZoom: 19,
                    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                }).addTo(map);
                target.__dashboardLeafletMap = map;
            }

            const rows = Array.isArray(dataset) ? dataset : [];
            const points = rows
                .map((row) => {
                    const lat = Number(getCoordinateValue(row, ['Latitude', 'latitude', 'lat'], null));
                    const lng = Number(getCoordinateValue(row, ['Longitude', 'longitude', 'lng', 'lon'], null));
                    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
                    const title = resolveFieldValue(row, ['title', 'name']) || 'Location';
                    return { lat, lng, title: String(title) };
                })
                .filter(Boolean);

            if (!target.__dashboardMapLayerGroup) {
                target.__dashboardMapLayerGroup = window.L.layerGroup().addTo(map);
            }

            const group = target.__dashboardMapLayerGroup;
            group.clearLayers();

            if (!points.length) {
                target.innerHTML = '<div class="view-empty-state">No coordinates available for this panel.</div>';
                return true;
            }

            const bounds = window.L.latLngBounds([]);
            points.forEach((point) => {
                const marker = window.L.circleMarker([point.lat, point.lng], {
                    radius: 7,
                    fillColor: '#ff5e5b',
                    color: '#ffffff',
                    weight: 2,
                    opacity: 1,
                    fillOpacity: 0.9
                }).bindPopup(`<strong>${escapeHtml(point.title)}</strong>`);
                marker.addTo(group);
                bounds.extend([point.lat, point.lng]);
            });

            map.invalidateSize();
            if (bounds.isValid()) {
                map.fitBounds(bounds, { padding: [20, 20], maxZoom: 13 });
            }
            return true;
        }
    }
};

function getDashboardPanelCapability(scopeKey, viewKey) {
    const scopeConfig = SCOPE_DEFINITIONS?.[scopeKey] || null;
    const isKnownLayout = Array.isArray(scopeConfig?.layouts) && scopeConfig.layouts.includes(viewKey);
    if (!isKnownLayout) {
        return { level: 'unavailable', label: 'Unavailable' };
    }
    return { level: 'available', label: 'Available' };
}

async function openDashboardPanelFullView(scopeKey, viewKey) {
    if (!scopeKey || !SCOPE_DEFINITIONS?.[scopeKey]) return;
    await setScope(scopeKey);

    if (viewKey && Array.isArray(activeScopeConfig?.layouts) && activeScopeConfig.layouts.includes(viewKey)) {
        setLayout(viewKey);
        return;
    }

    if (Array.isArray(activeScopeConfig?.layouts) && activeScopeConfig.layouts.includes('cards')) {
        setLayout('cards');
    }
}

async function renderDashboardFixedView(dataset, target, scopeConfig, layoutMode, renderer) {
    if (typeof renderer !== 'function') return false;
    const beforeHtml = target?.innerHTML || '';
    await runWithTemporaryScopeContext(scopeConfig.id, layoutMode, async () => {
        await renderer(dataset, { containerId: target.id });
    });
    const afterHtml = target?.innerHTML || '';
    if (afterHtml !== beforeHtml) return true;
    if ((target?.textContent || '').includes('Loading panel')) return false;
    return !!target?.querySelector?.('*');
}

function createDashboardPanelHost(panelConfig, index) {
    const shell = document.createElement('section');
    shell.className = 'dashboard-panel';

    const span = Math.max(1, Math.min(12, Number(panelConfig?.span) || 6));
    shell.style.setProperty('--panel-span', String(span));

    const heading = document.createElement('div');
    heading.className = 'dashboard-panel-heading';
    heading.textContent = panelConfig?.title || `Panel ${index + 1}`;

    const headerActions = document.createElement('div');
    headerActions.className = 'dashboard-panel-header-actions';

    const toolsButton = document.createElement('button');
    toolsButton.type = 'button';
    toolsButton.className = 'compact-btn dashboard-panel-tools-toggle';
    toolsButton.textContent = 'Tools';
    toolsButton.hidden = true;
    toolsButton.setAttribute('aria-expanded', 'false');
    headerActions.appendChild(toolsButton);

    const headerRow = document.createElement('div');
    headerRow.className = 'dashboard-panel-header-row';
    headerRow.appendChild(heading);
    headerRow.appendChild(headerActions);

    const drawer = document.createElement('div');
    drawer.className = 'dashboard-panel-drawer';
    drawer.hidden = true;

    const drawerBody = document.createElement('div');
    drawerBody.className = 'dashboard-panel-drawer-body';
    drawer.appendChild(drawerBody);

    const body = document.createElement('div');
    body.className = 'dashboard-panel-body';
    body.id = `dashboard-panel-${index}`;

    shell.appendChild(headerRow);
    shell.appendChild(drawer);
    shell.appendChild(body);

    if (panelConfig?.toolsOpen) {
        shell.classList.add('dashboard-panel-tools-open');
        drawer.hidden = false;
        toolsButton.setAttribute('aria-expanded', 'true');
    }

    toolsButton.addEventListener('click', () => {
        const open = shell.classList.toggle('dashboard-panel-tools-open');
        drawer.hidden = !open;
        toolsButton.setAttribute('aria-expanded', String(open));
    });

    return { shell, body, drawer, drawerBody, toolsButton };
}

async function renderDashboardPanel(panelConfig, target, activeScopeFilteredDataset, sequenceToken, panelUi = null, updatePanelConfig = null) {
    if (!target) return;
    const scopeKey = panelConfig?.scope || activeScope;
    const viewKey = panelConfig?.view || 'table';
    const scopeConfig = SCOPE_DEFINITIONS[scopeKey];
    let loadingTimer = null;
    let settled = false;

    const clearLoadingTimer = () => {
        if (loadingTimer) {
            window.clearTimeout(loadingTimer);
            loadingTimer = null;
        }
        settled = true;
    };

    try {
        if (!scopeConfig) {
            target.innerHTML = '<div class="view-empty-state">Panel scope is not configured.</div>';
            return;
        }

        target.innerHTML = '<div class="view-empty-state">Loading panel...</div>';
        loadingTimer = window.setTimeout(() => {
            if (settled || !target.isConnected) return;
            target.innerHTML = '<div class="view-empty-state">Panel is taking longer than expected. Try reloading the view.</div>';
        }, 1800);

        const panelDatasetRaw = scopeKey === activeScope
            ? activeScopeFilteredDataset
            : await fetchScopeData(scopeKey);

        const panelHeaderState = normalizeDashboardPanelHeaderState(scopeConfig, panelConfig?.panelHeaderState);
        const panelFieldVisibility = buildPanelFieldVisibility(scopeConfig, panelHeaderState);
        const panelDatasetWithGlobalFilter = applyDashboardPanelFilter(panelDatasetRaw, panelConfig);
        const panelDatasetWithHeaderControls = applyDashboardPanelHeaderControls(panelDatasetWithGlobalFilter, scopeConfig, panelHeaderState);
        const panelFilterState = normalizeDashboardPanelFilters(panelConfig?.panelFilters);
        const panelDataset = applyDashboardPanelFilters(panelDatasetWithHeaderControls, scopeConfig, panelFilterState);

        const renderer = DASHBOARD_VIEW_RENDERERS[viewKey];
        if (!renderer?.render) {
            target.innerHTML = `<div class="view-empty-state">${escapeHtml(viewKey)} is not wired for dashboard mode yet.</div>`;
            clearLoadingTimer();
            return;
        }

        let rendered = false;
        const previousFieldVisibility = fieldVisibility;
        fieldVisibility = panelFieldVisibility;
        try {
            if (viewKey === 'cards') {
                rendered = await renderDashboardCardsSimple(panelDataset, target, scopeConfig);
            } else if (viewKey === 'table') {
                rendered = await renderDashboardTableSimple(panelDataset, target, scopeConfig);
            } else if (viewKey === 'calendar') {
                rendered = await renderer.render(panelDataset, target, scopeConfig);
            } else if (viewKey === 'map') {
                rendered = await renderer.render(panelDataset, target, scopeConfig);
            } else {
                rendered = await renderer.render(panelDataset, target, scopeConfig);
            }
        } finally {
            fieldVisibility = previousFieldVisibility;
        }

        clearLoadingTimer();
        if (!rendered) {
            target.innerHTML = `<div class="view-empty-state">${escapeHtml(viewKey)} is not available in dashboard mode.</div>`;
        }

        if (panelUi?.drawerBody) {
            panelUi.drawerBody.innerHTML = '';
        }

        let hasTools = false;
        hasTools = applyDashboardSimpleModePostProcess(target, panelUi?.drawerBody, viewKey);

        const hasPanelFilters = renderDashboardPanelFiltersDrawer(
            panelUi?.drawerBody,
            panelDatasetWithHeaderControls,
            scopeConfig,
            panelFilterState,
            (nextFilters) => {
                if (typeof updatePanelConfig !== 'function') return;
                updatePanelConfig({ panelFilters: nextFilters });
            }
        );

        const hasPanelHeaderControls = renderDashboardPanelHeaderControlsDrawer(
            panelUi?.drawerBody,
            scopeConfig,
            panelHeaderState,
            (nextHeaderState) => {
                if (typeof updatePanelConfig !== 'function') return;
                updatePanelConfig({ panelHeaderState: nextHeaderState });
            }
        );

        hasTools = hasTools || hasPanelFilters || hasPanelHeaderControls;

        if (panelUi?.toolsButton) {
            panelUi.toolsButton.hidden = !hasTools;
            panelUi.toolsButton.setAttribute('aria-expanded', panelConfig?.toolsOpen && hasTools ? 'true' : 'false');
        }
        if (panelUi?.drawer) {
            panelUi.drawer.hidden = !(panelConfig?.toolsOpen && hasTools);
        }
        if (panelUi?.shell) {
            panelUi.shell.classList.toggle('dashboard-panel-tools-open', !!(panelConfig?.toolsOpen && hasTools));
        }
    } catch (error) {
        clearLoadingTimer();
        target.innerHTML = `<div class="view-empty-state">Panel failed to load: ${escapeHtml(error?.message || 'Unknown error')}</div>`;
    }
}

function renderDashboardView(dataset) {
    if (window.ViewModules?.renderDashboardView) {
        const token = ++dashboardRenderSequence;
        const dashboardScopeKey = activeScope;
        window.ViewModules.renderDashboardView(dataset, {
            activeScopeConfig,
            activeScope: dashboardScopeKey,
            getPanels: () => getDashboardPanelsForScope(dashboardScopeKey),
            setPanels: (nextPanelsOrUpdater) => {
                const currentPanels = getDashboardPanelsForScope(dashboardScopeKey);
                const nextPanels = typeof nextPanelsOrUpdater === 'function'
                    ? nextPanelsOrUpdater(currentPanels)
                    : nextPanelsOrUpdater;
                if (!Array.isArray(nextPanels)) {
                    return;
                }
                setDashboardPanelsForScope(dashboardScopeKey, nextPanels);
                filterAndRenderEngine();
            },
            listScopes: () => Object.keys(SCOPE_DEFINITIONS || {}),
            listViewsForScope: (scopeKey) => {
                const cfg = SCOPE_DEFINITIONS?.[scopeKey] || null;
                return Array.isArray(cfg?.layouts) ? cfg.layouts.filter((item) => item !== 'dashboard') : [];
            },
            getPanelCapability: (scopeKey, viewKey, panelMode) => getDashboardPanelCapability(scopeKey, viewKey, panelMode),
            openFullView: (scopeKey, viewKey) => openDashboardPanelFullView(scopeKey, viewKey),
            prefetchScopes: async (scopeKeys) => {
                await Promise.all((Array.isArray(scopeKeys) ? scopeKeys : []).map((scopeKey) => fetchScopeData(scopeKey).catch(() => [])));
            },
            createPanelHost: createDashboardPanelHost,
            renderPanel: (panelConfig, target, scopedDataset, panelUi, updatePanelConfig) => {
                return renderDashboardPanel(panelConfig, target, scopedDataset, token, panelUi, updatePanelConfig);
            }
        });
        return;
    }

    const container = document.getElementById('view-dashboard');
    if (!container) return;
    container.className = 'view-container';
    container.innerHTML = '<div class="view-empty-state">Dashboard renderer module is not available.</div>';
}

function initializeViewRegistry() {
    if (!window.ViewRegistry?.register) return;
    window.ViewRegistry.register('cards', renderCardsView);
    window.ViewRegistry.register('rails', renderRailsView);
    window.ViewRegistry.register('table', renderTableView);
    window.ViewRegistry.register('calendar', mountCalendarGrid);
    window.ViewRegistry.register('posters', renderPostersView);
    window.ViewRegistry.register('flipbook', renderFlipbookView);
    window.ViewRegistry.register('deck', renderDeckView);
    window.ViewRegistry.register('timeline', renderTimelineView);
    window.ViewRegistry.register('gantt', renderGanttView);
    window.ViewRegistry.register('kanban', renderKanbanView);
    window.ViewRegistry.register('charts', renderChartsView);
    window.ViewRegistry.register('chartjs-lab', renderChartJsLabView);
    window.ViewRegistry.register('gridjs-table', renderGridJsTableView);
    window.ViewRegistry.register('advanced-table', renderAdvancedTableView);
    window.ViewRegistry.register('dashboard', renderDashboardView);
    window.ViewRegistry.register('map', mountMapCoordinates);
}

async function filterAndRenderEngine() {
    if (activeDataLoadError) {
        renderScopeLoadError(activeDataLoadError);
        return;
    }

    if (currentLayoutMode === 'signs') {
        document.body.classList.add('signs-page-open');
        ['cards', 'rails', 'table', 'calendar', 'posters', 'flipbook', 'deck', 'timeline', 'gantt', 'kanban', 'charts', 'chartjs-lab', 'gridjs-table', 'advanced-table', 'dashboard', 'map'].forEach((viewKey) => {
            const el = document.getElementById(`view-${viewKey}`);
            if (el) el.style.display = 'none';
        });
        const pills = document.getElementById('inline-filter-pills');
        if (pills) {
            pills.innerHTML = '';
            pills.style.display = 'none';
        }
        const page = document.getElementById('view-signs');
        if (page) {
            page.hidden = false;
            page.style.display = '';
            renderBusSignsPage();
        }
        return;
    }

    syncSearchClearButton();
    syncDestinationPickerUI();
    const filtered = getFilteredRecords();
    renderInlineFilterPills();

    ['cards', 'rails', 'table', 'calendar', 'posters', 'flipbook', 'deck', 'timeline', 'gantt', 'kanban', 'charts', 'chartjs-lab', 'gridjs-table', 'advanced-table', 'dashboard', 'map'].forEach((viewKey) => {
        const el = document.getElementById(`view-${viewKey}`);
        if (!el) return;
        el.style.display = currentLayoutMode === viewKey ? '' : 'none';
    });
    const signsPage = document.getElementById('view-signs');
    if (signsPage) {
        signsPage.style.display = 'none';
        signsPage.hidden = true;
    }

    initializeViewRegistry();

    if (window.ViewRegistry?.render) {
        const rendered = await window.ViewRegistry.render(currentLayoutMode, filtered);
        if (rendered) {
            return;
        }
    }

    renderCardsView(filtered);
}

function parseScheduleTimeMinutes(timeStr) {
    const parts = String(timeStr || '').split(':').map(Number);
    if (parts.length < 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) return null;
    return parts[0] * 60 + parts[1];
}

function isTimePassed(timeStr) {
    const minutes = parseScheduleTimeMinutes(timeStr);
    if (minutes == null) return false;

    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    let scheduleMinutes = minutes;

    // Early-morning departures after the evening are next calendar day (not "passed" at 22:00).
    const EARLY_CUTOFF = 5 * 60;
    const LATE_CUTOFF = 18 * 60;
    if (scheduleMinutes <= EARLY_CUTOFF && nowMinutes >= LATE_CUTOFF) {
        scheduleMinutes += 24 * 60;
    }

    return nowMinutes > scheduleMinutes;
}

function isTimeInWindow(timeStr, startVal, endVal) {
    if (!timeStr) return false;
    if (!startVal && !endVal) return true;
    if (startVal && timeStr < startVal) return false;
    if (endVal && timeStr > endVal) return false;
    return true;
}

function parseEventDateTime(row) {
    const rawStart = resolveFieldValue(row, ['start']);
    if (!rawStart) return null;
    const parsed = new Date(String(rawStart).replace(' ', 'T'));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function sortEventsByDate(dataset) {
    return dataset.slice().sort((a, b) => {
        const aDate = parseEventDateTime(a);
        const bDate = parseEventDateTime(b);
        if (!aDate && !bDate) return 0;
        if (!aDate) return 1;
        if (!bDate) return -1;
        return aDate - bDate;
    });
}

function isSameDate(a, b) {
    return a.getFullYear() === b.getFullYear()
        && a.getMonth() === b.getMonth()
        && a.getDate() === b.getDate();
}

function createEventsRailSection(title, items, cardClassName) {
    return createRailSection(title, items, cardClassName);
}

function doesRailRowMatchFilter(row, filterCfg) {
    if (!filterCfg) return true;

    const fieldSpec = filterCfg.field || filterCfg.key || filterCfg.fields;
    const rowRaw = resolveFieldValue(row, fieldSpec);
    const rowList = normalizeListValue(rowRaw).map((value) => normalizeText(value));
    const rowSingle = normalizeText(rowRaw);

    const rawValue = typeof filterCfg.value === 'function' ? filterCfg.value(row) : filterCfg.value;
    const valueList = Array.isArray(rawValue)
        ? rawValue.map((value) => normalizeText(value))
        : [normalizeText(rawValue)];

    const op = String(filterCfg.op || filterCfg.operator || 'equals').toLowerCase();
    if (op === 'contains' || op === 'includes') {
        return valueList.some((value) => rowList.some((rowValue) => rowValue.includes(value)) || rowSingle.includes(value));
    }
    if (op === 'in' || op === 'oneof') {
        return rowList.some((rowValue) => valueList.includes(rowValue)) || valueList.includes(rowSingle);
    }
    if (op === 'not-equals' || op === 'ne') {
        return !valueList.includes(rowSingle);
    }

    return valueList.includes(rowSingle) || rowList.some((rowValue) => valueList.includes(rowValue));
}

function buildRailCardConfig(baseCfg, sectionCfg) {
    const cfg = {
        ...(baseCfg || {}),
        images: Array.isArray(baseCfg?.images) ? baseCfg.images : []
    };

    if (sectionCfg?.titleField) {
        cfg.title = {
            render: (row) => resolveFieldValue(row, sectionCfg.titleField),
            color: sectionCfg?.titleColor || baseCfg?.title?.color || null
        };
    }

    if (sectionCfg?.subtitleField) {
        cfg.subtitle = {
            render: (row) => resolveFieldValue(row, sectionCfg.subtitleField)
        };
    }

    if (sectionCfg?.showSubtitle === false) {
        cfg.subtitle = null;
    }

    if (Array.isArray(sectionCfg?.fields)) {
        cfg.rows = sectionCfg.fields.map((fieldDef) => {
            if (typeof fieldDef === 'string') {
                return {
                    label: fieldDef,
                    render: (row) => escapeHtml(resolveFieldValue(row, fieldDef) || '-')
                };
            }

            const fieldName = fieldDef.field || fieldDef.key || fieldDef.id || '';
            return {
                label: fieldDef.label || fieldName,
                shouldRender: fieldDef.showEmpty === true ? undefined : (row) => {
                    const value = resolveFieldValue(row, fieldName);
                    return value !== '' && value !== null && value !== undefined;
                },
                render: (row) => {
                    const value = resolveFieldValue(row, fieldName);
                    return escapeHtml(value === '' || value === null || value === undefined ? '-' : value);
                }
            };
        });
    }

    if (sectionCfg?.clickAction) {
        cfg.clickAction = sectionCfg.clickAction;
    }

    return cfg;
}

async function resolveRailSectionDataset(sectionCfg, fallbackDataset) {
    const sourceScope = sectionCfg?.sourceScope;
    const sourceItems = sourceScope && sourceScope !== activeScope
        ? await fetchScopeData(sourceScope)
        : fallbackDataset;

    if (!sectionCfg?.filter) return sourceItems.slice();
    return sourceItems.filter((row) => doesRailRowMatchFilter(row, sectionCfg.filter));
}

function createRailSection(title, items, cardClassName) {
    if (!items.length) return null;
    const section = document.createElement('section');
    section.className = 'events-rail-section';

    const heading = document.createElement('h3');
    heading.className = 'events-rail-title';
    heading.textContent = title;
    section.appendChild(heading);

    const rail = document.createElement('div');
    rail.className = 'events-rail-scroll';

    const syncRailFadeState = () => {
        const max = Math.max(0, rail.scrollWidth - rail.clientWidth);
        const atEnd = max <= 1 || rail.scrollLeft >= (max - 1);
        rail.classList.toggle('at-end', atEnd);
    };

    const sectionLimit = Number(cardClassName?.limit || 0);
    const visibleItems = sectionLimit > 0 ? items.slice(0, sectionLimit) : items;
    const sectionCfg = typeof cardClassName === 'object' ? cardClassName : null;
    const sectionCardCfg = sectionCfg?.cardConfig || activeScopeConfig?.cardConfig || null;
    const railPref = getScopeLayoutPreference(activeScope).rails;

    visibleItems.forEach((row) => {
        const railItem = document.createElement('article');
        railItem.className = typeof cardClassName === 'string' ? cardClassName : (cardClassName?.className || 'events-rail-item');
        const cfg = sectionCardCfg;
        const card = cfg ? renderCardFromConfig(row, cfg) : renderCardFallback(row);
        card.classList.add('events-rail-profile');
        card.classList.add(`card-interior-${railPref.interior}`);
        card.classList.add(`card-label-${railPref.label}`);
        if (cfg) {
            attachCardAction(card, row, cfg);
        }
        railItem.appendChild(card);
        rail.appendChild(railItem);
    });

    if (items.length > visibleItems.length) {
        const moreItem = document.createElement('article');
        moreItem.className = 'events-rail-item';
        const moreCard = document.createElement('div');
        moreCard.className = 'profile-card card-clickable rail-more-card';
        moreCard.tabIndex = 0;
        moreCard.setAttribute('role', 'button');
        moreCard.innerHTML = `
            <div class="card-left-payload rail-more-payload">
                <div class="p-info">
                    <div class="p-name">More</div>
                    <div class="p-title">${escapeHtml(String(items.length - visibleItems.length))} items</div>
                </div>
            </div>`;

        const moreAction = typeof cardClassName === 'object' && cardClassName?.moreAction
            ? cardClassName.moreAction
            : null;
        if (moreAction) {
            const activateMore = () => {
                void runCardAction(items[0], moreAction, moreCard, sectionCardCfg || {});
            };
            moreCard.addEventListener('click', activateMore);
            moreCard.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    activateMore();
                }
            });
        }

        moreItem.appendChild(moreCard);
        rail.appendChild(moreItem);
    }

    rail.addEventListener('scroll', syncRailFadeState, { passive: true });
    requestAnimationFrame(syncRailFadeState);
    window.addEventListener('resize', syncRailFadeState);

    section.appendChild(rail);
    return section;
}

function isFeaturedEvent(row) {
    const candidates = [
        row?.Featured,
        row?.featured,
        row?.isFeatured,
        row?.is_featured
    ];

    return candidates.some((value) => {
        if (value === true || value === 1) return true;
        if (typeof value === 'string') {
            const normalized = value.trim().toLowerCase();
            return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'y';
        }
        return false;
    });
}

function renderEventsEditorialCards(container, dataset) {
    container.className = 'view-container events-editorial-layout';
    container.innerHTML = '';

    const sorted = sortEventsByDate(dataset);
    if (!sorted.length) {
        container.innerHTML = '<div class="view-empty-state">No entries match the current filters.</div>';
        return;
    }

    const now = new Date();
    const weekAhead = new Date(now);
    weekAhead.setDate(weekAhead.getDate() + 7);
    const featuredItems = sorted.filter((row) => isFeaturedEvent(row));

    const today = [];
    const week = [];
    const upcoming = [];

    sorted.forEach((row) => {
        if (isFeaturedEvent(row)) return;
        const when = parseEventDateTime(row);
        if (!when) {
            upcoming.push(row);
            return;
        }
        if (isSameDate(when, now)) {
            today.push(row);
        } else if (when > now && when <= weekAhead) {
            week.push(row);
        } else if (when > weekAhead) {
            upcoming.push(row);
        }
    });

    const featuredCardClass = featuredItems.length === 1 ? 'events-hero-item' : 'events-rail-item';
    const heroSection = featuredItems.length
        ? createRailSection('Featured', featuredItems, featuredCardClass)
        : null;
    if (heroSection) container.appendChild(heroSection);

    const todaySection = createRailSection('Today', today);
    if (todaySection) container.appendChild(todaySection);

    const weekSection = createRailSection('This Week', week.slice(0, 12));
    if (weekSection) container.appendChild(weekSection);

    const upcomingSection = createRailSection('Upcoming', upcoming.slice(0, 16));
    if (upcomingSection) container.appendChild(upcomingSection);
}

async function renderRailsView(dataset, options = {}) {
    const container = options.containerId ? document.getElementById(options.containerId) : document.getElementById('view-rails');
    if (!container) return;

    if (activeScope === 'events' && activeScopeConfig?.useEditorialRails !== false) {
        renderEventsEditorialCards(container, dataset);
        return;
    }

    container.className = 'view-container events-editorial-layout layout-rails';
    container.innerHTML = '';

    if (!dataset.length) {
        container.innerHTML = '<div class="view-empty-state">No entries match the current filters.</div>';
        return;
    }

    const sections = Array.isArray(activeScopeConfig?.railSections) && activeScopeConfig.railSections.length
        ? activeScopeConfig.railSections
        : [{
            title: activeScopeConfig?.title || 'Rail View',
            limit: activeScopeConfig?.railPreviewLimit || 6,
            className: dataset.length === 1 ? 'events-hero-item' : 'events-rail-item',
            moreAction: activeScopeConfig?.railMoreAction || null
        }];

    const railNav = document.createElement('div');
    railNav.className = 'rails-section-nav';
    let navVisible = false;

    for (const sectionCfg of sections) {
        const sectionItems = await resolveRailSectionDataset(sectionCfg, dataset);
        if (!sectionItems.length) continue;

        const sourceScope = sectionCfg.sourceScope || activeScope;
        const baseCardCfg = SCOPE_DEFINITIONS[sourceScope]?.cardConfig || activeScopeConfig?.cardConfig || {};
        const sectionCardCfg = buildRailCardConfig(baseCardCfg, sectionCfg);

        const section = createRailSection(sectionCfg.title || 'Section', sectionItems, {
            className: sectionCfg.className || (sectionItems.length === 1 ? 'events-hero-item' : 'events-rail-item'),
            limit: sectionCfg.limit ?? activeScopeConfig?.railPreviewLimit ?? 6,
            moreAction: sectionCfg.moreAction || activeScopeConfig?.railMoreAction || null,
            cardConfig: sectionCardCfg
        });

        if (section) {
            const sectionId = `rail-${activeScope}-${sectionCfg.title || 'section'}`
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-');
            section.id = sectionId;
            container.appendChild(section);

            const navButton = document.createElement('button');
            navButton.type = 'button';
            navButton.className = 'compact-btn';
            navButton.textContent = sectionCfg.title || 'Section';
            navButton.addEventListener('click', () => {
                section.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
            railNav.appendChild(navButton);
            navVisible = true;
        }
    }

    if (navVisible) {
        container.prepend(railNav);
    }
}

function renderCardsView(dataset, options = {}) {
    const container = options.containerId ? document.getElementById(options.containerId) : document.getElementById('view-cards');
    if (!container) return;

    disconnectCardsInfiniteObserver();

    if (globalBusMasonryInstance) {
        try { globalBusMasonryInstance.destroy(); } catch (e) {}
        globalBusMasonryInstance = null;
    }
    container.innerHTML = '';

    if (!dataset.length) {
        container.className = 'view-container';
        container.innerHTML = '<div class="view-empty-state">No entries match the current filters.</div>';
        return;
    }

    const sortedDataset = activeScope === 'bus_schedule'
        ? dataset.slice()
        : sortDatasetByMode(dataset, viewEnhancementState.cardsSort);
    const cardsPagination = getCardsPaginationConfig(sortedDataset.length);
    const renderDataset = cardsPagination.enabled
        ? sortedDataset.slice(cardsPagination.startIndex, cardsPagination.endIndex)
        : sortedDataset;
    const cardsControls = renderCardsPaginationControls(cardsPagination);

    const showCardsToolbar = activeScope !== 'bus_schedule';
    const cardsToolbar = document.createElement('div');
    cardsToolbar.className = 'cards-view-toolbar';
    cardsToolbar.innerHTML = `
        <label class="table-pagination-label" for="cards-sort-mode">Sort</label>
        <select id="cards-sort-mode" class="table-pagination-select" aria-label="Cards sorting mode">
            <option value="default" ${viewEnhancementState.cardsSort === 'default' ? 'selected' : ''}>Default</option>
            <option value="title-asc" ${viewEnhancementState.cardsSort === 'title-asc' ? 'selected' : ''}>A-Z</option>
            <option value="title-desc" ${viewEnhancementState.cardsSort === 'title-desc' ? 'selected' : ''}>Z-A</option>
            <option value="date-desc" ${viewEnhancementState.cardsSort === 'date-desc' ? 'selected' : ''}>Newest</option>
            <option value="date-asc" ${viewEnhancementState.cardsSort === 'date-asc' ? 'selected' : ''}>Oldest</option>
        </select>
    `;

    if (activeScope === 'bus_schedule') {
        container.className = 'view-container layout-masonry-buses';
    } else {
        const cardsPref = getScopeLayoutPreference(activeScope).cards;
        let layoutClass = 'view-container layout-grid-flow';
        if (!fieldVisibility['btn-toggle-qr']) layoutClass += ' qr-hidden-layout';
        if (!fieldVisibility['btn-toggle-img']) layoutClass += ' img-hidden-layout';
        layoutClass += ` cards-interior-${cardsPref.interior}`;
        layoutClass += ` cards-label-${cardsPref.label}`;
        if (cardsPref.maxColumns !== 'auto') {
            layoutClass += ` cards-max-${cardsPref.maxColumns}`;
        }
        layoutClass += ` cards-density-${viewEnhancementState.cardsDensity}`;
        container.className = layoutClass;
    }

    if (showCardsToolbar) {
        container.appendChild(cardsToolbar);
        cardsToolbar.querySelector('#cards-sort-mode')?.addEventListener('change', (event) => {
            viewEnhancementState.cardsSort = event.target.value || 'default';
            saveViewEnhancementStateToStorage();
            filterAndRenderEngine();
        });
    }

    if (cardsControls) {
        container.appendChild(cardsControls);
    }

    const tStart = document.getElementById('time-filter-start')?.value || '';
    const tEnd = document.getElementById('time-filter-end')?.value || '';

    renderDataset.forEach((row) => {
        if (activeScope === 'bus_schedule') {
            let finalOutTimes = normalizeTimeList(row.timesOut || row.outbound || row.times || []);
            let finalBackTimes = normalizeTimeList(row.timesBack || row.inbound || row.returns || []);

            finalOutTimes = finalOutTimes.filter((time) => isTimeInWindow(time, tStart, tEnd));
            finalBackTimes = finalBackTimes.filter((time) => isTimeInWindow(time, tStart, tEnd));
            if (fieldVisibility['btn-rem']) {
                finalOutTimes = finalOutTimes.filter((time) => !isTimePassed(time));
                finalBackTimes = finalBackTimes.filter((time) => !isTimePassed(time));
            }
            if (!finalOutTimes.length && !finalBackTimes.length) return;

            const card = document.createElement('div');
            const regionKey = String(row.region || '').trim().toLowerCase().replace(/\s+/g, '-');
            const routeTitle = String(row.to || '').trim();
            const splitFaliraki = routeTitle.toLowerCase() === 'kalithea-faliraki';
            card.className = [
                'profile-card',
                regionKey ? `region-${regionKey}` : '',
                splitFaliraki ? 'region-split-faliraki' : '',
                isBusRouteStarred(row) ? 'is-starred' : ''
            ].filter(Boolean).join(' ');
            const outPills = finalOutTimes.map((time) => `<span class="bus-pill ${fieldVisibility['btn-grey'] && isTimePassed(time) ? 'passed-grey' : ''}">${time}</span>`).join('');
            const backPills = finalBackTimes.map((time) => `<span class="bus-pill inbound ${fieldVisibility['btn-grey'] && isTimePassed(time) ? 'passed-grey' : ''}">${time}</span>`).join('');
            card.innerHTML = `
                ${renderBusFavButtonHtml(row, { floating: true })}
                <div style="width:100%;">
                    <div class="bus-header">
                        <div>
                            <div class="bus-route-title">${escapeHtml(row.to || '')}</div>
                            <div class="bus-badge-row">
                                <span>${escapeHtml(formatBusDayLabel(row.day, row.region))}</span>
                            </div>
                        </div>
                        <div><div class="bus-price-tag">€${escapeHtml(row.price || '0.00')}</div></div>
                    </div>
                    ${finalOutTimes.length ? `
                    <div class="bus-schedule-block">
                        <div class="schedule-direction dir-out">${BUS_OUTBOUND_LABEL}</div>
                        <div class="schedule-pills">${outPills}</div>
                    </div>` : ''}
                    ${finalBackTimes.length ? `
                        <div class="bus-schedule-block inbound">
                            <div class="schedule-direction dir-in">${BUS_RETURN_LABEL}</div>
                            <div class="schedule-pills">${backPills}</div>
                        </div>` : ''}
                    ${row.comments ? `<div class="bus-comments">${escapeHtml(row.comments)}</div>` : ''}
                </div>`;
            card.querySelector('.bus-fav-btn')?.addEventListener('click', (event) => {
                toggleBusRouteStar(event.currentTarget.getAttribute('data-star-key'), event);
            });
            container.appendChild(card);
            return;
        }

        const cfg = activeScopeConfig.cardConfig;
        const card = cfg ? renderCardFromConfig(row, cfg) : renderCardFallback(row);
        container.appendChild(card);
    });

    if (activeScope === 'bus_schedule' && container.children.length > 0) {
        layoutBusMasonry(container);
    }

    renderCardsInfiniteSentinel(container, cardsPagination);

}

function renderCardFallback(row) {
    const card = document.createElement('div');
    card.className = 'profile-card';
    const title = resolveFieldValue(row, ['title', 'name', 'FirstName', 'to']) || 'Item';
    card.innerHTML = `
        <div class="card-left-payload">
            <div class="p-info">
                <div class="p-head">
                    <div class="p-name">${escapeHtml(title)}</div>
                    <div class="p-title">${escapeHtml(resolveFieldValue(row, ['subtitle', 'JobTitle', 'Company']) || '')}</div>
                </div>
                <div class="p-facts">
                    <div class="p-row"><span>Details</span><div class="p-row-value">${escapeHtml(JSON.stringify(row).slice(0, 140))}</div></div>
                </div>
            </div>
        </div>`;
    return card;
}

function renderCardFromConfig(row, cfg = {}) {
    const card = document.createElement('div');
    card.className = 'profile-card';

    const images = cfg.images || [];
    const leftImages = images.filter((img) => img.placement !== 'right');
    const rightImages = images.filter((img) => img.placement === 'right');

    let mediaHtml = '';
    let leftHtml = '<div class="card-left-payload">';

    leftImages.forEach((imgDef) => {
        const visible = imgDef.visibilityToggleId ? !!fieldVisibility[imgDef.visibilityToggleId] : true;
        if (!visible) return;
        const src = imgDef.render(row);
        if (!src) return;
        const imgClass = imgDef.shape === 'rect' ? 'p-event-poster-thumb' : 'p-img';
        mediaHtml += `<img data-img-id="${escapeAttr(imgDef.id)}" src="${escapeAttr(src)}" class="${imgClass}" onerror="this.onerror=null;this.src='event_placeholder.png';">`;
    });

    if (mediaHtml) {
        leftHtml += `<div class="card-main-media">${mediaHtml}</div>`;
    }

    leftHtml += '<div class="p-info">';
    leftHtml += '<div class="p-head">';

    if (cfg.title) {
        const titleVal = cfg.title.render(row);
        const style = cfg.title.color === 'primary' ? ' style="color:var(--primary);"' : '';
        leftHtml += `<div class="p-name"${style}>${escapeHtml(titleVal)}</div>`;
    }

    if (cfg.subtitle) {
        leftHtml += `<div class="p-title">${escapeHtml(cfg.subtitle.render(row))}</div>`;
    }

    leftHtml += '</div>';
    leftHtml += '<div class="p-facts">';

    (cfg.rows || []).forEach((rowDef) => {
        if (typeof rowDef.shouldRender === 'function' && !rowDef.shouldRender(row)) {
            return;
        }
        leftHtml += `<div class="p-row"><span>${escapeHtml(rowDef.label)}</span><div class="p-row-value">${rowDef.render(row)}</div></div>`;
    });

    const cardActions = (cfg.actions || []).filter((actionDef) => {
        if (!actionDef) return false;
        if (typeof actionDef.shouldRender === 'function') return actionDef.shouldRender(row) !== false;
        return true;
    });

    if (cardActions.length) {
        leftHtml += '<div class="card-action-row">';
        cardActions.forEach((actionDef, index) => {
            const labelRaw = resolveActionValue(actionDef.label || actionDef.text || actionDef.title || 'Action', row);
            const label = escapeHtml(String(labelRaw || 'Action'));
            leftHtml += `<button type="button" class="compact-btn card-action-btn" data-card-action-index="${index}">${label}</button>`;
        });
        leftHtml += '</div>';
    }

    leftHtml += '</div></div></div>';

    let rightHtml = '';
    rightImages.forEach((imgDef) => {
        const visible = imgDef.visibilityToggleId ? !!fieldVisibility[imgDef.visibilityToggleId] : true;
        if (!visible) return;
        const src = imgDef.render(row);
        if (!src) return;
        rightHtml += `
            <div class="card-right-qr-wrapper">
                <img data-img-id="${escapeAttr(imgDef.id)}" src="${escapeAttr(src)}" class="card-side-qr-graphic">
                ${imgDef.label ? `<div class="card-side-qr-label">${escapeHtml(imgDef.label)}</div>` : ''}
            </div>`;
    });

    card.innerHTML = leftHtml + rightHtml;

    card.querySelectorAll('[data-card-action-index]').forEach((button) => {
        button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const index = Number(button.dataset.cardActionIndex || -1);
            const action = cardActions[index];
            if (!action) return;
            void runCardAction(row, action, card, cfg);
        });
    });

    images.forEach((imgDef) => {
        if (!imgDef.popup) return;
        const imgEl = card.querySelector(`[data-img-id="${imgDef.id}"]`);
        if (!imgEl) return;
        const popupTitle = typeof imgDef.popup.title === 'function' ? imgDef.popup.title(row) : (imgDef.popup.title || '');
        const popupCaption = typeof imgDef.popup.caption === 'function' ? imgDef.popup.caption(row) : (imgDef.popup.caption || '');
        imgEl.addEventListener('click', () => triggerLightboxPopup(imgEl.src, popupTitle, popupCaption));
        imgEl.style.cursor = 'pointer';
    });

    return card;
}

function renderPostersView(dataset, options = {}) {
    const container = options.containerId ? document.getElementById(options.containerId) : document.getElementById('view-posters');
    if (!container) return;
    container.innerHTML = '';
    container.className = `view-container layout-posters-grid poster-size-${viewEnhancementState.posterSize}`;

    if (!dataset.length) {
        container.innerHTML = '<div class="view-empty-state">No entries match the current filters.</div>';
        return;
    }

    const sortedDataset = sortDatasetByMode(dataset, 'date-desc');
    const grouped = sortedDataset.reduce((acc, item) => {
        const dateKey = item.start ? item.start.split(' ')[0] : 'Unknown';
        const [year, month] = dateKey.split('-');
        const label = dateKey ? `${year} ${new Intl.DateTimeFormat('en-US', { month: 'long' }).format(new Date(dateKey))}` : 'Unknown Date';
        if (!acc[label]) acc[label] = [];
        acc[label].push(item);
        return acc;
    }, {});

    const toolbar = document.createElement('div');
    toolbar.className = 'posters-toolbar';
    toolbar.innerHTML = `
        <button type="button" class="compact-btn ${viewEnhancementState.posterSize === 'sm' ? 'active' : ''}" data-poster-size="sm">Small</button>
        <button type="button" class="compact-btn ${viewEnhancementState.posterSize === 'md' ? 'active' : ''}" data-poster-size="md">Medium</button>
        <button type="button" class="compact-btn ${viewEnhancementState.posterSize === 'lg' ? 'active' : ''}" data-poster-size="lg">Large</button>
    `;
    container.appendChild(toolbar);

    toolbar.querySelectorAll('[data-poster-size]').forEach((button) => {
        button.addEventListener('click', () => {
            viewEnhancementState.posterSize = button.dataset.posterSize || 'md';
            saveViewEnhancementStateToStorage();
            filterAndRenderEngine();
        });
    });

    Object.entries(grouped).forEach(([label, items]) => {
        const section = document.createElement('div');
        section.className = 'poster-group';
        section.innerHTML = `<div class="poster-group-label">${escapeHtml(label)}</div>`;

        const grid = document.createElement('div');
        grid.className = 'poster-grid';

        items.forEach((event) => {
            const posterPath = getImageFallback(event.posterpath || event.poster || 'event_placeholder.png', 'event_placeholder.png');
            const card = document.createElement('div');
            card.className = 'poster-card';
            card.innerHTML = `
                <div class="poster-card-inner" onclick="showPosterSpotlight(${escapeAttr(JSON.stringify(posterPath))}, ${escapeAttr(JSON.stringify(event.title || 'Event'))}, ${escapeAttr(JSON.stringify(event.subtitle || ''))}, ${escapeAttr(JSON.stringify(event.location || ''))}, ${escapeAttr(JSON.stringify(event.room || ''))})">
                    <img src="${posterPath}" alt="${escapeHtml(event.title || 'Poster')}" loading="lazy" onerror="this.onerror=null;this.src='event_placeholder.png';"/>
                    <div class="poster-card-meta">
                        <div class="poster-card-title">${escapeHtml(event.title || '')}</div>
                        <div class="poster-card-subtitle">${escapeHtml(event.start ? event.start.split(' ')[0] : '')}</div>
                    </div>
                </div>
            `;
            grid.appendChild(card);
        });

        section.appendChild(grid);
        container.appendChild(section);
    });
}

function showPosterSpotlight(path, title, subtitle, location, room) {
    const caption = `${subtitle || ''}\n${location || ''}${room ? ` (${room})` : ''}`;
    triggerLightboxPopup(path, title, caption);
}

function normalizeCsvValue(value) {
    const text = String(value ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (!/[",\n]/.test(text)) return text;
    return `"${text.replace(/"/g, '""')}"`;
}

function buildScopeCsv(dataset, scopeConfig = activeScopeConfig) {
    const columns = scopeConfig?.tableColumns || [];
    if (!columns.length || !dataset.length) return '';

    const header = columns.map((column) => normalizeCsvValue(column.label || '')).join(',');
    const rows = dataset.map((row) => {
        return columns.map((column, index) => {
            if (typeof column.render === 'function') {
                try {
                    return normalizeCsvValue(column.render(row));
                } catch (error) {
                    return '';
                }
            }
            return normalizeCsvValue(resolveFieldValue(row, [column.field || `c${index}`]) || '');
        }).join(',');
    });

    return [header, ...rows].join('\n');
}

function enhanceTableView(container, dataset) {
    if (!container || !dataset.length) return;

    container.classList.toggle('table-density-compact', viewEnhancementState.tableDense);
    container.classList.add('table-fit-page');
    container.classList.remove('table-fit-content');
}

function renderBusScheduleGroupedTableView() {
    const container = document.getElementById('view-table');
    if (!container) return;

    const dataset = getBusScheduleTableRecords();
    container.className = 'view-container bus-grouped-table-view';
    container.innerHTML = '';

    if (!dataset.length) {
        container.innerHTML = '<div class="view-empty-state">No entries match the current filters.</div>';
        return;
    }

    const sectionsHtml = getBusScheduleTableSections(dataset)
        .map(({ title, bandClass, rows }) => buildBusScheduleRegionTableSection(title, rows, bandClass, { includeStar: true }))
        .join('');

    container.innerHTML = sectionsHtml;
    container.querySelectorAll('.bus-fav-btn').forEach((btn) => {
        btn.addEventListener('click', (event) => {
            toggleBusRouteStar(event.currentTarget.getAttribute('data-star-key'), event);
        });
    });
    enhanceTableView(container, dataset);
}

function renderTableView(dataset) {
    if (activeScope === 'bus_schedule') {
        renderBusScheduleGroupedTableView();
        return;
    }

    if (window.ViewModules?.renderTableView) {
        window.ViewModules.renderTableView(dataset, {
            activeScopeConfig,
            fieldVisibility,
            escapeHtml,
            resolveFieldValue,
            pagination: getTablePaginationConfig(dataset.length),
            containerId: 'view-table',
            rowClass: activeScope === 'bus_schedule' ? getBusTableRowClass : null
        });
        const container = document.getElementById('view-table');
        enhanceTableView(container, dataset);
        return;
    }

    const container = document.getElementById('view-table');
    if (!container) return;
    container.className = 'view-container';
    container.innerHTML = '<div class="view-empty-state">Table renderer module is not available.</div>';
}

function renderChartJsLabView(dataset) {
    if (window.ViewModules?.renderChartJsLabView) {
        window.ViewModules.renderChartJsLabView(dataset, {
            activeScopeConfig,
            resolveFieldValue,
            containerId: 'view-chartjs-lab'
        });
        return;
    }

    const container = document.getElementById('view-chartjs-lab');
    if (!container) return;
    container.className = 'view-container';
    container.innerHTML = '<div class="view-empty-state">Chart.js lab module is not available.</div>';
}

function renderGridJsTableView(dataset) {
    if (window.ViewModules?.renderGridJsTableView) {
        window.ViewModules.renderGridJsTableView(dataset, {
            activeScopeConfig,
            resolveFieldValue,
            escapeHtml,
            containerId: 'view-gridjs-table'
        });
        return;
    }

    const container = document.getElementById('view-gridjs-table');
    if (!container) return;
    container.className = 'view-container';
    container.innerHTML = '<div class="view-empty-state">Grid.js table module is not available.</div>';
}

function parseIngredientAmount(text) {
    const source = String(text || '').trim();
    const match = source.match(/^(\d+(?:[\.,]\d+)?(?:\s*\/\s*\d+(?:[\.,]\d+)?)?)\s*(g|kg|ml|l|oz|lb|tsp|tbsp|cup|cups)?\b\s*(.*)$/i);
    if (!match) return null;

    const numericPart = match[1].replace(',', '.');
    const unit = (match[2] || '').toLowerCase();
    const rest = match[3] || '';

    let value = NaN;
    if (numericPart.includes('/')) {
        const [left, right] = numericPart.split('/').map((part) => Number(part.trim()));
        if (Number.isFinite(left) && Number.isFinite(right) && right !== 0) {
            value = left / right;
        }
    } else {
        value = Number(numericPart);
    }

    if (!Number.isFinite(value)) return null;
    return { value, unit, rest };
}

function formatIngredientAmount(value) {
    if (!Number.isFinite(value)) return '';
    if (value >= 10) return String(Math.round(value * 10) / 10);
    return String(Math.round(value * 100) / 100);
}

function convertIngredientUnit(value, unit, system) {
    if (!unit) return { value, unit };

    const metricToImperial = {
        g: { unit: 'oz', factor: 0.035274 },
        kg: { unit: 'lb', factor: 2.20462 },
        ml: { unit: 'fl oz', factor: 0.033814 },
        l: { unit: 'qt', factor: 1.05669 }
    };

    const imperialToMetric = {
        oz: { unit: 'g', factor: 28.3495 },
        lb: { unit: 'kg', factor: 0.453592 },
        'fl oz': { unit: 'ml', factor: 29.5735 },
        qt: { unit: 'l', factor: 0.946353 }
    };

    if (system === 'imperial' && metricToImperial[unit]) {
        const target = metricToImperial[unit];
        return { value: value * target.factor, unit: target.unit };
    }

    if (system === 'metric' && imperialToMetric[unit]) {
        const target = imperialToMetric[unit];
        return { value: value * target.factor, unit: target.unit };
    }

    return { value, unit };
}

function transformIngredientText(text, servingsMultiplier, unitSystem) {
    const parsed = parseIngredientAmount(text);
    if (!parsed) return text;

    const scaled = parsed.value * servingsMultiplier;
    const converted = convertIngredientUnit(scaled, parsed.unit, unitSystem);
    const value = formatIngredientAmount(converted.value);
    const unit = converted.unit ? ` ${converted.unit}` : '';
    const rest = parsed.rest ? ` ${parsed.rest}` : '';
    return `${value}${unit}${rest}`.trim();
}

function applyFlipbookRecipeAdjustments(host, controls) {
    if (!host || !controls) return;

    const servingsOut = controls.querySelector('[data-serving-display]');
    const unitButtons = controls.querySelectorAll('[data-unit-system]');
    const decrease = controls.querySelector('[data-serving-action="decrease"]');
    const increase = controls.querySelector('[data-serving-action="increase"]');
    let servingsMultiplier = 1;
    let unitSystem = 'metric';

    const sync = () => {
        if (servingsOut) servingsOut.textContent = `${Math.round(servingsMultiplier * 100)}%`;

        unitButtons.forEach((button) => {
            button.classList.toggle('active', button.dataset.unitSystem === unitSystem);
        });

        host.querySelectorAll('.flipbook-ingredient-item').forEach((node) => {
            const base = node.dataset.baseIngredient || node.textContent || '';
            node.textContent = transformIngredientText(base, servingsMultiplier, unitSystem);
        });
    };

    decrease?.addEventListener('click', () => {
        servingsMultiplier = Math.max(0.5, Math.round((servingsMultiplier - 0.25) * 100) / 100);
        sync();
    });

    increase?.addEventListener('click', () => {
        servingsMultiplier = Math.min(3, Math.round((servingsMultiplier + 0.25) * 100) / 100);
        sync();
    });

    unitButtons.forEach((button) => {
        button.addEventListener('click', () => {
            unitSystem = button.dataset.unitSystem || 'metric';
            sync();
        });
    });

    sync();
}

function getFlipbookPageSortValue(row, fallbackIndex = 0) {
    const raw = resolveFieldValue(row, ['pageNumber', 'page', 'index']);
    const numeric = Number(raw);
    return Number.isFinite(numeric) ? numeric : fallbackIndex + 1;
}

function getFlipbookPageKey(row, fallbackIndex = 0) {
    const id = resolveFieldValue(row, ['id', 'ID']);
    if (id !== '' && id !== null && id !== undefined) return `id:${String(id)}`;
    const pageValue = resolveFieldValue(row, ['pageNumber', 'page', 'index']);
    if (pageValue !== '' && pageValue !== null && pageValue !== undefined) return `page:${String(pageValue)}`;
    return `row:${fallbackIndex}`;
}

function isFlipbookCoverType(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === 'cover' || normalized === 'front-cover' || normalized === 'front_cover' || normalized === 'frontcover';
}

function isFlipbookBackCoverType(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === 'back-cover' || normalized === 'back_cover' || normalized === 'backcover' || normalized === 'rear-cover' || normalized === 'rear_cover' || normalized === 'rearcover';
}

function resolveFlipbookPagesWithCovers(filteredDataset) {
    const baseSource = Array.isArray(activeDataset) && activeDataset.length ? activeDataset : filteredDataset;
    const allPagesSorted = (baseSource || []).slice().sort((a, b) => getFlipbookPageSortValue(a) - getFlipbookPageSortValue(b));
    const filteredSorted = (filteredDataset || []).slice().sort((a, b) => getFlipbookPageSortValue(a) - getFlipbookPageSortValue(b));

    if (!allPagesSorted.length) return filteredSorted;

    const selectedKeys = new Set(filteredSorted.map((row, index) => getFlipbookPageKey(row, index)));
    const pages = allPagesSorted.filter((row, index) => selectedKeys.has(getFlipbookPageKey(row, index)));

    const coverPage = allPagesSorted.find((row) => isFlipbookCoverType(resolveFieldValue(row, ['type']))) || allPagesSorted[0];
    const backCoverPage = allPagesSorted.slice().reverse().find((row) => isFlipbookBackCoverType(resolveFieldValue(row, ['type']))) || allPagesSorted[allPagesSorted.length - 1];

    const ensureIncluded = (row) => {
        if (!row) return;
        const key = getFlipbookPageKey(row);
        const already = pages.some((item, idx) => getFlipbookPageKey(item, idx) === key);
        if (!already) pages.push(row);
    };

    ensureIncluded(coverPage);
    ensureIncluded(backCoverPage);

    return pages.sort((a, b) => getFlipbookPageSortValue(a) - getFlipbookPageSortValue(b));
}

function getFlipbookProgressKey(scopeKey = activeScope) {
    return `${scopeKey || 'default'}:pageIndex`;
}

function loadFlipbookProgress(scopeKey = activeScope) {
    try {
        const raw = window.localStorage.getItem(FLIPBOOK_PROGRESS_STORAGE_KEY);
        if (!raw) return 0;
        const parsed = JSON.parse(raw);
        const value = Number(parsed?.[getFlipbookProgressKey(scopeKey)] || 0);
        return Number.isFinite(value) && value >= 0 ? value : 0;
    } catch (error) {
        return 0;
    }
}

function saveFlipbookProgress(pageIndex, scopeKey = activeScope) {
    try {
        const raw = window.localStorage.getItem(FLIPBOOK_PROGRESS_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        parsed[getFlipbookProgressKey(scopeKey)] = Math.max(0, Number(pageIndex) || 0);
        window.localStorage.setItem(FLIPBOOK_PROGRESS_STORAGE_KEY, JSON.stringify(parsed));
    } catch (error) {
        // Ignore storage failures.
    }
}

function renderFlipbookView(dataset, options = {}) {
    const container = options.containerId ? document.getElementById(options.containerId) : document.getElementById('view-flipbook');
    if (!container) return;
    container.className = 'view-container flipbook-layout';
    container.innerHTML = '';

    const pages = resolveFlipbookPagesWithCovers(dataset);

    if (!pages.length) {
        container.innerHTML = '<div class="view-empty-state">No pages available for flipbook.</div>';
        return;
    }

    currentFlipbookPages = pages.slice();

    const frontCover = pages.find((row) => isFlipbookCoverType(resolveFieldValue(row, ['type']))) || pages[0];
    const backCover = pages.slice().reverse().find((row) => isFlipbookBackCoverType(resolveFieldValue(row, ['type']))) || pages[pages.length - 1];
    const frontCoverKey = getFlipbookPageKey(frontCover);
    const backCoverKey = getFlipbookPageKey(backCover);

    const stage = document.createElement('div');
    stage.className = 'flipbook-stage';
    const host = document.createElement('div');
    host.className = 'flipbook-host';
    const controls = document.createElement('div');
    controls.className = 'flipbook-controls';
    const recipeControlsEnabled = activeScope === 'recipes';
    controls.innerHTML = `
        <button type="button" class="compact-btn" data-action="first" aria-label="First page">First</button>
        <button type="button" class="compact-btn" data-action="prev" aria-label="Previous page">Prev</button>
        <div class="flipbook-page-indicator" aria-live="polite">Page 1 / ${pages.length}</div>
        <button type="button" class="compact-btn" data-action="next" aria-label="Next page">Next</button>
        <button type="button" class="compact-btn" data-action="last" aria-label="Last page">Last</button>
        ${recipeControlsEnabled ? '<button type="button" class="compact-btn" data-serving-action="decrease" aria-label="Decrease servings">-</button>' : ''}
        ${recipeControlsEnabled ? '<span class="flipbook-serving-display" data-serving-display>100%</span>' : ''}
        ${recipeControlsEnabled ? '<button type="button" class="compact-btn" data-serving-action="increase" aria-label="Increase servings">+</button>' : ''}
        ${recipeControlsEnabled ? '<button type="button" class="compact-btn active" data-unit-system="metric" aria-label="Metric units">Metric</button>' : ''}
        ${recipeControlsEnabled ? '<button type="button" class="compact-btn" data-unit-system="imperial" aria-label="Imperial units">Imperial</button>' : ''}
        <button type="button" class="compact-btn" data-action="download-html" aria-label="Download flipbook as HTML">Download HTML</button>
        <button type="button" class="compact-btn" data-action="download-pdf" aria-label="Download flipbook as PDF">Download PDF</button>
    `;

    pages.forEach((row, index) => {
        const page = document.createElement('article');
        const pageType = String(resolveFieldValue(row, ['type']) || 'page').toLowerCase();
        page.className = `flipbook-page flipbook-page-${escapeAttr(pageType)}`;
        const pageKey = getFlipbookPageKey(row, index);
        const isHardCover = pageKey === frontCoverKey || pageKey === backCoverKey;
        if (isHardCover) {
            page.classList.add('flipbook-page-hard-cover');
        }

        const title = resolveFieldValue(row, ['title', 'name']) || `Page ${index + 1}`;
        const subtitle = resolveFieldValue(row, ['subtitle', 'section', 'type']) || '';
        const body = resolveFieldValue(row, ['body', 'summary', 'description']) || '';
        const heroImage = resolveFieldValue(row, ['heroImage', 'image', 'coverImage']) || '';
        const gallery = Array.isArray(row.gallery) ? row.gallery : [];
        const leadImage = heroImage || gallery[0] || '';

        const ingredients = Array.isArray(row.ingredients) ? row.ingredients : [];
        const steps = Array.isArray(row.steps) ? row.steps : [];
        const tags = Array.isArray(row.tags) ? row.tags : [];
        const stats = [
            row.difficulty ? `<span class="flipbook-stat-chip">${escapeHtml(String(row.difficulty))}</span>` : '',
            row.prepMinutes ? `<span class="flipbook-stat-chip">Prep ${escapeHtml(String(row.prepMinutes))}m</span>` : '',
            row.cookMinutes ? `<span class="flipbook-stat-chip">Cook ${escapeHtml(String(row.cookMinutes))}m</span>` : '',
            row.servings ? `<span class="flipbook-stat-chip">Serves ${escapeHtml(String(row.servings))}</span>` : ''
        ].filter(Boolean).join('');

        const headerBlock = `
            <header class="flipbook-page-header">
                <div class="flipbook-page-meta">Page ${escapeHtml(String(resolveFieldValue(row, ['pageNumber']) || index + 1))}</div>
                <h3 class="flipbook-page-title">${escapeHtml(title)}</h3>
                ${subtitle ? `<div class="flipbook-page-subtitle">${escapeHtml(subtitle)}</div>` : ''}
                ${stats ? `<div class="flipbook-stats-row">${stats}</div>` : ''}
            </header>
        `;

        const bodyBlock = body ? `<p class="flipbook-page-body">${escapeHtml(body)}</p>` : '';

        const recipeLayout = ingredients.length || steps.length
            ? `
                <section class="flipbook-content-grid">
                    ${ingredients.length ? `<div class="flipbook-column"><h4>Ingredients</h4><ul>${ingredients.map((item) => `<li class="flipbook-ingredient-item" data-base-ingredient="${escapeAttr(String(item))}">${escapeHtml(String(item))}</li>`).join('')}</ul></div>` : ''}
                    ${steps.length ? `<div class="flipbook-column"><h4>Steps</h4><ol>${steps.map((item) => `<li>${escapeHtml(String(item))}</li>`).join('')}</ol></div>` : ''}
                </section>`
            : '';

        const tagsBlock = tags.length
            ? `<div class="flipbook-tags-row">${tags.map((tag) => `<span class="flipbook-tag">${escapeHtml(String(tag))}</span>`).join('')}</div>`
            : '';
        const galleryBlock = gallery.length > 1
            ? `<div class="flipbook-gallery-row">${gallery.map((image, idx) => `<img class="flipbook-gallery-image" src="${escapeAttr(image)}" alt="${escapeAttr(`${title} image ${idx + 1}`)}" onerror="this.onerror=null;this.src='event_placeholder.png';"/>`).join('')}</div>`
            : '';

        const imageBlock = leadImage ? `<img class="flipbook-page-image" src="${escapeAttr(leadImage)}" alt="${escapeAttr(title)}" onerror="this.onerror=null;this.src='event_placeholder.png';"/>` : '';

        page.innerHTML = `
            ${headerBlock}
            ${imageBlock}
            ${bodyBlock}
            ${recipeLayout}
            ${tagsBlock}
            ${galleryBlock}
        `;

        host.appendChild(page);
    });

    stage.appendChild(host);
    container.appendChild(controls);
    container.appendChild(stage);

    const indicator = controls.querySelector('.flipbook-page-indicator');
    const prevBtn = controls.querySelector('[data-action="prev"]');
    const nextBtn = controls.querySelector('[data-action="next"]');
    const firstBtn = controls.querySelector('[data-action="first"]');
    const lastBtn = controls.querySelector('[data-action="last"]');
    const downloadBtn = controls.querySelector('[data-action="download-html"]');
    const downloadPdfBtn = controls.querySelector('[data-action="download-pdf"]');

    const syncFlipbookIndicator = () => {
        const currentPage = (flipbookInstance?.getCurrentPageIndex?.() || 0) + 1;
        if (indicator) {
            indicator.textContent = `Page ${currentPage} / ${pages.length}`;
        }
        if (firstBtn) firstBtn.disabled = currentPage <= 1;
        if (prevBtn) prevBtn.disabled = currentPage <= 1;
        if (nextBtn) nextBtn.disabled = currentPage >= pages.length;
        if (lastBtn) lastBtn.disabled = currentPage >= pages.length;
    };

    if (!window.St?.PageFlip) {
        const fallback = document.createElement('div');
        fallback.className = 'view-error-hint';
        fallback.textContent = 'PageFlip library not available. Showing static pages.';
        container.prepend(fallback);
        controls.style.display = 'none';
        return;
    }

    try {
        flipbookInstance = new window.St.PageFlip(host, {
            width: 520,
            height: 700,
            size: 'stretch',
            minWidth: 280,
            maxWidth: 1100,
            minHeight: 360,
            maxHeight: 900,
            showCover: false,
            mobileScrollSupport: true,
            usePortrait: isCompactViewport(),
            swipeDistance: isCompactViewport() ? 16 : 24,
            flippingTime: 620,
            maxShadowOpacity: 0.28,
            drawShadow: true,
            clickEventForward: true
        });
        flipbookInstance.loadFromHTML(host.querySelectorAll('.flipbook-page'));

        prevBtn?.addEventListener('click', () => {
            flipbookInstance?.flipPrev?.('top');
        });
        nextBtn?.addEventListener('click', () => {
            flipbookInstance?.flipNext?.('top');
        });
        firstBtn?.addEventListener('click', () => {
            if (typeof flipbookInstance?.turnToPage === 'function') {
                flipbookInstance.turnToPage(0);
            } else {
                flipbookInstance?.flip?.(0, 'top');
            }
        });
        lastBtn?.addEventListener('click', () => {
            const target = Math.max(0, pages.length - 1);
            if (typeof flipbookInstance?.turnToPage === 'function') {
                flipbookInstance.turnToPage(target);
            } else {
                flipbookInstance?.flip?.(target, 'top');
            }
        });
        downloadBtn?.addEventListener('click', () => {
            downloadCurrentFlipbookHtml();
        });
        downloadPdfBtn?.addEventListener('click', () => {
            void downloadCurrentFlipbookPdf();
        });
        if (recipeControlsEnabled) {
            applyFlipbookRecipeAdjustments(host, controls);
        }
        flipbookInstance.on?.('flip', () => {
            const pageIndex = flipbookInstance?.getCurrentPageIndex?.() || 0;
            saveFlipbookProgress(pageIndex);
            syncFlipbookIndicator();
        });

        const savedPageIndex = Math.min(Math.max(0, loadFlipbookProgress()), Math.max(0, pages.length - 1));
        if (savedPageIndex > 0) {
            if (typeof flipbookInstance?.turnToPage === 'function') {
                flipbookInstance.turnToPage(savedPageIndex);
            } else {
                flipbookInstance?.flip?.(savedPageIndex, 'top');
            }
        }
        syncFlipbookIndicator();
    } catch (error) {
        const fallback = document.createElement('div');
        fallback.className = 'view-error-hint';
        fallback.textContent = 'Flipbook initialization failed. Static pages are shown.';
        container.prepend(fallback);
        controls.style.display = 'none';
    }
}

function buildFlipbookDownloadHtml(pages = []) {
    const pageMarkup = pages
        .sort((a, b) => Number(a.pageNumber || 0) - Number(b.pageNumber || 0))
        .map((row, index) => {
            const title = escapeHtml(resolveFieldValue(row, ['title', 'name']) || `Page ${index + 1}`);
            const subtitle = escapeHtml(resolveFieldValue(row, ['subtitle', 'section', 'type']) || '');
            const body = escapeHtml(resolveFieldValue(row, ['body', 'summary', 'description']) || '');
            const heroImage = escapeAttr(resolveFieldValue(row, ['heroImage', 'image', 'coverImage']) || '');
            const ingredients = Array.isArray(row.ingredients) ? row.ingredients : [];
            const steps = Array.isArray(row.steps) ? row.steps : [];
            return `
                <article class="flipbook-page">
                    ${heroImage ? `<img class="flipbook-page-image" src="${heroImage}" alt="${title}"/>` : ''}
                    <div class="flipbook-page-meta">Page ${escapeHtml(String(row.pageNumber || index + 1))}</div>
                    <h3 class="flipbook-page-title">${title}</h3>
                    ${subtitle ? `<div class="flipbook-page-subtitle">${subtitle}</div>` : ''}
                    ${body ? `<p class="flipbook-page-body">${body}</p>` : ''}
                    ${ingredients.length ? `<h4>Ingredients</h4><ul>${ingredients.map((item) => `<li>${escapeHtml(String(item))}</li>`).join('')}</ul>` : ''}
                    ${steps.length ? `<h4>Steps</h4><ol>${steps.map((item) => `<li>${escapeHtml(String(item))}</li>`).join('')}</ol>` : ''}
                </article>`;
        }).join('');

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Flipbook Export</title>
<script src="https://cdn.jsdelivr.net/npm/page-flip/dist/js/page-flip.browser.min.js"></script>
<style>
body{font-family:ui-monospace,monospace;background:#f8fafc;margin:0;padding:24px;}
.flipbook-host{width:min(100%,980px);height:72vh;margin:0 auto;}
.flipbook-page{background:#fff;border:1px solid #cbd5e1;border-radius:10px;padding:14px;display:flex;flex-direction:column;gap:8px;}
.flipbook-page-image{width:100%;max-height:220px;object-fit:cover;border-radius:8px;border:1px solid #cbd5e1;}
.flipbook-page-meta{font-size:11px;color:#475569;font-weight:700;}
.flipbook-page-title{font-size:16px;margin:0;}
.flipbook-page-subtitle{color:#0f766e;font-size:12px;font-weight:700;}
.flipbook-page-body{font-size:12px;color:#0f172a;}
</style>
</head>
<body>
<div id="flipbook" class="flipbook-host">${pageMarkup}</div>
<script>
const host=document.getElementById('flipbook');
const pf=new St.PageFlip(host,{width:520,height:700,size:'stretch',minWidth:280,maxWidth:1100,minHeight:360,maxHeight:900,showCover:true,mobileScrollSupport:true,flippingTime:850});
pf.loadFromHTML(host.querySelectorAll('.flipbook-page'));
</script>
</body>
</html>`;
}

function downloadCurrentFlipbookHtml() {
    if (!currentFlipbookPages.length) return;
    const html = buildFlipbookDownloadHtml(currentFlipbookPages);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${activeScope || 'flipbook'}-export.html`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
}

async function downloadCurrentFlipbookPdf() {
    if (!currentFlipbookPages.length) return;

    if (!window.html2pdf) {
        downloadCurrentFlipbookHtml();
        return;
    }

    const pagesMarkup = currentFlipbookPages
        .slice()
        .sort((a, b) => getFlipbookPageSortValue(a) - getFlipbookPageSortValue(b))
        .map((row, index) => {
            const title = escapeHtml(resolveFieldValue(row, ['title', 'name']) || `Page ${index + 1}`);
            const subtitle = escapeHtml(resolveFieldValue(row, ['subtitle', 'section', 'type']) || '');
            const body = escapeHtml(resolveFieldValue(row, ['body', 'summary', 'description']) || '');
            const heroImage = escapeAttr(resolveFieldValue(row, ['heroImage', 'image', 'coverImage']) || '');
            const ingredients = Array.isArray(row.ingredients) ? row.ingredients : [];
            const steps = Array.isArray(row.steps) ? row.steps : [];

            return `
                <article class="flipbook-pdf-page">
                    <div class="flipbook-pdf-page-meta">Page ${escapeHtml(String(getFlipbookPageSortValue(row, index)))}</div>
                    <h2 class="flipbook-pdf-page-title">${title}</h2>
                    ${subtitle ? `<div class="flipbook-pdf-page-subtitle">${subtitle}</div>` : ''}
                    ${heroImage ? `<img class="flipbook-pdf-page-image" src="${heroImage}" alt="${title}"/>` : ''}
                    ${body ? `<p class="flipbook-pdf-page-body">${body}</p>` : ''}
                    ${ingredients.length ? `<h4>Ingredients</h4><ul>${ingredients.map((item) => `<li>${escapeHtml(String(item))}</li>`).join('')}</ul>` : ''}
                    ${steps.length ? `<h4>Steps</h4><ol>${steps.map((item) => `<li>${escapeHtml(String(item))}</li>`).join('')}</ol>` : ''}
                </article>
            `;
        }).join('');

    const exportNode = document.createElement('div');
    exportNode.className = 'flipbook-pdf-export';
    exportNode.innerHTML = pagesMarkup;
    document.body.appendChild(exportNode);

    try {
        await window.html2pdf().set({
            margin: [8, 8, 8, 8],
            filename: `${activeScope || 'flipbook'}-export.pdf`,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2, useCORS: true },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
            pagebreak: { mode: ['css', 'legacy'] }
        }).from(exportNode).save();
    } finally {
        document.body.removeChild(exportNode);
    }
}

function renderDeckView(dataset, options = {}) {
    const container = options.containerId ? document.getElementById(options.containerId) : document.getElementById('view-deck');
    if (!container) return;
    container.className = 'view-container deck-layout';
    container.innerHTML = '';

    if (!dataset.length) {
        container.innerHTML = '<div class="view-empty-state">No entries available for deck view.</div>';
        return;
    }

    if (!window.Swiper) {
        container.innerHTML = '<div class="view-empty-state">Swiper library not available for deck view.</div>';
        return;
    }

    const slides = dataset.slice().sort((a, b) => getFlipbookPageSortValue(a) - getFlipbookPageSortValue(b));
    const toolbar = document.createElement('div');
    toolbar.className = 'deck-toolbar';
    toolbar.innerHTML = `
        <button type="button" class="compact-btn active" data-deck-effect="coverflow">Coverflow</button>
        <button type="button" class="compact-btn" data-deck-effect="cards">Cards</button>
        <button type="button" class="compact-btn" data-deck-effect="fade">Fade</button>
        <button type="button" class="compact-btn" data-deck-action="first">First</button>
        <button type="button" class="compact-btn" data-deck-action="last">Last</button>
        <div class="deck-counter" aria-live="polite">1 / ${slides.length}</div>
    `;

    const host = document.createElement('div');
    host.className = 'swiper deck-swiper';

    const wrapper = document.createElement('div');
    wrapper.className = 'swiper-wrapper';

    slides.forEach((row, index) => {
        const slide = document.createElement('article');
        slide.className = 'swiper-slide deck-slide';
        const title = resolveFieldValue(row, ['title', 'name']) || `Slide ${index + 1}`;
        const subtitle = resolveFieldValue(row, ['subtitle', 'section', 'type']) || '';
        const body = resolveFieldValue(row, ['body', 'summary', 'description']) || '';
        const heroImage = resolveFieldValue(row, ['heroImage', 'image', 'coverImage']) || '';
        slide.innerHTML = `
            <div class="deck-slide-shell">
                ${heroImage ? `<img class="deck-slide-image" src="${escapeAttr(heroImage)}" alt="${escapeAttr(title)}" onerror="this.onerror=null;this.src='event_placeholder.png';"/>` : ''}
                <div class="deck-slide-meta">Slide ${escapeHtml(String(index + 1))}</div>
                <h3 class="deck-slide-title">${escapeHtml(title)}</h3>
                ${subtitle ? `<div class="deck-slide-subtitle">${escapeHtml(subtitle)}</div>` : ''}
                ${body ? `<p class="deck-slide-body">${escapeHtml(body)}</p>` : ''}
            </div>
        `;
        wrapper.appendChild(slide);
    });

    const pagination = document.createElement('div');
    pagination.className = 'swiper-pagination';
    const prev = document.createElement('div');
    prev.className = 'swiper-button-prev';
    const next = document.createElement('div');
    next.className = 'swiper-button-next';

    host.appendChild(wrapper);
    host.appendChild(pagination);
    host.appendChild(prev);
    host.appendChild(next);
    container.appendChild(toolbar);
    container.appendChild(host);

    const thumbs = document.createElement('div');
    thumbs.className = 'deck-thumbs';
    thumbs.innerHTML = slides
        .map((row, idx) => {
            const thumbTitle = resolveFieldValue(row, ['title', 'name']) || `Slide ${idx + 1}`;
            return `<button type="button" class="deck-thumb ${idx === 0 ? 'active' : ''}" data-deck-thumb="${idx}" title="${escapeAttr(thumbTitle)}">${idx + 1}</button>`;
        })
        .join('');
    container.appendChild(thumbs);

    const counterNode = toolbar.querySelector('.deck-counter');
    const firstBtn = toolbar.querySelector('[data-deck-action="first"]');
    const lastBtn = toolbar.querySelector('[data-deck-action="last"]');

    const applyDeckThumbState = (index) => {
        thumbs.querySelectorAll('.deck-thumb').forEach((node) => {
            const active = Number(node.dataset.deckThumb) === index;
            node.classList.toggle('active', active);
        });
        if (counterNode) counterNode.textContent = `${index + 1} / ${slides.length}`;
        if (firstBtn) firstBtn.disabled = index <= 0;
        if (lastBtn) lastBtn.disabled = index >= slides.length - 1;
    };

    const initDeck = (effect = 'coverflow') => {
        if (deckInstance) {
            try { deckInstance.destroy(true, true); } catch (error) {}
            deckInstance = null;
        }

        const shared = {
            grabCursor: true,
            centeredSlides: true,
            slidesPerView: 1,
            speed: 540,
            keyboard: { enabled: true },
            pagination: {
                el: pagination,
                clickable: true
            },
            navigation: {
                nextEl: next,
                prevEl: prev
            },
            on: {
                slideChange: () => {
                    applyDeckThumbState(deckInstance?.activeIndex || 0);
                }
            }
        };

        if (effect === 'fade') {
            deckInstance = new window.Swiper(host, {
                ...shared,
                effect: 'fade',
                fadeEffect: { crossFade: true }
            });
            return;
        }

        if (effect === 'cards') {
            deckInstance = new window.Swiper(host, {
                ...shared,
                effect: 'cards',
                cardsEffect: {
                    perSlideRotate: 1.2,
                    perSlideOffset: 8,
                    slideShadows: false
                }
            });
            return;
        }

        deckInstance = new window.Swiper(host, {
            ...shared,
            effect: 'coverflow',
            coverflowEffect: {
                rotate: 24,
                stretch: 0,
                depth: 140,
                modifier: 1,
                slideShadows: false
            }
        });
    };

    toolbar.querySelectorAll('[data-deck-effect]').forEach((btn) => {
        btn.addEventListener('click', () => {
            toolbar.querySelectorAll('[data-deck-effect]').forEach((node) => node.classList.remove('active'));
            btn.classList.add('active');
            initDeck(btn.dataset.deckEffect || 'coverflow');
            applyDeckThumbState(deckInstance?.activeIndex || 0);
        });
    });

    thumbs.querySelectorAll('.deck-thumb').forEach((thumb) => {
        thumb.addEventListener('click', () => {
            const index = Number(thumb.dataset.deckThumb || 0);
            deckInstance?.slideTo?.(index);
        });
    });

    firstBtn?.addEventListener('click', () => deckInstance?.slideTo?.(0));
    lastBtn?.addEventListener('click', () => deckInstance?.slideTo?.(Math.max(0, slides.length - 1)));

    initDeck('coverflow');
    applyDeckThumbState(0);
}

function renderGanttView(dataset, options = {}) {
    const container = options.containerId ? document.getElementById(options.containerId) : document.getElementById('view-gantt');
    if (!container) return;
    container.className = 'view-container gantt-layout';
    container.innerHTML = '';

    if (!dataset.length) {
        container.innerHTML = '<div class="view-empty-state">No tasks available for Gantt view.</div>';
        return;
    }

    if (!window.Gantt) {
        container.innerHTML = '<div class="view-empty-state">Frappe Gantt library is not available.</div>';
        return;
    }

    const tasks = dataset.map((row, index) => {
        const startRaw = String(resolveFieldValue(row, ['start', 'date']) || '').trim();
        const dueRaw = String(resolveFieldValue(row, ['due', 'end']) || '').trim();
        if (!startRaw || !dueRaw) return null;
        const start = startRaw.split(' ')[0];
        const end = dueRaw.split(' ')[0];
        const status = String(resolveFieldValue(row, ['status']) || 'idea').toLowerCase();
        const id = String(resolveFieldValue(row, ['id', 'ID']) || `task-${index + 1}`);

        return {
            id,
            name: String(resolveFieldValue(row, ['title', 'name']) || `Task ${index + 1}`),
            start,
            end,
            progress: status === 'published' ? 100 : status === 'review' ? 80 : status === 'draft' ? 45 : 10,
            custom_class: `gantt-status-${status}`
        };
    }).filter(Boolean);

    if (!tasks.length) {
        container.innerHTML = '<div class="view-empty-state">Gantt requires start and due dates.</div>';
        return;
    }

    const owners = Array.from(new Set(dataset.map((row) => String(resolveFieldValue(row, ['owner']) || '').trim()).filter(Boolean))).sort();

    const toolbar = document.createElement('div');
    toolbar.className = 'timeline-toolbar';
    toolbar.innerHTML = `
        <button type="button" class="compact-btn" data-gantt-mode="Day">Day</button>
        <button type="button" class="compact-btn active" data-gantt-mode="Week">Week</button>
        <button type="button" class="compact-btn" data-gantt-mode="Month">Month</button>
        <button type="button" class="compact-btn" data-gantt-mode="Quarter Day">Quarter</button>
        <label class="table-pagination-label" for="gantt-owner-filter">Owner</label>
        <select id="gantt-owner-filter" class="table-pagination-select">
            <option value="ALL">All</option>
            ${owners.map((owner) => `<option value="${escapeAttr(owner)}">${escapeHtml(owner)}</option>`).join('')}
        </select>
        <label class="table-pagination-label" for="gantt-status-filter">Status</label>
        <select id="gantt-status-filter" class="table-pagination-select">
            <option value="ALL">All</option>
            <option value="idea">Idea</option>
            <option value="draft">Draft</option>
            <option value="review">Review</option>
            <option value="published">Published</option>
        </select>
        <div class="gantt-summary" aria-live="polite"></div>
    `;

    const host = document.createElement('div');
    host.className = 'gantt-host';
    container.appendChild(toolbar);
    container.appendChild(host);

    const summaryNode = toolbar.querySelector('.gantt-summary');
    const ownerFilter = toolbar.querySelector('#gantt-owner-filter');
    const statusFilter = toolbar.querySelector('#gantt-status-filter');

    const getFilteredTasks = () => {
        const owner = ownerFilter?.value || 'ALL';
        const status = statusFilter?.value || 'ALL';
        return tasks.filter((task) => {
            const source = dataset.find((row, idx) => String(resolveFieldValue(row, ['id', 'ID']) || `task-${idx + 1}`) === String(task.id));
            const rowOwner = String(resolveFieldValue(source || {}, ['owner']) || '').trim();
            const rowStatus = String(resolveFieldValue(source || {}, ['status']) || '').toLowerCase();
            const ownerMatch = owner === 'ALL' || rowOwner === owner;
            const statusMatch = status === 'ALL' || rowStatus === status;
            return ownerMatch && statusMatch;
        });
    };

    const renderGantt = (mode = 'Week') => {
        const filteredTasks = getFilteredTasks();
        if (!filteredTasks.length) {
            host.innerHTML = '<div class="view-empty-state">No tasks match the selected filters.</div>';
            ganttInstance = null;
            if (summaryNode) summaryNode.textContent = '0 tasks';
            return;
        }

        host.innerHTML = '';
        ganttInstance = new window.Gantt(host, filteredTasks, {
            view_mode: mode,
            language: 'en',
            popup_trigger: 'click',
            custom_popup_html: (task) => `
                <div class="gantt-popup">
                    <h5>${escapeHtml(task.name)}</h5>
                    <div>${escapeHtml(task.start)} to ${escapeHtml(task.end)}</div>
                    <div>Progress: ${escapeHtml(String(task.progress))}%</div>
                </div>
            `
        });

        const completed = filteredTasks.filter((task) => task.progress >= 100).length;
        if (summaryNode) {
            summaryNode.textContent = `${filteredTasks.length} tasks • ${completed} done`;
        }
    };

    toolbar.querySelectorAll('[data-gantt-mode]').forEach((btn) => {
        btn.addEventListener('click', () => {
            toolbar.querySelectorAll('[data-gantt-mode]').forEach((node) => node.classList.remove('active'));
            btn.classList.add('active');
            renderGantt(btn.dataset.ganttMode || 'Week');
        });
    });

    ownerFilter?.addEventListener('change', () => {
        const activeMode = toolbar.querySelector('[data-gantt-mode].active')?.dataset.ganttMode || 'Week';
        renderGantt(activeMode);
    });

    statusFilter?.addEventListener('change', () => {
        const activeMode = toolbar.querySelector('[data-gantt-mode].active')?.dataset.ganttMode || 'Week';
        renderGantt(activeMode);
    });

    renderGantt('Week');
}

function renderTimelineView(dataset, options = {}) {
    const container = options.containerId ? document.getElementById(options.containerId) : document.getElementById('view-timeline');
    if (!container) return;
    container.className = 'view-container timeline-layout';
    container.innerHTML = '';

    if (!dataset.length) {
        container.innerHTML = '<div class="view-empty-state">No items available for timeline.</div>';
        return;
    }

    const timelineHost = document.createElement('div');
    timelineHost.className = 'timeline-host';
    const toolbar = document.createElement('div');
    toolbar.className = 'timeline-toolbar';
    toolbar.innerHTML = `
        <label class="table-pagination-label" for="timeline-group-by">Group</label>
        <select id="timeline-group-by" class="table-pagination-select">
            <option value="status">Status</option>
            <option value="category">Category</option>
            <option value="scope">Scope</option>
            <option value="owner">Owner</option>
        </select>
        <button type="button" class="compact-btn active" data-timeline-stack="on">Stack On</button>
        <button type="button" class="compact-btn" data-timeline-stack="off">Stack Off</button>
        <button type="button" class="compact-btn" data-timeline-nav="prev">Prev Range</button>
        <button type="button" class="compact-btn" data-timeline-nav="next">Next Range</button>
        <button type="button" class="compact-btn active" data-preset="7">7D</button>
        <button type="button" class="compact-btn" data-preset="30">30D</button>
        <button type="button" class="compact-btn" data-preset="90">90D</button>
        <button type="button" class="compact-btn" data-preset="180">6M</button>
        <button type="button" class="compact-btn" data-preset="fit">Fit</button>
    `;
    container.appendChild(toolbar);
    container.appendChild(timelineHost);

    if (!window.vis?.Timeline || !window.vis?.DataSet) {
        timelineHost.innerHTML = '<div class="view-empty-state">Timeline library not available.</div>';
        return;
    }

    const rows = dataset
        .map((row, index) => {
            const start = resolveFieldValue(row, ['start', 'date', 'due', 'publishedAt']);
            if (!start) return null;
            return {
                id: index + 1,
                content: escapeHtml(resolveFieldValue(row, ['title', 'name']) || `Item ${index + 1}`),
                start: String(start).split(' ')[0],
                status: resolveFieldValue(row, ['status']) || 'Items',
                category: resolveFieldValue(row, ['category']) || 'Items',
                scope: resolveFieldValue(row, ['scope']) || 'Items',
                owner: resolveFieldValue(row, ['owner']) || 'Items'
            };
        })
        .filter(Boolean);

    if (!rows.length) {
        timelineHost.innerHTML = '<div class="view-empty-state">Timeline requires date-like fields (start/date/due/publishedAt).</div>';
        return;
    }

    try {
        const itemTimes = rows
            .map((item) => new Date(item.start).getTime())
            .filter((value) => Number.isFinite(value));

        const minTime = Math.min(...itemTimes);
        const maxTime = Math.max(...itemTimes);
        const midpoint = new Date((minTime + maxTime) / 2);

        const buildByGroupField = (field) => {
            const preparedItems = rows.map((row) => ({
                id: row.id,
                content: row.content,
                start: row.start,
                group: String(row[field] || 'Items')
            }));
            const groupSet = new Map();
            preparedItems.forEach((item) => {
                if (!groupSet.has(item.group)) {
                    groupSet.set(item.group, { id: item.group, content: item.group });
                }
            });
            return {
                items: new window.vis.DataSet(preparedItems),
                groups: new window.vis.DataSet(Array.from(groupSet.values()))
            };
        };

        const groupSelect = toolbar.querySelector('#timeline-group-by');
        const activeField = groupSelect?.value || 'status';
        const source = buildByGroupField(activeField);

        timelineInstance = new window.vis.Timeline(timelineHost, source.items, source.groups, {
            stack: true,
            horizontalScroll: true,
            zoomKey: 'ctrlKey',
            zoomMin: 1000 * 60 * 60 * 24,
            zoomMax: 1000 * 60 * 60 * 24 * 365 * 2,
            margin: { item: 12, axis: 10 }
        });

        const applyPresetWindow = (preset) => {
            if (!timelineInstance) return;
            if (preset === 'fit') {
                timelineInstance.fit({ animation: true });
                return;
            }

            const days = Number(preset);
            if (!Number.isFinite(days) || days <= 0) return;
            const halfRange = (days * 24 * 60 * 60 * 1000) / 2;
            timelineInstance.setWindow(
                new Date(midpoint.getTime() - halfRange),
                new Date(midpoint.getTime() + halfRange),
                { animation: true }
            );
        };

        const shiftWindow = (direction) => {
            if (!timelineInstance) return;
            const range = timelineInstance.getWindow();
            const start = range.start.getTime();
            const end = range.end.getTime();
            const span = end - start;
            const shift = span * 0.8 * direction;
            timelineInstance.setWindow(new Date(start + shift), new Date(end + shift), { animation: true });
        };

        toolbar.querySelectorAll('[data-preset]').forEach((button) => {
            button.addEventListener('click', () => {
                toolbar.querySelectorAll('[data-preset]').forEach((node) => node.classList.remove('active'));
                button.classList.add('active');
                applyPresetWindow(button.dataset.preset);
            });
        });

        toolbar.querySelectorAll('[data-timeline-stack]').forEach((button) => {
            button.addEventListener('click', () => {
                toolbar.querySelectorAll('[data-timeline-stack]').forEach((node) => node.classList.remove('active'));
                button.classList.add('active');
                timelineInstance?.setOptions?.({ stack: button.dataset.timelineStack === 'on' });
            });
        });

        toolbar.querySelector('[data-timeline-nav="prev"]')?.addEventListener('click', () => shiftWindow(-1));
        toolbar.querySelector('[data-timeline-nav="next"]')?.addEventListener('click', () => shiftWindow(1));

        groupSelect?.addEventListener('change', () => {
            const selectedField = groupSelect.value || 'status';
            const next = buildByGroupField(selectedField);
            timelineInstance?.setData?.({ items: next.items, groups: next.groups });
            applyPresetWindow('30');
        });

        applyPresetWindow('7');
    } catch (error) {
        timelineHost.innerHTML = '<div class="view-empty-state">Timeline failed to render.</div>';
    }
}

function renderKanbanView(dataset, options = {}) {
    const container = options.containerId ? document.getElementById(options.containerId) : document.getElementById('view-kanban');
    if (!container) return;
    container.className = 'view-container kanban-layout';
    container.innerHTML = '';

    if (!dataset.length) {
        container.innerHTML = '<div class="view-empty-state">No items available for kanban.</div>';
        return;
    }

    const statuses = activeScopeConfig?.kanbanStatuses || ['idea', 'draft', 'review', 'published'];
    const scopeState = getKanbanScopeState(activeScope);
    const rowsWithMeta = dataset.map((row, index) => ({
        row,
        key: String(resolveFieldValue(row, ['id', 'ID']) || `${resolveFieldValue(row, ['title', 'name']) || 'item'}-${index}`)
    }));
    const normalizeStatus = (value) => String(value || '').trim().toLowerCase();
    const owners = Array.from(new Set(dataset.map((row) => resolveFieldValue(row, ['owner']) || '').filter(Boolean))).sort();
    const priorities = ['high', 'medium', 'low'];
    let ownerFilter = 'ALL';

    const toolbar = document.createElement('div');
    toolbar.className = 'kanban-toolbar';
    toolbar.innerHTML = `
        <label class="table-pagination-label" for="kanban-owner-filter">Owner</label>
        <select id="kanban-owner-filter" class="table-pagination-select">
            <option value="ALL">All</option>
            ${owners.map((owner) => `<option value="${escapeAttr(owner)}">${escapeHtml(owner)}</option>`).join('')}
        </select>
        <button type="button" class="compact-btn" data-kanban-action="expand">Expand all</button>
        <button type="button" class="compact-btn" data-kanban-action="collapse">Collapse all</button>
    `;
    const laneSnapBar = document.createElement('div');
    laneSnapBar.className = 'kanban-lane-snapbar';
    const board = document.createElement('div');
    board.className = 'kanban-board';

    const updateLaneCounts = () => {
        board.querySelectorAll('.kanban-lane').forEach((lane) => {
            const count = lane.querySelectorAll('.kanban-card').length;
            const countNode = lane.querySelector('.kanban-lane-count');
            if (countNode) countNode.textContent = String(count);
            lane.classList.toggle('kanban-lane-overflow', count > 7);
        });
    };

    const applyOwnerFilter = () => {
        board.querySelectorAll('.kanban-card').forEach((card) => {
            const owner = card.dataset.owner || '';
            const visible = ownerFilter === 'ALL' || owner === ownerFilter;
            card.style.display = visible ? '' : 'none';
        });
    };

    const persistKanbanState = () => {
        const nextOrderByStatus = {};
        board.querySelectorAll('.kanban-list').forEach((laneList) => {
            const status = laneList.dataset.status;
            nextOrderByStatus[status] = Array.from(laneList.querySelectorAll('.kanban-card')).map((card) => card.dataset.cardKey);
        });
        kanbanLayoutStateByScope[activeScope] = {
            orderByStatus: nextOrderByStatus,
            statusByCard: scopeState.statusByCard
        };
        saveKanbanLayoutStateToStorage();
    };

    statuses.forEach((status) => {
        const lane = document.createElement('section');
        lane.className = 'kanban-lane';
        lane.innerHTML = `
            <div class="kanban-lane-head">
                <h3 class="kanban-lane-title">${escapeHtml(status)}</h3>
                <div class="kanban-lane-head-right">
                    <span class="kanban-lane-count">0</span>
                    <button type="button" class="compact-btn kanban-lane-toggle" aria-label="Collapse lane">-</button>
                </div>
            </div>`;

        const list = document.createElement('div');
        list.className = 'kanban-list';
        list.dataset.status = status;

        const laneRows = rowsWithMeta.filter((item) => {
            const mappedStatus = scopeState.statusByCard[item.key];
            const effectiveStatus = mappedStatus || resolveFieldValue(item.row, ['status']);
            return normalizeStatus(effectiveStatus) === normalizeStatus(status);
        });

        const savedOrder = Array.isArray(scopeState.orderByStatus?.[status]) ? scopeState.orderByStatus[status] : [];
        if (savedOrder.length) {
            const orderMap = new Map(savedOrder.map((key, index) => [String(key), index]));
            laneRows.sort((left, right) => {
                const a = orderMap.has(left.key) ? orderMap.get(left.key) : Number.MAX_SAFE_INTEGER;
                const b = orderMap.has(right.key) ? orderMap.get(right.key) : Number.MAX_SAFE_INTEGER;
                if (a === b) return left.key.localeCompare(right.key);
                return a - b;
            });
        }

        laneRows.forEach((item) => {
                const row = item.row;
                const card = document.createElement('article');
                card.className = 'kanban-card';
                const priority = String(resolveFieldValue(row, ['priority']) || '').toLowerCase();
                const priorityClass = priorities.includes(priority) ? ` priority-${priority}` : '';
                card.dataset.owner = String(resolveFieldValue(row, ['owner']) || '');
                card.dataset.cardKey = item.key;
                card.innerHTML = `
                    <div class="kanban-card-top">
                        <div class="kanban-card-title">${escapeHtml(resolveFieldValue(row, ['title', 'name']) || 'Untitled')}</div>
                        ${priority ? `<span class="kanban-priority-chip${priorityClass}">${escapeHtml(priority)}</span>` : ''}
                    </div>
                    <div class="kanban-card-meta">${escapeHtml(resolveFieldValue(row, ['owner', 'category', 'scope']) || '')}</div>
                    <div class="kanban-card-meta">Due: ${escapeHtml(resolveFieldValue(row, ['due', 'start']) || '-')}</div>
                `;
                list.appendChild(card);
            });

        lane.appendChild(list);
        board.appendChild(lane);

        const snapButton = document.createElement('button');
        snapButton.type = 'button';
        snapButton.className = 'compact-btn';
        snapButton.textContent = status;
        snapButton.addEventListener('click', () => {
            lane.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        });
        laneSnapBar.appendChild(snapButton);

        lane.querySelector('.kanban-lane-toggle')?.addEventListener('click', (event) => {
            const button = event.currentTarget;
            const collapsed = lane.classList.toggle('kanban-lane-collapsed');
            button.textContent = collapsed ? '+' : '-';
        });

        if (window.Sortable) {
            new window.Sortable(list, {
                group: 'kanban-board',
                animation: 140,
                ghostClass: 'kanban-ghost',
                scroll: true,
                scrollSensitivity: 80,
                scrollSpeed: 14,
                onEnd: (event) => {
                    const movedCardKey = event.item?.dataset?.cardKey;
                    const targetStatus = event.to?.dataset?.status;
                    if (movedCardKey && targetStatus) {
                        scopeState.statusByCard[movedCardKey] = targetStatus;
                    }
                    const destinationLane = event.to?.closest?.('.kanban-lane');
                    if (destinationLane) {
                        destinationLane.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
                    }
                    persistKanbanState();
                    updateLaneCounts();
                    applyOwnerFilter();
                }
            });
        }
    });

    toolbar.querySelector('#kanban-owner-filter')?.addEventListener('change', (event) => {
        ownerFilter = event.target.value || 'ALL';
        applyOwnerFilter();
    });

    toolbar.querySelector('[data-kanban-action="expand"]')?.addEventListener('click', () => {
        board.querySelectorAll('.kanban-lane').forEach((lane) => lane.classList.remove('kanban-lane-collapsed'));
        board.querySelectorAll('.kanban-lane-toggle').forEach((button) => { button.textContent = '-'; });
    });

    toolbar.querySelector('[data-kanban-action="collapse"]')?.addEventListener('click', () => {
        board.querySelectorAll('.kanban-lane').forEach((lane) => lane.classList.add('kanban-lane-collapsed'));
        board.querySelectorAll('.kanban-lane-toggle').forEach((button) => { button.textContent = '+'; });
    });

    container.appendChild(toolbar);
    container.appendChild(laneSnapBar);
    container.appendChild(board);
    updateLaneCounts();
    applyOwnerFilter();
}

function renderChartsView(dataset, options = {}) {
    const container = options.containerId ? document.getElementById(options.containerId) : document.getElementById('view-charts');
    if (!container) return;
    container.className = 'view-container charts-layout';
    container.innerHTML = '';

    if (!dataset.length) {
        container.innerHTML = '<div class="view-empty-state">No metrics available for charts.</div>';
        return;
    }

    const host = document.createElement('div');
    host.className = 'charts-host';
    const toolbar = document.createElement('div');
    toolbar.className = 'charts-toolbar';
    toolbar.innerHTML = `
        <button type="button" class="compact-btn active" data-chart-type="bar">Bar</button>
        <button type="button" class="compact-btn" data-chart-type="line">Line</button>
        <button type="button" class="compact-btn" data-chart-action="toggle-order">Sort</button>
        <button type="button" class="compact-btn" data-chart-action="reset-zoom">Reset</button>
    `;
    container.appendChild(toolbar);
    container.appendChild(host);

    if (!window.echarts) {
        host.innerHTML = '<div class="view-empty-state">ECharts library not available.</div>';
        return;
    }

    const byCategory = {};
    dataset.forEach((row) => {
        const key = String(resolveFieldValue(row, ['category', 'scope']) || 'unknown');
        const value = Number(resolveFieldValue(row, ['views', 'count', 'value']) || 0);
        byCategory[key] = (byCategory[key] || 0) + value;
    });

    const labels = Object.keys(byCategory);
    const values = labels.map((label) => byCategory[label]);
    let chartType = 'bar';
    let isDescending = true;

    const getSeriesData = () => {
        const pairs = labels.map((label, index) => ({ label, value: values[index] }));
        pairs.sort((a, b) => (isDescending ? b.value - a.value : a.value - b.value));
        return {
            labels: pairs.map((pair) => pair.label),
            values: pairs.map((pair) => pair.value)
        };
    };

    const applyChart = (resetZoom = false) => {
        const ordered = getSeriesData();
        chartsInstance.setOption({
            tooltip: { trigger: 'axis' },
            xAxis: {
                type: 'category',
                data: ordered.labels,
                axisLabel: { interval: 0, rotate: ordered.labels.length > 5 ? 24 : 0 }
            },
            yAxis: { type: 'value' },
            dataZoom: [
                { type: 'inside', xAxisIndex: 0 },
                { type: 'slider', xAxisIndex: 0, height: 16, bottom: 10 }
            ],
            series: [{
                data: ordered.values,
                type: chartType,
                smooth: chartType === 'line',
                itemStyle: { borderRadius: chartType === 'bar' ? [6, 6, 0, 0] : 0 }
            }]
        }, true);

        if (resetZoom) {
            chartsInstance.dispatchAction({ type: 'dataZoom', start: 0, end: 100 });
        }
    };

    chartsInstance = window.echarts.init(host);
    applyChart(true);

    toolbar.querySelectorAll('[data-chart-type]').forEach((button) => {
        button.addEventListener('click', () => {
            chartType = button.dataset.chartType || 'bar';
            toolbar.querySelectorAll('[data-chart-type]').forEach((node) => node.classList.remove('active'));
            button.classList.add('active');
            applyChart();
        });
    });

    const actionButton = toolbar.querySelector('[data-chart-action="toggle-order"]');
    actionButton?.addEventListener('click', () => {
        isDescending = !isDescending;
        actionButton.classList.toggle('active', !isDescending);
        applyChart();
    });

    toolbar.querySelector('[data-chart-action="reset-zoom"]')?.addEventListener('click', () => {
        applyChart(true);
    });
}

function renderAdvancedTableView(dataset, options = {}) {
    const container = options.containerId ? document.getElementById(options.containerId) : document.getElementById('view-advanced-table');
    if (!container) return;
    container.className = 'view-container';
    container.innerHTML = '';

    if (!dataset.length) {
        container.innerHTML = '<div class="view-empty-state">No records available for advanced table.</div>';
        return;
    }

    if (!window.Tabulator) {
        container.innerHTML = '<div class="view-empty-state">Tabulator is not available. Falling back to standard table.</div>';
        renderTableView(dataset, { ...options, containerId: container.id });
        return;
    }

    const toolbar = document.createElement('div');
    toolbar.className = 'advanced-table-toolbar';
    toolbar.innerHTML = `
        <input type="search" class="table-pagination-select" data-advanced-search placeholder="Search table..." aria-label="Search advanced table" />
        <label class="table-pagination-label" for="advanced-group-by">Group</label>
        <select id="advanced-group-by" class="table-pagination-select" data-advanced-group></select>
        <button type="button" class="compact-btn active" data-advanced-layout="fit">Fit</button>
        <button type="button" class="compact-btn" data-advanced-layout="data">Fit Data</button>
        <button type="button" class="compact-btn" data-advanced-action="clear">Clear Filters</button>
        <button type="button" class="compact-btn" data-advanced-action="select-all">Select All</button>
        <button type="button" class="compact-btn" data-advanced-action="deselect-all">Deselect All</button>
        <button type="button" class="compact-btn" data-advanced-action="copy">Copy Selected</button>
        <button type="button" class="compact-btn" data-advanced-export="csv">CSV</button>
        <button type="button" class="compact-btn" data-advanced-export="json">JSON</button>
        <button type="button" class="compact-btn" data-advanced-export="xlsx">XLSX</button>
        <button type="button" class="compact-btn" data-advanced-export="html">HTML</button>
    `;
    container.appendChild(toolbar);

    const host = document.createElement('div');
    host.className = 'advanced-table-host advanced-table-scroll';
    container.appendChild(host);

    const normalizeCellValue = (value) => {
        if (value === null || value === undefined) return '';
        if (typeof value === 'number') return value;
        if (Array.isArray(value)) return value.join(', ');
        if (typeof value === 'object') return JSON.stringify(value);
        return String(value);
    };

    const maybeNumber = (value) => {
        if (typeof value === 'number') return value;
        if (typeof value !== 'string') return Number.NaN;
        const normalized = value.replace(/[, ]+/g, '');
        const parsed = Number(normalized);
        return Number.isFinite(parsed) ? parsed : Number.NaN;
    };

    const enrichedRows = dataset.map((row, index) => {
        const next = {};
        Object.entries(row || {}).forEach(([key, value]) => {
            next[key] = normalizeCellValue(value);
        });

        const views = Number(resolveFieldValue(row, ['views']) || 0);
        const saves = Number(resolveFieldValue(row, ['saves']) || 0);
        const shares = Number(resolveFieldValue(row, ['shares']) || 0);
        const bookings = Number(resolveFieldValue(row, ['bookings']) || 0);
        const engagement = views > 0 ? ((saves + shares) / views) * 100 : 0;
        const conversion = views > 0 ? (bookings / views) * 100 : 0;

        next._row = index + 1;
        next.engagementRate = Number(engagement.toFixed(2));
        next.conversionRate = Number(conversion.toFixed(2));
        next.totalActions = saves + shares + bookings;
        return next;
    });

    const columnKeys = Array.from(new Set(enrichedRows.flatMap((row) => Object.keys(row))));
    const dimensionFields = columnKeys.filter((key) => !key.startsWith('_'));
    const numericFields = columnKeys.filter((key) => {
        const samples = enrichedRows.slice(0, 60).map((row) => row[key]).filter((v) => v !== '' && v !== null && v !== undefined);
        if (!samples.length) return false;
        const score = samples.filter((value) => Number.isFinite(maybeNumber(value))).length / samples.length;
        return score >= 0.8;
    });
    const preferredGroupField = ['scope', 'category', 'channel', 'campaign', 'region', 'device'].find((field) => dimensionFields.includes(field)) || dimensionFields[0] || '';

    const groupSelect = toolbar.querySelector('[data-advanced-group]');
    if (groupSelect) {
        groupSelect.innerHTML = `<option value="">No grouping</option>${dimensionFields.map((field) => `<option value="${escapeAttr(field)}">${escapeHtml(field)}</option>`).join('')}`;
        groupSelect.value = preferredGroupField;
    }

    let layoutMode = 'fitDataTable';
    let groupField = preferredGroupField;
    let table = null;

    const searchInput = toolbar.querySelector('[data-advanced-search]');

    const getSearchQuery = () => String(searchInput?.value || '').trim().toLowerCase();

    const getFilteredRows = () => {
        const query = getSearchQuery();
        return enrichedRows.filter((row) => {
            if (!query) return true;
            return Object.values(row).some((value) => String(value ?? '').toLowerCase().includes(query));
        });
    };

    const columns = columnKeys
        .filter((key) => key !== '_row')
        .map((key) => {
            const samples = enrichedRows.slice(0, 50).map((row) => row[key]).filter((v) => v !== '' && v !== null && v !== undefined);
            const numericScore = samples.length
                ? samples.filter((value) => Number.isFinite(maybeNumber(value))).length / samples.length
                : 0;
            const isNumeric = numericScore >= 0.8;

            return {
                title: key,
                field: key,
                headerSort: true,
                headerFilter: true,
                sorter: isNumeric ? 'number' : 'string',
                hozAlign: isNumeric ? 'right' : 'left',
                formatter: isNumeric
                    ? (cell) => {
                        const value = maybeNumber(cell.getValue());
                        return Number.isFinite(value) ? String(value) : '';
                    }
                    : undefined,
                topCalc: isNumeric ? 'avg' : undefined,
                topCalcParams: isNumeric ? { precision: 2 } : undefined,
                topCalcFormatter: isNumeric
                    ? (cell) => {
                        const value = maybeNumber(cell.getValue());
                        return Number.isFinite(value) ? value.toFixed(2) : '';
                    }
                    : undefined
            };
        });

    const renderTable = () => {
        const currentRows = getFilteredRows();
        const tableData = currentRows.map((row, index) => ({
            ...row,
            _row: row._row || index + 1
        }));

        if (table) {
            try { table.destroy(); } catch (error) {}
            table = null;
            host.innerHTML = '';
        }

        try {
            table = new window.Tabulator(host, {
                data: tableData,
                columns,
                layout: layoutMode,
                groupBy: groupField || false,
                groupStartOpen: true,
                groupHeader: (value, count) => `${String(value)} (${count} ${count === 1 ? 'item' : 'items'})`,
                movableColumns: true,
                resizableColumns: true,
                selectableRows: true,
                clipboard: true,
                pagination: true,
                paginationSize: 20,
                paginationCounter: 'rows',
                paginationSizeSelector: [10, 20, 50, 100, true],
                responsiveLayout: false,
                columnCalcs: 'both'
            });
        } catch (error) {
            host.innerHTML = '<div class="view-empty-state">Advanced table failed to initialize. Try reloading the scope.</div>';
            return;
        }

        if (layoutMode === 'fitDataTable') {
            const tabulatorColumns = table.getColumns?.();
            if (Array.isArray(tabulatorColumns)) {
                tabulatorColumns.forEach((col) => {
                    if (typeof col?.fitToData === 'function') {
                        try { col.fitToData(); } catch (error) {}
                    }
                });
            }
        }

        toolbar.querySelector('[data-advanced-layout="fit"]')?.classList.toggle('active', layoutMode === 'fitColumns');
        toolbar.querySelector('[data-advanced-layout="data"]')?.classList.toggle('active', layoutMode === 'fitDataTable');
    };

    searchInput?.addEventListener('input', () => renderTable());

    groupSelect.addEventListener('change', () => {
        groupField = String(groupSelect.value || '').trim();
        renderTable();
    });

    toolbar.querySelector('[data-advanced-layout="fit"]')?.addEventListener('click', () => {
        layoutMode = 'fitColumns';
        renderTable();
    });

    toolbar.querySelector('[data-advanced-layout="data"]')?.addEventListener('click', () => {
        layoutMode = 'fitDataTable';
        renderTable();
    });

    toolbar.querySelector('[data-advanced-action="clear"]')?.addEventListener('click', () => {
        if (searchInput) searchInput.value = '';
        groupField = preferredGroupField;
        if (groupSelect) groupSelect.value = preferredGroupField;
        layoutMode = 'fitDataTable';
        renderTable();
    });

    toolbar.querySelector('[data-advanced-action="select-all"]')?.addEventListener('click', () => {
        table?.selectRow?.();
    });

    toolbar.querySelector('[data-advanced-action="deselect-all"]')?.addEventListener('click', () => {
        table?.deselectRow?.();
    });

    toolbar.querySelector('[data-advanced-action="copy"]')?.addEventListener('click', () => {
        table?.copyToClipboard?.('selected');
    });

    toolbar.querySelectorAll('[data-advanced-export]').forEach((button) => {
        button.addEventListener('click', () => {
            const format = button.dataset.advancedExport || 'csv';
            const fileName = `${activeScope}-advanced-table.${format === 'xlsx' ? 'xlsx' : format}`;
            if (format === 'html') {
                table?.download?.('html', fileName, { style: true });
                return;
            }
            table?.download?.(format, fileName);
        });
    });

    renderTable();
}

function mountCalendarGrid(dataset = null, options = {}) {
    const calEl = options.containerId ? document.getElementById(options.containerId) : document.getElementById('calendar-container');
    if (!calEl) return;
    const items = dataset || getFilteredRecords();

    const eventsPayload = items
        .map((item, index) => {
            if (!item.start) return null;
            return {
                id: String(index),
                title: item.title || item.name || 'Event',
                start: item.start.replace(' ', 'T'),
                end: item.end ? item.end.replace(' ', 'T') : null,
                extendedProps: {
                    subtitle: item.subtitle,
                    location: item.location,
                    room: item.room,
                    qr: item.qr_path,
                    poster: getImageFallback(item.posterpath || item.poster || 'event_placeholder.png', 'event_placeholder.png')
                }
            };
        })
        .filter(Boolean);

    if (!calendarInstance) {
        calendarInstance = new FullCalendar.Calendar(calEl, {
            initialView: currentCalendarViewMode,
            headerToolbar: { left: 'prev,next today', center: 'title', right: '' },
            events: eventsPayload,
            height: '100%',
            eventClick: (info) => {
                const p = info.event.extendedProps;
                triggerLightboxPopup(p.poster, info.event.title, `${p.subtitle || ''}\n${p.location || ''}${p.room ? ` (${p.room})` : ''}`);
            }
        });
        calendarInstance.render();
    } else {
        calendarInstance.removeAllEvents();
        calendarInstance.addEventSource(eventsPayload);
        calendarInstance.changeView(currentCalendarViewMode);
    }
    bindCalendarMonthNavigation();
    updateCalendarMonthPickerLabel();
    setTimeout(() => {
        if (calendarInstance) calendarInstance.updateSize();
    }, 100);
}

function switchCalendarViewMode(modeViewKey) {
    currentCalendarViewMode = modeViewKey;
    viewEnhancementState.calendarViewMode = modeViewKey;
    saveViewEnhancementStateToStorage();
    const monthBtn = document.getElementById('cal-mode-month');
    const weekBtn = document.getElementById('cal-mode-week');
    const listBtn = document.getElementById('cal-mode-list');
    if (monthBtn) monthBtn.classList.toggle('active', modeViewKey === 'dayGridMonth');
    if (weekBtn) weekBtn.classList.toggle('active', modeViewKey === 'timeGridWeek');
    if (listBtn) listBtn.classList.toggle('active', modeViewKey === 'listMonth');
    if (calendarInstance) {
        calendarInstance.changeView(modeViewKey);
    }
    updateCalendarMonthPickerLabel();
}

function updateCalendarMonthPickerLabel() {
    const pickerButton = document.getElementById('cal-month-picker');
    if (!pickerButton || !calendarInstance) return;
    const current = calendarInstance.getDate();
    pickerButton.textContent = new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric' }).format(current);

    const monthInput = document.getElementById('cal-picker-month-input');
    if (monthInput) {
        monthInput.value = `${String(current.getMonth() + 1).padStart(2, '0')}/${current.getFullYear()}`;
    }

    if (calendarMonthPickerInstance) {
        calendarMonthPickerInstance.setDate(new Date(current.getFullYear(), current.getMonth(), 1), false);
    }
}

function initializeCalendarMonthPicker(monthInput) {
    if (!monthInput || calendarMonthPickerInstance) return;
    if (!window.flatpickr || !window.monthSelectPlugin) return;

    calendarMonthPickerInstance = window.flatpickr(monthInput, {
        dateFormat: 'm/Y',
        plugins: [
            new window.monthSelectPlugin({
                shorthand: true,
                dateFormat: 'm/Y',
                altFormat: 'F Y'
            })
        ],
        allowInput: false,
        clickOpens: false,
        onChange: (selectedDates) => {
            if (!calendarInstance || !selectedDates?.length) return;
            const selected = selectedDates[0];
            calendarInstance.gotoDate(new Date(selected.getFullYear(), selected.getMonth(), 1));
            updateCalendarMonthPickerLabel();
        }
    });
}

function bindCalendarMonthNavigation() {
    const calendarContainer = document.getElementById('calendar-container');
    const pickerButton = document.getElementById('cal-month-picker');
    const monthInput = document.getElementById('cal-picker-month-input');
    if (!calendarContainer || !pickerButton || !monthInput) return;
    if (calendarContainer.dataset.monthNavInit === '1') return;

    initializeCalendarMonthPicker(monthInput);

    pickerButton.addEventListener('click', () => {
        updateCalendarMonthPickerLabel();
        if (calendarMonthPickerInstance) {
            calendarMonthPickerInstance.open();
            return;
        }
        monthInput.focus();
        if (typeof monthInput.showPicker === 'function') {
            monthInput.showPicker();
        }
    });

    monthInput.addEventListener('change', () => {
        if (calendarMonthPickerInstance) return;
        if (!calendarInstance) return;
        const [yearRaw, monthRaw] = String(monthInput.value || '').split('-');
        const year = Number(yearRaw);
        const month = Number(monthRaw);
        if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return;
        calendarInstance.gotoDate(new Date(year, month - 1, 1));
        updateCalendarMonthPickerLabel();
    });

    calendarContainer.dataset.monthNavInit = '1';
}

function initializeScrollTopButton() {
    const canvas = document.querySelector('.view-canvas');
    const button = document.getElementById('scroll-top-fab');
    if (!canvas || !button || button.dataset.init === '1') return;

    let scrollFadeTimer = null;
    const markScrolling = () => {
        button.classList.add('scrolling');
        clearTimeout(scrollFadeTimer);
        scrollFadeTimer = setTimeout(() => button.classList.remove('scrolling'), 700);
    };

    const syncButton = () => {
        const threshold = 260;
        const show = canvas.scrollTop > threshold;
        const nearBottom = canvas.scrollTop + canvas.clientHeight >= canvas.scrollHeight - 24;
        button.classList.toggle('visible', show);
        button.classList.toggle('at-bottom', nearBottom);
        if (show) markScrolling();
    };

    canvas.addEventListener('scroll', syncButton, { passive: true });
    button.addEventListener('click', () => {
        canvas.scrollTop = 0;
        syncButton();
    });
    button.dataset.init = '1';
    syncButton();
}

async function mountMapCoordinates(dataset = null, options = {}) {
    const mapContainer = options.containerId ? document.getElementById(options.containerId) : document.getElementById('map-container');
    if (!mapContainer) return;

    const mapView = document.getElementById('view-map');
    if (mapView && !mapView.querySelector('.map-toolbar')) {
        const toolbar = document.createElement('div');
        toolbar.className = 'map-toolbar';
        toolbar.innerHTML = `
            <button type="button" class="compact-btn" data-map-action="fit">Fit Markers</button>
            <button type="button" class="compact-btn" data-map-action="reset">Reset Area</button>
            <button type="button" class="compact-btn ${viewEnhancementState.mapAutoFit ? 'active' : ''}" data-map-action="autofit">Auto Fit</button>
        `;
        mapView.prepend(toolbar);

        toolbar.querySelector('[data-map-action="fit"]')?.addEventListener('click', () => {
            if (leafletMap && latestMapBounds?.isValid?.()) {
                leafletMap.fitBounds(latestMapBounds, { padding: [28, 28], maxZoom: 13 });
            }
        });

        toolbar.querySelector('[data-map-action="reset"]')?.addEventListener('click', () => {
            if (leafletMap) {
                leafletMap.setView([36.4349, 28.2175], 11, { animate: true });
            }
        });

        toolbar.querySelector('[data-map-action="autofit"]')?.addEventListener('click', (event) => {
            viewEnhancementState.mapAutoFit = !viewEnhancementState.mapAutoFit;
            saveViewEnhancementStateToStorage();
            event.currentTarget.classList.toggle('active', viewEnhancementState.mapAutoFit);
        });
    }

    if (!leafletMap) {
        leafletMap = L.map('map-container', { preferCanvas: true }).setView([36.4349, 28.2175], 11);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        }).addTo(leafletMap);
        if (typeof ResizeObserver !== 'undefined' && mapContainer && !mapContainer._leafletResizeObs) {
            const obs = new ResizeObserver(() => {
                if (leafletMap) leafletMap.invalidateSize({ animate: false });
            });
            obs.observe(mapContainer);
            mapContainer._leafletResizeObs = obs;
        }
    }
    requestAnimationFrame(() => {
        if (leafletMap) leafletMap.invalidateSize({ animate: false });
        setTimeout(() => {
            if (leafletMap) leafletMap.invalidateSize({ animate: false });
        }, 120);
    });

    if (mapClusterGroup) {
        leafletMap.removeLayer(mapClusterGroup);
        mapClusterGroup = null;
    }
    if (busClusterGroup) {
        leafletMap.removeLayer(busClusterGroup);
        busClusterGroup = null;
    }

    leafletMap.eachLayer((layer) => {
        if (layer.toGeoJSON && !layer.getMaxZoom) {
            leafletMap.removeLayer(layer);
        }
    });

    const markerStyle = getMapMarkerStyle(activeScope);
    const clusterOptions = getMapClusterOptions(activeScope);
    const clusterFactory = typeof L.markerClusterGroup === 'function' ? L.markerClusterGroup : null;
    const scopeClusterGroup = clusterFactory ? clusterFactory(clusterOptions) : null;
    mapClusterGroup = scopeClusterGroup;
    const markerBounds = L.latLngBounds([]);

    if (activeScope === 'bus_schedule') {
        busClusterGroup = scopeClusterGroup;
        try {
            const stations = dataProvider
                ? await dataProvider.getStationsData('src/data/bus_stations.json')
                : await (await fetch('src/data/bus_stations.json')).json();
            stations.forEach((station) => {
                const lat = parseFloat(station.lat || station.latitude);
                const lon = parseFloat(station.lon || station.longitude || station.lng);
                if (!isNaN(lat) && !isNaN(lon)) {
                    const popupHTML = `<strong>${escapeHtml(station.name || '')}</strong><br>Code: ${escapeHtml(station.code || '')}<br>Type: ${escapeHtml(station.type ? station.type.toUpperCase() : '')}`;
                    const circleMarker = L.circleMarker([lat, lon], {
                        radius: markerStyle.radius,
                        fillColor: markerStyle.fillColor,
                        color: '#ffffff',
                        weight: 2,
                        opacity: 1,
                        fillOpacity: 0.9
                    }).bindPopup(popupHTML);
                    if (busClusterGroup) {
                        busClusterGroup.addLayer(circleMarker);
                    } else {
                        circleMarker.addTo(leafletMap);
                    }
                    markerBounds.extend([lat, lon]);
                }
            });
            if (busClusterGroup) {
                leafletMap.addLayer(busClusterGroup);
            }
        } catch (e) {
            console.error('Cluster generation failed:', e);
        }
    } else {
        const points = dataset || activeDataset;
        points.forEach((point) => {
            const lat = parseFloat(getCoordinateValue(point, ['Latitude', 'latitude', 'lat'], null));
            const lng = parseFloat(getCoordinateValue(point, ['Longitude', 'longitude', 'lng', 'lon'], null));
            if (!isNaN(lat) && !isNaN(lng)) {
                const title = activeScope === 'contacts'
                    ? `${getDisplayName(point)}`
                    : activeScope === 'locations'
                        ? (point.name || point.title || 'Location Point')
                    : activeScope === 'hotels'
                        ? (point.name || point.NAMEEN || `Hotel ${point.ID || ''}`)
                    : (point.title || point.name || 'Location Point');
                const desc = activeScope === 'contacts'
                    ? (point.Company || point.JobTitle || '')
                    : activeScope === 'locations'
                        ? `${point.type || ''}${point.area ? ` • ${point.area}` : ''}`
                    : activeScope === 'hotels'
                        ? `${point.category || point.CATEG || ''}${point.city ? ` • ${point.city}` : ''}`
                    : (point.location || point.Company || '');
                const circleMarker = L.circleMarker([lat, lng], {
                    radius: markerStyle.radius,
                    fillColor: markerStyle.fillColor,
                    color: '#ffffff',
                    weight: 2,
                    opacity: 1,
                    fillOpacity: 0.9
                }).bindPopup(`<strong>${escapeHtml(title)}</strong><br>${escapeHtml(desc)}`);

                if (scopeClusterGroup) {
                    scopeClusterGroup.addLayer(circleMarker);
                } else {
                    circleMarker.addTo(leafletMap);
                }
                markerBounds.extend([lat, lng]);
            }
        });

        if (scopeClusterGroup) {
            leafletMap.addLayer(scopeClusterGroup);
        }
    }
    latestMapBounds = markerBounds;
    if (viewEnhancementState.mapAutoFit && markerBounds.isValid()) {
        leafletMap.fitBounds(markerBounds, { padding: [24, 24], maxZoom: 13 });
    }
    leafletMap.invalidateSize();
}


function resolveFieldValue(row, fieldSpec) {
    const candidates = getFieldCandidates(fieldSpec);
    for (const candidate of candidates) {
        if (!candidate) continue;
        if (row[candidate] !== undefined && row[candidate] !== null && row[candidate] !== '') {
            return row[candidate];
        }
    }
    return '';
}

function getCoordinateValue(row, fieldSpec, fallback = '') {
    const value = resolveFieldValue(row, fieldSpec);
    return value === '' ? fallback : value;
}

function getMapMarkerStyle(scopeKey) {
    switch (scopeKey) {
        case 'contacts':
            return { radius: 7, fillColor: '#0f766e' };
        case 'locations':
            return { radius: 7, fillColor: '#d97706' };
        case 'events':
            return { radius: 7, fillColor: '#be123c' };
        case 'bus_schedule':
            return { radius: 6, fillColor: '#2563eb' };
        case 'hotels':
            return { radius: 7, fillColor: '#0891b2' };
        default:
            return { radius: 7, fillColor: '#e11d48' };
    }
}

function getMapClusterOptions(scopeKey) {
    switch (scopeKey) {
        case 'contacts':
            return { maxClusterRadius: 48, showCoverageOnHover: false, spiderfyOnMaxZoom: true };
        case 'locations':
            return { maxClusterRadius: 52, showCoverageOnHover: false, spiderfyOnMaxZoom: true };
        case 'events':
            return { maxClusterRadius: 44, showCoverageOnHover: false, spiderfyOnMaxZoom: true };
        case 'bus_schedule':
            return { maxClusterRadius: 42, showCoverageOnHover: false, spiderfyOnMaxZoom: true };
        case 'hotels':
            return { maxClusterRadius: 46, showCoverageOnHover: false, spiderfyOnMaxZoom: true };
        default:
            return { maxClusterRadius: 46, showCoverageOnHover: false, spiderfyOnMaxZoom: true };
    }
}

function normalizeText(value) {
    return String(value || '').trim().toLowerCase();
}

function busDayMatchesSelection(rowDay, selected) {
    const row = normalizeText(rowDay);
    if (!row) return false;
    // East uses "All"; West uses "Mon-Fri" — filter chips say "Weekdays".
    if (row === 'all') return true;

    const sel = normalizeText(selected);
    if (!sel || sel === 'all') return true;

    const weekdayLabels = new Set(['weekdays', 'mon-fri', 'monday-friday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday']);
    const isWeekdayRow = weekdayLabels.has(row) || row === 'mon-sat';
    const isSaturdayRow = row === 'saturday' || row === 'mon-sat';
    const isSundayRow = row === 'sunday';

    if (sel === 'weekdays') return isWeekdayRow;
    if (sel === 'saturday') return isSaturdayRow;
    if (sel === 'sunday') return isSundayRow;
    return row === sel;
}

function rowMatchesWestPrintDay(rowDay, columnDay) {
    const row = normalizeText(rowDay);
    const col = normalizeText(columnDay);
    if (!row || row === 'all') return col === 'weekdays';
    if (col === 'weekdays') {
        return row !== 'saturday' && row !== 'sunday' && busDayMatchesSelection(rowDay, 'Weekdays');
    }
    if (col === 'saturday') return row === 'saturday';
    if (col === 'sunday') return row === 'sunday';
    return false;
}

function normalizeTimeList(source) {
    if (Array.isArray(source)) return source;
    if (typeof source === 'string') {
        try {
            const parsed = JSON.parse(source.replace(/'/g, '"'));
            return Array.isArray(parsed) ? parsed : parsed.split(',').map((item) => item.trim());
        } catch (e) {
            return source.split(',').map((item) => item.trim());
        }
    }
    return [];
}

function getDisplayName(row) {
    return `${row.FirstName || ''} ${row.LastName || ''}`.trim() || 'Unknown Contact';
}

function getImageFallback(value, fallback) {
    if (!value || String(value).trim() === '' || String(value).toLowerCase() === 'null') {
        return fallback;
    }
    return value;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escapeAttr(value) {
    return String(value ?? '').replace(/'/g, '&#39;').replace(/"/g, '&quot;');
}

function triggerLightboxPopup(path, name, typeLabel) {
    const target = document.getElementById('modal-body-target');
    if (!target) return;
    const safeCaption = escapeHtml(typeLabel).replace(/\n/g, '<br>');
    target.innerHTML = `
        <button class="close-modal" onclick="document.getElementById('lightbox').style.display='none'">&times;</button>
        <img src="${path || 'event_placeholder.png'}" class="qr-modal-graphic" alt="Spotlight Component Media Frame" onerror="this.onerror=null;this.src='event_placeholder.png';">
        <div class="qr-modal-headline">${escapeHtml(name)}</div>
        <div class="qr-modal-caption">${safeCaption}</div>
    `;
    document.getElementById('lightbox').style.display = 'flex';
}

function getActiveViewElement() {
    const el = document.getElementById(`view-${currentLayoutMode}`);
    if (!el) return null;
    const hidden = el.style.display === 'none' || window.getComputedStyle(el).display === 'none';
    return hidden ? null : el;
}

function flattenLiveMasonryLayout() {
    if (globalBusMasonryInstance) {
        try { globalBusMasonryInstance.destroy(); } catch (error) {}
        globalBusMasonryInstance = null;
    }
    document.querySelectorAll('.layout-masonry-buses .profile-card, .layout-masonry-buses').forEach((el) => {
        el.removeAttribute('style');
    });
}

function sanitizePrintClone(source) {
    const clone = source.cloneNode(true);
    clone.querySelectorAll(
        '.cards-view-toolbar, .cards-pagination-bar, .card-action-row, .calendar-toolbar-extension, .kanban-toolbar, .timeline-toolbar, .charts-toolbar, .flipbook-controls, .posters-toolbar, .table-view-toolbar, .advanced-table-toolbar, .map-toolbar, .cards-infinite-sentinel, .dashboard-composer-bar, .kanban-lane-snapbar, .scroll-top-fab'
    ).forEach((el) => el.remove());
    clone.querySelectorAll('.profile-card, .layout-masonry-buses, .layout-grid-flow').forEach((el) => {
        el.removeAttribute('style');
    });
    clone.classList.add('print-root');
    return clone;
}

function getPrintOrientation() {
    try {
        const raw = window.localStorage.getItem(STANDALONE_BUS_STATE_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        if (parsed?.printOrientation === 'portrait' || parsed?.printOrientation === 'landscape') {
            return parsed.printOrientation;
        }
    } catch (error) {
        /* ignore */
    }
    return 'landscape';
}

function setPrintOrientation(orientation) {
    const next = orientation === 'portrait' ? 'portrait' : 'landscape';
    try {
        const raw = window.localStorage.getItem(STANDALONE_BUS_STATE_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        parsed.printOrientation = next;
        window.localStorage.setItem(STANDALONE_BUS_STATE_KEY, JSON.stringify(parsed));
    } catch (error) {
        /* ignore */
    }
    syncPrintOrientationButtons();
    return next;
}

function syncPrintOrientationButtons() {
    const current = getPrintOrientation();
    document.querySelectorAll('[data-print-orient]').forEach((btn) => {
        const active = btn.getAttribute('data-print-orient') === current;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        btn.setAttribute('aria-checked', active ? 'true' : 'false');
    });
}

function getPrintPageMetrics(orientation = getPrintOrientation()) {
    const landscape = orientation !== 'portrait';
    return {
        orientation: landscape ? 'landscape' : 'portrait',
        pageSize: landscape ? 'A4 landscape' : 'A4 portrait',
        paperWidthMm: landscape ? 297 : 210,
        paperHeightMm: landscape ? 210 : 297,
        marginMm: 5,
        cardCols: landscape ? 4 : 3,
        // Grid columns — fill the full page width left→right (not CSS multi-column).
        eastCols: landscape ? 7 : 5,
        westInnerCols: landscape ? 2 : 2
    };
}

function getAppStylesheetHref() {
    const existing = document.querySelector('link[rel="stylesheet"][href*="styles.css"]');
    if (existing?.href) return existing.href;
    try {
        return new URL('src/css/styles.css', window.location.href).href;
    } catch (error) {
        return 'src/css/styles.css';
    }
}

function getBusTablePrintCss(metrics) {
    return `@page { size: ${metrics.pageSize}; margin: ${metrics.marginMm}mm; }
* { box-sizing: border-box; }
html, body {
  margin: 0; padding: 0; background: #fff; color: #0f172a;
  font-family: Arial, Helvetica, sans-serif; font-size: 7pt;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.tt-sheet { width: 100%; }
.tt-page {
  width: 100%;
  overflow: hidden;
  page-break-after: always;
  break-after: page;
}
.tt-page:last-child { page-break-after: auto; break-after: auto; }
.tt-page-inner { width: 100%; }
.tt-page-masthead {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  margin: 0 0 4px;
}
.tt-page-masthead .print-logo {
  display: block;
  width: 40px;
  height: 40px;
  object-fit: contain;
}
.print-brand { display: none; }
.bus-print-table-section { margin: 0; page-break-inside: avoid; }
.bus-print-table-band {
  margin: 0 0 4px;
  padding: 3px 8px;
  border-radius: 6px;
  font-size: 8pt;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  text-align: center;
  color: #fff;
  background: #2563eb;
}
.bus-print-table-band.east { background: #ea580c; }
.bus-print-table-band.west { background: #2563eb; }
.table-responsive-wrapper { overflow: visible; width: 100%; }
.flat-data-table.bus-print-table { width: 100%; border-collapse: collapse; table-layout: auto; }
.bus-print-table th.col-fit-cell,
.bus-print-table td.col-fit-cell { white-space: nowrap; width: 1%; }
.bus-print-table th.col-outbound,
.bus-print-table th.col-return { white-space: nowrap; }
.bus-print-table th.col-outbound,
.bus-print-table td.col-outbound,
.bus-print-table th.col-return,
.bus-print-table td.col-return { width: 50%; word-break: break-word; }
.flat-data-table th {
  background: #f1f5f9; color: #0f172a; font-weight: 700;
  padding: 3px 4px; border: 1px solid #cbd5e1; text-align: left;
}
.flat-data-table th.col-outbound { color: #1e40af; }
.flat-data-table th.col-return { color: #5b21b6; }
.flat-data-table td {
  padding: 3px 4px; border: 1px solid #e2e8f0; vertical-align: top;
  word-break: break-word; line-height: 1.25;
}
.flat-data-table tr:nth-child(even) td { background: #fafafa; }
.flat-data-table tr.bus-table-row td:first-child { border-left-width: 3px; border-left-style: solid; }
.flat-data-table tr.region-east td:first-child { border-left-color: #ea580c; }
.flat-data-table tr.region-west td:first-child { border-left-color: #2563eb; }
.flat-data-table tr.region-split-faliraki td:first-child {
  border-left-color: transparent;
  border-image: linear-gradient(180deg, #ea580c 0 50%, #2563eb 50% 100%) 1;
  border-left-width: 3px;
  border-left-style: solid;
}
.tt-empty { color: #94a3b8; font-size: 7pt; text-align: center; padding: 6px; }`;
}

function buildBusScheduleRegionTableSection(title, rows, bandClass, { includeStar = false } = {}) {
    const columns = (activeScopeConfig?.tableColumns || []).filter(
        (col) => !col.visibilityToggleId || !!fieldVisibility[col.visibilityToggleId]
    );
    if (!columns.length) return '';

    const starHeader = includeStar ? '<th class="col-star" aria-label="Starred">★</th>' : '';
    const headers = columns.map((column) => {
        const label = column.label || '';
        if (label === 'Outbound') return '<th class="col-outbound">Outbound</th>';
        if (label === 'Return') return '<th class="col-return">Return</th>';
        return `<th class="col-fit-cell">${escapeHtml(label)}</th>`;
    }).join('');

    if (!rows.length) {
        return `<section class="bus-print-table-section">
            <h2 class="bus-print-table-band ${escapeHtml(bandClass)}">${escapeHtml(title)}</h2>
            <div class="tt-empty">No routes</div>
        </section>`;
    }

    const body = rows.map((row) => {
        const rowClass = getBusTableRowClass(row);
        const starCell = includeStar
            ? `<td class="col-star">${renderBusFavButtonHtml(row)}</td>`
            : '';
        const cells = columns.map((column) => {
            const label = column.label || '';
            let cellClass = 'col-fit-cell';
            if (label === 'Outbound') cellClass = 'col-outbound';
            else if (label === 'Return') cellClass = 'col-return';
            const content = column.render ? column.render(row) : escapeHtml(String(row[column.field] || ''));
            return `<td class="${cellClass}">${content}</td>`;
        }).join('');
        return `<tr class="${escapeHtml(rowClass)}">${starCell}${cells}</tr>`;
    }).join('');

    return `<section class="bus-print-table-section">
        <h2 class="bus-print-table-band ${escapeHtml(bandClass)}">${escapeHtml(title)}</h2>
        <div class="table-responsive-wrapper">
            <table class="flat-data-table bus-print-table${includeStar ? ' has-star-col' : ''}">
                <thead><tr>${starHeader}${headers}</tr></thead>
                <tbody>${body}</tbody>
            </table>
        </div>
    </section>`;
}

function buildBusScheduleTablePrintBody(dataset) {
    return getBusScheduleTableSections(dataset)
        .map(({ title, bandClass, rows }) => buildBusScheduleRegionTableSection(title, rows, bandClass))
        .join('');
}

function buildPrintPageHtml(pageId, logoHtml, innerContent) {
    return `<section class="tt-page" data-tt-page="${escapeHtml(pageId)}">
<div class="tt-page-inner">
<div class="tt-page-masthead">${logoHtml}</div>
${innerContent}
</div>
</section>`;
}

function buildBusTablePrintHtml(dataset, orientation = getPrintOrientation()) {
    const metrics = getPrintPageMetrics(orientation);
    const sections = getBusScheduleTableSections(dataset);
    const pages = sections.map(({ title, bandClass, regionKey, rows }) => {
        const logo = regionKey === 'east'
            ? getPrintLogoHtml('EAST.png')
            : getPrintLogoHtml('WEST.png');
        const pageId = `${regionKey || 'other'}-${String(title).replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
        const tableHtml = buildBusScheduleRegionTableSection(title, rows, bandClass);
        return buildPrintPageHtml(pageId, logo, tableHtml);
    }).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>\u00A0</title>
<style>${getBusTablePrintCss(metrics)}</style>
</head>
<body>
<div class="tt-sheet">${pages || '<div class="tt-empty">No routes</div>'}</div>
</body>
</html>`;
}

function getCardsPrintCss(cardCount, metrics) {
    const cols = Math.max(2, Math.min(metrics.cardCols, Math.max(1, cardCount || 1)));
    return `@page { size: ${metrics.pageSize}; margin: ${metrics.marginMm}mm; }
* { box-sizing: border-box; }
html, body {
  margin: 0; padding: 0; background: #fff;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.print-doc-title { margin: 0 0 6px; font-size: 13px; font-weight: 800; }
.print-brand {
  display: flex;
  align-items: center;
  margin: 0 0 6px;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.print-brand .print-logo,
.print-logo {
  display: block;
  width: 32px;
  height: 32px;
  object-fit: contain;
}
.print-root,
.layout-masonry-buses.print-root,
.print-root.layout-masonry-buses {
  width: 100% !important;
  height: auto !important;
  position: static !important;
  display: grid !important;
  grid-template-columns: repeat(${cols}, minmax(0, 1fr));
  gap: 3mm;
  align-items: start;
}
.print-root .profile-card,
.layout-masonry-buses .profile-card {
  position: static !important;
  left: auto !important;
  top: auto !important;
  right: auto !important;
  bottom: auto !important;
  transform: none !important;
  display: block !important;
  width: 100% !important;
  max-width: 100% !important;
  margin: 0 !important;
  break-inside: avoid;
  page-break-inside: avoid;
  box-shadow: none !important;
}
.card-action-row,
.card-right-qr-wrapper,
.scroll-top-fab,
.schedule-label,
.bus-fav-btn { display: none !important; }
.schedule-direction {
  font-size: 4.8pt;
  font-weight: 700;
  letter-spacing: 0.02em;
  line-height: 1.15;
  margin-bottom: 2px;
}
.schedule-direction.dir-out { color: #1e40af; }
.schedule-direction.dir-in { color: #5b21b6; }
.schedule-pills { grid-template-columns: repeat(auto-fill, minmax(28px, 1fr)) !important; }
.bus-pill.passed-grey { opacity: 0.4; }
.profile-card.region-east::before { background: #ea580c !important; }
.profile-card.region-split-faliraki::before {
  background: linear-gradient(90deg, #ea580c 0 50%, #2563eb 50% 100%) !important;
}`;
}

function getFallbackPrintCss(cardCount, metrics) {
    const cols = Math.max(2, Math.min(metrics.cardCols + 1, Math.max(1, cardCount || 1)));
    return `@page { size: ${metrics.pageSize}; margin: ${metrics.marginMm}mm; }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { color: #0f172a; font-family: Arial, sans-serif; font-size: 8pt; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
h1 { margin: 0 0 4mm; font-size: 12pt; }
.print-root {
  width: 100%;
  display: grid;
  grid-template-columns: repeat(${cols}, minmax(0, 1fr));
  gap: 2.5mm;
  align-items: start;
}
.profile-card {
  break-inside: avoid; page-break-inside: avoid; display: block; width: 100%;
  margin: 0; padding: 5px; border: 1px solid #cbd5e1; border-radius: 8px;
  background: #fff; position: static !important;
}
.bus-header { display: flex; justify-content: space-between; gap: 4px; border-bottom: 1px solid #e2e8f0; padding-bottom: 3px; margin-bottom: 3px; }
.bus-route-title { font-size: 9pt; font-weight: 800; }
.bus-badge-row { display: flex; flex-wrap: wrap; gap: 2px; font-size: 6pt; color: #64748b; }
.bus-badge-row span { background: #f1f5f9; padding: 0 3px; border-radius: 2px; }
.bus-price-tag { background: #e6ffed; color: #1a7f37; font-weight: 700; padding: 1px 4px; border-radius: 3px; font-size: 7pt; }
.bus-schedule-block { background: #f8fafc; border: 1px solid #f1f5f9; border-radius: 4px; padding: 3px 4px; margin-bottom: 3px; }
.bus-schedule-block.inbound { background: #faf5ff; border-color: #f3e8ff; }
.schedule-label { font-size: 5.5pt; text-transform: uppercase; font-weight: 700; color: #64748b; margin-bottom: 2px; }
.schedule-pills { display: grid; grid-template-columns: repeat(auto-fill, minmax(28px, 1fr)); gap: 1px; }
.bus-pill { text-align: center; padding: 1px 0; border-radius: 2px; font-size: 6pt; font-weight: 600; background: #eff6ff; color: #1e40af; border: 1px solid #dbeafe; }
.bus-pill.inbound { background: #f5f3ff; color: #5b21b6; border-color: #ede9fe; }
.bus-pill.passed-grey { opacity: 0.4; }
.bus-comments { margin-top: 2px; font-size: 5pt; line-height: 1.25; color: #64748b; white-space: pre-line; }
.card-action-row, .card-right-qr-wrapper { display: none; }`;
}

function openPrintDocument(title, bodyHtml, cardCount, isTable, options = {}) {
    const metrics = getPrintPageMetrics(options.orientation || getPrintOrientation());
    const safeTitle = escapeHtml(title);
    const isBusTable = Boolean(options.isBusTable) && isTable;
    const useStyledCards = Boolean(options.styledCards) && !isTable;
    const styleHref = getAppStylesheetHref();
    const css = isBusTable
        ? getBusTablePrintCss(metrics)
        : useStyledCards
            ? getCardsPrintCss(cardCount, metrics)
            : getFallbackPrintCss(isTable ? 1 : cardCount, metrics);
    const linkedCss = useStyledCards
        ? `<link rel="stylesheet" href="${escapeHtml(styleHref)}" />`
        : '';

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${useStyledCards || window.__STANDALONE_BUS__ ? '\u00A0' : safeTitle}</title>
${linkedCss}
<style>${css}</style>
</head>
<body>
${window.__STANDALONE_BUS__ || useStyledCards
    ? `<div class="print-brand">${getPrintLogoHtml('LOGO.png')}</div>`
    : `<h1 class="print-doc-title">${safeTitle}</h1>`}
${bodyHtml}
</body>
</html>`;
    writePrintFrame(html, {
        waitForStyles: useStyledCards,
        waitForImages: Boolean(window.__STANDALONE_BUS__ || useStyledCards),
        fitSelector: options.fitSelector || null,
        orientation: options.orientation || getPrintOrientation()
    });
}

function writePrintFrame(html, options = {}) {
    let frame = document.getElementById('print-frame');
    if (!frame) {
        frame = document.createElement('iframe');
        frame.id = 'print-frame';
        frame.setAttribute('aria-hidden', 'true');
        document.body.appendChild(frame);
    }

    const metrics = getPrintPageMetrics(options.orientation || getPrintOrientation());
    const usableW = metrics.paperWidthMm - (2 * metrics.marginMm);
    const usableH = metrics.paperHeightMm - (2 * metrics.marginMm);
    const frameW = Math.max(320, Math.round((usableW * 96) / 25.4));
    const frameH = Math.max(320, Math.round((usableH * 96) / 25.4));
    frame.style.cssText = `position:fixed;left:-12000px;top:0;width:${frameW}px;height:${frameH}px;border:0;opacity:0;pointer-events:none;`;

    const frameWindow = frame.contentWindow;
    const doc = frame.contentDocument || frameWindow.document;
    doc.open();
    doc.write(html);
    doc.close();

    const delayMs = (options.waitForStyles || options.waitForImages) ? 200 : 80;
    const runPrint = () => {
        if (options.fitSelector) {
            fitPrintPagesInFrame(doc, options.fitSelector, options.orientation || getPrintOrientation());
        }
        frameWindow.focus();
        frameWindow.print();
    };

    const waitAssets = () => {
        const waits = [];
        if (options.waitForStyles) {
            [...doc.querySelectorAll('link[rel="stylesheet"]')].forEach((link) => {
                if (link.sheet) return;
                waits.push(new Promise((resolve) => {
                    link.addEventListener('load', resolve, { once: true });
                    link.addEventListener('error', resolve, { once: true });
                }));
            });
        }
        if (options.waitForImages) {
            [...doc.images].forEach((img) => {
                if (img.complete) return;
                waits.push(new Promise((resolve) => {
                    img.addEventListener('load', resolve, { once: true });
                    img.addEventListener('error', resolve, { once: true });
                }));
            });
        }
        Promise.all(waits).finally(() => setTimeout(runPrint, delayMs));
    };

    const kick = () => {
        if (!options.waitForStyles && !options.waitForImages) {
            setTimeout(runPrint, delayMs);
            return;
        }
        waitAssets();
    };

    if (doc.readyState === 'complete') kick();
    else frame.onload = kick;
}

function fitPrintPagesInFrame(doc, selector, orientation) {
    const metrics = getPrintPageMetrics(orientation);
    const pxPerMm = 96 / 25.4;
    const availW = Math.max(1, (metrics.paperWidthMm - (2 * metrics.marginMm)) * pxPerMm);
    const availH = Math.max(1, (metrics.paperHeightMm - (2 * metrics.marginMm)) * pxPerMm);
    const pages = [...doc.querySelectorAll(selector)];

    const measureScale = (inner) => Math.min(
        1,
        availW / Math.max(1, inner.scrollWidth),
        availH / Math.max(1, inner.scrollHeight)
    );

    const applyZoom = (inner, scale) => {
        if ('zoom' in inner.style) {
            inner.style.zoom = String(scale);
            inner.style.transform = 'none';
            inner.style.width = '100%';
        } else {
            inner.style.transformOrigin = 'top left';
            inner.style.transform = `scale(${scale})`;
            inner.style.width = `${100 / scale}%`;
        }
    };

    // Masonry = CSS columns. Pick column count that maximizes print scale (biggest cards that still fit).
    const optimizeMasonryPacks = (root, inner) => {
        const packs = [...root.querySelectorAll('.tt-pack')];
        if (!packs.length) return measureScale(inner);

        let bestScale = 0;
        let bestCols = metrics.eastCols;
        const minCols = 3;
        const maxCols = Math.max(minCols, metrics.orientation === 'landscape' ? 9 : 7);

        for (let cols = minCols; cols <= maxCols; cols++) {
            packs.forEach((pack) => {
                pack.style.columnCount = String(cols);
            });
            applyZoom(inner, 1);
            const scale = measureScale(inner);
            if (scale > bestScale + 0.002 || (Math.abs(scale - bestScale) <= 0.002 && cols < bestCols)) {
                bestScale = scale;
                bestCols = cols;
            }
        }

        packs.forEach((pack) => {
            pack.style.columnCount = String(bestCols);
        });
        return Math.max(0.22, bestScale);
    };

    pages.forEach((page, index) => {
        const inner = page.querySelector('.tt-page-inner') || page;
        inner.style.transform = 'none';
        if ('zoom' in inner.style) inner.style.zoom = '1';
        inner.style.width = '100%';

        page.style.cssText = '';
        page.style.boxSizing = 'border-box';
        page.style.width = '100%';
        page.style.height = `${availH}px`;
        page.style.overflow = 'hidden';
        page.style.pageBreakAfter = index === pages.length - 1 ? 'auto' : 'always';
        page.style.breakAfter = index === pages.length - 1 ? 'auto' : 'page';

        const westPacks = page.querySelectorAll('.tt-west-col .tt-pack');
        const tableSection = page.querySelector('.bus-print-table');
        const packs = page.querySelectorAll('.tt-pack');

        if (tableSection) {
            applyZoom(inner, Math.max(0.22, measureScale(inner)));
        } else if (westPacks.length) {
            let bestScale = 0;
            let bestInnerCols = 1;
            const maxInnerCols = metrics.orientation === 'landscape' ? 4 : 3;
            for (let cols = 1; cols <= maxInnerCols; cols++) {
                westPacks.forEach((pack) => {
                    pack.style.columnCount = String(cols);
                });
                applyZoom(inner, 1);
                const scale = measureScale(inner);
                if (scale > bestScale + 0.002) {
                    bestScale = scale;
                    bestInnerCols = cols;
                }
            }
            westPacks.forEach((pack) => {
                pack.style.columnCount = String(bestInnerCols);
            });
            applyZoom(inner, Math.max(0.22, bestScale));
        } else if (packs.length) {
            const scale = optimizeMasonryPacks(page, inner);
            applyZoom(inner, scale);
        } else {
            applyZoom(inner, Math.max(0.22, measureScale(inner)));
        }

        page.style.height = `${availH}px`;
        page.style.overflow = 'hidden';
    });

    if (doc.body) {
        doc.body.style.margin = '0';
        doc.body.style.padding = '0';
        doc.documentElement.style.margin = '0';
        doc.documentElement.style.padding = '0';
    }
}

function triggerBusTablePrint() {
    const rows = getBusPrintRecords();
    if (!rows.length) {
        alert('No schedule data to print.');
        return;
    }
    const orientation = getPrintOrientation();
    try {
        writePrintFrame(buildBusTablePrintHtml(rows, orientation), {
            fitSelector: '.tt-page',
            orientation,
            waitForImages: true
        });
    } catch (error) {
        alert(error.message || String(error));
    }
}

function triggerSystemPrint() {
    const title = document.getElementById('canvas-title')?.textContent || document.title;
    const isBusTable = activeScope === 'bus_schedule' && currentLayoutMode === 'table';
    const isBusCards = activeScope === 'bus_schedule' && currentLayoutMode === 'cards';

    try {
        let bodyHtml;
        let cardCount = 0;
        let isTable = isBusTable;

        if (isBusTable) {
            const orientation = getPrintOrientation();
            writePrintFrame(buildBusTablePrintHtml(getBusPrintRecords(), orientation), {
                fitSelector: '.tt-page',
                orientation,
                waitForImages: true
            });
            return;
        } else if (isBusCards) {
            flattenLiveMasonryLayout();
            const source = getActiveViewElement();
            if (!source) {
                alert('Nothing to print in the current view.');
                return;
            }
            const clone = sanitizePrintClone(source);
            bodyHtml = clone.outerHTML;
            cardCount = clone.querySelectorAll('.profile-card').length;
        } else {
            const source = getActiveViewElement();
            if (!source) {
                alert('Nothing to print in the current view.');
                return;
            }
            const clone = sanitizePrintClone(source);
            isTable = !!clone.querySelector('.flat-data-table');
            if (isTable) clone.classList.add('print-table-root');
            bodyHtml = clone.outerHTML;
            cardCount = clone.querySelectorAll('.profile-card').length;
        }

        openPrintDocument(title, bodyHtml, cardCount, isTable, {
            styledCards: isBusCards && !isTable,
            isBusTable,
            orientation: getPrintOrientation()
        });
        if (isBusCards) scheduleBusMasonryRelayout();
    } catch (error) {
        alert(error.message || String(error));
    }
}

function renderTimetablePills(times, inbound = false) {
    let list = normalizeTimeList(times);
    if (fieldVisibility['btn-rem']) {
        list = list.filter((time) => !isTimePassed(time));
    }
    if (!list.length) return '<div class="tt-empty-times">—</div>';
    return list.map((time) => {
        const passed = fieldVisibility['btn-grey'] && isTimePassed(time) ? ' passed-grey' : '';
        const kind = inbound ? ' inbound' : '';
        return `<span class="bus-pill${kind}${passed}">${escapeHtml(time)}</span>`;
    }).join('');
}

function renderTimetableMiniCard(row, { showDayTag = true } = {}) {
    const title = escapeHtml(row.to || 'Route');
    const day = String(row.day || '').trim();
    const dayLabel = formatBusDayLabel(day, row.region);
    const badges = showDayTag && dayLabel
        ? `<div class="bus-badge-row"><span>${escapeHtml(dayLabel)}</span></div>`
        : '';
    let outTimes = normalizeTimeList(row.timesOut || row.outbound || row.times || []);
    let backTimes = normalizeTimeList(row.timesBack || row.inbound || row.returns || []);
    if (fieldVisibility['btn-rem']) {
        outTimes = outTimes.filter((time) => !isTimePassed(time));
        backTimes = backTimes.filter((time) => !isTimePassed(time));
    }
    if (!outTimes.length && !backTimes.length) return '';

    const comments = String(row.comments || '').trim();
    const note = comments ? `<div class="bus-comments">${escapeHtml(comments)}</div>` : '';
    const price = row.price != null && String(row.price).trim() !== ''
        ? `<div class="bus-price-tag">${escapeHtml(String(row.price))}</div>`
        : '';

    const regionSlug = String(row.region || '').trim().toLowerCase().replace(/\s+/g, '-') || 'unknown';
    const splitFaliraki = String(row.to || '').trim().toLowerCase() === 'kalithea-faliraki';
    const cardClass = [
        'tt-print-card',
        `region-${regionSlug}`,
        splitFaliraki ? 'region-split-faliraki' : ''
    ].filter(Boolean).join(' ');

    return `<article class="${cardClass}">
      <div class="bus-header">
        <div>
          <div class="bus-route-title">${title}</div>
          ${badges}
        </div>
        ${price}
      </div>
      ${outTimes.length ? `
      <div class="bus-schedule-block">
        <div class="schedule-direction dir-out">${BUS_OUTBOUND_LABEL}</div>
        <div class="schedule-pills">${renderTimetablePills(outTimes, false)}</div>
      </div>` : ''}
      ${backTimes.length ? `
      <div class="bus-schedule-block inbound">
        <div class="schedule-direction dir-in">${BUS_RETURN_LABEL}</div>
        <div class="schedule-pills">${renderTimetablePills(backTimes, true)}</div>
      </div>` : ''}
      ${note}
    </article>`;
}

function getTimetablePrintCss(metrics) {
    // Self-contained styles (do NOT link app styles.css — its @page { margin: 10mm }
    // fights full-bleed page boxes and creates blank overflow pages).
    return `@page { size: ${metrics.pageSize}; margin: ${metrics.marginMm}mm; }
* { box-sizing: border-box; }
html, body {
  margin: 0; padding: 0; background: #fff; color: #0f172a;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
  font-family: Arial, Helvetica, sans-serif;
}
.tt-sheet { width: 100%; }
.tt-page {
  width: 100%;
  overflow: hidden;
  page-break-after: always;
  break-after: page;
}
.tt-page:last-child { page-break-after: auto; break-after: auto; }
.tt-page-inner { width: 100%; }
.tt-band-title {
  background: #1e3a8a;
  color: #fff;
  border-radius: 6px;
  padding: 4px 8px;
  font-size: 11pt;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin: 0 0 5px;
  text-align: center;
}
.tt-band-title.tt-band-east {
  background: #ea580c;
}
.tt-page-masthead {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  margin: 0 0 4px;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.tt-page-masthead .print-logo {
  display: block;
  width: 40px;
  height: 40px;
  object-fit: contain;
}
.tt-print-card .schedule-direction {
  font-size: 4.6pt;
  font-weight: 700;
  letter-spacing: 0.02em;
  line-height: 1.15;
  margin-bottom: 2px;
}
.tt-print-card .schedule-direction.dir-out { color: #1e40af; }
.tt-print-card .schedule-direction.dir-in { color: #5b21b6; }
.tt-pack {
  width: 100%;
  column-count: ${metrics.eastCols};
  column-gap: 5px;
  column-fill: balance;
}
.tt-east-groups { width: 100%; }
.tt-day-group { margin: 0 0 6px; }
.tt-day-group .tt-band-title { margin-bottom: 3px; }
.tt-west-wrap {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
  width: 100%;
  align-items: start;
}
.tt-west-col { min-width: 0; width: 100%; }
.tt-west-col .tt-pack {
  column-count: ${metrics.westInnerCols};
  column-fill: balance;
}
.tt-print-card {
  position: relative;
  display: inline-block;
  width: 100%;
  min-width: 0;
  margin: 0 0 5px;
  padding: 6px;
  border-radius: 8px;
  border: 1px solid #cbd5e1;
  background: #fff;
  overflow: hidden;
  break-inside: avoid;
  page-break-inside: avoid;
}
.tt-print-card::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 3px;
  background: #2563eb;
}
.tt-print-card.region-east::before {
  background: #ea580c;
}
.tt-print-card.region-split-faliraki::before {
  background: linear-gradient(90deg, #ea580c 0 50%, #2563eb 50% 100%);
}
.tt-print-card .bus-header {
  display: flex; justify-content: space-between; gap: 4px; align-items: flex-start;
  border-bottom: 1px solid #e2e8f0; padding: 0 0 4px; margin-bottom: 4px;
}
.tt-print-card .bus-route-title { font-size: 8pt; font-weight: 800; color: #0f172a; line-height: 1.15; }
.tt-print-card .bus-badge-row { display: flex; flex-wrap: wrap; gap: 2px; margin-top: 2px; }
.tt-print-card .bus-badge-row span {
  background: #f1f5f9; color: #64748b; font-size: 5.5pt; font-weight: 600;
  padding: 0 3px; border-radius: 2px;
}
.tt-print-card .bus-price-tag {
  background: #e6ffed; color: #1a7f37; font-weight: 700; font-size: 6.5pt;
  padding: 1px 4px; border-radius: 3px; white-space: nowrap;
}
.tt-print-card .bus-schedule-block {
  background: #f8fafc; border: 1px solid #f1f5f9; border-radius: 5px;
  padding: 3px 4px; margin-bottom: 3px;
}
.tt-print-card .bus-schedule-block.inbound { background: #faf5ff; border-color: #f3e8ff; }
.tt-print-card .schedule-pills {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(22px, 1fr));
  gap: 2px;
}
.tt-print-card .bus-pill {
  text-align: center; padding: 1px 0; border-radius: 2px; font-size: 5.5pt; font-weight: 600;
  background: #eff6ff; color: #1e40af; border: 1px solid #dbeafe;
}
.tt-print-card .bus-pill.inbound { background: #f5f3ff; color: #5b21b6; border-color: #ede9fe; }
.tt-print-card .bus-pill.passed-grey { background: #e2e8f0; color: #94a3b8; border-color: #e2e8f0; }
.tt-print-card .bus-comments {
  font-size: 4.5pt; line-height: 1.2; color: #64748b; margin-top: 2px; padding-top: 2px;
  border-top: 1px dashed #e2e8f0; font-style: italic; white-space: pre-line;
}
.tt-empty, .tt-empty-times { color: #94a3b8; font-size: 7pt; }
.tt-meta { margin-top: 4px; font-size: 6pt; color: #64748b; }
.print-brand { display: none; }
.print-logo { display: block; object-fit: contain; }`;
}

function buildTimetablePrintHtml(dataset, orientation = getPrintOrientation()) {
    const metrics = getPrintPageMetrics(orientation);
    const rows = Array.isArray(dataset) ? sortBusScheduleRows(dataset.slice()) : [];
    const byRegion = (region) => rows.filter((row) => normalizeText(row.region) === region);

    const eastLogo = getPrintLogoHtml('EAST.png');
    const westLogo = getPrintLogoHtml('WEST.png');

    const eastSections = getBusScheduleTableSections(byRegion('east'));
    const eastPages = eastSections.length
        ? eastSections.map(({ title, rows: sectionRows }) => {
            const cards = sectionRows.map((row) => renderTimetableMiniCard(row, { showDayTag: true })).filter(Boolean).join('');
            const body = `<div class="tt-band-title tt-band-east">${escapeHtml(title)}</div><div class="tt-pack">${cards || '<div class="tt-empty">No routes</div>'}</div>`;
            const pageId = `east-${String(title).replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
            return buildPrintPageHtml(pageId, eastLogo, body);
        }).join('')
        : buildPrintPageHtml('east-empty', eastLogo, '<div class="tt-empty">No East routes</div>');

    const west = byRegion('west');
    const westDayColumns = [
        { label: 'Mon–Fri', key: 'Weekdays' },
        { label: 'Saturday', key: 'Saturday' },
        { label: 'Sunday', key: 'Sunday' }
    ].filter(({ key }) => west.some((row) => rowMatchesWestPrintDay(row.day, key)));

    const westPages = westDayColumns.map(({ label, key }) => {
        const dayRows = sortBusScheduleRowsWithinBand(west.filter((row) => rowMatchesWestPrintDay(row.day, key)));
        const cards = dayRows.map((row) => renderTimetableMiniCard(row, { showDayTag: false })).filter(Boolean).join('');
        const body = `<div class="tt-band-title">West · ${escapeHtml(label)}</div><div class="tt-pack">${cards || '<div class="tt-empty">No routes</div>'}</div>`;
        return buildPrintPageHtml(`west-${String(key).toLowerCase()}`, westLogo, body);
    }).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>\u00A0</title>
<style>${getTimetablePrintCss(metrics)}</style>
</head>
<body>
<div class="tt-sheet">${eastPages}${westPages}</div>
</body>
</html>`;
}

function triggerTimetablePrint() {
    const rows = getTimetablePrintRecords();
    if (!rows.length) {
        alert('No schedule data loaded to print.');
        return;
    }
    const orientation = getPrintOrientation();
    try {
        writePrintFrame(buildTimetablePrintHtml(rows, orientation), {
            fitSelector: '.tt-page',
            orientation,
            waitForImages: true
        });
    } catch (error) {
        alert(error.message || String(error));
    }
}

function runStandalonePrint(mode) {
    const nextMode = mode === 'cards' ? 'cards' : 'table';
    if (window.__STANDALONE_BUS__) {
        try {
            const raw = window.localStorage.getItem(STANDALONE_BUS_STATE_KEY);
            const parsed = raw ? JSON.parse(raw) : {};
            parsed.printMode = nextMode;
            window.localStorage.setItem(STANDALONE_BUS_STATE_KEY, JSON.stringify(parsed));
        } catch (error) {
            /* ignore */
        }
    }
    if (nextMode === 'cards') triggerTimetablePrint();
    else triggerBusTablePrint();
}

function positionStandalonePrintMenu(trigger, menu) {
    const margin = 8;
    const rect = trigger.getBoundingClientRect();
    const menuWidth = Math.min(188, window.innerWidth - margin * 2);
    const centerHorizontally = window.innerWidth <= 768;

    menu.style.position = 'fixed';
    menu.style.zIndex = '120';
    menu.style.width = `${menuWidth}px`;
    menu.style.maxWidth = `calc(100vw - ${margin * 2}px)`;
    menu.style.bottom = 'auto';

    if (centerHorizontally) {
        menu.style.left = `${Math.max(margin, (window.innerWidth - menuWidth) / 2)}px`;
        menu.style.right = 'auto';
    } else {
        menu.style.left = 'auto';
        menu.style.right = `${Math.max(margin, window.innerWidth - rect.right)}px`;
    }

    const wasHidden = menu.hidden;
    menu.hidden = false;
    menu.style.visibility = 'hidden';
    menu.style.display = 'block';
    const menuHeight = menu.offsetHeight;
    menu.style.visibility = '';
    menu.hidden = wasHidden;
    if (wasHidden) menu.style.display = '';

    const spaceBelow = window.innerHeight - rect.bottom - margin;
    const spaceAbove = rect.top - margin;
    if (spaceBelow >= menuHeight + 4 || spaceBelow >= spaceAbove) {
        menu.style.top = `${rect.bottom + 4}px`;
    } else {
        menu.style.top = `${Math.max(margin, rect.top - menuHeight - 4)}px`;
    }
}

function resetStandalonePrintMenuPosition(menu) {
    menu.style.position = '';
    menu.style.top = '';
    menu.style.right = '';
    menu.style.left = '';
    menu.style.bottom = '';
    menu.style.width = '';
    menu.style.maxWidth = '';
    menu.style.zIndex = '';
    menu.style.visibility = '';
    menu.style.display = '';
}

function wireStandalonePrintMenu() {
    const trigger = document.getElementById('master-print');
    const menu = document.getElementById('print-menu-list');
    if (!trigger || !menu) return;

    const closeMenu = () => {
        menu.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
        resetStandalonePrintMenuPosition(menu);
    };

    const openMenu = () => {
        positionStandalonePrintMenu(trigger, menu);
        menu.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
    };

    syncPrintOrientationButtons();

    document.querySelectorAll('[data-print-orient]').forEach((item) => {
        item.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            setPrintOrientation(item.getAttribute('data-print-orient') || 'landscape');
        });
    });

    trigger.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (menu.hidden) openMenu();
        else closeMenu();
    });

    menu.querySelectorAll('[data-print-mode]').forEach((item) => {
        item.addEventListener('click', (event) => {
            event.preventDefault();
            const mode = item.getAttribute('data-print-mode') || 'table';
            closeMenu();
            runStandalonePrint(mode);
        });
    });

    document.addEventListener('click', (event) => {
        if (!menu.hidden && !event.target.closest('.print-menu')) {
            closeMenu();
        }
    });

    window.addEventListener('resize', () => {
        if (!menu.hidden) positionStandalonePrintMenu(trigger, menu);
    });

    document.querySelector('.view-canvas')?.addEventListener('scroll', () => {
        if (!menu.hidden) closeMenu();
    }, { passive: true });
}

function closeModalEngine(event) { if (event.target.id === 'lightbox') document.getElementById('lightbox').style.display = 'none'; }

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        const appVer = document.querySelector('meta[name="app-version"]')?.content || '1';
        const swUrl = `./service-worker.js?app=${encodeURIComponent(appVer)}`;
        navigator.serviceWorker.register(swUrl).catch((err) => {
            console.error('Service worker registration failed:', err);
        });
    });
}

document.addEventListener('DOMContentLoaded', bootApp);

window.setTablePageSize = setTablePageSize;
window.setTablePage = setTablePage;
window.setCardsPageSize = setCardsPageSize;
window.loadMoreCards = loadMoreCards;
window.setCardsInteriorMode = setCardsInteriorMode;
window.setCardsMaxColumns = setCardsMaxColumns;
window.setCardsLabelLayout = setCardsLabelLayout;
window.openLinkedContactById = openLinkedContactById;
window.openEventsForArtistName = openEventsForArtistName;
window.openLocationsForId = openLocationsForId;
window.openContactsForLocationId = openContactsForLocationId;
window.setScopeFilterValue = setScopeFilterValue;
window.toggleBusRouteStar = toggleBusRouteStar;
window.clearStarredBusRoutes = clearStarredBusRoutes;
window.handleSearchInput = handleSearchInput;
window.clearSearchQuery = clearSearchQuery;
window.syncSearchClearButton = syncSearchClearButton;
window.saveStandaloneBusState = saveStandaloneBusState;
window.openBookingAdminPanel = openBookingAdminPanel;
window.closeBookingAdminPanel = closeBookingAdminPanel;
window.closeBookingRequestModal = closeBookingRequestModal;
window.triggerSystemPrint = triggerSystemPrint;
window.triggerBusTablePrint = triggerBusTablePrint;
window.triggerTimetablePrint = triggerTimetablePrint;
window.runStandalonePrint = runStandalonePrint;