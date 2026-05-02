from __future__ import annotations

from pathlib import Path
import hashlib
import json
from datetime import datetime, timezone

ROOT = Path(r"C:\Code3\PCF_GLB_Viewer_Conv")
PORT = ROOT / "BM2" / "Port"
PAYLOAD = PORT / "payload" / "current"

PATCH_MODULES = [
    {
        "id": "topo-support-model-exchange",
        "title": "Topo/Support Intermediate Layer for Model Exchange",
        "patchFile": "patches/01_topo_support_model_exchange.patch",
        "dependsOn": [],
        "files": [
            "viewer/core/app.js",
            "opt/tab-visibility.json",
            "viewer/opt/tab-visibility.json",
            "viewer/interchange/source/adapter-registry.js",
            "viewer/interchange/source/xml/CaesarXmlImportAdapter.js",
            "viewer/tabs/model-exchange-tab.js",
            "viewer/tabs/model-exchange-tab.css",
            "viewer/interchange/source/rev/rev-text-parser.js",
            "viewer/interchange/source/rev/RevImportAdapter.js",
            "viewer/interchange/source/json/json-topo-parser.js",
            "viewer/interchange/source/json/GenericJsonImportAdapter.js",
            "viewer/interchange/topo/template-evaluator.js",
            "viewer/interchange/topo/topo-mapping-profiles.js",
            "viewer/interchange/topo/topo-builder.js",
            "viewer/interchange/support/support-mapping-config.js",
            "viewer/interchange/support/support-mapping-store.js",
            "viewer/interchange/support/support-builder.js",
            "viewer/interchange/view/Modelexh_PreviewRenderer.js",
            "viewer/tabs/support-mapping-config-tab.js",
            "viewer/tabs/support-mapping-config-tab.css",
        ],
    },
    {
        "id": "rvm-attribute-xml-compat",
        "title": "RVM+ATTRIBUTE XML-only Script + Legacy Shim",
        "patchFile": "patches/02_rvm_attribute_xml_compat.patch",
        "dependsOn": ["topo-support-model-exchange"],
        "files": [
            "viewer/converters/py-worker.js",
            "viewer/converters/scripts/rvm_attribute_to_xml.py",
            "viewer/converters/scripts/rvm_attribute_to_xml_to_cii.py",
        ],
    },
    {
        "id": "tests",
        "title": "Adapter/Support/UI Test Updates",
        "patchFile": "patches/03_tests.patch",
        "dependsOn": ["topo-support-model-exchange"],
        "files": [
            "viewer/tests/unit/interchange/adapter-registry.test.js",
            "viewer/tests/unit/interchange/support-mapping-config.test.js",
            "viewer/tests/integration/model-exchange-ui.test.js",
            "viewer/tests/run-interface-tests.mjs",
        ],
    },
    {
        "id": "model-converters-3d-preview",
        "title": "3DModelConv Canvas Preview in 3D Model Converters",
        "patchFile": "patches/04_model_converters_3d_preview.patch",
        "dependsOn": ["topo-support-model-exchange"],
        "files": [
            "viewer/tabs/model-converters-tab.js",
            "viewer/tabs/model-converters-tab.css",
            "viewer/converters/view/3DModelConv_PreviewRenderer.js",
        ],
    },
]

OVERLAY_FILES = [
    "viewer/contracts/runtime-events.js",
]


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def stat_payload(rel_path: str):
    path = PAYLOAD / rel_path
    if not path.exists():
        return None
    return {
        "path": rel_path.replace('\\', '/'),
        "sha256": sha256_file(path),
        "bytes": path.stat().st_size,
    }


def build_manifest() -> dict:
    modules = []
    for module in PATCH_MODULES:
        files = []
        for rel in module["files"]:
            st = stat_payload(rel)
            if st is None:
                continue
            files.append({
                **st,
                "strategy": "patch_then_overlay",
            })
        modules.append({
            "id": module["id"],
            "title": module["title"],
            "patchFile": module["patchFile"],
            "dependsOn": module["dependsOn"],
            "files": files,
        })

    overlay_entries = []
    for rel in OVERLAY_FILES:
        st = stat_payload(rel)
        if st is None:
            continue
        overlay_entries.append({
            **st,
            "strategy": "overlay_only",
        })

    return {
        "version": "1.0.0",
        "createdAtUtc": datetime.now(timezone.utc).isoformat(),
        "sourceRoot": str(ROOT),
        "portRoot": str(PORT),
        "modules": modules,
        "overlayFiles": overlay_entries,
        "validation": {
            "commands": [
                "node --check viewer/core/app.js",
                "node --check viewer/tabs/model-exchange-tab.js",
                "node --check viewer/tabs/support-mapping-config-tab.js",
                "python -m py_compile viewer/converters/scripts/rvm_attribute_to_xml.py viewer/converters/scripts/rvm_attribute_to_xml_to_cii.py",
                "node viewer/tests/unit/interchange/adapter-registry.test.js",
                "node viewer/tests/unit/interchange/support-mapping-config.test.js",
                "node viewer/tests/integration/model-exchange-ui.test.js",
            ],
            "notes": [
                "Full interface suite may fail in pure Node due import-map dependency on three; use browser/runtime environment for end-to-end coverage."
            ],
        },
    }


def build_anchors() -> dict:
    return {
        "version": "1.0.0",
        "anchors": [
            {
                "path": "viewer/interchange/source/adapter-registry.js",
                "mustContain": [
                    "RevImportAdapter",
                    "GenericJsonImportAdapter",
                    "CaesarXmlImportAdapter",
                ],
            },
            {
                "path": "viewer/tabs/model-exchange-tab.js",
                "mustContain": [
                    "ModelexhPreviewRenderer",
                    "data-role=\"modelexh-preview\"",
                    "open-support-config",
                ],
            },
            {
                "path": "viewer/interchange/topo/topo-builder.js",
                "mustContain": [
                    "TopoGraph",
                    "buildCanonicalProjectFromTopoSource",
                    "buildSupportSpecs",
                ],
            },
            {
                "path": "viewer/interchange/support/support-builder.js",
                "mustContain": [
                    "SupportSpec",
                    "buildSupportSpecs",
                    "SUPPORT_ANCHOR_FALLBACK",
                ],
            },
            {
                "path": "viewer/converters/scripts/rvm_attribute_to_xml_to_cii.py",
                "mustContain": [
                    "deprecated",
                    "rvm_attribute_to_xml.py",
                    "XML-only",
                ],
            },
            {
                "path": "viewer/tabs/model-converters-tab.js",
                "mustContain": [
                    "3DModelConv Geometry Preview",
                    "ModelConverters_3DModelConv_PreviewRenderer",
                    "_3DModelConv_renderPreviewFromOutputs",
                ],
            },
        ],
    }


def main() -> int:
    manifest_path = PORT / "manifest" / "port-manifest.json"
    anchors_path = PORT / "manifest" / "anchors.json"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    anchors_path.parent.mkdir(parents=True, exist_ok=True)

    manifest = build_manifest()
    anchors = build_anchors()

    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    anchors_path.write_text(json.dumps(anchors, indent=2), encoding="utf-8")
    print(f"Wrote {manifest_path}")
    print(f"Wrote {anchors_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
