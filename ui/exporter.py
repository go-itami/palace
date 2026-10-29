"""Validated Palace Eigenmode/Gmsh export for the Palace Studio UI.

Only one homogeneous 3-D volume is currently supported for solver export.
The visual editor may hold more objects; unsupported assemblies are refused,
not silently exported as physically incorrect simulations.
"""
from __future__ import annotations

import io
import json
import math
import re
import zipfile
from dataclasses import dataclass
from typing import Any

MAX_SCENE_BYTES = 256_000
UNITS = {"mm": 1e-3, "cm": 1e-2, "um": 1e-6, "m": 1.0}
GEOMETRIES = {"box", "cylinder", "sphere"}
BOUNDARIES = {"PEC", "PMC", "Absorbing", "Impedance"}
MATERIALS = {
    "Vacuum": (1.0, 0.0, 1.0),
    "Teflon": (2.08, 0.0004, 1.0),
    "FR4": (4.4, 0.02, 1.0),
    "Rogers 5880": (2.2, 0.0009, 1.0),
    "Alumina": (9.8, 0.0001, 1.0),
    "Custom": (1.0, 0.0, 1.0),
}


class SceneError(ValueError):
    pass


def numeric(value: Any, field: str, *, lower=None, upper=None, strict=False) -> float:
    if isinstance(value, bool):
        raise SceneError(f"{field}: number required")
    try:
        number = float(value)
    except (ValueError, TypeError):
        raise SceneError(f"{field}: number required") from None
    if not math.isfinite(number):
        raise SceneError(f"{field}: must be finite")
    if lower is not None and (number <= lower if strict else number < lower):
        raise SceneError(f"{field}: must be {'>' if strict else '>='} {lower}")
    if upper is not None and number > upper:
        raise SceneError(f"{field}: must be <= {upper}")
    return number


def integer(value: Any, field: str, lo: int, hi: int) -> int:
    num = numeric(value, field, lower=lo, upper=hi)
    if int(num) != num:
        raise SceneError(f"{field}: integer required")
    return int(num)


def position_vector(value: Any) -> list[float]:
    if not isinstance(value, list) or len(value) != 3:
        raise SceneError("position: expected [x, y, z]")
    return [numeric(x, f"position[{i}]", lower=-1e9, upper=1e9) for i, x in enumerate(value)]


def validate(scene: Any) -> dict:
    if not isinstance(scene, dict):
        raise SceneError("scene must be an object")
    unit = scene.get("unit", "mm")
    if unit not in UNITS:
        raise SceneError("unsupported unit")
    bodies = scene.get("objects")
    if not isinstance(bodies, list) or not bodies:
        raise SceneError("at least one solid is required")
    if len(bodies) != 1:
        raise SceneError("Solver export currently requires exactly one solid. Multi-body editing is visual-only until conformal boolean/fragment meshing is implemented.")
    body = bodies[0]
    if not isinstance(body, dict) or body.get("type") not in GEOMETRIES:
        raise SceneError("unsupported solid type")
    pos = position_vector(body.get("position"))
    shape = body["type"]
    size = body.get("dimensions", {})
    if not isinstance(size, dict):
        raise SceneError("dimensions must be an object")
    if shape == "box":
        dims = {key: numeric(size.get(key), key, lower=0, strict=True, upper=1e8) for key in ("width", "depth", "height")}
    elif shape == "cylinder":
        dims = {key: numeric(size.get(key), key, lower=0, strict=True, upper=1e8) for key in ("radius", "height")}
    else:
        dims = {"radius": numeric(size.get("radius"), "radius", lower=0, strict=True, upper=1e8)}
    mat = body.get("material", {})
    if not isinstance(mat, dict):
        raise SceneError("invalid material")
    material = {
        "name": re.sub(r"[^\w .-]", "", str(mat.get("name", "Custom")))[:60],
        "eps": numeric(mat.get("eps", 1), "eps", lower=0, strict=True, upper=1e6),
        "mu": numeric(mat.get("mu", 1), "mu", lower=0, strict=True, upper=1e6),
        "loss": numeric(mat.get("loss", 0), "loss", lower=0, upper=1e3),
    }
    analysis = scene.get("analysis", {})
    if not isinstance(analysis, dict) or analysis.get("type", "Eigenmode") != "Eigenmode":
        raise SceneError("only Eigenmode analysis is supported in this initial version")
    settings = {
        "target": numeric(analysis.get("target", 2), "target [GHz]", lower=0, strict=True, upper=1e5),
        "modes": integer(analysis.get("modes", 6), "modes", 1, 100),
        "order": integer(analysis.get("order", 3), "order", 1, 8),
        "tol": numeric(analysis.get("tol", 1e-6), "tolerance", lower=0, strict=True, upper=1),
        "meshSize": numeric(analysis.get("meshSize", 5), "mesh size", lower=0, strict=True, upper=1e7),
        "save": integer(analysis.get("save", 3), "saved modes", 0, 100),
        "amr": integer(analysis.get("amr", 0), "AMR iterations", 0, 10),
    }
    boundary = scene.get("boundary", {})
    if not isinstance(boundary, dict) or boundary.get("type", "PEC") not in BOUNDARIES:
        raise SceneError("unsupported exterior boundary type")
    bc = {"type": boundary.get("type", "PEC")}
    if bc["type"] == "Impedance":
        bc["rs"] = numeric(boundary.get("rs", 0.0184), "surface resistance", lower=0, strict=True, upper=1e12)
    name = str(scene.get("name", "Untitled Design"))[:80]
    return {"name": name, "unit": unit, "objects": [{"id": str(body.get("id", "solid-1"))[:80], "name": str(body.get("name", "Solid"))[:80], "type": shape, "position": pos, "dimensions": dims, "material": material}], "analysis": {"type": "Eigenmode", **settings}, "boundary": bc}


def format_geo(x: float) -> str:
    # Reject nonfinite values in validate() before emitting Gmsh code.
    return f"{x:.12g}"


def generate_geo(s: dict) -> str:
    body = s["objects"][0]
    x, y, z = body["position"]
    dims = body["dimensions"]
    t = body["type"]
    if t == "cylinder":
        r, h = dims["radius"], dims["height"]
        shape = f"Cylinder(1) = {{{format_geo(x)}, {format_geo(y)}, {format_geo(z-h/2)}, 0, 0, {format_geo(h)}, {format_geo(r)}, 2*Pi}};"
    elif t == "box":
        w, d, h = dims["width"], dims["depth"], dims["height"]
        shape = f"Box(1) = {{{format_geo(x-w/2)}, {format_geo(y-d/2)}, {format_geo(z-h/2)}, {format_geo(w)}, {format_geo(d)}, {format_geo(h)}}};"
    else:
        shape = f"Sphere(1) = {{{format_geo(x)}, {format_geo(y)}, {format_geo(z)}, {format_geo(dims['radius'])}}};"
    size = format_geo(s["analysis"]["meshSize"])
    return "\n".join([
        '// Generated by Palace Studio. Length unit: ' + s["unit"],
        'SetFactory("OpenCASCADE");',
        'Mesh.MshFileVersion = 2.2;',
        'Mesh.Binary = 0;',
        f'Mesh.CharacteristicLengthMin = {size};',
        f'Mesh.CharacteristicLengthMax = {size};',
        'Mesh.ElementOrder = 2;',
        'Mesh.HighOrderOptimize = 1;',
        shape,
        'Physical Volume("domain", 1) = {1};',
        'outer[] = Boundary{ Volume{1}; };',
        'Physical Surface("outer", 2) = {outer[]};',
        '',
    ])


def generate_config(s: dict) -> dict:
    analysis = s["analysis"]
    mat = s["objects"][0]["material"]
    boundary = s["boundary"]
    bc: dict[str, Any]
    if boundary["type"] == "Impedance":
        bc = {"Impedance": [{"Attributes": [2], "Rs": boundary["rs"]}]}
    else:
        bc = {boundary["type"]: {"Attributes": [2]}}
    return {
        "Problem": {"Type": "Eigenmode", "Verbose": 2, "Output": "postpro", "OutputFormats": {"Paraview": True}},
        "Model": {"Mesh": "mesh.msh", "L0": UNITS[s["unit"]], "Refinement": {"MaxIts": analysis["amr"]}},
        "Domains": {"Materials": [{"Attributes": [1], "Permittivity": mat["eps"], "Permeability": mat["mu"], "LossTan": mat["loss"]}],
                    "Postprocessing": {"Energy": [{"Index": 1, "Attributes": [1]}]}},
        "Boundaries": bc,
        "Solver": {"Order": analysis["order"], "Eigenmode": {"Target": analysis["target"], "N": analysis["modes"], "Tol": analysis["tol"], "Save": min(analysis["save"], analysis["modes"])}}
    }


def files_for_scene(scene: Any) -> dict[str, bytes]:
    s = validate(scene)
    return {
        "scene.json": json.dumps(s, ensure_ascii=False, indent=2).encode("utf-8"),
        "model.geo": generate_geo(s).encode("utf-8"),
        "config.json": (json.dumps(generate_config(s), ensure_ascii=False, indent=2) + "\n").encode("utf-8"),
        "run.sh": b'#!/usr/bin/env bash\nset -euo pipefail\ngmsh -3 model.geo -format msh2 -o mesh.msh\npalace config.json\necho "Done. See postpro/eig.csv and postpro/paraview/"\n',
        "README.txt": (
            "Palace Studio / Eigenmode export\n\n"
            "1) Install Gmsh and Palace, make both available on PATH.\n"
            "2) Run: bash run.sh (or gmsh -3 model.geo -format msh2 -o mesh.msh; palace config.json).\n"
            "3) Read postpro/eig.csv for eigenfrequencies and postpro/paraview/ in ParaView.\n\n"
            "Mesh coordinates are in the scene's length unit, and Palace Model.L0 handles conversion to meters.\n"
            "The mesh uses second-order curved tetrahedra, whereas the Palace FEM solution uses Solver.Order.\n"
            "Only a single homogeneous solid with a uniform outer boundary is supported.\n"
            "Ports, face-specific BCs, boolean CAD operations and multi-volume meshing are future work.\n"
        ).encode("utf-8"),
    }


def zip_files(files: dict[str, bytes]) -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as z:
        for name, contents in files.items():
            z.writestr(name, contents)
    return output.getvalue()
