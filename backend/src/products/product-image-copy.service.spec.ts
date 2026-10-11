import sharp from 'sharp';
import {
  MAX_COPY_PIXELS,
  withinPixelLimit,
} from './product-image-copy.service';

const solid = (width: number, height: number, format: 'png' | 'webp' = 'png') =>
  sharp({ create: { width, height, channels: 3, background: '#cc2244' } })
    .toFormat(format)
    .toBuffer();

describe('withinPixelLimit', () => {
  it('accepts an ordinary photo-sized image', async () => {
    expect(await withinPixelLimit(await solid(4000, 3000))).toBe(true); // 12 MP
  });

  it('accepts right at the limit and refuses just over it', async () => {
    // 7000 x 7000 = 49 MP, 8000 x 8000 = 64 MP. Both are tiny files.
    expect(await withinPixelLimit(await solid(7000, 7000))).toBe(true);
    const bomb = await solid(8000, 8000);
    expect(bomb.length).toBeLessThan(2 * 1024 * 1024); // a small file ...
    expect(await withinPixelLimit(bomb)).toBe(false); // ... that is refused
  });

  it('counts every frame of an animation', async () => {
    // A hand-built GIF89a: 1x1 logical screen, 4 identical 1x1 frames.
    const frame = Buffer.from(
      '21f90400000000002c000000000100010000' + '02024401' + '00',
      'hex',
    );
    const gif = Buffer.concat([
      Buffer.from('47494638396101000100800000000000ffffff', 'hex'),
      frame,
      frame,
      frame,
      frame,
      Buffer.from('3b', 'hex'),
    ]);
    expect(await withinPixelLimit(gif, 4)).toBe(true); // 4 frames x 1 pixel
    expect(await withinPixelLimit(gif, 3)).toBe(false);
  });

  it("refuses bytes sharp cannot read, and uses a limit below sharp's own default", async () => {
    expect(await withinPixelLimit(Buffer.from('not an image'))).toBe(false);
    expect(MAX_COPY_PIXELS).toBeLessThan(268_402_689);
  });
});
