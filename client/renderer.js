const CESIUM_ION_TOKEN =
    window.CESIUM_ION_TOKEN || "";

if (CESIUM_ION_TOKEN) {
    Cesium.Ion.defaultAccessToken = CESIUM_ION_TOKEN;
}

const clockElement = document.getElementById("clock");
const systemStatusText = document.getElementById("systemStatusText");
const statusDot = document.querySelector(".status-dot");
const mapStatusText = document.getElementById("mapStatusText");
const chatInput = document.getElementById("chatInput");
const sendButton = document.getElementById("sendButton");
const chat = document.getElementById("chat");
const activeCountries = document.getElementById("activeCountries");
const onlinePersonnel = document.getElementById("onlinePersonnel");
const activeOrders = document.getElementById("activeOrders");

let currentUser = null;
let socket = null;
let reconnectTimer = null;

window.stardustSend = function (message) {
    if (
        socket &&
        socket.readyState ===
            WebSocket.OPEN
    ) {
        try {
            socket.send(
                JSON.stringify(message)
            );
            return true;
        } catch (error) {
            console.warn(
                "Failed to send WebSocket message:",
                error
            );
        }
    }
    return false;
};
let reconnectDelay = 1000;
let reconnectResetTimer = null;
let reconnectDisabled = false;
let stardustUnits = [];
let stardustBases = [];
let markerEntities = new Map();
let unitForceFilter = null;
let highlightUnitId = null;
let unitFlyDone = false;
let countryTileEntities = [];
let countryLabelEntities = [];
const labeledCountryCodes = new Set();
let baseMarkerEntities = new Map();
let unitMarkerMeta = new Map();
let baseMarkerMeta = new Map();
let baseImageCache = new Map();
let osmBuildingsPrimitive = null;

const UNIT_TYPE_COLORS = {
    infantry: "#62d18b",
    armour: "#f0b94d",
    mechanized: "#4d9bf0",
    recon: "#38a6a5",
    artillery: "#e31a1c",
    logistics: "#b084d9"
};

const COUNTRY_COLORS = {
    USA: "#377eb8",
    DEU: "#377eb8",
    CAN: "#377eb8",
    GER: "#377eb8",
    AMS: "#377eb8",
    BEL: "#377eb8",
    NLD: "#377eb8",
    LUX: "#377eb8",
    POL: "#377eb8",
    NOR: "#377eb8",
    CZE: "#377eb8",

    ATA: "#3264c8",

    BRA: "#8c510a",
    URY: "#8c510a",

    GRL: "#d9b400",
    ISL: "#d9b400",

    RUS: "#e31a1c",
    KAZ: "#e31a1c",

    CHN: "#fd8d3c",
    MNG: "#fd8d3c",
    AUS: "#fd8d3c",
    PNG: "#fd8d3c",
    IDN: "#fd8d3c",
    KOR: "#fd8d3c",
    PRK: "#fd8d3c",

    MRT: "#1b7837",
    ESH: "#1b7837",
    MAR: "#1b7837",
    DZA: "#1b7837",
    MLI: "#1b7837",
    CIV: "#1b7837",
    LBR: "#1b7837",
    SLE: "#1b7837",
    GIN: "#1b7837",
    SEN: "#1b7837",
    GNB: "#1b7837",
    NER: "#1b7837",
    NGA: "#1b7837",
    GHA: "#1b7837",
    BEN: "#1b7837",
    TGO: "#1b7837",
    BFA: "#1b7837",
    ESP: "#1b7837",
    PRT: "#1b7837",
    FRA: "#1b7837",
    GMB: "#1b7837",

    LBY: "#38a6a5",
    EGY: "#38a6a5",
    SAU: "#38a6a5",
    YEM: "#38a6a5",
    OMN: "#38a6a5",
    ARE: "#38a6a5",
    QAT: "#38a6a5",
    BHR: "#38a6a5",
    IRQ: "#38a6a5",
    SYR: "#38a6a5",
    JOR: "#38a6a5",
    ISR: "#38a6a5",
    LBN: "#38a6a5",
    TUR: "#38a6a5",
    GRC: "#38a6a5",
    HRV: "#38a6a5",
    BIH: "#38a6a5",
    MNE: "#38a6a5",
    MKD: "#38a6a5",
    ALB: "#38a6a5",
    KOS: "#38a6a5",
    SRB: "#38a6a5",
    BGR: "#38a6a5",
    ROU: "#38a6a5",

    COD: "#832323",

    IRN: "#72b38e",
    TKM: "#72b38e",

    AFG: "#d9b400",

    PAK: "#88419d"
};

let COUNTRY_FACTIONS = null;
let FACTION_BY_CODE = {};
let FACTION_BY_NAME = {};

async function loadCountryFactions() {
    try {
        const response =
            await fetch(
                "countries.json?v=2026.1",
                {
                    cache: "no-cache",
                    credentials: "same-origin"
                }
            );

        if (!response.ok) {
            throw new Error(
                `Country factions HTTP ${response.status}`
            );
        }

        const data = await response.json();

        COUNTRY_FACTIONS =
            Array.isArray(data.factions)
                ? data.factions
                : [];

        FACTION_BY_CODE = {};
        FACTION_BY_NAME = {};

        for (const faction of COUNTRY_FACTIONS) {
            for (const entry of
                    faction.countries || []) {
                if (entry.code) {
                    const codeKey =
                        String(
                            entry.code
                        ).toUpperCase();
                    FACTION_BY_CODE[codeKey] = {
                        code: codeKey,
                        name: entry.name,
                        faction:
                            faction.id,
                        color:
                            faction.color
                    };
                    COUNTRY_COLORS[codeKey] =
                        faction.color;
                }

                if (entry.name) {
                    const nameKey =
                        normalizeCountryName(
                            entry.name
                        );
                    if (nameKey) {
                        FACTION_BY_NAME[nameKey] = {
                            code: String(
                                entry.code
                            ).toUpperCase(),
                            name: entry.name,
                            faction:
                                faction.id,
                            color:
                                faction.color
                        };
                    }
                }
            }
        }

        for (const key of
                Object.keys(
                    COUNTRY_COLORS
                )) {
            if (
                !FACTION_BY_CODE[
                    key
                ]
            ) {
                delete COUNTRY_COLORS[
                    key
                ];
            }
        }

        console.log(
            `Stardust country factions loaded. ${COUNTRY_FACTIONS.length} factions, ${Object.keys(FACTION_BY_CODE).length} countries assigned.`
        );
    } catch (error) {
        console.error(
            "Failed to load country factions:",
            error
        );
    }
}

const COUNTRY_NAME_TO_CODE = {
    United_States: "USA",
    United_States_of_America: "USA",
    United_States_of_America_: "USA",
    USA: "USA",
    US: "USA",
    UnitedStates: "USA",
    UnitedStatesofAmerica: "USA",

    Germany: "DEU",
    Deutschland: "DEU",
    DEU: "DEU",

    Canada: "CAN",
    CAN: "CAN",

    Luxembourg: "LUX",
    LUX: "LUX",

    Belgium: "BEL",
    BEL: "BEL",

    Netherlands: "NLD",
    Holland: "NLD",
    NLD: "NLD",

    Poland: "POL",
    POL: "POL",

    Czechia: "CZE",
    Czech_Republic: "CZE",
    CZE: "CZE",

    Antarctica: "ATA",
    ATA: "ATA",

    Brazil: "BRA",
    Brasil: "BRA",
    BRA: "BRA",

    Uruguay: "URY",
    URY: "URY",

    Greenland: "GRL",
    GRL: "GRL",

    Iceland: "ISL",
    ISL: "ISL",

    Russia: "RUS",
    Russian_Federation: "RUS",
    RUS: "RUS",

    Kazakhstan: "KAZ",
    KAZ: "KAZ",

    China: "CHN",
    CHN: "CHN",

    Mongolia: "MNG",
    MNG: "MNG",

    Australia: "AUS",
    AUS: "AUS",

    Papua_New_Guinea: "PNG",
    "Papua New Guinea": "PNG",
    PNG: "PNG",

    Indonesia: "IDN",
    IDN: "IDN",

    South_Korea: "KOR",
    "South Korea": "KOR",
    Republic_of_Korea: "KOR",
    KOR: "KOR",

    North_Korea: "PRK",
    "North Korea": "PRK",
    Democratic_Peoples_Republic_of_Korea: "PRK",
    PRK: "PRK",

    Mauritania: "MRT",
    MRT: "MRT",

    Western_Sahara: "ESH",
    "Western Sahara": "ESH",
    ESH: "ESH",

    Morocco: "MAR",
    MAR: "MAR",

    Algeria: "DZA",
    DZA: "DZA",

    Mali: "MLI",
    MLI: "MLI",

    Cote_d_Ivoire: "CIV",
    "Côte_d_Ivoire": "CIV",
    Cote_dIvoire: "CIV",
    Ivory_Coast: "CIV",
    "Ivory Coast": "CIV",
    CIV: "CIV",

    Liberia: "LBR",
    LBR: "LBR",

    Sierra_Leone: "SLE",
    "Sierra Leone": "SLE",
    SLE: "SLE",

    Guinea: "GIN",
    GIN: "GIN",

    Senegal: "SEN",
    SEN: "SEN",

    Guinea_Bissau: "GNB",
    "Guinea-Bissau": "GNB",
    GNB: "GNB",

    Niger: "NER",
    NER: "NER",

    Nigeria: "NGA",
    NGA: "NGA",

    Ghana: "GHA",
    GHA: "GHA",

    Benin: "BEN",
    BEN: "BEN",

    Togo: "TGO",
    TGO: "TGO",

    Burkina_Faso: "BFA",
    "Burkina Faso": "BFA",
    BFA: "BFA",

    Spain: "ESP",
    ESP: "ESP",

    Portugal: "PRT",
    PRT: "PRT",

    France: "FRA",
    FRA: "FRA",

    Gambia: "GMB",
    The_Gambia: "GMB",
    GMB: "GMB",

    Libya: "LBY",
    LBY: "LBY",

    Egypt: "EGY",
    EGY: "EGY",

    Saudi_Arabia: "SAU",
    "Saudi Arabia": "SAU",
    SAU: "SAU",

    Yemen: "YEM",
    YEM: "YEM",

    Oman: "OMN",
    OMN: "OMN",

    United_Arab_Emirates: "ARE",
    "United Arab Emirates": "ARE",
    UAE: "ARE",
    ARE: "ARE",

    Qatar: "QAT",
    QAT: "QAT",

    Bahrain: "BHR",
    BHR: "BHR",

    Iraq: "IRQ",
    IRQ: "IRQ",

    Syria: "SYR",
    SYR: "SYR",

    Jordan: "JOR",
    JOR: "JOR",

    Israel: "ISR",
    ISR: "ISR",

    Lebanon: "LBN",
    LBN: "LBN",

    Türkiye: "TUR",
    Turkey: "TUR",
    Turkiye: "TUR",
    TUR: "TUR",

    Greece: "GRC",
    GRC: "GRC",

    Croatia: "HRV",
    HRV: "HRV",

    Bosnia_and_Herzegovina: "BIH",
    "Bosnia and Herzegovina": "BIH",
    Bosnia_Herzegovina: "BIH",
    BIH: "BIH",

    Montenegro: "MNE",
    MNE: "MNE",

    North_Macedonia: "MKD",
    "North Macedonia": "MKD",
    Macedonia: "MKD",
    MKD: "MKD",

    Albania: "ALB",
    ALB: "ALB",

    Kosovo: "KOS",
    KOS: "KOS",

    Serbia: "SRB",
    SRB: "SRB",

    Bulgaria: "BGR",
    BGR: "BGR",

    Romania: "ROU",
    ROU: "ROU",

    DR_Congo: "COD",
    "DR Congo": "COD",
    Democratic_Republic_of_the_Congo: "COD",
    "Democratic Republic of the Congo": "COD",
    Congo_Democratic_Republic: "COD",
    COD: "COD",

    Iran: "IRN",
    Islamic_Republic_of_Iran: "IRN",
    IRN: "IRN",

    Turkmenistan: "TKM",
    TKM: "TKM",

    Afghanistan: "AFG",
    AFG: "AFG",

    Pakistan: "PAK",
    PAK: "PAK",

    Amsterdam: "AMS",
    AMS: "AMS"
};

function updateClock() {
    if (!clockElement) {
        return;
    }

    clockElement.textContent = new Date().toLocaleTimeString("en-GB", {
        hour12: false
    });
}

setInterval(updateClock, 1000);
updateClock();

function setSystemStatus(online) {
    if (systemStatusText) {
        systemStatusText.textContent = online
            ? "SYSTEM ONLINE"
            : "SYSTEM OFFLINE";
    }

    if (statusDot) {
        statusDot.classList.toggle("offline", !online);
    }

    if (mapStatusText) {
        mapStatusText.textContent = online
            ? "GLOBAL MAP ONLINE"
            : "MAP OFFLINE";
    }
}

function normalizeCountryName(value) {
    if (value === null || value === undefined) {
        return null;
    }

    let name = String(value).trim();

    if (!name) {
        return null;
    }

    name = name
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/&/g, "and")
        .replace(/['’]/g, "")
        .replace(/[^a-zA-Z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .replace(/_+/g, "_")
        .toLowerCase();

    return name || null;
}

const NORMALIZED_COUNTRY_NAME_TO_CODE = {};

for (const [name, code] of Object.entries(COUNTRY_NAME_TO_CODE)) {
    const normalized = normalizeCountryName(name);

    if (normalized) {
        NORMALIZED_COUNTRY_NAME_TO_CODE[normalized] = code;
    }
}

for (const code of Object.keys(COUNTRY_COLORS)) {
    const normalized = normalizeCountryName(code);

    if (normalized) {
        NORMALIZED_COUNTRY_NAME_TO_CODE[normalized] = code;
    }
}

function getCountryCode(feature) {
    if (!feature) {
        return null;
    }

    const properties = feature.properties || {};

    const directCodes = [
        feature.id,
        properties.adm0_a3,
        properties.ADM0_A3,
        properties.adm0_a3_us,
        properties.ADM0_A3_US,
        properties.iso_a3,
        properties.ISO_A3,
        properties.iso_a3_eh,
        properties.ISO_A3_EH,
        properties.sov_a3,
        properties.SOV_A3,
        properties.gu_a3,
        properties.GU_A3,
        properties.brk_a3,
        properties.BRK_A3,
        properties.wb_a3,
        properties.WB_A3,
        properties.cca3,
        properties.CCA3,
        properties.iso3,
        properties.ISO3,
        properties.country_code,
        properties.countryCode,
        properties.CountryCode,
        properties.code,
        properties.CODE,
        properties.Code,
        properties.cc,
        properties.CC
    ];

    for (const value of directCodes) {
        if (value === null || value === undefined) {
            continue;
        }

        const code = String(value).trim().toUpperCase();

        if (
            Object.prototype.hasOwnProperty.call(
                COUNTRY_COLORS,
                code
            )
        ) {
            return code;
        }

        if (
            Object.prototype.hasOwnProperty.call(
                COUNTRY_NAME_TO_CODE,
                code
            )
        ) {
            return COUNTRY_NAME_TO_CODE[code];
        }
    }

    const nameValues = [
        properties.name,
        properties.NAME,
        properties.name_en,
        properties.NAME_EN,
        properties.NAME_LONG,
        properties.name_long,
        properties.ADMIN,
        properties.admin,
        properties.SOVEREIGNT,
        properties.sovereignt,
        properties.country,
        properties.Country,
        properties.COUNTRY,
        properties.country_name,
        properties.CountryName,
        properties.path,
        properties.Path,
        properties.label,
        properties.Label,
        properties.title,
        properties.Title,
        properties.short_name,
        properties.formal_en,
        properties.FORMAL_EN
    ];

    for (const value of nameValues) {
        if (value === null || value === undefined) {
            continue;
        }

        const normalized = normalizeCountryName(value);

        if (!normalized) {
            continue;
        }

        if (
            Object.prototype.hasOwnProperty.call(
                NORMALIZED_COUNTRY_NAME_TO_CODE,
                normalized
            )
        ) {
            return NORMALIZED_COUNTRY_NAME_TO_CODE[normalized];
        }
    }

    return null;
}

function getCountryPath(feature) {
    return getCountryCode(feature);
}

function getCountryColor(countryCode) {
    if (!countryCode) {
        return null;
    }

    const code = String(countryCode).trim().toUpperCase();

    return COUNTRY_COLORS[code] || null;
}

function getCountryMaterial(countryCode, alpha = 0.52) {
    return Cesium.Color
        .fromCssColorString(getCountryColor(countryCode))
        .withAlpha(alpha);
}

function drawCountryLabel(
    viewer,
    countryCode,
    latitude,
    longitude,
    labelText
) {
    if (
        !viewer ||
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude)
    ) {
        return null;
    }

    const position =
        Cesium.Cartesian3.fromDegrees(
            longitude,
            latitude,
            1500
        );

    const entity =
        viewer.entities.add({
            id:
                `countryLabel-${countryCode}`,
            name: labelText,
            position,
            label: {
                text: labelText,
                font:
                    "700 11px \"Segoe UI\", sans-serif",
                fillColor:
                    Cesium.Color.WHITE.withAlpha(
                        0.92
                    ),
                style:
                    Cesium.LabelStyle.FILL,
                showBackground: true,
                backgroundColor:
                    Cesium.Color.BLACK.withAlpha(
                        0.35
                    ),
                backgroundPadding:
                    new Cesium.Cartesian2(
                        5,
                        4
                    ),
                pixelOffset:
                    new Cesium.Cartesian2(
                        0,
                        0
                    ),
                horizontalOrigin:
                    Cesium.HorizontalOrigin
                        .CENTER,
                verticalOrigin:
                    Cesium.VerticalOrigin
                        .CENTER,
                disableDepthTestDistance:
                    Number.POSITIVE_INFINITY,
                heightReference:
                    Cesium.HeightReference.NONE
            },
            properties: {
                countryLabel: true,
                countryCode
            }
        });

    countryLabelEntities.push(entity);

    return entity;
}

function computeApproxCentroid(coordinates) {
    if (
        !Array.isArray(coordinates) ||
        coordinates.length === 0
    ) {
        return null;
    }

    const polygons =
        coordinates.length === 1 &&
        Array.isArray(coordinates[0]) &&
        Array.isArray(coordinates[0][0]) &&
        typeof coordinates[0][0][0] ===
            "number"
            ? [coordinates]
            : coordinates;

    let bestRing = null;
    let bestSize = -1;

    for (const polygon of polygons) {
        if (
            !Array.isArray(polygon) ||
            !Array.isArray(polygon[0])
        ) {
            continue;
        }

        const ring = polygon[0];

        if (
            ring.length > bestSize
        ) {
            bestSize = ring.length;
            bestRing = ring;
        }
    }

    if (
        !bestRing ||
        bestRing.length === 0
    ) {
        return null;
    }

    let latSum = 0;
    let lonSum = 0;

    for (const point of bestRing) {
        if (
            !Array.isArray(point) ||
            point.length < 2
        ) {
            continue;
        }

        latSum += Number(point[1]);
        lonSum += Number(point[0]);
    }

    if (
        !Number.isFinite(latSum) ||
        !Number.isFinite(lonSum)
    ) {
        return null;
    }

    return {
        lat:
            latSum / bestRing.length,
        lon:
            lonSum / bestRing.length
    };
}

function convertRingToPositions(ring) {
    if (!Array.isArray(ring)) {
        return [];
    }

    const positions = [];

    for (const coordinate of ring) {
        if (
            !Array.isArray(coordinate) ||
            coordinate.length < 2
        ) {
            continue;
        }

        const longitude = Number(coordinate[0]);
        const latitude = Number(coordinate[1]);

        if (
            !Number.isFinite(longitude) ||
            !Number.isFinite(latitude)
        ) {
            continue;
        }

        positions.push(
            Cesium.Cartesian3.fromDegrees(
                longitude,
                latitude,
                150
            )
        );
    }

    return positions;
}

function createPolygonHierarchy(coordinates) {
    if (
        !Array.isArray(coordinates) ||
        coordinates.length === 0
    ) {
        return null;
    }

    const outerPositions =
        convertRingToPositions(coordinates[0]);

    if (outerPositions.length < 3) {
        return null;
    }

    const holes = [];

    for (let i = 1; i < coordinates.length; i++) {
        const holePositions =
            convertRingToPositions(coordinates[i]);

        if (holePositions.length >= 3) {
            holes.push(
                new Cesium.PolygonHierarchy(
                    holePositions
                )
            );
        }
    }

    return new Cesium.PolygonHierarchy(
        outerPositions,
        holes
    );
}

function drawCountryPolygon(
    viewer,
    coordinates,
    countryCode
) {
    const hierarchy =
        createPolygonHierarchy(coordinates);

    if (!hierarchy) {
        return null;
    }

    const color =
        getCountryColor(countryCode);

    const entity = viewer.entities.add({
        name: countryCode,

        polygon: {
            hierarchy: hierarchy,

            material:
                getCountryMaterial(
                    countryCode,
                    0.78
                ),

            outline: true,

            outlineColor:
                Cesium.Color.BLACK.withAlpha(
                    0.85
                ),

            height: 150,

            heightReference:
                Cesium.HeightReference.NONE
        },

        properties: {
            country: countryCode,
            countryCode: countryCode,
            mapChartColor: color
        }
    });

    countryTileEntities.push(entity);

    return entity;
}

function drawCountryGeometry(
    viewer,
    feature
) {
    if (
        !feature ||
        !feature.geometry
    ) {
        return [];
    }

    const countryCode =
        getCountryCode(feature);

    if (!countryCode) {
        console.warn(
            "Unable to identify country:",
            feature.properties || feature
        );

        return [];
    }

    if (!getCountryColor(countryCode)) {
        return [];
    }

    if (
        !labeledCountryCodes.has(
            countryCode
        )
    ) {
        labeledCountryCodes.add(
            countryCode
        );

        const centroid =
            computeApproxCentroid(
                feature.geometry.coordinates
            );

        if (centroid) {
            drawCountryLabel(
                viewer,
                countryCode,
                centroid.lat,
                centroid.lon,
                countryCode
            );
        }
    }

    const geometry =
        feature.geometry;

    const entities = [];

    if (geometry.type === "Polygon") {
        const entity =
            drawCountryPolygon(
                viewer,
                geometry.coordinates,
                countryCode
            );

        if (entity) {
            entities.push(entity);
        }

        return entities;
    }

    if (geometry.type === "MultiPolygon") {
        for (const polygon of geometry.coordinates) {
            const entity =
                drawCountryPolygon(
                    viewer,
                    polygon,
                    countryCode
                );

            if (entity) {
                entities.push(entity);
            }
        }
    }

    return entities;
}

async function loadCountries(viewer) {
    try {
        const response =
            await fetch(
                "/assets/countries.geo.json",
                {
                    cache: "force-cache",
                    credentials: "same-origin"
                }
            );

        if (!response.ok) {
            throw new Error(
                `Country GeoJSON HTTP ${response.status}`
            );
        }

        const geojson =
            await response.json();

        let features = [];

        if (
            geojson &&
            geojson.type === "FeatureCollection" &&
            Array.isArray(geojson.features)
        ) {
            features = geojson.features;
        } else if (
            geojson &&
            geojson.type === "Feature"
        ) {
            features = [geojson];
        }

        if (features.length === 0) {
            throw new Error(
                "Country GeoJSON contains no features."
            );
        }

        let rendered = 0;
        let unidentified = 0;

        for (const feature of features) {
            const code =
                getCountryCode(feature);

            if (!code) {
                unidentified++;

                console.warn(
                    "Country feature has no recognised country code:",
                    feature.properties || feature
                );

                continue;
            }

            const entities =
                drawCountryGeometry(
                    viewer,
                    feature
                );

            rendered += entities.length;
        }

        console.log(
            `Stardust country colours loaded. ${rendered} country polygon entities rendered. ${unidentified} features unidentified.`
        );

        return true;
    } catch (error) {
        console.error(
            "Failed to load countries:",
            error
        );

        return false;
    }
}

function setupCountryInteraction(viewer) {
    viewer.screenSpaceEventHandler.setInputAction(
        click => {
            const picked =
                viewer.scene.pick(
                    click.position
                );

            if (!Cesium.defined(picked)) {
                return;
            }

            let entity = picked.id;

            if (!entity && picked.primitive) {
                entity = picked.primitive;
            }

            if (
                !entity ||
                !entity.properties
            ) {
                return;
            }

            const countryProperty =
                entity.properties.country ||
                entity.properties.countryCode;

            if (!countryProperty) {
                return;
            }

            let country = null;

            try {
                country =
                    countryProperty.getValue(
                        viewer.clock.currentTime
                    );
            } catch {
                try {
                    country =
                        countryProperty.getValue();
                } catch {
                    country =
                        countryProperty;
                }
            }

            let color = null;

            const colorProperty =
                entity.properties.mapChartColor;

            if (colorProperty) {
                try {
                    color =
                        colorProperty.getValue(
                            viewer.clock.currentTime
                        );
                } catch {
                    try {
                        color =
                            colorProperty.getValue();
                    } catch {
                        color =
                            colorProperty;
                    }
                }
            }

            console.log(
                "Selected country:",
                country,
                color
            );

            window.dispatchEvent(
                new CustomEvent(
                    "stardust-country-selected",
                    {
                        detail: {
                            country,
                            color
                        }
                    }
                )
            );
        },
        Cesium.ScreenSpaceEventType.LEFT_CLICK
    );
}

async function createGlobe() {
    const container =
        document.getElementById("globe") ||
        document.getElementById("mapGlobe");

    if (!container) {
        throw new Error(
            'Cesium globe container not found. Expected an element with id="globe" or id="mapGlobe".'
        );
    }

    const viewer =
        new Cesium.Viewer(
            container,
            {
                requestRenderMode: true,
                maximumRenderTimeChange: Infinity,

                terrainProvider:
                    new Cesium.EllipsoidTerrainProvider(),

                animation: false,
                timeline: false,
                baseLayerPicker: false,
                geocoder: false,
                homeButton: false,
                sceneModePicker: false,
                navigationHelpButton: false,
                fullscreenButton: false,
                infoBox: false,
                selectionIndicator: false,
                shadows: false,
                scene3DOnly: true
            }
        );

    viewer.scene.globe.enableLighting = true;

    viewer.scene.globe.depthTestAgainstTerrain = false;

    viewer.scene.globe.showGroundAtmosphere = true;

    viewer.scene.globe.dynamicAtmosphereLighting = true;

    viewer.scene.globe.baseColor =
        Cesium.Color.fromCssColorString(
            "#101820"
        );

    viewer.camera.setView({
        destination:
            Cesium.Cartesian3.fromDegrees(
                0,
                25,
                20000000
            )
    });

    try {
        const terrain =
            Cesium.Terrain.fromWorldTerrain();

        if (
            terrain &&
            terrain.errorEvent
        ) {
            terrain.errorEvent.addEventListener(
                error => {
                    console.warn(
                        "Cesium World Terrain unavailable:",
                        error
                    );

                    viewer.terrainProvider =
                        new Cesium.EllipsoidTerrainProvider();

                    viewer.scene.globe.depthTestAgainstTerrain =
                        false;
                }
            );
        }

        viewer.scene.setTerrain(terrain);

        console.log(
            "Cesium World Terrain requested."
        );
    } catch (error) {
        console.warn(
            "World Terrain failed. Continuing with ellipsoid globe:",
            error
        );

        viewer.terrainProvider =
            new Cesium.EllipsoidTerrainProvider();

        viewer.scene.globe.depthTestAgainstTerrain =
            false;
    }

    Cesium.createOsmBuildingsAsync()
        .then(osmBuildings => {
            if (!osmBuildings) {
                return;
            }

            viewer.scene.primitives.add(
                osmBuildings
            );

            osmBuildingsPrimitive =
                osmBuildings;

            console.log(
                "Cesium OSM Buildings loaded."
            );
        })
        .catch(error => {
            console.warn(
                "OSM Buildings unavailable. Continuing without 3D buildings:",
                error
            );
        });

    await loadCountryFactions();

    viewer.scene.requestRender();

    setupCountryInteraction(viewer);

    window.stardustViewer = viewer;
    window.stardustCountryColors = COUNTRY_COLORS;
    window.stardustGetCountryCode = getCountryCode;
    window.stardustGetCountryColor = getCountryColor;
    window.stardustFactions = COUNTRY_FACTIONS;
    window.stardustCountryFactionByName = FACTION_BY_NAME;

    if (
        window.TacView &&
        document.getElementById("mapGlobe")
    ) {
        window.TacView.init(viewer);
    }

    bindMapControls(viewer);

    renderUnitMarkers(viewer);
    renderBaseMarkers(viewer);

    loadCountries(viewer).then(
        () => {
            viewer.scene.requestRender();
        }
    );

    return viewer;
}

function unitColor(unit) {
    if (
        unit &&
        unit.country
    ) {
        const lookup =
            FACTION_BY_NAME[
                normalizeCountryName(
                    unit.country
                )
            ];

        if (lookup && lookup.color) {
            return lookup.color;
        }
    }

    return (
        UNIT_TYPE_COLORS[
            unit && unit.type
        ] || UNIT_TYPE_COLORS.infantry
    );
}

function clearUnitMarkers() {
    const viewer =
        window.stardustViewer;

    if (!viewer) {
        return;
    }

    for (const entity of
            markerEntities.values()) {
        viewer.entities.remove(entity);
    }

    markerEntities.clear();
    unitMarkerMeta.clear();
}

function renderUnitMarkers(viewer) {
    if (!viewer) {
        return;
    }

    if (
        window.TacView &&
        window.TacView.enabled
    ) {
        window.TacView.setUnits(stardustUnits);
        return;
    }

    const filtered =
        unitForceFilter
            ? stardustUnits.filter(
                unit =>
                    unit.type ===
                    unitForceFilter
            )
            : stardustUnits;

    const wanted = new Set();
    let changed = false;

    for (const unit of filtered) {
        if (
            !Number.isFinite(unit.lat) ||
            !Number.isFinite(unit.lon)
        ) {
            continue;
        }

        const isHighlight =
            highlightUnitId &&
            unit.id ===
                highlightUnitId;

        const colorCss =
            unitColor(unit);

        const sig =
            unit.lat.toFixed(5) +
            "|" +
            unit.lon.toFixed(5) +
            "|" +
            unit.name +
            "|" +
            colorCss +
            (isHighlight ? "|h" : "");

        const meta =
            unitMarkerMeta.get(
                unit.id
            );

        if (
            meta &&
            meta.sig === sig &&
            markerEntities.has(
                unit.id
            )
        ) {
            wanted.add(unit.id);
            continue;
        }

        wanted.add(unit.id);
        changed = true;

        const label = isHighlight
            ? `◉ ${unit.name}`
            : unit.name;

        const existing =
            markerEntities.get(
                unit.id
            );

        if (existing) {
            const position =
                Cesium.Cartesian3.fromDegrees(
                    unit.lon,
                    unit.lat,
                    500
                );

            existing.position =
                new Cesium.ConstantPositionProperty(
                    position
                );

            existing.label.position =
                new Cesium.ConstantPositionProperty(
                    position
                );

            existing.label.text =
                label;

            existing.point.color =
                Cesium.Color.fromCssColorString(
                    colorCss
                );

            existing.point.pixelSize =
                isHighlight
                    ? 14
                    : 9;

            existing.point.outlineWidth =
                isHighlight
                    ? 3
                    : 1.5;

            existing.point.outlineColor =
                isHighlight
                    ? Cesium.Color.WHITE
                    : Cesium.Color.BLACK
                        .withAlpha(0.9);

            existing.label.fillColor =
                isHighlight
                    ? Cesium.Color.WHITE
                    : Cesium.Color
                        .fromCssColorString(
                            "#d6dde2"
                        );

            markerEntities.set(
                unit.id,
                existing
            );

            unitMarkerMeta.set(
                unit.id,
                { sig }
            );

            continue;
        }

        const position =
            Cesium.Cartesian3.fromDegrees(
                unit.lon,
                unit.lat,
                500
            );

        const color =
            Cesium.Color.fromCssColorString(
                colorCss
            );

        const entity =
            viewer.entities.add({
                id: `unit-${unit.id}`,
                name: unit.name,
                position,
                point: {
                    pixelSize:
                        isHighlight
                            ? 14
                            : 9,
                    color,
                    outlineColor:
                        isHighlight
                            ? Cesium.Color.WHITE
                            : Cesium.Color.BLACK
                            .withAlpha(0.9),
                    outlineWidth:
                        isHighlight
                            ? 3
                            : 1.5,
                    heightReference:
                        Cesium.HeightReference.NONE
                },
                label: {
                    text: label,
                    font:
                        "700 10px \"Segoe UI\", sans-serif",
                    fillColor:
                        isHighlight
                            ? Cesium.Color.WHITE
                            : Cesium.Color
                                .fromCssColorString(
                                    "#d6dde2"
                                ),
                    pixelOffset:
                        new Cesium.Cartesian2(
                            0,
                            -16
                        ),
                    showBackground: true,
                    backgroundColor:
                        Cesium.Color
                            .BLACK.withAlpha(
                                0.6
                            ),
                    position:
                        new Cesium.ConstantPositionProperty(
                            position
                        ),
                    horizontalOrigin:
                        Cesium.HorizontalOrigin
                            .CENTER,
                    verticalOrigin:
                        Cesium.VerticalOrigin
                            .BOTTOM,
                    disableDepthTestDistance:
                        Number.POSITIVE_INFINITY,
                    style:
                        Cesium.LabelStyle
                            .FILL
                },
                properties: {
                    unit: true,
                    unitId: unit.id,
                    unitType: unit.type,
                    unitStatus: unit.status,
                    unitPersonnel:
                        unit.personnel,
                    unitCountry:
                        unit.country || ""
                }
            });

        markerEntities.set(
            unit.id,
            entity
        );

        unitMarkerMeta.set(
            unit.id,
            { sig }
        );
    }

    for (const [
        id,
        entity
    ] of markerEntities) {
        if (wanted.has(id)) {
            continue;
        }

        viewer.entities.remove(
            entity
        );

        markerEntities.delete(
            id
        );

        unitMarkerMeta.delete(
            id
        );

        changed = true;
    }

    updateMarkerCount();

    if (changed) {
        if (
            highlightUnitId &&
            !unitFlyDone
        ) {
            const target =
                markerEntities.get(
                    highlightUnitId
                );

            if (target) {
                unitFlyDone = true;

                viewer.camera.flyTo({
                    destination:
                        target.position
                            .getValue(
                                Cesium.JulianDate.now()
                            ),
                    duration: 1.6
                });
            }
        }

        viewer.scene.requestRender();
    }
}

function updateMarkerCount() {
    const activeMarkers =
        document.getElementById(
            "activeMarkers"
        );

    if (activeMarkers) {
        activeMarkers.textContent =
            markerEntities.size +
            baseMarkerEntities.size;
    }
}

function baseFactionColor(base) {
    if (
        base &&
        base.country
    ) {
        const lookup =
            FACTION_BY_NAME[
                normalizeCountryName(
                    base.country
                )
            ];

        if (lookup && lookup.color) {
            return lookup.color;
        }
    }

    return "#d6dde2";
}

function clearBaseMarkers() {
    const viewer =
        window.stardustViewer;

    if (!viewer) {
        return;
    }

    for (const entity of
            baseMarkerEntities.values()) {
        viewer.entities.remove(entity);
    }

    baseMarkerEntities.clear();
    baseMarkerMeta.clear();
}

function baseImageFor(colorCss, symbol) {
    const key =
        colorCss + "|" + symbol;

    const cached =
        baseImageCache.get(key);

    if (cached) {
        return cached;
    }

    const canvas =
        document.createElement("canvas");

    const size = 26;

    canvas.width = size;
    canvas.height = size;

    const ctx =
        canvas.getContext("2d");

    ctx.fillStyle =
        "rgba(5,7,10,0.78)";

    ctx.strokeStyle =
        Cesium.Color
            .fromCssColorString(
                colorCss
            )
            .withAlpha(0.8)
            .toCssColorString();

    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.arc(
        size / 2,
        size / 2,
        size / 2 - 1,
        0,
        Math.PI * 2
    );
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#ffffff";
    ctx.font =
        "bold 13px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(
        symbol,
        size / 2,
        size / 2 + 1
    );

    const dataUrl =
        canvas.toDataURL();

    baseImageCache.set(
        key,
        dataUrl
    );

    return dataUrl;
}

function renderBaseMarkers(viewer) {
    if (!viewer) {
        return;
    }

    const wanted = new Set();
    let changed = false;

    for (const base of stardustBases) {
        if (
            !Number.isFinite(base.lat) ||
            !Number.isFinite(base.lon)
        ) {
            continue;
        }

        const colorCss =
            baseFactionColor(base);

        const symbol =
            base.type === "naval_base" ? "⚓" :
            base.type === "airbase"   ? "✈" :
            base.type === "missile_base" ? "▲" :
            "■";

        const sig =
            base.lat.toFixed(5) +
            "|" +
            base.lon.toFixed(5) +
            "|" +
            colorCss +
            "|" +
            base.name;

        wanted.add(base.id);

        const meta =
            baseMarkerMeta.get(
                base.id
            );

        if (
            meta &&
            meta.sig === sig &&
            baseMarkerEntities.has(
                base.id
            )
        ) {
            continue;
        }

        changed = true;

        const existing =
            baseMarkerEntities.get(
                base.id
            );

        if (existing) {
            const position =
                Cesium.Cartesian3.fromDegrees(
                    base.lon,
                    base.lat,
                    1200
                );

            existing.position =
                new Cesium.ConstantPositionProperty(
                    position
                );

            existing.label.position =
                new Cesium.ConstantPositionProperty(
                    position
                );

            existing.label.text =
                base.name;

            existing.billboard.image =
                baseImageFor(
                    colorCss,
                    symbol
                );

            baseMarkerMeta.set(
                base.id,
                { sig }
            );

            continue;
        }

        const position =
            Cesium.Cartesian3.fromDegrees(
                base.lon,
                base.lat,
                1200
            );

        const color =
            Cesium.Color.fromCssColorString(
                colorCss
            );

        const entity =
            viewer.entities.add({
                id:
                    `base-${base.id}`,
                name: base.name,
                position,
                billboard: {
                    image:
                        baseImageFor(
                            colorCss,
                            symbol
                        ),
                    verticalOrigin:
                        Cesium.VerticalOrigin
                            .CENTER,
                    heightReference:
                        Cesium.HeightReference
                            .NONE,
                    disableDepthTestDistance:
                        Number.POSITIVE_INFINITY
                },
                label: {
                    text: base.name,
                    font:
                        "600 9px \"Segoe UI\", sans-serif",
                    fillColor:
                        Cesium.Color.WHITE.withAlpha(
                            0.92
                        ),
                    pixelOffset:
                        new Cesium.Cartesian2(
                            0,
                            -20
                        ),
                    showBackground: true,
                    backgroundColor:
                        Cesium.Color.BLACK.withAlpha(
                            0.6
                        ),
                    position:
                        new Cesium.ConstantPositionProperty(
                            position
                        ),
                    horizontalOrigin:
                        Cesium.HorizontalOrigin
                            .CENTER,
                    verticalOrigin:
                        Cesium.VerticalOrigin
                            .BOTTOM,
                    disableDepthTestDistance:
                        Number.POSITIVE_INFINITY,
                    style:
                        Cesium.LabelStyle
                            .FILL
                },
                properties: {
                    stardustBase: true,
                    baseId: base.id,
                    baseName: base.name,
                    baseType: base.type,
                    baseCountry:
                        base.country || ""
                }
            });

        baseMarkerEntities.set(
            base.id,
            entity
        );

        baseMarkerMeta.set(
            base.id,
            { sig }
        );
    }

    for (const [
        id,
        entity
    ] of baseMarkerEntities) {
        if (wanted.has(id)) {
            continue;
        }

        viewer.entities.remove(
            entity
        );

        baseMarkerEntities.delete(
            id
        );

        baseMarkerMeta.delete(
            id
        );

        changed = true;
    }

    updateMarkerCount();

    if (changed) {
        viewer.scene.requestRender();
    }
}

let unitRenderQueued = false;

function scheduleUnitRender() {
    if (unitRenderQueued) {
        return;
    }

    unitRenderQueued = true;

    requestAnimationFrame(() => {
        unitRenderQueued = false;
        renderUnitMarkers(window.stardustViewer);
    });
}

function bindMapControls(viewer) {
    const homeMap =
        document.getElementById(
            "homeMap"
        );

    const zoomIn =
        document.getElementById(
            "zoomIn"
        );

    const zoomOut =
        document.getElementById(
            "zoomOut"
        );

    const toggleBorders =
        document.getElementById(
            "toggleBorders"
        );

    const buildingsToggle =
        document.getElementById(
            "buildingsToggle"
        );

    const latitude =
        document.getElementById(
            "latitude"
        );

    const longitude =
        document.getElementById(
            "longitude"
        );

    const isMapPage =
        homeMap ||
        latitude;

    if (!isMapPage) {
        return;
    }

    const DEFAULT_VIEW =
        Cesium.Cartesian3.fromDegrees(
            0,
            25,
            20000000
        );

    if (homeMap) {
        homeMap.addEventListener(
            "click",
            () => {
                viewer.camera.flyTo({
                    destination:
                        DEFAULT_VIEW,
                    duration: 1.2
                });
            }
        );
    }

    if (zoomIn) {
        zoomIn.addEventListener(
            "click",
            () => {
                viewer.camera.zoomIn(
                    viewer.camera
                        .positionCartographic
                        .height *
                        0.35
                );
            }
        );
    }

    if (zoomOut) {
        zoomOut.addEventListener(
            "click",
            () => {
                viewer.camera.zoomOut(
                    Math.max(
                        viewer.camera
                            .positionCartographic
                            .height *
                            0.35,
                        250000
                    )
                );
            }
        );
    }

    if (toggleBorders) {
        let bordersVisible = true;

        toggleBorders.addEventListener(
            "click",
            () => {
                bordersVisible =
                    !bordersVisible;

                for (const entity of
                        countryTileEntities) {
                    if (
                        entity &&
                        entity.polygon
                    ) {
                        entity.show =
                            bordersVisible;
                    }
                }

                toggleBorders.classList
                    .toggle("active");

                toggleBorders.textContent =
                    bordersVisible
                        ? "COUNTRY BORDERS: ON"
                        : "COUNTRY BORDERS: OFF";

                viewer.scene.requestRender();
            }
        );
    }

    if (buildingsToggle) {
        let buildingsVisible = true;

        buildingsToggle.addEventListener(
            "click",
            () => {
                buildingsVisible =
                    !buildingsVisible;

                if (
                    osmBuildingsPrimitive
                ) {
                    osmBuildingsPrimitive.show =
                        buildingsVisible;
                }

                buildingsToggle.classList
                    .toggle("active");

                buildingsToggle.textContent =
                    buildingsVisible
                        ? "3D BUILDINGS: ON"
                        : "3D BUILDINGS: OFF";

                viewer.scene.requestRender();
            }
        );

        if (
            osmBuildingsPrimitive
        ) {
            buildingsToggle.textContent =
                "3D BUILDINGS: ON";
        }
    }

    if (latitude && longitude) {
        const handler =
            new Cesium.ScreenSpaceEventHandler(
                viewer.scene.canvas
            );

        handler.setInputAction(
            movement => {
                const cartesian =
                    viewer.camera.pickEllipsoid(
                        movement.endPosition,
                        viewer.scene.globe
                            .ellipsoid
                    );

                if (!cartesian) {
                    return;
                }

                const cartographic =
                    Cesium.Cartographic
                        .fromCartesian(
                            cartesian
                        );

                const lat =
                    Cesium.Math
                        .toDegrees(
                            cartographic.latitude
                        );

                const lon =
                    Cesium.Math
                        .toDegrees(
                            cartographic.longitude
                        );

                latitude.textContent =
                    lat.toFixed(3) +
                    "°";

                longitude.textContent =
                    lon.toFixed(3) +
                    "°";
            },
            Cesium.ScreenSpaceEventType
                .MOUSE_MOVE
        );
    }
}

function startStardustGlobe() {
    const start = () => {
        createGlobe()
            .then(() => {
                console.log(
                    "Stardust globe created successfully."
                );

                setSystemStatus(true);
            })
            .catch(error => {
                console.error(
                    "Failed to create Stardust globe:",
                    error
                );

                setSystemStatus(false);
            });
    };

    if (document.readyState === "loading") {
        document.addEventListener(
            "DOMContentLoaded",
            start,
            {
                once: true
            }
        );
    } else {
        start();
    }
}

function addChatMessage(username, message) {
    if (!chat) {
        return;
    }

    pendingChatMessages.push({ username, message });

    if (!chatRenderQueued) {
        chatRenderQueued = true;
        requestAnimationFrame(flushChatMessages);
    }
}

const pendingChatMessages = [];
let chatRenderQueued = false;

function flushChatMessages() {
    chatRenderQueued = false;

    if (!chat) {
        pendingChatMessages.length = 0;
        return;
    }

    const batch = pendingChatMessages.slice();
    pendingChatMessages.length = 0;

    for (const item of batch) {
        const element =
            document.createElement("div");

        element.className = "message";

        const usernameElement =
            document.createElement("b");

        usernameElement.textContent =
            item.username;

        const messageElement =
            document.createElement("span");

        messageElement.textContent =
            item.message;

        element.appendChild(
            usernameElement
        );

        element.appendChild(
            messageElement
        );

        chat.appendChild(element);
    }

    chat.scrollTop =
        chat.scrollHeight;
}

function getDiscordName() {
    if (!currentUser) {
        return "Unknown";
    }

    return (
        currentUser.display_name ||
        currentUser.global_name ||
        currentUser.username ||
        currentUser.name ||
        "Unknown"
    );
}

function getWebSocketURL() {
    return window.stardustWsUrl();
}

function connectChat() {
    if (
        socket &&
        (
            socket.readyState === WebSocket.OPEN ||
            socket.readyState === WebSocket.CONNECTING
        )
    ) {
        return;
    }

    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }

    const websocketURL =
        getWebSocketURL();

    console.log(
        "Connecting Stardust WebSocket:",
        websocketURL
    );

    try {
        socket =
            new WebSocket(
                websocketURL
            );
    } catch (error) {
        console.error(
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
                "Stardust WebSocket connected."
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

            try {
                socket.send(
                    JSON.stringify({
                        type: "client_version",
                        version:
                            window.stardustClientVersion ||
                            ""
                    })
                );
            } catch (error) {
                console.warn(
                    "Failed to report client version:",
                    error
                );
            }
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
                    data.type === "chat"
                ) {
                    addChatMessage(
                        data.username ||
                            "Unknown",
                        data.message ||
                            ""
                    );
                }

                if (
                    data.type === "server_status"
                ) {
                    if (
                        onlinePersonnel &&
                        typeof data.onlineUsers ===
                            "number"
                    ) {
                        onlinePersonnel.textContent =
                            data.onlineUsers;
                    }
                }

                if (
                    data.type ===
                    "orders"
                ) {
                    if (activeOrders) {
                        activeOrders.textContent =
                            Array.isArray(
                                data.orders
                            )
                                ? data.orders.length
                                : 0;
                    }

                    if (window.TacView) {
                        window.TacView.onOrders(
                            Array.isArray(
                                data.orders
                            )
                                ? data.orders
                                : []
                        );
                    }
                }

                if (
                    data.type ===
                    "country_leaders"
                ) {
                    if (
                        activeCountries &&
                        Array.isArray(
                            data.leaders
                        )
                    ) {
                        activeCountries.textContent =
                            data.leaders.length;
                    }
                }

if (
                    data.type ===
                    "user"
                ) {
                    currentUser =
                        data.user ||
                        data;

                    window.currentUser =
                        currentUser;
                }

                if (
                    data.type ===
                    "sim_telemetry"
                ) {
                    if (window.TacView) {
                        window.TacView.onTelemetry(data);
                    }
                }

                if (
                    data.type ===
                    "sim_event"
                ) {
                    if (window.TacView) {
                        window.TacView.onSimEvent(data);
                    }
                }

                if (
                    data.type ===
                    "error"
                ) {
                    if (window.TacView) {
                        window.TacView.onError(data);
                    }
                }

                if (
                    data.type ===
                    "client_update"
                ) {
                    if (
                        data.updateRequired ===
                        true &&
                        typeof window
                            .stardustNotifyUpdate ===
                            "function"
                    ) {
                        window
                            .stardustNotifyUpdate(
                                data.latest
                            );
                    }
                }

                if (
                    data.type ===
                    "units"
                ) {
                    stardustUnits =
                        Array.isArray(
                            data.units
                        )
                            ? data.units
                            : [];

                    window.stardustUnits =
                        stardustUnits;

                    scheduleUnitRender();
                }

                if (
                    data.type ===
                    "bases"
                ) {
                    stardustBases =
                        Array.isArray(
                            data.bases
                        )
                            ? data.bases
                            : [];

                    window.stardustBases =
                        stardustBases;

                    if (
                        window.stardustViewer
                    ) {
                        renderBaseMarkers(
                            window.stardustViewer
                        );
                    }
                }

                if (
                    data.type ===
                    "request_settings"
                ) {
                    if (
                        window.stardustUserData
                    ) {
                        const settings =
                            window.stardustUserData.getPushPayload();

                        if (
                            Object.keys(
                                settings
                            ).length
                        ) {
                            socket.send(
                                JSON.stringify({
                                    type: "settings_push",
                                    settings
                                })
                            );
                        }
                    }
                }

                if (
                    data.type ===
                    "update"
                ) {
                    if (
                        window.stardustUpdater
                    ) {
                        window.stardustUpdater.checkForUpdates();
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
            console.warn(
                "Stardust WebSocket disconnected.",
                event && event.code
            );

            setSystemStatus(false);

            if (
                event &&
                (event.code === 4001 ||
                    event.code === 4003 ||
                    event.code === 4004)
            ) {
                reconnectDisabled = true;
                console.warn(
                    "WebSocket closed with terminal code " +
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
                "Stardust WebSocket error:",
                error
            );
        }
    );
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

                connectChat();

                reconnectDelay =
                    Math.min(
                        reconnectDelay * 2,
                        30000
                    );
            },
            reconnectDelay
        );
}

function sendChatMessage() {
    if (!chatInput) {
        return;
    }

    const message =
        chatInput.value.trim();

    if (!message) {
        return;
    }

    if (
        !socket ||
        socket.readyState !==
            WebSocket.OPEN
    ) {
        console.warn(
            "Chat WebSocket is not connected."
        );

        return;
    }

    socket.send(
        JSON.stringify({
            type: "chat",
            username:
                getDiscordName(),
            message
        })
    );

    chatInput.value = "";
}

if (sendButton) {
    sendButton.addEventListener(
        "click",
        sendChatMessage
    );
}

if (chatInput) {
    chatInput.addEventListener(
        "keydown",
        event => {
            if (event.key === "Enter") {
                event.preventDefault();
                sendChatMessage();
            }
        }
    );
}

async function loadCurrentUser() {
    try {
        const response =
            await fetch(
                window.stardustApi("/api/user"),
                {
                    credentials: "include",
                    cache: "no-cache"
                }
            );

        if (!response.ok) {
            return;
        }

        const data =
            await response.json();

        currentUser =
            data.user ||
            data;

        window.currentUser =
            currentUser;
    } catch (error) {
        console.warn(
            "Unable to load current user:",
            error
        );
    }
}

window.addEventListener(
    "beforeunload",
    () => {
        if (socket) {
            socket.close();
        }
    }
);

(function parseMapOptions() {
    try {
        const params =
            new URLSearchParams(
                window.location.search
            );

        const force =
            params.get("force");

        const unitId =
            params.get("unit");

        if (force) {
            unitForceFilter =
                String(force);
        }

        if (unitId) {
            highlightUnitId =
                String(unitId);
        }

        window.stardustUnitFilter =
            unitForceFilter;

        window.stardustHighlightUnitId =
            highlightUnitId;

        const filterChip =
            document.getElementById(
                "forceFilterChip"
            );

        if (filterChip && unitForceFilter) {
            filterChip.textContent =
                "FILTER: " +
                unitForceFilter
                    .toUpperCase();
            filterChip.style.display =
                "";
            filterChip.title =
                "Show all units";

            filterChip.addEventListener(
                "click",
                () => {
                    unitForceFilter =
                        null;
                    window.stardustUnitFilter =
                        null;
                    filterChip.style.display =
                        "none";
                    scheduleUnitRender();
                }
            );
        }
    } catch (error) {
        console.warn(
            "Failed to parse map options:",
            error
        );
    }
})();

startStardustGlobe();

loadCurrentUser();

connectChat();