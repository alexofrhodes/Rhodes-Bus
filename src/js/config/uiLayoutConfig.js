/**
 * Central UI layout tokens and chrome rules.
 * Keep density/breakpoint decisions here so views stay modular.
 */
(function (global) {
    const UI_LAYOUT_CONFIG = {
        breakpoints: {
            mobileMax: 767,
            tabletMax: 1023,
            desktopMin: 1024
        },
        density: {
            sidebarWidthDesktop: '220px',
            sidebarWidthCompact: '200px',
            headerControlHeight: 26,
            cardGapDesktop: 12,
            cardGapMobile: 8,
            controlGap: 6
        },
        chrome: {
            // Desktop keeps persistent sidebar; tablet/mobile use drawer.
            desktopSidebarPersistent: true,
            mobileDrawer: true,
            // Prefer inline filters for browse scopes; sidebar filters for ops scopes.
            preferInlineFilters: true,
            // Collapse secondary header controls when scrolling content.
            scrollCondensesHeader: true,
            // Keep rails/cards chrome minimal: no decorative badges.
            minimalViewChrome: true
        },
        booking: {
            modalMaxWidth: 420,
            adminMaxWidth: 720,
            showSlotPicker: true,
            emptyCustomerDefaults: true
        }
    };

    function getUiLayoutConfig() {
        return UI_LAYOUT_CONFIG;
    }

    function isDesktopViewport(width = window.innerWidth) {
        return Number(width) >= UI_LAYOUT_CONFIG.breakpoints.desktopMin;
    }

    function isMobileViewport(width = window.innerWidth) {
        return Number(width) <= UI_LAYOUT_CONFIG.breakpoints.mobileMax;
    }

    function applyUiLayoutTokens(root = document.documentElement) {
        if (!root || !root.style) return;
        const d = UI_LAYOUT_CONFIG.density;
        root.style.setProperty('--sidebar-width', d.sidebarWidthDesktop);
        root.style.setProperty('--ui-control-height', `${d.headerControlHeight}px`);
        root.style.setProperty('--ui-control-gap', `${d.controlGap}px`);
        root.style.setProperty('--ui-card-gap', `${d.cardGapDesktop}px`);
        root.style.setProperty('--booking-modal-max', `${UI_LAYOUT_CONFIG.booking.modalMaxWidth}px`);
        root.style.setProperty('--booking-admin-max', `${UI_LAYOUT_CONFIG.booking.adminMaxWidth}px`);
        root.classList.toggle('ui-minimal-chrome', UI_LAYOUT_CONFIG.chrome.minimalViewChrome === true);
    }

    global.UI_LAYOUT_CONFIG = UI_LAYOUT_CONFIG;
    global.getUiLayoutConfig = getUiLayoutConfig;
    global.isDesktopViewport = isDesktopViewport;
    global.isMobileViewport = isMobileViewport;
    global.applyUiLayoutTokens = applyUiLayoutTokens;
})(window);
