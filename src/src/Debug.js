/**
 * Toggleable performance tracer for the background page.
 * Disabled by default; enable via the debugLoggingEnabled setting.
 * Marks/measures show up in the Firefox/Thunderbird profiler timeline;
 * log() is for plain flow tracing (cache hits, which provider resolved, ...).
 */
class Debug {
  constructor() {
    this.enabled = false;
    this._counter = 0;
  }

  setEnabled(enabled) {
    this.enabled = !!enabled;
  }

  /**
   * Returns a unique id to disambiguate marks from concurrent calls to the
   * same code path (e.g. parallel subbatches), so measure() doesn't pair up
   * marks from unrelated calls.
   */
  nextId() {
    return ++this._counter;
  }

  mark(name) {
    if (!this.enabled) return;
    performance.mark(name);
  }

  measure(name, startMark, endMark) {
    if (!this.enabled) return;
    try {
      const measure = performance.measure(name, startMark, endMark);
      console.debug(`[AutoProfilePicture] ${name}: ${measure.duration.toFixed(1)}ms`);
    } catch (_error) {
      // marks may be missing if measure is called out of order
    }
  }

  log(...args) {
    if (!this.enabled) return;
    console.debug("[AutoProfilePicture]", ...args);
  }
}

export default new Debug();
