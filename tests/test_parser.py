from __future__ import annotations

import pytest

from mkdocs_sidecode.parser import (
    ExampleParseError,
    parse_example_block,
    parse_info_string,
    render_example_html,
    resolve_examples,
    transform_markdown,
)


def test_parse_info_string_detects_marker_on_javascript_fence():
    attrs = parse_info_string('javascript helios-example title="Basic Example" console=true')
    assert attrs == {"title": "Basic Example", "console": True}


def test_parse_info_string_supports_braced_marker():
    attrs = parse_info_string('javascript {helios-example} title="Basic Example"')
    assert attrs == {"title": "Basic Example"}


def test_parse_example_block_extracts_sections_and_refs():
    block = parse_example_block(
        'javascript helios-example title="Selection Example"',
        "\n".join(
            [
                "#%REF HEADER base_setup",
                "#%REF BODY selection_demo",
                "",
                "#%HEADER local_setup",
                "const ready = true;",
                "",
                "#%BODY followup",
                "console.log(ready);",
            ]
        ),
        "example-1",
    )
    assert block.header_name == "local_setup"
    assert block.body_name == "followup"
    assert block.header_code == "const ready = true;"
    assert block.body_code == "console.log(ready);"
    assert [(ref.fragment_type, ref.name) for ref in block.refs] == [
        ("header", "base_setup"),
        ("body", "selection_demo"),
    ]


def test_resolve_examples_rejects_missing_fragment():
    first = parse_example_block(
        "javascript helios-example",
        "#%REF BODY missing\n#%BODY body_one\nconsole.log('x');",
        "example-1",
    )
    with pytest.raises(ExampleParseError, match="missing BODY fragment 'missing'"):
        resolve_examples([first])


def test_resolve_examples_rejects_self_reference_cycle():
    block = parse_example_block(
        "javascript helios-example",
        "#%REF BODY body_one\n#%BODY body_one\nconsole.log('x');",
        "example-1",
    )
    with pytest.raises(ExampleParseError, match="circular self-reference"):
        resolve_examples([block])


def test_transform_markdown_replaces_only_marked_javascript_fences():
    markdown = """
```javascript
console.log('plain');
```

```javascript helios-example title="Basic Example" console=true
#%BODY demo
console.log('interactive');
```
"""
    transformed, examples = transform_markdown(markdown, "docs--index-md")
    assert "console.log('plain');" in transformed
    assert 'data-helios-example="docs--index-md--example-1"' in transformed
    assert len(examples) == 1


def test_render_example_html_includes_console_panel_when_enabled():
    markdown = """
```javascript helios-example title="Console Example" console=true
#%BODY demo
console.log('interactive');
```
"""
    _, examples = transform_markdown(markdown, "docs--console-md")
    html = render_example_html(examples[0])
    assert 'data-role="console"' in html
    assert "Console Example" in html
