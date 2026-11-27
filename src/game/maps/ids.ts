/** Map ids and names without importing any map code (the landing page and store use these). */
export const MAP_NAMES: Record<string, string> = {
  beach: 'Shoreline (beach)',
  vinland: 'Vinland (valley)',
};
export const DEFAULT_MAP = 'beach';
export const isMapId = (id: unknown): id is string => typeof id === 'string' && id in MAP_NAMES;
