import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorSelection } from '@codemirror/state';
import { bootstrapSidecodeExamples, resetModuleLoader, setModuleLoader } from './runtime.js';

function pageDataScript(examples) {
  const script = document.createElement('script');
  script.type = 'application/json';
  script.className = 'mkdocs-sidecode-page-data';
  script.textContent = JSON.stringify({ examples });
  document.body.appendChild(script);
}

function exampleRoot(id) {
  const root = document.createElement('div');
  root.className = 'sidecode';
  root.dataset.sidecodeExample = id;
  root.innerHTML = `
    <div data-role="body-editor"></div>
    <div data-role="header-editor"></div>
    <button data-role="body-tab"></button>
    <button data-role="header-tab"></button>
    <button data-role="render-tab"></button>
    <button data-role="console-tab"></button>
    <button data-role="run"></button>
    <div data-role="output">
      <div data-role="render"></div>
      <pre data-role="console"></pre>
    </div>
  `;
  document.body.appendChild(root);
  return root;
}

describe('runtime', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    const AsyncEvaluator = Object.getPrototypeOf(async function () {}).constructor;
    setModuleLoader(async (source) => {
      await new AsyncEvaluator(source)();
      return null;
    });
  });

  beforeEach(() => {
    document.body.innerHTML = '';
    global.Range.prototype.getClientRects = () => [];
    global.Range.prototype.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    });
  });

  it('runs an example and captures console output', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const examples = [
      {
        id: 'page--example-1',
        title: 'Basic',
        render: true,
        console: true,
        layout: 'split',
        headerName: 'setup',
        headerCode: "container.textContent = 'ready';",
        bodyName: 'demo',
        bodyCode: "console.log('hello runtime');",
        headerRefs: [],
        bodyRefs: [],
      },
    ];

    pageDataScript(examples);
    const root = exampleRoot('page--example-1');
    bootstrapSidecodeExamples(document);

    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(root.querySelector('[data-role="render"]').textContent).toContain('ready');
    expect(root.querySelector('[data-role="console"]').textContent).toContain('hello runtime');
  });

  afterEach(() => {
    resetModuleLoader();
  });

  it('propagates source body edits into dependent examples', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const examples = [
      {
        id: 'page--example-1',
        title: 'Source',
        render: true,
        console: true,
        layout: 'split',
        headerName: null,
        headerCode: '',
        bodyName: 'source_body',
        bodyCode: "container.dataset.value = 'A';",
        headerRefs: [],
        bodyRefs: [],
      },
      {
        id: 'page--example-2',
        title: 'Dependent',
        render: true,
        console: true,
        layout: 'split',
        headerName: null,
        headerCode: '',
        bodyName: 'dependent_body',
        bodyCode: "console.log(container.dataset.value);",
        headerRefs: [],
        bodyRefs: [
          { fragment_type: 'body', name: 'source_body', example_id: 'page--example-1', code: "container.dataset.value = 'A';" },
        ],
      },
    ];

    pageDataScript(examples);
    const sourceRoot = exampleRoot('page--example-1');
    const dependentRoot = exampleRoot('page--example-2');
    bootstrapSidecodeExamples(document);

    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(dependentRoot.querySelector('[data-role="console"]').textContent).toContain('A');

    const sourceController = sourceRoot.__sidecodeController;
    sourceController.editor.dispatch({
      changes: {
        from: 0,
        to: sourceController.editor.state.doc.length,
        insert: "container.dataset.value = 'B';",
      },
      selection: EditorSelection.cursor("container.dataset.value = 'B';".length),
    });

    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(dependentRoot.querySelector('[data-role="console"]').textContent).toContain('B');
  });
});
