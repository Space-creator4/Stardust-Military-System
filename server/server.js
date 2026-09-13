const dotenv = require("dotenv");
dotenv.config();
const express = require("express");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const session = require("express-session");
const WebSocket = require("ws");
const app = express();
const server = http.createServer(app);
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "127.0.0.1";
const clientPath = path.join(__dirname, "..", "client");
const tilesPath = path.join(__dirname, "tiles");
const IS_PRODUCTION =
    String(process.env.NODE_ENV || "").toLowerCase() === "production";
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
        sameSite: "lax",
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
    }
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
    res.json({
        version: getAppVersion(),
        timestamp: Date.now()
    });
});
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
        return res
            .status(400)
            .send(
                "Missing Discord OAuth information."
            );
    }

    if (
        !req.session.oauthState ||
        state !== req.session.oauthState
    ) {
        return res
            .status(403)
            .send(
                "Invalid OAuth state."
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

            return res
                .status(500)
                .send(
                    "Discord login failed."
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

            return res
                .status(500)
                .send(
                    "Could not retrieve Discord account."
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

                    return res
                        .status(500)
                        .send(
                            "Could not save login session."
                        );
                }

                return res.redirect("/");
            }
        );
    } catch (error) {
        console.error(
            "Discord OAuth error:",
            error
        );

        return res
            .status(500)
            .send(
                "Discord authentication failed."
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
            )
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
                    sameSite: "lax",
                    secure: IS_PRODUCTION
                }
            );

            return res.redirect(
                "/login.html"
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
}
);