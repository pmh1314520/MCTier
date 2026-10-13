export interface RelayTopologyInput {
  ownerId: string;
  viewerOrder: readonly string[];
  readyViewerIds: ReadonlySet<string>;
  unavailableRelayIds?: ReadonlySet<string>;
  unavailableEdges?: ReadonlySet<string>;
  ownerChildLimit?: number;
  relayChildLimit?: number;
}
export function buildRelayTopology({
  ownerId,
  viewerOrder,
  readyViewerIds,
  unavailableRelayIds = new Set<string>(),
  unavailableEdges = new Set<string>(),
  ownerChildLimit = 2,
  relayChildLimit = 1,
}: RelayTopologyInput): Map<string, string> {
  const routes = new Map<string, string>();
  const childCounts = new Map<string, number>();
  const eligibleRelays: string[] = [];

  for (const viewerId of viewerOrder) {
    const candidates = [ownerId, ...eligibleRelays];
    let parent = candidates.find((candidate) => {
      if (candidate === viewerId || unavailableEdges.has(`${candidate}>${viewerId}`)) return false;
      const limit = candidate === ownerId ? ownerChildLimit : relayChildLimit;
      return (childCounts.get(candidate) ?? 0) < limit;
    });

    // Keep every viewer connected even when all preferred relay edges are temporarily unavailable.
    parent ??= ownerId;
    routes.set(viewerId, parent);
    childCounts.set(parent, (childCounts.get(parent) ?? 0) + 1);

    if (readyViewerIds.has(viewerId) && !unavailableRelayIds.has(viewerId)) {
      eligibleRelays.push(viewerId);
    }
  }

  return routes;
}
