# MkDocs Sidecode

`mkdocs-sidecode` is a separate MkDocs plugin project for interactive side-by-side documentation examples. It turns specially marked JavaScript fences into side-by-side examples with an editable editor, live output, optional console capture, named fragments, and deterministic fragment references.

The fence intentionally stays `javascript` so ordinary Markdown editors still highlight the source as JavaScript:

````markdown
```javascript sidecode title="Counter Example" console=true height=420
//@HEADER counter_setup
container.innerHTML = '<button type="button">Count: 0</button>';
const button = container.querySelector('button');
let count = 0;

function setCount(value) {
  count = value;
  button.textContent = `Count: ${count}`;
}

//@BODY counter_body
setCount(3);
console.log('counter initialized');
```
````

## Why `javascript` Fences Stay Intact

The plugin does not introduce a custom fence language such as `sidecode`. Instead it recognizes JavaScript fences whose info string also contains `sidecode`. That keeps normal editor highlighting intact while still giving MkDocs a reliable marker.

Supported forms:

- ```` ```javascript sidecode title="Basic Example" ````
- ```` ```javascript sidecode ````
- ```` ```javascript {sidecode} title="Basic Example" ````

Fence options:

- `title="..."`: optional heading. Omit it for an untitled example.
- `console=true`: add a console panel and capture `console.log`, `console.info`, `console.warn`, and `console.error`.
- `render=false console=true`: show only the console panel. A hidden runtime container is still created so examples can safely use `container`.
- `width=720` or `width="42rem"`: set the example width. Bare numbers are treated as pixels.
- `height=420` or `height="32rem"`: set the editor/output height. Bare numbers are treated as pixels.
- `autorun=false`: disable initial and debounced edit-time execution. The Run button and `Cmd/Ctrl+Enter` still execute the example.
- `autorun=true`: default behavior. Edits rerun with a short debounce, and incomplete JavaScript is skipped until it parses.

## Authoring Syntax

Supported directives inside the fence:

- `//@HEADER <name>`: hidden setup code that runs before the editable body.
- `//@BODY <name>`: visible editable code shown in the editor.
- `//@REF HEADER <name>`: include a previously defined named header fragment on the same page.
- `//@REF BODY <name>`: include a previously defined named body fragment on the same page.

Example with references:

````markdown
```javascript sidecode title="Counter Follow-up" console=true
//@REF HEADER counter_setup
//@REF BODY counter_body

//@BODY counter_followup
button.style.fontWeight = '700';
console.log(`current count: ${count}`);
```
````

Rules:

- Fragment names are page-local.
- Referenced fragments must already exist earlier on the page.
- Missing references fail the docs build clearly.
- Circular references are rejected clearly.
- Body-fragment propagation is one-way in this milestone: editing a source body updates dependent examples that reference that body fragment.

## Execution Model

Each interactive example receives:

- `container`: the render target DOM node.
- `consoleTarget`: the console panel DOM node when enabled.
- `context`: an execution context with cleanup registration and an abort signal.
- `registerCleanup(fn)`: helper for disposal hooks.

The runtime composes execution code in this order:

1. Referenced header fragments.
2. Local header fragment.
3. Referenced body fragments.
4. Local editable body fragment.

Header code is hidden by default. Body code is editable. Console capture uses a scoped `console` object inside the example module so async callbacks keep writing into the example console panel instead of depending on browser devtools.

## Cleanup Model

Before rerunning an example, the runtime:

1. Aborts the previous execution signal.
2. Runs registered cleanup callbacks in reverse order.
3. Clears render and console containers.
4. Re-executes the current composed example.

This gives the docs runtime a standard cleanup contract for canvases, listeners, timers, and retained DOM nodes without forcing each author to reimplement boilerplate.

## Local Development

Install Python and frontend dependencies:

```bash
cd mkdocs-sidecode
python -m pip install '.[dev]'
npm install
npm run build
```

Run tests:

```bash
pytest
npm test
```

Run the demo site:

```bash
mkdocs serve -f demo/mkdocs.yml
```

Build the package artifacts:

```bash
python -m build
```

MkDocs Material compatibility and theming:

`mkdocs-sidecode` uses standard MkDocs plugin hooks plus `extra_css` and `extra_javascript` asset registration, so it works with the built-in MkDocs theme and Material for MkDocs. Material's instant navigation is supported by listening for its `document$` page-change event when it is present.

The stylesheet follows Material's `data-md-color-scheme` attribute for light/dark palettes and falls back to `prefers-color-scheme` outside Material. The editor uses the same CSS variables as the surrounding sidecode frame, so it tracks the active docs theme rather than forcing a fixed light UI.

## MkDocs Integration

Add the plugin to your MkDocs config after installing it:

```yaml
plugins:
  - search
  - sidecode
```

The plugin injects its own runtime script and styles when a page contains interactive example fences.

## Release

Recommended release flow:

1. Run local verification:
   ```bash
   npm test
   npm run build
   PYTHONPATH=src pytest
   mkdocs build -f demo/mkdocs.yml
   python -m build
   ```
2. Commit and push `main`.
3. Create a Git tag such as `v0.1.2` and push it.
4. Let GitHub Actions publish the built package to PyPI through trusted publishing.

Initial GitHub setup:

- Create a GitHub repository for this directory.
- Push the `main` branch.
- In PyPI, create the `mkdocs-sidecode` project and configure trusted publishing for the GitHub repository.
- After that, each pushed `v*` tag can publish automatically through `.github/workflows/publish.yml`.

Deploying docs that use this plugin:

```bash
pip install mkdocs-material mkdocs-sidecode
mkdocs build
mkdocs gh-deploy
```

For GitHub Pages through Actions, install `mkdocs-sidecode` in the docs workflow before running `mkdocs build`.
