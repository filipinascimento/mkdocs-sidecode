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
```javascript helios-example title="Basic Example" console=true
#%BODY demo
console.log('interactive');
```
"""
    transformed = plugin.on_page_markdown(markdown, page, {}, None)
    assert 'data-helios-example="docs--index.md--example-1"' in transformed

    html = plugin.on_page_content("<p>Body</p>", page, {}, None)
    assert "runtime.js" in html
    assert "styles.css" in html
    assert "mkdocs-sidecode-page-data" in html

    payload_text = html.split('class="mkdocs-sidecode-page-data">', 1)[1].split("</script>", 1)[0]
    payload = json.loads(payload_text)
    assert payload["examples"][0]["bodyName"] == "demo"
