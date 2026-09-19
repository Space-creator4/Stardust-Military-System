/* STARDUST TACTICAL OVERLAY
   Live shared picture: 3D unit models + trails, objectives, inspector with
   charts, and a ground/unit / threat context menu ("units-to-orders sandbox").
   Purely additive - if this script fails to load, the classic map still works.

   Integration contract (set by renderer.js):
     window.stardustViewer          -> Cesium viewer
     window.stardustSend(msg)       -> send WS JSON (true if connected)
     window.currentUser             -> { isAdmin, ... }
     window.stardustUnitFilter      -> optional unit type filter
     window.stardustHighlightUnitId -> unit id to auto-select */

(function () {

    if (typeof window.Cesium === "undefined" || !window.TacModels) {
        console.warn("tacview-map.js: disabling (Cesium or TacModels missing).");
        window.TacView = null;
        return;
    }

    const C = Cesium;

    const TYPE_COLORS = {
        infantry: "#62d18b",
        armour: "#f0b94d",
        mechanized: "#4d9bf0",
        recon: "#38a6a5",
        artillery: "#e31a1c",
        logistics: "#b084d9",
        air: "#7ec8e3",
        helicopter: "#7ec8e3",
        naval: "#8f9fe0"
    };

    const THREAT_COLOR = "#ff6b57";
    const OBJECTIVE_COLOR = "#5ee6a0";
    const SELECTED_COLOR = "#ffffff";

    const GROUND_TYPES = new Set([
        "infantry", "armour", "mechanized", "recon",
        "artillery", "logistics", "tank", "sam", "radar", "truck"
    ]);

    const GROUND_LIFT = {
        infantry: 0.3, armour: 0.4, mechanized: 0.4,
        recon: 0.3, artillery: 0.3, logistics: 0.3,
        tank: 0.2, sam: 0.25, radar: 0.3, truck: 0.3
    };

    const LOD_DETAIL_M = 260000;

    const COL_LABEL = C.Color.fromCssColorString("#e7eef6");
    const COL_OUTLINE = C.Color.BLACK.withAlpha(0.9);
    const COL_BG = C.Color.BLACK.withAlpha(0.65);

    /* ------------------------------- state -------------------------------- */

    let viewer = null;
    let enabled = false;
    let lastPayload = null;
    let lastUnits = [];
    let lastOrders = [];

    const actors = new Map();
    const objectiveEntities = new Map();

    let selectedId = null;
    let labelsOn = false;
    let objectivesOn = true;
    let trailsOn = true;

    const terrainCache = new Map();
    let lodQueued = false;
    let renderQueued = false;
    let chartQueued = false;
    let menuBound = false;
    let lastInspectorAt = 0;

    /* ------------------------------- helpers ------------------------------ */

    const colorCache = new Map();

    function cssToColor(css) {
        let c = colorCache.get(css);
        if (!c) {
            c = C.Color.fromCssColorString(css);
            colorCache.set(css, c);
        }
        return c;
    }

    function colorForUnit(type, team) {
        if (team === "threat") {
            return THREAT_COLOR;
        }
        return TYPE_COLORS[type] || TYPE_COLORS.infantry;
    }

    function hexToComponents(hex) {
        const c = cssToColor(hex);
        return [c.red, c.green, c.blue];
    }

    function typeKey(rec) {
        return rec.type || rec.kind || null;
    }

    function isGroundType(type) {
        return GROUND_TYPES.has(type);
    }

    function groundHeightAt(lat, lon, now) {
        const key = lat.toFixed(2) + "/" + lon.toFixed(2);
        const hit = terrainCache.get(key);
        if (hit && now - hit.t < 60000) {
            return hit.h;
        }
        let h = 0;
        try {
            const globe = viewer.scene.globe;
            if (globe) {
                const got = globe.getHeight(C.Cartographic.fromDegrees(lon, lat));
                if (Number.isFinite(got) && got > 0) {
                    h = got;
                }
            }
        } catch (error) {
            h = 0;
        }
        terrainCache.set(key, { h: h, t: now });
        if (terrainCache.size > 2000) {
            terrainCache.clear();
        }
        return h;
    }

    function actorAltFor(rec, now) {
        const tk = typeKey(rec);
        if (tk && isGroundType(tk)) {
            const lift = GROUND_LIFT[tk] != null ? GROUND_LIFT[tk] : 0.3;
            return groundHeightAt(rec.lat, rec.lon, now) + lift;
        }
        return Number.isFinite(rec.alt) ? rec.alt : 0;
    }

    function requestRender() {
        if (!viewer || renderQueued) {
            return;
        }
        renderQueued = true;
        requestAnimationFrame(function () {
            renderQueued = false;
            if (viewer) {
                viewer.scene.requestRender();
            }
        });
    }

    function scheduleLod() {
        if (lodQueued || !viewer) {
            return;
        }
        lodQueued = true;
        requestAnimationFrame(function () {
            lodQueued = false;
            applyLod();
        });
    }

    /* ---------------------------- actor objects --------------------------- */

    function actorLabel(rec) {
        if (rec.team === "threat") {
            return rec.name + " · " + String(rec.kind || "").toUpperCase();
        }
        return rec.name + " · " + String(rec.type || "").toUpperCase();
    }

    function makeActor(id, isThreat, rec) {
        const spec = isThreat
            ? window.TacModels.modelForThreatKind(rec.kind || rec.type)
            : window.TacModels.modelForUnitType(rec.type);

        const hex = colorForUnit(isThreat ? rec.kind : rec.type, isThreat ? "threat" : "ally");
        const comps = hexToComponents(hex);

        const model = window.TacModels.makePrimitive(
            spec.kind, comps[0], comps[1], comps[2], { tacId: id }
        );
        viewer.scene.primitives.add(model.primitive);

        const initial = C.Cartesian3.fromDegrees(rec.lon, rec.lat, 200);

        const pointEntity = viewer.entities.add({
            id: "sim:" + id,
            name: actorLabel(rec),
            position: initial,
            point: {
                pixelSize: isThreat ? 11 : 8,
                color: cssToColor(hex),
                outlineColor: COL_OUTLINE,
                outlineWidth: 1.5,
                heightReference: C.HeightReference.NONE
            },
            label: {
                text: actorLabel(rec),
                font: "600 10px 'Rajdhani', 'Segoe UI', sans-serif",
                fillColor: isThreat
                    ? cssToColor(THREAT_COLOR)
                    : COL_LABEL,
                pixelOffset: new C.Cartesian2(0, -14),
                showBackground: true,
                backgroundColor: COL_BG,
                position: initial,
                horizontalOrigin: C.HorizontalOrigin.CENTER,
                verticalOrigin: C.VerticalOrigin.BOTTOM,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
                style: C.LabelStyle.FILL
            },
            properties: {
                tacId: id,
                tacThreat: isThreat
            }
        });

        let trailColor = colorCache.get("t:" + hex);
        if (!trailColor) {
            trailColor = cssToColor(hex).withAlpha(0.85);
            colorCache.set("t:" + hex, trailColor);
        }

        const trailEntity = viewer.entities.add({
            id: "simtrail:" + id,
            polyline: {
                positions: [],
                width: isThreat ? 2.0 : 1.4,
                arcType: C.ArcType.NONE,
                material: new C.PolylineGlowMaterialProperty({
                    color: trailColor,
                    glowPower: 0.18,
                    taperPower: 0.4
                })
            }
        });

        return {
            id: id,
            isThreat: isThreat,
            kind: spec.kind,
            scale: spec.scale,
            model: model,
            pointEntity: pointEntity,
            trailEntity: trailEntity,
            lastRec: null,
            lastState: null
        };
    }

    function removeActor(id) {
        const actor = actors.get(id);
        if (!actor) {
            return;
        }
        window.TacModels.disposeModel(viewer.scene, actor.model);
        viewer.entities.remove(actor.pointEntity);
        viewer.entities.remove(actor.trailEntity);
        actors.delete(id);
        if (selectedId === id) {
            selectedId = null;
            renderInspector(null);
        }
    }

    function updateActor(actor, rec, now) {
        actor.lastRec = rec;

        const hex = selectedId === actor.id
            ? SELECTED_COLOR
            : colorForUnit(actor.isThreat ? rec.kind : rec.type, actor.isThreat ? "threat" : "ally");
        const comps = hexToComponents(hex);
        window.TacModels.setColor(actor.model, comps[0], comps[1], comps[2]);

        const alt = actorAltFor(rec, now);
        window.TacModels.setPose(actor.model, rec.lon, rec.lat, alt, rec.heading || 0, actor.scale);

        const position = C.Cartesian3.fromDegrees(rec.lon, rec.lat, alt);

        const point = actor.pointEntity;
        point.position = position;
        point.point.color = cssToColor(hex);
        point.point.pixelSize = selectedId === actor.id ? 13 : (actor.isThreat ? 11 : 8);
        point.point.outlineWidth = selectedId === actor.id ? 3 : 1.5;
        point.point.outlineColor = selectedId === actor.id
            ? C.Color.WHITE
            : COL_OUTLINE;
        point.label.text = actorLabel(rec);
        point.label.fillColor = actor.isThreat
            ? cssToColor(THREAT_COLOR)
            : (selectedId === actor.id
                ? C.Color.WHITE
                : COL_LABEL);

        updateTrail(actor, rec, now);
        actor.lastState = { lat: rec.lat, lon: rec.lon, alt: alt, heading: rec.heading || 0 };
    }

    function updateTrail(actor, rec, now) {
        const history = rec.history || null;
        if (!trailsOn || !actor.trailEntity.show || !history || history.length < 1) {
            actor.trailEntity.polyline.positions = [];
            return;
        }
        const tk = typeKey(rec);
        const isGround = tk && isGroundType(tk);
        const lift = isGround
            ? (GROUND_LIFT[tk] != null ? GROUND_LIFT[tk] : 0.3)
            : 0;
        const pts = [];
        for (const p of history) {
            let alt = p.alt || 0;
            if (isGround) {
                alt = groundHeightAt(p.lat, p.lon, now) + lift;
            }
            pts.push(C.Cartesian3.fromDegrees(p.lon, p.lat, alt));
        }
        const curAlt = actor.lastState ? actor.lastState.alt : actorAltFor(rec, now);
        pts.push(C.Cartesian3.fromDegrees(rec.lon, rec.lat, curAlt));
        actor.trailEntity.polyline.positions = pts;
    }

    /* -------------------------------- LOD ---------------------------------- */

    function applyLod() {
        if (!viewer) {
            return;
        }
        const height = viewer.camera.positionCartographic.height;
        const detail = height <= LOD_DETAIL_M;
        for (const actor of actors.values()) {
            const showModel = self.modelsVisible && detail;
            window.TacModels.setShow(actor.model, showModel);
            actor.trailEntity.show = showModel && trailsOn;
            actor.pointEntity.show = !showModel;
            actor.pointEntity.label.show = labelsOn;
        }
        requestRender();
    }

    /* ------------------------------ objectives ----------------------------- */

    function reconcileObjectives(list) {
        if (!viewer) {
            return;
        }
        const wanted = new Set();
        for (const obj of list || []) {
            wanted.add(obj.id);
            let entity = objectiveEntities.get(obj.id);
            const pos = C.Cartesian3.fromDegrees(obj.lon, obj.lat, 0);
            if (!entity) {
                entity = viewer.entities.add({
                    id: "simobj:" + obj.id,
                    position: new C.ConstantPositionProperty(pos),
                    point: {
                        pixelSize: 9,
                        color: cssToColor(OBJECTIVE_COLOR),
                        outlineColor: C.Color.BLACK,
                        outlineWidth: 1.5,
                        heightReference: C.HeightReference.CLAMP_TO_GROUND
                    },
                    label: {
                        text: "◈ " + (obj.name || "OBJECTIVE"),
                        font: "600 10px 'Rajdhani', 'Segoe UI', sans-serif",
                        fillColor: cssToColor(OBJECTIVE_COLOR),
                        pixelOffset: new C.Cartesian2(0, -12),
                        showBackground: true,
                        backgroundColor: C.Color.BLACK.withAlpha(0.6),
                        position: new C.ConstantPositionProperty(pos),
                        horizontalOrigin: C.HorizontalOrigin.CENTER,
                        verticalOrigin: C.VerticalOrigin.BOTTOM,
                        disableDepthTestDistance: Number.POSITIVE_INFINITY
                    },
                    properties: {
                        tacObjective: obj.id
                    }
                });
                objectiveEntities.set(obj.id, entity);
            } else {
                entity.position = new C.ConstantPositionProperty(pos);
                entity.point.position = new C.ConstantPositionProperty(pos);
                entity.label.position = new C.ConstantPositionProperty(pos);
                entity.label.text = "◈ " + (obj.name || "OBJECTIVE");
            }
            entity.show = objectivesOn;
        }
        for (const [id, entity] of objectiveEntities) {
            if (wanted.has(id)) {
                continue;
            }
            viewer.entities.remove(entity);
            objectiveEntities.delete(id);
        }
        requestRender();
    }

    /* ------------------------------- telemetry ----------------------------- */

    function applyTelemetry(payload) {
        if (!viewer || !enabled) {
            return;
        }
        const now = Date.now();
        const want = new Map();
        for (const u of payload.units || []) {
            want.set(u.id, { isThreat: false, rec: u });
        }
        for (const t of payload.threats || []) {
            want.set(t.id, { isThreat: true, rec: t });
        }

        for (const id of Array.from(actors.keys())) {
            if (!want.has(id)) {
                removeActor(id);
            }
        }

        const filter = window.stardustUnitFilter || null;

        for (const [id, entry] of want) {
            if (filter && !entry.isThreat && entry.rec.type !== filter) {
                if (actors.has(id)) {
                    removeActor(id);
                }
                continue;
            }
            let actor = actors.get(id);
            if (!actor) {
                actor = makeActor(id, entry.isThreat, entry.rec);
                actors.set(id, actor);
            }
            updateActor(actor, entry.rec, now);
        }

        if (payload.objectives) {
            reconcileObjectives(payload.objectives);
        }

        applyLod();

        if (
            selectedId &&
            actors.has(selectedId) &&
            now - lastInspectorAt >= 500
        ) {
            lastInspectorAt = now;
            scheduleInspector();
        }

        if (window.stardustHighlightUnitId && !selectedId) {
            const target = window.stardustHighlightUnitId;
            if (actors.has(target)) {
                selectActor(target, true);
            }
        }

        updateLiveCounts(payload);
        requestRender();
    }

    function updateLiveCounts(payload) {
        const countCell = document.getElementById("tacLiveCounts");
        if (!countCell) {
            return;
        }
        const total = payload.units ? payload.units.length : 0;
        const threats = payload.threats ? payload.threats.length : 0;
        const objs = payload.objectives ? payload.objectives.length : 0;
        countCell.textContent = "LIVE · U:" + total + " T:" + threats + " O:" + objs;
    }

    /* ------------------------------- selection ------------------------------ */

    function selectActor(id, fly) {
        const previous = selectedId;
        selectedId = id;
        if (previous && actors.has(previous)) {
            const rec = actors.get(previous).lastRec;
            if (rec) {
                updateActor(actors.get(previous), rec, Date.now());
            }
        }
        const actor = id ? actors.get(id) : null;
        if (actor && actor.lastRec) {
            updateActor(actor, actor.lastRec, Date.now());
        }
        renderInspector(actor);
        if (fly && actor && actor.lastState) {
            viewer.camera.flyTo({
                destination: C.Cartesian3.fromDegrees(
                    actor.lastState.lon,
                    actor.lastState.lat,
                    Math.max(actor.lastState.alt, 0) + 1800
                ),
                duration: 1.1
            });
        }
        requestRender();
    }

    function scheduleInspector() {
        if (chartQueued) {
            return;
        }
        chartQueued = true;
        requestAnimationFrame(function () {
            chartQueued = false;
            const actor = selectedId ? actors.get(selectedId) : null;
            if (actor && actor.lastRec) {
                renderInspector(actor);
            }
        });
    }

    function renderInspector(actor) {
        const panel = document.getElementById("tacInspector");
        if (!panel) {
            return;
        }
        if (!actor || !actor.lastRec) {
            panel.innerHTML = "";
            return;
        }
        const rec = actor.lastRec;
        const unitLabel = rec.team === "threat" ? "THREAT TRACK" : "ALLIED UNIT";
        const task = rec.task && rec.task.kind
            ? rec.task.kind.toUpperCase() +
                (rec.task.kind === "move"
                    ? " → " + (rec.task.label ||
                        (rec.task.lat.toFixed(2) + ", " + rec.task.lon.toFixed(2)))
                    : "")
            : "NONE";
        const controller = rec.controller
            ? (rec.controller.username || "unknown")
            : "—";
        const country = rec.country || "—";

        const rows = [
            ["STATUS", rec.status || "—"],
            ["TYPE", String(rec.type || rec.kind || "—").toUpperCase()],
            ["COUNTRY", country],
            ["PERSONNEL", rec.personnel != null ? String(rec.personnel) : "—"],
            ["TASK", task],
            ["CONTROLLER", controller],
            ["HEADING", Math.round(rec.heading || 0) + "°"],
            ["SPEED", Math.round(rec.speed || 0) + " kts"],
            ["ALT", Math.round(rec.alt || 0) + " m"],
            ["POSITION", rec.lat.toFixed(4) + ", " + rec.lon.toFixed(4)]
        ];

        const accent = actor.isThreat
            ? THREAT_COLOR
            : colorForUnit(rec.type, actor.isThreat ? "threat" : "ally");

        let html = "";
        html += '<div class="tac-inspector-head" style="border-left-color:' + accent + ';">' +
            '<span class="tac-inspector-title">' + escapeHtml(actorLabel(rec)) + '</span>' +
            '<span class="tac-inspector-kind">' + unitLabel + '</span></div>';
        for (const [k, v] of rows) {
            html += '<div class="tac-inspector-row"><span>' + k + '</span><span>' +
                escapeHtml(String(v)) + '</span></div>';
        }
        html += '<div class="tac-chart"><div class="tac-chart-label">ALTITUDE (M)</div>' +
            '<canvas id="tacChartAlt"></canvas></div>';
        html += '<div class="tac-chart"><div class="tac-chart-label">SPEED (KTS)</div>' +
            '<canvas id="tacChartSpeed"></canvas></div>';
        html += '<div class="tac-inspector-row tac-inspector-close"><span>CONTROL</span>' +
            '<button id="tacClearSel">CLEAR</button></div>';

        panel.innerHTML = html;

        const clearBtn = document.getElementById("tacClearSel");
        if (clearBtn) {
            clearBtn.addEventListener("click", function (event) {
                event.stopPropagation();
                selectActor(null, false);
            });
        }

        drawChart(document.getElementById("tacChartAlt"), historyOf(rec, "alt"), "#5ee6a0");
        drawChart(document.getElementById("tacChartSpeed"), historyOf(rec, "spd"), "#f0b94d");
    }

    function historyOf(rec, key) {
        const out = [];
        for (const p of rec.history || []) {
            const v = p[key];
            if (Number.isFinite(v)) {
                out.push(v);
            }
        }
        const cur = rec[key];
        if (Number.isFinite(cur)) {
            out.push(cur);
        }
        return out.length ? out : [0];
    }

    function drawChart(canvas, values, color) {
        if (!canvas) {
            return;
        }
        const dpr = window.devicePixelRatio || 1;
        const w = canvas.clientWidth || 210;
        const h = canvas.clientHeight || 54;
        canvas.width = Math.max(1, Math.floor(w * dpr));
        canvas.height = Math.max(1, Math.floor(h * dpr));
        const ctx = canvas.getContext("2d");
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        let min = Math.min.apply(null, values);
        let max = Math.max.apply(null, values);
        if (max - min < 1) {
            max = min + 1;
        }
        const pad = (max - min) * 0.15;
        min -= pad;
        max += pad;

        ctx.strokeStyle = "rgba(148,184,255,0.14)";
        ctx.lineWidth = 1;
        for (let i = 1; i < 4; i++) {
            const y = (h / 4) * i;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
        }

        const n = values.length;
        const px = function (i) { return n <= 1 ? w : (i / (n - 1)) * w; };
        const py = function (v) { return h - ((v - min) / (max - min)) * (h - 6) - 3; };

        ctx.beginPath();
        for (let i = 0; i < n; i++) {
            if (i === 0) {
                ctx.moveTo(px(i), py(values[i]));
            } else {
                ctx.lineTo(px(i), py(values[i]));
            }
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.6;
        ctx.stroke();

        const fillGrad = ctx.createLinearGradient(0, 0, 0, h);
        fillGrad.addColorStop(0, color + "26");
        fillGrad.addColorStop(1, color + "05");
        ctx.beginPath();
        ctx.moveTo(0, h);
        for (let i = 0; i < n; i++) {
            ctx.lineTo(px(i), py(values[i]));
        }
        ctx.lineTo(px(n - 1), h);
        ctx.closePath();
        ctx.fillStyle = fillGrad;
        ctx.fill();

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(px(n - 1), py(values[n - 1]), 2, 0, Math.PI * 2);
        ctx.fill();
    }

    function escapeHtml(text) {
        return String(text).replace(/[&<>"']/g, function (ch) {
            return {
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;"
            }[ch];
        });
    }

    /* ------------------------------ context menu --------------------------- */

    function groundFromScreen(position) {
        const cartesian = viewer.camera.pickEllipsoid(
            position,
            viewer.scene.globe.ellipsoid
        );
        if (!cartesian) {
            return null;
        }
        const carto = C.Cartographic.fromCartesian(cartesian);
        return {
            lat: C.Math.toDegrees(carto.latitude),
            lon: C.Math.toDegrees(carto.longitude)
        };
    }

    function pickActorId(position) {
        const picked = viewer.scene.pick(position);
        if (picked && picked.id) {
            const probe = picked.id;
            if (typeof probe === "object" && probe.tacId) {
                return probe.tacId;
            }
            if (probe.properties && probe.properties.tacId) {
                const raw = probe.properties.tacId;
                if (typeof raw === "object" && raw.getValue) {
                    return raw.getValue(C.JulianDate.now());
                }
                return raw;
            }
        }
        let best = null;
        let bestDist = 18;
        for (const actor of actors.values()) {
            if (!actor.lastState) {
                continue;
            }
            const pos = C.Cartesian3.fromDegrees(
                actor.lastState.lon,
                actor.lastState.lat,
                Math.max(actor.lastState.alt, 0) + 200
            );
            const win = C.SceneTransforms.worldToWindowCoordinates(viewer.scene, pos);
            if (!win) {
                continue;
            }
            const dx = win.x - position.x;
            const dy = win.y - position.y;
            const d = dx * dx + dy * dy;
            if (d < bestDist * bestDist) {
                bestDist = d;
                best = actor.id;
            }
        }
        return best && actors.has(best) ? best : null;
    }

    function openContextMenu(position, actorId, ground) {
        const menu = document.getElementById("tacContextMenu");
        if (!menu) {
            return;
        }
        const actor = actorId ? actors.get(actorId) : null;
        const selected = selectedId ? actors.get(selectedId) : null;
        const user = window.currentUser || null;
        const isAdmin = !!(user && user.isAdmin);

        let rows = "";

        if (actor) {
            const accent = actor.isThreat
                ? THREAT_COLOR
                : colorForUnit(actor.lastRec.type, actor.isThreat ? "threat" : "ally");
            rows += '<div class="tac-menu-head" style="border-left-color:' + accent + ';">' +
                escapeHtml(actorLabel(actor.lastRec)) + '</div>';
            rows += '<button class="tac-menu-item" data-act="select">FOCUS ENTITY</button>';
            if (actor.isThreat) {
                rows += '<button class="tac-menu-item" data-act="despawn">DESPAWN THREAT</button>';
                if (selected && !selected.isThreat) {
                    rows += '<button class="tac-menu-item" data-act="engage">THREAT ATTACK → ' +
                        escapeHtml(selected.lastRec.name) + '</button>';
                }
            } else {
                if (actor.lastRec && actor.lastRec.task && actor.lastRec.task.kind) {
                    rows += '<button class="tac-menu-item" data-act="cancel">CANCEL TASK</button>';
                }
                if (selected && selected.isThreat) {
                    rows += '<button class="tac-menu-item" data-act="engage">ENGAGE WITH THREAT</button>';
                }
            }
        } else if (ground) {
            rows += '<div class="tac-menu-head" style="border-left-color:#5ee6a0;">TARGET ' +
                ground.lat.toFixed(3) + ", " + ground.lon.toFixed(3) + "</div>";
            if (selected && !selected.isThreat) {
                rows += '<button class="tac-menu-item" data-act="move">MOVE ▲ ' +
                    escapeHtml(selected.lastRec ? selected.lastRec.name : "SELECTED") +
                    " HERE</button>";
                rows += '<button class="tac-menu-item" data-act="obj">OBJECTIVE HERE</button>';
            } else {
                rows += '<button class="tac-menu-item" data-act="obj">CREATE OBJECTIVE HERE</button>';
            }
            if (isAdmin) {
                rows += '<div class="tac-menu-spawn-label">SPAWN THREAT</div>';
                for (const kind of window.TacModels.THREAT_KINDS) {
                    rows += '<button class="tac-menu-item tac-menu-spawn" data-act="spawn" data-kind="' +
                        escapeHtml(kind) + '">' + String(kind).toUpperCase() + "</button>";
                }
            }
        } else {
            return;
        }

        menu.innerHTML = rows;
        menu.style.display = "block";
        const rect = viewer.container.getBoundingClientRect();
        let x = position.x;
        let y = position.y;
        const maxX = rect.width - menu.offsetWidth - 8;
        const maxY = rect.height - menu.offsetHeight - 8;
        if (x > maxX) x = maxX;
        if (y > maxY) y = maxY;
        menu.style.left = x + "px";
        menu.style.top = y + "px";

        menu._ground = ground || null;
        menu._actorId = actor ? actor.id : null;

        if (!menuBound) {
            menuBound = true;
            menu.addEventListener("click", function (event) {
                const row = event.target.closest
                    ? event.target.closest("[data-act]")
                    : null;
                if (!row) {
                    hideMenu();
                    return;
                }
                const act = row.getAttribute("data-act");
                handleMenuAction(act, menu._actorId, menu._ground, row.getAttribute("data-kind"));
                hideMenu();
            });
        }
    }

    function hideMenu() {
        const menu = document.getElementById("tacContextMenu");
        if (menu) {
            menu.style.display = "none";
        }
    }

    function handleMenuAction(act, actorId, ground, kind) {
        switch (act) {
            case "select": {
                selectActor(actorId, true);
                break;
            }
            case "move": {
                if (!ground || !selectedId) {
                    return;
                }
                sendSim({
                    type: "sim_move",
                    unitId: selectedId,
                    lat: ground.lat,
                    lon: ground.lon,
                    label: "MANUAL MOVE"
                });
                break;
            }
            case "cancel": {
                if (!actorId) {
                    return;
                }
                sendSim({ type: "sim_cancel", unitId: actorId });
                break;
            }
            case "despawn": {
                if (!actorId) {
                    return;
                }
                sendSim({ type: "sim_despawn", threatId: actorId });
                break;
            }
            case "engage": {
                const threatActor = actorId ? actors.get(actorId) : null;
                const unitId = threatActor && !threatActor.isThreat ? actorId : selectedId;
                const threatId = threatActor && threatActor.isThreat ? actorId : selectedId;
                if (!unitId || !threatId || unitId === threatId) {
                    return;
                }
                sendSim({
                    type: "sim_threat_move",
                    threatId: threatId,
                    action: "attack",
                    targetId: unitId,
                    fuseKm: 2
                });
                break;
            }
            case "obj": {
                if (!ground) {
                    return;
                }
                const name = window.prompt("Objective name:", "GROUND OBJECTIVE");
                if (!name) {
                    return;
                }
                sendSim({
                    type: "orders_create",
                    order: {
                        name: name,
                        description: "Map objective at " +
                            ground.lat.toFixed(3) + ", " + ground.lon.toFixed(3),
                        type: "ground",
                        priority: "routine",
                        target: {
                            lat: ground.lat,
                            lon: ground.lon,
                            label: name
                        }
                    }
                });
                break;
            }
            case "spawn": {
                if (!ground || !kind) {
                    return;
                }
                const name = window.prompt("Threat display name:", String(kind).toUpperCase());
                if (!name) {
                    return;
                }
                sendSim({
                    type: "sim_spawn",
                    kind: kind,
                    lat: ground.lat,
                    lon: ground.lon,
                    name: name
                });
                break;
            }
            default:
                break;
        }
    }

    function sendSim(message) {
        if (typeof window.stardustSend === "function") {
            const ok = window.stardustSend(message);
            if (!ok) {
                showToast("Connection lost - command not sent.", true);
            }
            return;
        }
        showToast("Not connected.", true);
    }

    /* --------------------------------- UI ---------------------------------- */

    function showToast(text, isError) {
        const host = document.getElementById("tacToasts");
        if (!host) {
            return;
        }
        const el = document.createElement("div");
        el.className = "tac-toast" + (isError ? " tac-toast-error" : "");
        el.textContent = text;
        host.appendChild(el);
        setTimeout(function () {
            el.classList.add("tac-toast-out");
            setTimeout(function () {
                if (el.parentNode) {
                    el.parentNode.removeChild(el);
                }
            }, 400);
        }, 4200);
    }

    function buildDom() {
        if (document.getElementById("tacScroll")) {
            return;
        }
        const container = document.querySelector(".map-container") ||
            document.getElementById("mapGlobe") ||
            document.body;

        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = "tacview.css";
        document.head.appendChild(link);

        const root = document.createElement("div");
        root.id = "tacScroll";

        root.innerHTML =
            '<div id="tacToasts"></div>' +

            '<div class="tac-legend" id="tacLegend">' +
            '<div class="tac-overlay-title"><span>TACTICAL PICTURE</span><button class="tac-drawer-toggle" id="tacDrawerToggle" aria-expanded="true" aria-controls="tacLegend" title="Collapse tactical drawer">−</button></div>' +
            '<div class="tac-legend-row"><span class="tac-swat" style="background:#62d18b"></span>INFANTRY</div>' +
            '<div class="tac-legend-row"><span class="tac-swat" style="background:#f0b94d"></span>ARMOUR</div>' +
            '<div class="tac-legend-row"><span class="tac-swat" style="background:#4d9bf0"></span>MECHANIZED</div>' +
            '<div class="tac-legend-row"><span class="tac-swat" style="background:#38a6a5"></span>RECON</div>' +
            '<div class="tac-legend-row"><span class="tac-swat" style="background:#e31a1c"></span>ARTILLERY</div>' +
            '<div class="tac-legend-row"><span class="tac-swat" style="background:#b084d9"></span>LOGISTICS</div>' +
            '<div class="tac-legend-row"><span class="tac-swat" style="background:#7ec8e3"></span>AIR / HELO</div>' +
            '<div class="tac-legend-row"><span class="tac-swat" style="background:#8f9fe0"></span>NAVAL</div>' +
            '<div class="tac-legend-row"><span class="tac-swat tac-swat-threat"></span>HOSTILE TRACK</div>' +
            '<div class="tac-legend-row"><span class="tac-swat" style="background:#5ee6a0"></span>OBJECTIVE</div>' +
            '<div class="tac-toggles">' +
            '<button class="tac-toggle tac-toggle-on" id="tacToggleModels">MODELS</button>' +
            '<button class="tac-toggle" id="tacToggleLabels">LABELS</button>' +
            '<button class="tac-toggle tac-toggle-on" id="tacToggleObjects">OBJECTIVES</button>' +
            '<button class="tac-toggle tac-toggle-on" id="tacToggleTrails">TRAILS</button>' +
            "</div>" +
            '<div class="tac-live" id="tacLiveCounts">LIVE · U:0 T:0 O:0</div>' +
            "</div>" +

            '<div class="tac-inspector" id="tacInspector" role="group" aria-label="Inspector"></div>' +

            '<div class="tac-menu" id="tacContextMenu" style="display:none"></div>';

        container.appendChild(root);

        document.getElementById("tacToggleModels").addEventListener("click", function (event) {
            event.stopPropagation();
            self.toggleModels();
        });
        document.getElementById("tacToggleLabels").addEventListener("click", function (event) {
            event.stopPropagation();
            self.toggleLabels();
        });
        document.getElementById("tacToggleObjects").addEventListener("click", function (event) {
            event.stopPropagation();
            self.toggleObjectives();
        });
        document.getElementById("tacToggleTrails").addEventListener("click", function (event) {
            event.stopPropagation();
            self.toggleTrails();
        });
        document.getElementById("tacDrawerToggle").addEventListener("click", function (event) {
            event.stopPropagation();
            const legend = document.getElementById("tacLegend");
            const collapsed = legend.classList.toggle("tac-legend-collapsed");
            event.currentTarget.setAttribute("aria-expanded", String(!collapsed));
            event.currentTarget.textContent = collapsed ? "+" : "−";
        });
    }

    /* ------------------------------- toggles ------------------------------- */

    function setToggle(btnId, on) {
        const el = document.getElementById(btnId);
        if (el) {
            el.classList.toggle("tac-toggle-on", on);
        }
    }

    function toggleModels() {
        self.modelsVisible = !self.modelsVisible;
        setToggle("tacToggleModels", self.modelsVisible);
        applyLod();
        requestRender();
        showToast("Models " + (self.modelsVisible ? "ON" : "OFF") + ".");
    }

    function toggleLabels() {
        labelsOn = !labelsOn;
        setToggle("tacToggleLabels", labelsOn);
        for (const actor of actors.values()) {
            actor.pointEntity.label.show = labelsOn;
        }
        requestRender();
        showToast("Labels " + (labelsOn ? "ON" : "OFF") + ".");
    }

    function toggleObjectives() {
        objectivesOn = !objectivesOn;
        setToggle("tacToggleObjects", objectivesOn);
        for (const entity of objectiveEntities.values()) {
            entity.show = objectivesOn;
        }
        requestRender();
        showToast("Objectives " + (objectivesOn ? "ON" : "OFF") + ".");
    }

    function toggleTrails() {
        trailsOn = !trailsOn;
        setToggle("tacToggleTrails", trailsOn);
        applyLod();
        requestRender();
        showToast("Trails " + (trailsOn ? "ON" : "OFF") + ".");
    }

    /* ------------------------------ lifecycle ------------------------------ */

    function init(viewerRef) {
        if (enabled || !viewerRef) {
            return;
        }
        viewer = viewerRef;
        enabled = true;
        self.enabled = true;

        buildDom();
        setupInteractions();

        viewer.camera.changed.addEventListener(function () {
            scheduleLod();
        });

        if (lastPayload) {
            applyTelemetry(lastPayload);
        }
        if (lastOrders && lastOrders.length) {
            reconcileObjectives(collectObjectivesFromOrders(lastOrders));
        }

        applyLod();
        requestRender();
    }

    function setupInteractions() {
        const handler = new C.ScreenSpaceEventHandler(viewer.scene.canvas);

        handler.setInputAction(function (movement) {
            hideMenu();
            const id = pickActorId(movement.position);
            selectActor(id, false);
        }, C.ScreenSpaceEventType.LEFT_CLICK);

        handler.setInputAction(function (movement) {
            const id = pickActorId(movement.position);
            if (id) {
                selectActor(id, true);
            }
        }, C.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

        handler.setInputAction(function (movement) {
            const actorId = pickActorId(movement.position);
            const ground = actorId ? null : groundFromScreen(movement.position);
            openContextMenu(movement.position, actorId, ground);
        }, C.ScreenSpaceEventType.RIGHT_CLICK);

        document.addEventListener("keydown", function (event) {
            if (event.key === "Escape") {
                hideMenu();
            }
        });
    }

    /* --------------------------- renderer hooks ---------------------------- */

    function onTelemetry(payload) {
        lastPayload = payload;
        if (!enabled) {
            return;
        }
        applyTelemetry(payload);
    }

    function collectObjectivesFromOrders(orders) {
        const out = [];
        for (const order of orders || []) {
            if (
                !order.target ||
                !Number.isFinite(order.target.lat) ||
                !Number.isFinite(order.target.lon)
            ) {
                continue;
            }
            out.push({
                id: order.id,
                name: order.name,
                type: order.type,
                priority: order.priority,
                lat: order.target.lat,
                lon: order.target.lon,
                label: order.target.label || null,
                createdAt: order.createdAt
            });
        }
        return out;
    }

    function onOrders(orders) {
        lastOrders = orders || [];
        if (!enabled) {
            return;
        }
        if (lastPayload && lastPayload.objectives) {
            reconcileObjectives(lastPayload.objectives);
        } else {
            reconcileObjectives(collectObjectivesFromOrders(lastOrders));
        }
    }

    function setUnits(units) {
        lastUnits = units || [];
        if (!enabled) {
            return;
        }
        if (!lastPayload) {
            applyTelemetry({
                units: lastUnits,
                threats: [],
                objectives: lastOrders ? collectObjectivesFromOrders(lastOrders) : []
            });
        }
    }

    function onSimEvent(msg) {
        if (msg && msg.message) {
            const isError = !!(msg.kind && String(msg.kind).indexOf("err") !== -1);
            showToast(msg.message, isError);
        }
    }

    function onError(msg) {
        if (msg && msg.message) {
            showToast(msg.message, true);
        }
    }

    /* -------------------------------- exports ------------------------------ */

    var self = {
        enabled: false,
        modelsVisible: true,
        init: init,
        onTelemetry: onTelemetry,
        onOrders: onOrders,
        setUnits: setUnits,
        onSimEvent: onSimEvent,
        onError: onError
    };

    window.TacView = self;

})();
