#!/usr/bin/env python3
"""Run non-rendering structural QA for a PowerPoint package.

This check is intentionally compatible with local macOS environments where
LibreOffice and Poppler are unavailable. It verifies ZIP integrity, XML
well-formedness, content-type declarations, relationship targets, and the
presentation's slide list without rendering slide pixels or enforcing strict
OOXML element ordering.
"""

from __future__ import annotations

import argparse
import posixpath
import sys
import zipfile
from collections import Counter
from pathlib import Path
from urllib.parse import unquote, urlsplit

from defusedxml import ElementTree


CONTENT_TYPES_NAMESPACE = (
    "http://schemas.openxmlformats.org/package/2006/content-types"
)
OFFICE_RELATIONSHIPS_NAMESPACE = (
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
)
PACKAGE_RELATIONSHIPS_NAMESPACE = (
    "http://schemas.openxmlformats.org/package/2006/relationships"
)
PRESENTATION_NAMESPACE = (
    "http://schemas.openxmlformats.org/presentationml/2006/main"
)
REQUIRED_PARTS = {
    "[Content_Types].xml",
    "_rels/.rels",
    "ppt/_rels/presentation.xml.rels",
    "ppt/presentation.xml",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate PPTX package structure without rendering slides."
    )
    parser.add_argument("presentation", help="Path to the .pptx file to inspect.")
    return parser.parse_args()


def package_path_is_safe(name: str) -> bool:
    if not name or "\\" in name or name.startswith("/"):
        return False

    normalized = posixpath.normpath(name)
    return (
        normalized not in {".", ".."}
        and not normalized.startswith("../")
        and normalized == name.rstrip("/")
    )


def relationship_source_part(relationships_part: str) -> str | None:
    if relationships_part == "_rels/.rels":
        return ""

    parent, filename = posixpath.split(relationships_part)
    if posixpath.basename(parent) != "_rels" or not filename.endswith(".rels"):
        return None

    owner_directory = posixpath.dirname(parent)
    owner_filename = filename[: -len(".rels")]
    return posixpath.join(owner_directory, owner_filename)


def resolve_relationship_target(source_part: str, raw_target: str) -> str | None:
    parsed = urlsplit(raw_target)
    if parsed.scheme or parsed.netloc:
        return None

    target = unquote(parsed.path)
    if not target:
        return None

    if target.startswith("/"):
        resolved = posixpath.normpath(target.lstrip("/"))
    else:
        resolved = posixpath.normpath(
            posixpath.join(posixpath.dirname(source_part), target)
        )

    if resolved in {"", ".", ".."} or resolved.startswith("../"):
        return None

    return resolved


def inspect_presentation(path: Path) -> tuple[list[str], dict[str, int]]:
    errors: list[str] = []
    summary = {
        "external_relationships": 0,
        "package_parts": 0,
        "relationships": 0,
        "slides": 0,
        "xml_parts": 0,
    }

    if not path.is_file():
        return [f"File does not exist: {path}"], summary

    if path.suffix.lower() != ".pptx":
        errors.append(f"Expected a .pptx file: {path}")

    try:
        archive = zipfile.ZipFile(path)
    except (OSError, zipfile.BadZipFile) as error:
        return [f"Cannot open PPTX ZIP package: {error}"], summary

    with archive:
        infos = [info for info in archive.infolist() if not info.is_dir()]
        names = [info.filename for info in infos]
        name_set = set(names)
        summary["package_parts"] = len(names)

        duplicate_names = sorted(
            name for name, count in Counter(names).items() if count > 1
        )
        for name in duplicate_names:
            errors.append(f"Duplicate package part: {name}")

        for name in names:
            if not package_path_is_safe(name):
                errors.append(f"Unsafe or non-canonical package path: {name}")

        bad_crc = archive.testzip()
        if bad_crc:
            errors.append(f"ZIP CRC check failed for: {bad_crc}")

        for required_part in sorted(REQUIRED_PARTS - name_set):
            errors.append(f"Missing required package part: {required_part}")

        parsed_xml: dict[str, ElementTree.Element] = {}
        xml_names = sorted(
            name
            for name in names
            if name == "[Content_Types].xml"
            or name.endswith(".xml")
            or name.endswith(".rels")
        )
        summary["xml_parts"] = len(xml_names)

        for name in xml_names:
            try:
                parsed_xml[name] = ElementTree.fromstring(archive.read(name))
            except Exception as error:
                errors.append(f"Malformed XML in {name}: {error}")

        content_types = parsed_xml.get("[Content_Types].xml")
        if content_types is not None:
            if content_types.tag != f"{{{CONTENT_TYPES_NAMESPACE}}}Types":
                errors.append("[Content_Types].xml has an unexpected root element.")

            presentation_declared = False
            for override in content_types.findall(
                f"{{{CONTENT_TYPES_NAMESPACE}}}Override"
            ):
                part_name = override.attrib.get("PartName", "")
                normalized_part = part_name.lstrip("/")
                if normalized_part == "ppt/presentation.xml":
                    presentation_declared = True

            if not presentation_declared:
                errors.append(
                    "Missing content-type declaration for /ppt/presentation.xml"
                )

        relationship_maps: dict[
            str, dict[str, tuple[str, str | None, bool]]
        ] = {}
        relationship_tag = f"{{{PACKAGE_RELATIONSHIPS_NAMESPACE}}}Relationship"

        for relationships_part in sorted(
            name for name in names if name.endswith(".rels")
        ):
            root = parsed_xml.get(relationships_part)
            if root is None:
                continue

            source_part = relationship_source_part(relationships_part)
            if source_part is None:
                errors.append(
                    f"Relationship part has an invalid package location: "
                    f"{relationships_part}"
                )
                continue

            relationships: dict[str, tuple[str, str | None, bool]] = {}
            for relationship in root.findall(relationship_tag):
                relationship_id = relationship.attrib.get("Id", "")
                relationship_type = relationship.attrib.get("Type", "")
                raw_target = relationship.attrib.get("Target", "")
                is_external = (
                    relationship.attrib.get("TargetMode", "").lower()
                    == "external"
                )
                summary["relationships"] += 1

                if not relationship_id:
                    errors.append(
                        f"Relationship without Id in {relationships_part}"
                    )
                    continue
                if relationship_id in relationships:
                    errors.append(
                        f"Duplicate relationship Id {relationship_id} in "
                        f"{relationships_part}"
                    )
                    continue

                if is_external:
                    summary["external_relationships"] += 1
                    resolved_target = None
                else:
                    resolved_target = resolve_relationship_target(
                        source_part, raw_target
                    )
                    if resolved_target is None:
                        errors.append(
                            f"Invalid internal relationship target "
                            f"{raw_target!r} in {relationships_part}"
                        )
                    elif resolved_target not in name_set:
                        errors.append(
                            f"Broken relationship {relationship_id} in "
                            f"{relationships_part}: {resolved_target}"
                        )

                relationships[relationship_id] = (
                    relationship_type,
                    resolved_target,
                    is_external,
                )

            relationship_maps[relationships_part] = relationships

        presentation = parsed_xml.get("ppt/presentation.xml")
        presentation_relationships = relationship_maps.get(
            "ppt/_rels/presentation.xml.rels", {}
        )
        if presentation is not None:
            slide_ids = presentation.findall(
                f".//{{{PRESENTATION_NAMESPACE}}}sldId"
            )
            summary["slides"] = len(slide_ids)
            if not slide_ids:
                errors.append("Presentation contains no slides.")

            seen_numeric_ids: set[str] = set()
            seen_relationship_ids: set[str] = set()
            relationship_id_attribute = (
                f"{{{OFFICE_RELATIONSHIPS_NAMESPACE}}}id"
            )

            for slide_id in slide_ids:
                numeric_id = slide_id.attrib.get("id", "")
                relationship_id = slide_id.attrib.get(
                    relationship_id_attribute, ""
                )

                if not numeric_id:
                    errors.append("Slide entry is missing its numeric id.")
                elif numeric_id in seen_numeric_ids:
                    errors.append(f"Duplicate slide numeric id: {numeric_id}")
                seen_numeric_ids.add(numeric_id)

                if not relationship_id:
                    errors.append(
                        f"Slide {numeric_id or '?'} is missing its relationship id."
                    )
                    continue
                if relationship_id in seen_relationship_ids:
                    errors.append(
                        f"Duplicate slide relationship id: {relationship_id}"
                    )
                seen_relationship_ids.add(relationship_id)

                relationship = presentation_relationships.get(relationship_id)
                if relationship is None:
                    errors.append(
                        f"Slide {numeric_id or '?'} references missing "
                        f"relationship {relationship_id}."
                    )
                    continue

                relationship_type, target, is_external = relationship
                if is_external or not relationship_type.endswith("/slide"):
                    errors.append(
                        f"Slide {numeric_id or '?'} relationship "
                        f"{relationship_id} is not an internal slide."
                    )
                elif target is None or target not in name_set:
                    errors.append(
                        f"Slide {numeric_id or '?'} target is missing: {target}"
                    )

    return errors, summary


def main() -> int:
    args = parse_args()
    path = Path(args.presentation).expanduser().resolve()
    errors, summary = inspect_presentation(path)

    if errors:
        print(f"FAIL {path}", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print(
        f"PASS {path}: {summary['slides']} slides, "
        f"{summary['package_parts']} package parts, "
        f"{summary['relationships']} relationships, "
        f"{summary['xml_parts']} XML parts parsed"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
