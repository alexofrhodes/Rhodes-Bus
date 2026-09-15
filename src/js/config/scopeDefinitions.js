(function (global) {
    function createScopeDefinitions(deps) {
        const {
            escapeHtml,
            normalizeTimeList,
            formatBusDayLabel,
            formatBusScheduleTimesCell
        } = deps;

        return {
            bus_schedule: {
                id: 'bus_schedule',
                title: 'Transit Schedules',
                file: 'src/data/bus_schedule.json',
                layouts: ['cards', 'table', 'map'],
                cardPagination: {
                    enabled: false,
                    mode: 'load-more',
                    pageSize: 30
                },
                tablePagination: {
                    enabled: false
                },
                cardsLayoutDefaults: { interior: 'horizontal', label: 'stack', maxColumns: 'auto' },
                railsLayoutDefaults: { interior: 'horizontal', label: 'stack' },
                railPreviewLimit: 6,
                railMoreAction: { type: 'scope', scopeKey: 'bus_schedule', layout: 'cards' },
                defaultLayout: 'cards',
                showInlineFilters: true,
                showSidebarFilters: false,
                schemaAliases: {
                    from: ['origin', 'departure'],
                    to: ['destination', 'arrival'],
                    price: [],
                    region: [],
                    day: ['DayOfWeek', 'weekday'],
                    timesOut: ['outbound', 'times'],
                    timesBack: ['inbound', 'returns'],
                    comments: ['notes', 'remark']
                },
                filters: [
                    { id: 'region', label: 'Region', field: ['region', 'Region'] },
                    { id: 'day', label: 'Schedule Day', field: ['day', 'Day'], special: 'busDay' },
                    { id: 'starred', label: 'Starred', special: 'busStarred' }
                ],
                headerControls: [
                    { id: 'btn-rem', label: 'Hide Passed', type: 'toggle', defaultOn: false },
                    { id: 'btn-grey', label: 'Grey Passed', type: 'toggle', defaultOn: true },
                    { id: 'btn-hide-sparse-west', label: 'Hide sparse West', type: 'toggle', defaultOn: false },
                    { id: 'btn-hide-empty-dest', label: 'Hide empty', type: 'toggle', defaultOn: true },
                    { id: 'time-filter-start', label: 'Window Start', type: 'time', operator: 'window' },
                    { id: 'time-filter-end', label: 'Window End', type: 'time', operator: 'window' },
                    { id: 'clear-bus-times', label: '×', type: 'clearBtn', onClick: 'clearBusTimeFilters' }
                ],
                searchFields: ['from', 'to', 'comments'],
                tableColumns: [
                    { id: 'destination', label: 'Destination', render: (row) => `<strong>${escapeHtml(row.to || 'Route')}</strong>` },
                    { id: 'day', label: 'Day', render: (row) => escapeHtml(formatBusDayLabel(row.day, row.region)) },
                    {
                        id: 'outbound',
                        label: 'Outbound',
                        render: (row) => formatBusScheduleTimesCell(row.timesOut || row.outbound || row.times || [])
                    },
                    {
                        id: 'return',
                        label: 'Return',
                        render: (row) => formatBusScheduleTimesCell(row.timesBack || row.inbound || row.returns || [], { inbound: true })
                    },
                    { id: 'distance', label: 'Distance', render: (row) => (row.km != null && row.km !== '' && Number(row.km) > 0 ? escapeHtml(`~${row.km} km`) : '') },
                    { id: 'est_time', label: 'Est. time', render: (row) => (row.minutes != null && row.minutes !== '' && Number(row.minutes) > 0 ? escapeHtml(`~${row.minutes} min`) : '') },
                    { id: 'price', label: 'Price', render: (row) => {
                        const raw = String(row.price ?? '').trim().replace(/^€\s*/, '').replace(',', '.');
                        if (!raw) return '';
                        const n = Number(raw);
                        if (Number.isFinite(n) && n <= 0) return '';
                        return escapeHtml(`€${row.price || raw}`);
                    } },
                    { id: 'notes', label: 'Notes', render: (row) => escapeHtml(row.comments || '').replace(/\n/g, '<br>') },
                ],
                locationFields: []
            }
        };
    }

    global.ScopeDefinitionsFactory = {
        create: createScopeDefinitions
    };
})(window);
