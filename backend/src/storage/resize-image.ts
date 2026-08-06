import sharp from 'sharp';

// sharp — libvips-backed, the de facto standard for Node image processing;
// chosen over a pure-JS alternative (e.g. jimp) because resizing here runs
// synchronously inline on the upload request (see StorageService — deemed
// fast enough not to need Phase 5's job queue, unlike the network calls
// that queue exists for), and jimp's pure-JS decode/encode is measurably
// slower and more memory-hungry for exactly the kind of work (JPEG/PNG
// resize) this endpoint does on every upload.
//
// { fit: 'inside', withoutEnlargement: true }: preserves aspect ratio and
// never upscales a source image smaller than the target width — a 150px
// original stays 150px in the "thumbnail" variant rather than being
// blown up and softened.
export async function resizeImage(
  buffer: Buffer,
  width: number,
  format: 'jpeg' | 'png' | 'webp' | 'gif',
): Promise<Buffer> {
  // animated: true preserves multi-frame GIFs through the resize — sharp
  // only processes the first frame by default, which would silently turn
  // an animated GIF's thumbnail/medium variants static.
  const pipeline = sharp(buffer, { animated: format === 'gif' }).resize({
    width,
    fit: 'inside',
    withoutEnlargement: true,
  });
  return pipeline.toFormat(format).toBuffer();
}
