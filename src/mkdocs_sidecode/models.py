from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class FragmentReference:
    fragment_type: str
    name: str


@dataclass
class ExampleBlock:
    example_id: str
    title: str | None
    attrs: dict[str, object]
    header_name: str | None
    header_code: str
    body_name: str | None
    body_code: str
    refs: list[FragmentReference] = field(default_factory=list)


@dataclass
class FragmentDefinition:
    fragment_type: str
    name: str
    example_id: str
    code: str


@dataclass
class ResolvedExample:
    example_id: str
    title: str | None
    attrs: dict[str, object]
    header_name: str | None
    header_code: str
    body_name: str | None
    body_code: str
    resolved_header_refs: list[FragmentDefinition]
    resolved_body_refs: list[FragmentDefinition]
