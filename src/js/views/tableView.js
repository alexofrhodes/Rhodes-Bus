(function (global) {
    global.ViewModules = global.ViewModules || {};

    function renderTableView(dataset, context) {
        const {
            activeScopeConfig,
            fieldVisibility,
            escapeHtml,
            resolveFieldValue,
            pagination,
            containerId = 'view-table'
        } = context;

        const container = document.getElementById(containerId);
        if (!container) return;

        container.className = 'view-container';
        container.innerHTML = '';

        if (!dataset.length) {
            container.innerHTML = '<div class="view-empty-state">No entries match the current filters.</div>';
            return;
        }

        const columns = (activeScopeConfig.tableColumns || []).filter(
            (col) => !col.visibilityToggleId || !!fieldVisibility[col.visibilityToggleId]
        );
        if (!columns.length) {
            container.innerHTML = '<div class="view-empty-state">No table mapping is configured for this scope.</div>';
            return;
        }

        const paginatedDataset = pagination?.enabled && pagination.items
            ? dataset.slice(pagination.items.startIndex, pagination.items.endIndex)
            : dataset;

        const headers = columns.map((column) => {
            const label = column.label || '';
            if (label === 'Outbound') return '<th class="col-outbound">Outbound</th>';
            if (label === 'Return') return '<th class="col-return">Return</th>';
            return `<th class="col-fit-cell">${escapeHtml(label)}</th>`;
        }).join('');
        const body = paginatedDataset.map((row) => {
            const rowClass = typeof context.rowClass === 'function' ? String(context.rowClass(row) || '').trim() : '';
            const safeClass = rowClass ? escapeHtml(rowClass) : '';
            const cells = columns.map((column) => {
                const label = column.label || '';
                let cellClass = 'col-fit-cell';
                if (label === 'Outbound') cellClass = 'col-outbound';
                else if (label === 'Return') cellClass = 'col-return';
                const content = column.render ? column.render(row) : escapeHtml(resolveFieldValue(row, column.field));
                return `<td class="${cellClass}">${content}</td>`;
            }).join('');
            return `<tr${safeClass ? ` class="${safeClass}"` : ''}>${cells}</tr>`;
        }).join('');

        const paginationControls = pagination?.enabled ? `
        <div class="table-pagination-bar">
            <div class="table-pagination-summary">Showing ${paginatedDataset.length} of ${pagination.totalItems}</div>
            <div class="table-pagination-controls">
                <label class="table-pagination-label" for="table-page-size">Rows</label>
                <select id="table-page-size" class="table-pagination-select" onchange="setTablePageSize(this.value)">
                    <option value="30" ${String(pagination.pageSize) === '30' ? 'selected' : ''}>30</option>
                    <option value="60" ${String(pagination.pageSize) === '60' ? 'selected' : ''}>60</option>
                    <option value="100" ${String(pagination.pageSize) === '100' ? 'selected' : ''}>100</option>
                    <option value="all" ${pagination.pageSize === 'all' ? 'selected' : ''}>All</option>
                </select>
                <button class="compact-btn" onclick="setTablePage(${pagination.currentPage - 1})" ${pagination.currentPage <= 1 ? 'disabled' : ''}>Prev</button>
                <span class="table-pagination-page">Page ${pagination.currentPage} / ${pagination.totalPages}</span>
                <button class="compact-btn" onclick="setTablePage(${pagination.currentPage + 1})" ${pagination.currentPage >= pagination.totalPages ? 'disabled' : ''}>Next</button>
            </div>
        </div>` : '';

        container.innerHTML = `
        ${paginationControls}
        <div class="table-responsive-wrapper">
            <table class="flat-data-table">
                <thead><tr>${headers}</tr></thead>
                <tbody>${body}</tbody>
            </table>
        </div>`;
    }

    global.ViewModules.renderTableView = renderTableView;
})(window);
