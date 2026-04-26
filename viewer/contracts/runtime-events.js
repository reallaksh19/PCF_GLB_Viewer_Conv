export const RuntimeEvents = Object.freeze({
  TAB_CHANGED: 'tab-changed',
  FILE_LOADED: 'file-loaded',
  PARSE_COMPLETE: 'parse-complete',
  VIEWER3D_CONFIG_CHANGED: 'viewer3d-config-changed',
  DIAGNOSTIC_EVENT: 'diagnostic-event',
  NOTIFY: 'notify',
  SCOPE_CHANGED: 'scope-changed',
  LEGEND_CHANGED: 'legend-changed',
  GEO_TOGGLE: 'geo-toggle',
  LOAD_PINNED: 'load-pinned',
  MODEL_LOADED: 'model-loaded',
  COMPONENT_PICKED: 'component-picked',
  DEBUG_REFRESH: 'debug-refresh',
  SESSION_LOG: 'session-log',
  LOG_ADDED: 'log-added',
  TRACE_ADDED: 'trace-added',
  LOG_RESOLVED: 'log-resolved',
  SUPPORT_MAPPING_CHANGED: 'support-mapping-changed',
  DOCNO_CHANGED: 'docno-changed',
  FILE_DROPPED: 'file-dropped',
  JUMP_TO_OBJECT: 'jump-to-object',
  TRACE_CLEARED: 'trace-cleared',
  LOGS_CLEARED: 'logs-cleared',
  MODEL_EXCHANGE_IMPORTED: 'model-exchange-imported',
  MODEL_EXCHANGE_EXPORTED: 'model-exchange-exported',
  CONVERSION_CONFIG_CHANGED: 'conversion-config-changed',
  CONVERSION_CONFIG_RESET: 'conversion-config-reset',
  CONVERSION_CONFIG_LOADED: 'conversion-config-loaded',
  CONVERSION_CONFIG_ERROR: 'conversion-config-error',
  INTERCHANGE_DIAGNOSTIC: 'interchange-diagnostic',
  MODEL_CONVERTER_START: 'model-converter-start',
  MODEL_CONVERTER_SUCCESS: 'model-converter-success',
  MODEL_CONVERTER_ERROR: 'model-converter-error',
  RVM_MODEL_LOADED: 'rvm-model-loaded',
  RVM_NODE_SELECTED: 'rvm-node-selected',
  RVM_TAG_CREATED: 'rvm-tag-created',
  RVM_TAG_DELETED: 'rvm-tag-deleted',
  RVM_SEARCH_CHANGED: 'rvm-search-changed',
  RVM_CONFIG_CHANGED: 'rvm-config-changed',
});

const _validEvents = new Set(Object.values(RuntimeEvents));

export function assertRuntimeEvent(name) {
  if (!_validEvents.has(name)) {
    throw new Error(`Unregistered runtime event: ${name}`);
  }
}
