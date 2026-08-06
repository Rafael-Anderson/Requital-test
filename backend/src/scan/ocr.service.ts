import { Injectable } from '@nestjs/common';
import { createWorker } from 'tesseract.js';

// Tesseract.js, not a vision LLM — free, local, no per-scan API cost (see
// the task this was built for). A worker is created and torn down per scan
// rather than kept warm as a singleton: this is an infrequent, admin-only,
// one-shot action (a merchant photographing a supplier invoice), not a hot
// path — the ~1-2s worker startup cost isn't worth the complexity of
// pooling/reusing a long-lived worker across requests.
@Injectable()
export class OcrService {
  // Takes the in-memory buffer directly (tesseract.js's ImageLike accepts a
  // Buffer natively) rather than a disk path — the upload pipeline moved to
  // multer memoryStorage in Phase 6 (see common/image-upload.config.ts), so
  // there's no file.path to read from anymore.
  async recognize(image: Buffer): Promise<string> {
    const worker = await createWorker('eng');
    try {
      const {
        data: { text },
      } = await worker.recognize(image);
      return text;
    } finally {
      await worker.terminate();
    }
  }
}
