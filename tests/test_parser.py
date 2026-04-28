from __future__ import annotations

import pytest
import html as html_lib
import json

from mkdocs_sidecode.parser import (
    ExampleParseError,
    parse_example_block,
    parse_info_string,
    render_example_html,
    resolve_examples,
    transform_markdown,
)


def test_parse_info_string_detects_marker_on_javascript_fence():
    attrs = parse_info_string('javascript sidecode title="Basic Example" console=true height=420 autorun=false')
    assert attrs == {
        "title": "Basic Example",
        "console": True,
        "height": "420",
        "autorun": False,
    }


def test_parse_info_string_supports_braced_marker():
    attrs = parse_info_string('javascript {sidecode} title="Basic Example"')
    assert attrs == {"title": "Basic Example"}


def test_parse_example_block_extracts_sections_and_refs():
    block = parse_example_block(
        'javascript sidecode title="Reference Example"',
        "\n".join(
            [
                "//@REF HEADER base_setup",
                "//@REF BODY setup_body",
                "",
                "//@HEADER local_setup",
                "const ready = true;",
                "",
                "//@BODY followup",
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
        ("body", "setup_body"),
    ]


def test_resolve_examples_rejects_missing_fragment():
    first = parse_example_block(
        "javascript sidecode",
        "//@REF BODY missing\n//@BODY body_one\nconsole.log('x');",
        "example-1",
    )
    with pytest.raises(ExampleParseError, match="missing BODY fragment 'missing'"):
        resolve_examples([first])


def test_resolve_examples_rejects_self_reference_cycle():
    block = parse_example_block(
        "javascript sidecode",
        "//@REF BODY body_one\n//@BODY body_one\nconsole.log('x');",
        "example-1",
    )
    with pytest.raises(ExampleParseError, match="circular self-reference"):
        resolve_examples([block])


def test_transform_markdown_replaces_only_marked_javascript_fences():
    markdown = """
```javascript
console.log('plain');
```

```javascript sidecode title="Basic Example" console=true
//@BODY demo
console.log('interactive');
```
"""
    transformed, examples = transform_markdown(markdown, "docs--index-md")
    assert "console.log('plain');" in transformed
    assert 'data-sidecode-example="docs--index-md--example-1"' in transformed
    assert len(examples) == 1


def test_render_example_html_includes_console_panel_when_enabled():
    markdown = """
```javascript sidecode title="Console Example" console=true
//@BODY demo
console.log('interactive');
```
"""
    _, examples = transform_markdown(markdown, "docs--console-md")
    html = render_example_html(examples[0])
    assert 'data-role="console"' in html
    assert "Console Example" in html


def test_render_example_html_supports_untitled_sized_console_only_examples():
    markdown = """
```javascript sidecode console=true render=false width=720 height="30rem" autorun=false
//@BODY demo
console.log('interactive');
```
"""
    _, examples = transform_markdown(markdown, "docs--console-only-md")
    html = render_example_html(examples[0])
    assert "sidecode__title" not in html
    assert 'data-role="console"' in html
    assert 'data-role="render"></div>' not in html
    assert "--sidecode-width: 720px" in html
    assert "--sidecode-height: 30rem" in html
    payload_text = html.split('data-config="', 1)[1].split('"', 1)[0]
    payload = json.loads(html_lib.unescape(payload_text))
    assert payload["autorun"] is False


def test_render_example_html_rejects_invalid_css_size():
    markdown = """
```javascript sidecode height="url(javascript:bad)"
//@BODY demo
console.log('interactive');
```
"""
    with pytest.raises(ExampleParseError, match="Invalid CSS size value"):
        transform_markdown(markdown, "docs--bad-size-md")
