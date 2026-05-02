from __future__ import annotations

from pathlib import Path
import difflib

ROOT = Path(r"C:\Code3\PCF_GLB_Viewer_Conv")
PORT = ROOT / "BM2" / "Port"
BASE = PORT / "baseline"
CUR = PORT / "payload" / "current"
PATCH_DIR = PORT / "patches"
PATCH_DIR.mkdir(parents=True, exist_ok=True)

MODULES = {
    "01_topo_support_model_exchange.patch": [
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
    "02_rvm_attribute_xml_compat.patch": [
        "viewer/converters/py-worker.js",
        "viewer/converters/scripts/rvm_attribute_to_xml.py",
        "viewer/converters/scripts/rvm_attribute_to_xml_to_cii.py",
    ],
    "03_tests.patch": [
        "viewer/tests/unit/interchange/adapter-registry.test.js",
        "viewer/tests/unit/interchange/support-mapping-config.test.js",
        "viewer/tests/integration/model-exchange-ui.test.js",
        "viewer/tests/run-interface-tests.mjs",
    ],
    "04_model_converters_3d_preview.patch": [
        "viewer/tabs/model-converters-tab.js",
        "viewer/tabs/model-converters-tab.css",
        "viewer/converters/view/3DModelConv_PreviewRenderer.js",
    ],
}


def read_text(path: Path):
    return path.read_text(encoding="utf-8", errors="replace").splitlines(keepends=True)


def norm_rel(rel: str) -> str:
    return rel.replace("\\", "/")


def build_patch_for_file(rel: str) -> str:
    rel_norm = norm_rel(rel)
    old_path = BASE / rel
    new_path = CUR / rel
    if not new_path.exists():
        return ""

    old_lines = read_text(old_path) if old_path.exists() else []
    new_lines = read_text(new_path)

    if old_lines == new_lines:
        return ""

    a_name = f"a/{rel_norm}"
    b_name = f"b/{rel_norm}"
    diff_lines = list(
        difflib.unified_diff(
            old_lines,
            new_lines,
            fromfile=a_name,
            tofile=b_name,
            lineterm="",
        )
    )
    if not diff_lines:
        return ""

    header = [f"diff --git {a_name} {b_name}"]
    if not old_path.exists():
        header.extend(["new file mode 100644", "index 0000000..1111111 100644"])
    elif not new_path.exists():
        header.extend(["deleted file mode 100644", "index 1111111..0000000 100644"])
    else:
        header.append("index 1111111..2222222 100644")

    payload = "\n".join(header + diff_lines) + "\n"
    return payload


def main() -> int:
    generated = {}
    for patch_name, rel_files in MODULES.items():
        chunks = []
        for rel in rel_files:
            patch = build_patch_for_file(rel)
            if patch:
                chunks.append(patch)
        out_path = PATCH_DIR / patch_name
        out_path.write_text("\n".join(chunks), encoding="utf-8")
        generated[patch_name] = len(chunks)

    report = PORT / "reports" / "patch-build-summary.txt"
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text("\n".join(f"{k}: {v} file patch blocks" for k, v in generated.items()), encoding="utf-8")
    print("Patch files generated:")
    for name, count in generated.items():
        print(f"  {name}: {count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
