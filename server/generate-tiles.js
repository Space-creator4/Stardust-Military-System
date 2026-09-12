const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const input = path.join(
    __dirname,
    "..",
    "client",
    "assets",
    "earth",
    "earth-21600.jpg"
);

const output = path.join(__dirname, "tiles");

const tileSize = 256;
const maxZoom = 5;

async function generateTiles() {
    console.log("Loading Earth image...");

    const image = sharp(input);

    const metadata = await image.metadata();

    console.log(
        `Source: ${metadata.width}x${metadata.height}`
    );

    for (let z = 0; z <= maxZoom; z++) {
        const tiles = Math.pow(2, z);

        const worldWidth = tiles * tileSize;
        const worldHeight = tiles * tileSize;

        console.log(`Generating zoom level ${z}...`);

        const zoomImage = await sharp(input)
            .resize(worldWidth, worldHeight)
            .jpeg({ quality: 90 })
            .toBuffer();

        for (let x = 0; x < tiles; x++) {
            const xDir = path.join(
                output,
                String(z),
                String(x)
            );

            fs.mkdirSync(xDir, {
                recursive: true
            });

            for (let y = 0; y < tiles; y++) {
                const tilePath = path.join(
                    xDir,
                    `${y}.jpg`
                );

                if (fs.existsSync(tilePath)) {
                    continue;
                }

                await sharp(zoomImage)
                    .extract({
                        left: x * tileSize,
                        top: y * tileSize,
                        width: tileSize,
                        height: tileSize
                    })
                    .jpeg({
                        quality: 90
                    })
                    .toFile(tilePath);
            }
        }

        console.log(
            `Zoom ${z} complete (${tiles}x${tiles} tiles)`
        );
    }

    console.log("");
    console.log("All tiles generated.");
}

generateTiles().catch(error => {
    console.error("Tile generation failed:");
    console.error(error);
});