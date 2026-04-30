import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorSelection } from '@codemirror/state';
import {
  bootstrapSidecodeExamples,
  resetModuleLoader,
  rewriteImportSpecifiers,
  setModuleLoader,
} from './runtime.js';

function pageDataScript(examples, importMap = undefined) {
  const template = document.createElement('template');
  template.className = 'mkdocs-sidecode-page-data';
  template.textContent = JSON.stringify({ examples, importMap });
  document.body.appendChild(template);
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

  it('rewrites configured package imports before executing body code', async () => {
    let moduleSource = '';
    setModuleLoader(async (source) => {
      moduleSource = source;
      return null;
    });
    const examples = [
      {
        id: 'page--example-1',
        title: 'Imports',
        render: true,
        console: true,
        layout: 'split',
        headerName: null,
        headerCode: '',
        bodyName: 'demo',
        bodyCode: 'import { Helios } from "helios-web";\nconsole.log(Helios);',
        headerRefs: [],
        bodyRefs: [],
      },
    ];

    pageDataScript(examples, { 'helios-web': '../vendor/helios/helios-web.es.js' });
    exampleRoot('page--example-1');
    const runtime = document.createElement('script');
    runtime.src = 'http://docs.test/assets/mkdocs-sidecode/runtime.js';
    document.head.appendChild(runtime);
    bootstrapSidecodeExamples(document);

    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(moduleSource).toContain('from "http://docs.test/assets/vendor/helios/helios-web.es.js"');
    expect(moduleSource).toContain('console.log(Helios);');
  });

  it('rewrites static and dynamic import specifiers', () => {
    const source = [
      'import { Helios } from "helios-web";',
      'import "helios-style";',
      'const mod = await import("helios-network");',
    ].join('\n');
    expect(rewriteImportSpecifiers(source, {
      'helios-web': '/assets/helios-web.es.js',
      'helios-style': '/assets/helios.css',
      'helios-network': '/assets/helios-network.js',
    })).toContain('from "/assets/helios-web.es.js"');
    expect(rewriteImportSpecifiers(source, {
      'helios-web': '/assets/helios-web.es.js',
      'helios-style': '/assets/helios.css',
      'helios-network': '/assets/helios-network.js',
    })).toContain('import "/assets/helios.css"');
    expect(rewriteImportSpecifiers(source, {
      'helios-web': '/assets/helios-web.es.js',
      'helios-style': '/assets/helios.css',
      'helios-network': '/assets/helios-network.js',
    })).toContain('import("/assets/helios-network.js")');
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

    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(dependentRoot.querySelector('[data-role="console"]').textContent).toContain('B');
  });

  it('does not run automatically when autorun is disabled', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const examples = [
      {
        id: 'page--example-1',
        title: null,
        render: false,
        console: true,
        autorun: false,
        layout: 'split',
        headerName: null,
        headerCode: '',
        bodyName: 'manual_body',
        bodyCode: "console.log('manual run');",
        headerRefs: [],
        bodyRefs: [],
      },
    ];

    pageDataScript(examples);
    const root = exampleRoot('page--example-1');
    root.querySelector('[data-role="render"]').remove();
    bootstrapSidecodeExamples(document);

    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(root.querySelector('[data-role="console"]').classList.contains('is-hidden')).toBe(false);
    expect(root.querySelector('[data-role="console"]').textContent).not.toContain('manual run');

    root.querySelector('[data-role="run"]').click();

    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(root.querySelector('[data-role="console"]').textContent).toContain('manual run');
  });

  it('skips debounced autorun while edited code is syntactically invalid', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const examples = [
      {
        id: 'page--example-1',
        title: null,
        render: true,
        console: true,
        autorun: true,
        layout: 'split',
        headerName: null,
        headerCode: '',
        bodyName: 'editable_body',
        bodyCode: "console.log('valid');",
        headerRefs: [],
        bodyRefs: [],
      },
    ];

    pageDataScript(examples);
    const root = exampleRoot('page--example-1');
    bootstrapSidecodeExamples(document);

    await new Promise((resolve) => setTimeout(resolve, 200));
    const controller = root.__sidecodeController;
    root.querySelector('[data-role="console"]').replaceChildren();

    controller.editor.dispatch({
      changes: {
        from: 0,
        to: controller.editor.state.doc.length,
        insert: 'if (',
      },
      selection: EditorSelection.cursor('if ('.length),
    });

    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(root.querySelector('[data-role="console"]').textContent).toBe('');
  });
});
