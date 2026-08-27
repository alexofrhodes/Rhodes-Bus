/**
 * Central data-source registry (local files, FOSS DB, Google Sheets).
 * Views and scopes should resolve sources through this module only.
 */
(function (global) {
    const DATA_SOURCES_CONFIG = {
        defaultProvider: 'local_files',
        providers: {
            local_files: {
                id: 'local_files',
                label: 'Local files',
                mode: 'static',
                readOnly: false,
                // Paths remain owned by scopeDefinitions; this is the transport.
                notes: 'JSON/CSV/YAML/XLSX via DataProvider.js'
            },
            foss_postgres: {
                id: 'foss_postgres',
                label: 'FOSS Postgres bridge',
                mode: 'api',
                readOnly: false,
                notes: 'booking_api sync + Directus/NocoDB admin surfaces'
            },
            google_sheets: {
                id: 'google_sheets',
                label: 'Google Sheets',
                mode: 'api',
                readOnly: false,
                enabled: false,
                auth: {
                    type: 'service_account_or_oauth',
                    // Never commit secrets; store in env / Apps Script Properties.
                    credentialsEnv: 'GOOGLE_SHEETS_CREDENTIALS_JSON'
                },
                api: {
                    // Preferred path: thin booking_api proxy so keys never hit the browser.
                    proxyBase: '/api/sheets',
                    // Alternative: published CSV export URLs (read-only, public sheets only).
                    publicCsvFallback: true
                },
                worksheets: {
                    users: {
                        sheetIdEnv: 'GSHEET_USERS_ID',
                        tab: 'Users',
                        keyField: 'user_id',
                        columns: [
                            'user_id', 'display_name', 'email', 'phone',
                            'company_id', 'role', 'status', 'updated_at'
                        ],
                        editable: ['display_name', 'email', 'phone', 'company_id', 'role', 'status']
                    },
                    companies: {
                        sheetIdEnv: 'GSHEET_COMPANIES_ID',
                        tab: 'Companies',
                        keyField: 'company_id',
                        columns: [
                            'company_id', 'name', 'category', 'contact_email',
                            'contact_phone', 'location_id', 'status', 'updated_at'
                        ],
                        editable: ['name', 'category', 'contact_email', 'contact_phone', 'location_id', 'status']
                    },
                    providers: {
                        sheetIdEnv: 'GSHEET_PROVIDERS_ID',
                        tab: 'Providers',
                        keyField: 'provider_id',
                        columns: [
                            'provider_id', 'name', 'scope', 'company_id',
                            'status', 'notes', 'updated_at'
                        ],
                        editable: ['name', 'scope', 'company_id', 'status', 'notes']
                    }
                },
                sync: {
                    direction: 'sheets_to_api_then_portal',
                    conflictPolicy: 'last_write_wins_with_updated_at',
                    pollSeconds: 60
                }
            }
        },
        // Scope-level overrides: scopeId -> provider id
        scopeBindings: {
            contacts: 'local_files',
            events: 'local_files',
            locations: 'local_files',
            restaurants: 'local_files',
            // Planned once sheets proxy is live:
            // contacts: 'google_sheets',
            // companies: 'google_sheets'
        }
    };

    function getDataSourcesConfig() {
        return DATA_SOURCES_CONFIG;
    }

    function resolveDataSourceForScope(scopeId) {
        const binding = DATA_SOURCES_CONFIG.scopeBindings[scopeId] || DATA_SOURCES_CONFIG.defaultProvider;
        return DATA_SOURCES_CONFIG.providers[binding] || DATA_SOURCES_CONFIG.providers.local_files;
    }

    function listEditableSheetEntities() {
        const sheets = DATA_SOURCES_CONFIG.providers.google_sheets;
        if (!sheets || sheets.enabled === false) return [];
        return Object.entries(sheets.worksheets || {}).map(([entity, meta]) => ({
            entity,
            ...meta
        }));
    }

    global.DATA_SOURCES_CONFIG = DATA_SOURCES_CONFIG;
    global.getDataSourcesConfig = getDataSourcesConfig;
    global.resolveDataSourceForScope = resolveDataSourceForScope;
    global.listEditableSheetEntities = listEditableSheetEntities;
})(window);
