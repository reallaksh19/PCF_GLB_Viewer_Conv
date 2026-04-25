README.txt
==========

Patch scope
-----------
This patch upgrades the active viewer-side interface module around the existing `viewer/interchange/*` and `viewer/tabs/*` code tree.

It adds:
1. Dedicated runtime conversion config modules and UI tab
2. A promoted Model Exchange tab with import/export controls
3. Inline SVG icon patch code for interchange actions
4. Export adapters wired to use the conversion config
5. Debug-collapsible window support for conversion-config events
6. Test scripts for interface module validation and smoke coverage

Important design choice
-----------------------
The patch keeps the existing active shipping tree under `viewer/*` as the source of truth.
It does NOT create a new parallel runtime tree.

Files included
--------------
See DIRECTORY_STRUCTURE.txt for the exact file tree included in this patch.

How to apply
------------
Copy the patch files into the repo root, preserving paths.
All paths in this patch are relative to the project root.

Main modified / added paths
---------------------------
- viewer/core/app.js
- viewer/index.html
- viewer/opt/tab-visibility.json
- viewer/contracts/runtime-events.js
- viewer/debug/dev-debug-window.js
- viewer/tabs/model-exchange-tab.js
- viewer/tabs/model-exchange-tab.css
- viewer/tabs/interchange-config-tab.js
- viewer/tabs/interchange-config-tab.css
- viewer/interchange/config/*
- viewer/interchange/state/model-exchange-actions.js
- viewer/interchange/state/model-exchange-store.js
- viewer/interchange/export/pcf/PcfExportAdapter.js
- viewer/interchange/export/pcfx/PcfxExportAdapter.js
- viewer/interchange/export/xml/XmlExportAdapter.js
- viewer/interchange/view/interchange-icons.js
- viewer/interchange/index.js
- viewer/tests/*

What changed functionally
-------------------------
1. Active app shell:
   - Added "Model Exchange" tab
   - Added "Interchange Config" tab
   - Enabled tab switching through `app:switch-tab`
   - Emits `tab-changed` consistently

2. Model Exchange tab:
   - Import button for PCF / XML / PCFX / GLB
   - Export buttons for PCF / PCFX / XML / GLB
   - Config button to jump to the dedicated config tab
   - Uses inline SVG icons via `viewer/interchange/view/interchange-icons.js`
   - Shows active config snapshot and last export summary
   - Uses `notify()` instead of `alert()`

3. Conversion Config tab:
   - Dedicated editor for runtime conversion defaults
   - Apply / Reset / Export JSON / Import JSON
   - Validation-driven UX
   - Persists config in localStorage
   - Emits runtime events and diagnostics

4. Debug-collapsible window:
   - Added conversion summary pills
   - Added "Conversion" tab
   - Captures conversion-config and model-exchange events
   - Exports config state in debug bundle

5. Export compatibility:
   - PCF export uses configurable precedence
   - PCFX export wraps project in a stable envelope
   - XML export produces a simple XML(PCFX1)-style project envelope

Upstream / downstream impact checked
------------------------------------
Upstream:
- App shell tab registration updated in `viewer/core/app.js`
- `viewer/index.html` now loads CSS for both new interface tabs
- `viewer/contracts/runtime-events.js` expanded for interchange/config events

Downstream:
- Model Exchange export actions use existing export adapter pattern
- Debug window listens to new runtime events without breaking existing tabs
- Existing viewer3d / pcfx-converter paths remain intact
- Existing integration tests for `model-exchange-tab.js` and export roundtrip continue to pass

Test execution
--------------
Executed in container:
`node --experimental-default-type=module viewer/tests/run-interface-tests.mjs`

Included coverage:
- unit/interchange/conversion-config.test.js
- integration/interchange-config-ui.test.js
- integration/interchange-export-smoke.test.js
- integration/model-exchange-ui.test.js
- integration/export-roundtrip.test.js

Artifacts
---------
- TEST_RESULTS.txt : consolidated test output
- DIRECTORY_STRUCTURE.txt : patch file tree

Notes
-----
- This patch is scoped to the active viewer-side interface module and its immediate wiring.
- It does not claim to complete all builder stubs in `viewer/interchange/builders/*`.
- XML import remains browser-oriented because it depends on DOMParser in the current codebase.
- GLB export remains metadata-style in the current architecture; the patch keeps that behavior but wires it into the interface flow cleanly.
