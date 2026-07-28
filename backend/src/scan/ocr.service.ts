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
  async recognize(imagePath: string): Promise<string> {
    const worker = await createWorker('eng');
    try {
      const {
        data: { text },
      } = await worker.recognize(imagePath);
      return text;
    } finally {
      await worker.terminate();
    }
  }
}
