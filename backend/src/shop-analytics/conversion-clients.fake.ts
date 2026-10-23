// In-repo fakes for the three ad-platform clients. Used by tests (and any local
// run) so nothing in this repo ever calls Meta, TikTok or Snap for real. Records
// every call, optionally fails the next one with a secret-free message.
export class FakeConversionClient<P> {
  calls: P[] = [];
  failNext: string | null = null;
  send = (params: P): Promise<void> => {
    this.calls.push(params);
    if (this.failNext) {
      const m = this.failNext;
      this.failNext = null;
      return Promise.reject(new Error(m));
    }
    return Promise.resolve();
  };
  reset(): void {
    this.calls = [];
    this.failNext = null;
  }
}
