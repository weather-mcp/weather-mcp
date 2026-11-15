/**
 * Contracts for the tile header check and the anchored radar tile address in
 * src/utils/composite.ts. Offline and deterministic: every buffer is built here.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  PNG,
  assembleTiles,
  assertTileHeader,
  encodePng,
  parseRadarTileUrl,
  buildRadarTileUrl,
  RADAR_TILE_MAX_BYTES,
  BASEMAP_TILE_MAX_BYTES,
} from '../../src/utils/composite.js';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const EXACT_MESSAGE = /^Tile is not a 256px non-interlaced PNG$/;

/** A 33-byte header-only buffer: signature plus a complete IHDR chunk. No image data. */
function headerOnly(width: number, height: number, interlace = 0): Buffer {
  const buf = Buffer.alloc(33);
  SIGNATURE.copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'latin1');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  buf[24] = 8;
  buf[25] = 6;
  buf[28] = interlace;
  return buf;
}

function solidPng(width: number, height: number, rgba: [number, number, number, number]): Buffer {
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = rgba[0];
    png.data[i + 1] = rgba[1];
    png.data[i + 2] = rgba[2];
    png.data[i + 3] = rgba[3];
  }
  return PNG.sync.write(png);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('assembleTiles: header refused before decode', () => {
  const interlaced = solidPng(256, 256, [1, 2, 3, 255]);
  interlaced[28] = 1;
  const badSignature = solidPng(256, 256, [1, 2, 3, 255]);
  badSignature[0] = 0x88;

  const cases: Array<[string, Buffer]> = [
    ['33-byte buffer declaring 100000 x 100000', headerOnly(100000, 100000)],
    ['well-formed 128 x 128 PNG', solidPng(128, 128, [1, 2, 3, 255])],
    ['well-formed 256 x 512 PNG (height only wrong)', solidPng(256, 512, [1, 2, 3, 255])],
    ['bad signature', badSignature],
    ['20-byte truncated header', headerOnly(256, 256).subarray(0, 20)],
    ['empty buffer', Buffer.alloc(0)],
    ['256 x 256 PNG with the interlace byte set to 1', interlaced],
  ];

  for (const [name, buf] of cases) {
    it(`refuses ${name} with the fixed message and no decode`, () => {
      const read = vi.spyOn(PNG.sync, 'read');
      expect(() => assembleTiles([buf], 1, 1, 256)).toThrow(EXACT_MESSAGE);
      expect(read).toHaveBeenCalledTimes(0);
    });
  }

  it('does not echo the declared dimensions or any input byte in the message', () => {
    let message = '';
    try {
      assembleTiles([headerOnly(100000, 100000)], 1, 1, 256);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toBe('Tile is not a 256px non-interlaced PNG');
    expect(message).not.toContain('100000');
    let interlacedMessage = '';
    try {
      assembleTiles([interlaced], 1, 1, 256);
    } catch (e) {
      interlacedMessage = (e as Error).message;
    }
    expect(interlacedMessage).toBe('Tile is not a 256px non-interlaced PNG');
  });
});

describe('assembleTiles: mixed grid', () => {
  it('checks every header before decoding any tile', () => {
    const good = solidPng(256, 256, [10, 20, 30, 255]);
    const read = vi.spyOn(PNG.sync, 'read');
    expect(() =>
      assembleTiles([good, good, good, headerOnly(100000, 100000)], 2, 2, 256)
    ).toThrow(EXACT_MESSAGE);
    expect(read).toHaveBeenCalledTimes(0);
  });
});

describe('assembleTiles: unchanged success', () => {
  it('assembles a 2 x 2 grid of 256 px tiles pixel-exact', () => {
    const colors: Array<[number, number, number, number]> = [
      [255, 0, 0, 255],
      [0, 255, 0, 128],
      [0, 0, 255, 64],
      [9, 8, 7, 0],
    ];
    const out = assembleTiles(colors.map((c) => solidPng(256, 256, c)), 2, 2, 256);
    expect(out.width).toBe(512);
    expect(out.height).toBe(512);
    const at = (x: number, y: number) => Array.from(out.data.subarray((y * 512 + x) * 4, (y * 512 + x) * 4 + 4));
    expect(at(0, 0)).toEqual(colors[0]);
    expect(at(255, 255)).toEqual(colors[0]);
    expect(at(256, 0)).toEqual(colors[1]);
    expect(at(0, 256)).toEqual(colors[2]);
    expect(at(511, 511)).toEqual(colors[3]);
  });

  it('assembles a 1 x 1 grid of a 512 px tile pixel-exact', () => {
    const out = assembleTiles([solidPng(512, 512, [11, 22, 33, 200])], 1, 1, 512);
    expect(out.width).toBe(512);
    expect(out.height).toBe(512);
    expect(Array.from(out.data.subarray(0, 4))).toEqual([11, 22, 33, 200]);
    expect(Array.from(out.data.subarray(out.data.length - 4))).toEqual([11, 22, 33, 200]);
  });

  it('assertTileHeader accepts an encoded blank 256 px tile', () => {
    const blank = encodePng(new PNG({ width: 256, height: 256 }));
    expect(() => assertTileHeader(blank, 256)).not.toThrow();
  });
});

describe('radar tile address is anchored to the tail', () => {
  const url = 'https://tilecache.rainviewer.com/v2/radar/512/99/0/0/512/6/17/27/2/1_1.png';

  it('parses the tail address, not the one inside the path', () => {
    expect(parseRadarTileUrl(url)).toEqual({ z: 6, x: 17, y: 27 });
  });

  it('rewrites only the tail and leaves the path intact', () => {
    expect(buildRadarTileUrl(url, 6, 18, 28)).toBe(
      'https://tilecache.rainviewer.com/v2/radar/512/99/0/0/512/6/18/28/2/1_1.png'
    );
  });

  it('returns null when /512/z/x/y/ is only inside the path with no tail', () => {
    const noTail = 'https://tilecache.rainviewer.com/v2/radar/512/6/17/27/abc.png';
    expect(parseRadarTileUrl(noTail)).toBeNull();
    expect(buildRadarTileUrl(noTail, 1, 2, 3)).toBe(noTail);
  });
});

describe('tile size constants', () => {
  it('are exported numbers with radar above basemap', () => {
    expect(typeof RADAR_TILE_MAX_BYTES).toBe('number');
    expect(typeof BASEMAP_TILE_MAX_BYTES).toBe('number');
    expect(RADAR_TILE_MAX_BYTES).toBeGreaterThan(BASEMAP_TILE_MAX_BYTES);
  });
});

// ---------------------------------------------------------------------------
// One IHDR per tile, and the decoded size as the second layer.
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** length | type | data | crc */
function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function ihdrChunk(width: number, height: number, interlace = 0): Buffer {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data[8] = 8;
  data[9] = 6;
  data[12] = interlace;
  return chunk('IHDR', data);
}

/** Splice `extra` into `png` at `offset`. */
function splice(png: Buffer, offset: number, extra: Buffer): Buffer {
  return Buffer.concat([png.subarray(0, offset), extra, png.subarray(offset)]);
}

const RED: [number, number, number, number] = [200, 30, 60, 255];

function expectSolid(out: { width: number; height: number; data: Buffer }, rgba: number[]): void {
  expect(out.width).toBe(256);
  expect(out.height).toBe(256);
  for (let i = 0; i < out.data.length; i += 4) {
    if (
      out.data[i] !== rgba[0] ||
      out.data[i + 1] !== rgba[1] ||
      out.data[i + 2] !== rgba[2] ||
      out.data[i + 3] !== rgba[3]
    ) {
      throw new Error(`pixel ${i / 4} differs`);
    }
  }
}

describe('assertTileHeader: a second IHDR is refused with no decode', () => {
  const base = solidPng(256, 256, RED);
  // Precondition: the writer's layout is IHDR (ends at 33), IDAT..., IEND (last 12 bytes).
  expect(base.subarray(base.length - 8, base.length - 4).toString('latin1')).toBe('IEND');
  expect(base.subarray(12, 16).toString('latin1')).toBe('IHDR');

  const cases: Array<[string, Buffer]> = [
    ['larger (4096 x 4096)', splice(base, 33, ihdrChunk(4096, 4096))],
    ['smaller (16 x 16)', splice(base, 33, ihdrChunk(16, 16))],
    ['same size (256 x 256)', splice(base, 33, ihdrChunk(256, 256))],
    ['interlaced (256 x 256, interlace 1)', splice(base, 33, ihdrChunk(256, 256, 1))],
    ['after IDAT, just before IEND (4096 x 4096)', splice(base, base.length - 12, ihdrChunk(4096, 4096))],
  ];

  for (const [name, buf] of cases) {
    it(`refuses a second IHDR that is ${name}`, () => {
      expect(buf.indexOf('IHDR', 33)).not.toBe(-1);
      const read = vi.spyOn(PNG.sync, 'read');
      expect(() => assembleTiles([buf], 1, 1, 256)).toThrow(EXACT_MESSAGE);
      expect(read).toHaveBeenCalledTimes(0);
      expect(() => assertTileHeader(buf, 256)).toThrow(EXACT_MESSAGE);
    });

    it(`does not echo 4096 or 16 when refusing a second IHDR that is ${name}`, () => {
      let message = '';
      try {
        assertTileHeader(buf, 256);
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).toBe('Tile is not a 256px non-interlaced PNG');
      expect(message).not.toContain('4096');
      expect(message).not.toContain('16');
    });
  }
});

describe('assertTileHeader: genuine tiles are accepted and assemble pixel-exact', () => {
  const base = solidPng(256, 256, RED);

  it('accepts a tEXt chunk between IHDR and IDAT', () => {
    const buf = splice(base, 33, chunk('tEXt', Buffer.from('Comment\0hello', 'latin1')));
    expect(buf.length).toBeGreaterThan(base.length);
    expect(() => assertTileHeader(buf, 256)).not.toThrow();
    expectSolid(assembleTiles([buf], 1, 1, 256), RED);
  });

  it('accepts a 40,000-byte ancillary pAdd chunk between IHDR and IDAT', () => {
    const buf = splice(base, 33, chunk('pAdd', Buffer.alloc(40000, 0x41)));
    expect(buf.length).toBeGreaterThanOrEqual(base.length + 40000);
    expect(() => assertTileHeader(buf, 256)).not.toThrow();
    expectSolid(assembleTiles([buf], 1, 1, 256), RED);
  });

  it('accepts a tile whose IDAT data contains the bytes IHDR', () => {
    const png = new PNG({ width: 256, height: 256 });
    for (let i = 0; i < png.data.length; i += 4) {
      png.data[i] = 0x49; // I
      png.data[i + 1] = 0x48; // H
      png.data[i + 2] = 0x44; // D
      png.data[i + 3] = 0x52; // R
    }
    const buf = PNG.sync.write(png, { deflateLevel: 0, filterType: 0 });
    expect(buf.indexOf('IHDR', 33)).not.toBe(-1);
    expect(() => assertTileHeader(buf, 256)).not.toThrow();
    expectSolid(assembleTiles([buf], 1, 1, 256), [0x49, 0x48, 0x44, 0x52]);
  });

  it('does not read past IEND: bytes after it that spell a full IHDR chunk leave the walk quiet', () => {
    const buf = Buffer.concat([base, ihdrChunk(4096, 4096)]);
    expect(buf.indexOf('IHDR', 33)).not.toBe(-1);
    expect(() => assertTileHeader(buf, 256)).not.toThrow();
    // pngjs itself refuses trailing bytes after IEND, so this tile never assembles; the point is
    // that the refusal is pngjs's own, not the fixed tile message, and nothing is decoded at 4096.
    let message = '';
    try {
      assembleTiles([buf], 1, 1, 256);
    } catch (e) {
      message = (e as Error).message;
    }
    // pngjs's own wording is not pinned: an upgrade may reword it. Any refusal but ours is the contract.
    expect(message).not.toBe('');
    expect(message).not.toMatch(EXACT_MESSAGE);
  });
});

describe('assertTileHeader: truncation is left to pngjs', () => {
  const base = solidPng(256, 256, RED);
  // Precondition: the first chunk after IHDR is IDAT.
  expect(base.subarray(37, 41).toString('latin1')).toBe('IDAT');

  const cases: Array<[string, Buffer]> = [
    ['cut 5 bytes into the IDAT chunk', base.subarray(0, 33 + 8 + 5)],
    ['with no IEND', base.subarray(0, base.length - 12)],
  ];

  for (const [name, buf] of cases) {
    it(`does not make the walk throw, and pngjs fails the decode: ${name}`, () => {
      expect(() => assertTileHeader(buf, 256)).not.toThrow();
      let message = '';
      try {
        assembleTiles([buf], 1, 1, 256);
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).not.toBe('');
      expect(message).not.toMatch(EXACT_MESSAGE);
    });
  }
});

describe('assembleTiles: decoded size is checked before the copy loop', () => {
  const genuine = solidPng(256, 256, RED);

  for (const [w, h] of [
    [16, 16],
    [256, 512],
  ]) {
    it(`refuses a decoded ${w} x ${h} tile with the fixed message`, () => {
      expect(() => assertTileHeader(genuine, 256)).not.toThrow();
      const read = vi.spyOn(PNG.sync, 'read').mockReturnValue(new PNG({ width: w, height: h }));
      let message = '';
      try {
        assembleTiles([genuine], 1, 1, 256);
      } catch (e) {
        message = (e as Error).message;
      }
      expect(read).toHaveBeenCalledTimes(1);
      expect(message).toBe('Tile is not a 256px non-interlaced PNG');
      expect(message).not.toContain('16');
      expect(message).not.toContain('512');
    });
  }

  it('assembles when the decoded size is 256 x 256 (control)', () => {
    const read = vi.spyOn(PNG.sync, 'read').mockReturnValue(new PNG({ width: 256, height: 256 }));
    const out = assembleTiles([genuine], 1, 1, 256);
    expect(read).toHaveBeenCalledTimes(1);
    expect(out.width).toBe(256);
    expect(out.height).toBe(256);
  });
});

describe('assertTileHeader: a buffer that ends at the first IHDR has nothing to walk', () => {
  it('does not throw for a valid 33-byte header-only buffer, and a 38-byte one', () => {
    expect(() => assertTileHeader(headerOnly(256, 256), 256)).not.toThrow();
    expect(() => assertTileHeader(Buffer.concat([headerOnly(256, 256), Buffer.alloc(5)]), 256)).not.toThrow();
  });
});
