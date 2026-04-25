# Full code deliverable for XML / Sample 6 work

This package is a consolidated best-effort implementation for the Sample 6 XML issue set.

## Included changes
- Dedicated XML graph builder (`viewer/parser/xml-graph-builder.js`)
- Dedicated XML support helper (`viewer/parser/xml-support-builder.js`)
- XML parser preserves more metadata (`viewer/parser/sections/xml-elements.js`)
- Raw import routes XML into XML graph builder (`viewer/js/pcf2glb/import/ImportFromRawParser.js`)
- Viewer 3D tab fixes length toggle wiring and adds verification mode checkbox (`viewer/tabs/viewer3d-tab.js`)
- Viewer engine exposes `refreshLengthLabels()` and respects `lengthLabels.verificationMode` (`viewer/viewer-3d.js`)
- Theme palettes tuned for higher contrast (`viewer/viewer-3d-defaults.js`)

## Important limitations
- Exact disconnected-assembly placement still uses synthetic spacing unless explicit placement seeds are provided through `pcfxDefaults.xmlLayout`.
- `Line No.` for XML remains a fallback assembly label unless the XML source exposes a real line number field.
- Verification mode is implemented for length labels; node/spare/line overlays were already largely direct-driven and are not fully reworked here.
- Core PCF modules were intentionally left untouched.
