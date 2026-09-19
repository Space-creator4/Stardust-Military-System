const clock = document.getElementById("clock");

const systemStatusText =
    document.getElementById("systemStatusText");

const units = [];

const bases = [];

const assets = {
    missiles: 0,
    satellites: 0
};

let socket = null;
let reconnectTimer = null;
let reconnectDelay = 1000;
let reconnectResetTimer = null;
let reconnectDisabled = false;

const ALL_FORCE_TYPES = [
    "infantry",
    "armour",
    "mechanized",
    "recon",
    "artillery",
    "logistics",
    "air",
    "helicopter",
    "naval"
];

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

const UNIT_BASE_REQUIREMENTS = {
    infantry: [[{ type: "barracks", level: 1 }]],
    armour: [[{ type: "motor_pool", level: 1 }]],
    mechanized: [[{ type: "motor_pool", level: 1 }, { type: "depot", level: 1 }]],
    recon: [[{ type: "barracks", level: 1 }], [{ type: "helipad", level: 1 }]],
    artillery: [[{ type: "motor_pool", level: 1 }, { type: "depot", level: 1 }]],
    logistics: [[{ type: "depot", level: 1 }]],
    air: [[{ type: "runway", level: 1 }, { type: "hangar", level: 1 }]],
    helicopter: [[{ type: "helipad", level: 1 }, { type: "hangar", level: 1 }]],
    naval: [[{ type: "port", level: 1 }]]
};

function updateClock() {
    const now = new Date();

    if (clock) {
        clock.textContent =
            now.toLocaleTimeString("en-GB", {
                hour12: false
            });
    }
}

function setSystemStatus(online) {
    if (!systemStatusText) {
        return;
    }

    systemStatusText.textContent =
        online
            ? "SYSTEM ONLINE"
            : "SYSTEM OFFLINE";
}

function updateCounts() {
    ALL_FORCE_TYPES.forEach(type => {
        const element =
            document.getElementById(`${type}Count`);

        if (!element) {
            return;
        }

        const count =
            units.filter(
                unit => unit.type === type
            ).length;

        element.textContent = count;
    });

    const groundCount =
        document.getElementById("groundCount");

    if (groundCount) {
        groundCount.textContent = units.length;
    }

    const airNavalCount =
        document.getElementById("airNavalCount");

    if (airNavalCount) {
        airNavalCount.textContent =
            units.filter(
                u =>
                    u.type === "air" ||
                    u.type === "helicopter" ||
                    u.type === "naval"
            ).length;
    }

    const totalUnits =
        document.getElementById("totalUnits");

    if (totalUnits) {
        totalUnits.textContent = units.length;
    }

    const unitCount =
        document.getElementById("unitCount");

    if (unitCount) {
        unitCount.textContent = units.length;
    }

    const personnel =
        units.reduce(
            (total, unit) =>
                total + (Number(unit.personnel) || 0),
            0
        );

    const totalPersonnel =
        document.getElementById("totalPersonnel");

    if (totalPersonnel) {
        totalPersonnel.textContent =
            personnel.toLocaleString("en-GB");
    }

    const moving =
        units.filter(
            unit => unit.status === "MOVING"
        ).length;

    const movingUnits =
        document.getElementById("movingUnits");

    if (movingUnits) {
        movingUnits.textContent = moving;
    }

    const operational =
        units.filter(
            unit =>
                unit.status === "OPERATIONAL"
        ).length;

    const operationalUnits =
        document.getElementById("operationalUnits");

    if (operationalUnits) {
        operationalUnits.textContent =
            operational;
    }

    const missileCount =
        document.getElementById("missileCount");

    if (missileCount) {
        missileCount.textContent =
            assets.missiles;
    }

    const satelliteCount =
        document.getElementById("satelliteCount");

    if (satelliteCount) {
        satelliteCount.textContent =
            assets.satellites;
    }

    const baseCountEl =
        document.getElementById("baseCount");

    if (baseCountEl) {
        baseCountEl.textContent = bases.length;
    }
}

function setUnitMessage(elementId, message, error) {
    const element =
        document.getElementById(elementId);

    if (!element) {
        return;
    }

    element.textContent =
        message || "";

    element.className =
        "unit-message" +
        (error ? " error" : "");
}

function escapeText(value) {
    return String(value == null ? "" : value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function unitStatusClass(unit) {
    return String(unit.status || "")
        .toLowerCase();
}

function getRequirementLabel(unitType) {
    const groups =
        UNIT_BASE_REQUIREMENTS[String(unitType)] || [];

    if (groups.length === 0) {
        return "No base infrastructure required";
    }

    return groups
        .map(
            group =>
                group
                    .map(
                        requirement =>
                            `${BUILDING_LABELS[requirement.type] || requirement.type} Lv.${requirement.level}`
                    )
                    .join(" + ")
        )
        .join("  OR  ");
}

function checkBaseSupports(base, unitType) {
    const groups =
        UNIT_BASE_REQUIREMENTS[String(unitType)] || [];

    const infra =
        (base && base.infrastructure) || {};

    for (const group of groups) {
        const satisfied =
            group.every(
                requirement =>
                    (Number(infra[requirement.type]) || 0) >= requirement.level
            );

        if (satisfied) {
            return true;
        }
    }

    return false;
}

function renderBasePanel() {
    const select =
        document.getElementById("baseSelect");

    const originSelect =
        document.getElementById("unitBase");

    if (!select) {
        return;
    }

    select.innerHTML = "";

    if (originSelect) {
        originSelect.innerHTML = "";
    }

    const placeholder =
        document.createElement("option");

    placeholder.value = "";
    placeholder.textContent = "— SELECT A BASE —";

    select.appendChild(placeholder);

    for (const base of bases) {
        const option =
            document.createElement("option");

        option.value = base.id;

        option.textContent =
            `[${(base.code || base.country).toUpperCase()}] ${base.name} — ${base.type.replace(/_/g, " ").toUpperCase()}`;

        select.appendChild(option);

        if (originSelect) {
            const originOption =
                option.cloneNode(true);

            originSelect.appendChild(originOption);
        }
    }

    if (originSelect && !originSelect.value) {
        originSelect.value = select.value;
        updateRequirementHint();
    }

    updateBaseSummary();
}

function updateBaseSummary() {
    const select =
        document.getElementById("baseSelect");

    const summary =
        document.getElementById("baseSummary");

    const infraList =
        document.getElementById("baseInfraList");

    const hint =
        document.getElementById("unitReqHint");

    if (!select || !summary) {
        return;
    }

    const baseId = select.value;

    if (!baseId) {
        summary.textContent = "SELECT A BASE";
        summary.className = "base-summary";

        if (infraList) {
            infraList.innerHTML = "";
        }

        if (hint) {
            hint.textContent = "";
        }

        return;
    }

    const base =
        bases.find(b => b.id === baseId);

    if (!base) {
        summary.textContent = "BASE NOT FOUND";
        summary.className = "base-summary error";

        if (infraList) {
            infraList.innerHTML = "";
        }

        return;
    }

    summary.textContent =
        `${base.name} — ${base.country} — ${base.type.replace(/_/g, " ").toUpperCase()}`;
    summary.className = "base-summary active";

    const countryInput =
        document.getElementById("unitCountry");

    if (countryInput) {
        countryInput.value =
            base.country || "";
    }

    const originSelect =
        document.getElementById("unitBase");

    if (originSelect && originSelect.value !== baseId) {
        originSelect.value = baseId;
    }

    renderInfraPanel(base);

    updateRequirementHint();
}

function renderInfraPanel(base) {
    const container =
        document.getElementById("baseInfraList");

    if (!container) {
        return;
    }

    container.innerHTML = "";

    const allInfraKeys =
        Object.keys(BUILDING_LABELS);

    const defaults =
        BASE_INFRA_DEFAULTS[base.type] || {};

    for (const key of allInfraKeys) {
        if (
            !base.built &&
            !Object.prototype.hasOwnProperty.call(defaults, key) &&
            !Object.prototype.hasOwnProperty.call(base.infrastructure || {}, key)
        ) {
            continue;
        }

        const level =
            Number(base.infrastructure[key]) || 0;

        const chip =
            document.createElement("div");

        chip.className =
            "infra-chip" +
            (level > 0 ? " active" : "");

        const label =
            document.createElement("span");

        label.className = "infra-chip-label";

        label.textContent =
            BUILDING_LABELS[key];

        const pips =
            document.createElement("span");

        pips.className = "infra-pips";

        for (let i = 1; i <= 3; i++) {
            const pip =
                document.createElement("span");

            pip.className =
                "infra-pip" +
                (i <= level ? " filled" : "");

            pips.appendChild(pip);
        }

        const levelText =
            document.createElement("span");

        levelText.className = "infra-level-text";

        levelText.textContent =
            level > 0 ? `Lv.${level}` : "—";

        chip.appendChild(label);
        chip.appendChild(pips);
        chip.appendChild(levelText);

        if (level < 3 && base.built) {
            const upgradeBtn =
                document.createElement("button");

            upgradeBtn.type = "button";
            upgradeBtn.className =
                "infra-upgrade-btn";
            upgradeBtn.textContent = "+";
            upgradeBtn.title =
                `Upgrade ${BUILDING_LABELS[key]}`;
            upgradeBtn.dataset.building = key;

            upgradeBtn.addEventListener(
                "click",
                () => {
                    sendBaseUpgrade(
                        base.id,
                        key
                    );
                }
            );

            chip.appendChild(upgradeBtn);
        }

        container.appendChild(chip);
    }
}

function updateRequirementHint() {
    const hint =
        document.getElementById("unitReqHint");

    const typeSelect =
        document.getElementById("unitType");

    const originSelect =
        document.getElementById("unitBase");

    if (!hint || !typeSelect || !originSelect) {
        return;
    }

    const unitType = typeSelect.value;
    const baseId = originSelect.value;

    if (!baseId) {
        hint.textContent = "";
        return;
    }

    const base =
        bases.find(b => b.id === baseId);

    if (!base) {
        hint.textContent = "";
        return;
    }

    const supported =
        checkBaseSupports(base, unitType);

    const required =
        getRequirementLabel(unitType);

    hint.textContent = supported
        ? `✓ Required: ${required}`
        : `✗ Required: ${required}`;

    hint.className =
        "unit-req-hint" +
        (supported ? " ok" : " fail");
}

function renderUnitList() {
    const container =
        document.getElementById("unitList");

    if (!container) {
        return;
    }

    container
        .querySelectorAll(".unit-row")
        .forEach(el => el.remove());

    const empty =
        document.getElementById("unitEmpty");

    if (units.length === 0) {
        if (empty) {
            empty.style.display = "";
        }
        return;
    }

    if (empty) {
        empty.style.display = "none";
    }

    for (const unit of units) {
        container.appendChild(
            buildUnitRow(unit)
        );
    }
}

function buildUnitRow(unit) {
    const row =
        document.createElement("div");

    row.className = "unit-row";

    const top =
        document.createElement("div");

    top.className = "unit-row-top";

    const dot =
        document.createElement("span");

    dot.className = "unit-row-dot";

    const info =
        document.createElement("div");

    info.className = "unit-row-info";

    const name =
        document.createElement("strong");

    name.textContent = unit.name;

    const sub =
        document.createElement("span");

    sub.textContent =
        `${unit.id} · CREATED BY ${(unit.createdBy && unit.createdBy.username) || "COMMAND"}`;

    info.appendChild(name);
    info.appendChild(sub);

    const status =
        document.createElement("span");

    status.className =
        "unit-badge " +
        unitStatusClass(unit);

    status.textContent =
        unit.status || "OPERATIONAL";

    top.appendChild(dot);
    top.appendChild(info);
    top.appendChild(status);

    row.appendChild(top);

    const meta =
        document.createElement("div");

    meta.className = "unit-row-meta";

    const baseName =
        unit.base && unit.base.name
            ? unit.base.name
            : "FIELD";

    meta.innerHTML =
        `<span>${escapeText(String(unit.type || "").toUpperCase())}</span>` +
        `<span>${Number(unit.personnel) || 0} PERSONNEL</span>` +
        `<span>${escapeText(unit.country || "NO AFFILIATION")}</span>` +
        `<span>${escapeText(baseName)}</span>` +
        `<span>${Number(unit.lat).toFixed(3)}° ${Number(unit.lon).toFixed(3)}°</span>`;

    row.appendChild(meta);

    const actions =
        document.createElement("div");

    actions.className = "unit-row-actions";

    const locate = makeActionButton(
        "LOCATE ON MAP",
        () => {
            window.location.href =
                `/map.html?unit=${encodeURIComponent(unit.id)}`;
        }
    );

    const cycleStatus = () => {
        const order = [
            "OPERATIONAL",
            "MOVING",
            "RESERVE"
        ];

        const index =
            order.indexOf(
                unit.status
            );

        const next =
            order[(index + 1) % order.length];

        sendUpdate({
            id: unit.id,
            unit: { status: next }
        });
    };

    const toggleStatus = makeActionButton(
        unit.status === "MOVING"
            ? "MARK OPERATIONAL"
            : "MARK MOVING",
        cycleStatus
    );

    const editButton = makeActionButton(
        "EDIT",
        () => {
            editRow.classList.toggle("open");
        }
    );

    const reform = makeActionButton(
        "DISBAND",
        () => {
            sendDelete(unit.id);
        }
    );

    reform.classList.add("danger");

    actions.appendChild(locate);
    actions.appendChild(toggleStatus);
    actions.appendChild(editButton);
    actions.appendChild(reform);

    row.appendChild(actions);

    const editRow =
        document.createElement("div");

    editRow.className = "unit-edit";

    const latInput = field("number", unit.lat);
    latInput.id = `editLat_${unit.id}`;
    latInput.step = "0.0001";
    latInput.min = "-90";
    latInput.max = "90";

    const lonInput = field("number", unit.lon);
    lonInput.id = `editLon_${unit.id}`;
    lonInput.step = "0.0001";
    lonInput.min = "-180";
    lonInput.max = "180";

    const personnelInput = field("number", unit.personnel);
    personnelInput.id = `editPersonnel_${unit.id}`;
    personnelInput.min = "1";
    personnelInput.max = "1000000";

    const statusSelect =
        document.createElement("select");

    statusSelect.id = `editStatus_${unit.id}`;

    for (const option of [
        "OPERATIONAL",
        "MOVING",
        "RESERVE"
    ]) {
        const el =
            document.createElement("option");

        el.value = option;
        el.textContent = option;

        if (
            unit.status === option
        ) {
            el.selected = true;
        }

        statusSelect.appendChild(el);
    }

    editRow.appendChild(latInput);
    editRow.appendChild(lonInput);
    editRow.appendChild(personnelInput);
    editRow.appendChild(statusSelect);

    const saveButton =
        makeActionButton(
            "APPLY CHANGES",
            () => {
                sendUpdate({
                    id: unit.id,
                    unit: {
                        lat:
                            Number(
                                latInput.value
                            ),
                        lon:
                            Number(
                                lonInput.value
                            ),
                        personnel:
                            Number(
                                personnelInput.value
                            ),
                        status:
                            statusSelect.value
                    }
                });

                editRow.classList.remove(
                    "open"
                );
            }
        );

    const metaRowEdit =
        document.createElement("div");

    metaRowEdit.style.gridTemplateColumns =
        "auto";

    editRow.appendChild(saveButton);

    saveButton.style.gridColumn = "1 / -1";

    row.appendChild(editRow);

    return row;
}

function field(type, value) {
    const input =
        document.createElement("input");

    input.type = type;
    input.value = value;
    input.className = "unit-action-input";

    return input;
}

function makeActionButton(text, onClick) {
    const button =
        document.createElement("button");

    button.type = "button";
    button.className = "unit-action";
    button.textContent = text;
    button.addEventListener(
        "click",
        onClick
    );

    return button;
}

function getWebSocketURL() {
    return window.stardustWsUrl();
}

function scheduleReconnect() {
    if (reconnectDisabled) {
        return;
    }

    if (reconnectTimer) {
        return;
    }

    reconnectTimer =
        setTimeout(
            () => {
                reconnectTimer = null;
                connectWebSocket();
                reconnectDelay =
                    Math.min(
                        reconnectDelay * 2,
                        30000
                    );
            },
            reconnectDelay
        );
}

let forceRenderQueued = false;

function queueForceRender() {
    if (forceRenderQueued) return;
    forceRenderQueued = true;
    requestAnimationFrame(() => {
        forceRenderQueued = false;
        updateCounts();
        renderUnitList();
    });
}

function connectWebSocket() {
    if (
        socket &&
        (socket.readyState === WebSocket.OPEN ||
            socket.readyState === WebSocket.CONNECTING)
    ) {
        return;
    }

    try {
        socket =
            new WebSocket(
                getWebSocketURL()
            );
    } catch (error) {
        console.warn(
            "Failed to create WebSocket:",
            error
        );
        scheduleReconnect();
        return;
    }

    socket.addEventListener(
        "open",
        () => {
            console.log(
                "Stardust Forces connected."
            );

            if (reconnectResetTimer) {
                clearTimeout(reconnectResetTimer);
            }

            reconnectResetTimer = setTimeout(
                () => {
                    reconnectResetTimer = null;
                    reconnectDelay = 1000;
                },
                10000
            );

            setSystemStatus(true);
        }
    );

    socket.addEventListener(
        "message",
        event => {
            try {
                const data =
                    JSON.parse(
                        event.data
                    );

                if (
                    data.type ===
                    "units"
                ) {
                    units.length = 0;
                    units.push(
                        ...(Array.isArray(data.units)
                            ? data.units
                            : [])
                    );
                    queueForceRender();
                }

                if (
                    data.type ===
                    "bases"
                ) {
                    bases.length = 0;
                    bases.push(
                        ...(Array.isArray(data.bases)
                            ? data.bases
                            : [])
                    );
                    renderBasePanel();
                    updateCounts();
                }

                if (
                    data.type ===
                    "base_updated" ||
                    data.type ===
                    "base_created"
                ) {
                    setUnitMessage(
                        "baseMessage",
                        data.base
                            ? `${data.base.name} updated.`
                            : "Base updated.",
                        false
                    );
                }

                if (
                    data.type ===
                    "unit_created"
                ) {
                    setUnitMessage(
                        "unitMessage",
                        `UNIT ${data.unit.id} RAISED.`,
                        false
                    );
                }

                if (
                    data.type ===
                    "error"
                ) {
                    const msg =
                        data.message ||
                        "COMMAND ERROR.";

                    if (
                        msg.includes(
                            "base"
                        )
                    ) {
                        setUnitMessage(
                            "unitMessage",
                            msg,
                            true
                        );
                    } else {
                        setUnitMessage(
                            "unitMessage",
                            msg,
                            true
                        );
                    }
                }
            } catch (error) {
                console.warn(
                    "Invalid WebSocket message:",
                    error
                );
            }
        }
    );

    socket.addEventListener(
        "close",
        event => {
            setSystemStatus(false);

            if (
                event &&
                (event.code === 4001 ||
                    event.code === 4003 ||
                    event.code === 4004)
            ) {
                reconnectDisabled = true;
                console.warn(
                    "Forces WebSocket closed with terminal code " +
                        event.code +
                        "; auto-reconnect disabled."
                );

                return;
            }

            scheduleReconnect();
        }
    );

    socket.addEventListener(
        "error",
        error => {
            console.warn(
                "Stardust Forces WebSocket error:",
                error
            );
        }
    );
}

function connected() {
    return (
        socket &&
        socket.readyState ===
            WebSocket.OPEN
    );
}

function sendUpdate(payload) {
    if (!connected()) {
        setUnitMessage(
            "unitMessage",
            "COMMAND LINK OFFLINE.",
            true
        );
        return;
    }

    socket.send(
        JSON.stringify({
            type: "units_update",
            ...payload
        })
    );
}

function sendDelete(id) {
    if (!connected()) {
        setUnitMessage(
            "unitMessage",
            "COMMAND LINK OFFLINE.",
            true
        );
        return;
    }

    socket.send(
        JSON.stringify({
            type: "units_delete",
            id
        })
    );
}

function raiseUnit() {
    const name =
        document
            .getElementById("unitName")
            .value.trim();

    const type =
        document
            .getElementById("unitType")
            .value;

    const personnel =
        Number(
            document
                .getElementById("unitPersonnel")
                .value
        );

    const country =
        document
            .getElementById("unitCountry")
            .value.trim();

    const baseId =
        document
            .getElementById("unitBase")
            .value;

    const status =
        document
            .getElementById("unitStatus")
            .value;

    if (!name) {
        setUnitMessage(
            "unitMessage",
            "ENTER A UNIT DESIGNATION.",
            true
        );
        return;
    }

    if (!baseId) {
        setUnitMessage(
            "unitMessage",
            "SELECT A BASE TO RAISE UNITS FROM.",
            true
        );
        return;
    }

    if (!connected()) {
        setUnitMessage(
            "unitMessage",
            "COMMAND LINK OFFLINE — PLEASE RETRY.",
            true
        );
        return;
    }

    socket.send(
        JSON.stringify({
            type: "units_create",
            unit: {
                name,
                type,
                personnel,
                country,
                baseId,
                status
            }
        })
    );

    setUnitMessage(
        "unitMessage",
        "TRANSMITTING UNIT...",
        false
    );
}

function establishBase() {
    const name =
        document
            .getElementById("baseName")
            .value.trim();

    const type =
        document
            .getElementById("baseType")
            .value;

    const lat =
        Number(
            document
                .getElementById("baseLat")
                .value
        );

    const lon =
        Number(
            document
                .getElementById("baseLon")
                .value
        );

    if (!name) {
        setUnitMessage(
            "baseFormMessage",
            "ENTER A BASE DESIGNATION.",
            true
        );
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
        setUnitMessage(
            "baseFormMessage",
            "ENTER A VALID LATITUDE / LONGITUDE.",
            true
        );
        return;
    }

    if (!connected()) {
        setUnitMessage(
            "baseFormMessage",
            "COMMAND LINK OFFLINE — PLEASE RETRY.",
            true
        );
        return;
    }

    socket.send(
        JSON.stringify({
            type: "base_create",
            base: {
                name,
                type,
                lat,
                lon
            }
        })
    );

    setUnitMessage(
        "baseFormMessage",
        "ESTABLISHING BASE...",
        false
    );
}

function sendBaseUpgrade(baseId, building) {
    if (!connected()) {
        setUnitMessage(
            "baseMessage",
            "COMMAND LINK OFFLINE.",
            true
        );
        return;
    }

    socket.send(
        JSON.stringify({
            type: "base_upgrade",
            baseId,
            building
        })
    );

    setUnitMessage(
        "baseMessage",
        `Upgrading ${building.replace(/_/g, " ")}...`,
        false
    );
}

function bind() {
    document
        .querySelectorAll(".force-item")
        .forEach(item => {
            item.addEventListener("click", () => {
                const type = item.dataset.force;

                window.location.href =
                    `/map.html?force=${encodeURIComponent(type)}`;
            });
        });

    document
        .getElementById("createUnitButton")
        .addEventListener("click", () => {
            document
                .getElementById("unitName")
                .focus();

            document
                .getElementById("unitName")
                .scrollIntoView({
                    behavior: "smooth",
                    block: "center"
                });
        });

    document
        .getElementById("liveMapButton")
        .addEventListener("click", () => {
            window.location.href =
                "/map.html";
        });

    document
        .getElementById("ordersButton")
        .addEventListener("click", () => {
            window.location.href =
                "/order.html";
        });

    document
        .getElementById("missileButton")
        .addEventListener("click", () => {
            window.location.href =
                "/order.html?type=missile";
        });

    document
        .getElementById("satelliteButton")
        .addEventListener("click", () => {
            window.location.href =
                "/order.html?type=satellite";
        });

    document
        .getElementById("raiseUnitButton")
        .addEventListener("click", raiseUnit);

    document
        .getElementById("unitForm")
        .addEventListener("keydown", event => {
            if (event.key === "Enter") {
                event.preventDefault();
                raiseUnit();
            }
        });

    const baseSelect =
        document.getElementById("baseSelect");

    if (baseSelect) {
        baseSelect.addEventListener(
            "change",
            () => {
                updateBaseSummary();
            }
        );
    }

    const originSelect =
        document.getElementById("unitBase");

    if (originSelect) {
        originSelect.addEventListener(
            "change",
            () => {
                const base =
                    bases.find(b => b.id === originSelect.value);

                const countryInput =
                    document.getElementById("unitCountry");

                if (countryInput) {
                    countryInput.value =
                        (base && base.country) || "";
                }

                const baseSelect =
                    document.getElementById("baseSelect");

                if (baseSelect && baseSelect.value !== originSelect.value) {
                    baseSelect.value = originSelect.value;
                    updateBaseSummary();
                    return;
                }

                updateRequirementHint();
            }
        );
    }

    const unitTypeSelect =
        document.getElementById("unitType");

    if (unitTypeSelect) {
        unitTypeSelect.addEventListener(
            "change",
            () => {
                updateRequirementHint();
            }
        );
    }

    const establishBaseButton =
        document.getElementById("establishBaseButton");

    if (establishBaseButton) {
        establishBaseButton.addEventListener(
            "click",
            establishBase
        );
    }

    const baseForm =
        document.getElementById("baseForm");

    if (baseForm) {
        baseForm.addEventListener(
            "keydown",
            event => {
                if (event.key === "Enter") {
                    event.preventDefault();
                    establishBase();
                }
            }
        );
    }
}

updateClock();
setInterval(updateClock, 1000);
setSystemStatus(false);
updateCounts();
renderUnitList();
bind();
connectWebSocket();