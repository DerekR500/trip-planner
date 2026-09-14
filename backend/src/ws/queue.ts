/**
 * Per-trip mutation serialization.
 *
 * Every mutation for a given trip runs strictly one at a time, chained onto a promise.
 * This is the whole reason concurrent drags stay correct: rank computation reads the
 * stop list, decides a new rank, and writes it. If two of those interleaved, both could
 * read the same "before" state and mint the SAME rank between the same two neighbours.
 * Serializing means the second reorder always sees the first one's committed row.
 *
 * Deliberately correctness over throughput: mutations for one trip queue behind each
 * other. Different trips never block each other, and at this scale a mutation is a
 * couple of indexed queries.
 */
const chains = new Map<string, Promise<unknown>>();

export function enqueue<T>(tripId: string, task: () => Promise<T>): Promise<T> {
  const previous = chains.get(tripId) ?? Promise.resolve();

  // Run `task` whether the previous entry resolved or rejected — one client's bad input
  // must not wedge the queue for everyone else in the trip.
  const result = previous.then(task, task);

  // The stored link swallows errors so the chain itself never becomes a rejected promise.
  const link = result.then(
    () => undefined,
    () => undefined,
  );
  chains.set(tripId, link);

  // Drop the entry once the queue has drained, so the Map cannot grow forever as trips
  // come and go. Only clear it if nothing else has queued behind us in the meantime.
  void link.then(() => {
    if (chains.get(tripId) === link) chains.delete(tripId);
  });

  return result;
}
