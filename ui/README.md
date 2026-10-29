# Palace Studio — HFSS-inspired 3D GUI MVP

A lightweight, **dependency-free browser UI** for the [Palace 3D electromagnetic finite-element solver](https://awslabs.github.io/palace/stable/), designed as a self-contained `ui/` addition to `go-itami/palace`. No changes to existing Palace benchmarks, GitHub Actions, or solver code are needed.

## Start

From the repository root:

```bash
python3 ui/server.py --port 8765
```

Open **http://127.0.0.1:8765** in your browser. Python 3.10+ is sufficient for viewing, creating designs, importing prior eigenmode results, validating settings, and exporting a reproducible input ZIP. The web viewer requires **no CDN, JavaScript build system, external packages, or account**.

For actual 3D meshing and FEM execution install [Gmsh](https://gmsh.info/) and [Palace](https://awslabs.github.io/palace/stable/) on the **same machine as this UI server**, and ensure they are on `PATH`. Environment overrides: `GMSH_BIN=/absolute/path/to/gmsh`, `PALACE_BIN=/absolute/path/to/palace` (run the Palace wrapper normally). Click **Run simulation** to execute a local job; when complete the results table displays `postpro/eig.csv` from Palace. The downloaded job ZIP includes files produced by the solver, including ParaView output when available.

If Palace is installed only on a remote host or via GitHub Actions, choose **Export Input** to download `model.geo`, `config.json`, `run.sh`, and `scene.json`. Upload or copy to the solver environment and run `bash run.sh`. This UI **does not automatically invoke pre-existing GitHub Actions** or access remote machines.

## Features (v0.1)

- HFSS-inspired layout: model tree, 3D CAD viewport, object property inspector, simulation panel, logs and result table.
- Box, cylinder and sphere primitives; click-to-select, rotate/orbit/pan/zoom, material assignment and geometric dimension editing; duplicate/delete, project save/open (JSON), sample cylinder resonator.
- Dimension units (mm, μm, cm, m), built-in material presets with editable εᵣ, μᵣ and loss tangent.
- Global exterior PEC, PMC, absorbing, or impedance boundary, with surface resistance for impedance.
- Eigenmode solver frequency target, number of modes, FEM order, tolerance, curved mesh size, saved modes and AMR iteration count.
- Validated Palace JSON + tagged Gmsh `.geo` file, local launch only if binaries are available, real Palace eigenmode CSV import. **Benchmark** loads available `verification/cylinder/**/eig.csv` files from the same repository, if present.
- No fictitious simulation results. Incorrect unsupported exports are refused.

## Physics scope — deliberately limited

**Valid solver export is currently one simply connected, homogeneous 3D solid**, with a single uniform outer boundary condition. Both conductor cavity and dielectric cavity example geometries can be modeled by assigning the interior material and exterior PEC or impedance. Multiple solids can be created for UI experimentation but **cannot yet be meshed/solved**. More sophisticated assemblies require OCC boolean fragment meshing, per-face tags and conformal dielectric interfaces. Lumped/wave/Floquet ports, S-parameters, far-field plots, interactive mesh/field rendering and arbitrary CAD/STEP import are not implemented; the UI should not be mistaken for an HFSS feature-complete replacement.

Gmsh exports second-order curved tetrahedra; Palace's `Solver.Order` independently specifies FEM order. The mesh coordinate unit is converted to meters through `Model.L0`. The UI default example is a 27.4 mm radius × 54.8 mm tall Teflon cylinder (εᵣ 2.08, tanδ 0.0004), PEC exterior and 15 eigenmodes above 2 GHz, following Palace's official cylinder tutorial. Generate/execute the model to obtain numerical results, never treat sample theory as computed data.

## Testing

```bash
python3 -m unittest discover -s ui/tests -v
```

The package runs without Gmsh or Palace for input validation and export tests. **Full FEM numerical validation has not been performed within this package.** The existing repository's `verification/cylinder` results remain the reference for follow-up cross-validation.

## Files

- `index.html`, `style.css`, `app.js`: standalone GUI and projected 3D viewer
- `exporter.py`: strict scene validation, Gmsh GEO and Palace config generation
- `server.py`: local HTTP API, input ZIP export, optional Gmsh/Palace worker, result CSV parsing
- `tests/test_exporter.py`: automated schema, unit, primitive, export, safety tests

**Security:** the server binds to `127.0.0.1` by default, accepts bounded JSON requests, and runs fixed executable commands rather than user-provided shell strings. Do not expose its execution endpoints to an untrusted network.
