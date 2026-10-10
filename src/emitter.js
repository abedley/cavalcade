/**
 * Minimal event emitter that works in both Node and the browser
 * (Node's `events` module isn't available on GitHub Pages without a bundler).
 */
export class Emitter {
  #listeners = new Map();

  on(event, listener) {
    if (!this.#listeners.has(event)) this.#listeners.set(event, new Set());
    this.#listeners.get(event).add(listener);
    return () => this.off(event, listener);
  }

  once(event, listener) {
    const off = this.on(event, (...args) => {
      off();
      listener(...args);
    });
    return off;
  }

  off(event, listener) {
    this.#listeners.get(event)?.delete(listener);
  }

  emit(event, payload) {
    for (const listener of [...(this.#listeners.get(event) ?? [])]) {
      listener(payload);
    }
  }
}
