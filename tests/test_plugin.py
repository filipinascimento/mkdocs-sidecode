from __future__ import annotations

import json
from types import SimpleNamespace

from mkdocs_sidecode.plugin import SidecodePlugin


def test_plugin_injects_runtime_when_examples_exist():
    plugin = SidecodePlugin()
    page = SimpleNamespace(
        file=SimpleNamespace(src_uri="docs/index.md", src_path="docs/index.md")
    )
    markdown = """
```javascript sidecode title="Basic Example" console=true height=420 autorun=false
//@BODY demo
console.log('interactive');
```
"""
    transformed = plugin.on_page_markdown(markdown, page, {}, None)
    assert 'data-sidecode-example="docs--index.md--example-1"' in transformed

    html = plugin.on_page_content("<p>Body</p>", page, {}, None)
    assert "mkdocs-sidecode-page-data" in html

    payload_text = html.split('class="mkdocs-sidecode-page-data">', 1)[1].split("</script>", 1)[0]
    payload = json.loads(payload_text)
    assert payload["examples"][0]["bodyName"] == "demo"
    assert payload["examples"][0]["height"] == "420px"
    assert payload["examples"][0]["autorun"] is False


def test_plugin_registers_global_assets():
    plugin = SidecodePlugin()
    config = {}
    updated = plugin.on_config(config)
    assert "assets/mkdocs-sidecode/styles.css" in updated["extra_css"]
    assert "assets/mkdocs-sidecode/runtime.js" in updated["extra_javascript"]
