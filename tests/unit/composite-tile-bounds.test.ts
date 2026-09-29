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
