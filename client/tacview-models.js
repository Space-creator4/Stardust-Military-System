/* STARDUST TACVIEW MODELS
   Procedural runtime model library for the live shared picture.
   Ported from AZIMUTH scripts/build-models.mjs.

   Model local frame: +X forward, +Y up, +Z right. Cesium ENU frame is
   +X east, +Y north, +Z up. A heading of 0 (north) maps local +X to ENU +Y.
   modelMatrix = ENU(origin) * Rz(-heading) * M0 * S   where M0 is the
   local->ENU base permutation. Models are built once per kind and rendered as
   Cesium.Primitive + PerInstanceColorAppearance (flat, opaque), updated in
   place every tick via modelMatrix + color array mutation. */

(function () {

    if (typeof window.Cesium === "undefined") {
        console.warn("tacview-models.js: Cesium not loaded.");
        window.TacModels = null;
        return;
    }

    const C = Cesium;

    /* ----------------------------- mesh builder ---------------------------- */

    function Mesh() {
        this.pos = [];
        this.idx = [];
    }

    Mesh.prototype.tri = function (a, b, c) {
        const p = this.pos;
        const i = this.idx;
        const base = p.length / 3;
        p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
        i.push(base, base + 1, base + 2);
    };

    Mesh.prototype.quad = function (a, b, c, d) {
        this.tri(a, b, c);
        this.tri(a, c, d);
    };

    function box(mesh, cx, cy, cz, sx, sy, sz) {
        const x0 = cx - sx / 2, x1 = cx + sx / 2;
        const y0 = cy - sy / 2, y1 = cy + sy / 2;
        const z0 = cz - sz / 2, z1 = cz + sz / 2;
        const p000 = [x0, y0, z0];
        const p100 = [x1, y0, z0];
        const p110 = [x1, y1, z0];
        const p010 = [x0, y1, z0];
        const p001 = [x0, y0, z1];
        const p101 = [x1, y0, z1];
        const p111 = [x1, y1, z1];
        const p011 = [x0, y1, z1];
        mesh.quad(p100, p000, p001, p101);
        mesh.quad(p010, p110, p111, p011);
        mesh.quad(p001, p101, p111, p011);
        mesh.quad(p000, p100, p110, p010);
        mesh.quad(p000, p010, p011, p001);
        mesh.quad(p100, p101, p111, p110);
    }

    function prism(mesh, poly, yBot, yTop) {
        const top = poly.map(function (pt) { return [pt[0], yTop, pt[1]]; });
        const bot = poly.map(function (pt) { return [pt[0], yBot, pt[1]]; });
        const n = poly.length;
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            mesh.quad(top[i], top[j], bot[j], bot[i]);
        }
        for (let i = 1; i < n - 1; i++) mesh.tri(top[0], top[i], top[i + 1]);
        for (let i = 1; i < n - 1; i++) mesh.tri(bot[0], bot[i + 1], bot[i]);
    }

    function pipe(mesh, stations, segs) {
        if (!segs) segs = 14;
        const rings = stations.map(function (s) {
            const ry = s.ry != null ? s.ry : s.r;
            const rz = s.rz != null ? s.rz : s.r;
            const ring = [];
            for (let j = 0; j < segs; j++) {
                const a = (j / segs) * Math.PI * 2;
                ring.push([s.x, Math.cos(a) * ry, Math.sin(a) * rz]);
            }
            return { station: s, ring: ring };
        });
        for (let i = 0; i < rings.length - 1; i++) {
            const a = rings[i].ring;
            const b = rings[i + 1].ring;
            if (rings[i + 1].station.apex) {
                const apex = b[0];
                for (let j = 0; j < segs; j++) {
                    const p = a[j], q = a[(j + 1) % segs];
                    const base = mesh.pos.length / 3;
                    for (const v of [p, q, apex]) mesh.pos.push(v[0], v[1], v[2]);
                    mesh.idx.push(base, base + 1, base + 2);
                }
                continue;
            }
            for (let j = 0; j < segs; j++) {
                const jn = (j + 1) % segs;
                mesh.quad(a[j], a[jn], b[jn], b[j]);
            }
        }
    }

    /* ------------------------------ model builders ------------------------- */

    function buildAircraft(mesh) {
        pipe(mesh, [
            { x: -4.8, r: 0.04, apex: true }, { x: -4.2, r: 0.42 },
            { x: -3.2, r: 0.62 }, { x: -1.5, r: 0.76 }, { x: 0, r: 0.8 },
            { x: 2, r: 0.76 }, { x: 3.6, r: 0.68 }, { x: 4.6, r: 0.5 },
            { x: 5.3, r: 0.2 }, { x: 5.7, r: 0.03, apex: true }
        ]);
        prism(mesh, [[0.9, -3.7], [0.9, 3.7], [-3.1, 3.0], [-3.1, -3.0]], -0.14, 0.2);
        prism(mesh, [[-3.2, -1.2], [-3.2, 1.2], [-4.4, 1.55], [-4.4, -1.55]], 0.0, 0.14);
        box(mesh, -3.9, 1.0, 0, 0.9, 1.7, 0.08);
    }

    function buildBomber(mesh) {
        pipe(mesh, [
            { x: -8.2, r: 0.05, apex: true }, { x: -7.2, r: 0.5 },
            { x: -5, r: 0.9 }, { x: -2, r: 1.05 }, { x: 0, r: 1.1 },
            { x: 2.5, r: 1.0 }, { x: 5, r: 0.9 }, { x: 6.5, r: 0.6 },
            { x: 7.6, r: 0.25 }, { x: 8, r: 0.04, apex: true }
        ]);
        prism(mesh, [[1.4, -7.2], [1.4, 7.2], [-4.8, 5.6], [-4.8, -5.6]], -0.18, 0.24);
        prism(mesh, [[-5.4, -1.6], [-5.4, 1.6], [-7.2, 2.0], [-7.2, -2.0]], 0.0, 0.18);
        box(mesh, -6.6, 1.4, 0, 1.1, 2.2, 0.09);
        box(mesh, -6.2, 1.4, -2.2, 0.8, 1.8, 0.09);
        box(mesh, -6.2, 1.4, 2.2, 0.8, 1.8, 0.09);
    }

    function buildHelicopter(mesh) {
        box(mesh, -1.2, 1.2, 0, 4.4, 1.7, 1.6);
        box(mesh, -3.4, 1.5, 0, 1.0, 0.7, 1.0);
        box(mesh, 1.4, 1.05, 0, 3.0, 0.5, 0.34);
        box(mesh, 0, 2.35, 0, 0.1, 0.06, 11.0);
        box(mesh, 3.0, 1.35, 0, 0.1, 1.8, 0.3);
        box(mesh, -1.2, 0.12, 0.85, 1.3, 0.12, 0.2);
        box(mesh, -1.2, 0.12, -0.85, 1.3, 0.12, 0.2);
        box(mesh, 0.6, 1.05, -0.5, 1.2, 0.28, 0.9);
    }

    function buildUav(mesh) {
        prism(mesh, [
            [1.0, -4.6], [1.0, 4.6], [-3.4, 3.9], [-4.9, 0.8],
            [-4.9, -0.8], [-3.4, -3.9]
        ], -0.12, 0.14);
        box(mesh, -0.6, -0.05, 0, 3.4, 0.5, 0.7);
        box(mesh, -3.0, 0.3, 0, 1.2, 0.55, 0.16);
    }

    function buildMissile(mesh) {
        pipe(mesh, [
            { x: 3.1, r: 0.02, apex: true }, { x: 2.6, r: 0.15 },
            { x: 1.4, r: 0.18 }, { x: 0, r: 0.19 }, { x: -1.8, r: 0.19 },
            { x: -2.6, r: 0.16 }, { x: -3.0, r: 0.1, apex: true }
        ], 12);
        box(mesh, -2.8, 0.24, 0, 0.3, 0.6, 0.09);
        box(mesh, -2.8, -0.24, 0, 0.3, 0.6, 0.09);
        box(mesh, -2.8, 0, 0.24, 0.3, 0.09, 0.6);
        box(mesh, -2.8, 0, -0.24, 0.3, 0.09, 0.6);
    }

    function buildTank(mesh) {
        box(mesh, 0, 0.62, 0, 2.7, 1.15, 3.4);
        box(mesh, 0, 0.34, 1.82, 2.8, 0.72, 0.55);
        box(mesh, 0, 0.34, -1.82, 2.8, 0.72, 0.55);
        box(mesh, 0.2, 1.32, 0, 1.7, 0.85, 1.85);
        box(mesh, 1.5, 1.32, 0, 2.6, 0.3, 0.3);
    }

    function buildSam(mesh) {
        box(mesh, 0, 0.55, 0, 3.5, 1.05, 3.0);
        box(mesh, 1.2, 0.3, 1.15, 0.55, 0.6, 0.5);
        box(mesh, 1.2, 0.3, -1.15, 0.55, 0.6, 0.5);
        box(mesh, -1.2, 0.3, 1.15, 0.55, 0.6, 0.5);
        box(mesh, -1.2, 0.3, -1.15, 0.55, 0.6, 0.5);
        box(mesh, 0, 1.55, 0, 3.1, 1.05, 2.7);
        box(mesh, -0.8, 2.55, 0, 0.32, 1.05, 0.32);
        box(mesh, -0.8, 3.15, 0, 0.6, 0.08, 0.85);
    }

    function buildTruck(mesh) {
        box(mesh, 1.15, 0.9, 0, 1.6, 1.65, 2.2);
        box(mesh, -1.25, 1.1, 0, 2.6, 1.7, 2.4);
        box(mesh, 1.1, 0.34, 1.05, 0.7, 0.7, 0.5);
        box(mesh, 1.1, 0.34, -1.05, 0.7, 0.7, 0.5);
        box(mesh, -1.3, 0.34, 1.05, 0.7, 0.7, 0.5);
        box(mesh, -1.3, 0.34, -1.05, 0.7, 0.7, 0.5);
    }

    function buildRadar(mesh) {
        box(mesh, 0, 0.65, 0, 2.3, 1.1, 2.7);
        box(mesh, 0, 1.85, 0, 0.34, 1.6, 0.34);
        box(mesh, 0.05, 3.35, 0, 0.4, 2.3, 2.4);
        box(mesh, 0.55, 3.35, 0, 0.3, 1.2, 0.9);
    }

    function buildWarship(mesh) {
        pipe(mesh, [
            { x: 76, r: 0.5, apex: true }, { x: 74, r: 3.5 },
            { x: 60, r: 6.5 }, { x: 40, r: 7.8 }, { x: 0, r: 8.6, ry: 6.5 },
            { x: -30, r: 8.4, ry: 6.4 }, { x: -58, r: 7.2, ry: 6 },
            { x: -72, r: 3.2 }, { x: -76, r: 0.6, apex: true }
        ], 18);
        box(mesh, 0, 11.2, 0, 148, 5.5, 12.4);
        box(mesh, 2, 18.5, 0, 44, 11, 11);
        box(mesh, 26, 21.2, 1.6, 8, 6, 7);
        box(mesh, -18, 21.5, 0, 6, 5, 7);
        box(mesh, 48, 19.5, 0, 10, 8, 8);
        box(mesh, -58, 18.5, 0, 12, 6, 7);
        box(mesh, 66, 16.5, 0, 6, 3, 6);
    }

    function buildCarrier(mesh) {
        pipe(mesh, [
            { x: 166, r: 0.8, apex: true }, { x: 160, r: 6 },
            { x: 130, r: 14 }, { x: 60, r: 19, ry: 14 },
            { x: 0, r: 20, ry: 15 }, { x: -70, r: 19, ry: 14 },
            { x: -140, r: 14 }, { x: -158, r: 6 },
            { x: -164, r: 1.2, apex: true }
        ], 20);
        box(mesh, 0, 20, 0, 336, 7, 76);
        box(mesh, 42, 34, 13, 30, 16, 13);
        box(mesh, 40, 38, 20, 26, 6, 25);
        box(mesh, 90, 27, 14, 45, 6, 34);
    }

    function buildShip(mesh) {
        pipe(mesh, [
            { x: 40, r: 0.4, apex: true }, { x: 36, r: 2.5 },
            { x: 15, r: 4.5 }, { x: 0, r: 5, ry: 3.8 },
            { x: -20, r: 4.6, ry: 3.6 }, { x: -36, r: 2.8 },
            { x: -40, r: 0.5, apex: true }
        ], 16);
        box(mesh, 0, 6.5, 0, 78, 3.6, 7.6);
        box(mesh, 2, 11, 0, 24, 6.5, 6.5);
        box(mesh, 12, 13.4, 1, 5, 4, 4);
    }

    function buildSubmarine(mesh) {
        pipe(mesh, [
            { x: 45, r: 0.3, apex: true }, { x: 42, r: 1.6 },
            { x: 25, r: 4.0 }, { x: 0, r: 4.3 },
            { x: -20, r: 4.1 }, { x: -40, r: 2.6 },
            { x: -44, r: 0.5, apex: true }
        ], 16);
        box(mesh, 2, 5, 0, 12, 3.4, 1.6);
        box(mesh, -30, 4.6, 0, 12, 1.6, 1.4);
        box(mesh, -16, 5.8, 0, 3, 0.7, 0.9);
    }

    const BUILDERS = {
        aircraft: buildAircraft,
        bomber: buildBomber,
        helicopter: buildHelicopter,
        uav: buildUav,
        missile: buildMissile,
        tank: buildTank,
        sam: buildSam,
        truck: buildTruck,
        radar: buildRadar,
        warship: buildWarship,
        carrier: buildCarrier,
        ship: buildShip,
        submarine: buildSubmarine
    };

    const MODEL_BY_UNIT_TYPE = {
        infantry: "truck",
        armour: "tank",
        mechanized: "tank",
        recon: "truck",
        artillery: "truck",
        logistics: "truck",
        air: "aircraft",
        helicopter: "helicopter",
        naval: "warship"
    };

    const SCALE_BY_UNIT_TYPE = {
        infantry: 0.5,
        armour: 1.0,
        mechanized: 1.25,
        recon: 0.8,
        artillery: 1.15,
        logistics: 1.35,
        air: 1.0,
        helicopter: 1.0,
        naval: 1.0
    };

    const THREAT_KINDS = [
        "infantry", "tank", "sam", "radar", "truck",
        "aircraft", "bomber", "uav", "helicopter", "missile",
        "warship", "carrier", "ship", "submarine"
    ];

    const SCALE_BY_THREAT = {
        infantry: 0.5,
        tank: 1.0,
        sam: 1.0,
        radar: 1.0,
        truck: 1.0,
        aircraft: 1.0,
        bomber: 1.0,
        uav: 1.0,
        helicopter: 1.0,
        missile: 1.5,
        warship: 1.0,
        carrier: 1.0,
        ship: 1.0,
        submarine: 1.0
    };

    /* ------------------------------ geometry ------------------------------- */

    const geometryCache = new Map();

    function geometryForKind(kind) {
        let geo = geometryCache.get(kind);
        if (geo) {
            return geo;
        }
        const build = BUILDERS[kind];
        if (!build) {
            return geometryForKind("truck");
        }
        const mesh = new Mesh();
        build(mesh);
        const positions = new Float32Array(mesh.pos);
        const indexCount = mesh.idx.length;
        const indices = indexCount > 65535
            ? new Uint32Array(mesh.idx)
            : new Uint16Array(mesh.idx);
        const boundingSphere = C.BoundingSphere.fromVertices(positions);
        geo = new C.Geometry({
            attributes: {
                position: new C.GeometryAttribute({
                    componentDatatype: C.ComponentDatatype.FLOAT,
                    componentsPerAttribute: 3,
                    values: positions
                })
            },
            indices: indices,
            primitiveType: C.PrimitiveType.TRIANGLES,
            boundingSphere: boundingSphere
        });
        geometryCache.set(kind, geo);
        return geo;
    }

    /* -------------------------- primitive helpers -------------------------- */

    const appearanceCache = new Map();

    function appearanceFor(kind) {
        let app = appearanceCache.get(kind);
        if (!app) {
            app = new C.PerInstanceColorAppearance({
                flat: true,
                translucent: false
            });
            appearanceCache.set(kind, app);
        }
        return app;
    }

    /* Model frame permutation: local (+X fwd, +Y up, +Z right) -> ENU.
       columns: X=(0,1,0), Y=(0,0,1), Z=(1,0,0). */
    const BASE_ROTATION = C.Matrix3.fromArray([0, 1, 0, 0, 0, 1, 1, 0, 0]);

    function composeModelMatrix(lon, lat, alt, headingDeg, scale) {
        const origin = C.Cartesian3.fromDegrees(lon, lat, alt);
        const enu = C.Transforms.eastNorthUpToFixedFrame(origin);
        const s = C.Matrix3.fromScale(new C.Cartesian3(scale, scale, scale));
        const rz = C.Matrix3.fromRotationZ(C.Math.toRadians(-headingDeg || 0));
        const rot = C.Matrix3.multiply(rz, C.Matrix3.multiply(BASE_ROTATION, s, new C.Matrix3()), new C.Matrix3());
        return C.Matrix4.multiply(enu, C.Matrix4.fromRotationTranslation(rot), new C.Matrix4());
    }

    function makePrimitive(kind, r, g, b, id) {
        const geometry = geometryForKind(kind);
        const color = [r, g, b, 1];
        const instance = new C.GeometryInstance({
            id: id,
            geometry: geometry,
            attributes: { color: color },
            modelMatrix: C.Matrix4.IDENTITY
        });
        const primitive = new C.Primitive({
            geometryInstances: [instance],
            appearance: appearanceFor(kind),
            async: false,
            releaseGeometryInstances: false
        });
        return {
            primitive: primitive,
            instance: instance,
            colorArray: color
        };
    }

    function setColor(model, r, g, b) {
        const c = model.colorArray;
        c[0] = r;
        c[1] = g;
        c[2] = b;
    }

    function setPose(model, lon, lat, alt, headingDeg, scale) {
        model.primitive.modelMatrix =
            composeModelMatrix(lon, lat, alt, headingDeg, scale);
    }

    function setShow(model, show) {
        if (model) {
            model.primitive.show = show;
        }
    }

    function disposeModel(scene, model) {
        if (!model) {
            return;
        }
        scene.primitives.remove(model.primitive);
        model.primitive.destroy();
    }

    /* ------------------------------- exports ------------------------------- */

    window.TacModels = {
        modelForUnitType: function (type) {
            return {
                kind: MODEL_BY_UNIT_TYPE[type] || "truck",
                scale: SCALE_BY_UNIT_TYPE[type] != null
                    ? SCALE_BY_UNIT_TYPE[type]
                    : 1.0
            };
        },
        modelForThreatKind: function (kind) {
            return {
                kind: BUILDERS[kind] ? kind : "truck",
                scale: SCALE_BY_THREAT[kind] != null
                    ? SCALE_BY_THREAT[kind]
                    : 1.0
            };
        },
        makePrimitive: makePrimitive,
        setColor: setColor,
        setPose: setPose,
        setShow: setShow,
        disposeModel: disposeModel,
        THREAT_KINDS: THREAT_KINDS
    };

})();