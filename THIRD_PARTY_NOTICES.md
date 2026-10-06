# Third-party software bundled with ArchMCP

ArchMCP redistributes the following MIT-licensed projects unmodified (pinned versions in `versions.json`).
Each project's copyright notice and MIT license text apply to its files.

| Component | Source | License |
|---|---|---|
| RevitMCPServer (Revit add-in + MCP bridge) | https://github.com/KenLP/RevitMCPServer | MIT |
| photoshop-mcp (MCP server + UXP plugin) | https://github.com/drmedia/photoshop-mcp | MIT |
| Autocad-MCP / autocad-mcp-pro | https://github.com/U-C4N/Autocad-MCP | MIT |
| mcp-for-blender (Blender MCP + add-on) | https://github.com/ahujasid/mcp-for-blender | MIT |
| freecad-mcp (FreeCAD MCP + add-on) | https://github.com/neka-nat/freecad-mcp | MIT |
| openscad-mcp (OpenSCAD MCP) | https://github.com/RobertCoop/openscad-mcp | MIT |
| godot-mcp (Godot MCP) | https://github.com/Coding-Solo/godot-mcp | MIT |
| MCP for Unity (server + Unity package) | https://github.com/CoplayDev/unity-mcp | MIT |
| Node.js runtime | https://nodejs.org | MIT and bundled third-party licenses |
| CPython (python-build-standalone) | https://github.com/astral-sh/python-build-standalone | PSF-2.0 |

Python/npm dependencies keep their own licenses inside their `dist-info` / `node_modules` folders.
The SketchUp connector is a cloud service by Trimble and is not redistributed.
"Revit", "AutoCAD", "Photoshop", "SketchUp", "Blender", "FreeCAD", "OpenSCAD", "Godot" and "Unity" are trademarks of their owners; ArchMCP is not affiliated with them.


## Downloadable packs (Store)

Installed only when the user chooses them; each is verified against a signed catalog. Licences below are as declared upstream
(some declare none; check each project before redistributing).

| Pack | Source | License (as declared) |
|---|---|---|
| ableton (stable) | https://github.com/ahujasid/ableton-mcp | MIT |
| fusion360 (stable) | https://github.com/faust-machines/fusion360-mcp-server | MIT |
| rhino (stable) | https://github.com/jingcheng-chen/rhinomcp | MIT |
| archicad (stable) | https://github.com/Boti-Ormandi/archicad-mcp | MIT |
| solidworks (stable) | https://github.com/hjbaard/SolidWorks-MCP | MIT |
| maya (stable) | https://gimbalgoats.github.io/GG_MayaMCP/ | MIT |
| ifc (stable) | https://github.com/imants/ifc-mcp | MIT |
| bonsai (experimental) | https://github.com/JotaDeRodriguez/Bonsai_mcp | MIT |
| qgis (experimental) | https://github.com/jjsantos01/qgis_mcp | unspecified |
| altium (experimental) | https://github.com/coffeenmusic/altium-mcp | MIT |
| abaqus (experimental) | https://github.com/Cai-aa/abaqus-mcp | MIT |
| ansys (experimental) | https://github.com/hongwenwang36-eng/ANSYS-Workbench-mcp | MIT |
| nx (experimental) | https://github.com/DreamEnding/NX_MCP | MIT |
| inventor (experimental) | https://github.com/NeonGlay/inventor-mcp | MIT |
| etabs (experimental) | https://github.com/GreatApo/FEA-MCP | MIT |
| opensees (experimental) | https://openseespy.readthedocs.io/ | MIT (ArchMCP) |
| unreal (stable) | https://github.com/runreal/unreal-mcp | MIT |
| matlab (stable) | https://github.com/matlab/matlab-mcp-server | see upstream |
| comsol (experimental) | https://github.com/Ching-Chiang/comsol-mcp | MIT |
| ltspice (experimental) | https://github.com/Cognitohazard/ltspice-mcp (PyPI `ltspice-mcp` 0.6.1) | GPL-3.0-or-later |

`ltspice` is distributed unmodified and is installed only when the user chooses it in the Store; it is a separate program started as its
own process, not linked into ArchMCP. Its complete source for the shipped version is the PyPI sdist / the repository tag above; its
licence text is inside the pack (`servers/ltspice/site/ltspice_mcp-*.dist-info/`).

The MCP servers can be connected to Claude Desktop, Codex, Antigravity and OpenCode (user's choice); those products belong to their
owners and ArchMCP is not affiliated with or endorsed by them.

The complete list of every bundled and downloadable component with versions and SHA-256 hashes is in `sbom.json`
(CycloneDX 1.5), installed next to this file.
