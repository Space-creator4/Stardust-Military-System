"use strict";

/* STARDUST — TACTICAL LIVE ENGINE
 *
 * Turns the project's military units into "programs": server-authoritative,
 * real-time simulated entities every logged-in player sees moving on the map
 * (a live shared picture). Supports:
 *
 *   - autonomous movement for real units (move tasks from the orders sandbox),
 *   - hostile "threat" objects spawned by admins (station/patrol/move/attack),
 *   - one second telemetry history per entity for 3D trails + charts,
 *   - map objectives derived from ACTIVE orders that carry a target location.
 *
 * No playback timeline: everything runs on the server clock and is broadcast
 * to all WebSocket clients at ~1 Hz via `sim_telemetry`.
 */

const TICK_MS = 1000;
const HISTORY_MAX = 36;
const MAX_THREATS = 32;
const R_EARTH = 6371000;

const TYPE_SPEED_MS = {
    infantry: 2.2,
    armour: 16,
    mechanized: 18,
    recon: 20,
    artillery: 12,
    logistics: 15,
    air: 240,
    helicopter: 65,
    naval: 16
};

const TYPE_ALT_M = {
    infantry: 12,
    armour: 14,
    mechanized: 14,
    recon: 12,
    artillery: 10,
    logistics: 12,
    air: 8200,
    helicopter: 950,
    naval: 9
};

const THREAT_KINDS = [
    "infantry",
    "tank",
    "sam",
    "radar",
    "truck",
    "aircraft",
    "bomber",
    "uav",
    "helicopter",
    "missile",
    "warship",
    "carrier",
    "ship",
    "submarine"
];

const THREAT_SPEED_MS = {
    infantry: 2.4,
    tank: 15,
    sam: 0,
    radar: 0,
    truck: 14,
    aircraft: 235,
    bomber: 205,
    uav: 45,
    helicopter: 62,
    missile: 640,
    warship: 13,
    carrier: 16,
    ship: 10,
    submarine: 14
};

const THREAT_ALT_M = {
    infantry: 10,
    tank: 10,
    sam: 8,
    radar: 12,
    truck: 10,
    aircraft: 7600,
    bomber: 9200,
    uav: 3200,
    helicopter: 700,
    missile: 4200,
    warship: 6,
    carrier: 9,
    ship: 5,
    submarine: -150
};

const THREAT_PATROL_KM = {
    infantry: 3,
    tank: 6,
    sam: 0,
    radar: 0,
    truck: 4,
    aircraft: 40,
    bomber: 45,
    uav: 15,
    helicopter: 12,
    missile: 25,
    warship: 12,
    carrier: 14,
    ship: 8,
    submarine: 10
};

const toRad = d => (d * Math.PI) / 180;
const toDeg = r => (r * 180) / Math.PI;

function normalizeHeading(deg) {
    let h = deg % 360;
    if (h < -180) h += 360;
    if (h > 180) h -= 360;
    return h;
}

function haversineM(lat1, lon1, lat2, lon2) {
    const f1 = toRad(lat1);
    const f2 = toRad(lat2);
    const df = toRad(lat2 - lat1);
    const dl = toRad(lon2 - lon1);
    const a =
        Math.sin(df / 2) * Math.sin(df / 2) +
        Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return 2 * R_EARTH * Math.asin(Math.sqrt(a));
}

function initialBearing(lat1, lon1, lat2, lon2) {
    const f1 = toRad(lat1);
    const f2 = toRad(lat2);
    const dl = toRad(lon2 - lon1);
    const y = Math.sin(dl) * Math.cos(f2);
    const x =
        Math.cos(f1) * Math.sin(f2) -
        Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
    return normalizeHeading(toDeg(Math.atan2(y, x)));
}

function destinationPoint(lat1, lon1, bearingDeg, distM) {
    const f1 = toRad(lat1);
    const l1 = toRad(lon1);
    const t = toRad(bearingDeg);
    const d = distM / R_EARTH;
    const f2 = Math.asin(
        Math.sin(f1) * Math.cos(d) +
        Math.cos(f1) * Math.sin(d) * Math.cos(t)
    );
    const l2 =
        l1 +
        Math.atan2(
            Math.sin(t) * Math.sin(d) * Math.cos(f1),
            Math.cos(d) - Math.sin(f1) * Math.sin(f2)
        );
    return {
        lat: toDeg(f2),
        lon: normalizeHeading(toDeg(l2))
    };
}

function roundPos(v) {
    return Math.round(v * 100000) / 100000;
}

function readPositionPayload(payload) {
    const lat = Number(payload && payload.lat);
    const lon = Number(payload && payload.lon);
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
    return { lat, lon };
}

function createTactical(context) {
    const ctx = context || {};
    const units = ctx.units;
    const orders = ctx.orders;
    const crypto = require("crypto");

    const states = new Map();
    const threats = new Map();
    let threatOrdinal = 0;

    function err(socket, message) {
        ctx.send(socket, {
            type: "error",
            code: "tacview",
            message
        });
    }

    function log(msg) {
        if (ctx.addLog) {
            ctx.addLog("INFO", "tacview", msg);
        } else {
            console.log("[tacview]", msg);
        }
    }

    function makeThreatId() {
        threatOrdinal += 1;
        return (
            "THR-" +
            crypto
                .randomBytes(3)
                .toString("hex")
                .toUpperCase() +
            "-" +
            String(threatOrdinal % 9999).padStart(4, "0")
        );
    }

    function seedState(unit) {
        let st = states.get(unit.id);
        const alt =
            Number(TYPE_ALT_M[unit.type]) ||
            12;
        if (!st) {
            st = {
                alt,
                heading: unit.heading ||
                    Math.round(Math.random() * 360),
                speed: 0,
                vspeed: 0,
                history: [],
                task: unit.task || null,
                controller: unit.controller || null,
                updatedAt: Date.now()
            };
            states.set(unit.id, st);
        } else if (
            !Number.isFinite(st.alt) ||
            st.alt === undefined
        ) {
            st.alt = alt;
        }
        st.lat = Number(unit.lat);
        st.lon = Number(unit.lon);
        return st;
    }

    function pushHistory(st, now, force) {
        if (
            !force &&
            st.lastHistoryAt &&
            now - st.lastHistoryAt < 5000
        ) {
            return;
        }
        st.lastHistoryAt = now;
        st.history.push({
            t: now,
            lat: st.lat,
            lon: st.lon,
            alt: Math.round(st.alt),
            heading: Math.round(st.heading),
            spd: Math.round((st.speed || 0) * 1.94384)
        });
        if (st.history.length > HISTORY_MAX) {
            st.history.shift();
        }
    }

    function tickAll(dtMs) {
        const now = Date.now();
        const dt = dtMs / 1000;
        const events = [];
        let changed = false;

        for (const unit of units.values()) {
            const st = seedState(unit);
            const speedBase =
                unit.status === "RESERVE"
                    ? 0
                    : (Number(TYPE_SPEED_MS[unit.type]) || 3);

            let moved = false;
            if (st.task && st.task.kind === "move") {
                const target = st.task;
                const distM = haversineM(
                    st.lat,
                    st.lon,
                    target.lat,
                    target.lon
                );
                const stepM = speedBase * dt;
                if (distM <= Math.max(stepM, 8)) {
                    st.lat = target.lat;
                    st.lon = target.lon;
                    st.speed = 0;
                    st.task = null;
                    st.controller = null;
                    if (unit.status === "MOVING") {
                        unit.status = "OPERATIONAL";
                    }
                    unit.updatedAt = now;
                    changed = true;
                    events.push({
                        type: "task_complete",
                        unitId: unit.id,
                        name: unit.name,
                        at: now
                    });
                    log(
                        `${unit.name} (${unit.id}) reached objective`
                    );
                } else {
                    const bearing = initialBearing(
                        st.lat,
                        st.lon,
                        target.lat,
                        target.lon
                    );
                    const p = destinationPoint(
                        st.lat,
                        st.lon,
                        bearing,
                        stepM
                    );
                    st.lat = roundPos(p.lat);
                    st.lon = roundPos(p.lon);
                    st.heading = bearing;
                    st.speed = speedBase;
                    moved = true;
                }
            } else if (speedBase > 0 && unit.status === "MOVING") {
                const p = destinationPoint(
                    st.lat,
                    st.lon,
                    st.heading,
                    speedBase * dt
                );
                st.lat = roundPos(p.lat);
                st.lon = roundPos(p.lon);
                st.speed = speedBase;
                moved = true;
            } else {
                st.speed = 0;
            }

            if (st.task && st.task.kind === "move") {
                st.vspeed = 0;
            } else {
                const targetMiss =
                    Math.abs(
                        (Number(TYPE_ALT_M[unit.type]) || 12) -
                            st.alt
                    );
                if (targetMiss > 120 && speedBase > 0) {
                    const step = Math.min(
                        targetMiss,
                        120 * dt
                    );
                    st.alt +=
                        targetMiss > 0 ? step : 0;
                    st.vspeed = step / Math.max(dt, 0.001);
                    moved = true;
                } else {
                    st.alt =
                        Number(TYPE_ALT_M[unit.type]) || 12;
                    st.vspeed = 0;
                }
            }

            if (moved) {
                unit.lat = st.lat;
                unit.lon = st.lon;
                unit.heading = Math.round(st.heading);
            }
            pushHistory(st, now, moved);
            changed = changed || moved;
        }

        for (const thr of threats.values()) {
            const speedBase =
                Number(THREAT_SPEED_MS[thr.kind]) || 0;
            let moved = false;

            if (thr.task && thr.task.kind === "attack") {
                const target = units.get(thr.task.targetId);
                const engaged = !!target;
                if (engaged) {
                    const distM = haversineM(
                        thr.lat,
                        thr.lon,
                        target.lat,
                        target.lon
                    );
                    if (distM <= thr.task.fuseM) {
                        threats.delete(thr.id);
                        events.push({
                            type: "strike",
                            threatId: thr.id,
                            threatName: thr.name,
                            targetId: target.id,
                            targetName: target.name,
                            at: now
                        });
                        log(
                            `${thr.name} engaged ${target.name}`
                        );
                        changed = true;
                        continue;
                    }
                    const bearing = initialBearing(
                        thr.lat,
                        thr.lon,
                        target.lat,
                        target.lon
                    );
                    const p = destinationPoint(
                        thr.lat,
                        thr.lon,
                        bearing,
                        speedBase * dt
                    );
                    thr.lat = roundPos(p.lat);
                    thr.lon = roundPos(p.lon);
                    thr.heading = bearing;
                    thr.speed = speedBase;
                    moved = true;
                } else {
                    thr.task = {
                        kind: "patrol",
                        originLat: thr.lat,
                        originLon: thr.lon,
                        radiusKm:
                            THREAT_PATROL_KM[thr.kind] || 5
                    };
                }
            } else if (
                thr.task &&
                thr.task.kind === "patrol"
            ) {
                const origin =
                    thr.task.originLat !== undefined
                        ? thr.task
                        : { originLat: thr.lat, originLon: thr.lon };
                const radius =
                    Number(origin.radiusKm) || 5;
                const fromOrigin = haversineM(
                    thr.lat,
                    thr.lon,
                    origin.originLat,
                    origin.originLon
                );
                if (fromOrigin > radius * 1000) {
                    const bearing = initialBearing(
                        thr.lat,
                        thr.lon,
                        origin.originLat,
                        origin.originLon
                    );
                    const p = destinationPoint(
                        thr.lat,
                        thr.lon,
                        bearing,
                        speedBase * dt
                    );
                    thr.lat = roundPos(p.lat);
                    thr.lon = roundPos(p.lon);
                    thr.heading = bearing;
                    thr.speed = speedBase;
                    moved = true;
                } else {
                    thr.heading = normalizeHeading(
                        thr.heading + (dt * 6)
                    );
                    const p = destinationPoint(
                        thr.lat,
                        thr.lon,
                        thr.heading,
                        speedBase * dt
                    );
                    thr.lat = roundPos(p.lat);
                    thr.lon = roundPos(p.lon);
                    thr.speed = speedBase;
                    moved = true;
                }
            } else if (
                thr.task &&
                thr.task.kind === "move"
            ) {
                const target = thr.task;
                const distM = haversineM(
                    thr.lat,
                    thr.lon,
                    target.lat,
                    target.lon
                );
                const stepM = speedBase * dt;
                if (distM <= Math.max(stepM, 8)) {
                    thr.lat = target.lat;
                    thr.lon = target.lon;
                    thr.speed = 0;
                    thr.task = {
                        kind: "station"
                    };
                } else {
                    const bearing = initialBearing(
                        thr.lat,
                        thr.lon,
                        target.lat,
                        target.lon
                    );
                    const p = destinationPoint(
                        thr.lat,
                        thr.lon,
                        bearing,
                        stepM
                    );
                    thr.lat = roundPos(p.lat);
                    thr.lon = roundPos(p.lon);
                    thr.heading = bearing;
                    thr.speed = speedBase;
                    moved = true;
                }
            } else {
                thr.speed = 0;
            }

            const wantAlt = Number(THREAT_ALT_M[thr.kind]) || 10;
            if (Math.abs(wantAlt - thr.alt) > 100 && speedBase > 0) {
                const step = Math.min(
                    Math.abs(wantAlt - thr.alt),
                    140 * dt
                );
                thr.alt += wantAlt > thr.alt ? step : -step;
                moved = true;
            } else {
                thr.alt = wantAlt;
            }
            pushHistory(thr, now, moved);
            changed = changed || moved;
        }

        return { changed: changed || events.length > 0, events };
    }

    function getPayload() {
        const now = Date.now();
        const unitPayload = [];
        for (const unit of units.values()) {
            const st = seedState(unit);
            unitPayload.push({
                id: unit.id,
                name: unit.name,
                type: unit.type,
                team: "ally",
                country: unit.country || null,
                status: unit.status,
                personnel: unit.personnel,
                base: unit.base || null,
                lat: st.lat,
                lon: st.lon,
                alt: Math.round(st.alt),
                heading: Math.round(st.heading),
                speed: Math.round((st.speed || 0) * 1.94384),
                vspeed: Math.round(st.vspeed || 0),
                task: st.task
                    ? {
                          kind: st.task.kind,
                          lat:
                              st.task.kind === "move"
                                  ? st.task.lat
                                  : undefined,
                          lon:
                              st.task.kind === "move"
                                  ? st.task.lon
                                  : undefined,
                          label: st.task.label || null,
                          assignedAt: st.task.assignedAt || null
                      }
                    : null,
                controller: st.controller || null,
                history: st.history
            });
        }

        const threatPayload = [];
        for (const thr of threats.values()) {
            threatPayload.push({
                id: thr.id,
                name: thr.name,
                kind: thr.kind,
                team: "threat",
                country: thr.country || "HOSTILE",
                status: thr.status || "MOVING",
                lat: thr.lat,
                lon: thr.lon,
                alt: Math.round(thr.alt),
                heading: Math.round(thr.heading),
                speed: Math.round((thr.speed || 0) * 1.94384),
                vspeed: Math.round(thr.vspeed || 0),
                task: thr.task || null,
                history: thr.history
            });
        }

        const objectives = [];
        for (const order of orders.values()) {
            if (
                order.status !== "ACTIVE" ||
                !order.target ||
                !Number.isFinite(order.target.lat) ||
                !Number.isFinite(order.target.lon)
            ) {
                continue;
            }
            objectives.push({
                id: order.id,
                name: order.name,
                type: order.type,
                priority: order.priority,
                lat: order.target.lat,
                lon: order.target.lon,
                label: order.target.label || null,
                createdBy: order.createdBy || null,
                createdAt: order.createdAt
            });
        }

        return {
            type: "sim_telemetry",
            t: now,
            units: unitPayload,
            threats: threatPayload,
            objectives
        };
    }

    function broadcast() {
        const payload = getPayload();
        if (ctx.broadcastTac) {
            ctx.broadcastTac(payload);
        } else if (ctx.broadcast) {
            ctx.broadcast(payload);
        }
    }

    function handleSimMove(socket, message) {
        const id = ctx.cleanString(message.unitId, 32);
        const unit = id ? units.get(id) : null;
        if (!unit) {
            err(socket, "Unit not found.");
            return;
        }
        if (!ctx.canManageUnit(socket.user, unit)) {
            err(
                socket,
                "You do not have command authority over this unit."
            );
            return;
        }
        const position = readPositionPayload(message);
        if (!position) {
            err(
                socket,
                "Target position (valid lat/lon) is required."
            );
            return;
        }
        const label =
            ctx.cleanString(message.label, 60) || unit.name;

        unit.status = "MOVING";
        unit.updatedAt = Date.now();
        const st = seedState(unit);
        st.controller = {
            id: String(socket.user.id),
            username: ctx.getUserName(socket.user)
        };
        st.task = {
            kind: "move",
            lat: position.lat,
            lon: position.lon,
            label,
            assignedAt: Date.now()
        };

        log(
            `${ctx.getUserName(socket.user)} ordered ${unit.name} (${unit.id}) to ${label}`
        );
        if (ctx.scheduleBroadcastUnits) {
            ctx.scheduleBroadcastUnits();
        }
        ctx.send(socket, {
            type: "sim_event",
            kind: "move_assigned",
            unitId: unit.id,
            message: `${unit.name} is moving to ${label}`
        });
        broadcast();
    }

    function handleSimCancel(socket, message) {
        const id = ctx.cleanString(message.unitId, 32);
        const unit = id ? units.get(id) : null;
        if (!unit) {
            err(socket, "Unit not found.");
            return;
        }
        if (!ctx.canManageUnit(socket.user, unit)) {
            err(
                socket,
                "You do not have command authority over this unit."
            );
            return;
        }
        const st = states.get(unit.id);
        if (st) {
            st.task = null;
            st.controller = null;
            st.speed = 0;
        }
        if (unit.status === "MOVING") {
            unit.status = "OPERATIONAL";
        }
        unit.updatedAt = Date.now();
        log(
            `${ctx.getUserName(socket.user)} recalled ${unit.name} (${unit.id})`
        );
        if (ctx.scheduleBroadcastUnits) {
            ctx.scheduleBroadcastUnits();
        }
        ctx.send(socket, {
            type: "sim_event",
            kind: "task_cancelled",
            unitId: unit.id,
            message: `${unit.name} task cancelled`
        });
        broadcast();
    }

    function handleSimSpawn(socket, message) {
        if (!ctx.isAdmin || !ctx.isAdmin(socket.user)) {
            err(
                socket,
                "Only administrators can spawn hostile tracks."
            );
            return;
        }
        const kind = ctx.cleanString(message.kind, 32);
        if (!THREAT_KINDS.includes(kind)) {
            err(
                socket,
                `Unknown threat type. Valid: ${THREAT_KINDS.join(", ")}`
            );
            return;
        }
        const position = readPositionPayload(message);
        if (!position) {
            err(
                socket,
                "Threat position (valid lat/lon) is required."
            );
            return;
        }
        if (threats.size >= MAX_THREATS) {
            err(
                socket,
                `Threat limit reached (${MAX_THREATS}). Despawn a hostile track first.`
            );
            return;
        }
        const baseName =
            ctx.cleanString(message.name, 80) ||
            "HOSTILE " + kind.toUpperCase();
        const threat = {
            id: makeThreatId(),
            name: baseName,
            kind,
            team: "threat",
            country:
                ctx.cleanString(message.country, 60) ||
                "HOSTILE",
            lat: position.lat,
            lon: position.lon,
            alt: THREAT_ALT_M[kind] || 10,
            heading: Math.round(Math.abs(Math.cos(threatOrdinal) * 360)),
            speed: 0,
            vspeed: 0,
            status: "MOVING",
            task:
                THREAT_SPEED_MS[kind] > 0
                    ? {
                          kind: "patrol",
                          originLat: position.lat,
                          originLon: position.lon,
                          radiusKm:
                              THREAT_PATROL_KM[kind] || 5
                      }
                    : { kind: "station" },
            history: [],
            spawnedBy: {
                id: String(socket.user.id),
                username: ctx.getUserName(socket.user)
            },
            createdAt: Date.now()
        };
        threats.set(threat.id, threat);

        log(
            `${ctx.getUserName(socket.user)} spawned hostile track "${baseName}" (${threat.id})`
        );
        ctx.send(socket, {
            type: "sim_event",
            kind: "threat_spawned",
            threatId: threat.id,
            message: `Hostile track ${baseName} spawned`
        });
        broadcast();
    }

    function handleSimDespawn(socket, message) {
        const id = ctx.cleanString(message.threatId, 16);
        const threat = id ? threats.get(id) : null;
        if (!threat) {
            err(socket, "Hostile track not found.");
            return;
        }
        const isAdmin =
            ctx.isAdmin && ctx.isAdmin(socket.user);
        const isOwner =
            threat.spawnedBy &&
            String(threat.spawnedBy.id) ===
                String(socket.user.id);
        if (!isAdmin && !isOwner) {
            err(
                socket,
                "Only the spawning operator or an admin can despawn this track."
            );
            return;
        }
        threats.delete(id);
        log(
            `${ctx.getUserName(socket.user)} despawned hostile track "${threat.name}" (${id})`
        );
        ctx.send(socket, {
            type: "sim_event",
            kind: "threat_despawned",
            threatId: id,
            message: `Hostile track ${threat.name} despawned`
        });
        broadcast();
    }

    function handleSimThreatMove(socket, message) {
        const id = ctx.cleanString(message.threatId, 16);
        const threat = id ? threats.get(id) : null;
        if (!threat) {
            err(socket, "Hostile track not found.");
            return;
        }
        const isAdmin =
            ctx.isAdmin && ctx.isAdmin(socket.user);
        const isOwner =
            threat.spawnedBy &&
            String(threat.spawnedBy.id) ===
                String(socket.user.id);
        if (!isAdmin && !isOwner) {
            err(
                socket,
                "Only the spawning operator or an admin can control this track."
            );
            return;
        }
        if (message.action === "attack") {
            const targetId = ctx.cleanString(message.targetId, 32);
            const target = targetId ? units.get(targetId) : null;
            if (!target) {
                err(socket, "Target unit not found.");
                return;
            }
            threat.task = {
                kind: "attack",
                targetId: target.id,
                fuseM: Math.max(300, Number(message.fuseKm || 0) * 1000)
            };
            threat.status = "ENGAGING";
            log(
                `${threat.name} (${threat.id}) engaging ${target.name}`
            );
            ctx.send(socket, {
                type: "sim_event",
                kind: "threat_engaging",
                threatId: threat.id,
                targetId: target.id,
                message: `${threat.name} is engaging ${target.name}`
            });
            broadcast();
            return;
        }
        const position = readPositionPayload(message);
        if (!position) {
            err(
                socket,
                "Target position (valid lat/lon) is required."
            );
            return;
        }
        threat.task = {
            kind: "move",
            lat: position.lat,
            lon: position.lon
        };
        threat.status = "MOVING";
        ctx.send(socket, {
            type: "sim_event",
            kind: "threat_moving",
            threatId: threat.id,
            message: `${threat.name} is moving`
        });
        broadcast();
    }

    return {
        tick: tickAll,
        getPayload,
        broadcast,
        handleSimMove,
        handleSimCancel,
        handleSimSpawn,
        handleSimDespawn,
        handleSimThreatMove,
        threatCount: () => threats.size,
        threatKinds: THREAT_KINDS.slice()
    };
}

module.exports = {
    createTactical,
    TICK_MS,
    MAX_THREATS,
    THREAT_KINDS,
    TYPE_SPEED_MS,
    THREAT_SPEED_MS
};