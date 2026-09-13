/* STARDUST CONFIG
   This file is the single place the backend origin is configured for browser/GitHub Pages hosting.
   In Electron or when served from the same backend, it automatically falls back to same-origin. */

(function () {

    var API_ORIGIN = "https://api.stardustn.co.uk";

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
