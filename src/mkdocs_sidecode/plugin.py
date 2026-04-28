from __future__ import annotations

import json
import shutil
from pathlib import Path

from mkdocs.plugins import BasePlugin

from .models import ResolvedExample
from .parser import _css_size, transform_markdown


class SidecodePlugin(BasePlugin):
    def __init__(self) -> None:
        self._page_examples: dict[str, list[ResolvedExample]] = {}
        self._assets_src = Path(__file__).parent / "assets"

    def on_config(self, config):  # noqa: ANN001
        config.setdefault("extra_css", [])
        config.setdefault("extra_javascript", [])
        if "assets/mkdocs-sidecode/styles.css" not in config["extra_css"]:
            config["extra_css"].append("assets/mkdocs-sidecode/styles.css")
        if "assets/mkdocs-sidecode/runtime.js" not in config["extra_javascript"]:
            config["extra_javascript"].append("assets/mkdocs-sidecode/runtime.js")
        return config

    def on_page_markdown(self, markdown: str, page, config, files):  # noqa: ANN001
        page_key = page.file.src_uri.replace("/", "--")
        transformed, examples = transform_markdown(markdown, page_key)
        self._page_examples[page.file.src_path] = examples
        return transformed

    def on_page_content(self, html: str, page, config, files):  # noqa: ANN001
        examples = self._page_examples.get(page.file.src_path, [])
        if not examples:
            return html

        payload = {
            "examples": [
                {
                    "id": example.example_id,
                    "title": example.title,
                    "render": example.attrs.get("render", True) is not False,
                    "console": example.attrs.get("console", False) is True,
                    "autorun": example.attrs.get("autorun", True) is not False,
                    "layout": example.attrs.get("layout", "split"),
                    "width": _css_size(example.attrs.get("width")),
                    "height": _css_size(example.attrs.get("height")),
                    "headerName": example.header_name,
                    "headerCode": example.header_code,
                    "bodyName": example.body_name,
                    "bodyCode": example.body_code,
                    "headerRefs": [
                        {
                            "fragment_type": ref.fragment_type,
                            "name": ref.name,
                            "example_id": ref.example_id,
                            "code": ref.code,
                        }
                        for ref in example.resolved_header_refs
                    ],
                    "bodyRefs": [
                        {
                            "fragment_type": ref.fragment_type,
                            "name": ref.name,
                            "example_id": ref.example_id,
                            "code": ref.code,
                        }
                        for ref in example.resolved_body_refs
                    ],
                }
                for example in examples
            ]
        }

        runtime = """
<script type="application/json" class="mkdocs-sidecode-page-data">{payload}</script>
""".strip().format(payload=json.dumps(payload))
        return f"{html}\n{runtime}"

    def on_post_build(self, config):  # noqa: ANN001
        if not self._assets_src.exists():
            raise FileNotFoundError(
                "MkDocs Sidecode frontend assets are missing. Run 'npm run build' in mkdocs-sidecode first."
            )
        target = Path(config["site_dir"]) / "assets" / "mkdocs-sidecode"
        target.mkdir(parents=True, exist_ok=True)
        for asset in self._assets_src.iterdir():
            shutil.copy2(asset, target / asset.name)
