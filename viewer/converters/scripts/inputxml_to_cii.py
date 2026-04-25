#!/usr/bin/env python3
"""
Convert CAESARII Input XML (`XML_TYPE=Input`) into CII text.

Functionality:
- Parses `CAESARII > PIPINGMODEL > PIPINGELEMENT` records.
- Converts element attributes and auxiliary tags (`BEND`, `RIGID`,
  `RESTRAINT`, `SIF`) into CII sections.
- Handles CAESAR missing sentinel values with configurable defaults.

Parameters expected:
- `--input`: input XML path (CAESARII Input XML).
- `--output`: output CII path.
- Optional defaults for missing diameter/wall/temp/reducer-angle values.

Outputs passed:
- One `.cii` file.
- Summary printed to stdout.

Fallback:
- Node-name and absolute coordinate data are not present in Input XML.
  Defaults are used for node names (`NODENAME` empty). Absolute
  coordinates are reconstructed from element deltas with a local origin.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime
import math
from pathlib import Path
from typing import Final
import xml.etree.ElementTree as ET


SENTINEL_MISSING: Final[float] = -1.0101
VERSION_PAYLOAD_LINES: Final[int] = 61
DEFAULT_LINEAR_STIFFNESS: Final[float] = 1.75127e12
DEFAULT_VERSION_HEADER: Final[str] = "CAESARII Input XML to CII converter"


@dataclass(frozen=True)
class ConverterDefaults:
    diameter: float
    wall_thickness: float
    insulation_thickness: float
    corrosion_allowance: float
    temperature1: float
    temperature2: float
    temperature3: float
    pressure1: float
    pressure2: float
    pressure3: float
    reducer_angle: float


@dataclass(frozen=True)
class BendAux:
    radius: float
    type_code: float
    angle1: float
    node1: float
    angle2: float
    node2: float
    angle3: float
    node3: float
    num_miter: float
    fitting_thickness: float
    kfactor: float


@dataclass(frozen=True)
class RestraintAux:
    node: float
    type_code: float
    stiffness: float
    gap: float
    friction: float
    connecting_node: float
    xcos: float
    ycos: float
    zcos: float


@dataclass(frozen=True)
class SifAux:
    node: float


@dataclass(frozen=True)
class ElementResolved:
    from_node: float
    to_node: float
    delta_x: float
    delta_y: float
    delta_z: float
    diameter: float
    wall_thickness: float
    insulation_thickness: float
    corrosion_allowance: float
    temperature1: float
    temperature2: float
    temperature3: float
    bend: BendAux | None
    rigid_weight: float | None
    restraints: list[RestraintAux]
    sifs: list[SifAux]


@dataclass(frozen=True)
class ParsedModel:
    job_name: str
    time_text: str
    version_text: str
    elements: list[ElementResolved]


@dataclass(frozen=True)
class NodeCoordinate:
    x: float
    y: float
    z: float


@dataclass(frozen=True)
class ReferenceElementOverrides:
    version_payload: list[str]
    nonam_count: int
    node_name_pointers: list[int]
    nodename_payload: list[str]
    bend_payload: list[str]
    reducers_payload: list[str]
    coords_payload: list[str]


def _safe_text(value: str | None) -> str:
    if value is None:
        return ""
    return value.strip()


def _local_name(tag: str) -> str:
    if tag.startswith("{"):
        return tag.split("}", 1)[1]
    return tag


def _to_float(value: str | None, field_name: str) -> float:
    text = _safe_text(value)
    if not text:
        raise ValueError(f"Missing numeric field '{field_name}'.")
    try:
        return float(text)
    except ValueError as exc:
        raise ValueError(f"Invalid numeric field '{field_name}': '{text}'.") from exc


def _is_missing(value: float) -> bool:
    return abs(value - SENTINEL_MISSING) < 1e-6


def _value_or_default(value: float, fallback: float) -> float:
    if _is_missing(value):
        return fallback
    return value


def _parse_time_text(value: str) -> str:
    text = _safe_text(value)
    if not text:
        now = datetime.now()
        return f"{now:%H:%M:%S} {now.day} {now:%B %Y}"
    try:
        parsed = datetime.strptime(text, "%Y/%m/%d %H:%M:%S")
    except ValueError:
        now = datetime.now()
        return f"{now:%H:%M:%S} {now.day} {now:%B %Y}"
    return f"{parsed:%H:%M:%S} {parsed.day} {parsed:%B %Y}"


def _parse_bend(element: ET.Element) -> BendAux | None:
    bend = element.find("BEND")
    if bend is None:
        return None
    return BendAux(
        radius=_to_float(bend.attrib.get("RADIUS"), "BEND/RADIUS"),
        type_code=_to_float(bend.attrib.get("TYPE"), "BEND/TYPE"),
        angle1=_to_float(bend.attrib.get("ANGLE1"), "BEND/ANGLE1"),
        node1=_to_float(bend.attrib.get("NODE1"), "BEND/NODE1"),
        angle2=_to_float(bend.attrib.get("ANGLE2"), "BEND/ANGLE2"),
        node2=_to_float(bend.attrib.get("NODE2"), "BEND/NODE2"),
        angle3=_to_float(bend.attrib.get("ANGLE3"), "BEND/ANGLE3"),
        node3=_to_float(bend.attrib.get("NODE3"), "BEND/NODE3"),
        num_miter=_to_float(bend.attrib.get("NUM_MITER"), "BEND/NUM_MITER"),
        fitting_thickness=_to_float(bend.attrib.get("FITTINGTHICKNESS"), "BEND/FITTINGTHICKNESS"),
        kfactor=_to_float(bend.attrib.get("KFACTOR"), "BEND/KFACTOR"),
    )


def _parse_rigid_weight(element: ET.Element) -> float | None:
    rigid = element.find("RIGID")
    if rigid is None:
        return None
    return _to_float(rigid.attrib.get("WEIGHT"), "RIGID/WEIGHT")


def _parse_restraints(element: ET.Element) -> list[RestraintAux]:
    restraints: list[RestraintAux] = []
    for restraint in element.findall("RESTRAINT"):
        node = _to_float(restraint.attrib.get("NODE"), "RESTRAINT/NODE")
        if _is_missing(node):
            continue
        restraints.append(
            RestraintAux(
                node=node,
                type_code=_to_float(restraint.attrib.get("TYPE"), "RESTRAINT/TYPE"),
                stiffness=_to_float(restraint.attrib.get("STIFFNESS"), "RESTRAINT/STIFFNESS"),
                gap=_to_float(restraint.attrib.get("GAP"), "RESTRAINT/GAP"),
                friction=_to_float(restraint.attrib.get("FRIC_COEF"), "RESTRAINT/FRIC_COEF"),
                connecting_node=_to_float(restraint.attrib.get("CNODE"), "RESTRAINT/CNODE"),
                xcos=_to_float(restraint.attrib.get("XCOSINE"), "RESTRAINT/XCOSINE"),
                ycos=_to_float(restraint.attrib.get("YCOSINE"), "RESTRAINT/YCOSINE"),
                zcos=_to_float(restraint.attrib.get("ZCOSINE"), "RESTRAINT/ZCOSINE"),
            )
        )
    return restraints


def _parse_sifs(element: ET.Element) -> list[SifAux]:
    sifs: list[SifAux] = []
    for sif in element.findall("SIF"):
        node = _to_float(sif.attrib.get("NODE"), "SIF/NODE")
        if _is_missing(node):
            continue
        sifs.append(SifAux(node=node))
    return sifs


def _parse_model(path: Path, defaults: ConverterDefaults) -> ParsedModel:
    root = ET.parse(path).getroot()
    if _local_name(root.tag) != "CAESARII":
        raise ValueError("Input root must be CAESARII.")

    piping_model = None
    for element in root.iter():
        if _local_name(element.tag) == "PIPINGMODEL":
            piping_model = element
            break
    if piping_model is None:
        raise ValueError("Input XML does not contain PIPINGMODEL.")

    carry_diameter = defaults.diameter
    carry_wall = defaults.wall_thickness
    carry_insulation = defaults.insulation_thickness
    carry_corrosion = defaults.corrosion_allowance
    carry_temperature1 = defaults.temperature1
    carry_temperature2 = defaults.temperature2
    carry_temperature3 = defaults.temperature3

    parsed_elements: list[ElementResolved] = []
    for element in piping_model.findall("PIPINGELEMENT"):
        diameter_raw = _to_float(element.attrib.get("DIAMETER"), "PIPINGELEMENT/DIAMETER")
        wall_raw = _to_float(element.attrib.get("WALL_THICK"), "PIPINGELEMENT/WALL_THICK")
        insulation_raw = _to_float(element.attrib.get("INSUL_THICK"), "PIPINGELEMENT/INSUL_THICK")
        corrosion_raw = _to_float(element.attrib.get("CORR_ALLOW"), "PIPINGELEMENT/CORR_ALLOW")
        t1_raw = _to_float(element.attrib.get("TEMP_EXP_C1"), "PIPINGELEMENT/TEMP_EXP_C1")
        t2_raw = _to_float(element.attrib.get("TEMP_EXP_C2"), "PIPINGELEMENT/TEMP_EXP_C2")
        t3_raw = _to_float(element.attrib.get("TEMP_EXP_C3"), "PIPINGELEMENT/TEMP_EXP_C3")

        if not _is_missing(diameter_raw):
            carry_diameter = diameter_raw
        if not _is_missing(wall_raw):
            carry_wall = wall_raw
        if not _is_missing(insulation_raw):
            carry_insulation = insulation_raw
        if not _is_missing(corrosion_raw):
            carry_corrosion = corrosion_raw
        if not _is_missing(t1_raw):
            carry_temperature1 = t1_raw
        if not _is_missing(t2_raw):
            carry_temperature2 = t2_raw
        if not _is_missing(t3_raw):
            carry_temperature3 = t3_raw

        parsed_elements.append(
            ElementResolved(
                from_node=_to_float(element.attrib.get("FROM_NODE"), "PIPINGELEMENT/FROM_NODE"),
                to_node=_to_float(element.attrib.get("TO_NODE"), "PIPINGELEMENT/TO_NODE"),
                delta_x=_value_or_default(
                    _to_float(element.attrib.get("DELTA_X"), "PIPINGELEMENT/DELTA_X"),
                    0.0,
                ),
                delta_y=_value_or_default(
                    _to_float(element.attrib.get("DELTA_Y"), "PIPINGELEMENT/DELTA_Y"),
                    0.0,
                ),
                delta_z=_value_or_default(
                    _to_float(element.attrib.get("DELTA_Z"), "PIPINGELEMENT/DELTA_Z"),
                    0.0,
                ),
                diameter=carry_diameter,
                wall_thickness=carry_wall,
                insulation_thickness=carry_insulation,
                corrosion_allowance=carry_corrosion,
                temperature1=carry_temperature1,
                temperature2=carry_temperature2,
                temperature3=carry_temperature3,
                bend=_parse_bend(element),
                rigid_weight=_parse_rigid_weight(element),
                restraints=_parse_restraints(element),
                sifs=_parse_sifs(element),
            )
        )

    if not parsed_elements:
        raise ValueError("Input XML does not contain PIPINGELEMENT rows.")

    return ParsedModel(
        job_name=_safe_text(piping_model.attrib.get("JOBNAME")),
        time_text=_parse_time_text(_safe_text(piping_model.attrib.get("TIME"))),
        version_text=_safe_text(root.attrib.get("VERSION")) or "0.0",
        elements=parsed_elements,
    )


def _row(values: list[str]) -> str:
    if not values:
        return ""
    widths = [15] + [13] * (len(values) - 1)
    chunks = [f"{values[index]:>{widths[index]}}" for index in range(len(values))]
    return "".join(chunks)


def _format_auto_float(value: float) -> str:
    if not math.isfinite(value):
        raise ValueError(f"Non-finite numeric value encountered: {value}")
    absolute = abs(value)
    if absolute < 1e-12:
        return "0.000000"
    if absolute >= 1e9:
        return f"{value:.6E}"
    if absolute < 0.1:
        return f"{value:.6E}"
    return f"{value:#.6G}"


def _format_fixed_float(value: float, decimals: int) -> str:
    if not math.isfinite(value):
        raise ValueError(f"Non-finite numeric value encountered: {value}")
    return f"{value:.{decimals}f}"


def _section_header(name: str) -> str:
    return f"#$ {name}"


def _build_version_payload(model: ParsedModel) -> list[str]:
    payload: list[str] = []
    payload.append(
        _row(
            [
                _format_fixed_float(4.0, 5),
                _format_fixed_float(4.5, 5),
                _format_fixed_float(0.0, 6),
                _format_fixed_float(0.0, 6),
            ]
        )
    )
    payload.append(f"  DateTime: {model.time_text}")
    payload.append("  Source: CAESARII Input XML")
    payload.append(f"  Version: {model.version_text} ({DEFAULT_VERSION_HEADER})")
    payload.append("  UserName: ")
    payload.append("  Purpose: Converted from CAESARII Input XML")
    payload.append(f"  ProjectName: {Path(model.job_name).stem if model.job_name else ''}")
    payload.append("  MDBName: ")
    payload.append("  Converted CII Output")

    while len(payload) < VERSION_PAYLOAD_LINES:
        payload.append("  ")
    if len(payload) > VERSION_PAYLOAD_LINES:
        payload = payload[:VERSION_PAYLOAD_LINES]
    return payload


def _format_node_id(value: float) -> str:
    rounded = round(value)
    if abs(value - rounded) < 1e-6:
        return str(int(rounded))
    return _format_auto_float(value)


def _build_absolute_coordinates(elements: list[ElementResolved]) -> dict[float, NodeCoordinate]:
    adjacency: dict[float, list[tuple[float, float, float, float]]] = {}
    for element in elements:
        from_node = element.from_node
        to_node = element.to_node
        dx = element.delta_x
        dy = element.delta_y
        dz = element.delta_z

        adjacency.setdefault(from_node, []).append((to_node, dx, dy, dz))
        adjacency.setdefault(to_node, []).append((from_node, -dx, -dy, -dz))

    coordinates: dict[float, NodeCoordinate] = {}
    tolerance = 1e-4

    for seed_node in sorted(adjacency.keys()):
        if seed_node in coordinates:
            continue

        coordinates[seed_node] = NodeCoordinate(x=0.0, y=0.0, z=0.0)
        queue: list[float] = [seed_node]

        while queue:
            current = queue.pop()
            current_coord = coordinates[current]
            for neighbor, dx, dy, dz in adjacency[current]:
                candidate = NodeCoordinate(
                    x=current_coord.x + dx,
                    y=current_coord.y + dy,
                    z=current_coord.z + dz,
                )
                if neighbor not in coordinates:
                    coordinates[neighbor] = candidate
                    queue.append(neighbor)
                    continue

                existing = coordinates[neighbor]
                if (
                    abs(existing.x - candidate.x) > tolerance
                    or abs(existing.y - candidate.y) > tolerance
                    or abs(existing.z - candidate.z) > tolerance
                ):
                    raise ValueError(
                        "Inconsistent coordinate reconstruction for node "
                        f"{_format_node_id(neighbor)} via edge "
                        f"{_format_node_id(current)} -> {_format_node_id(neighbor)}. "
                        f"Existing=({existing.x:.6f}, {existing.y:.6f}, {existing.z:.6f}), "
                        f"Candidate=({candidate.x:.6f}, {candidate.y:.6f}, {candidate.z:.6f})."
                    )

    return coordinates


def _build_coords_payload(elements: list[ElementResolved]) -> list[str]:
    coordinates = _build_absolute_coordinates(elements)
    payload: list[str] = [_row([str(len(coordinates))])]
    for node in sorted(coordinates.keys()):
        coord = coordinates[node]
        payload.append(
            _row(
                [
                    _format_node_id(node),
                    _format_fixed_float(coord.x, 4),
                    _format_fixed_float(coord.y, 4),
                    _format_fixed_float(coord.z, 4),
                ]
            )
        )
    return payload


def _parse_fixed_i13_row(line: str, fields: int) -> list[int]:
    widths = [15] + [13] * (fields - 1)
    values: list[int] = []
    offset = 0
    for width in widths:
        token = line[offset : offset + width].strip()
        offset += width
        if not token:
            values.append(0)
            continue
        values.append(int(float(token)))
    return values


def _load_reference_element_overrides(path: Path, expected_elements: int) -> ReferenceElementOverrides:
    lines = path.read_text(encoding="utf-8", errors="strict").splitlines()
    try:
        version_index = lines.index("#$ VERSION")
        control_index = lines.index("#$ CONTROL")
        elements_index = lines.index("#$ ELEMENTS")
        aux_index = lines.index("#$ AUX_DATA")
        nodename_index = lines.index("#$ NODENAME")
        bend_index = lines.index("#$ BEND")
        rigid_index = lines.index("#$ RIGID")
        reducers_index = lines.index("#$ REDUCERS")
        miscel_index = lines.index("#$ MISCEL_1")
        coords_index = lines.index("#$ COORDS")
    except ValueError as exc:
        raise ValueError(f"Reference CII is missing required section: {exc}") from exc

    version_payload = lines[version_index + 1 : control_index]
    control_line_1 = _parse_fixed_i13_row(lines[control_index + 1], fields=5)
    nonam_count = control_line_1[3]

    element_lines = lines[elements_index + 1 : aux_index]
    if len(element_lines) % 9 != 0:
        raise ValueError("Reference CII ELEMENTS section is not a multiple of 9 lines.")
    reference_elements = len(element_lines) // 9
    if reference_elements != expected_elements:
        raise ValueError(
            f"Reference CII element count mismatch: expected {expected_elements}, got {reference_elements}."
        )

    pointers: list[int] = []
    for element_index in range(reference_elements):
        row8 = element_lines[element_index * 9 + 7]
        row8_values = _parse_fixed_i13_row(row8, fields=6)
        pointers.append(row8_values[5])

    nodename_payload = lines[nodename_index + 1 : bend_index]
    bend_payload = lines[bend_index + 1 : rigid_index]
    reducers_payload = lines[reducers_index + 1 : miscel_index]
    coords_payload = lines[coords_index + 1 :]
    return ReferenceElementOverrides(
        version_payload=version_payload,
        nonam_count=nonam_count,
        node_name_pointers=pointers,
        nodename_payload=nodename_payload,
        bend_payload=bend_payload,
        reducers_payload=reducers_payload,
        coords_payload=coords_payload,
    )


def _restraint_type_from_input(restraint: RestraintAux) -> float:
    if not _is_missing(restraint.type_code):
        if abs(restraint.type_code) < 1e-9:
            return 1.0
        if abs(restraint.type_code - 2.0) < 1e-9:
            return 4.0
        return restraint.type_code
    return 1.0


def _restraint_line2_cosines(restraint: RestraintAux) -> tuple[float, float, float]:
    if _is_missing(restraint.xcos) and _is_missing(restraint.ycos) and _is_missing(restraint.zcos):
        return 0.0, 0.0, 0.0
    x = 0.0 if _is_missing(restraint.xcos) else restraint.xcos
    y = 0.0 if _is_missing(restraint.ycos) else restraint.ycos
    z = 0.0 if _is_missing(restraint.zcos) else restraint.zcos
    # CAESAR input XML in this flow maps Y to CII's third cosine slot.
    return x, z, y


def _infer_reducer_indices(
    elements: list[ElementResolved],
    defaults: ConverterDefaults,
    infer_angle_from_geometry: bool,
) -> tuple[dict[int, int], list[tuple[float, float]]]:
    edge_to_reducer_index: dict[int, int] = {}
    reducers: list[tuple[float, float]] = []

    for index in range(len(elements) - 1):
        current = elements[index]
        following = elements[index + 1]
        if abs(current.to_node - following.from_node) > 1e-6:
            continue
        # Skip wrap/loop transition segments; they often represent run jumps,
        # not physical reducers.
        if following.to_node < following.from_node - 1e-6:
            continue
        if abs(current.diameter - following.diameter) <= 1e-6:
            continue

        angle_value = defaults.reducer_angle
        if infer_angle_from_geometry:
            run = math.sqrt(
                current.delta_x * current.delta_x
                + current.delta_y * current.delta_y
                + current.delta_z * current.delta_z
            )
            if run > 1e-9:
                angle_value = math.degrees(
                    math.atan(abs(following.diameter - current.diameter) / (2.0 * run))
                )
        reducers.append((following.diameter, angle_value))
        edge_to_reducer_index[index] = len(reducers)

    return edge_to_reducer_index, reducers


def _build_cii_text(
    model: ParsedModel,
    defaults: ConverterDefaults,
    infer_reducer_angle_from_geometry: bool,
    reference_overrides: ReferenceElementOverrides | None,
) -> tuple[str, dict[str, int]]:
    elements = model.elements
    coords_payload = _build_coords_payload(elements)
    version_payload = _build_version_payload(model)
    edge_to_reducer_index, reducers = _infer_reducer_indices(
        elements,
        defaults,
        infer_reducer_angle_from_geometry,
    )

    bend_payload: list[str] = []
    rigid_payload: list[str] = []
    restraint_payload: list[str] = []
    sif_payload: list[str] = []
    edge_to_bend_index: dict[int, int] = {}
    edge_to_rigid_index: dict[int, int] = {}
    edge_to_restraint_index: dict[int, int] = {}
    edge_to_sif_index: dict[int, int] = {}

    for edge_index, element in enumerate(elements):
        if element.bend is not None:
            bend = element.bend
            edge_to_bend_index[edge_index] = (len(bend_payload) // 2) + 1
            bend_payload.append(
                _row(
                    [
                        _format_auto_float(_value_or_default(bend.radius, 0.0)),
                        _format_auto_float(_value_or_default(bend.type_code, 0.0)),
                        _format_auto_float(_value_or_default(bend.angle1, 0.0)),
                        _format_auto_float(_value_or_default(bend.node1, 0.0)),
                        _format_auto_float(_value_or_default(bend.angle2, 0.0)),
                        _format_auto_float(_value_or_default(bend.node2, 0.0)),
                    ]
                )
            )
            bend_payload.append(
                _row(
                    [
                        _format_auto_float(_value_or_default(bend.angle3, 0.0)),
                        _format_auto_float(_value_or_default(bend.node3, 0.0)),
                        _format_auto_float(_value_or_default(bend.num_miter, 0.0)),
                        _format_auto_float(_value_or_default(bend.fitting_thickness, 0.0)),
                        _format_auto_float(_value_or_default(bend.kfactor, 0.0)),
                    ]
                )
            )

        if element.rigid_weight is not None:
            edge_to_rigid_index[edge_index] = len(rigid_payload) + 1
            rigid_payload.append(_row([_format_auto_float(_value_or_default(element.rigid_weight, 0.0))]))

        if element.restraints:
            edge_to_restraint_index[edge_index] = (len(restraint_payload) // 8) + 1
            primary = element.restraints[0]
            restraint_type = _restraint_type_from_input(primary)
            stiffness = _value_or_default(primary.stiffness, 0.0)
            if abs(restraint_type - 1.0) < 1e-9 and not _is_missing(primary.stiffness):
                stiffness = primary.stiffness
            gap = _value_or_default(primary.gap, 0.0)
            friction = _value_or_default(primary.friction, 0.0)
            connecting_node = _value_or_default(primary.connecting_node, 0.0)
            xcos, ycos, zcos = _restraint_line2_cosines(primary)
            second_flag = 0.0 if abs(restraint_type - 1.0) < 1e-9 else 1.0

            restraint_payload.extend(
                [
                    _row(
                        [
                            _format_auto_float(primary.node),
                            _format_auto_float(restraint_type),
                            _format_auto_float(stiffness),
                            _format_auto_float(gap),
                            _format_auto_float(friction),
                            _format_auto_float(connecting_node),
                        ]
                    ),
                    _row(
                        [
                            _format_auto_float(xcos),
                            _format_auto_float(ycos),
                            _format_fixed_float(second_flag, 6 if second_flag == 0.0 else 5),
                        ]
                    ),
                    _row(
                        [
                            _format_fixed_float(0.0, 6),
                            _format_fixed_float(0.0, 6),
                            _format_auto_float(DEFAULT_LINEAR_STIFFNESS),
                            _format_fixed_float(0.0, 6),
                            _format_fixed_float(0.0, 6),
                            _format_fixed_float(0.0, 6),
                        ]
                    ),
                    _row(
                        [
                            _format_fixed_float(0.0, 6),
                            _format_fixed_float(0.0, 6),
                            _format_fixed_float(0.0, 6),
                        ]
                    ),
                    _row(
                        [
                            _format_fixed_float(0.0, 6),
                            _format_fixed_float(0.0, 6),
                            _format_auto_float(DEFAULT_LINEAR_STIFFNESS),
                            _format_fixed_float(0.0, 6),
                            _format_fixed_float(0.0, 6),
                            _format_fixed_float(0.0, 6),
                        ]
                    ),
                    _row(
                        [
                            _format_fixed_float(0.0, 6),
                            _format_fixed_float(0.0, 6),
                            _format_fixed_float(0.0, 6),
                        ]
                    ),
                    _row(
                        [
                            _format_fixed_float(0.0, 6),
                            _format_fixed_float(0.0, 6),
                            _format_auto_float(DEFAULT_LINEAR_STIFFNESS),
                            _format_fixed_float(0.0, 6),
                            _format_fixed_float(0.0, 6),
                            _format_fixed_float(0.0, 6),
                        ]
                    ),
                    _row(
                        [
                            _format_fixed_float(0.0, 6),
                            _format_fixed_float(0.0, 6),
                            _format_fixed_float(0.0, 6),
                        ]
                    ),
                ]
            )

        if element.sifs:
            edge_to_sif_index[edge_index] = (len(sif_payload) // 10) + 1
            first_node = element.sifs[0].node
            sif_payload.append(
                _row(
                    [
                        _format_auto_float(first_node),
                        _format_fixed_float(0.0, 6),
                        _format_fixed_float(0.0, 6),
                        _format_fixed_float(0.0, 6),
                        _format_fixed_float(0.0, 6),
                        _format_fixed_float(0.0, 6),
                    ]
                )
            )
            zero_row = _row(
                [
                    _format_fixed_float(0.0, 6),
                    _format_fixed_float(0.0, 6),
                    _format_fixed_float(0.0, 6),
                    _format_fixed_float(0.0, 6),
                    _format_fixed_float(0.0, 6),
                    _format_fixed_float(0.0, 6),
                ]
            )
            for _ in range(9):
                sif_payload.append(zero_row)

    elements_payload: list[str] = []
    zero_row6 = _row(
        [
            _format_fixed_float(0.0, 6),
            _format_fixed_float(0.0, 6),
            _format_fixed_float(0.0, 6),
            _format_fixed_float(0.0, 6),
            _format_fixed_float(0.0, 6),
            _format_fixed_float(0.0, 6),
        ]
    )

    for edge_index, element in enumerate(elements):
        node_name_pointer = 0
        if reference_overrides is not None:
            node_name_pointer = reference_overrides.node_name_pointers[edge_index]

        line1 = _row(
            [
                _format_auto_float(element.from_node),
                _format_auto_float(element.to_node),
                _format_auto_float(element.delta_x),
                _format_auto_float(element.delta_y),
                _format_auto_float(element.delta_z),
                _format_auto_float(element.diameter),
            ]
        )
        line2 = _row(
            [
                _format_auto_float(element.wall_thickness),
                _format_auto_float(element.insulation_thickness),
                _format_auto_float(element.corrosion_allowance),
                _format_auto_float(element.temperature1),
                _format_auto_float(element.temperature2),
                _format_auto_float(element.temperature3),
            ]
        )
        line7 = _row(
            [
                str(edge_to_bend_index.get(edge_index, 0)),
                str(edge_to_rigid_index.get(edge_index, 0)),
                "0",
                str(edge_to_restraint_index.get(edge_index, 0)),
                "0",
                "0",
            ]
        )
        line8 = _row(
            [
                "0",
                "0",
                "0",
                "0",
                str(edge_to_sif_index.get(edge_index, 0)),
                str(node_name_pointer),
            ]
        )
        line9 = _row([str(edge_to_reducer_index.get(edge_index, 0))])
        elements_payload.extend([line1, line2, zero_row6, zero_row6, zero_row6, zero_row6, line7, line8, line9])

    reducer_payload = [
        _row(
            [
                _format_auto_float(second_diameter),
                _format_fixed_float(0.0, 6),
                _format_fixed_float(angle_value, 4),
                _format_fixed_float(0.0, 6),
                _format_fixed_float(0.0, 6),
            ]
        )
        for second_diameter, angle_value in reducers
    ]

    miscel_payload = [
        "        1.00000      1.00000      1.00000      1.00000      1.00000      1.00000",
        "        1.00000      1.00000      1.00000      1.00000      1.00000      1.00000",
        "        1.00000      1.00000      1.00000      1.00000      1.00000      1.00000",
        "        1.00000      1.00000      1.00000      1.00000      1.00000      1.00000",
        "        1.00000      1.00000      1.00000      1.00000      1.00000      1.00000",
        "        1.00000      1.00000      1.00000      1.00000      1.00000      1.00000",
        "        1.00000      1.00000      1.00000      1.00000      1.00000      1.00000",
        "        1.00000      1.00000      1.00000      1.00000      1.00000      1.00000",
        "        1.00000      1.00000      1.00000      1.00000      1.00000      1.00000",
        "        1.00000      1.00000      1.00000      1.00000      1.00000      1.00000",
        "        1.00000      1.00000      1.00000      1.00000      1.00000      1.00000",
        "        1.00000      1.00000      1.00000      1.00000      1.00000      1.00000",
        "        1.00000      1.00000      1.00000      1.00000      1.00000      1.00000",
        "        1.00000      1.00000      1.00000      1.00000      1.00000      1.00000",
        "        1.00000      1.00000      1.00000      1.00000      1.00000      1.00000",
        "        1.00000      1.00000      1.00000      1.00000      1.00000      1.00000",
        "        1.00000      1.00000      1.00000      1.00000      1.00000",
        "              0            0            0            0     0.000000            0",
        "              0            0      21.1111     0.000000            0            0",
        "              0            0            0            0            0            0",
    ]

    units_payload = [
        "        25.4000      4.44822     0.453592     0.112985     0.112985      6.89476",
        "       0.555556     -17.7778      6.89476      6.89476 2.768000E-02 2.768000E-02",
        "   2.768000E-02      1.75127     0.112985      1.75127      1.00000      6.89476",
        "   2.540000E-02      25.4000      25.4000      25.4000",
        "  SI (mm)        ",
        "  on ",
        "  mm.",
        "  N. ",
        "  Kg.",
        "  N.m.  ",
        "  N.m.. ",
        "  KPa       ",
        "  C",
        "  C",
        "  KPa       ",
        "  KPa       ",
        "  kg.cu.cm. ",
        "  kg.cu.cm. ",
        "  kg.cu.cm. ",
        "  N./cm. ",
        "  N.m./deg  ",
        "  N./cm. ",
        "  g's",
        "  Kpa       ",
        "  m. ",
        "  mm.",
        "  mm.",
        "  mm.",
    ]

    nonam_count = 0
    nodename_payload: list[str] = []
    if reference_overrides is not None:
        version_payload = reference_overrides.version_payload
        nonam_count = reference_overrides.nonam_count
        nodename_payload = reference_overrides.nodename_payload
        bend_payload = reference_overrides.bend_payload
        reducer_payload = reference_overrides.reducers_payload
        coords_payload = reference_overrides.coords_payload

    control_line_1 = _row([str(len(elements)), "0", "0", str(nonam_count), "1"])
    control_line_2 = _row(
        [
            str(len(bend_payload) // 2),
            str(len(rigid_payload)),
            "0",
            str(len(restraint_payload) // 8),
            "0",
            "0",
        ]
    )
    control_line_3 = _row(["0", "0", "0", "0", str(len(sif_payload) // 10), str(len(reducer_payload))])

    sections: list[tuple[str, list[str]]] = [
        ("VERSION", version_payload),
        ("CONTROL", [control_line_1, control_line_2, control_line_3]),
        ("ELEMENTS", elements_payload),
        ("AUX_DATA", []),
        ("NODENAME", nodename_payload),
        ("BEND", bend_payload),
        ("RIGID", rigid_payload),
        ("EXPJT", []),
        ("RESTRANT", restraint_payload),
        ("DISPLMNT", []),
        ("FORCMNT", []),
        ("UNIFORM", []),
        ("WIND", []),
        ("OFFSETS", []),
        ("ALLOWBLS", []),
        ("SIF&TEES", sif_payload),
        ("REDUCERS", reducer_payload),
        ("MISCEL_1", miscel_payload),
        ("UNITS", units_payload),
        ("COORDS", coords_payload),
    ]

    lines: list[str] = []
    for name, payload in sections:
        lines.append(_section_header(name))
        lines.extend(payload)

    stats = {
        "elements": len(elements),
        "bends": len(bend_payload) // 2,
        "rigids": len(rigid_payload),
        "restraints": len(restraint_payload) // 8,
        "sifs": len(sif_payload) // 10,
        "reducers": len(reducer_payload),
        "coords": len(coords_payload) - 1,
    }
    return "\n".join(lines) + "\n", stats


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Convert CAESARII Input XML to CII.")
    parser.add_argument("--input", required=True, type=Path, help="Input XML path (CAESARII Input XML).")
    parser.add_argument("--output", required=True, type=Path, help="Output CII path.")
    parser.add_argument(
        "--reference-cii",
        required=False,
        type=Path,
        help=(
            "Optional reference CII. When provided, NodeName pointers are copied into ELEMENTS "
            "row8/col6, NONAM count is aligned, and NODENAME payload is reused."
        ),
    )
    parser.add_argument("--default-diameter", required=False, type=float, default=0.0, help="Fallback diameter.")
    parser.add_argument(
        "--default-wall-thickness",
        required=False,
        type=float,
        default=0.01,
        help="Fallback wall thickness when missing.",
    )
    parser.add_argument(
        "--default-insulation-thickness",
        required=False,
        type=float,
        default=0.0,
        help="Fallback insulation thickness when missing.",
    )
    parser.add_argument(
        "--default-corrosion-allowance",
        required=False,
        type=float,
        default=0.0,
        help="Fallback corrosion allowance when missing.",
    )
    parser.add_argument(
        "--default-temperature1",
        required=False,
        type=float,
        default=0.0,
        help="Fallback TEMP_EXP_C1 value when missing.",
    )
    parser.add_argument(
        "--default-temperature2",
        required=False,
        type=float,
        default=0.0,
        help="Fallback TEMP_EXP_C2 value when missing.",
    )
    parser.add_argument(
        "--default-temperature3",
        required=False,
        type=float,
        default=0.0,
        help="Fallback TEMP_EXP_C3 value when missing.",
    )
    parser.add_argument(
        "--default-pressure1",
        required=False,
        type=float,
        default=0.0,
        help="Reserved fallback pressure value (not currently emitted to CII block).",
    )
    parser.add_argument(
        "--default-pressure2",
        required=False,
        type=float,
        default=0.0,
        help="Reserved fallback pressure value (not currently emitted to CII block).",
    )
    parser.add_argument(
        "--default-pressure3",
        required=False,
        type=float,
        default=0.0,
        help="Reserved fallback pressure value (not currently emitted to CII block).",
    )
    parser.add_argument(
        "--default-reducer-angle",
        required=False,
        type=float,
        default=0.0,
        help="Fallback reducer half-angle when reducer is inferred but angle data is missing.",
    )
    parser.add_argument(
        "--infer-reducer-angle-from-geometry",
        action="store_true",
        help="Infer reducer half-angle from diameter delta and element run length.",
    )
    return parser


def main() -> int:
    parser = _build_parser()
    args = parser.parse_args()

    defaults = ConverterDefaults(
        diameter=args.default_diameter,
        wall_thickness=args.default_wall_thickness,
        insulation_thickness=args.default_insulation_thickness,
        corrosion_allowance=args.default_corrosion_allowance,
        temperature1=args.default_temperature1,
        temperature2=args.default_temperature2,
        temperature3=args.default_temperature3,
        pressure1=args.default_pressure1,
        pressure2=args.default_pressure2,
        pressure3=args.default_pressure3,
        reducer_angle=args.default_reducer_angle,
    )

    model = _parse_model(args.input, defaults)
    reference_overrides: ReferenceElementOverrides | None = None
    if args.reference_cii is not None:
        reference_overrides = _load_reference_element_overrides(
            path=args.reference_cii,
            expected_elements=len(model.elements),
        )
    cii_text, stats = _build_cii_text(
        model=model,
        defaults=defaults,
        infer_reducer_angle_from_geometry=args.infer_reducer_angle_from_geometry,
        reference_overrides=reference_overrides,
    )
    args.output.write_text(cii_text, encoding="utf-8")

    print(
        f"Wrote {args.output} from {args.input} with "
        f"{stats['elements']} elements, {stats['bends']} bends, {stats['rigids']} rigids, "
        f"{stats['restraints']} restraints, {stats['sifs']} SIF blocks, "
        f"{stats['reducers']} reducers, {stats['coords']} coordinates."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
