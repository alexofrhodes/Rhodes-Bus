(function (global) {
    function createScopeDefinitions(deps) {
        const {
            escapeHtml,
            normalizeTimeList,
            formatBusDayLabel
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
                    { id: 'time-filter-start', label: 'Window Start', type: 'time', operator: 'window' },
                    { id: 'time-filter-end', label: 'Window End', type: 'time', operator: 'window' },
                    { id: 'clear-bus-times', label: '×', type: 'clearBtn', onClick: 'clearBusTimeFilters' }
                ],
                searchFields: ['from', 'to', 'comments'],
                tableColumns: [
                    { label: 'Destination', render: (row) => `<strong>${escapeHtml(row.to || 'Route')}</strong>` },
                    { label: 'Day', render: (row) => escapeHtml(formatBusDayLabel(row.day, row.region)) },
                    { label: 'Outbound', render: (row) => escapeHtml(normalizeTimeList(row.timesOut || row.outbound || row.times || []).join(' ')) },
                    { label: 'Return', render: (row) => escapeHtml(normalizeTimeList(row.timesBack || row.inbound || row.returns || []).join(' ')) },
                    { label: 'Price', render: (row) => escapeHtml(`€${row.price || '0.00'}`) },
                    { label: 'Notes', render: (row) => escapeHtml(row.comments || '').replace(/\n/g, '<br>') },
                ],
                locationFields: []
            }
        };
    }

    global.ScopeDefinitionsFactory = {
        create: createScopeDefinitions
    };
})(window);
