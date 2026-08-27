(function (global) {
    const registry = {};

    function register(viewKey, renderer) {
        if (!viewKey || typeof renderer !== 'function') return;
        registry[viewKey] = renderer;
    }

    function get(viewKey) {
        return registry[viewKey] || null;
    }

    async function render(viewKey, dataset) {
        const renderer = get(viewKey);
        if (!renderer) return false;
        await renderer(dataset);
        return true;
    }

    function keys() {
        return Object.keys(registry);
    }

    global.ViewRegistry = {
        register,
        get,
        render,
        keys
    };
})(window);
