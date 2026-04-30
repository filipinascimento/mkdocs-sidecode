from __future__ import annotations

import html
import json
import re
import shlex
from dataclasses import asdict
from typing import Iterable

from .models import ExampleBlock, FragmentDefinition, FragmentReference, ResolvedExample

FENCE_PATTERN = re.compile(
    r"(?P<indent>^[ \t]*)```(?P<info>[^\n]*)\n(?P<code>.*?)\n(?P=indent)```",
    re.MULTILINE | re.DOTALL,
)
DIRECTIVE_PATTERN = re.compile(r"^//\s*@(?P<directive>[A-Z]+)(?:\s+(?P<rest>.+))?$")
CSS_SIZE_PATTERN = re.compile(
    r"^(?:\d+(?:\.\d+)?(?:px|rem|em|vh|vw|vmin|vmax|%|ch)|auto|fit-content|min-content|max-content)$"
)


class ExampleParseError(ValueError):
    """Raised when an interactive example fence is invalid."""


def parse_info_string(info_string: str) -> dict[str, object] | None:
    try:
        parts = shlex.split(info_string)
    except ValueError as exc:
        raise ExampleParseError(f"Invalid fence info string: {info_string}") from exc

    if not parts or parts[0] != "javascript":
        return None

    markers = set(parts[1:])
    has_marker = "sidecode" in markers or "{sidecode}" in markers
    if not has_marker:
        return None

    attrs: dict[str, object] = {}
    for token in parts[1:]:
        if token in {"sidecode", "{sidecode}"}:
            continue
        if "=" not in token:
            attrs[token] = True
            continue
        key, value = token.split("=", 1)
        attrs[key] = _coerce_attr_value(value)
    return attrs


def _coerce_attr_value(value: str) -> object:
    lowered = value.lower()
    if lowered == "true":
        return True
    if lowered == "false":
        return False
    return value


def parse_example_block(info_string: str, source: str, example_id: str) -> ExampleBlock:
    attrs = parse_info_string(info_string)
    if attrs is None:
        raise ExampleParseError("Fence is not an interactive example block.")

    refs: list[FragmentReference] = []
    header_name: str | None = None
    header_lines: list[str] = []
    body_name: str | None = None
    body_lines: list[str] = []
    current_section: str | None = None

    for line_number, raw_line in enumerate(source.splitlines(), start=1):
        directive_match = DIRECTIVE_PATTERN.match(raw_line.strip())
        if directive_match:
            directive = directive_match.group("directive")
            rest = (directive_match.group("rest") or "").strip()
            if directive in {"HEADER", "BODY"}:
                if not rest:
                    raise ExampleParseError(
                        f"Line {line_number}: //@{directive} must include a fragment name."
                    )
                current_section = directive
                if directive == "HEADER":
                    if header_name is not None:
                        raise ExampleParseError("Each example may only define one HEADER section.")
                    header_name = rest
                else:
                    if body_name is not None:
                        raise ExampleParseError("Each example may only define one BODY section.")
                    body_name = rest
                continue
            if directive == "REF":
                ref_parts = rest.split(None, 1)
                if len(ref_parts) != 2:
                    raise ExampleParseError(
                        f"Line {line_number}: REF directives must be '//@REF HEADER <name>' or '//@REF BODY <name>'."
                    )
                fragment_type, name = ref_parts
                fragment_type = fragment_type.upper()
                if fragment_type not in {"HEADER", "BODY"}:
                    raise ExampleParseError(
                        f"Line {line_number}: REF fragment type must be HEADER or BODY."
                    )
                refs.append(FragmentReference(fragment_type.lower(), name))
                continue
            raise ExampleParseError(f"Line {line_number}: Unsupported directive '//@{directive}'.")

        if current_section == "HEADER":
            header_lines.append(raw_line)
        elif current_section == "BODY":
            body_lines.append(raw_line)
        elif raw_line.strip():
            raise ExampleParseError(
                f"Line {line_number}: content must appear inside a HEADER or BODY section."
            )

    if body_name is None:
        raise ExampleParseError("Each example must define a BODY section.")

    return ExampleBlock(
        example_id=example_id,
        title=attrs.get("title") if isinstance(attrs.get("title"), str) else None,
        attrs=attrs,
        header_name=header_name,
        header_code="\n".join(header_lines).strip(),
        body_name=body_name,
        body_code="\n".join(body_lines).strip(),
        refs=refs,
    )


def resolve_examples(examples: Iterable[ExampleBlock]) -> tuple[list[ResolvedExample], dict[str, FragmentDefinition]]:
    fragment_defs: dict[str, FragmentDefinition] = {}
    resolved: list[ResolvedExample] = []

    for example in examples:
        if _has_cycle(example):
            raise ExampleParseError(
                f"Example '{example.example_id}' contains a circular self-reference in its REF directives."
            )

        for ref in example.refs:
            key = _fragment_key(ref.fragment_type, ref.name)
            if key not in fragment_defs:
                raise ExampleParseError(
                    f"Example '{example.example_id}' references missing {ref.fragment_type.upper()} fragment '{ref.name}'."
                )

        if example.header_name:
            key = _fragment_key("header", example.header_name)
            if key in fragment_defs:
                raise ExampleParseError(f"Duplicate HEADER fragment name '{example.header_name}'.")
            fragment_defs[key] = FragmentDefinition(
                fragment_type="header",
                name=example.header_name,
                example_id=example.example_id,
                code=example.header_code,
            )
        if example.body_name:
            key = _fragment_key("body", example.body_name)
            if key in fragment_defs:
                raise ExampleParseError(f"Duplicate BODY fragment name '{example.body_name}'.")
            fragment_defs[key] = FragmentDefinition(
                fragment_type="body",
                name=example.body_name,
                example_id=example.example_id,
                code=example.body_code,
            )

        resolved_header_refs = [
            fragment_defs[_fragment_key("header", ref.name)]
            for ref in example.refs
            if ref.fragment_type == "header"
        ]
        resolved_body_refs = [
            fragment_defs[_fragment_key("body", ref.name)]
            for ref in example.refs
            if ref.fragment_type == "body"
        ]

        resolved.append(
            ResolvedExample(
                example_id=example.example_id,
                title=example.title,
                attrs=example.attrs,
                header_name=example.header_name,
                header_code=example.header_code,
                body_name=example.body_name,
                body_code=example.body_code,
                resolved_header_refs=resolved_header_refs,
                resolved_body_refs=resolved_body_refs,
            )
        )

    return resolved, fragment_defs


def _has_cycle(example: ExampleBlock) -> bool:
    local_names = {
        ("header", example.header_name) if example.header_name else None,
        ("body", example.body_name) if example.body_name else None,
    }
    local_names.discard(None)
    return any((ref.fragment_type, ref.name) in local_names for ref in example.refs)


def _fragment_key(fragment_type: str, name: str) -> str:
    return f"{fragment_type}:{name}"


def render_example_html(example: ResolvedExample) -> str:
    attrs = example.attrs
    render_enabled = attrs.get("render", True) is not False
    console_enabled = attrs.get("console", False) is True
    autorun_enabled = attrs.get("autorun", True) is not False
    layout = attrs.get("layout", "split")
    width = _css_size(attrs.get("width"))
    height = _css_size(attrs.get("height"))
    title_html = (
        f'<div class="sidecode__title">{html.escape(example.title)}</div>'
        if example.title
        else ""
    )
    refs_html = _refs_html(example)

    payload = {
        "id": example.example_id,
        "title": example.title,
        "render": render_enabled,
        "console": console_enabled,
        "autorun": autorun_enabled,
        "layout": layout,
        "width": width,
        "height": height,
        "headerName": example.header_name,
        "headerCode": example.header_code,
        "bodyName": example.body_name,
        "bodyCode": example.body_code,
        "headerRefs": [asdict(ref) for ref in example.resolved_header_refs],
        "bodyRefs": [asdict(ref) for ref in example.resolved_body_refs],
    }

    data = html.escape(json.dumps(payload))
    style = _style_attr(width, height)
    panels = []
    if render_enabled:
        panels.append('<div class="sidecode__render" data-role="render"></div>')
    if console_enabled:
        panels.append('<pre class="sidecode__console" data-role="console"></pre>')
    panel_html = "\n".join(panels)
    header_disabled = "" if example.header_code or example.resolved_header_refs else " disabled"
    render_tab_disabled = "" if render_enabled else " disabled"
    console_tab_disabled = "" if console_enabled else " disabled"

    return f"""
<div class="sidecode" data-sidecode-example="{html.escape(example.example_id)}" data-config="{data}"{style}>
  {title_html}
  <div class="sidecode__grid sidecode__grid--{html.escape(str(layout))}">
    <section class="sidecode__pane sidecode__pane--code">
      <div class="sidecode__toolbar">
        <div class="sidecode__tabs" role="tablist" aria-label="Code sections">
          <button class="sidecode__tab is-active" type="button" data-role="body-tab">Body</button>
          <button class="sidecode__tab" type="button" data-role="header-tab"{header_disabled}>Header</button>
        </div>
        <button class="sidecode__icon-button" type="button" data-role="run" aria-label="Run example" title="Run">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"></path></svg>
        </button>
      </div>
      {refs_html}
      <div class="sidecode__editor" data-role="body-editor"></div>
      <div class="sidecode__editor is-hidden" data-role="header-editor"></div>
    </section>
    <section class="sidecode__pane sidecode__pane--output" data-role="output">
      <div class="sidecode__toolbar">
        <div class="sidecode__tabs" role="tablist" aria-label="Output panels">
          <button class="sidecode__tab is-active" type="button" data-role="render-tab"{render_tab_disabled}>Render</button>
          <button class="sidecode__tab" type="button" data-role="console-tab"{console_tab_disabled}>Console</button>
        </div>
      </div>
      <div class="sidecode__output-panels">
      {panel_html}
      </div>
    </section>
  </div>
</div>
""".strip()


def _refs_html(example: ResolvedExample) -> str:
    refs = [
        ("HEADER", ref.name, ref.example_id)
        for ref in example.resolved_header_refs
    ] + [
        ("BODY", ref.name, ref.example_id)
        for ref in example.resolved_body_refs
    ]
    if not refs:
        return ""
    chips = "\n".join(
        (
            '<button class="sidecode__ref-chip" type="button" '
            f'data-ref-kind="{html.escape(kind.lower())}" '
            f'data-ref-name="{html.escape(name)}" '
            f'data-ref-example-id="{html.escape(example_id)}">'
            f'<span>{html.escape(kind)}</span> {html.escape(name)}</button>'
        )
        for kind, name, example_id in refs
    )
    return f"""
      <div class="sidecode__refs" aria-label="Referenced fragments">
        <span class="sidecode__refs-label">Uses code from</span>
        {chips}
      </div>
""".rstrip()


def _css_size(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    if normalized.isdigit():
        normalized = f"{normalized}px"
    if CSS_SIZE_PATTERN.match(normalized):
        return normalized
    raise ExampleParseError(f"Invalid CSS size value '{value}'.")


def _style_attr(width: str | None, height: str | None) -> str:
    declarations: list[str] = []
    if width:
        declarations.append(f"--sidecode-width: {width}")
    if height:
        declarations.append(f"--sidecode-height: {height}")
    if not declarations:
        return ""
    return f' style="{html.escape("; ".join(declarations))}"'


def transform_markdown(markdown: str, page_key: str) -> tuple[str, list[ResolvedExample]]:
    parsed_blocks: list[ExampleBlock] = []
    replacements: list[tuple[tuple[int, int], str]] = []
    example_count = 0

    for match in FENCE_PATTERN.finditer(markdown):
        info = match.group("info").strip()
        attrs = parse_info_string(info)
        if attrs is None:
            continue
        example_count += 1
        example_id = f"{page_key}--example-{example_count}"
        block = parse_example_block(info, match.group("code"), example_id)
        parsed_blocks.append(block)
        replacements.append(((match.start(), match.end()), block.example_id))

    resolved_examples, _ = resolve_examples(parsed_blocks)
    resolved_by_id = {example.example_id: example for example in resolved_examples}

    if not replacements:
        return markdown, []

    output_parts: list[str] = []
    last_index = 0
    for (start, end), example_id in replacements:
        output_parts.append(markdown[last_index:start])
        output_parts.append(render_example_html(resolved_by_id[example_id]))
        last_index = end
    output_parts.append(markdown[last_index:])
    return "".join(output_parts), resolved_examples
