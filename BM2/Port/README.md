# Port Package (Topo/Support Model Exchange Upgrade)

This folder stores migration-ready artifacts to forward-port the implemented changes into another copy of the app.

## Structure
- `baseline/`: snapshots captured before implementation (for patch generation source).
- `payload/current/`: authoritative updated files to overlay into target.
- `patches/`: ordered patch stack.
- `manifest/port-manifest.json`: module/file/hash contract.
- `manifest/anchors.json`: drift checks for important integration points.
- `scripts/apply-port.ps1`: apply patches + overlay payload into target root.
- `scripts/verify-port.ps1`: verify file hashes and anchors in target root.
- `reports/`: patch build and apply logs.

## Fast Port Workflow
1. Dry-run:
```powershell
pwsh .\BM2\Port\scripts\apply-port.ps1 -TargetRoot "C:\Code3\NEW_TARGET" -Mode dry-run
```

2. Apply:
```powershell
pwsh .\BM2\Port\scripts\apply-port.ps1 -TargetRoot "C:\Code3\NEW_TARGET" -Mode apply
```

3. Verify:
```powershell
pwsh .\BM2\Port\scripts\verify-port.ps1 -TargetRoot "C:\Code3\NEW_TARGET"
```

## Notes
- Patch application uses `git apply` when available.
- Overlay copy from `payload/current` is always executed (or reported in dry-run), so drifted targets can still converge.
- `viewer/contracts/runtime-events.js` is tracked as overlay-only in this package.
