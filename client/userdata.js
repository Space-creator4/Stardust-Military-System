(function () {
    const STORAGE_KEY = "stardust_user_data";

    function loadLocalSettings() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            return (raw && JSON.parse(raw)) || {};
        } catch (error) {
            return {};
        }
    }

    function saveLocalSettings(settings) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(settings || {}));
        } catch (error) {}
    }

    function getPushPayload() {
        const local = loadLocalSettings();
        const payload = {};
        if (local.display_name) {
            payload.display_name = local.display_name;
        }
        if (local.theme_color) {
            payload.theme_color = local.theme_color;
        }
        if (local.country) {
            payload.country = local.country;
        }
        return payload;
    }

    window.stardustUserData = {
        loadLocalSettings: loadLocalSettings,
        saveLocalSettings: saveLocalSettings,
        getPushPayload: getPushPayload
    };
})();