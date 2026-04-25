#!/usr/bin/env python3
"""
Convert PSI116-style XML (`PipeStressExport`) into CII text.

Functionality:
- Parses XML shaped by `Doc/PSI116.xsd` (`Pipe > Branch > Node`).
- Builds CII element connectivity from positive `NodeNumber` values in
  branch order.
- Emits CII sections used by the sample output
  (`VERSION`, `CONTROL`, `ELEMENTS`, `NODENAME`, `BEND`, `RIGID`,
  `RESTRANT`, `SIF&TEES`, `REDUCERS`, `MISCEL_1`, `UNITS`, `COORDS`).

Parameters expected:
- `--input`: path to input XML file.
- `--output`: path to output CII file.
- `--coords-mode`: `first|all|none` for type-1 (open-end) restraint
  coordinate records.

Outputs passed:
- One `.cii` text file and conversion summary printed to stdout.

Fallback:
- Missing process/stress sections are written as zero/default blocks
  compatible with the sample style.
- `RestrainOpenEnds=Yes` adds type-1 end restraints on degree-1 nodes.
"""

from __future__ import annotations

import argparse
from collections import Counter
from dataclasses import dataclass
import math
from pathlib import Path
from typing import Final
import xml.etree.ElementTree as ET


VERSION_PAYLOAD_LINES: Final[int] = 61
OPEN_END_STIFFNESS: Final[float] = 9.41952e19
DEFAULT_LINEAR_STIFFNESS: Final[float] = 1.75127e12
BEND_FLEXIBILITY_CONSTANT: Final[float] = -2.0202
VERSION_SUFFIX: Final[str] = "psi2cii.exe version 3.1.0.3 (Feb 21 2024)"


@dataclass(frozen=True)
class RestraintSpec:
    type_code: int
    stiffness: float
    gap: float
    friction: float
    is_open_end: bool


@dataclass(frozen=True)
class XmlNode:
    node_number: int
    node_name: str
    endpoint: int | None
    component_type: str
    rigid: int | None
    outside_diameter: float
    alpha_angle: float | None
    wall_thickness: float
    corrosion_allowance: float
    insulation_thickness: float
    bend_radius: float
    position: tuple[float, float, float]
    restraint_spec: RestraintSpec | None


@dataclass(frozen=True)
class XmlBranch:
    branch_name: str
    branch_temperature: float
    temperatures: tuple[float, ...]
    pressures: tuple[float, ...]
    nodes: list[XmlNode]


@dataclass(frozen=True)
class XmlMetadata:
    date_time: str
    source: str
    version: str
    user_name: str
    purpose: str
    project_name: str
    mdb_name: str
    title_lines: list[str]
    restrain_open_ends: bool


@dataclass(frozen=True)
class XmlDocument:
    metadata: XmlMetadata
    branches: list[XmlBranch]


@dataclass(frozen=True)
class Edge:
    from_node: XmlNode
    to_node: XmlNode
    branch_temperature: float


@dataclass(frozen=True)
class AssignedRestraint:
    node_number: int
    spec: RestraintSpec
    position: tuple[float, float, float]


@dataclass(frozen=True)
class ConversionModel:
    metadata: XmlMetadata
    edges: list[Edge]
    degrees: Counter[int]
    nodename_lines: list[str]
    edge_to_nodename_index: dict[int, int]
    bend_edges: list[Edge]
    edge_to_bend_index: dict[int, int]
    rigid_edges: list[Edge]
    edge_to_rigid_index: dict[int, int]
    sif_edges: list[Edge]
    edge_to_sif_index: dict[int, int]
    reducer_edges: list[Edge]
    edge_to_reducer_index: dict[int, int]
    restraints: list[AssignedRestraint]
    edge_to_restraint_index: dict[int, int]


def _safe_text(value: str | None) -> str:
    if value is None:
        return ""
    return value.strip()


def _local_name(tag: str) -> str:
    if tag.startswith("{"):
        return tag.split("}", 1)[1]
    return tag


def _namespace(tag: str) -> str:
    if tag.startswith("{"):
        return tag[1:].split("}", 1)[0]
    return ""


def _q(namespace: str, name: str) -> str:
    if namespace:
        return f"{{{namespace}}}{name}"
    return name


def _child_text(parent: ET.Element, namespace: str, name: str) -> str:
    element = parent.find(_q(namespace, name))
    if element is None:
        return ""
    return _safe_text(element.text)


def _parse_optional_int(value: str, field_name: str) -> int | None:
    text = _safe_text(value)
    if not text:
        return None
    try:
        return int(text)
    except ValueError as exc:
        raise ValueError(f"Invalid integer in XML field '{field_name}': '{text}'") from exc


def _parse_optional_float(value: str, field_name: str) -> float | None:
    text = _safe_text(value)
    if not text:
        return None
    try:
        return float(text)
    except ValueError as exc:
        raise ValueError(f"Invalid float in XML field '{field_name}': '{text}'") from exc


def _parse_position(value: str) -> tuple[float, float, float]:
    text = _safe_text(value)
    parts = text.split()
    if len(parts) != 3:
        raise ValueError(f"Position must have exactly 3 values, got '{text}'")
    try:
        return float(parts[0]), float(parts[1]), float(parts[2])
    except ValueError as exc:
        raise ValueError(f"Invalid numeric value in Position '{text}'") from exc


def _parse_yes_no(value: str, field_name: str) -> bool:
    text = _safe_text(value).upper()
    if not text:
        return False
    if text == "YES":
        return True
    if text == "NO":
        return False
    raise ValueError(f"Expected Yes/No in XML field '{field_name}', got '{value}'")


def _restraint_type_to_code(restraint_type: str) -> int:
    normalized = _safe_text(restraint_type).upper()
    if normalized == "X":
        return 2
    if normalized == "Y":
        return 3
    if normalized == "Z":
        return 4
    if normalized in {"A", "ANCHOR", "FIXED", "FIX"}:
        return 1
    raise ValueError(
        f"Unsupported restraint type '{restraint_type}'. "
        "Supported values: X, Y, Z, A/ANCHOR/FIXED."
    )


def _parse_restraint(node_element: ET.Element, namespace: str) -> RestraintSpec | None:
    restraint_elements = node_element.findall(_q(namespace, "Restraint"))
    if not restraint_elements:
        return None
    if len(restraint_elements) > 1:
        raise ValueError("Only one Restraint per node is supported in this converter.")

    restraint_element = restraint_elements[0]
    type_text = _child_text(restraint_element, namespace, "Type")
    if not type_text:
        raise ValueError("Restraint element must contain Type.")

    type_code = _restraint_type_to_code(type_text)
    stiffness = _parse_optional_float(
        _child_text(restraint_element, namespace, "Stiffness"), "Restraint/Stiffness"
    )
    gap = _parse_optional_float(_child_text(restraint_element, namespace, "Gap"), "Restraint/Gap")
    friction = _parse_optional_float(
        _child_text(restraint_element, namespace, "Friction"), "Restraint/Friction"
    )

    return RestraintSpec(
        type_code=type_code,
        stiffness=0.0 if stiffness is None else stiffness,
        gap=0.0 if gap is None else gap,
        friction=0.0 if friction is None else friction,
        is_open_end=False,
    )


def _parse_branch_temperature(branch_element: ET.Element, namespace: str) -> float:
    temperature_element = branch_element.find(_q(namespace, "Temperature"))
    if temperature_element is None:
        return 0.0

    values: list[float] = []
    for index in range(1, 10):
        raw_value = _child_text(temperature_element, namespace, f"Temperature{index}")
        parsed = _parse_optional_float(raw_value, f"Branch/Temperature{index}")
        if parsed is None:
            continue
        values.append(parsed)

    for value in values:
        if abs(value - (-100000.0)) > 1e-9:
            return value
    return 0.0


def _parse_branch_temperatures(branch_element: ET.Element, namespace: str) -> tuple[float, ...]:
    values: list[float] = [0.0] * 9
    temperature_element = branch_element.find(_q(namespace, "Temperature"))
    if temperature_element is None:
        return tuple(values)

    for index in range(1, 10):
        raw_value = _child_text(temperature_element, namespace, f"Temperature{index}")
        parsed = _parse_optional_float(raw_value, f"Branch/Temperature{index}")
        if parsed is None or abs(parsed - (-100000.0)) < 1e-9:
            values[index - 1] = 0.0
        else:
            values[index - 1] = parsed
    return tuple(values)


def _parse_branch_pressures(branch_element: ET.Element, namespace: str) -> tuple[float, ...]:
    values: list[float] = [0.0] * 9
    pressure_element = branch_element.find(_q(namespace, "Pressure"))
    if pressure_element is None:
        return tuple(values)

    for index in range(1, 10):
        raw_value = _child_text(pressure_element, namespace, f"Pressure{index}")
        parsed = _parse_optional_float(raw_value, f"Branch/Pressure{index}")
        values[index - 1] = 0.0 if parsed is None else parsed
    return tuple(values)


def _parse_xml_document(path: Path) -> XmlDocument:
    root = ET.parse(path).getroot()
    if _local_name(root.tag) != "PipeStressExport":
        raise ValueError(
            f"Unexpected root element '{_local_name(root.tag)}'; expected 'PipeStressExport'."
        )

    namespace = _namespace(root.tag)
    metadata = XmlMetadata(
        date_time=_child_text(root, namespace, "DateTime"),
        source=_child_text(root, namespace, "Source"),
        version=_child_text(root, namespace, "Version"),
        user_name=_child_text(root, namespace, "UserName"),
        purpose=_child_text(root, namespace, "Purpose"),
        project_name=_child_text(root, namespace, "ProjectName"),
        mdb_name=_child_text(root, namespace, "MDBName"),
        title_lines=[_safe_text(element.text) for element in root.findall(_q(namespace, "TitleLine"))],
        restrain_open_ends=_parse_yes_no(_child_text(root, namespace, "RestrainOpenEnds"), "RestrainOpenEnds"),
    )

    pipes = root.findall(_q(namespace, "Pipe"))
    if not pipes:
        raise ValueError("Input XML does not contain any Pipe elements.")

    branches: list[XmlBranch] = []
    for pipe in pipes:
        for branch_element in pipe.findall(_q(namespace, "Branch")):
            branch_name = _child_text(branch_element, namespace, "Branchname")
            branch_temperature = _parse_branch_temperature(branch_element, namespace)
            branch_temperatures = _parse_branch_temperatures(branch_element, namespace)
            branch_pressures = _parse_branch_pressures(branch_element, namespace)
            parsed_nodes: list[XmlNode] = []
            for node_element in branch_element.findall(_q(namespace, "Node")):
                node_number = _parse_optional_int(
                    _child_text(node_element, namespace, "NodeNumber"), "Node/NodeNumber"
                )
                if node_number is None or node_number <= 0:
                    continue

                position_text = _child_text(node_element, namespace, "Position")
                if not position_text:
                    raise ValueError(f"Node {node_number} is missing Position.")

                endpoint = _parse_optional_int(_child_text(node_element, namespace, "Endpoint"), "Node/Endpoint")
                rigid = _parse_optional_int(_child_text(node_element, namespace, "Rigid"), "Node/Rigid")
                alpha_angle = _parse_optional_float(
                    _child_text(node_element, namespace, "AlphaAngle"), "Node/AlphaAngle"
                )
                wall_thickness_value = _parse_optional_float(
                    _child_text(node_element, namespace, "WallThickness"),
                    "Node/WallThickness",
                )
                if wall_thickness_value is None:
                    wall_thickness_value = 0.0
                corrosion_allowance_value = _parse_optional_float(
                    _child_text(node_element, namespace, "CorrosionAllowance"),
                    "Node/CorrosionAllowance",
                )
                if corrosion_allowance_value is None:
                    corrosion_allowance_value = 0.0
                insulation_thickness_value = _parse_optional_float(
                    _child_text(node_element, namespace, "InsulationThickness"),
                    "Node/InsulationThickness",
                )
                if insulation_thickness_value is None:
                    insulation_thickness_value = 0.0
                bend_radius_value = _parse_optional_float(
                    _child_text(node_element, namespace, "BendRadius"),
                    "Node/BendRadius",
                )
                if bend_radius_value is None:
                    bend_radius_value = 0.0
                outside_diameter_value = _parse_optional_float(
                    _child_text(node_element, namespace, "OutsideDiameter"),
                    "Node/OutsideDiameter",
                )
                if outside_diameter_value is None:
                    outside_diameter_value = 0.0

                parsed_nodes.append(
                    XmlNode(
                        node_number=node_number,
                        node_name=_child_text(node_element, namespace, "NodeName"),
                        endpoint=endpoint,
                        component_type=_child_text(node_element, namespace, "ComponentType").upper(),
                        rigid=rigid,
                        outside_diameter=outside_diameter_value,
                        alpha_angle=alpha_angle,
                        wall_thickness=wall_thickness_value,
                        corrosion_allowance=corrosion_allowance_value,
                        insulation_thickness=insulation_thickness_value,
                        bend_radius=bend_radius_value,
                        position=_parse_position(position_text),
                        restraint_spec=_parse_restraint(node_element, namespace),
                    )
                )

            if parsed_nodes:
                branches.append(
                    XmlBranch(
                        branch_name=branch_name,
                        branch_temperature=branch_temperature,
                        temperatures=branch_temperatures,
                        pressures=branch_pressures,
                        nodes=parsed_nodes,
                    )
                )

    if not branches:
        raise ValueError("Input XML does not contain any positive NodeNumber nodes.")

    return XmlDocument(metadata=metadata, branches=branches)


def _build_edges(branches: list[XmlBranch]) -> list[Edge]:
    edges: list[Edge] = []
    for branch in branches:
        if len(branch.nodes) < 2:
            continue
        for index in range(len(branch.nodes) - 1):
            edges.append(
                Edge(
                    from_node=branch.nodes[index],
                    to_node=branch.nodes[index + 1],
                    branch_temperature=branch.branch_temperature,
                )
            )
    if not edges:
        raise ValueError("No element edges could be formed from branch node order.")
    return edges


def _build_degree_map(edges: list[Edge]) -> Counter[int]:
    degrees: Counter[int] = Counter()
    for edge in edges:
        degrees[edge.from_node.node_number] += 1
        degrees[edge.to_node.node_number] += 1
    return degrees


def _build_nodename_lines(edges: list[Edge]) -> tuple[list[str], dict[int, int]]:
    lines: list[str] = []
    edge_to_index: dict[int, int] = {}

    for edge_index, edge in enumerate(edges):
        left = _safe_text(edge.from_node.node_name)[:10]
        right = _safe_text(edge.to_node.node_name)[:10]
        if not left and not right:
            continue
        lines.append(f"  {left:<18}{right:>18}")
        edge_to_index[edge_index] = len(lines)

    return lines, edge_to_index


def _build_bend_indices(edges: list[Edge]) -> tuple[list[Edge], dict[int, int]]:
    bend_edges: list[Edge] = []
    edge_to_index: dict[int, int] = {}
    for edge_index, edge in enumerate(edges):
        if edge.to_node.component_type == "ELBO" and edge.to_node.endpoint == 0:
            bend_edges.append(edge)
            edge_to_index[edge_index] = len(bend_edges)
    return bend_edges, edge_to_index


def _build_rigid_indices(edges: list[Edge]) -> tuple[list[Edge], dict[int, int]]:
    rigid_edges: list[Edge] = []
    edge_to_index: dict[int, int] = {}
    for edge_index, edge in enumerate(edges):
        if edge.to_node.rigid == 2 or (edge.from_node.rigid == 2 and edge.to_node.rigid == 1):
            rigid_edges.append(edge)
            edge_to_index[edge_index] = len(rigid_edges)
    return rigid_edges, edge_to_index


def _build_sif_indices(edges: list[Edge]) -> tuple[list[Edge], dict[int, int]]:
    sif_edges: list[Edge] = []
    edge_to_index: dict[int, int] = {}
    for edge_index, edge in enumerate(edges):
        if edge.to_node.endpoint == 0 and edge.to_node.component_type in {"TEE", "OLET"}:
            sif_edges.append(edge)
            edge_to_index[edge_index] = len(sif_edges)
    return sif_edges, edge_to_index


def _build_reducer_indices(edges: list[Edge]) -> tuple[list[Edge], dict[int, int]]:
    reducer_edges: list[Edge] = []
    edge_to_index: dict[int, int] = {}
    for edge_index, edge in enumerate(edges):
        if edge.to_node.alpha_angle is not None:
            reducer_edges.append(edge)
            edge_to_index[edge_index] = len(reducer_edges)
    return reducer_edges, edge_to_index


def _build_explicit_restraint_specs(branches: list[XmlBranch]) -> dict[int, RestraintSpec]:
    specs: dict[int, RestraintSpec] = {}
    for branch in branches:
        for node in branch.nodes:
            if node.restraint_spec is None:
                continue
            existing = specs.get(node.node_number)
            if existing is None:
                specs[node.node_number] = node.restraint_spec
                continue
            if existing != node.restraint_spec:
                raise ValueError(
                    f"Conflicting restraint definitions for NodeNumber {node.node_number}."
                )
    return specs


def _build_restraints(
    metadata: XmlMetadata,
    edges: list[Edge],
    degrees: Counter[int],
    explicit_specs: dict[int, RestraintSpec],
) -> tuple[list[AssignedRestraint], dict[int, int]]:
    node_specs: dict[int, RestraintSpec] = dict(explicit_specs)

    if metadata.restrain_open_ends:
        for node_number, degree in degrees.items():
            if degree != 1:
                continue
            if node_number in node_specs:
                continue
            node_specs[node_number] = RestraintSpec(
                type_code=1,
                stiffness=OPEN_END_STIFFNESS,
                gap=0.0,
                friction=0.0,
                is_open_end=True,
            )

    if not node_specs:
        return [], {}

    assigned_node_numbers: set[int] = set()
    restraints: list[AssignedRestraint] = []
    edge_to_index: dict[int, int] = {}

    def assign(edge_index: int, node: XmlNode) -> bool:
        if node.node_number in assigned_node_numbers:
            return False
        spec = node_specs.get(node.node_number)
        if spec is None:
            return False
        if edge_index in edge_to_index:
            raise ValueError(
                f"Edge {edge_index + 1} received multiple restraints; unsupported mapping."
            )
        restraints.append(
            AssignedRestraint(
                node_number=node.node_number,
                spec=spec,
                position=node.position,
            )
        )
        edge_to_index[edge_index] = len(restraints)
        assigned_node_numbers.add(node.node_number)
        return True

    for edge_index, edge in enumerate(edges):
        if assign(edge_index, edge.to_node):
            continue
        from_is_open_end = degrees[edge.from_node.node_number] == 1
        if from_is_open_end:
            assign(edge_index, edge.from_node)

    unresolved = [node_number for node_number in node_specs if node_number not in assigned_node_numbers]
    for node_number in unresolved:
        matched = False
        for edge_index, edge in enumerate(edges):
            if edge.to_node.node_number == node_number:
                if assign(edge_index, edge.to_node):
                    matched = True
                    break
            if edge.from_node.node_number == node_number:
                if assign(edge_index, edge.from_node):
                    matched = True
                    break
        if not matched:
            raise ValueError(f"Unable to assign restraint for NodeNumber {node_number}.")

    return restraints, edge_to_index


def _build_conversion_model(document: XmlDocument) -> ConversionModel:
    edges = _build_edges(document.branches)
    degrees = _build_degree_map(edges)

    nodename_lines, edge_to_nodename_index = _build_nodename_lines(edges)
    bend_edges, edge_to_bend_index = _build_bend_indices(edges)
    rigid_edges, edge_to_rigid_index = _build_rigid_indices(edges)
    sif_edges, edge_to_sif_index = _build_sif_indices(edges)
    reducer_edges, edge_to_reducer_index = _build_reducer_indices(edges)

    explicit_specs = _build_explicit_restraint_specs(document.branches)
    restraints, edge_to_restraint_index = _build_restraints(
        document.metadata,
        edges,
        degrees,
        explicit_specs,
    )

    return ConversionModel(
        metadata=document.metadata,
        edges=edges,
        degrees=degrees,
        nodename_lines=nodename_lines,
        edge_to_nodename_index=edge_to_nodename_index,
        bend_edges=bend_edges,
        edge_to_bend_index=edge_to_bend_index,
        rigid_edges=rigid_edges,
        edge_to_rigid_index=edge_to_rigid_index,
        sif_edges=sif_edges,
        edge_to_sif_index=edge_to_sif_index,
        reducer_edges=reducer_edges,
        edge_to_reducer_index=edge_to_reducer_index,
        restraints=restraints,
        edge_to_restraint_index=edge_to_restraint_index,
    )


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


def _row(values: list[str]) -> str:
    if not values:
        return ""
    widths = [15] + [13] * (len(values) - 1)
    chunks = [f"{values[index]:>{widths[index]}}" for index in range(len(values))]
    return "".join(chunks)


def _section_header(name: str) -> str:
    return f"#$ {name}"


def _build_version_payload(metadata: XmlMetadata) -> list[str]:
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
    payload.append(f"  DateTime: {metadata.date_time}")
    payload.append(f"  Source: {metadata.source}")
    payload.append(f"  Version: {metadata.version} ({VERSION_SUFFIX})")
    payload.append(f"  UserName: {metadata.user_name}")
    payload.append(f"  Purpose: {metadata.purpose}")
    payload.append(f"  ProjectName: {metadata.project_name}")
    payload.append(f"  MDBName: {metadata.mdb_name}")
    if metadata.title_lines:
        for title_line in metadata.title_lines:
            payload.append(f"  {title_line}")
    else:
        payload.append("  ")

    while len(payload) < VERSION_PAYLOAD_LINES:
        payload.append("  ")
    if len(payload) > VERSION_PAYLOAD_LINES:
        payload = payload[:VERSION_PAYLOAD_LINES]

    return payload


def _element_outside_diameter(edge: Edge) -> float:
    if edge.to_node.component_type == "BRAN" and edge.to_node.endpoint == 2:
        return edge.to_node.outside_diameter
    return edge.from_node.outside_diameter


def _build_elements_payload(model: ConversionModel) -> list[str]:
    lines: list[str] = []
    zero_line = _row(
        [
            _format_fixed_float(0.0, 6),
            _format_fixed_float(0.0, 6),
            _format_fixed_float(0.0, 6),
            _format_fixed_float(0.0, 6),
            _format_fixed_float(0.0, 6),
            _format_fixed_float(0.0, 6),
        ]
    )

    for edge_index, edge in enumerate(model.edges):
        from_node = edge.from_node
        to_node = edge.to_node
        dx = to_node.position[0] - from_node.position[0]
        dy = to_node.position[1] - from_node.position[1]
        dz = to_node.position[2] - from_node.position[2]
        outside_diameter = _element_outside_diameter(edge)

        line1 = _row(
            [
                _format_auto_float(float(from_node.node_number)),
                _format_auto_float(float(to_node.node_number)),
                _format_auto_float(dx),
                _format_auto_float(dy),
                _format_auto_float(dz),
                _format_auto_float(outside_diameter),
            ]
        )
        line2 = _row(
            [
                "1.000000E-02" if from_node.wall_thickness <= 0.0 else _format_auto_float(from_node.wall_thickness),
                _format_auto_float(to_node.insulation_thickness),
                _format_auto_float(to_node.corrosion_allowance),
                _format_auto_float(edge.branch_temperature),
                _format_fixed_float(0.0, 6),
                _format_fixed_float(0.0, 6),
            ]
        )

        bend_index = model.edge_to_bend_index.get(edge_index, 0)
        rigid_index = model.edge_to_rigid_index.get(edge_index, 0)
        restraint_index = model.edge_to_restraint_index.get(edge_index, 0)
        sif_index = model.edge_to_sif_index.get(edge_index, 0)
        nodename_index = model.edge_to_nodename_index.get(edge_index, 0)
        reducer_index = model.edge_to_reducer_index.get(edge_index, 0)

        line7 = _row(
            [
                str(bend_index),
                str(rigid_index),
                "0",
                str(restraint_index),
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
                str(sif_index),
                str(nodename_index),
            ]
        )
        line9 = _row([str(reducer_index)])

        lines.extend([line1, line2, zero_line, zero_line, zero_line, zero_line, line7, line8, line9])

    return lines


def _build_bend_payload(model: ConversionModel) -> list[str]:
    lines: list[str] = []
    for edge in model.bend_edges:
        line1 = _row(
            [
                _format_auto_float(edge.to_node.bend_radius if edge.to_node.bend_radius > 0.0 else _element_outside_diameter(edge)),
                _format_fixed_float(0.0, 6),
                _format_fixed_float(BEND_FLEXIBILITY_CONSTANT, 5),
                _format_auto_float(float(edge.to_node.node_number - 1)),
                _format_fixed_float(0.0, 6),
                _format_fixed_float(0.0, 6),
            ]
        )
        line2 = _row(
            [
                _format_fixed_float(0.0, 6),
                _format_fixed_float(0.0, 6),
                _format_fixed_float(0.0, 6),
                _format_fixed_float(0.0, 6),
                _format_fixed_float(0.0, 6),
            ]
        )
        lines.extend([line1, line2])
    return lines


def _build_rigid_payload(model: ConversionModel) -> list[str]:
    lines: list[str] = []
    for _ in model.rigid_edges:
        lines.append(_row([_format_fixed_float(0.0, 6)]))
    return lines


def _build_restraint_payload(model: ConversionModel) -> list[str]:
    lines: list[str] = []
    for assigned in model.restraints:
        spec = assigned.spec
        if spec.is_open_end:
            secondary_flag = _format_fixed_float(0.0, 6)
        else:
            secondary_flag = _format_fixed_float(1.0, 5)

        line1 = _row(
            [
                _format_auto_float(float(assigned.node_number)),
                _format_fixed_float(float(spec.type_code), 5),
                _format_auto_float(spec.stiffness),
                _format_fixed_float(spec.gap, 6),
                _format_fixed_float(spec.friction, 6),
                _format_fixed_float(0.0, 6),
            ]
        )
        line2 = _row(
            [
                _format_fixed_float(0.0, 6),
                _format_fixed_float(0.0, 6),
                secondary_flag,
            ]
        )
        line3 = _row(
            [
                _format_fixed_float(0.0, 6),
                _format_fixed_float(0.0, 6),
                _format_auto_float(DEFAULT_LINEAR_STIFFNESS),
                _format_fixed_float(0.0, 6),
                _format_fixed_float(0.0, 6),
                _format_fixed_float(0.0, 6),
            ]
        )
        line4 = _row(
            [
                _format_fixed_float(0.0, 6),
                _format_fixed_float(0.0, 6),
                _format_fixed_float(0.0, 6),
            ]
        )
        lines.extend([line1, line2, line3, line4, line3, line4, line3, line4])
    return lines


def _build_sif_payload(model: ConversionModel) -> list[str]:
    lines: list[str] = []
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
    for edge in model.sif_edges:
        first = _row(
            [
                _format_auto_float(float(edge.to_node.node_number)),
                _format_fixed_float(0.0, 6),
                _format_fixed_float(0.0, 6),
                _format_fixed_float(0.0, 6),
                _format_fixed_float(0.0, 6),
                _format_fixed_float(0.0, 6),
            ]
        )
        lines.append(first)
        for _ in range(9):
            lines.append(zero_row)
    return lines


def _build_reducer_payload(model: ConversionModel) -> list[str]:
    lines: list[str] = []
    for edge in model.reducer_edges:
        alpha_angle = edge.to_node.alpha_angle
        if alpha_angle is None:
            raise ValueError("Reducer edge without AlphaAngle encountered.")
        lines.append(
            _row(
                [
                    _format_auto_float(edge.to_node.outside_diameter),
                    _format_fixed_float(0.0, 6),
                    _format_fixed_float(alpha_angle, 4),
                    _format_fixed_float(0.0, 6),
                    _format_fixed_float(0.0, 6),
                ]
            )
        )
    return lines


def _build_miscel_payload() -> list[str]:
    return [
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


def _build_units_payload() -> list[str]:
    return [
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


def _build_coords_payload(model: ConversionModel, coords_mode: str) -> list[str]:
    open_end_restraints = [restraint for restraint in model.restraints if restraint.spec.is_open_end]
    if coords_mode == "none" or not open_end_restraints:
        return [_row(["0"])]

    selected: list[AssignedRestraint]
    if coords_mode == "first":
        selected = [open_end_restraints[0]]
    else:
        selected = list(open_end_restraints)

    payload = [_row([str(len(selected))])]
    for restraint in selected:
        payload.append(
            _row(
                [
                    str(restraint.node_number),
                    _format_fixed_float(restraint.position[0], 4),
                    _format_fixed_float(restraint.position[1], 4),
                    _format_fixed_float(restraint.position[2], 4),
                ]
            )
        )
    return payload


def _build_cii_text(model: ConversionModel, coords_mode: str) -> str:
    version_payload = _build_version_payload(model.metadata)
    elements_payload = _build_elements_payload(model)
    bend_payload = _build_bend_payload(model)
    rigid_payload = _build_rigid_payload(model)
    restraint_payload = _build_restraint_payload(model)
    sif_payload = _build_sif_payload(model)
    reducer_payload = _build_reducer_payload(model)
    miscel_payload = _build_miscel_payload()
    units_payload = _build_units_payload()
    coords_payload = _build_coords_payload(model, coords_mode)

    control_line_1 = _row(
        [
            str(len(model.edges)),
            "0",
            "0",
            str(len(model.nodename_lines)),
            "1",
        ]
    )
    control_line_2 = _row(
        [
            str(len(model.bend_edges)),
            str(len(model.rigid_edges)),
            "0",
            str(len(model.restraints)),
            "0",
            "0",
        ]
    )
    control_line_3 = _row(
        [
            "0",
            "0",
            "0",
            "0",
            str(len(model.sif_edges)),
            str(len(model.reducer_edges)),
        ]
    )

    sections: list[tuple[str, list[str]]] = [
        ("VERSION", version_payload),
        ("CONTROL", [control_line_1, control_line_2, control_line_3]),
        ("ELEMENTS", elements_payload),
        ("AUX_DATA", []),
        ("NODENAME", model.nodename_lines),
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

    return "\n".join(lines) + "\n"


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Convert PSI116 XML to CII.")
    parser.add_argument("--input", required=True, type=Path, help="Input XML file path.")
    parser.add_argument("--output", required=True, type=Path, help="Output CII file path.")
    parser.add_argument(
        "--coords-mode",
        required=False,
        default="first",
        choices=["first", "all", "none"],
        help="How many type-1 restraint coordinates to write in COORDS (default: first).",
    )
    return parser.parse_args()


def main() -> None:
    args = _parse_args()
    document = _parse_xml_document(args.input)
    model = _build_conversion_model(document)
    cii_text = _build_cii_text(model, args.coords_mode)

    args.output.write_text(cii_text, encoding="utf-8")
    print(
        f"Wrote {args.output} with {len(model.edges)} elements, "
        f"{len(model.restraints)} restraints, {len(model.bend_edges)} bends, "
        f"{len(model.sif_edges)} SIF/tee entries, {len(model.reducer_edges)} reducers."
    )


if __name__ == "__main__":
    main()
