const dotenv = require("dotenv");
dotenv.config();
const express = require("express");
const http = require("http");
const https = require("https");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const session = require("express-session");
const WebSocket = require("ws");
const app = express();
const server = http.createServer(app);
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const clientPath = path.join(__dirname, "..", "client");
const tilesPath = path.join(__dirname, "tiles");
const IS_PRODUCTION =
    String(process.env.NODE_ENV || "").toLowerCase() === "production";
const APP_ORIGINS =
    (process.env.APP_ORIGINS || "")
        .split(",")
        .map(origin => origin.trim())
        .filter(Boolean);
const APP_ORIGIN =
    process.env.APP_ORIGIN ||
    (APP_ORIGINS[0] || "");
const SESSION_SECRET =
    process.env.SESSION_SECRET ||
    crypto.randomBytes(32).toString("hex");
const sessionMiddleware = session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    proxy: IS_PRODUCTION,
    cookie: {
        httpOnly: true,
        sameSite: IS_PRODUCTION ? "none" : "lax",
        secure: IS_PRODUCTION,
        maxAge: 7 * 24 * 60 * 60 * 1000
    }
});
const wss = new WebSocket.Server({
    noServer: true,
    maxPayload: 4096
});
app.disable("x-powered-by");
app.set("trust proxy", IS_PRODUCTION ? 1 : false);
app.use(
    express.urlencoded({
        extended: true
    })
);
app.use(
    express.json({
        limit: "32kb"
    })
);
app.use(sessionMiddleware);
app.use(
    (req, res, next) => {
        const origin = req.headers.origin;

        if (
            req.method === "OPTIONS"
        ) {
            if (
                origin &&
                APP_ORIGINS.includes(origin)
            ) {
                res.setHeader(
                    "Access-Control-Allow-Origin",
                    origin
                );
                res.setHeader(
                    "Access-Control-Allow-Credentials",
                    "true"
                );
                res.setHeader(
                    "Access-Control-Allow-Methods",
                    "GET,HEAD,PUT,PATCH,POST,DELETE"
                );
                res.setHeader(
                    "Access-Control-Allow-Headers",
                    "Content-Type"
                );

                return res.sendStatus(204);
            }

            return next();
        }

        if (
            origin &&
            APP_ORIGINS.includes(origin)
        ) {
            res.setHeader(
                "Access-Control-Allow-Origin",
                origin
            );
            res.setHeader(
                "Access-Control-Allow-Credentials",
                "true"
            );
            res.setHeader(
                "Vary",
                "Origin"
            );
        }

        next();
    }
);
const apiHosts = new Set(
    (process.env.API_HOST || "api.stardustn.co.uk")
        .split(",")
        .map(host => host.trim().toLowerCase())
        .filter(Boolean)
);
app.use(
    (req, res, next) => {
        const host = String(req.hostname || "").toLowerCase();
        if (!apiHosts.has(host)) {
            return next();
        }
        if (
            req.path.startsWith("/api") ||
            req.path.startsWith("/auth")
        ) {
            return next();
        }
        if (req.path === "/" || req.path === "") {
            return res.status(200).json({
                service: "Stardust API",
                status: "ok",
                message: "This hostname only serves the Stardust Military System API. The website lives at https://stardustn.co.uk.",
                endpoints: {
                    version: "/api/version",
                    user: "/api/user",
                    discordLogin: "/auth/discord",
                    discordCallback: "/auth/discord/callback"
                }
            });
        }
        return res.status(404).json({
            error: "Not found",
            hint: "This hostname only exposes the Stardust API. The website lives at https://stardustn.co.uk."
        });
    }
);
app.use(
    "/tiles",
    express.static(tilesPath)
);
const upDATES_PATH = path.join(
    __dirname,
    "updates"
);
app.use(
    "/updates",
    express.static(upDATES_PATH)
);
const GITHUB_REPO_OWNER =
    "Space-creator4";
const GITHUB_REPO_NAME =
    "Stardust-Military-System";
const GITHUB_REPO =
    `${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}`;
const GITHUB_LATEST_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
const GITHUB_DOWNLOAD_BASE = `https://github.com/${GITHUB_REPO}/releases/download/`;
const UPDATES_SYNC_INTERVAL =
    30 * 60 * 1000;
function githubGetText(url) {
    return new Promise((resolve, reject) => {
        const request = (target) => {
            const lib =
                String(target).startsWith(
                    "https"
                )
                    ? https
                    : http;
            const headers = {
                "User-Agent":
                    "Stardust-Server",
                Accept:
                    "application/vnd.github+json"
            };
            if (process.env.GITHUB_TOKEN) {
                headers.Authorization =
                    "Bearer " +
                    process.env.GITHUB_TOKEN;
            }
            lib.get(
                target,
                { headers },
                res => {
                    if (
                        res.statusCode >=
                            300 &&
                        res.statusCode <
                            400 &&
                        res.headers
                            .location
                    ) {
                        res.resume();
                        return request(
                            res.headers
                                .location
                        );
                    }
                    const chunks = [];
                    res.on(
                        "data",
                        chunk =>
                            chunks.push(chunk)
                    );
                    res.on(
                        "end",
                        () => {
                            const body =
                                Buffer.concat(
                                    chunks
                                ).toString(
                                    "utf8"
                                );
                            if (
                                res.statusCode !==
                                200
                            ) {
                                reject(
                                    new Error(
                                        `HTTP ${res.statusCode} for ${target}`
                                    )
                                );
                                return;
                            }
                            resolve(body);
                        }
                    );
                }
            ).on("error", reject);
        };
        request(url);
    });
}
function syncUpdatesFromGitHub() {
    const logFail = error => {
        addLog(
            "WARN",
            "updates",
            `GitHub update sync failed: ${error.message}`
        );
    };
    return githubGetText(
        GITHUB_LATEST_API
    )
        .then(
            body => {
                const release =
                    JSON.parse(body);
                const tag =
                    release &&
                    release.tag_name;
                if (
                    !tag ||
                    !Array.isArray(
                        release.assets
                    )
                ) {
                    return [];
                }
                const downloadBase =
                    GITHUB_DOWNLOAD_BASE +
                    encodeURIComponent(tag) +
                    "/";
                const manifestNames =
                    release.assets
                        .map(
                            asset =>
                                asset &&
                                asset.name
                        )
                        .filter(
                            name =>
                                typeof name ===
                                    "string" &&
                                /^latest.*\.yml$/.test(
                                    name
                                )
                        );
                return Promise.all(
                    manifestNames.map(
                        name =>
                            githubGetText(
                                downloadBase +
                                    encodeURIComponent(name)
                            ).then(
                                content => {
                                    const rewritten =
                                        content
                                            .split("\n")
                                            .map(
                                                line => {
                                                    const match =
                                                        line.match(
                                                            /^(\s*(?:-\s*)?(?:url|path):\s+)(\S+.*)$/
                                                        );
                                                    if (
                                                        !match ||
                                                        /^https?:\/\//.test(
                                                            match[2]
                                                        )
                                                    ) {
                                                        return line;
                                                    }
                                                    return (
                                                        match[1] +
                                                        downloadBase +
                                                        encodeURIComponent(
                                                            match[2]
                                                        ).replace(
                                                            /%2F/g,
                                                            "/"
                                                        )
                                                    );
                                                }
                                            )
                                            .join("\n");
                                    fs.writeFileSync(
                                        path.join(
                                            upDATES_PATH,
                                            name
                                        ),
                                        rewritten
                                    );
                                    return name;
                                }
                            )
                    )
                ).then(
                    synced => {
                        if (synced.length) {
                            addLog(
                                "INFO",
                                "updates",
                                `Synced ${synced.length} update manifest(s) from GitHub Releases (${tag})`
                            );
                            console.log(
                                `Synced update manifest(s): ${synced.join(", ")} (${tag})`
                            );
                        }
                    },
                    logFail
                );
            },
            logFail
        );
}
const clientConfiguredOrigin =
    String(APP_ORIGIN || "")
        .replace(/["\\\r\n]/g, "")
        .trim();
app.get(
    "/config.js",
    (req, res) => {
        let source = "";
        try {
            source = fs.readFileSync(
                path.join(
                    clientPath,
                    "config.js"
                ),
                "utf8"
            );
        } catch (error) {
            source =
                `console.warn("Stardust config unavailable", ${JSON.stringify(
                    String(error && error.message || error)
                )});`;
        }
        const injected =
            [
                "/** STARDUST DYNAMIC CONFIG (server-injected) */",
                `window.STARDUST_ORIGIN = ${JSON.stringify(clientConfiguredOrigin)};`,
                `window.STARDUST_VERSION = ${JSON.stringify(getAppVersion())};`,
                ""
            ].join("\n");
        res.type(
            "application/javascript"
        );
        res.send(
            injected + source
        );
    }
);
app.use(
    express.static(clientPath, {
        index: false
    })
);
const users = new Map();
const mutedUsers = new Map();
const bannedUsers = new Map();
const messageHistory = new Map();
const orders = new Map();
const units = new Map();
const bases = new Map();
const userSettings = new Map();
const countryCodes = new Map();
const countryLeaders = new Map();
(process.env.COUNTRY_CODES || "")
    .split(",")
    .map(pair => pair.split("=").map(part => part.trim()))
    .filter(([label, code]) => label && code)
    .forEach(([label, code]) => {
        const normalized = code.toUpperCase();
        if (
            /^[A-Za-z0-9-]{4,32}$/.test(normalized)
        ) {
            countryCodes.set(normalized, label);
        }
    });
const ADMIN_IDS = new Set(
    (process.env.ADMIN_DISCORD_IDS || "")
        .split(",")
        .map(id => id.trim())
        .filter(Boolean)
);
const MAX_MESSAGE_LENGTH = 1000;
const MAX_MESSAGES_PER_WINDOW = 8;
const MESSAGE_INTERVAL = 1200;
const RATE_WINDOW = 10000;
const MAX_USERNAME_LENGTH = 32;
const MAX_DISPLAY_NAME_LENGTH = 32;
const MAX_COUNTRY_LENGTH = 60;
const MAX_ORDER_NAME = 80;
const MAX_ORDER_DESCRIPTION = 2000;
const ORDER_TYPES = new Set([
    "ground",
    "naval",
    "air",
    "movement",
    "exercise"
]);
const ORDER_PRIORITIES = new Set([
    "routine",
    "priority",
    "urgent"
]);
const ORDER_STATUSES = new Set([
    "ACTIVE",
    "COMPLETED"
]);
const UNIT_TYPES = new Set([
    "infantry",
    "armour",
    "mechanized",
    "recon",
    "artillery",
    "logistics",
    "air",
    "helicopter",
    "naval"
]);
const UNIT_STATUSES = new Set([
    "OPERATIONAL",
    "MOVING",
    "RESERVE"
]);
const BASE_TYPES = new Set([
    "military_installation",
    "airbase",
    "naval_base",
    "missile_base"
]);
const MAX_BASE_NAME = 60;
const MAX_BUILDING_LEVEL = 3;
const BASE_TYPE_LABELS = {
    military_installation: "Military Installation",
    airbase: "Air Base",
    naval_base: "Naval Base",
    missile_base: "Missile Base"
};
const BUILDING_LABELS = {
    barracks: "Barracks",
    motor_pool: "Motor Pool",
    runway: "Runway",
    hangar: "Hangar",
    helipad: "Helipad",
    depot: "Depot",
    port: "Port",
    missile_silo: "Missile Silo",
    radar: "Radar",
    air_defense: "Air Defence"
};
const BASE_INFRA_DEFAULTS = {
    military_installation: {
        barracks: 1,
        motor_pool: 1
    },
    airbase: {
        barracks: 1,
        runway: 1,
        hangar: 1,
        helipad: 1
    },
    naval_base: {
        barracks: 1,
        port: 1,
        depot: 1
    },
    missile_base: {
        barracks: 1,
        radar: 1,
        missile_silo: 1
    }
};
const UNIT_BASE_REQUIREMENTS = {
    infantry: [
        [{ type: "barracks", level: 1 }]
    ],
    armour: [
        [{ type: "motor_pool", level: 1 }]
    ],
    mechanized: [
        [
            { type: "motor_pool", level: 1 },
            { type: "depot", level: 1 }
        ]
    ],
    recon: [
        [{ type: "barracks", level: 1 }],
        [{ type: "helipad", level: 1 }]
    ],
    artillery: [
        [
            { type: "motor_pool", level: 1 },
            { type: "depot", level: 1 }
        ]
    ],
    logistics: [
        [{ type: "depot", level: 1 }]
    ],
    air: [
        [
            { type: "runway", level: 1 },
            { type: "hangar", level: 1 }
        ]
    ],
    helicopter: [
        [
            { type: "helipad", level: 1 },
            { type: "hangar", level: 1 }
        ]
    ],
    naval: [
        [{ type: "port", level: 1 }]
    ]
};
const BASES_PATH = path.join(
    __dirname,
    "bases.json"
);
function loadBasesFromFile() {
    let loaded = 0;
    try {
        const raw = fs.readFileSync(
            BASES_PATH,
            "utf8"
        );
        const data = JSON.parse(raw);
        const list =
            Array.isArray(data && data.bases)
                ? data.bases
                : [];
        for (const entry of list) {
            const name = cleanString(
                entry.name,
                MAX_BASE_NAME
            );
            const country = cleanString(
                entry.faction || entry.country,
                MAX_COUNTRY_LENGTH
            );
            const lat = Number(entry.lat);
            const lon = Number(entry.lon);
            const type = BASE_TYPES.has(
                String(entry.type)
            )
                ? String(entry.type)
                : "military_installation";
            if (
                !name ||
                !country ||
                !Number.isFinite(lat) ||
                !Number.isFinite(lon) ||
                lat < -90 ||
                lat > 90 ||
                lon < -180 ||
                lon > 180
            ) {
                continue;
            }
            const infra = {};
            const defaults =
                BASE_INFRA_DEFAULTS[
                    type
                ] || {};
            for (const [building, level] of
                Object.entries(defaults)) {
                infra[building] = level;
            }
            if (
                entry.infra &&
                typeof entry.infra ===
                    "object"
            ) {
                for (const [building, level] of
                    Object.entries(entry.infra)) {
                    if (
                        Object.prototype
                            .hasOwnProperty
                            .call(
                                BUILDING_LABELS,
                                building
                            )
                    ) {
                        infra[building] =
                            Math.floor(
                                Math.max(
                                    0,
                                    Math.min(
                                        MAX_BUILDING_LEVEL,
                                        Number(level) || 0
                                    )
                                )
                            );
                    }
                }
            }
            const record = {
                id: makeBaseId(),
                name,
                country,
                code: cleanString(
                    entry.code,
                    8
                ).toUpperCase() || null,
                type,
                lat,
                lon,
                infrastructure: infra,
                createdAt:
                    Date.now(),
                updatedAt:
                    Date.now()
            };
            bases.set(record.id, record);
            loaded++;
        }
    } catch (error) {
        console.warn(
            "Failed to load bases file:",
            error.message
        );
    }
    return loaded;
}
const MAX_UNIT_NAME = 80;
const CLIENT_PACKAGE_PATH = path.join(
    clientPath,
    "package.json"
);
function getAppVersion() {
    try {
        const pkg = JSON.parse(
            fs.readFileSync(
                CLIENT_PACKAGE_PATH,
                "utf8"
            )
        );
        return (
            pkg.version ||
            "0.0.0"
        );
    } catch (error) {
        return "0.0.0";
    }
}
function compareVersions(a, b) {
    const pa = String(a || "")
        .split(".")
        .map(part => Number(part));
    const pb = String(b || "")
        .split(".")
        .map(part => Number(part));
    const len = Math.max(
        pa.length,
        pb.length
    );
    for (let i = 0; i < len; i++) {
        const na = Number.isFinite(pa[i])
            ? pa[i]
            : 0;
        const nb = Number.isFinite(pb[i])
            ? pb[i]
            : 0;
        if (na !== nb) {
            return na < nb ? -1 : 1;
        }
    }
    return 0;
}
function isClientOutdated(latest, current) {
    return (
        Boolean(current) &&
        Boolean(latest) &&
        current !== latest &&
        compareVersions(latest, current) > 0
    );
}
function getUserName(user) {
    if (!user) {
        return "COMMANDER";
    }
return (
    user.display_name ||
    user.global_name ||
    user.username ||
    "COMMANDER"
).slice(0, MAX_USERNAME_LENGTH);
}
function isAdmin(user) {
    if (!user || !user.id) {
        return false;
    }
return ADMIN_IDS.has(String(user.id));
}
function isBanned(userId) {
    const id = String(userId);
    const ban = bannedUsers.get(id);
if (!ban) {
    return false;
}

if (
    ban.expiresAt &&
    Date.now() >= ban.expiresAt
) {
    bannedUsers.delete(id);
    return false;
}

return true;
}
function isMuted(userId) {
    const id = String(userId);
    const mute = mutedUsers.get(id);
if (!mute) {
    return false;
}

if (
    mute.expiresAt &&
    Date.now() >= mute.expiresAt
) {
    mutedUsers.delete(id);
    return false;
}

return true;
}
function checkRateLimit(userId) {
    const id = String(userId);
    const now = Date.now();
let history = messageHistory.get(id);

if (!history) {
    history = [];
    messageHistory.set(id, history);
}

while (
    history.length &&
    now - history[0] > RATE_WINDOW
) {
    history.shift();
}

if (
    history.length >=
    MAX_MESSAGES_PER_WINDOW
) {
    return false;
}

if (
    history.length &&
    now - history[history.length - 1] <
        MESSAGE_INTERVAL
) {
    return false;
}

history.push(now);

return true;
}
function cleanMessage(message) {
    if (typeof message !== "string") {
        return null;
    }
const cleaned = message
    .replace(/\u0000/g, "")
    .trim();

if (!cleaned) {
    return null;
}

if (
    cleaned.length >
    MAX_MESSAGE_LENGTH
) {
    return null;
}

return cleaned;
}
function send(socket, data) {
    if (
        socket &&
        socket.readyState === WebSocket.OPEN
    ) {
        socket.send(
            JSON.stringify(data)
        );
    }
}
function broadcast(data, filter = null) {
    const payload = JSON.stringify(data);
wss.clients.forEach(client => {
    if (
        client.readyState !==
        WebSocket.OPEN
    ) {
        return;
    }

    if (
        filter &&
        !filter(client)
    ) {
        return;
    }

    client.send(payload);
});
}
function getOnlineUsers() {
    return Array.from(
        users.values()
    ).map(user => ({
        id: user.id,
        username: user.username,
        global_name: user.global_name,
        country: user.country || null,
        connectedAt: user.connectedAt
    }));
}
function broadcastServerStatus() {
    broadcast({
        type: "server_status",
        onlineUsers: users.size
    });
}
const MAX_SYSTEM_LOGS = 300;
const systemLogs = [];
function addLog(level, source, message) {
    systemLogs.push({
        id: crypto
            .randomBytes(4)
            .toString("hex"),
        level: level || "INFO",
        source: source || "system",
        message:
            String(message || ""),
        timestamp: Date.now()
    });

    if (
        systemLogs.length >
        MAX_SYSTEM_LOGS
    ) {
        systemLogs.splice(
            0,
            systemLogs.length -
                MAX_SYSTEM_LOGS
        );
    }
}
function getSystemLogs() {
    return systemLogs
        .slice()
        .reverse();
}
function requireAuth(req, res, next) {
    if (!req.session.user) {
        return res.status(401).json({
            authenticated: false,
            error: "Authentication required."
        });
    }
next();
}
function getPublicUser(user) {
    if (!user) {
        return null;
    }
const settings =
    getUserSettings(user.id);

return {
    id: String(user.id),
    username: user.username || null,
    global_name: user.global_name || null,
    avatar: user.avatar || null,
    country: settings.country || user.country || null,
    display_name:
        settings.display_name || null,
    theme_color:
        settings.theme_color || null,
    isAdmin: isAdmin(user),
    is_country_leader:
        !!getClaimedCountry(
            user.id
        )
};
}
function cleanString(value, max) {
    if (typeof value !== "string") {
        return "";
    }
const cleaned = value
    .replace(/[\u0000-\u001f]/g, "")
    .trim();

return cleaned.slice(0, max);
}
function getUserSettings(userId) {
    const id =
        String(userId);

    const stored =
        userSettings.get(id) || {};

    const settings = {
        display_name:
            cleanString(
                stored.display_name,
                MAX_DISPLAY_NAME_LENGTH
            ),
        country:
            cleanString(
                stored.country,
                MAX_COUNTRY_LENGTH
            ),
        theme_color:
            typeof stored.theme_color ===
            "string" &&
            /^#[0-9a-fA-F]{6}$/.test(
                stored.theme_color
            )
                ? stored.theme_color
                : "",
        country_claimed:
            !!stored.country_claimed
    };

    return settings;
}
function getClaimedCountry(userId) {
    const id =
        String(userId);
    for (const [country, entry] of
            countryLeaders) {
        if (
            entry.userId === id
        ) {
            return country;
        }
    }
    return null;
}
function buildCountryLeaders() {
    return Array.from(
        countryLeaders.entries()
    )
        .map((
            [country, entry]
        ) => {
            const settings =
                getUserSettings(
                    entry.userId
                );
            return {
                country,
                userId:
                    entry.userId,
                username:
                    entry.profile
                        .username ||
                    null,
                global_name:
                    entry.profile
                        .global_name ||
                    null,
                avatar:
                    entry.profile
                        .avatar ||
                    null,
                display_name:
                    settings.display_name ||
                    entry.profile
                        .global_name ||
                    entry.profile
                        .username ||
                    null
            };
        })
        .sort((a, b) =>
            a.country.localeCompare(
                b.country
            )
        );
}
function broadcastCountryLeaders() {
    broadcast({
        type: "country_leaders",
        leaders:
            buildCountryLeaders()
    });
}
function makeOrderId() {
    return (
        "ORD-" +
        crypto
            .randomBytes(4)
            .toString("hex")
            .toUpperCase()
    );
}
function getOrdersSnapshot() {
    return Array.from(
        orders.values()
    ).sort(
        (a, b) =>
            b.createdAt -
            a.createdAt
    );
}
function broadcastOrders() {
    broadcast({
        type: "orders",
        orders:
            getOrdersSnapshot()
    });
}
function handleOrderCreate(
    socket,
    message,
    userId
) {
    const order =
        message.order || {};

    const name =
        cleanString(
            order.name,
            MAX_ORDER_NAME
        );

    const description =
        cleanString(
            order.description,
            MAX_ORDER_DESCRIPTION
        );

    const type =
        ORDER_TYPES.has(
            String(order.type)
        )
            ? String(order.type)
            : "ground";

    const priority =
        ORDER_PRIORITIES.has(
            String(order.priority)
        )
            ? String(order.priority)
            : "routine";

    if (!name || !description) {
        send(socket, {
            type: "error",
            message:
                "Order name and details are required."
        });

        return;
    }

    const record = {
        id: makeOrderId(),
        name,
        type,
        priority,
        description,
        status: "ACTIVE",
        createdBy: {
            id: String(userId),
            username:
                getUserName(
                    socket.user
                )
        },
        createdAt:
            Date.now(),
        updatedAt:
            Date.now()
    };

    orders.set(
        record.id,
        record
    );

    broadcastOrders();

    addLog(
        "INFO",
        "orders",
        `${getUserName(socket.user)} created order "${name}" (${record.id})`
    );

    send(socket, {
        type: "order_created",
        order: record
    });
}
function handleOrderUpdate(
    socket,
    message,
    userId
) {
    const id =
        cleanString(
            message.id,
            32
        );

    const existing =
        id
            ? orders.get(id)
            : null;

    if (!existing) {
        send(socket, {
            type: "error",
            message:
                "Order not found."
        });

        return;
    }

    const next =
        message.order || {};

    if (
        typeof next.status ===
        "string"
    ) {
        const status =
            next.status.toUpperCase();

        if (
            ORDER_STATUSES.has(
                status
            )
        ) {
            existing.status =
                status;
        }
    }

    if (
        typeof next.name ===
        "string"
    ) {
        const name =
            cleanString(
                next.name,
                MAX_ORDER_NAME
            );

        if (name) {
            existing.name =
                name;
        }
    }

    if (
        typeof next.description ===
        "string"
    ) {
        const description =
            cleanString(
                next.description,
                MAX_ORDER_DESCRIPTION
            );

        if (description) {
            existing.description =
                description;
        }
    }

    if (
        ORDER_TYPES.has(
            String(next.type)
        )
    ) {
        existing.type =
            String(next.type);
    }

    if (
        ORDER_PRIORITIES.has(
            String(
                next.priority
            )
        )
    ) {
        existing.priority =
            String(
                next.priority
            );
    }

    existing.updatedAt =
        Date.now();

    orders.set(
        id,
        existing
    );

    broadcastOrders();

    addLog(
        "INFO",
        "orders",
        `${getUserName(socket.user)} updated order "${existing.name}" (${id})`
    );
}
function handleOrderDelete(
    socket,
    message,
    userId
) {
    const id =
        cleanString(
            message.id,
            32
        );

    if (
        id &&
        orders.delete(id)
    ) {
        broadcastOrders();

        addLog(
            "INFO",
            "orders",
            `${getUserName(socket.user)} deleted order ${id}`
        );
    }
}
function makeUnitId() {
    return (
        "UNC-" +
        crypto
            .randomBytes(4)
            .toString("hex")
            .toUpperCase()
    );
}
function getUnitsSnapshot() {
    return Array.from(
        units.values()
    ).sort(
        (a, b) =>
            b.createdAt -
            a.createdAt
    );
}
function broadcastUnits() {
    broadcast({
        type: "units",
        units:
            getUnitsSnapshot()
    });
}
let unitsBroadcastTimer = null;
function scheduleBroadcastUnits() {
    if (unitsBroadcastTimer) {
        return;
    }
    unitsBroadcastTimer = setTimeout(
        () => {
            unitsBroadcastTimer =
                null;
            broadcastUnits();
        },
        60
    );
}
function makeBaseId() {
    return (
        "BAS-" +
        crypto
            .randomBytes(4)
            .toString("hex")
            .toUpperCase()
    );
}
function getBasesSnapshot() {
    return Array.from(
        bases.values()
    ).sort(
        (a, b) =>
            a.country.localeCompare(
                b.country
            ) ||
            a.name.localeCompare(
                b.name
            )
    );
}
function isAdminConnection(connection) {
    return !!(
        connection &&
        ADMIN_IDS.has(
            String(
                connection.id
            )
        )
    );
}
function getVisibleBasesFor(connection) {
    const all =
        getBasesSnapshot();
    if (
        !connection ||
        isAdminConnection(
            connection
        )
    ) {
        return all;
    }
    const country =
        connection.country ||
        null;
    if (!country) {
        return [];
    }
    return all.filter(
        base =>
            base.country ===
            country
    );
}
function broadcastBases() {
    const payloadCache =
        new Map();
    wss.clients.forEach(
        client => {
            if (
                client.readyState !==
                WebSocket.OPEN
            ) {
                return;
            }
            const connection =
                client.user;
            const key =
                !connection ||
                isAdminConnection(
                    connection
                )
                    ? connection
                        ? "admin"
                        : "anon"
                    : "c:" +
                      (
                          connection.country ||
                          ""
                      );
            let payload =
                payloadCache.get(
                    key
                );
            if (!payload) {
                payload =
                    JSON.stringify({
                        type: "bases",
                        bases:
                            getVisibleBasesFor(
                                connection
                            )
                    });
                payloadCache.set(
                    key,
                    payload
                );
            }
            client.send(payload);
        }
    );
}
function checkBaseSupportsType(base, unitType) {
    const groups =
        UNIT_BASE_REQUIREMENTS[
            String(unitType)
        ] || [];
    const missing = [];
    for (const group of groups) {
        const satisfied =
            group.every(
                requirement => {
                    const level =
                        Number(
                            base &&
                            base.infrastructure &&
                            base.infrastructure[
                                requirement.type
                            ]
                        ) || 0;
                    return (
                        level >=
                        requirement.level
                    );
                }
            );
        if (!satisfied) {
            missing.push(
                group.map(
                    requirement =>
                        `${BUILDING_LABELS[requirement.type] || requirement.type} LV.${requirement.level}`
                ).join(" + ")
            );
        }
    }
    return {
        ok: missing.length === 0,
        missing
    };
}
function getUnitRequirementLabel(unitType) {
    const groups =
        UNIT_BASE_REQUIREMENTS[
            String(unitType)
        ] || [];
    if (groups.length === 0) {
        return "No base infrastructure required";
    }
    return groups
        .map(
            group =>
                group
                    .map(
                        requirement =>
                            `${BUILDING_LABELS[requirement.type] || requirement.type} LV.${requirement.level}`
                    )
                    .join(" + ")
        )
        .join("  OR  ");
}
function readUnitPosition(payload) {
    const lat = Number(payload.lat);
    const lon = Number(payload.lon);

    if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lon) ||
        lat < -90 ||
        lat > 90 ||
        lon < -180 ||
        lon > 180
    ) {
        return null;
    }

    return {
        lat,
        lon
    };
}
function handleClientVersion(
    socket,
    message
) {
    const latest =
        getAppVersion();
    const current =
        cleanString(
            message.version,
            32
        ).trim();
    const outdated =
        isClientOutdated(
            latest,
            current
        );
    const username =
        getUserName(
            socket && socket.user
        );

    addLog(
        "INFO",
        "client",
        `${username} running client ${current || "unknown"} (server: ${latest})${outdated ? " — UPDATE REQUIRED" : ""}`
    );

    send(socket, {
        type: "client_update",
        current:
            current || null,
        latest,
        updateRequired:
            outdated
    });
}
function handleUnitCreate(
    socket,
    message,
    userId
) {
    const unit =
        message.unit || {};

    const name =
        cleanString(
            unit.name,
            MAX_UNIT_NAME
        );

    const type =
        UNIT_TYPES.has(
            String(unit.type)
        )
            ? String(unit.type)
            : "infantry";

    const status =
        UNIT_STATUSES.has(
            String(
                unit.status
            )
        )
            ? String(unit.status)
            : "OPERATIONAL";

    const position =
        readUnitPosition(
            unit
        );

    if (!name) {
        send(socket, {
            type: "error",
            message:
                "Unit designation is required."
        });

        return;
    }

    const personnel = Math.floor(
        Math.max(
            1,
            Math.min(
                1000000,
                Number(
                    unit.personnel
                ) || 1
            )
        )
    );

    const country =
        cleanString(
            unit.country,
            MAX_COUNTRY_LENGTH
        ) ||
        socket.user.country ||
        null;

    const baseId =
        cleanString(
            unit.baseId,
            16
        );

    const baseRecord =
        baseId
            ? bases.get(baseId)
            : null;

    if (
        baseId &&
        !baseRecord
    ) {
        send(socket, {
            type: "error",
            message:
                "Selected base was not found."
        });

        return;
    }

    if (
        baseRecord &&
        country &&
        baseRecord.country !==
            country
    ) {
        send(socket, {
            type: "error",
            message:
                `Unit country "${country}" does not match the selected base (${baseRecord.name}, ${baseRecord.country}).`
        });

        return;
    }

    const support =
        baseRecord
            ? checkBaseSupportsType(
                  baseRecord,
                  type
              )
            : null;

    if (
        support &&
        !support.ok
    ) {
        send(socket, {
            type: "error",
            message:
                `Base "${baseRecord.name}" lacks required infrastructure. Needed: ${support.missing.join("  OR  ")}. Build it in FORCES → BASES.`
        });

        return;
    }

    const freePlacement =
        !baseRecord &&
        isAdmin(socket.user);

    if (
        !baseRecord &&
        !freePlacement
    ) {
        send(socket, {
            type: "error",
            message:
                "Units must be raised at a military base. Select a base in FORCES → BASES."
        });

        return;
    }

    const effectivePosition =
        baseRecord
            ? {
                  lat:
                      baseRecord.lat,
                  lon:
                      baseRecord.lon
              }
            : position;

    if (
        !effectivePosition ||
        !Number.isFinite(
            effectivePosition.lat
        ) ||
        !Number.isFinite(
            effectivePosition.lon
        )
    ) {
        send(socket, {
            type: "error",
            message:
                "Unit position (valid lat/lon) is required."
        });

        return;
    }

    const baseInfo = baseRecord
        ? {
              id: baseRecord.id,
              name: baseRecord.name,
              type: baseRecord.type,
              country:
                  baseRecord.country
          }
        : null;

    const record = {
        id: makeUnitId(),
        name,
        type,
        status,
        personnel,
        country:
            baseRecord
                ? baseRecord.country
                : country || null,
        lat: effectivePosition.lat,
        lon: effectivePosition.lon,
        base: baseInfo,
        createdBy: {
            id: String(userId),
            username:
                getUserName(
                    socket.user
                )
        },
        createdAt:
            Date.now(),
        updatedAt:
            Date.now()
    };

    units.set(
        record.id,
        record
    );

    scheduleBroadcastUnits();

    addLog(
        "INFO",
        "units",
        `${getUserName(socket.user)} deployed unit "${name}" (${record.id}) at ${baseRecord ? baseRecord.name : "field location"}`
    );

    send(socket, {
        type: "unit_created",
        unit: record
    });
}
function handleUnitUpdate(
    socket,
    message,
    userId
) {
    const id =
        cleanString(
            message.id,
            32
        );

    const existing =
        id
            ? units.get(id)
            : null;

    if (!existing) {
        send(socket, {
            type: "error",
            message:
                "Unit not found."
        });

        return;
    }

    const next =
        message.unit || {};

    if (
        typeof next.name ===
        "string"
    ) {
        const name =
            cleanString(
                next.name,
                MAX_UNIT_NAME
            );

        if (name) {
            existing.name =
                name;
        }
    }

    if (
        UNIT_TYPES.has(
            String(next.type)
        )
    ) {
        existing.type =
            String(next.type);
    }

    if (
        UNIT_STATUSES.has(
            String(
                next.status
            )
        )
    ) {
        existing.status =
            String(next.status);
    }

    if (
        Number.isFinite(
            Number(next.personnel)
        )
    ) {
        existing.personnel =
            Math.floor(
                Math.max(
                    1,
                    Math.min(
                        1000000,
                        Number(
                            next.personnel
                        )
                    )
                )
            );
    }

    if (
        typeof next.country ===
        "string"
    ) {
        const country =
            cleanString(
                next.country,
                MAX_COUNTRY_LENGTH
            );

        if (country) {
            existing.country =
                country;
        }
    }

    const position =
        readUnitPosition(
            next
        );

    if (position) {
        existing.lat =
            position.lat;
        existing.lon =
            position.lon;
    }

    existing.updatedAt =
        Date.now();

    units.set(
        id,
        existing
    );

    scheduleBroadcastUnits();

    addLog(
        "INFO",
        "units",
        `${getUserName(socket.user)} updated unit "${existing.name}" (${id})`
    );

    send(socket, {
        type: "unit_updated",
        unit: existing
    });
}
function handleUnitDelete(
    socket,
    message,
    userId
) {
    const id =
        cleanString(
            message.id,
            32
        );

    if (
        id &&
        units.delete(id)
    ) {
        scheduleBroadcastUnits();

        addLog(
            "INFO",
            "units",
            `${getUserName(socket.user)} removed unit ${id}`
        );
    }
}
function canManageBase(user, baseRecord) {
    if (!user) {
        return false;
    }
    if (isAdmin(user)) {
        return true;
    }
    const leaderCountry =
        getClaimedCountry(
            String(user.id)
        );
    if (
        leaderCountry &&
        leaderCountry ===
            baseRecord.country
    ) {
        return true;
    }
    const userCountry =
        cleanString(
            user.country,
            MAX_COUNTRY_LENGTH
        );
    return (
        userCountry &&
        userCountry ===
            baseRecord.country
    );
}
function handleBaseCreate(
    socket,
    message,
    userId
) {
    const payload =
        message.base || {};

    const name =
        cleanString(
            payload.name,
            MAX_BASE_NAME
        );

    const type =
        BASE_TYPES.has(
            String(payload.type)
        )
            ? String(payload.type)
            : "military_installation";

    const country =
        cleanString(
            payload.country,
            MAX_COUNTRY_LENGTH
        ) ||
        socket.user.country ||
        null;

    const lat =
        Number(payload.lat);

    const lon =
        Number(payload.lon);

    if (!name) {
        send(socket, {
            type: "error",
            message:
                "Base designation is required."
        });

        return;
    }

    if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lon) ||
        lat < -90 ||
        lat > 90 ||
        lon < -180 ||
        lon > 180
    ) {
        send(socket, {
            type: "error",
            message:
                "Base position (valid lat/lon) is required."
        });

        return;
    }

    if (!country) {
        send(socket, {
            type: "error",
            message:
                "You must be assigned to a country to establish a base."
        });

        return;
    }

    const leader =
        getClaimedCountry(
            String(userId)
        );

    if (
        leader !== country &&
        !isAdmin(socket.user)
    ) {
        send(socket, {
            type: "error",
            message:
                "Only the country leader or an admin can establish new bases."
        });

        return;
    }

    const infra = {};
    const defaults =
        BASE_INFRA_DEFAULTS[type] || {};

    for (const [building, level] of
        Object.entries(defaults)) {
        infra[building] = level;
    }

    const record = {
        id: makeBaseId(),
        name,
        country,
        code: null,
        type,
        lat,
        lon,
        infrastructure: infra,
        built: true,
        builtBy: {
            id: String(userId),
            username:
                getUserName(
                    socket.user
                )
        },
        createdAt:
            Date.now(),
        updatedAt:
            Date.now()
    };

    bases.set(
        record.id,
        record
    );

    broadcastBases();

    addLog(
        "INFO",
        "bases",
        `${getUserName(socket.user)} established base "${name}" (${record.id}) in ${country}`
    );

    send(socket, {
        type: "base_created",
        base: record
    });
}
function handleBaseUpgrade(
    socket,
    message,
    userId
) {
    const id =
        cleanString(
            message.baseId,
            16
        );

    const base =
        id
            ? bases.get(id)
            : null;

    if (!base) {
        send(socket, {
            type: "error",
            message:
                "Base not found."
        });

        return;
    }

    if (
        !canManageBase(
            socket.user,
            base
        )
    ) {
        send(socket, {
            type: "error",
            message:
                "You do not have command authority over this base."
        });

        return;
    }

    if (
        base.built !== true
    ) {
        send(socket, {
            type: "error",
            message:
                "Government infrastructure at this base is fixed and cannot be upgraded."
        });

        return;
    }

    const building =
        cleanString(
            message.building,
            24
        );

    if (
        !Object.prototype
            .hasOwnProperty
            .call(
                BUILDING_LABELS,
                building
            )
    ) {
        send(socket, {
            type: "error",
            message:
                "Unknown infrastructure type."
        });

        return;
    }

    const current =
        Number(
            base.infrastructure[
                building
            ]
        ) || 0;

    if (
        current >=
        MAX_BUILDING_LEVEL
    ) {
        send(socket, {
            type: "error",
            message:
                `${BUILDING_LABELS[building]} already at maximum level (LV.${current}).`
        });

        return;
    }

    base.infrastructure[building] =
        current + 1;

    base.updatedAt =
        Date.now();

    bases.set(id, base);

    broadcastBases();

    addLog(
        "INFO",
        "bases",
        `${getUserName(socket.user)} upgraded ${BUILDING_LABELS[building]} at "${base.name}" to LV.${current + 1}`
    );

    send(socket, {
        type: "base_updated",
        base
    });
}
function handleBaseDelete(
    socket,
    message,
    userId
) {
    const id =
        cleanString(
            message.baseId,
            16
        );

    const base =
        id
            ? bases.get(id)
            : null;

    if (!base) {
        send(socket, {
            type: "error",
            message:
                "Base not found."
        });

        return;
    }

    if (
        base.built &&
        canManageBase(
            socket.user,
            base
        )
    ) {
        bases.delete(id);

        broadcastBases();

        addLog(
            "INFO",
            "bases",
            `${getUserName(socket.user)} dismantled base "${base.name}" (${id})`
        );
    } else {
        send(socket, {
            type: "error",
            message:
                "Only built bases can be dismantled, and only by their country leader or an admin."
        });

        return;
    }

    for (const unit of
        units.values()) {
        if (
            unit.base &&
            unit.base.id === id
        ) {
            unit.base = null;
        }
    }

    scheduleBroadcastUnits();
}
app.get("/health", (req, res) => {
    res.json({
        status: "online",
        service: "Stardust Command Network",
        websocket: true,
        onlineUsers: users.size,
        environment: IS_PRODUCTION
            ? "production"
            : "development",
        timestamp: Date.now()
    });
});
app.get("/api/version", (req, res) => {
    const latest =
        getAppVersion();
    const current =
        cleanString(
            req.query.client,
            32
        ).trim();
    res.json({
        version: latest,
        timestamp: Date.now(),
        client:
            current || null,
        updateRequired:
            isClientOutdated(
                latest,
                current
            )
    });
});
function frontendLoginUrl(params = {}) {
    if (!APP_ORIGIN) {
        return null;
    }
    const url = new URL(APP_ORIGIN);
    url.pathname = "/login.html";
    for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
    }
    return url.toString();
}

function oauthError(res, message, status) {
    if (APP_ORIGIN) {
        return res.redirect(
            frontendLoginUrl({ error: "auth_failed" })
        );
    }
    return res.status(status).send(message);
}

function authRedirect(res, fallback) {
    return res.redirect(APP_ORIGIN || fallback);
}

app.get("/", (req, res) => {
    if (!req.session.user) {
        return res.sendFile(
            path.join(
                clientPath,
                "login.html"
            )
        );
    }
return res.sendFile(
    path.join(
        clientPath,
        "index.html"
    )
);
});
app.get("/login", (req, res) => {
    if (req.session.user) {
        return res.redirect("/");
    }
return res.sendFile(
    path.join(
        clientPath,
        "login.html"
    )
);
});
app.get(
    "/auth/discord",
    (req, res) => {
        if (
            !process.env.DISCORD_CLIENT_ID ||
            !process.env.DISCORD_CLIENT_SECRET ||
            !process.env.DISCORD_REDIRECT_URI
        ) {
            return res
                .status(500)
                .send(
                    "Discord OAuth is not configured."
                );
        }
    const state =
        crypto
            .randomBytes(32)
            .toString("hex");

    req.session.oauthState = state;

    req.session.save(error => {
        if (error) {
            console.error(
                "OAuth session save error:",
                error
            );

            return res
                .status(500)
                .send(
                    "Could not initialise Discord login."
                );
        }

        const params =
            new URLSearchParams({
                client_id:
                    process.env.DISCORD_CLIENT_ID,

                response_type:
                    "code",

                redirect_uri:
                    process.env.DISCORD_REDIRECT_URI,

                scope:
                    "identify",

                state
            });

        const authorizationUrl =
            "https://discord.com/oauth2/authorize?" +
            params.toString();

        return res.redirect(
            authorizationUrl
        );
    });
}
);
app.get(
    "/auth/discord/callback",
    async (req, res) => {
        const code =
            typeof req.query.code === "string"
                ? req.query.code
                : null;
    const state =
        typeof req.query.state === "string"
            ? req.query.state
            : null;

    if (!code || !state) {
        return oauthError(
            res,
            "Missing Discord OAuth information.",
            400
        );
    }

    if (
        !req.session.oauthState ||
        state !== req.session.oauthState
    ) {
        return oauthError(
            res,
            "Invalid OAuth state.",
            403
        );
    }

    delete req.session.oauthState;

    try {
        const tokenResponse =
            await fetch(
                "https://discord.com/api/oauth2/token",
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/x-www-form-urlencoded"
                    },

                    body:
                        new URLSearchParams({
                            client_id:
                                process.env.DISCORD_CLIENT_ID,

                            client_secret:
                                process.env.DISCORD_CLIENT_SECRET,

                            grant_type:
                                "authorization_code",

                            code,

                            redirect_uri:
                                process.env.DISCORD_REDIRECT_URI
                        })
                }
            );

        const tokenData =
            await tokenResponse.json();

        if (!tokenResponse.ok) {
            console.error(
                "Discord token error:",
                tokenData
            );

            return oauthError(
                res,
                "Discord login failed.",
                500
            );
        }

        const userResponse =
            await fetch(
                "https://discord.com/api/v10/users/@me",
                {
                    headers: {
                        Authorization:
                            `Bearer ${tokenData.access_token}`
                    }
                }
            );

        const user =
            await userResponse.json();

        if (!userResponse.ok) {
            console.error(
                "Discord user error:",
                user
            );

            return oauthError(
                res,
                "Could not retrieve Discord account.",
                500
            );
        }

        req.session.user = {
            id: String(user.id),

            username:
                user.username || null,

            global_name:
                user.global_name || null,

            avatar:
                user.avatar || null,

            country:
                null
        };

        req.session.save(
            error => {
                if (error) {
                    console.error(
                        "Session save error:",
                        error
                    );

                    return oauthError(
                        res,
                        "Could not save login session.",
                        500
                    );
                }

                return authRedirect(res, "/");
            }
        );
    } catch (error) {
        console.error(
            "Discord OAuth error:",
            error
        );

        return oauthError(
            res,
            "Discord authentication failed.",
            500
        );
    }
}
);
app.get(
    "/api/user",
    (req, res) => {
        if (!req.session.user) {
            return res.json({
                authenticated: false,
                user: null
            });
        }
    return res.json({
        authenticated: true,
        user:
            getPublicUser(
                req.session.user
            )
    });
}
);
app.get(
    "/api/me",
    (req, res) => {
        if (!req.session.user) {
            return res
                .status(401)
                .json({
                    authenticated: false,
                    user: null
                });
        }
    return res.json({
        authenticated: true,

        user:
            getPublicUser(
                req.session.user
            )
    });
}
);
app.get(
    "/api/settings",
    requireAuth,
    (req, res) => {
        return res.json({
            authenticated: true,
            settings:
                getUserSettings(
                    req.session.user.id
                )
        });
    }
);
app.post(
    "/api/settings",
    requireAuth,
    (req, res) => {
        const userId =
            String(
                req.session.user.id
            );

        const settings =
            getUserSettings(userId);

        const body =
            req.body || {};

        if (
            typeof body.display_name ===
            "string"
        ) {
            settings.display_name =
                cleanString(
                    body.display_name,
                    MAX_DISPLAY_NAME_LENGTH
                );
        }

        if (
            typeof body.country ===
            "string"
        ) {
            if (
                !settings.country_claimed
            ) {
                settings.country =
                    cleanString(
                        body.country,
                        MAX_COUNTRY_LENGTH
                    );
            }
        }

        if (
            typeof body.theme_color ===
            "string" &&
            /^#[0-9a-fA-F]{6}$/.test(
                body.theme_color
            )
        ) {
            settings.theme_color =
                body.theme_color.toLowerCase();
        }

        userSettings.set(
            userId,
            settings
        );

        req.session.user.display_name =
            settings.display_name || null;

        req.session.user.country =
            settings.country || null;

        req.session.save(() => {});

        const connection =
            users.get(userId);

        if (connection) {
            connection.display_name =
                settings.display_name || null;

            connection.country =
                settings.country || null;
        }

        return res.json({
            authenticated: true,
            settings
        });
    }
);
app.get(
    "/api/country/leaders",
    requireAuth,
    (req, res) => {
        return res.json({
            leaders:
                buildCountryLeaders()
        });
    }
);
app.post(
    "/api/country/claim",
    requireAuth,
    (req, res) => {
        const userId =
            String(
                req.session.user.id
            );

        const code =
            typeof (
                req.body || {}
            ).code === "string"
                ? req.body.code
                      .trim()
                      .toUpperCase()
                : "";

        const country =
            countryCodes.get(
                code
            );

        if (!country) {
            return res
                .status(400)
                .json({
                    error:
                        "Invalid country code.",
                    authenticated: true
                });
        }

        const claimedBy =
            getClaimedCountry(
                userId
            );

        if (
            claimedBy &&
            claimedBy !== country
        ) {
            return res
                .status(409)
                .json({
                    error:
                        "You already command another country.",
                    authenticated: true
                });
        }

        const existing =
            countryLeaders.get(
                country
            );

        if (
            existing &&
            existing.userId !==
                userId
        ) {
            return res
                .status(409)
                .json({
                    error:
                        "Country already assigned to another commander.",
                    authenticated: true,
                    country
                });
        }

        const settings =
            getUserSettings(
                userId
            );

        settings.country =
            country;

        settings.country_claimed =
            true;

        userSettings.set(
            userId,
            settings
        );

        req.session.user.country =
            country;

        req.session.save(() => {});

        const connection =
            users.get(userId);

        if (connection) {
            connection.country =
                country;
        }

        countryLeaders.set(
            country,
            {
                userId,
                profile: {
                    username:
                        req.session.user
                            .username ||
                        null,
                    global_name:
                        req.session.user
                            .global_name ||
                        null,
                    avatar:
                        req.session.user
                            .avatar ||
                        null
                }
            }
        );

        broadcastCountryLeaders();

        addLog(
            "INFO",
            "country",
            `${req.session.user.global_name || req.session.user.username || userId} now commands ${country}`
        );

        return res.json({
            authenticated: true,
            settings,
            isCountryLeader: true
        });
    }
);
app.post(
    "/api/country/relinquish",
    requireAuth,
    (req, res) => {
        const userId =
            String(
                req.session.user.id
            );

        const country =
            getClaimedCountry(
                userId
            );

        if (!country) {
            return res.json({
                authenticated: true,
                isCountryLeader: false,
                settings:
                    getUserSettings(
                        userId
                    )
            });
        }

        countryLeaders.delete(
            country
        );

        const settings =
            getUserSettings(
                userId
            );

        settings.country_claimed =
            false;

        userSettings.set(
            userId,
            settings
        );

        broadcastCountryLeaders();

        addLog(
            "INFO",
            "country",
            `${req.session.user.global_name || req.session.user.username || userId} relinquished control of ${country}`
        );

        return res.json({
            authenticated: true,
            isCountryLeader: false,
            settings
        });
    }
);
app.get(
    "/api/online",
    requireAuth,
    (req, res) => {
        return res.json({
            users:
                getOnlineUsers()
        });
    }
);
app.get(
    "/api/admin/status",
    requireAuth,
    (req, res) => {
        if (
            !isAdmin(
                req.session.user
            )
        ) {
            return res
                .status(403)
                .json({
                    error:
                        "Administrator access required."
                });
        }
    return res.json({
        users:
            getOnlineUsers(),

        muted:
            Array.from(
                mutedUsers.entries()
            ),

        banned:
            Array.from(
                bannedUsers.entries()
            ),

        logs:
            getSystemLogs()
    });
}
);
app.post(
    "/api/admin/update",
    requireAuth,
    (req, res) => {
        if (
            !isAdmin(
                req.session.user
            )
        ) {
            return res
                .status(403)
                .json({
                    error:
                        "Administrator access required."
                });
        }

        const version =
            getAppVersion();

        broadcast({
            type: "update",
            version
        });

        addLog(
            "ADMIN",
            "deploy",
            `${req.session.user.global_name || req.session.user.username || req.session.user.id} signalled update ${version}`
        );

        return res.json({
            success: true,
            version,
            clients: users.size
        });
    }
);
app.post(
    "/api/admin/mute",
    requireAuth,
    (req, res) => {
        if (
            !isAdmin(
                req.session.user
            )
        ) {
            return res
                .status(403)
                .json({
                    error:
                        "Administrator access required."
                });
        }
    const userId =
        String(
            req.body.userId || ""
        ).trim();

    const minutes =
        Math.max(
            1,
            Math.min(
                10080,
                Number(
                    req.body.minutes
                ) || 5
            )
        );

    if (!userId) {
        return res
            .status(400)
            .json({
                error:
                    "User ID required."
            });
    }

    mutedUsers.set(
        userId,
        {
            moderator:
                req.session.user.id,

            expiresAt:
                Date.now() +
                minutes *
                    60 *
                    1000
        }
    );

    broadcast({
        type: "moderation",
        action: "mute",
        userId,
        duration: minutes
    });

    addLog(
        "ADMIN",
        "moderation",
        `${req.session.user.global_name || req.session.user.username || req.session.user.id} muted ${userId} for ${minutes} min`
    );

    return res.json({
        success: true
    });
}
);
app.post(
    "/api/admin/ban",
    requireAuth,
    (req, res) => {
        if (
            !isAdmin(
                req.session.user
            )
        ) {
            return res
                .status(403)
                .json({
                    error:
                        "Administrator access required."
                });
        }
    const userId =
        String(
            req.body.userId || ""
        ).trim();

    const minutes =
        Math.max(
            1,
            Math.min(
                525600,
                Number(
                    req.body.minutes
                ) || 60
            )
        );

    if (!userId) {
        return res
            .status(400)
            .json({
                error:
                    "User ID required."
            });
    }

    bannedUsers.set(
        userId,
        {
            moderator:
                req.session.user.id,

            expiresAt:
                Date.now() +
                minutes *
                    60 *
                    1000
        }
    );

    wss.clients.forEach(
        client => {
            if (
                client.user &&
                client.user.id ===
                    userId
            ) {
                send(
                    client,
                    {
                        type: "banned"
                    }
                );

                client.close(
                    4003,
                    "Banned"
                );
            }
        }
    );

    broadcast({
        type: "moderation",
        action: "ban",
        userId,
        duration: minutes
    });

    addLog(
        "ADMIN",
        "moderation",
        `${req.session.user.global_name || req.session.user.username || req.session.user.id} banned ${userId} for ${minutes} min`
    );

    return res.json({
        success: true
    });
}
);
app.post(
    "/api/admin/kick",
    requireAuth,
    (req, res) => {
        if (
            !isAdmin(
                req.session.user
            )
        ) {
            return res
                .status(403)
                .json({
                    error:
                        "Administrator access required."
                });
        }
    const userId =
        String(
            req.body.userId || ""
        ).trim();

    if (!userId) {
        return res
            .status(400)
            .json({
                error:
                    "User ID required."
            });
    }

    let kicked = false;

    wss.clients.forEach(
        client => {
            if (
                client.user &&
                client.user.id ===
                    userId
            ) {
                send(
                    client,
                    {
                        type: "kicked"
                    }
                );

                client.close(
                    4002,
                    "Kicked"
                );

                kicked = true;
            }
        }
    );

    addLog(
        "ADMIN",
        "moderation",
        kicked
            ? `${req.session.user.global_name || req.session.user.username || req.session.user.id} kicked ${userId}`
            : `${req.session.user.global_name || req.session.user.username || req.session.user.id} attempted to kick ${userId} (not connected)`
    );

    return res.json({
        success: true,
        kicked
    });
}
);
app.get(
    "/auth/logout",
    (req, res) => {
        req.session.destroy(
            error => {
                if (error) {
                    console.error(
                        "Logout error:",
                        error
                    );
                }
            res.clearCookie(
                "connect.sid",
                {
                    httpOnly: true,
                    sameSite: IS_PRODUCTION ? "none" : "lax",
                    secure: IS_PRODUCTION
                }
            );

            return res.redirect(
                APP_ORIGIN
                    ? `${APP_ORIGIN}/login.html`
                    : "/login.html"
            );
        }
    );
}
);
function createUpgradeResponse() {
    return {
        headers: {},
    setHeader(name, value) {
        this.headers[
            String(name).toLowerCase()
        ] = value;
    },

    getHeader(name) {
        return this.headers[
            String(name).toLowerCase()
        ];
    },

    removeHeader(name) {
        delete this.headers[
            String(name).toLowerCase()
        ];
    },

    writeHead() {},

    write() {},

    end() {}
};
}
server.on(
    "upgrade",
    (request, socket, head) => {
        const response =
            createUpgradeResponse();
    sessionMiddleware(
        request,
        response,
        () => {
            if (
                !request.session ||
                !request.session.user
            ) {
                socket.write(
                    "HTTP/1.1 401 Unauthorized\r\n" +
                    "Connection: close\r\n" +
                    "Content-Length: 0\r\n" +
                    "\r\n"
                );

                socket.destroy();

                return;
            }

            wss.handleUpgrade(
                request,
                socket,
                head,
                ws => {
                    wss.emit(
                        "connection",
                        ws,
                        request
                    );
                }
            );
        }
    );
}
);
wss.on(
    "connection",
    (socket, request) => {
        const user =
            request.session &&
            request.session.user;
    if (!user) {
        socket.close(
            4001,
            "Authentication required"
        );

        return;
    }

    const userId =
        String(user.id);

    if (isBanned(userId)) {
        socket.close(
            4003,
            "Banned"
        );

        return;
    }

    const existing =
        users.get(userId);

    if (
        existing &&
        existing.socket !== socket
    ) {
        existing.socket.close(
            4004,
            "Duplicate connection"
        );
    }

    const settings =
        getUserSettings(userId);

    const connection = {
        id: userId,

        username:
            user.username || null,

        global_name:
            user.global_name || null,

        display_name:
            settings.display_name || null,

        country:
            settings.country ||
            user.country ||
            null,

        socket,

        connectedAt:
            Date.now()
    };

    users.set(
        userId,
        connection
    );

    socket.user =
        connection;

    console.log(
        `User connected: ${getUserName(user)} (${userId})`
    );

    addLog(
        "INFO",
        "network",
        `User connected: ${getUserName(user)} (${userId})`
    );

    send(
        socket,
        {
            type: "server_status",
            onlineUsers:
                users.size
        }
    );

    send(
        socket,
        {
            type: "welcome",
            message:
                "Connected to Stardust Command Network."
        }
    );

    const publicUser =
        getPublicUser(user);

    send(
        socket,
        {
            type: "user",
            user: publicUser
        }
    );

    send(
        socket,
        {
            type: "identity",
            user: publicUser
        }
    );

    send(socket, {
        type: "orders",
        orders:
            getOrdersSnapshot()
    });

    send(socket, {
        type: "units",
        units:
            getUnitsSnapshot()
    });

    send(socket, {
        type: "version",
        version:
            getAppVersion()
    });

    send(socket, {
        type: "bases",
        bases:
            getVisibleBasesFor(
                connection
            )
    });

    send(socket, {
        type: "country_leaders",
        leaders:
            buildCountryLeaders()
    });

    send(socket, {
        type: "request_settings"
    });

    broadcastServerStatus();

    socket.on(
        "message",
        data => {
            try {
                const raw =
                    data.toString();

                if (
                    Buffer.byteLength(
                        raw,
                        "utf8"
                    ) > 4096
                ) {
                    send(
                        socket,
                        {
                            type: "error",
                            message:
                                "Message payload too large."
                        }
                    );

                    return;
                }

                const message =
                    JSON.parse(raw);

                if (
                    !message ||
                    typeof message !==
                        "object"
                ) {
                    return;
                }

                if (
                    message.type ===
                    "settings_push"
                ) {
                    const pushed =
                        message.settings ||
                        {};

                    const settings =
                        getUserSettings(
                            userId
                        );

                    if (
                        typeof pushed.display_name ===
                        "string"
                    ) {
                        const name =
                            cleanString(
                                pushed.display_name,
                                MAX_DISPLAY_NAME_LENGTH
                            );

                        if (name) {
                            settings.display_name =
                                name;
                        }
                    }

                    if (
                        typeof pushed.theme_color ===
                        "string" &&
                        /^#[0-9a-fA-F]{6}$/.test(
                            pushed.theme_color
                        )
                    ) {
                        settings.theme_color =
                            pushed.theme_color.toLowerCase();
                    }

                    if (
                        typeof pushed.country ===
                        "string" &&
                        pushed.country &&
                        !settings.country_claimed
                    ) {
                        settings.country =
                            cleanString(
                                pushed.country,
                                MAX_COUNTRY_LENGTH
                            );
                    }

                    if (
                        typeof pushed.do_not_disturb ===
                        "boolean"
                    ) {
                        settings.do_not_disturb =
                            pushed.do_not_disturb;
                    }

                    if (
                        typeof pushed.app_version ===
                        "string"
                    ) {
                        settings.app_version =
                            pushed.app_version;
                    }

                    userSettings.set(
                        userId,
                        settings
                    );

                    const connection =
                        users.get(
                            userId
                        );

                    if (connection) {
                        connection.display_name =
                            settings.display_name ||
                            null;

                        connection.country =
                            settings.country ||
                            null;

                        broadcastBases();
                    }

                    send(socket, {
                        type: "settings_applied",
                        settings
                    });

                    return;
                }

                if (
                    message.type ===
                    "orders_create"
                ) {
                    handleOrderCreate(
                        socket,
                        message,
                        userId
                    );

                    return;
                }

                if (
                    message.type ===
                    "client_version"
                ) {
                    handleClientVersion(
                        socket,
                        message
                    );

                    return;
                }

                if (
                    message.type ===
                    "orders_update"
                ) {
                    handleOrderUpdate(
                        socket,
                        message,
                        userId
                    );

                    return;
                }

                if (
                    message.type ===
                    "orders_delete"
                ) {
                    handleOrderDelete(
                        socket,
                        message,
                        userId
                    );

                    return;
                }

                if (
                    message.type ===
                    "units_create"
                ) {
                    handleUnitCreate(
                        socket,
                        message,
                        userId
                    );

                    return;
                }

                if (
                    message.type ===
                    "units_update"
                ) {
                    handleUnitUpdate(
                        socket,
                        message,
                        userId
                    );

                    return;
                }

                if (
                    message.type ===
                    "units_delete"
                ) {
                    handleUnitDelete(
                        socket,
                        message,
                        userId
                    );

                    return;
                }

                if (
                    message.type ===
                    "base_create"
                ) {
                    handleBaseCreate(
                        socket,
                        message,
                        userId
                    );

                    return;
                }

                if (
                    message.type ===
                    "base_upgrade"
                ) {
                    handleBaseUpgrade(
                        socket,
                        message,
                        userId
                    );

                    return;
                }

                if (
                    message.type ===
                    "base_delete"
                ) {
                    handleBaseDelete(
                        socket,
                        message,
                        userId
                    );

                    return;
                }

                if (
                    message.type !==
                    "chat"
                ) {
                    return;
                }

                if (
                    isBanned(userId)
                ) {
                    send(
                        socket,
                        {
                            type: "error",
                            message:
                                "You are banned."
                        }
                    );

                    return;
                }

                if (
                    isMuted(userId)
                ) {
                    send(
                        socket,
                        {
                            type: "error",
                            message:
                                "You are currently muted."
                        }
                    );

                    return;
                }

                if (
                    !checkRateLimit(
                        userId
                    )
                ) {
                    send(
                        socket,
                        {
                            type:
                                "rate_limited",

                            message:
                                "You are sending messages too quickly."
                        }
                    );

                    return;
                }

                const text =
                    cleanMessage(
                        message.message
                    );

                if (!text) {
                    send(
                        socket,
                        {
                            type: "error",

                            message:
                                "Invalid or empty message."
                        }
                    );

                    return;
                }

                let channel =
                    typeof message.channel ===
                    "string"
                        ? message.channel
                        : "world";

                if (
                    channel !== "world" &&
                    channel !== "country"
                ) {
                    channel =
                        "world";
                }

                const serverUser =
                    socket.user;

                const chatMessage = {
                    type: "chat",

                    channel,

                    userId:
                        serverUser.id,

                    username:
                        getUserName(
                            serverUser
                        ),

                    global_name:
                        serverUser.global_name ||
                        null,

                    country:
                        serverUser.country ||
                        null,

                    message:
                        text,

                    timestamp:
                        Date.now()
                };

                addLog(
                    "CHAT",
                    channel,
                    `${getUserName(serverUser)}: ${text}`
                );

                if (
                    channel ===
                    "country"
                ) {
                    const country =
                        serverUser.country;

                    if (!country) {
                        send(
                            socket,
                            {
                                type:
                                    "error",

                                message:
                                    "You are not assigned to a country."
                            }
                        );

                        return;
                    }

                    broadcast(
                        chatMessage,
                        client => {
                            return (
                                client.user &&
                                client.user.country ===
                                    country
                            );
                        }
                    );
                } else {
                    broadcast(
                        chatMessage
                    );
                }
            } catch (error) {
                console.error(
                    "Invalid WebSocket message:",
                    error.message
                );

                send(
                    socket,
                    {
                        type: "error",

                        message:
                            "Invalid message format."
                    }
                );
            }
        }
    );

    socket.on(
        "close",
        () => {
            const current =
                users.get(
                    userId
                );

            if (
                current &&
                current.socket ===
                    socket
            ) {
                users.delete(
                    userId
                );
            }

            console.log(
                `User disconnected: ${getUserName(user)} (${userId})`
            );

            addLog(
                "INFO",
                "network",
                `User disconnected: ${getUserName(user)} (${userId})`
            );

            broadcastServerStatus();
        }
    );

    socket.on(
        "error",
        error => {
            console.error(
                "WebSocket error:",
                error.message
            );
        }
    );
}
);
setInterval(
    () => {
        const now =
            Date.now();
    for (
        const [
            userId,
            history
        ] of messageHistory
    ) {
        const recent =
            history.filter(
                timestamp =>
                    now -
                        timestamp <=
                    RATE_WINDOW
            );

        if (
            recent.length ===
            0
        ) {
            messageHistory.delete(
                userId
            );
        } else {
            messageHistory.set(
                userId,
                recent
            );
        }
    }

    for (
        const [
            userId,
            mute
        ] of mutedUsers
    ) {
        if (
            mute.expiresAt &&
            now >=
                mute.expiresAt
        ) {
            mutedUsers.delete(
                userId
            );
        }
    }

    for (
        const [
            userId,
            ban
        ] of bannedUsers
    ) {
        if (
            ban.expiresAt &&
            now >=
                ban.expiresAt
        ) {
            bannedUsers.delete(
                userId
            );
        }
    }
},
30000
);
server.on(
    "error",
    error => {
        console.error(
            "Stardust server error:",
            error
        );
    }
);
server.listen(
    PORT,
    HOST,
    () => {
            console.log("Stardust server running on " + HOST + ":" + PORT);

    const loadedBases =
        loadBasesFromFile();

    console.log(
        `Military bases loaded: ${loadedBases}`
    );

    addLog(
        "INFO",
        "server",
        `Stardust server running on ${HOST}:${PORT}`
    );
    console.log(
        `Public access should be provided through Cloudflare + Nginx.`
    );

    console.log(
        `Admin accounts configured: ${ADMIN_IDS.size}`
    );

    console.log(
        `Environment: ${
            IS_PRODUCTION
                ? "production"
                : "development"
        }`
    );

    console.log(
        `Client path: ${clientPath}`
    );

    console.log(
        `Tiles path: ${tilesPath}`
    );

    syncUpdatesFromGitHub();
    setInterval(
        syncUpdatesFromGitHub,
        UPDATES_SYNC_INTERVAL
    );
}
);