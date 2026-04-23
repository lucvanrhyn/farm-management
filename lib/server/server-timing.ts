// TODO(P1): replace with canonical version after merge.
//
// Minimal local stub of the helper introduced by Phase P1. Kept here so
// Phase P4 (notifications cache) can emit Server-Timing headers without
// creating a merge conflict with P1's in-flight worktree. The reviewer will
// reconcile this file when P1 merges — the signature and output format must
// stay stable: `<metric>;dur=<ms with one decimal>` joined by `, `.

export function emitServerTiming(timings: Record<string, number>): string {
  return Object.entries(timings)
    .map(([k, v]) => `${k};dur=${v.toFixed(1)}`)
    .join(", ");
}
