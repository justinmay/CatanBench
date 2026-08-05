import type { Resource, ResourceMap } from "@catanbench/protocol";

import { RESOURCES } from "./constants";

export function emptyResourceMap(): ResourceMap {
  return { brick: 0, lumber: 0, ore: 0, grain: 0, wool: 0 };
}

export function sumResources(resources: ResourceMap): number {
  return RESOURCES.reduce((sum, resource) => sum + resources[resource], 0);
}

export function hasResources(
  available: ResourceMap,
  required: ResourceMap,
): boolean {
  return RESOURCES.every(
    (resource) => available[resource] >= required[resource],
  );
}

export function addResources(target: ResourceMap, change: ResourceMap): void {
  for (const resource of RESOURCES) {
    target[resource] += change[resource];
  }
}

export function subtractResources(
  target: ResourceMap,
  change: ResourceMap,
): void {
  for (const resource of RESOURCES) {
    target[resource] -= change[resource];
  }
}

export function singleResourceMap(
  resource: Resource,
  count: number,
): ResourceMap {
  const resources = emptyResourceMap();
  resources[resource] = count;
  return resources;
}

export function nonzeroResources(
  resources: ResourceMap,
): Array<[Resource, number]> {
  return RESOURCES.flatMap((resource) => {
    const count = resources[resource];
    return count > 0 ? [[resource, count] as [Resource, number]] : [];
  });
}
