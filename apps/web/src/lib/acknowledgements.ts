/** Keeps transport callbacks alive until parsing completes or the consumer is disposed. */
export class PendingAcknowledgements {
  private pending = new Set<() => void>();
  track(acknowledge: () => void): () => void {
    const complete = () => {
      if (!this.pending.delete(complete)) return;
      acknowledge();
    };
    this.pending.add(complete);
    return complete;
  }
  flush() {
    for (const complete of this.pending) complete();
  }
}
