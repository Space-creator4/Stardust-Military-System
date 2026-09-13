const clock = document.getElementById("clock");

const systemStatusText =
    document.getElementById("systemStatusText");

const units = [];

const assets = {
    missiles: 0,
    satellites: 0
};

let socket = null;
let reconnectTimer = null;
let reconnectDelay = 1000;

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
    const types = [
        "infantry",
        "armour",
        "mechanized",
        "recon",
        "artillery",
        "logistics"
    ];

    types.forEach(type => {
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
}

function setUnitMessage(message, error) {
    const element =
        document.getElementById("unitMessage");

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

    meta.innerHTML =
        `<span>${unit.type.toUpperCase()}</span>` +
        `<span>${Number(unit.personnel) || 0} PERSONNEL</span>` +
        `<span>${escapeText(unit.country || "NO AFFILIATION")}</span>` +
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
    const protocol =
        window.location.protocol === "https:"
            ? "wss:"
            : "ws:";

    return `${protocol}//${window.location.host}`;
}

function scheduleReconnect() {
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
            reconnectDelay = 1000;
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
                    updateCounts();
                    renderUnitList();
                }

                if (
                    data.type ===
                    "unit_created"
                ) {
                    setUnitMessage(
                        `UNIT ${data.unit.id} RAISED.`,
                        false
                    );
                }

                if (
                    data.type ===
                    "error"
                ) {
                    setUnitMessage(
                        data.message ||
                            "COMMAND ERROR.",
                        true
                    );
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
        () => {
            setSystemStatus(false);
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

    const lat =
        Number(
            document
                .getElementById("unitLat")
                .value
        );

    const lon =
        Number(
            document
                .getElementById("unitLon")
                .value
        );

    const status =
        document
            .getElementById("unitStatus")
            .value;

    if (!name) {
        setUnitMessage(
            "ENTER A UNIT DESIGNATION.",
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
            "ENTER A VALID LATITUDE / LONGITUDE.",
            true
        );
        return;
    }

    if (!connected()) {
        setUnitMessage(
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
                lat,
                lon,
                status
            }
        })
    );

    setUnitMessage(
        "TRANSMITTING UNIT...",
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
}

updateClock();
setInterval(updateClock, 1000);
setSystemStatus(false);
updateCounts();
renderUnitList();
bind();
connectWebSocket();