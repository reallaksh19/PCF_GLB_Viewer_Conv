#!/usr/bin/env python3
"""
Managed native conversion pipeline: RVM(+ATTR) -> REV -> XML.

Functionality:
- Stage 1 (managed REV stage):
  - If input is REV-like text, normalize and use directly.
  - Otherwise invoke native `rvmparser-windows-bin.exe` with optional sidecar.
- Stage 2: invoke `rev_to_xml.py`.

Parameters expected:
- --input: input RVM or REV path.
- --output: destination XML path.
- --attributes: optional ATT/TXT or ZIP sidecar path.
- --output-rev: optional persisted managed REV path.

Outputs passed:
- Writes XML to --output.
- Writes optional managed REV artifact when --output-rev is provided.
"""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
import zipfile


def _safe_text(value: str | None) -> str:
    if value is None:
        return ""
    return value.strip()


def _normalize_newlines(text: str) -> str:
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    if not normalized.endswith("\n"):
        normalized = f"{normalized}\n"
    return normalized


def _looks_like_rev_text(text: str) -> bool:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if not lines:
        return False
    head = set(lines[:120])
    has_head = "HEAD" in head
    has_modl = "MODL" in head
    has_end = any(line.startswith("END:") for line in lines)
    return has_head and has_modl and has_end


def _is_rev_like_file(path: Path) -> bool:
    try:
        data = path.read_bytes()
    except OSError:
        return False
    try:
        decoded = data.decode("utf-8")
    except UnicodeDecodeError:
        return False
    return _looks_like_rev_text(decoded)


def _resolve_rvmparser_binary(explicit: Path | None) -> Path:
    candidates: list[Path] = []
    if explicit is not None:
        candidates.append(explicit)

    script_dir = Path(__file__).resolve().parent
    repo_root = script_dir.parent.parent.parent
    candidates.extend(
        [
            repo_root / "tools" / "rvmparser-windows-bin.exe",
            Path("C:/Code3/rvmparser/rvmparser-windows-bin.exe"),
            Path("C:/Code3/PCF_GLB_Viewer_Conv/tools/rvmparser-windows-bin.exe"),
        ]
    )

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


def _ensure_parent(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


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
    lines = text.splitlines()
    repaired_lines: list[str] = []
    depth = 0
    dropped_end_lines = 0

    for line in lines:
        token = line.strip()
        if re.match(r"^NEW(\s|$)", token):
            depth += 1
            repaired_lines.append(line)
            continue
        if re.match(r"^END(\s|$)", token):
            if depth <= 0:
                dropped_end_lines += 1
                continue
            depth -= 1
            repaired_lines.append(line)
            continue
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
        _run_process(
            command=command + [str(attributes_path)],
            working_directory=working_directory,
            stage_name="RVM->REV",
        )
        return
    except RuntimeError as error:
        if not _is_sidecar_parse_error(str(error)):
            raise
        print("[RVM->REV] Sidecar parse error detected. Attempting sanitized attribute retry.")

    repaired_path = working_directory / f"{attributes_path.stem}_repaired{attributes_path.suffix}"
    dropped_end_lines, appended_end_lines = _repair_attribute_end_balance(
        attributes_path=attributes_path,
        repaired_path=repaired_path,
    )
    print(
        "[RVM->REV] Attribute repair summary: "
        f"dropped_unmatched_end={dropped_end_lines}, appended_missing_end={appended_end_lines}."
    )

    try:
        _run_process(
            command=command + [str(repaired_path)],
            working_directory=working_directory,
            stage_name="RVM->REV(repaired-attr)",
        )
        return
    except RuntimeError as error:
        if not _is_sidecar_parse_error(str(error)):
            raise
        print("[RVM->REV] Repaired sidecar still failed. Retrying without sidecar attributes.")

    _run_process(
        command=command,
        working_directory=working_directory,
        stage_name="RVM->REV(no-attr-fallback)",
    )


def _resolve_attribute_sidecar(attributes_path: Path, extraction_directory: Path) -> Path:
    suffix = attributes_path.suffix.lower()
    if suffix != ".zip":
        return attributes_path

    with zipfile.ZipFile(attributes_path, "r") as archive:
        members = archive.infolist()
        if not members:
            raise ValueError(f"Attribute archive is empty: {attributes_path}")

        att_candidates = [member for member in members if member.filename.lower().endswith(".att")]
        txt_candidates = [member for member in members if member.filename.lower().endswith(".txt")]
        selected_member = None
        if att_candidates:
            selected_member = sorted(att_candidates, key=lambda member: member.filename.lower())[0]
        elif txt_candidates:
            selected_member = sorted(txt_candidates, key=lambda member: member.filename.lower())[0]

        if selected_member is None:
            raise ValueError(
                "Attribute ZIP does not contain .att or .txt sidecar: "
                f"{attributes_path}"
            )

        extracted_name = Path(selected_member.filename).name
        target_path = extraction_directory / extracted_name
        with archive.open(selected_member, "r") as source_stream:
            target_path.write_bytes(source_stream.read())
        print(f"[RVM->REV] Extracted attribute sidecar from ZIP: {selected_member.filename}")
        return target_path


def _run_rev_to_xml(
    python_executable: Path,
    rev_to_xml_script: Path,
    input_rev_path: Path,
    output_xml_path: Path,
    args: argparse.Namespace,
    working_directory: Path,
) -> None:
    command: list[str] = [
        str(python_executable),
        str(rev_to_xml_script),
        "--input",
        str(input_rev_path),
        "--output",
        str(output_xml_path),
        "--coord-factor",
        str(args.coord_factor),
        "--node-start",
        str(args.node_start),
        "--node-step",
        str(args.node_step),
        "--node-merge-tolerance",
        str(args.node_merge_tolerance),
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


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Managed pipeline for RVM(+ATTR) -> REV -> XML."
    )
    parser.add_argument("--input", required=True, type=Path, help="Input RVM or REV path.")
    parser.add_argument("--output", required=True, type=Path, help="Output XML path.")
    parser.add_argument(
        "--attributes",
        required=False,
        type=Path,
        default=None,
        help="Optional ATT/TXT sidecar file path for native RVM parsing.",
    )
    parser.add_argument(
        "--output-rev",
        required=False,
        type=Path,
        default=None,
        help="Optional destination to persist intermediate REV output.",
    )
    parser.add_argument(
        "--rvmparser-bin",
        required=False,
        type=Path,
        default=None,
        help="Optional explicit path to rvmparser-windows-bin.exe.",
    )
    parser.add_argument(
        "--python-exe",
        required=False,
        type=Path,
        default=Path(sys.executable),
        help="Python executable used for REV->XML stage.",
    )

    parser.add_argument("--coord-factor", required=False, type=float, default=1000.0, help="REV->XML coord factor.")
    parser.add_argument("--node-start", required=False, type=int, default=10, help="REV->XML node start.")
    parser.add_argument("--node-step", required=False, type=int, default=10, help="REV->XML node step.")
    parser.add_argument(
        "--node-merge-tolerance",
        required=False,
        type=float,
        default=0.5,
        help="REV->XML shared-node merge tolerance.",
    )
    parser.add_argument("--source", required=False, type=str, default="AVEVA PSI", help="REV->XML source field.")
    parser.add_argument(
        "--purpose",
        required=False,
        type=str,
        default="Preliminary stress run",
        help="REV->XML purpose field.",
    )
    parser.add_argument(
        "--title-line",
        required=False,
        type=str,
        default="PSI stress Output",
        help="REV->XML title line.",
    )
    parser.add_argument(
        "--enable-psi-rigid-logic",
        action="store_true",
        help="Enable PSI rigid-tagging heuristics in REV->XML stage.",
    )
    return parser


def main() -> int:
    parser = _build_parser()
    args = parser.parse_args()

    input_path = args.input.resolve()
    output_xml_path = args.output.resolve()
    output_rev_path = args.output_rev.resolve() if args.output_rev is not None else None
    attributes_path = args.attributes.resolve() if args.attributes is not None else None
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

        if _is_rev_like_file(input_path):
            normalized_text = _normalize_newlines(input_path.read_text(encoding="utf-8", errors="strict"))
            temp_rev.write_text(normalized_text, encoding="utf-8")
            print(f"[RVM->REV] Input already REV-like; native parser stage skipped: {input_path}")
        else:
            native_attributes_path = None
            if attributes_path is not None:
                native_attributes_path = _resolve_attribute_sidecar(attributes_path, temp_dir)
            _run_native_rvm_to_rev(
                parser_executable=parser_executable,
                input_path=input_path,
                output_rev_path=temp_rev,
                attributes_path=native_attributes_path,
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

        shutil.copy2(temp_xml, output_xml_path)
        if output_rev_path is not None:
            shutil.copy2(temp_rev, output_rev_path)

    print(f"Wrote XML output: {output_xml_path}")
    if output_rev_path is not None:
        print(f"Wrote intermediate REV: {output_rev_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
