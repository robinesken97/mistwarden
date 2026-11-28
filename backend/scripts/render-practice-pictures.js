// Added for Mistwarden on 2026-11-28.
// Renders the practice campaign's pictures (services/practiceCampaign.ts) from
// SVG drawn here, with the sharp the backend already has. Own work, no
// sources: see THIRD_PARTY_CREDITS.md. The PNGs are committed, since the
// production image has no fonts to draw the notice's text with; run this
// again after changing a drawing:
//
//   node scripts/render-practice-pictures.js
//
// The map is 24 x 18 squares of 70 px. Its walls, doors, light, fog and
// tokens are set in services/practiceCampaign.ts and follow this layout.

const path = require('path');
const sharp = require('sharp');

const OUT = path.join(__dirname, '..', 'assets', 'practice');
const SQ = 70;
const W = 24 * SQ;
const H = 18 * SQ;

// A fixed seed, so the same drawing gives the same file.
let seed = 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

function flagstones(x0, y0, x1, y1, base) {
  // The mortar between the stones.
  let out = `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="rgb(${base.map((v) => v - 40).join(',')})"/>`;
  const size = 35;
  for (let y = y0; y < y1; y += size) {
    const shift = ((y - y0) / size) % 2 ? size / 2 : 0;
    for (let x = x0 - shift; x < x1; x += size) {
      const shade = Math.round((rand() - 0.5) * 18);
      const c = base.map((v) => Math.max(0, Math.min(255, v + shade)));
      const left = Math.max(x, x0);
      const right = Math.min(x + size, x1);
      out += `<rect x="${left + 1}" y="${y + 1}" width="${right - left - 2}" height="${Math.min(size, y1 - y) - 2}" rx="4" fill="rgb(${c.join(',')})"/>`;
    }
  }
  return out;
}

function planks(x0, y0, x1, y1) {
  let out = `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="#8a6a45"/>`;
  for (let y = y0; y < y1; y += 17.5) {
    out += `<line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}" stroke="#6e5232" stroke-width="2"/>`;
    for (let x = x0 + rand() * 140; x < x1; x += 140) {
      out += `<line x1="${x}" y1="${y}" x2="${x}" y2="${y + 17.5}" stroke="#6e5232" stroke-width="2"/>`;
    }
  }
  return out;
}

function crate(x, y) {
  return `<g transform="translate(${x},${y})"><rect width="56" height="56" fill="#a07a48" stroke="#5a3e1e" stroke-width="4"/>` +
    '<line x1="0" y1="0" x2="56" y2="56" stroke="#5a3e1e" stroke-width="4"/><line x1="56" y1="0" x2="0" y2="56" stroke="#5a3e1e" stroke-width="4"/></g>';
}

function mapSvg() {
  const wall = '#4a4640';
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
  // Grass outside the walls, the courtyard's flagstones, the storehouse's planks, the cellar's dark stone.
  s += `<rect width="${W}" height="${H}" fill="#5f7d43"/>`;
  s += flagstones(70, 70, 1120, 1190, [168, 160, 146]);
  s += planks(1120, 70, 1610, 595);
  s += flagstones(1120, 595, 1610, 1190, [92, 88, 84]);
  // The road out of the gate.
  s += `<rect x="0" y="490" width="70" height="210" fill="#9c8c6c"/>`;
  // Outer walls, the building's walls and the wall between storehouse and cellar, each a band along the wall lines.
  s += `<g fill="${wall}">`;
  s += '<rect x="56" y="56" width="1568" height="28"/>';
  s += '<rect x="56" y="1176" width="1568" height="28"/>';
  s += '<rect x="56" y="56" width="28" height="434"/><rect x="56" y="700" width="28" height="504"/>';
  s += '<rect x="1596" y="56" width="28" height="1148"/>';
  s += '<rect x="1106" y="56" width="28" height="224"/><rect x="1106" y="350" width="28" height="854"/>';
  s += '<rect x="1106" y="581" width="224" height="28"/><rect x="1400" y="581" width="224" height="28"/>';
  s += '</g>';
  // The gate, standing open; the storehouse door, open; the cellar door, closed.
  s += '<rect x="50" y="476" width="40" height="18" fill="#6b4a26"/><rect x="50" y="696" width="40" height="18" fill="#6b4a26"/>';
  s += '<rect x="84" y="490" width="16" height="70" fill="#7a5530" transform="rotate(-35 84 490)"/>';
  s += '<rect x="84" y="630" width="16" height="70" fill="#7a5530" transform="rotate(35 84 700)"/>';
  s += '<rect x="1134" y="280" width="62" height="10" fill="#7a5530" transform="rotate(20 1134 280)"/>';
  s += '<rect x="1330" y="586" width="70" height="18" fill="#7a5530" stroke="#3e2a14" stroke-width="3"/>';
  // A well in the courtyard, crates and barrels in the storehouse, stairs down in the cellar's corner.
  s += '<circle cx="560" cy="630" r="58" fill="#6e6a62"/><circle cx="560" cy="630" r="38" fill="#24303a"/>';
  s += crate(1500, 120) + crate(1440, 120) + crate(1500, 180) + crate(1180, 460);
  s += '<circle cx="1260" cy="140" r="26" fill="#7a5530" stroke="#3e2a14" stroke-width="4"/><circle cx="1320" cy="140" r="26" fill="#7a5530" stroke="#3e2a14" stroke-width="4"/>';
  for (let i = 0; i < 6; i++) {
    s += `<rect x="${1470 + i * 20}" y="1050" width="20" height="126" fill="rgb(${120 - i * 12},${116 - i * 12},${110 - i * 12})"/>`;
  }
  // A cart by the gate, and bushes along the courtyard wall.
  s += '<rect x="190" y="840" width="120" height="70" rx="6" fill="#8a6236" stroke="#4a3218" stroke-width="4"/>';
  s += '<circle cx="210" cy="918" r="16" fill="#3e2a14"/><circle cx="290" cy="918" r="16" fill="#3e2a14"/>';
  for (const [x, y] of [[140, 140], [900, 130], [960, 1110], [150, 1110], [620, 140]]) {
    s += `<circle cx="${x}" cy="${y}" r="30" fill="#3f6a2e"/><circle cx="${x + 18}" cy="${y - 8}" r="20" fill="#4f7d38"/>`;
  }
  s += '</svg>';
  return s;
}

function noticeSvg() {
  const w = 900;
  const h = 600;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<rect width="${w}" height="${h}" fill="#3b2f25"/>` +
    '<rect x="40" y="40" width="820" height="520" rx="12" fill="#efe2c4" stroke="#8a6a45" stroke-width="6"/>' +
    '<circle cx="450" cy="64" r="12" fill="#8a3a2a"/>' +
    '<g font-family="Georgia, \'Times New Roman\', serif" fill="#3b2f25" text-anchor="middle">' +
    '<text x="450" y="150" font-size="56" font-weight="bold">Practice Notice</text>' +
    '<text x="450" y="250" font-size="30">This picture is a handout.</text>' +
    '<text x="450" y="300" font-size="30">The GM shows it from the Gallery,</text>' +
    '<text x="450" y="350" font-size="30">to every player or to chosen ones.</text>' +
    '<text x="450" y="470" font-size="24" font-style="italic">Reset the practice campaign to start over.</text>' +
    '</g></svg>';
}

async function main() {
  await sharp(Buffer.from(mapSvg())).png({ compressionLevel: 9, palette: true, quality: 90 }).toFile(path.join(OUT, 'courtyard.png'));
  await sharp(Buffer.from(noticeSvg())).png({ compressionLevel: 9, palette: true, quality: 90 }).toFile(path.join(OUT, 'practice-notice.png'));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
