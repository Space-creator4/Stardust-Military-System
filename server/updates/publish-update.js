#!/usr/bin/env node

/* publish-update.js
   Copies the latest built installer + update metadata from
   client/dist-win-X.Y.Z (or dist-linux / dist-mac) into
   server/updates/ so the Electron auto-updater can fetch
   them at /updates/latest.yml  */

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CLIENT_DIR = path.join(REPO_ROOT, "client");
const UPDATES_DIR = path.resolve(__dirname);

const PLATFORM_FLAGS = {
    win32: ["dist-win", "latest.yml"],
    darwin: ["dist-mac", "latest-mac.yml"],
    linux: ["dist-linux", "latest-linux.yml"]
};

function die(msg) {
    console.error("publish-update error:", msg);
    process.exit(1);
}

function findLatestDistDir(platformKey) {
    const prefix = platformKey + "-";
    const candidates = fs.readdirSync(CLIENT_DIR)
        .filter(entry => {
            try {
                return entry.startsWith(prefix) &&
                    fs.statSync(path.join(CLIENT_DIR, entry)).isDirectory();
            } catch {
                return false;
            }
        })
        .sort()
        .reverse();
    return candidates.length > 0
        ? path.join(CLIENT_DIR, candidates[0])
        : null;
}

function findMetadataFile(distDir, yamlName) {
    const yamlPath = path.join(distDir, yamlName);
    if (fs.existsSync(yamlPath)) {
        return yamlPath;
    }
    const block = path.join(distDir, yamlName.replace(".yml", ".blockmap"));
    return fs.existsSync(block) ? yamlPath : null;
}

function findInstallers(distDir) {
    const exts = [".exe", ".dmg", ".AppImage", ".deb", ".rpm", ".snap"];
    return fs.readdirSync(distDir)
        .filter(f => exts.some(ext => f.endsWith(ext)))
        .map(f => path.join(distDir, f));
}

function copyFile(src, dest) {
    fs.copyFileSync(src, dest);
    console.log("  copied:", path.basename(src), "→", path.basename(dest));
}

function removeOldVersions() {
    const keep = new Set(["README.md", "publish-update.js"]);
    const oldPrefixes = ["Stardust ", "stardust-military-system-"];
    fs.readdirSync(UPDATES_DIR).forEach(f => {
        if (keep.has(f) || f.endsWith(".yml") || f.endsWith(".blockmap")) {
            if (!keep.has(f)) {
                // allow YAML + blockmap to be overwritten fresh below
            }
            return;
        }
        const isInstaller = oldPrefixes.some(p => f.startsWith(p)) ||
            f.endsWith(".exe") || f.endsWith(".dmg") ||
            f.endsWith(".AppImage") || f.endsWith(".deb");
        if (isInstaller) {
            fs.unlinkSync(path.join(UPDATES_DIR, f));
            console.log("  removed old:", f);
        }
    });
}

const platform = process.platform;
const flag = PLATFORM_FLAGS[platform];
if (!flag) {
    die(`Unsupported platform: ${platform}`);
}

const [distPrefix, yamlName] = flag;
console.log(`Publishing update for ${platform}...`);

const distDir = findLatestDistDir(distPrefix);
if (!distDir) {
    die(`No dist directory found matching ${distPrefix}-*. Run "npm run dist" first.`);
}
console.log("  dist:", path.relative(REPO_ROOT, distDir));

removeOldVersions();

const installers = findInstallers(distDir);
if (installers.length === 0) {
    die("No installer found in dist directory.");
}

installers.forEach(installer => {
    copyFile(installer, path.join(UPDATES_DIR, path.basename(installer)));
});

const yamlSrc = findMetadataFile(distDir, yamlName);
if (!yamlSrc) {
    die(`No metadata file (${yamlName}) found. electron-builder may not have generated it.`);
}
copyFile(yamlSrc, path.join(UPDATES_DIR, yamlName));

console.log("Publish complete.");
