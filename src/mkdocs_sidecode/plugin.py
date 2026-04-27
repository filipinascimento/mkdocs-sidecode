from __future__ import annotations

import json
import shutil
from pathlib import Path

from mkdocs.plugins import BasePlugin

from .models import ResolvedExample
from .parser import transform_markdown


class SidecodePlugin(BasePlugin):
    def __init__(self) -> None:
        self._page_examples: dict[str, list[ResolvedExample]] = {}
        self._assets_src = Path(__file__).parent / "assets"

    def on_page_markdown(self, markdown: str, page, config, files):  # noqa: ANN001
        page_key = page.file.src_uri.replace("/", "--")
        transformed, examples = transform_markdown(markdown, page_key)
        self._page_examples[page.file.src_path] = examples
        return transformed

    def on_page_content(self, html: str, page, config, files):  # noqa: ANN001
        examples = self._page_examples.get(page.file.src_path, [])
        if not examples:
            return html
        asset_prefix = self._asset_prefix_for_page(page)

        payload = {
            "examples": [
                {
                    "id": example.example_id,
                    "title": example.title,
                    "render": example.attrs.get("render", True) is not False,
                    "console": example.attrs.get("console", False) is True,
                    "layout": example.attrs.get("layout", "split"),
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
<link rel="stylesheet" href="{asset_prefix}assets/mkdocs-sidecode/styles.css">
<script type="application/json" class="mkdocs-sidecode-page-data">{payload}</script>
<script type="module" src="{asset_prefix}assets/mkdocs-sidecode/runtime.js"></script>
""".strip().format(payload=json.dumps(payload), asset_prefix=asset_prefix)
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

    def _asset_prefix_for_page(self, page) -> str:  # noqa: ANN001
        url = (getattr(page, "url", None) or "").strip("/")
        if not url or url == "index.html":
            return ""
        clean_url = url[:-10] if url.endswith("/index.html") else url
        clean_url = clean_url.strip("/")
        if not clean_url:
            return ""
        depth = len([part for part in clean_url.split("/") if part])
        return "../" * depth
