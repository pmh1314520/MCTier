import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRelayTopology } from '../src/services/screenShare/relayTopology.ts';

test('five simultaneous viewers form a bounded shallow relay tree', () => {
  const routes = buildRelayTopology({
    ownerId: 'owner',
    viewerOrder: ['v1', 'v2', 'v3', 'v4', 'v5'],
    readyViewerIds: new Set(['v1', 'v2', 'v3', 'v4']),
  });

  assert.equal(routes.get('v1'), 'owner');
  assert.equal(routes.get('v2'), 'owner');
  assert.equal(routes.get('v3'), 'v1');
  assert.equal(routes.get('v4'), 'v2');
  assert.equal(routes.get('v5'), 'v3');
  assert.equal([...routes.values()].filter((parent) => parent === 'owner').length, 2);
});

test('an unavailable relay and edge are skipped without dropping a viewer', () => {
  const routes = buildRelayTopology({
    ownerId: 'owner',
    viewerOrder: ['v1', 'v2', 'v3', 'v4'],
    readyViewerIds: new Set(['v1', 'v2', 'v3']),
    unavailableRelayIds: new Set(['v1']),
    unavailableEdges: new Set(['v2>v3']),
  });

  assert.equal(routes.size, 4);
  assert.notEqual(routes.get('v3'), 'v1');
  assert.notEqual(routes.get('v3'), 'v2');
});

