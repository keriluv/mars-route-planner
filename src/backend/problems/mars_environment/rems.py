from __future__ import annotations

import csv
import xml.etree.ElementTree as ET
from pathlib import Path

import numpy as np

KEEP = (
    "TIMESTAMP",
    "LMST",
    "LTST",
    "BOOM1_BOARD1_B_LONG",
    "BOOM1_BOARD1_B_TRANS",
    "BRIGHTNESS_TEMP_A",
    "BOOM1_AIR_TEMP",
    "BOOM1_TIP_AIR_TEMP",
    "UV_ABC",
    "HUMIDITY_CHANNEL_A",
    "BAROCAP_PRESSURE_1",
)

MISSING = -9.99e2
FILL = -9999.0


def read_fields(xml_path: Path) -> list[tuple[str, int, int]]:
    root = ET.parse(xml_path).getroot()
    fields = []
    for element in root.iter():
        if not element.tag.endswith("Field_Character"):
            continue
        values = {}
        for child in element:
            values[child.tag.split("}")[-1]] = child.text
        fields.append(
            (
                values["name"],
                int(values["field_location"]),
                int(values["field_length"]),
            )
        )
    return fields


def read_table(tab_path: Path, fields, keep=KEEP) -> dict[str, np.ndarray]:
    selected = [field for field in fields if field[0] in keep]
    records = []
    with Path(tab_path).open("r", encoding="ascii", errors="ignore") as handle:
        for line in handle:
            line = line.rstrip("\r\n")
            if len(line) < 40:
                continue
            records.append(
                [
                    line[location - 1 : location - 1 + length].strip().strip('"')
                    for _, location, length in selected
                ]
            )
    columns = {}
    for index, (name, _, _) in enumerate(selected):
        raw = [record[index] for record in records]
        try:
            values = np.array([float(value) for value in raw], dtype="float64")
            values[values <= MISSING] = np.nan
        except ValueError:
            values = np.array(raw, dtype=object)
        columns[name] = values
    return columns


def parse_sol(sol_dir: Path, out_csv: Path) -> int:
    sol_dir = Path(sol_dir)
    xml_path = next(sol_dir.glob("*RNV*.xml"))
    tab_path = next(sol_dir.glob("*RNV*.TAB"))
    fields = read_fields(xml_path)
    columns = read_table(tab_path, fields)
    out_csv.parent.mkdir(parents=True, exist_ok=True)
    names = list(columns)
    count = len(columns[names[0]])
    with out_csv.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(names)
        for row in range(count):
            writer.writerow([columns[name][row] for name in names])
    return count
