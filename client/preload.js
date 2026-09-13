const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("stardustElectron", {
    isElectron: true
});

contextBridge.exposeInMainWorld("stardustUpdater", {
    getVersion: () => ipcRenderer.invoke("stardust:get-version"),
    checkForUpdates: () => ipcRenderer.invoke("stardust:check-updates"),
    onStatus: callback => {
        ipcRenderer.on("stardust:update-status", (_event, status) => {
            callback(status);
        });
    }
});