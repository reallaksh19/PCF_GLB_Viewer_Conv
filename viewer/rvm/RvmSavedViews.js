import { state, saveStickyState } from '../core/state.js';
import { emit } from '../core/event-bus.js';
import { RuntimeEvents } from '../contracts/runtime-events.js';

export class RvmSavedViews {
  /**
   * Captures the current viewer state into a saved view object.
   * Uses schema: rvm-saved-view/v1
   */
  static saveView(viewer, viewName = 'New View') {
    if (!state.rvm || !state.rvm.activeBundle) {
      throw new Error("Cannot save view without an active bundle.");
    }

    const cameraState = viewer?.getCameraState ? viewer.getCameraState() : {};
    const selection = viewer?.getSelection ? viewer.getSelection() : null;
    const viewId = `VIEW-${crypto.randomUUID()}`;

    // For section state, we'll try to retrieve it if available, else default to null/empty
    const sectionState = viewer?.getSectionState ? viewer.getSectionState() : null;

    const navMode = viewer?.getNavMode ? viewer.getNavMode() : 'orbit';
    const projection = viewer?.getProjection ? viewer.getProjection() : 'perspective';

    const view = {
      schemaVersion: 'rvm-saved-view/v1',
      id: viewId,
      bundleId: state.rvm.activeBundle,
      name: viewName,
      camera: cameraState,
      projection: projection,
      navMode: navMode,
      sectionState: sectionState,
      hiddenCanonicalObjectIds: [],   // to be gathered if visibility controller state exists
      isolatedCanonicalObjectIds: [], // to be gathered if visibility controller state exists
      selectedCanonicalObjectId: selection,
      overlayMode: { tags: true, attributes: false }
    };

    if (!Array.isArray(state.rvm.savedViews)) {
        state.rvm.savedViews = [];
    }

    state.rvm.savedViews.push(view);
    saveStickyState();

    emit(RuntimeEvents.RVM_CONFIG_CHANGED, { reason: 'view-saved', viewId });
    return view;
  }

  /**
   * Restores a view given its ID.
   */
  static loadView(viewer, viewId) {
    if (!state.rvm || !Array.isArray(state.rvm.savedViews)) return;

    const view = state.rvm.savedViews.find(v => v.id === viewId);
    if (!view) {
      throw new Error(`Saved view ${viewId} not found.`);
    }

    if (viewer?.setSavedView) {
      viewer.setSavedView(view);
    }
  }

  /**
   * Retrieves all saved views for the active bundle.
   */
  static getViewsForActiveBundle() {
    if (!state.rvm || !state.rvm.activeBundle || !Array.isArray(state.rvm.savedViews)) return [];
    return state.rvm.savedViews.filter(v => v.bundleId === state.rvm.activeBundle);
  }

  /**
   * Deletes a saved view.
   */
  static deleteView(viewId) {
    if (!state.rvm || !Array.isArray(state.rvm.savedViews)) return;

    state.rvm.savedViews = state.rvm.savedViews.filter(v => v.id !== viewId);
    saveStickyState();

    emit(RuntimeEvents.RVM_CONFIG_CHANGED, { reason: 'view-deleted', viewId });
  }
}
