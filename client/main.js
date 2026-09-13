const { app, BrowserWindow } = require("electron");

const appUrl = process.env.APP_URL || "https://78.150.222.189";

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
            nodeIntegration: false
        }
    });

    win.loadURL(appUrl);
}

app.whenReady().then(() => {
    createWindow();

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