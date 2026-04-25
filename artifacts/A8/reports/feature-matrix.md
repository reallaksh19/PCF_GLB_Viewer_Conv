# Feature Parity Matrix

| Feature | Pre-Upgrade State | Current Set 1/2 State | Disposition |
|---|---|---|---|
| Dual Shell Execution | Split entry points | Single `viewer/core/app.js` entry | **Passed** |
| Event Architecture | Magic strings | `RuntimeEvents` enum & Assertions | **Passed** |
| Viewer Actions | Raw state mutation | `ViewerCommand` dispatch | **Passed** |
| Import Process | Static Adapter List | Confidence-based Adapter Registry | **Passed** |
| Error Handling | Blocking `alert()` | Centralized `NotificationCenter` | **Passed** |
| Diagnostics | Console noise | Exportable `DiagnosticsHub` Bundle | **Passed** |
| Engineering Calcs | Fragmented returns | Standard `buildCalcResult` | **Passed** |
| Model Exports | Scattered | Roundtrip fidelity loss-reporting | **Passed** |
