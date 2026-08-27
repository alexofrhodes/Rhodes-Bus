(function (global) {
    const MODE_LOCAL = 'local';
    const MODE_API = 'api';

    class LocalFileAdapter {
        constructor() {
            this.memoryCache = new Map();
        }

        async fetchText(path) {
            if (this.memoryCache.has(path)) {
                const cached = this.memoryCache.get(path);
                if (cached?.type === 'text') return cached.payload;
            }

            const response = await fetch(path, { cache: 'default' });
            if (!response.ok) {
                throw new Error(`Failed to load ${path}: ${response.status}`);
            }
            const payload = await response.text();
            this.memoryCache.set(path, { type: 'text', payload });
            return payload;
        }

        async fetchArrayBuffer(path) {
            if (this.memoryCache.has(path)) {
                const cached = this.memoryCache.get(path);
                if (cached?.type === 'arrayBuffer') return cached.payload.slice(0);
            }

            const response = await fetch(path, { cache: 'default' });
            if (!response.ok) {
                throw new Error(`Failed to load ${path}: ${response.status}`);
            }
            const payload = await response.arrayBuffer();
            this.memoryCache.set(path, { type: 'arrayBuffer', payload });
            return payload.slice(0);
        }

        getFileExtension(path) {
            const normalized = String(path || '').toLowerCase();
            if (normalized.endsWith('.xlsx') || normalized.endsWith('.xlsm')) return 'xlsx';
            if (normalized.endsWith('.csv')) return 'csv';
            if (normalized.endsWith('.yaml') || normalized.endsWith('.yml')) return 'yaml';
            return 'json';
        }

        parseJson(text, path) {
            try {
                return JSON.parse(text);
            } catch (error) {
                throw new Error(`Invalid JSON in ${path}: ${error.message}`);
            }
        }

        parseCsv(text) {
            if (global.Papa?.parse) {
                const parsed = global.Papa.parse(text, {
                    header: true,
                    skipEmptyLines: true,
                    dynamicTyping: true
                });
                if (parsed.errors?.length) {
                    throw new Error(parsed.errors[0].message || 'CSV parse error');
                }
                return parsed.data;
            }

            const rows = text
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter(Boolean);
            if (!rows.length) return [];

            const headers = rows[0].split(',').map((header) => header.trim());
            return rows.slice(1).map((line) => {
                const values = line.split(',').map((value) => value.trim());
                const row = {};
                headers.forEach((header, index) => {
                    row[header] = values[index] ?? '';
                });
                return row;
            });
        }

        parseYaml(text, path) {
            if (!global.jsyaml?.load) {
                throw new Error(`YAML parser is not available for ${path}`);
            }
            return global.jsyaml.load(text);
        }

        parseXlsx(buffer, path) {
            if (!global.XLSX?.read) {
                throw new Error(`XLSX parser is not available for ${path}`);
            }

            const workbook = global.XLSX.read(buffer, { type: 'array' });
            const firstSheetName = workbook.SheetNames?.[0];
            if (!firstSheetName) return [];
            const sheet = workbook.Sheets[firstSheetName];
            return global.XLSX.utils.sheet_to_json(sheet, { defval: '' });
        }

        async fetchData(path) {
            const ext = this.getFileExtension(path);

            if (ext === 'xlsx') {
                const buffer = await this.fetchArrayBuffer(path);
                return this.parseXlsx(buffer, path);
            }

            const text = await this.fetchText(path);
            if (ext === 'csv') return this.parseCsv(text);
            if (ext === 'yaml') return this.parseYaml(text, path);
            return this.parseJson(text, path);
        }

        async getScopeData(scopeConfig) {
            return this.fetchData(scopeConfig.file);
        }

        async getStationsData(path) {
            return this.fetchData(path);
        }
    }

    class RestApiAdapter {
        constructor(options = {}) {
            this.baseUrl = options.baseUrl || '';
        }

        async getScopeData(scopeConfig) {
            throw new Error(`REST API mode is not implemented yet for scope: ${scopeConfig.id}`);
        }

        async getStationsData(path) {
            throw new Error(`REST API mode is not implemented yet for station dataset: ${path}`);
        }
    }

    class DataProvider {
        constructor(options = {}) {
            this.mode = options.mode || MODE_LOCAL;
            this.adapters = {
                [MODE_LOCAL]: new LocalFileAdapter(),
                [MODE_API]: new RestApiAdapter(options.api || {})
            };
        }

        setMode(mode) {
            if (!this.adapters[mode]) {
                throw new Error(`Unknown data mode: ${mode}`);
            }
            this.mode = mode;
        }

        getActiveAdapter() {
            return this.adapters[this.mode];
        }

        normalizeScopePayload(payload) {
            if (Array.isArray(payload)) return payload;
            if (payload && Array.isArray(payload.items)) return payload.items;
            return [];
        }

        normalizeSchemaRecord(record, schemaAliases = {}) {
            if (!record || typeof record !== 'object' || Array.isArray(record)) {
                return record;
            }

            const keyByLower = new Map();
            Object.keys(record).forEach((key) => {
                const lower = String(key).toLowerCase();
                if (!keyByLower.has(lower)) keyByLower.set(lower, key);
            });

            const resolveValue = (candidate) => {
                if (candidate === null || candidate === undefined || candidate === '') return undefined;
                if (Object.prototype.hasOwnProperty.call(record, candidate)) {
                    return record[candidate];
                }
                const actualKey = keyByLower.get(String(candidate).toLowerCase());
                return actualKey !== undefined ? record[actualKey] : undefined;
            };

            const normalized = { ...record };
            Object.entries(schemaAliases).forEach(([canonicalField, aliasList]) => {
                if (normalized[canonicalField] !== undefined && normalized[canonicalField] !== null && normalized[canonicalField] !== '') {
                    return;
                }

                const candidates = [canonicalField].concat(Array.isArray(aliasList) ? aliasList : [aliasList]);
                for (const candidate of candidates) {
                    const value = resolveValue(candidate);
                    if (value !== undefined && value !== null && value !== '') {
                        normalized[canonicalField] = value;
                        break;
                    }
                }
            });

            return normalized;
        }

        normalizeScopeSchema(payload, scopeConfig) {
            const schemaAliases = scopeConfig?.schemaAliases || scopeConfig?.fieldAliases || {};
            if (!Object.keys(schemaAliases).length) return payload;
            return payload.map((record) => this.normalizeSchemaRecord(record, schemaAliases));
        }

        async getScopeData(scopeConfig) {
            const payload = await this.getActiveAdapter().getScopeData(scopeConfig);
            return this.normalizeScopePayload(this.normalizeScopeSchema(this.normalizeScopePayload(payload), scopeConfig));
        }

        async getStationsData(path) {
            const payload = await this.getActiveAdapter().getStationsData(path);
            return Array.isArray(payload) ? payload : [];
        }
    }

    global.DataProviderFactory = {
        create(options) {
            return new DataProvider(options);
        }
    };
})(window);
