/**
 * A QR code encoder, small enough to keep in the repo.
 *
 * Why not a package: this runs inside `start.bat`, which a teammate double-clicks
 * on a laptop that may have no internet. Anything in `dependencies` is one failed
 * `npm install` away from the demo not starting, and the demo is the grade. So the
 * whole encoder lives here — no install step, nothing to go stale.
 *
 * Scope is deliberately narrow: **byte mode, error correction level M, versions
 * 1 to 10**. That tops out at 213 bytes, and the longest thing this app ever
 * encodes is `https://192.168.0.255:5173` — twenty-six. Anything longer throws
 * rather than silently producing a code no phone can read.
 *
 * Level M recovers from about 15% damage, which is what a phone camera needs when
 * it is reading the code off a glossy laptop screen at an angle.
 *
 * Follows ISO/IEC 18004. The structure is the one the reference implementations
 * all share; the tables below are the standard's, narrowed to the ten versions
 * this supports. `qr.test.mjs` decodes every code back out again, and checks the
 * error-correction blocks against independently computed syndromes, so a wrong
 * digit in any table here fails the test suite rather than the demo.
 */

// ---------------------------------------------------------------- tables ----

/**
 * Error correction, level M, by version: how many EC codewords per block, and
 * how many data codewords each block holds.
 *
 * Short blocks first — that is the order the interleaver expects, and getting it
 * backwards produces a code that scans as gibberish rather than failing outright.
 */
export const EC_TABLE = {
  1: { ec: 10, data: [16] },
  2: { ec: 16, data: [28] },
  3: { ec: 26, data: [44] },
  4: { ec: 18, data: [32, 32] },
  5: { ec: 24, data: [43, 43] },
  6: { ec: 16, data: [27, 27, 27, 27] },
  7: { ec: 18, data: [31, 31, 31, 31] },
  8: { ec: 22, data: [38, 38, 39, 39] },
  9: { ec: 22, data: [36, 36, 36, 37, 37] },
  10: { ec: 26, data: [43, 43, 43, 43, 44] },
};

/** Alias, so the tests can check the table above against the published totals. */
const BLOCKS = EC_TABLE;

/** Row/column centres of the alignment patterns, by version. */
const ALIGNMENT = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

export const MAX_VERSION = 10;

/** Level M, as the two bits that go into the format information. */
const ECC_BITS = 0b00;

// ------------------------------------------------------- GF(256) arithmetic --

// The field the Reed-Solomon codes live in: bytes, with the standard QR
// primitive polynomial x^8 + x^4 + x^3 + x^2 + 1.
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}

function mul(a, b) {
  return a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]];
}

/** The generator polynomial for `n` error correction codewords. */
function generator(n) {
  let poly = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j]; // shift up one degree
      next[j + 1] ^= mul(poly[j], EXP[i]); // ...and add the root
    }
    poly = next;
  }
  return poly;
}

/** The Reed-Solomon remainder: the `n` error correction codewords for `data`. */
export function errorCorrection(data, n) {
  const gen = generator(n);
  const work = new Uint8Array(data.length + n);
  work.set(data);
  for (let i = 0; i < data.length; i++) {
    const factor = work[i];
    if (factor === 0) continue;
    for (let j = 0; j < gen.length; j++) work[i + j] ^= mul(gen[j], factor);
  }
  return work.slice(data.length);
}

// ------------------------------------------------------------- encoding ----

/** How many bytes fit in a version, once the header is paid for. */
export function capacity(version) {
  const blocks = BLOCKS[version];
  const dataCodewords = blocks.data.reduce((a, b) => a + b, 0);
  const headerBits = 4 + countBits(version);
  return Math.floor((dataCodewords * 8 - headerBits) / 8);
}

/** Width of the character-count field: 8 bits up to version 9, then 16. */
function countBits(version) {
  return version < 10 ? 8 : 16;
}

function smallestVersion(byteLength) {
  for (let version = 1; version <= MAX_VERSION; version++) {
    if (byteLength <= capacity(version)) return version;
  }
  throw new RangeError(
    `${byteLength} bytes is too long for a version-${MAX_VERSION} QR code ` +
      `(limit ${capacity(MAX_VERSION)}). This encoder only covers what a local ` +
      `network URL needs.`,
  );
}

/** The data codewords: header, payload, terminator, then the standard padding. */
function codewords(bytes, version) {
  const dataCodewords = BLOCKS[version].data.reduce((a, b) => a + b, 0);
  const bits = [];
  const push = (value, width) => {
    for (let i = width - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };

  push(0b0100, 4); // byte mode
  push(bytes.length, countBits(version));
  for (const byte of bytes) push(byte, 8);

  // Terminator, then out to a byte boundary.
  const room = dataCodewords * 8 - bits.length;
  push(0, Math.min(4, room));
  while (bits.length % 8 !== 0) bits.push(0);

  const out = new Uint8Array(dataCodewords);
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    out[i / 8] = byte;
  }
  // Alternating pad bytes, which is what the standard specifies.
  for (let i = bits.length / 8, alt = 0; i < dataCodewords; i++, alt++) {
    out[i] = alt % 2 === 0 ? 0xec : 0x11;
  }
  return out;
}

/**
 * Split into blocks, add error correction, then interleave.
 *
 * The interleaving is the point: it spreads each block's bytes across the whole
 * symbol, so a thumb over one corner damages a little of every block rather than
 * destroying one of them completely.
 */
function interleave(data, version) {
  const { ec, data: sizes } = BLOCKS[version];
  const blocks = [];
  let offset = 0;
  for (const size of sizes) {
    const slice = data.slice(offset, offset + size);
    offset += size;
    blocks.push({ data: slice, ec: errorCorrection(slice, ec) });
  }

  const out = [];
  const longest = Math.max(...sizes);
  for (let i = 0; i < longest; i++) {
    for (const block of blocks) if (i < block.data.length) out.push(block.data[i]);
  }
  for (let i = 0; i < ec; i++) {
    for (const block of blocks) out.push(block.ec[i]);
  }
  return Uint8Array.from(out);
}

// --------------------------------------------------------------- matrix ----

function blank(size) {
  return Array.from({ length: size }, () => new Array(size).fill(false));
}

/** Bit `i` of `value`, counting from the least significant. */
function bit(value, i) {
  return ((value >>> i) & 1) !== 0;
}

class Symbol_ {
  constructor(version) {
    this.version = version;
    this.size = version * 4 + 17;
    this.modules = blank(this.size);
    /** Which cells are structure rather than payload — never masked, never written over. */
    this.reserved = blank(this.size);
  }

  set(row, col, dark) {
    this.modules[row][col] = dark;
    this.reserved[row][col] = true;
  }

  /** Finders, separators, timing, alignment, and the space the format bits need. */
  drawFunctionPatterns() {
    const last = this.size - 7;
    for (const [row, col] of [
      [0, 0],
      [0, last],
      [last, 0],
    ]) {
      this.drawFinder(row, col);
    }

    // Timing patterns: the alternating spine that tells a scanner the module size.
    for (let i = 0; i < this.size; i++) {
      if (!this.reserved[6][i]) this.set(6, i, i % 2 === 0);
      if (!this.reserved[i][6]) this.set(i, 6, i % 2 === 0);
    }

    const centres = ALIGNMENT[this.version];
    for (const row of centres) {
      for (const col of centres) {
        // The three corners already hold finders.
        const corner =
          (row === 6 && col === 6) ||
          (row === 6 && col === this.size - 7) ||
          (row === this.size - 7 && col === 6);
        if (!corner) this.drawAlignment(row, col);
      }
    }

    // Reserve the format and version areas before any data is placed.
    this.drawFormat(0);
    if (this.version >= 7) this.drawVersion();
  }

  drawFinder(row, col) {
    // One module of separator on every side, clipped at the symbol edge.
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = row + dr;
        const c = col + dc;
        if (r < 0 || r >= this.size || c < 0 || c >= this.size) continue;
        const ring = Math.max(Math.abs(dr - 3), Math.abs(dc - 3));
        this.set(r, c, ring !== 2 && ring <= 3);
      }
    }
  }

  drawAlignment(row, col) {
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        this.set(row + dr, col + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
      }
    }
  }

  /** The 15 format bits, written twice so losing a corner does not lose them. */
  drawFormat(mask) {
    const value = (ECC_BITS << 3) | mask;
    let rem = value;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = (((value << 10) | rem) ^ 0x5412) >>> 0;

    // Copy one: down the left of the top-right finder, and along the top of the
    // bottom-left one.
    for (let i = 0; i <= 5; i++) this.set(i, 8, bit(bits, i));
    this.set(7, 8, bit(bits, 6));
    this.set(8, 8, bit(bits, 7));
    this.set(8, 7, bit(bits, 8));
    for (let i = 9; i < 15; i++) this.set(8, 14 - i, bit(bits, i));

    // Copy two.
    for (let i = 0; i < 8; i++) this.set(8, this.size - 1 - i, bit(bits, i));
    for (let i = 8; i < 15; i++) this.set(this.size - 15 + i, 8, bit(bits, i));

    // The one module that is always dark, in every QR code ever printed.
    this.set(this.size - 8, 8, true);
  }

  /** Version information — only carried from version 7 up. */
  drawVersion() {
    let rem = this.version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = ((this.version << 12) | rem) >>> 0;
    for (let i = 0; i < 18; i++) {
      const a = Math.floor(i / 3);
      const b = this.size - 11 + (i % 3);
      this.set(b, a, bit(bits, i));
      this.set(a, b, bit(bits, i));
    }
  }

  /**
   * Lay the codewords into the symbol.
   *
   * Two modules wide, snaking bottom-to-top then top-to-bottom, skipping column
   * six because the vertical timing pattern lives there.
   */
  drawCodewords(data) {
    let i = 0;
    for (let right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < this.size; vert++) {
        for (let j = 0; j < 2; j++) {
          const col = right - j;
          const upward = ((right + 1) & 2) === 0;
          const row = upward ? this.size - 1 - vert : vert;
          if (this.reserved[row][col]) continue;
          // Runs out before the last few modules on some versions. Those
          // remainder bits stay light, then get masked like any other cell.
          if (i < data.length * 8) {
            this.modules[row][col] = bit(data[i >>> 3], 7 - (i & 7));
            i++;
          }
        }
      }
    }
  }

  applyMask(mask) {
    for (let row = 0; row < this.size; row++) {
      for (let col = 0; col < this.size; col++) {
        if (this.reserved[row][col]) continue;
        if (maskAt(mask, row, col)) this.modules[row][col] = !this.modules[row][col];
      }
    }
  }

  /**
   * How badly this mask reads, by the standard's four rules.
   *
   * All four exist to stop the data accidentally looking like structure: long
   * runs, solid blocks, anything resembling a finder, and an overall balance too
   * far from half dark.
   */
  penalty() {
    const n = this.size;
    let score = 0;

    const runScore = (line) => {
      let total = 0;
      let run = 1;
      for (let i = 1; i <= line.length; i++) {
        if (i < line.length && line[i] === line[i - 1]) {
          run++;
          continue;
        }
        if (run >= 5) total += 3 + (run - 5);
        run = 1;
      }
      return total;
    };

    // Rule 3: a finder-shaped run, which a scanner may mistake for a corner.
    const FINDERISH = [true, false, true, true, true, false, true];
    const hasFinderAt = (line, start) => {
      for (let i = 0; i < 7; i++) if (line[start + i] !== FINDERISH[i]) return false;
      const before = line.slice(Math.max(0, start - 4), start);
      const after = line.slice(start + 7, start + 11);
      const clear = (part) => part.length === 4 && part.every((v) => v === false);
      return clear(before) || clear(after);
    };

    for (let i = 0; i < n; i++) {
      const row = this.modules[i];
      const col = this.modules.map((r) => r[i]);
      score += runScore(row) + runScore(col);
      for (let j = 0; j + 7 <= n; j++) {
        if (hasFinderAt(row, j)) score += 40;
        if (hasFinderAt(col, j)) score += 40;
      }
    }

    // Rule 2: any solid 2x2.
    for (let row = 0; row + 1 < n; row++) {
      for (let col = 0; col + 1 < n; col++) {
        const v = this.modules[row][col];
        if (
          v === this.modules[row][col + 1] &&
          v === this.modules[row + 1][col] &&
          v === this.modules[row + 1][col + 1]
        ) {
          score += 3;
        }
      }
    }

    // Rule 4: 10 points for every 5% the dark share is away from half.
    let dark = 0;
    for (const row of this.modules) for (const v of row) if (v) dark++;
    const percent = (dark * 100) / (n * n);
    score += Math.floor(Math.abs(percent - 50) / 5) * 10;

    return score;
  }
}

function maskAt(mask, row, col) {
  switch (mask) {
    case 0:
      return (row + col) % 2 === 0;
    case 1:
      return row % 2 === 0;
    case 2:
      return col % 3 === 0;
    case 3:
      return (row + col) % 3 === 0;
    case 4:
      return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5:
      return ((row * col) % 2) + ((row * col) % 3) === 0;
    case 6:
      return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
    default:
      return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0;
  }
}

/**
 * Encode `text` as a QR code.
 *
 * Returns the finished module grid: `modules[row][col]`, true where dark. No
 * quiet zone — the renderers add that, because how much white space you need
 * depends on whether you are drawing to a terminal or to an SVG.
 */
export function encode(text) {
  const bytes = new TextEncoder().encode(text);
  const version = smallestVersion(bytes.length);
  const data = interleave(codewords(bytes, version), version);

  // Every mask is a whole encode; the standard's scoring picks the one a camera
  // will have the easiest time with. Eight passes over a 25x25 grid is nothing.
  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const symbol = new Symbol_(version);
    symbol.drawFunctionPatterns();
    symbol.drawCodewords(data);
    symbol.drawFormat(mask);
    symbol.applyMask(mask);
    const score = symbol.penalty();
    if (best === null || score < best.score) best = { score, symbol, mask };
  }

  return {
    size: best.symbol.size,
    version,
    mask: best.mask,
    modules: best.symbol.modules,
  };
}

// ------------------------------------------------------------ rendering ----

/** The standard's quiet zone: four modules of white on every side. */
export const QUIET = 4;

function eachRow(qr, quiet, draw) {
  const lines = [];
  for (let row = -quiet; row < qr.size + quiet; row++) {
    lines.push(draw(row));
  }
  return lines;
}

function isDark(qr, row, col) {
  if (row < 0 || col < 0 || row >= qr.size || col >= qr.size) return false;
  return qr.modules[row][col];
}

/**
 * Draw to a terminal using background colours.
 *
 * Explicit black and white rather than block characters, for two reasons. Block
 * characters are non-ASCII, and `cmd.exe` on a Thai-language Windows runs in a
 * code page that mangles them. And drawing with the *foreground* colour means a
 * dark terminal theme produces a photographic negative of the code, which plenty
 * of scanners refuse. Painting both colours explicitly sidesteps both.
 *
 * Two spaces per module, because a terminal cell is about twice as tall as it is
 * wide and a squashed QR code is a QR code that will not scan.
 */
export function toTerminal(qr, quiet = QUIET) {
  const DARK = "\x1b[40m";
  const LIGHT = "\x1b[107m";
  const RESET = "\x1b[0m";
  return eachRow(qr, quiet, (row) => {
    let out = "";
    let current = null;
    for (let col = -quiet; col < qr.size + quiet; col++) {
      const code = isDark(qr, row, col) ? DARK : LIGHT;
      if (code !== current) {
        out += code;
        current = code;
      }
      out += "  ";
    }
    return out + RESET;
  }).join("\n");
}

/**
 * Draw with block characters instead of colour.
 *
 * For terminals that do not do ANSI colour, and for piping to a file. Inverts on
 * a dark background, so `toTerminal` is the better default wherever colour works.
 */
export function toBlocks(qr, quiet = QUIET) {
  return eachRow(qr, quiet, (row) => {
    let out = "";
    for (let col = -quiet; col < qr.size + quiet; col++) {
      out += isDark(qr, row, col) ? "██" : "  ";
    }
    return out;
  }).join("\n");
}

/** How many terminal columns `toTerminal` needs. */
export function terminalWidth(qr, quiet = QUIET) {
  return (qr.size + quiet * 2) * 2;
}

/**
 * Draw as an SVG.
 *
 * One path for every dark module, on a white rectangle. White is not optional:
 * this page is dark like the rest of the app, but a QR code needs its own light
 * background or the camera has nothing to threshold against.
 */
export function toSvg(qr, { quiet = QUIET, size = 320 } = {}) {
  const span = qr.size + quiet * 2;
  const parts = [];
  for (let row = 0; row < qr.size; row++) {
    for (let col = 0; col < qr.size; col++) {
      if (qr.modules[row][col]) parts.push(`M${col + quiet} ${row + quiet}h1v1h-1z`);
    }
  }
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${span} ${span}"`,
    ` width="${size}" height="${size}" shape-rendering="crispEdges"`,
    ` role="img" aria-label="QR code">`,
    `<rect width="${span}" height="${span}" fill="#ffffff"/>`,
    `<path fill="#000000" d="${parts.join("")}"/>`,
    `</svg>`,
  ].join("");
}
