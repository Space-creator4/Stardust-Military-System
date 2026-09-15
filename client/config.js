/* STARDUST CONFIG
   This file is the single place the backend origin is configured for browser/GitHub Pages hosting.
   In Electron or when served from the same backend, it automatically falls back to same-origin.
   The server may inject window.STARDUST_ORIGIN and window.STARDUST_VERSION before this file loads,
   so a server-hosted deployment always knows its own version and origin. */

(function () {

    var API_ORIGIN =
        window.STARDUST_ORIGIN ||
        "https://stardustn.co.uk";

    var CLIENT_VERSION =
        String(window.STARDUST_VERSION || "").trim();

    var sameOrigin = window.location.origin === API_ORIGIN;

    var electron =
        !!(window.stardustElectron && window.stardustElectron.isElectron);

    window.stardustApi = function (path) {

        return (sameOrigin || electron)
            ? path
            : API_ORIGIN + path;

    };

    window.stardustWsUrl = function () {

        var protocol =
            window.location.protocol === "https:"
                ? "wss:"
                : "ws:";

        var api = window.stardustApi("/");

        var host;

        if (/^https?:\/\//i.test(api)) {
            var anchor = document.createElement("a");
            anchor.href = api;
            host = anchor.host;
        } else {
            host = window.location.host;
        }

        return protocol + "//" + host;

    };

    window.stardustClientVersion = CLIENT_VERSION;

    window.stardustNotifyUpdate = function (latest) {
        if (!document.body) {
            document.addEventListener(
                "DOMContentLoaded",
                function () {
                    showUpdateBanner(latest);
                },
                { once: true }
            );
            return;
        }
        showUpdateBanner(latest);
    };

    function compareVersions(a, b) {

        var pa = String(a || "").split(".").map(Number);
        var pb = String(b || "").split(".").map(Number);
        var len = Math.max(pa.length, pb.length);

        for (var i = 0; i < len; i++) {
            var na = isNaN(pa[i]) ? 0 : pa[i];
            var nb = isNaN(pb[i]) ? 0 : pb[i];
            if (na !== nb) {
                return na < nb ? -1 : 1;
            }
        }

        return 0;
    }

    function showUpdateBanner(latest) {

        if (document.getElementById("stardust-update-banner")) {
            return;
        }

        var banner = document.createElement("div");
        banner.id = "stardust-update-banner";
        banner.style.cssText =
            "position:fixed;top:0;left:0;right:0;z-index:99999;" +
            "padding:10px 16px;background:#0b1117;color:#7ec8e3;" +
            "border-bottom:1px solid #4cc9f0;text-align:center;" +
            "font:600 12px 'Segoe UI',sans-serif;box-sizing:border-box;";

        banner.innerHTML =
            "A new version of Stardust is available (v" +
            latest +
            "). " +
            '<button id="stardust-update-refresh" ' +
            'style="margin-left:10px;padding:5px 12px;border:1px solid #5ee6a0;' +
            'border-radius:3px;background:transparent;color:#5ee6a0;cursor:pointer;font:inherit;">' +
            "Refresh</button>";

        document.body.appendChild(banner);

        var refresh =
            document.getElementById("stardust-update-refresh");

        if (refresh) {
            refresh.addEventListener("click", function () {
                window.location.reload();
            });
        }
    }

    function checkClientVersion() {

        if (!document.body) {
            return false;
        }

        var url =
            window.stardustApi("/api/version");

        if (CLIENT_VERSION) {
            url +=
                "?client=" +
                encodeURIComponent(CLIENT_VERSION);
        }

        fetch(url, { credentials: "same-origin" })
            .then(function (response) {
                return response.json();
            })
            .then(function (data) {
                if (
                    data &&
                    data.updateRequired === true &&
                    data.version
                ) {
                    showUpdateBanner(data.version);
                }
            })
            .catch(function () {
                /* keep quiet on transient network errors */
            });

        return true;
    }

    function scheduleVersionCheck() {

        if (checkClientVersion()) {
            return;
        }

        document.addEventListener(
            "DOMContentLoaded",
            checkClientVersion,
            { once: true }
        );
    }

    scheduleVersionCheck();

    setInterval(checkClientVersion, 5 * 60 * 1000);

    document.addEventListener("click", function (event) {
        var link =
            event.target.closest
                ? event.target.closest('a[href="/auth/logout"]')
                : null;

        if (link) {
            event.preventDefault();
            window.location.href =
                window.stardustApi("/auth/logout");
        }
    }, true);

})();