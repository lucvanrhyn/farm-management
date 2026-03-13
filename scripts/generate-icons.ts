import sharp from "sharp";
import { readFileSync } from "fs";
import { join } from "path";

const publicDir = join(process.cwd(), "public");
const svg = readFileSync(join(publicDir, "icon.svg"));

async function generateIcons() {
  await sharp(svg).resize(192, 192).png().toFile(join(publicDir, "icon-192.png"));
  console.log("✓ icon-192.png");

  await sharp(svg).resize(512, 512).png().toFile(join(publicDir, "icon-512.png"));
  console.log("✓ icon-512.png");

  await sharp(svg).resize(180, 180).png().toFile(join(publicDir, "apple-touch-icon.png"));
  console.log("✓ apple-touch-icon.png");

  console.log("Done.");
}

generateIcons().catch(console.error);
