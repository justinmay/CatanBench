import type {
  DevelopmentCardType,
  Resource,
  ResourceMap,
  Terrain,
} from "@catanbench/protocol";

export const RESOURCES: readonly Resource[] = [
  "brick",
  "lumber",
  "ore",
  "grain",
  "wool",
];

export const TERRAIN_RESOURCE: Readonly<Partial<Record<Terrain, Resource>>> = {
  hills: "brick",
  forest: "lumber",
  mountains: "ore",
  fields: "grain",
  pasture: "wool",
};

export const ROAD_COST: ResourceMap = {
  brick: 1,
  lumber: 1,
  ore: 0,
  grain: 0,
  wool: 0,
};

export const SETTLEMENT_COST: ResourceMap = {
  brick: 1,
  lumber: 1,
  ore: 0,
  grain: 1,
  wool: 1,
};

export const CITY_COST: ResourceMap = {
  brick: 0,
  lumber: 0,
  ore: 3,
  grain: 2,
  wool: 0,
};

export const DEVELOPMENT_CARD_COST: ResourceMap = {
  brick: 0,
  lumber: 0,
  ore: 1,
  grain: 1,
  wool: 1,
};

export const STANDARD_TERRAINS: readonly Terrain[] = [
  "forest",
  "forest",
  "forest",
  "forest",
  "pasture",
  "pasture",
  "pasture",
  "pasture",
  "fields",
  "fields",
  "fields",
  "fields",
  "hills",
  "hills",
  "hills",
  "mountains",
  "mountains",
  "mountains",
  "desert",
];

export const STANDARD_NUMBER_TOKENS: readonly number[] = [
  2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12,
];

export const STANDARD_DEVELOPMENT_DECK: readonly DevelopmentCardType[] = [
  ...Array<DevelopmentCardType>(14).fill("knight"),
  ...Array<DevelopmentCardType>(5).fill("victory_point"),
  "road_building",
  "road_building",
  "year_of_plenty",
  "year_of_plenty",
  "monopoly",
  "monopoly",
];
