const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const path = require("path");

const appUrl = process.env.APP_URL || "https://78.150.222.189";
const updateUrl = process.env.UPDATE_URL || `${appUrl}/updates/`;
const UPDATE_POLL_INTERVAL = 10 * 60 * 1000;

let autoUpdater = null;

if (app.isPackaged) {
    try {
        const { autoUpdater: updater } = require("electron-updater");
        autoUpdater = updater;
        autoUpdater.setFeedURL({ provider: "generic", url: updateUrl });
        autoUpdater.autoDownload = true;
        autoUpdater.autoInstallOnAppQuit = true;

        autoUpdater.on("checking-for-update", () => {
            sendUpdateStatus("checking");
        });

        autoUpdater.on("update-available", info => {
            sendUpdateStatus("available", info.version);
            console.log("Update available:", info.version);
        });

        autoUpdater.on("update-not-available", () => {
            sendUpdateStatus("up-to-date");
        });

        autoUpdater.on("download-progress", progress => {
            sendUpdateStatus("downloading", null, progress);
        });

        autoUpdater.on("update-downloaded", () => {
            sendUpdateStatus("downloaded");
            console.log("Update downloaded.");
            dialog
                .showMessageBox({
                    type: "info",
                    title: "Update ready",
                    message: "A new version has been downloaded.",
                    detail: "Restart now to install the update?",
                    buttons: ["Restart now", "Later"],
                    defaultId: 0,
                    cancelId: 1
                })
                .then(result => {
                    if (result.response === 0) {
                        setImmediate(() => autoUpdater.quitAndInstall());
                    }
                });
        });

        autoUpdater.on("error", error => {
            sendUpdateStatus("error", null, null, String(error && error.message || error));
            console.warn("Auto-update error:", error);
        });
    } catch (error) {
        console.warn("electron-updater unavailable:", error);
    }
}

function sendUpdateStatus(state, version = null, progress = null, message = null) {
    for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send("stardust:update-status", { state, version, progress, message });
    }
}

async function fetchJson(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
}

async function getServerVersion() {
    try {
        const data = await fetchJson(`${appUrl}/api/version`);
        return data.version || null;
    } catch (error) {
        return null;
    }
}

async function runUpdateCheck({ force = false } = {}) {
    if (!autoUpdater) {
        return { checked: false, reason: "auto-update-disabled" };
    }

    if (!force) {
        const serverVersion = await getServerVersion();
        if (!serverVersion) {
            return { checked: false, reason: "server-unreachable" };
        }
        if (serverVersion === app.getVersion()) {
            sendUpdateStatus("up-to-date");
            return { checked: true, result: "up-to-date" };
        }
    }

    try {
        const result = await autoUpdater.checkForUpdates();
        return { checked: true, result: "checking", detail: result && result.updateInfo && result.updateInfo.version };
    } catch (error) {
        return { checked: true, result: "error", detail: String(error && error.message || error) };
    }
}

app.on("certificate-error", (event, webContents, url, error, certificate, callback) => {
    const target = new URL(appUrl);
    const incoming = new URL(url);
    const isTrustedOrigin = incoming.hostname === target.hostname && incoming.port === target.port;
    if (isTrustedOrigin) {
        event.preventDefault();
        callback(true);
    } else {
        callback(false);
    }
});

function createWindow() {
    const win = new BrowserWindow({
        width: 1600,
        height: 900,
        minWidth: 1100,
        minHeight: 700,
        backgroundColor: "#05070a",
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            preload: path.join(__dirname, "preload.js")
        }
    });

    win.loadURL(appUrl);
}

ipcMain.handle("stardust:get-version", async () => {
    const serverVersion = await getServerVersion();
    return {
        app: app.getVersion(),
        server: serverVersion
    };
});

ipcMain.handle("stardust:check-updates", () => {
    return runUpdateCheck({ force: true });
});

app.whenReady().then(() => {
    createWindow();

    if (autoUpdater) {
        setTimeout(() => runUpdateCheck(), 15000);
        setInterval(() => runUpdateCheck(), UPDATE_POLL_INTERVAL);
    }

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});