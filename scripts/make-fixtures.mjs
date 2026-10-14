#!/usr/bin/env node
// Draws the fixture "thali" photo used by the browser tests (a plate with roti, dal, rice,
// sabzi and salad) as a PNG, with no image library: a tiny rasteriser + zlib.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const W = 900;
const H = 700;
const px = new Uint8Array(W * H * 3);

function fill(r, g, b) {
  for (let i = 0; i < W * H; i++) px.set([r, g, b], i * 3);
}
function circle(cx, cy, rad, [r, g, b], noise = 0) {
  for (let y = Math.max(0, cy - rad); y < Math.min(H, cy + rad); y++) {
    for (let x = Math.max(0, cx - rad); x < Math.min(W, cx + rad); x++) {
      const d = (x - cx) ** 2 + (y - cy) ** 2;
      if (d > rad * rad) continue;
      const n = noise ? (((x * 7919 + y * 104729) % 97) / 97 - 0.5) * noise : 0;
      const shade = 1 - (Math.sqrt(d) / rad) * 0.12;
      px.set([r * shade + n, g * shade + n, b * shade + n].map((v) => Math.max(0, Math.min(255, v))), (y * W + x) * 3);
    }
  }
}

fill(92, 64, 51); // wooden table
circle(450, 350, 330, [214, 214, 210]); // steel thali
circle(450, 350, 318, [196, 197, 194]);
circle(300, 230, 95, [180, 181, 178]); // katori: dal
circle(300, 230, 82, [222, 170, 48], 30);
circle(560, 200, 95, [180, 181, 178]); // katori: sabzi
circle(560, 200, 82, [96, 128, 46], 60);
circle(640, 420, 85, [180, 181, 178]); // katori: salad
circle(640, 420, 72, [200, 60, 50], 70);
circle(330, 470, 120, [236, 232, 220], 25); // rice mound
circle(480, 540, 85, [196, 150, 90], 40); // rotis
circle(500, 520, 85, [204, 158, 96], 40);

function png(width, height, rgb) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    Buffer.from(rgb.buffer, y * width * 3, width * 3).copy(raw, y * (width * 3 + 1) + 1);
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'e2e', 'fixtures');
mkdirSync(out, { recursive: true });
writeFileSync(path.join(out, 'thali.png'), png(W, H, px));
console.log(`wrote ${path.join(out, 'thali.png')}`);
