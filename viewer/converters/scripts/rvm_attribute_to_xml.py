#!/usr/bin/env python3
"""
Managed native conversion pipeline: RVM(+ATTR) -> REV -> XML.

This script keeps the existing native REV route and then enriches the generated
PSI116 XML with support semantics found in the ATT/TXT sidecar.

Support enrichment goals:
- Preserve PS-... support names from attribute text into XML NodeName/ComponentRefNo.
- Preserve DTXR support intent as ConnectionType, e.g. GUIDE, LINESTOP, LIMIT, REST.
- Emit XSD-valid Restraint records with blank Stiffness, configurable blank/default Gap,
  and configurable Friction defaulting to 0.3.
"""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
import xml.etree.ElementTree as ET
import zipfile

PS_TAG_RE = re.compile(r"\bPS[-_/A-Za-z0-9.]+\b", re.IGNORECASE)
SUPPORT_WORD_RE = re.compile(r"GUIDE|LINE\s*STOP|LINESTOP|LIMIT|REST(?:ING)?|SHOE|ANCHOR|FIXED|STOP", re.IGNORECASE)
KEY_VALUE_RE = re.compile(r"^\s*([A-Za-z][A-Za-z0-9_\-]*)\s*(?:=|:|\s)\s*(.*?)\s*$")


def _safe_text(value: object | None) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _normalize_newlines(text: str) -> str:
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    return normalized if normalized.endswith("\n") else f"{normalized}\n"


def _looks_like_rev_text(text: str) -> bool:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if not lines:
        return False
    head = set(lines[:120])
    return "HEAD" in head and "MODL" in head and any(line.startswith("END:") for line in lines)


def _is_rev_like_file(path: Path) -> bool:
    try:
        decoded = path.read_bytes().decode("utf-8")
    except (OSError, UnicodeDecodeError):
        return False
    return _looks_like_rev_text(decoded)


def _ensure_parent(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def _resolve_rvmparser_binary(explicit: Path | None) -> Path:
    candidates: list[Path] = []
    if explicit is not None:
        candidates.append(explicit)
    script_dir = Path(__file__).resolve().parent
    repo_root = script_dir.parent.parent.parent
    candidates.extend([
        repo_root / "tools" / "rvmparser-windows-bin.exe",
        Path("C:/Code3/rvmparser/rvmparser-windows-bin.exe"),
        Path("C:/Code3/PCF_GLB_Viewer_Conv/tools/rvmparser-windows-bin.exe"),
    ])
    for candidate in candidates:
        resolved = candidate.resolve()
        if resolved.exists() and resolved.is_file():
            return resolved
    listed = "\n  - ".join(str(path) for path in candidates)
    raise FileNotFoundError(
        "Native rvmparser binary not found. Checked:\n"
        f"  - {listed}\n"
        "Provide --rvmparser-bin with a valid executable path."
    )


def _run_process(command: list[str], working_directory: Path, stage_name: str) -> None:
    completed = subprocess.run(
        command,
        cwd=str(working_directory),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    stdout_text = _safe_text(completed.stdout)
    stderr_text = _safe_text(completed.stderr)
    if stdout_text:
        print(f"[{stage_name}] stdout:")
        print(stdout_text)
    if stderr_text:
        print(f"[{stage_name}] stderr:")
        print(stderr_text)
    if completed.returncode != 0:
        command_text = " ".join(f'"{part}"' if " " in part else part for part in command)
        raise RuntimeError(
            f"{stage_name} failed with exit code {completed.returncode}.\n"
            f"Command: {command_text}\n"
            f"stderr: {stderr_text}"
        )


def _is_sidecar_parse_error(message: str) -> bool:
    lowered = _safe_text(message).lower()
    return "more end-tags and than new-tags" in lowered or "failed to parse" in lowered


def _repair_attribute_end_balance(attributes_path: Path, repaired_path: Path) -> tuple[int, int]:
    text = attributes_path.read_text(encoding="utf-8", errors="replace")
    repaired_lines: list[str] = []
    depth = 0
    dropped_end_lines = 0
    for line in text.splitlines():
        token = line.strip()
        if re.match(r"^NEW(\s|$)", token):
            depth += 1
            repaired_lines.append(line)
        elif re.match(r"^END(\s|$)", token):
            if depth <= 0:
                dropped_end_lines += 1
            else:
                depth -= 1
                repaired_lines.append(line)
        else:
            repaired_lines.append(line)
    appended_end_lines = 0
    while depth > 0:
        repaired_lines.append("END")
        depth -= 1
        appended_end_lines += 1
    repaired_path.write_text("\n".join(repaired_lines) + "\n", encoding="utf-8")
    return dropped_end_lines, appended_end_lines


def _run_native_rvm_to_rev(
    parser_executable: Path,
    input_path: Path,
    output_rev_path: Path,
    attributes_path: Path | None,
    working_directory: Path,
) -> None:
    command = [str(parser_executable), f"--output-rev={output_rev_path}", str(input_path)]
    if attributes_path is None:
        _run_process(command=command, working_directory=working_directory, stage_name="RVM->REV")
        return
    try:
        _run_process(command=command + [str(attributes_path)], working_directory=working_directory, stage_name="RVM->REV")
        return
    except RuntimeError as error:
        if not _is_sidecar_parse_error(str(error)):
            raise
        print("[RVM->REV] Sidecar parse error detected. Attempting sanitized attribute retry.")
    repaired_path = working_directory / f"{attributes_path.stem}_repaired{attributes_path.suffix}"
    dropped, appended = _repair_attribute_end_balance(attributes_path=attributes_path, repaired_path=repaired_path)
    print(f"[RVM->REV] Attribute repair summary: dropped_unmatched_end={dropped}, appended_missing_end={appended}.")
    try:
        _run_process(command=command + [str(repaired_path)], working_directory=working_directory, stage_name="RVM->REV(repaired-attr)")
        return
    except RuntimeError as error:
        if not _is_sidecar_parse_error(str(error)):
            raise
        print("[RVM->REV] Repaired sidecar still failed. Retrying without sidecar attributes.")
    _run_process(command=command, working_directory=working_directory, stage_name="RVM->REV(no-attr-fallback)")


def _resolve_attribute_sidecar(attributes_path: Path, extraction_directory: Path) -> Path:
    if attributes_path.suffix.lower() != ".zip":
        return attributes_path
    with zipfile.ZipFile(attributes_path, "r") as archive:
        members = archive.infolist()
        if not members:
            raise ValueError(f"Attribute archive is empty: {attributes_path}")
        att_candidates = [m for m in members if m.filename.lower().endswith(".att")]
        txt_candidates = [m for m in members if m.filename.lower().endswith(".txt")]
        selected = sorted(att_candidates or txt_candidates, key=lambda m: m.filename.lower())[0] if (att_candidates or txt_candidates) else None
        if selected is None:
            raise ValueError(f"Attribute ZIP does not contain .att or .txt sidecar: {attributes_path}")
        target_path = extraction_directory / Path(selected.filename).name
        with archive.open(selected, "r") as source_stream:
            target_path.write_bytes(source_stream.read())
        print(f"[RVM->REV] Extracted attribute sidecar from ZIP: {selected.filename}")
        return target_path


def _run_rev_to_xml(
    python_executable: Path,
    rev_to_xml_script: Path,
    input_rev_path: Path,
    output_xml_path: Path,
    args: argparse.Namespace,
    working_directory: Path,
) -> None:
    command = [
        str(python_executable), str(rev_to_xml_script),
        "--input", str(input_rev_path),
        "--output", str(output_xml_path),
        "--coord-factor", str(args.coord_factor),
        "--node-start", str(args.node_start),
        "--node-step", str(args.node_step),
        "--node-merge-tolerance", str(args.node_merge_tolerance),
    ]
    if _safe_text(args.source):
        command.extend(["--source", args.source])
    if _safe_text(args.purpose):
        command.extend(["--purpose", args.purpose])
    if _safe_text(args.title_line):
        command.extend(["--title-line", args.title_line])
    if args.enable_psi_rigid_logic:
        command.append("--enable-psi-rigid-logic")
    _run_process(command=command, working_directory=working_directory, stage_name="REV->XML")


@dataclass(frozen=True)
class SupportInfo:
    tag: str
    support_type: str
    source_text: str


def _local_name(tag: str) -> str:
    if tag.startswith("{"):
        return tag.split("}", 1)[1]
    return tag


def _namespace(tag: str) -> str:
    if tag.startswith("{"):
        return tag[1:].split("}", 1)[0]
    return ""


def _q(namespace: str, name: str) -> str:
    return f"{{{namespace}}}{name}" if namespace else name


def _child(parent: ET.Element, namespace: str, name: str) -> ET.Element | None:
    return parent.find(_q(namespace, name))


def _child_text(parent: ET.Element, namespace: str, name: str) -> str:
    element = _child(parent, namespace, name)
    return _safe_text(element.text if element is not None else "")


def _set_child_text(parent: ET.Element, namespace: str, name: str, value: str) -> None:
    element = _child(parent, namespace, name)
    if element is None:
        element = ET.SubElement(parent, _q(namespace, name))
    element.text = value


def _parse_attribute_blocks(attribute_text: str) -> list[dict[str, str]]:
    blocks: list[dict[str, str]] = []
    current: dict[str, str] | None = None
    whole_file: dict[str, str] = {}

    def add_line(target: dict[str, str], line: str) -> None:
        match = KEY_VALUE_RE.match(line)
        if not match:
            return
        key = match.group(1).upper().replace("-", "_")
        value = match.group(2).strip()
        if key in {"NEW", "END"}:
            return
        if value:
            target[key] = value

    for line in attribute_text.splitlines():
        token = line.strip()
        if not token:
            continue
        if re.match(r"^NEW(\s|$)", token, re.IGNORECASE):
            if current:
                blocks.append(current)
            current = {"__RAW__": line}
            add_line(current, token[3:].strip())
            continue
        if re.match(r"^END(\s|$)", token, re.IGNORECASE):
            if current:
                blocks.append(current)
                current = None
            continue
        if current is not None:
            current["__RAW__"] = f"{current.get('__RAW__', '')}\n{line}"
            add_line(current, line)
        add_line(whole_file, line)
    if current:
        blocks.append(current)
    if not blocks and whole_file:
        whole_file["__RAW__"] = attribute_text
        blocks.append(whole_file)
    return blocks


def _extract_ps_tag(block: dict[str, str]) -> str:
    for key in ("NAME", "TAG", "TAGNO", "TAG_NO", "REF", "REFNO", "DBREF", "SUPPORT", "SUPPORT_REF"):
        value = _safe_text(block.get(key))
        if not value:
            continue
        match = PS_TAG_RE.search(value)
        if match:
            return match.group(0).replace("_", "-").upper()
        if value.upper().startswith("PS"):
            return value.replace("_", "-").upper()
    match = PS_TAG_RE.search(block.get("__RAW__", ""))
    return match.group(0).replace("_", "-").upper() if match else ""


def _normalize_support_type(value: str) -> str:
    text = _safe_text(value).upper().replace("_", " ").replace("-", " ")
    text = re.sub(r"\s+", " ", text)
    if not text:
        return ""
    if "ANCHOR" in text or "FIXED" in text:
        return "ANCHOR"
    if "LINE STOP" in text or "LINESTOP" in text:
        return "LINESTOP"
    if "LIMIT" in text:
        return "LIMIT"
    if "GUIDE" in text:
        return "GUIDE"
    if "REST" in text or "SHOE" in text:
        return "REST"
    if re.search(r"\bSTOP\b", text):
        return "LINESTOP"
    return ""


def _extract_support_type(block: dict[str, str]) -> str:
    for key in ("DTXR", "STYP", "TYPE", "SKEY", "DESC", "DESCRIPTION", "LSTU"):
        support_type = _normalize_support_type(block.get(key, ""))
        if support_type:
            return support_type
    return _normalize_support_type(block.get("__RAW__", ""))


def _parse_support_infos(attribute_path: Path) -> list[SupportInfo]:
    text = attribute_path.read_text(encoding="utf-8", errors="replace")
    infos: list[SupportInfo] = []
    seen: set[tuple[str, str]] = set()
    for block in _parse_attribute_blocks(text):
        raw = block.get("__RAW__", "")
        if not (PS_TAG_RE.search(raw) or SUPPORT_WORD_RE.search(raw)):
            continue
        support_type = _extract_support_type(block)
        if not support_type:
            continue
        tag = _extract_ps_tag(block)
        if not tag:
            tag = f"SUPPORT-{len(infos) + 1}"
        key = (tag, support_type)
        if key in seen:
            continue
        seen.add(key)
        infos.append(SupportInfo(tag=tag, support_type=support_type, source_text=raw))
    return infos


def _split_types(value: str) -> list[str]:
    return [part.strip().upper() for part in re.split(r"[,/ ]+", _safe_text(value)) if part.strip()]


def _restraint_types_for_support(support_type: str, args: argparse.Namespace) -> list[str]:
    if support_type == "GUIDE":
        return _split_types(args.support_guide_types) or ["Y", "Z"]
    if support_type == "LINESTOP":
        return _split_types(args.support_linestop_types) or ["X"]
    if support_type == "LIMIT":
        return _split_types(args.support_limit_types) or ["X"]
    if support_type == "REST":
        return _split_types(args.support_rest_types) or ["Z"]
    if support_type == "ANCHOR":
        return ["A"]
    return []


def _gap_for_support(support_type: str, args: argparse.Namespace) -> str:
    specific = {
        "GUIDE": args.support_guide_gap,
        "LINESTOP": args.support_linestop_gap,
        "LIMIT": args.support_limit_gap,
        "REST": args.support_rest_gap,
        "ANCHOR": args.support_anchor_gap,
    }.get(support_type, "")
    return _safe_text(specific) if _safe_text(specific) else _safe_text(args.support_gap)


def _replace_restraints(node: ET.Element, namespace: str, support_type: str, args: argparse.Namespace) -> int:
    for restraint in list(node.findall(_q(namespace, "Restraint"))):
        node.remove(restraint)
    created = 0
    for restraint_type in _restraint_types_for_support(support_type, args):
        restraint = ET.SubElement(node, _q(namespace, "Restraint"))
        _set_child_text(restraint, namespace, "Type", restraint_type)
        _set_child_text(restraint, namespace, "Stiffness", _safe_text(args.support_stiffness))
        _set_child_text(restraint, namespace, "Gap", _gap_for_support(support_type, args))
        _set_child_text(restraint, namespace, "Friction", _safe_text(args.support_friction))
        created += 1
    return created


def _is_support_node(node: ET.Element, namespace: str) -> bool:
    component_type = _child_text(node, namespace, "ComponentType").upper()
    connection_type = _child_text(node, namespace, "ConnectionType").upper()
    node_name = _child_text(node, namespace, "NodeName")
    component_ref = _child_text(node, namespace, "ComponentRefNo")
    return (
        component_type in {"ATTA", "SUPPORT", "ANCI"}
        or _normalize_support_type(connection_type) != ""
        or PS_TAG_RE.search(node_name) is not None
        or PS_TAG_RE.search(component_ref) is not None
    )


def _enrich_supports_in_xml(xml_path: Path, attribute_path: Path | None, args: argparse.Namespace) -> tuple[int, int, int]:
    tree = ET.parse(xml_path)
    root = tree.getroot()
    namespace = _namespace(root.tag)
    if namespace:
        ET.register_namespace("", namespace)
    support_nodes = [node for node in root.iter() if _local_name(node.tag) == "Node" and _is_support_node(node, namespace)]
    support_infos = _parse_support_infos(attribute_path) if attribute_path is not None and attribute_path.exists() else []
    enriched = 0
    restraints = 0
    named = 0

    for index, node in enumerate(support_nodes):
        info = support_infos[index] if index < len(support_infos) else None
        support_type = info.support_type if info else _normalize_support_type(_child_text(node, namespace, "ConnectionType")) or "REST"
        if info and info.tag:
            _set_child_text(node, namespace, "NodeName", info.tag)
            _set_child_text(node, namespace, "ComponentRefNo", info.tag)
            named += 1
        _set_child_text(node, namespace, "ComponentType", "ATTA")
        _set_child_text(node, namespace, "ConnectionType", support_type)
        restraints += _replace_restraints(node, namespace, support_type, args)
        enriched += 1

    if enriched:
        if hasattr(ET, "indent"):
            ET.indent(tree, space="  ")
        tree.write(xml_path, encoding="utf-8", xml_declaration=True)
    return enriched, named, restraints


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Managed pipeline for RVM(+ATTR) -> REV -> XML.")
    parser.add_argument("--input", required=True, type=Path, help="Input RVM or REV path.")
    parser.add_argument("--output", required=True, type=Path, help="Output XML path.")
    parser.add_argument("--attributes", required=False, type=Path, default=None, help="Optional ATT/TXT sidecar file path for native RVM parsing.")
    parser.add_argument("--output-rev", required=False, type=Path, default=None, help="Optional destination to persist intermediate REV output.")
    parser.add_argument("--rvmparser-bin", required=False, type=Path, default=None, help="Optional explicit path to rvmparser-windows-bin.exe.")
    parser.add_argument("--python-exe", required=False, type=Path, default=Path(sys.executable), help="Python executable used for REV->XML stage.")
    parser.add_argument("--coord-factor", required=False, type=float, default=1000.0, help="REV->XML coord factor.")
    parser.add_argument("--node-start", required=False, type=int, default=10, help="REV->XML node start.")
    parser.add_argument("--node-step", required=False, type=int, default=10, help="REV->XML node step.")
    parser.add_argument("--node-merge-tolerance", required=False, type=float, default=0.5, help="REV->XML shared-node merge tolerance.")
    parser.add_argument("--source", required=False, type=str, default="AVEVA PSI", help="REV->XML source field.")
    parser.add_argument("--purpose", required=False, type=str, default="Preliminary stress run", help="REV->XML purpose field.")
    parser.add_argument("--title-line", required=False, type=str, default="PSI stress Output", help="REV->XML title line.")
    parser.add_argument("--enable-psi-rigid-logic", action="store_true", help="Enable PSI rigid-tagging heuristics in REV->XML stage.")

    parser.add_argument("--support-stiffness", required=False, type=str, default="", help="Support Restraint/Stiffness text; default blank.")
    parser.add_argument("--support-gap", required=False, type=str, default="", help="Fallback support Restraint/Gap text; default blank.")
    parser.add_argument("--support-guide-gap", required=False, type=str, default="", help="GUIDE restraint gap override.")
    parser.add_argument("--support-linestop-gap", required=False, type=str, default="", help="LINESTOP restraint gap override.")
    parser.add_argument("--support-limit-gap", required=False, type=str, default="", help="LIMIT restraint gap override.")
    parser.add_argument("--support-rest-gap", required=False, type=str, default="", help="REST restraint gap override.")
    parser.add_argument("--support-anchor-gap", required=False, type=str, default="", help="ANCHOR restraint gap override.")
    parser.add_argument("--support-friction", required=False, type=str, default="0.3", help="Support Restraint/Friction text; default 0.3.")
    parser.add_argument("--support-guide-types", required=False, type=str, default="Y,Z", help="GUIDE restraint types, comma separated.")
    parser.add_argument("--support-linestop-types", required=False, type=str, default="X", help="LINESTOP restraint types, comma separated.")
    parser.add_argument("--support-limit-types", required=False, type=str, default="X", help="LIMIT restraint types, comma separated.")
    parser.add_argument("--support-rest-types", required=False, type=str, default="Z", help="REST restraint types, comma separated.")
    return parser


def main() -> int:
    args = _build_parser().parse_args()
    input_path = args.input.resolve()
    output_xml_path = args.output.resolve()
    output_rev_path = args.output_rev.resolve() if args.output_rev is not None else None
    original_attributes_path = args.attributes.resolve() if args.attributes is not None else None
    parser_executable = _resolve_rvmparser_binary(args.rvmparser_bin.resolve() if args.rvmparser_bin is not None else None)
    python_executable = args.python_exe.resolve()
    scripts_dir = Path(__file__).resolve().parent
    rev_to_xml_script = scripts_dir / "rev_to_xml.py"
    if not rev_to_xml_script.exists():
        raise FileNotFoundError(f"Missing script: {rev_to_xml_script}")

    _ensure_parent(output_xml_path)
    if output_rev_path is not None:
        _ensure_parent(output_rev_path)
    stem = output_xml_path.stem or "managed"

    with tempfile.TemporaryDirectory(prefix="rvm-managed-xml-") as temp_dir_text:
        temp_dir = Path(temp_dir_text)
        temp_rev = temp_dir / f"{stem}_managed.rev"
        temp_xml = temp_dir / f"{stem}_managed.xml"
        enrichment_attributes_path: Path | None = None

        if original_attributes_path is not None:
            enrichment_attributes_path = _resolve_attribute_sidecar(original_attributes_path, temp_dir)

        if _is_rev_like_file(input_path):
            temp_rev.write_text(_normalize_newlines(input_path.read_text(encoding="utf-8", errors="strict")), encoding="utf-8")
            print(f"[RVM->REV] Input already REV-like; native parser stage skipped: {input_path}")
        else:
            _run_native_rvm_to_rev(
                parser_executable=parser_executable,
                input_path=input_path,
                output_rev_path=temp_rev,
                attributes_path=enrichment_attributes_path,
                working_directory=temp_dir,
            )

        _run_rev_to_xml(
            python_executable=python_executable,
            rev_to_xml_script=rev_to_xml_script,
            input_rev_path=temp_rev,
            output_xml_path=temp_xml,
            args=args,
            working_directory=temp_dir,
        )

        enriched, named, restraints = _enrich_supports_in_xml(
            xml_path=temp_xml,
            attribute_path=enrichment_attributes_path,
            args=args,
        )
        print(f"[ATTR->XML] Support enrichment: support_nodes={enriched}, ps_names_applied={named}, restraints_written={restraints}.")

        shutil.copy2(temp_xml, output_xml_path)
        if output_rev_path is not None:
            shutil.copy2(temp_rev, output_rev_path)

    print(f"Wrote XML output: {output_xml_path}")
    if output_rev_path is not None:
        print(f"Wrote intermediate REV: {output_rev_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
