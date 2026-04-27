# MkDocs Sidecode

`mkdocs-sidecode` is a separate MkDocs plugin project for interactive side-by-side documentation examples. It turns specially marked JavaScript fences into side-by-side examples with an editable editor, live output, optional console capture, named fragments, and deterministic fragment references.

The fence intentionally stays `javascript` so ordinary Markdown editors still highlight the source as JavaScript:

````markdown
```javascript helios-example title="Selection Example" console=true
#%HEADER base_setup
import { Helios } from 'helios-web-next';

const helios = new Helios(container, {});
console.log('ready');

#%BODY selection_demo
helios.behavior.selection.clear();
```
````

## Why `javascript` Fences Stay Intact

The plugin does not introduce a custom fence language such as `helios-example`. Instead it recognizes JavaScript fences whose info string also contains `helios-example`. That keeps normal editor highlighting intact while still giving MkDocs a reliable marker.

Supported forms:

- ```` ```javascript helios-example title="Basic Example" ````
- ```` ```javascript {helios-example} title="Basic Example" ````

## Authoring Syntax

Supported directives inside the fence:

- `#%HEADER <name>`: hidden setup code that runs before the editable body.
- `#%BODY <name>`: visible editable code shown in the editor.
- `#%REF HEADER <name>`: include a previously defined named header fragment on the same page.
- `#%REF BODY <name>`: include a previously defined named body fragment on the same page.

Example with references:

````markdown
```javascript helios-example title="Selection Follow-up" console=true
#%REF HEADER base_setup
#%REF BODY selection_demo

#%BODY selection_followup
helios.behavior.labels.mode('selected');
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

This gives the docs runtime a standard cleanup contract for canvases, listeners, timers, and Helios instances without forcing each author to reimplement boilerplate.

## Local Development

Install Python and frontend dependencies:

```bash
cd /Users/filipinascimentosilva/Downloads/helios-new/mkdocs-sidecode
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
3. Create a Git tag such as `v0.1.0` and push it.
4. Let GitHub Actions publish the built package to PyPI through trusted publishing.

Initial GitHub setup:

- Create a GitHub repository for this directory.
- Push the `main` branch.
- In PyPI, create the `mkdocs-sidecode` project and configure trusted publishing for the GitHub repository.
- After that, each pushed `v*` tag can publish automatically through `.github/workflows/publish.yml`.
