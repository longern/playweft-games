// A small retained-mode layer for scene objects whose state arrives as a fresh
// game snapshot. It gives Three.js nodes a React-style keyed lifecycle without
// making the renderer depend on React: create once, update in place, remove
// only when the key leaves the snapshot.
export class ThreeKeyedSceneLayer {
  constructor(group) {
    this.group = group;
    this.records = new Map();
  }

  reconcile(entries, { keyOf, create, update, remove } = {}) {
    const nextKeys = new Set();
    for (const entry of entries) {
      const key = String(keyOf(entry));
      if (nextKeys.has(key)) {
        throw new Error(`Duplicate keyed scene entry: ${key}`);
      }
      nextKeys.add(key);
      let record = this.records.get(key);
      const created = !record;
      if (created) {
        record = create(entry, key);
        if (!record?.node) {
          throw new Error(`Keyed scene entry ${key} must provide a node`);
        }
        this.records.set(key, record);
        this.group.add(record.node);
      }
      update?.(record, entry, { created, key });
    }

    for (const [key, record] of this.records) {
      if (nextKeys.has(key)) continue;
      remove?.(record, key);
      record.node.parent?.remove(record.node);
      this.records.delete(key);
    }
  }

  clear(remove) {
    for (const [key, record] of this.records) {
      remove?.(record, key);
      record.node.parent?.remove(record.node);
    }
    this.records.clear();
  }
}
