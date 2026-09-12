const clock = document.getElementById("clock");

const systemStatusText =
    document.getElementById("systemStatusText");

const units = [];

const assets = {
    missiles: 0,
    satellites: 0
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

    const personnel =
        units.reduce(
            (total, unit) =>
                total + unit.personnel,
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
        window.location.href =
            "/orders.html?type=ground";
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
            "/orders.html";
    });

document
    .getElementById("missileButton")
    .addEventListener("click", () => {
        window.location.href =
            "/orders.html?type=missile";
    });

document
    .getElementById("satelliteButton")
    .addEventListener("click", () => {
        window.location.href =
            "/orders.html?type=satellite";
    });

updateClock();

setInterval(updateClock, 1000);

setSystemStatus(true);

updateCounts();