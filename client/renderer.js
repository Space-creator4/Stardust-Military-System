const CESIUM_ION_TOKEN =
    window.CESIUM_ION_TOKEN ||
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJub25jZSI6InM2VTIxd2dLM05zdG1IaS0iLCJqdGkiOiIzM2VhMGY5Ni01NWE1LTQ5YmYtOGU1Zi04ODFlY2YwYTEwYzMiLCJpZCI6NDgzNjczLCJzdWIiOiJTcGFjZTAxNDEwMSIsImlzcyI6Imh0dHBzOi8vYXBpLmNlc2l1bS5jb20iLCJhdWQiOiJTcGFjZTAxNDEwMV9kZWZhdWx0IiwiaWF0IjoxNzg5MjM0NzI2fQ.GNUwAzYQxneeJvk1TdgnXvL_5gE3cba6noef-U8bLTg";

Cesium.Ion.defaultAccessToken = CESIUM_ION_TOKEN;

const clockElement = document.getElementById("clock");
const systemStatusText = document.getElementById("systemStatusText");
const statusDot = document.querySelector(".status-dot");
const chatInput = document.getElementById("chatInput");
const sendButton = document.getElementById("sendButton");
const chat = document.getElementById("chat");

let currentUser = null;
let socket = null;
let reconnectTimer = null;
let reconnectDelay = 1000;

const DEFAULT_COUNTRY_COLOR = "#d1dbdd";

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
        const response = await fetch("countries.json");

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
        return DEFAULT_COUNTRY_COLOR;
    }

    const code = String(countryCode).trim().toUpperCase();

    return COUNTRY_COLORS[code] || DEFAULT_COUNTRY_COLOR;
}

function getCountryMaterial(countryCode, alpha = 0.52) {
    return Cesium.Color
        .fromCssColorString(getCountryColor(countryCode))
        .withAlpha(alpha);
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

    return viewer.entities.add({
        name: countryCode,

        polygon: {
            hierarchy: hierarchy,

            material:
                getCountryMaterial(
                    countryCode,
                    0.52
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
                    cache: "no-cache",
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

    try {
        const osmBuildings =
            await Cesium.createOsmBuildingsAsync();

        if (osmBuildings) {
            viewer.scene.primitives.add(
                osmBuildings
            );

            console.log(
                "Cesium OSM Buildings loaded."
            );
        }
    } catch (error) {
        console.warn(
            "OSM Buildings unavailable. Continuing without 3D buildings:",
            error
        );
    }

    await loadCountryFactions();

    await loadCountries(viewer);

    setupCountryInteraction(viewer);

    window.stardustViewer = viewer;
    window.stardustCountryColors = COUNTRY_COLORS;
    window.stardustGetCountryCode = getCountryCode;
    window.stardustGetCountryColor = getCountryColor;
    window.stardustFactions = COUNTRY_FACTIONS;
    window.stardustCountryFactionByName = FACTION_BY_NAME;

    return viewer;
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

    const element =
        document.createElement("div");

    element.className = "message";

    const usernameElement =
        document.createElement("b");

    usernameElement.textContent =
        username;

    const messageElement =
        document.createElement("span");

    messageElement.textContent =
        message;

    element.appendChild(
        usernameElement
    );

    element.appendChild(
        messageElement
    );

    chat.appendChild(element);

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
    const protocol =
        window.location.protocol === "https:"
            ? "wss:"
            : "ws:";

    return `${protocol}//${window.location.host}`;
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
                    data.type === "user"
                ) {
                    currentUser =
                        data.user ||
                        data;

                    window.currentUser =
                        currentUser;
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
            console.warn(
                "Stardust WebSocket disconnected."
            );

            setSystemStatus(false);

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
                "/api/user",
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

startStardustGlobe();

loadCurrentUser();

connectChat();