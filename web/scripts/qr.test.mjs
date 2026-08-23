/**
 * Tests for the QR encoder.
 *
 * A QR code is either right or it is a grey square, and "it looked fine to me"
 * is not a test. So this file **decodes** every code the encoder produces, using
 * a reader written here from the specification rather than by calling back into
 * the encoder. If the two disagree about where a bit goes, the test fails.
 *
 * On top of the round trip:
 *
 * - the error correction blocks are checked against Reed-Solomon syndromes
 *   computed with a separate copy of the field arithmetic, which is a proof
 *   rather than a comparison;
 * - the block table is checked against the published total codeword counts,
 *   which is the one number in the standard that is hard to get wrong twice;
 * - the function patterns are laid out a second time, independently, and the
 *   count of leftover data modules has to match what the tables claim.
 */
import { describe, expect, it } from "vitest";

import {
  EC_TABLE,
  MAX_VERSION,
  QUIET,
  capacity,
  encode,
  errorCorrection,
  terminalWidth,
  toBlocks,
  toSvg,
  toTerminal,
} from "./qr.mjs";

/** Total codewords per version, from the standard. Independent of EC_TABLE. */
const TOTAL_CODEWORDS = {
  1: 26,
  2: 44,
  3: 70,
  4: 100,
  5: 134,
  6: 172,
  7: 196,
  8: 242,
  9: 292,
  10: 346,
};

/** Published byte-mode capacity at error correction level M. */
const PUBLISHED_CAPACITY = {
  1: 14,
  2: 26,
  3: 42,
  4: 62,
  5: 84,
  6: 106,
  7: 122,
  8: 152,
  9: 180,
  10: 213,
};

/** Unused modules left over after the codewords, per version. */
const REMAINDER_BITS = { 1: 0, 2: 7, 3: 7, 4: 7, 5: 7, 6: 7, 7: 0, 8: 0, 9: 0, 10: 0 };

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

// ------------------------------------------------------- a separate reader --

/** Field arithmetic, built from scratch so the syndrome check owes nothing to the encoder. */
function field() {
  const exp = [];
  const log = new Array(256).fill(0);
  let x = 1;
  for (let i = 0; i < 255; i++) {
    exp.push(x);
    log[x] = i;
    x = x << 1;
    if (x > 255) x ^= 0x11d;
  }
  const times = (a, b) => (a === 0 || b === 0 ? 0 : exp[(log[a] + log[b]) % 255]);
  return { exp, times };
}

/**
 * Is this codeword a valid Reed-Solomon word?
 *
 * Evaluate the polynomial at each root of the generator. A correctly encoded
 * block is divisible by that generator, so every one of those evaluations must
 * come out zero. Nothing here looks at how the encoder produced the bytes.
 */
function syndromesAreZero(codeword, ecCount) {
  const { exp, times } = field();
  for (let i = 0; i < ecCount; i++) {
    let acc = 0;
    for (const byte of codeword) acc = times(acc, exp[i]) ^ byte;
    if (acc !== 0) return false;
  }
  return true;
}

/** Where the structure sits, laid out from the specification a second time. */
function functionModules(version) {
  const size = version * 4 + 17;
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const fill = (top, left, height, width) => {
    for (let r = top; r < top + height; r++) {
      for (let c = left; c < left + width; c++) {
        if (r >= 0 && r < size && c >= 0 && c < size) fn[r][c] = true;
      }
    }
  };

  // Finders plus their separators.
  fill(0, 0, 8, 8);
  fill(0, size - 8, 8, 8);
  fill(size - 8, 0, 8, 8);
  // Timing.
  fill(6, 0, 1, size);
  fill(0, 6, size, 1);
  // Format information, both copies, and the always-dark module.
  fill(8, 0, 1, 9);
  fill(0, 8, 9, 1);
  fill(8, size - 8, 1, 8);
  fill(size - 8, 8, 8, 1);
  // Alignment, except where a finder already is.
  const centres = ALIGNMENT[version];
  for (const r of centres) {
    for (const c of centres) {
      const corner = (r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6);
      if (!corner) fill(r - 2, c - 2, 5, 5);
    }
  }
  // Version information.
  if (version >= 7) {
    fill(size - 11, 0, 3, 6);
    fill(0, size - 11, 6, 3);
  }
  return fn;
}

function maskAt(mask, row, col) {
  const masks = [
    () => (row + col) % 2 === 0,
    () => row % 2 === 0,
    () => col % 3 === 0,
    () => (row + col) % 3 === 0,
    () => (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0,
    () => ((row * col) % 2) + ((row * col) % 3) === 0,
    () => (((row * col) % 2) + ((row * col) % 3)) % 2 === 0,
    () => (((row + col) % 2) + ((row * col) % 3)) % 2 === 0,
  ];
  return masks[mask]();
}

/** Read the 15 format bits back out of one of the two copies. */
function readFormat(qr, copy) {
  const size = qr.size;
  const at = (r, c) => (qr.modules[r][c] ? 1 : 0);
  let bits = 0;
  const put = (i, value) => {
    bits |= value << i;
  };
  if (copy === 1) {
    for (let i = 0; i <= 5; i++) put(i, at(i, 8));
    put(6, at(7, 8));
    put(7, at(8, 8));
    put(8, at(8, 7));
    for (let i = 9; i < 15; i++) put(i, at(8, 14 - i));
  } else {
    for (let i = 0; i < 8; i++) put(i, at(8, size - 1 - i));
    for (let i = 8; i < 15; i++) put(i, at(size - 15 + i, 8));
  }
  return bits;
}

/** Remainder of the 15-bit format word divided by the BCH generator. Zero if intact. */
function formatRemainder(bits) {
  let rem = bits;
  for (let i = 14; i >= 10; i--) {
    if ((rem >>> i) & 1) rem ^= 0x537 << (i - 10);
  }
  return rem & 0x3ff;
}

/** The 15-bit format word, by long division rather than the encoder's shift loop. */
function formatWord(ecc, mask) {
  const data = (ecc << 3) | mask;
  let rem = data << 10;
  for (let i = 14; i >= 10; i--) {
    if ((rem >>> i) & 1) rem ^= 0x537 << (i - 10);
  }
  return (((data << 10) | rem) ^ 0x5412) >>> 0;
}

/**
 * Turn a finished symbol back into the string it carries.
 *
 * The full read: format information, unmask, walk the placement path, undo the
 * interleaving, then parse the byte-mode header.
 */
function decode(qr) {
  const size = qr.size;
  const version = (size - 17) / 4;
  const fn = functionModules(version);

  const raw = readFormat(qr, 1);
  expect(readFormat(qr, 2)).toBe(raw);
  const format = raw ^ 0x5412;
  expect(formatRemainder(format)).toBe(0);
  const value = format >>> 10;
  const ecLevel = value >> 3;
  const mask = value & 7;
  expect(ecLevel).toBe(0b00); // level M

  const modules = qr.modules.map((row, r) =>
    row.map((dark, c) => (fn[r][c] || !maskAt(mask, r, c) ? dark : !dark)),
  );

  // The placement path: two columns at a time, snaking, skipping the timing column.
  const bits = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const col = right - j;
        const upward = ((right + 1) & 2) === 0;
        const row = upward ? size - 1 - vert : vert;
        if (!fn[row][col]) bits.push(modules[row][col] ? 1 : 0);
      }
    }
  }

  const total = TOTAL_CODEWORDS[version];
  expect(bits.length).toBe(total * 8 + REMAINDER_BITS[version]);

  const stream = [];
  for (let i = 0; i + 8 <= total * 8; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    stream.push(byte);
  }

  // Undo the interleaving.
  const { ec, data: sizes } = EC_TABLE[version];
  const blocks = sizes.map(() => ({ data: [], ec: [] }));
  let cursor = 0;
  const longest = Math.max(...sizes);
  for (let i = 0; i < longest; i++) {
    for (let b = 0; b < sizes.length; b++) {
      if (i < sizes[b]) blocks[b].data.push(stream[cursor++]);
    }
  }
  for (let i = 0; i < ec; i++) {
    for (let b = 0; b < sizes.length; b++) blocks[b].ec.push(stream[cursor++]);
  }
  expect(cursor).toBe(total);

  for (const block of blocks) {
    expect(syndromesAreZero([...block.data, ...block.ec], ec)).toBe(true);
  }

  const data = blocks.flatMap((b) => b.data);
  const read = (offset, width) => {
    let out = 0;
    for (let i = 0; i < width; i++) {
      const at = offset + i;
      out = (out << 1) | ((data[at >> 3] >> (7 - (at & 7))) & 1);
    }
    return out;
  };
  expect(read(0, 4)).toBe(0b0100); // byte mode
  const countWidth = version < 10 ? 8 : 16;
  const length = read(4, countWidth);
  const bytes = [];
  for (let i = 0; i < length; i++) bytes.push(read(4 + countWidth + i * 8, 8));
  return { text: new TextDecoder().decode(Uint8Array.from(bytes)), version, mask, blocks };
}

// ------------------------------------------------------------------ tests --

describe("the tables", () => {
  it("splits every version into blocks that add up to the published total", () => {
    for (let version = 1; version <= MAX_VERSION; version++) {
      const { ec, data } = EC_TABLE[version];
      const sum = data.reduce((a, b) => a + b, 0) + ec * data.length;
      expect(sum, `version ${version}`).toBe(TOTAL_CODEWORDS[version]);
    }
  });

  it("matches the published byte capacity at level M", () => {
    for (let version = 1; version <= MAX_VERSION; version++) {
      expect(capacity(version), `version ${version}`).toBe(PUBLISHED_CAPACITY[version]);
    }
  });

  it("leaves exactly the codewords the tables claim, once the structure is placed", () => {
    for (let version = 1; version <= MAX_VERSION; version++) {
      const size = version * 4 + 17;
      const fn = functionModules(version);
      let free = 0;
      for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (!fn[r][c]) free++;
      expect(free, `version ${version}`).toBe(
        TOTAL_CODEWORDS[version] * 8 + REMAINDER_BITS[version],
      );
    }
  });
});

describe("error correction", () => {
  it("produces codewords the syndrome check accepts", () => {
    const data = Uint8Array.from({ length: 16 }, (_, i) => (i * 37 + 11) & 0xff);
    const ec = errorCorrection(data, 10);
    expect(ec).toHaveLength(10);
    expect(syndromesAreZero([...data, ...ec], 10)).toBe(true);
  });

  it("changes when the data changes", () => {
    const a = errorCorrection(Uint8Array.from([1, 2, 3]), 7);
    const b = errorCorrection(Uint8Array.from([1, 2, 4]), 7);
    expect([...a]).not.toEqual([...b]);
  });
});

describe("encoding", () => {
  it("builds the data codewords the standard describes", () => {
    // "hi" is short enough to work out by hand: mode 0100, length 00000010,
    // then the two bytes, a four-bit terminator, and the alternating padding.
    const { blocks } = decode(encode("hi"));
    expect(blocks).toHaveLength(1);
    expect(blocks[0].data).toEqual([
      0x40, 0x26, 0x86, 0x90, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11,
      0xec, 0x11,
    ]);
  });

  it("reads back what it encoded", () => {
    for (const text of [
      "a",
      "https://192.168.0.48:5173",
      "https://192.168.100.200:5173/",
      "HTTPS://LAPTOP-GNOKCSFR.LOCAL:5173",
      "x".repeat(14),
      "x".repeat(15),
      "x".repeat(62),
      "x".repeat(213),
      "คืนสู่สนาม", // the old name: multi-byte, so the length field counts bytes not characters
    ]) {
      expect(decode(encode(text)).text, text).toBe(text);
    }
  });

  it("picks the smallest version that fits", () => {
    expect(encode("x".repeat(14)).version).toBe(1);
    expect(encode("x".repeat(15)).version).toBe(2);
    expect(encode("x".repeat(26)).version).toBe(2);
    expect(encode("x".repeat(27)).version).toBe(3);
    expect(encode("x".repeat(213)).version).toBe(10);
  });

  it("sizes the symbol from the version", () => {
    for (let version = 1; version <= MAX_VERSION; version++) {
      const qr = encode("x".repeat(PUBLISHED_CAPACITY[version]));
      expect(qr.version).toBe(version);
      expect(qr.size).toBe(version * 4 + 17);
      expect(qr.modules).toHaveLength(qr.size);
      expect(qr.modules[0]).toHaveLength(qr.size);
    }
  });

  it("refuses what it cannot encode rather than making an unreadable code", () => {
    expect(() => encode("x".repeat(214))).toThrow(/too long/);
  });
});

describe("the structure a scanner looks for", () => {
  const qr = encode("https://192.168.0.48:5173");

  it("puts a finder in three corners and not the fourth", () => {
    const centre = (row, col) => {
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) if (!qr.modules[row + dr][col + dc]) return false;
      }
      // The ring around the 3x3 centre has to be light.
      for (let d = -2; d <= 2; d++) {
        if (qr.modules[row - 2][col + d] || qr.modules[row + 2][col + d]) return false;
      }
      return true;
    };
    expect(centre(3, 3)).toBe(true);
    expect(centre(3, qr.size - 4)).toBe(true);
    expect(centre(qr.size - 4, 3)).toBe(true);
    // Three, never four. The fourth corner is what tells a scanner which way up
    // the code is, so a finder there would make it unreadable.
    expect(centre(qr.size - 4, qr.size - 4)).toBe(false);
  });

  it("puts an alignment pattern near the fourth corner instead", () => {
    const centres = ALIGNMENT[qr.version];
    const at = centres.at(-1);
    expect(qr.modules[at][at]).toBe(true); // dark centre...
    expect(qr.modules[at - 1][at]).toBe(false); // ...light ring...
    expect(qr.modules[at - 2][at]).toBe(true); // ...dark edge
  });

  it("alternates along both timing patterns", () => {
    for (let i = 8; i < qr.size - 8; i++) {
      expect(qr.modules[6][i], `row 6 col ${i}`).toBe(i % 2 === 0);
      expect(qr.modules[i][6], `row ${i} col 6`).toBe(i % 2 === 0);
    }
  });

  it("keeps the module that is dark in every QR code", () => {
    expect(qr.modules[4 * qr.version + 9][8]).toBe(true);
  });

  it("writes the format word the standard publishes", () => {
    // Level M with mask 0 is the entry every reference quotes, and it is what
    // pins down that level M is the two bits 00 rather than one of the others.
    // Get that wrong and a scanner reads the code with the wrong block layout.
    expect(formatWord(0b00, 0)).toBe(0b101010000010010);
    expect(readFormat(qr, 1)).toBe(formatWord(0b00, qr.mask));
  });

  it("chooses a mask", () => {
    expect(qr.mask).toBeGreaterThanOrEqual(0);
    expect(qr.mask).toBeLessThan(8);
  });
});

describe("rendering", () => {
  const qr = encode("https://192.168.0.48:5173");

  it("surrounds the terminal code with a quiet zone", () => {
    const lines = toTerminal(qr).split("\n");
    expect(lines).toHaveLength(qr.size + QUIET * 2);
    // The first rows are quiet zone: one colour, nothing but spaces.
    const first = lines[0];
    expect(first).not.toContain("\x1b[40m");
    expect(first.replace(/\x1b\[[0-9;]*m/g, "").trim()).toBe("");
    expect(lines.at(-1).replace(/\x1b\[[0-9;]*m/g, "").trim()).toBe("");
  });

  it("reports how wide it will print", () => {
    const width = terminalWidth(qr);
    expect(width).toBe((qr.size + QUIET * 2) * 2);
    // A version 2 code has to fit an 80 column terminal, or nobody can scan it.
    expect(width).toBeLessThanOrEqual(80);
  });

  it("draws blocks without any escape codes, for terminals that cannot colour", () => {
    const text = toBlocks(qr);
    expect(text).not.toContain("\x1b");
    expect(text.split("\n")).toHaveLength(qr.size + QUIET * 2);
  });

  it("draws an svg with one path square per dark module", () => {
    const svg = toSvg(qr, { size: 300 });
    const dark = qr.modules.flat().filter(Boolean).length;
    expect(svg.match(/M\d+ \d+h1v1h-1z/g)).toHaveLength(dark);
    expect(svg).toContain(`viewBox="0 0 ${qr.size + QUIET * 2} ${qr.size + QUIET * 2}"`);
    // White behind it, whatever the page around it is doing.
    expect(svg).toContain('fill="#ffffff"');
  });
});
