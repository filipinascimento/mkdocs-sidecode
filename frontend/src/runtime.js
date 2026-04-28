import { basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { javascript } from '@codemirror/lang-javascript';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
let moduleLoader = async (moduleSource) => {
  const blob = new Blob([moduleSource], { type: 'text/javascript' });
  const url = URL.createObjectURL(blob);
  try {
    await import(/* @vite-ignore */ url);
    return url;
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
};

function parsePageData(doc = document) {
  const node = doc.querySelector('.mkdocs-sidecode-page-data');
  if (!node) {
    return null;
  }
  return JSON.parse(node.textContent);
}

function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), delay);
  };
}

class FragmentRegistry {
  constructor(examples) {
    this.examples = new Map();
    this.bodyFragments = new Map();
    this.bodyDependents = new Map();

    for (const example of examples) {
      this.examples.set(example.id, example);
      if (example.bodyName) {
        this.bodyFragments.set(example.bodyName, {
          exampleId: example.id,
          code: example.bodyCode,
        });
      }
    }

    for (const example of examples) {
      for (const ref of example.bodyRefs) {
        if (!this.bodyDependents.has(ref.name)) {
          this.bodyDependents.set(ref.name, new Set());
        }
        this.bodyDependents.get(ref.name).add(example.id);
      }
    }
  }

  updateBody(name, code) {
    const entry = this.bodyFragments.get(name);
    if (!entry) {
      return [];
    }
    entry.code = code;
    return Array.from(this.bodyDependents.get(name) || []);
  }

  getBody(name) {
    return this.bodyFragments.get(name)?.code ?? '';
  }
}

function createScopedConsole(consoleTarget) {
  const append = (method, args) => {
    if (consoleTarget) {
      const line = document.createElement('div');
      line.className = `sidecode__console-line sidecode__console-line--${method}`;
      line.textContent = args.map((value) => stringifyLog(value)).join(' ');
      consoleTarget.appendChild(line);
    }
    console[method](...args);
  };

  return {
    log: (...args) => append('log', args),
    info: (...args) => append('info', args),
    warn: (...args) => append('warn', args),
    error: (...args) => append('error', args),
  };
}

function stringifyLog(value) {
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function splitImports(code) {
  const lines = code.split('\n');
  const imports = [];
  const body = [];
  let inImport = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (inImport) {
        imports.push(line);
      } else {
        body.push(line);
      }
      continue;
    }
    if (trimmed.startsWith('import ')) {
      imports.push(line);
      inImport = !trimmed.endsWith(';');
      continue;
    }
    if (inImport) {
      imports.push(line);
      if (trimmed.endsWith(';')) {
        inImport = false;
      }
      continue;
    }
    body.push(line);
  }

  return {
    imports: imports.join('\n').trim(),
    body: body.join('\n').trim(),
  };
}

async function executeExample(example, registry, elements, state) {
  cleanupExample(state, elements);

  const cleanupFns = [];
  const abortController = new AbortController();
  state.abortController = abortController;
  state.cleanupFns = cleanupFns;

  const scopedConsole = createScopedConsole(elements.consoleTarget);
  const registerCleanup = (fn) => {
    if (typeof fn === 'function') {
      cleanupFns.push(fn);
    }
  };

  const headerSegments = [];
  for (const ref of example.headerRefs) {
    headerSegments.push(ref.code);
  }
  if (example.headerCode) {
    headerSegments.push(example.headerCode);
  }

  const importChunks = [];
  const executableHeaderChunks = [];
  for (const segment of headerSegments) {
    const split = splitImports(segment);
    if (split.imports) {
      importChunks.push(split.imports);
    }
    if (split.body) {
      executableHeaderChunks.push(split.body);
    }
  }

  const referencedBody = example.bodyRefs
    .map((ref) => registry.getBody(ref.name))
    .filter(Boolean)
    .join('\n\n');

  const runId = `${example.id}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const moduleSource = [
    importChunks.join('\n'),
    `const __ctx = globalThis.__MKDOCS_SIDECODE_CONTEXTS__?.get(${JSON.stringify(runId)});`,
    'if (!__ctx) throw new Error("Sidecode execution context is unavailable.");',
    'const { container, consoleTarget, context, registerCleanup, console } = __ctx;',
    'await (async () => {',
    executableHeaderChunks.join('\n\n'),
    referencedBody,
    state.currentBody,
    '})();',
  ]
    .filter(Boolean)
    .join('\n\n');

  if (!globalThis.__MKDOCS_SIDECODE_CONTEXTS__) {
    globalThis.__MKDOCS_SIDECODE_CONTEXTS__ = new Map();
  }
  globalThis.__MKDOCS_SIDECODE_CONTEXTS__.set(runId, {
    container: elements.renderTarget,
    consoleTarget: elements.consoleTarget,
    context: {
      signal: abortController.signal,
      onCleanup: registerCleanup,
    },
    registerCleanup,
    console: scopedConsole,
  });

  try {
    state.moduleUrl = await moduleLoader(moduleSource);
  } catch (error) {
    scopedConsole.error(error instanceof Error ? error.message : String(error));
  } finally {
    globalThis.__MKDOCS_SIDECODE_CONTEXTS__.delete(runId);
  }
}

function cleanupExample(state, elements) {
  if (state.abortController) {
    state.abortController.abort();
  }
  if (state.cleanupFns) {
    for (const fn of [...state.cleanupFns].reverse()) {
      try {
        fn();
      } catch (error) {
        console.error(error);
      }
    }
  }
  state.cleanupFns = [];
  if (state.moduleUrl) {
    URL.revokeObjectURL(state.moduleUrl);
    state.moduleUrl = null;
  }
  if (elements.renderTarget) {
    elements.renderTarget.replaceChildren();
  }
  if (elements.consoleTarget) {
    elements.consoleTarget.replaceChildren();
  }
}

function mountExample(example, registry) {
  const root = document.querySelector(`[data-sidecode-example="${example.id}"]`);
  if (!root) {
    return;
  }
  if (root.dataset.sidecodeMounted === 'true') {
    return;
  }
  root.dataset.sidecodeMounted = 'true';

  const bodyEditorRoot = root.querySelector('[data-role="body-editor"]');
  const headerEditorRoot = root.querySelector('[data-role="header-editor"]');
  let renderTarget = root.querySelector('[data-role="render"]');
  const consoleTarget = root.querySelector('[data-role="console"]');
  const bodyTab = root.querySelector('[data-role="body-tab"]');
  const headerTab = root.querySelector('[data-role="header-tab"]');
  const renderTab = root.querySelector('[data-role="render-tab"]');
  const consoleTab = root.querySelector('[data-role="console-tab"]');
  const runButton = root.querySelector('[data-role="run"]');
  if (!renderTarget) {
    renderTarget = document.createElement('div');
    renderTarget.hidden = true;
    renderTarget.dataset.role = 'render-runtime';
    root.appendChild(renderTarget);
  }
  const elements = { renderTarget, consoleTarget };
  const state = {
    currentBody: example.bodyCode,
    cleanupFns: [],
    abortController: null,
    moduleUrl: null,
  };

  const runNow = async () => {
    await executeExample(example, registry, elements, state);
  };
  const run = debounce(runNow, 250);

  const runKeymap = keymap.of([
    {
      key: 'Mod-Enter',
      run() {
        runNow();
        return true;
      },
    },
  ]);

  const editorState = EditorState.create({
    doc: example.bodyCode,
    extensions: [
      basicSetup,
      javascript(),
      EditorView.lineWrapping,
      runKeymap,
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) {
          return;
        }
        state.currentBody = update.state.doc.toString();
        if (example.bodyName) {
          const dependents = registry.updateBody(example.bodyName, state.currentBody);
          for (const dependentId of dependents) {
            const dependentRoot = document.querySelector(`[data-sidecode-example="${dependentId}"]`);
            dependentRoot?.dispatchEvent(new CustomEvent('sidecode:rerun'));
          }
        }
        run();
      }),
    ],
  });
  const editor = new EditorView({ state: editorState, parent: bodyEditorRoot });

  const headerSource = [
    ...example.headerRefs.map((ref) => ref.code),
    example.headerCode,
  ].filter(Boolean).join('\n\n');
  const headerEditor = new EditorView({
    state: EditorState.create({
      doc: headerSource || '// No header code for this example.',
      extensions: [
        basicSetup,
        javascript(),
        EditorView.lineWrapping,
        EditorState.readOnly.of(true),
      ],
    }),
    parent: headerEditorRoot,
  });

  setupTabs({
    bodyTab,
    headerTab,
    bodyEditorRoot,
    headerEditorRoot,
    renderTab,
    consoleTab,
    renderTarget,
    consoleTarget,
  });

  runButton?.addEventListener('click', () => {
    runNow();
  });

  root.__sidecodeController = {
    editor,
    headerEditor,
    rerun: () => runNow(),
  };

  root.addEventListener('sidecode:rerun', () => {
    runNow();
  });

  runNow();

  window.addEventListener('beforeunload', () => {
    editor.destroy();
    headerEditor.destroy();
    cleanupExample(state, elements);
  }, { once: true });
}

function setupTabs({
  bodyTab,
  headerTab,
  bodyEditorRoot,
  headerEditorRoot,
  renderTab,
  consoleTab,
  renderTarget,
  consoleTarget,
}) {
  bodyTab?.addEventListener('click', () => {
    bodyTab.classList.add('is-active');
    headerTab?.classList.remove('is-active');
    bodyEditorRoot.classList.remove('is-hidden');
    headerEditorRoot.classList.add('is-hidden');
  });

  headerTab?.addEventListener('click', () => {
    if (headerTab.disabled) {
      return;
    }
    headerTab.classList.add('is-active');
    bodyTab?.classList.remove('is-active');
    headerEditorRoot.classList.remove('is-hidden');
    bodyEditorRoot.classList.add('is-hidden');
  });

  renderTab?.addEventListener('click', () => {
    if (renderTab.disabled) {
      return;
    }
    renderTab.classList.add('is-active');
    consoleTab?.classList.remove('is-active');
    renderTarget?.classList.remove('is-hidden');
    consoleTarget?.classList.add('is-hidden');
  });

  consoleTab?.addEventListener('click', () => {
    if (consoleTab.disabled) {
      return;
    }
    consoleTab.classList.add('is-active');
    renderTab?.classList.remove('is-active');
    consoleTarget?.classList.remove('is-hidden');
    renderTarget?.classList.add('is-hidden');
  });

  if (!renderTarget && consoleTarget) {
    consoleTab?.classList.add('is-active');
    consoleTarget.classList.remove('is-hidden');
  } else if (consoleTarget) {
    consoleTarget.classList.add('is-hidden');
  }
}

export function bootstrapSidecodeExamples(doc = document) {
  const pageData = parsePageData(doc);
  if (!pageData?.examples?.length) {
    return;
  }
  const registry = new FragmentRegistry(pageData.examples);
  for (const example of pageData.examples) {
    mountExample(example, registry);
  }
}

export function setModuleLoader(loader) {
  moduleLoader = loader;
}

export function resetModuleLoader() {
  moduleLoader = async (moduleSource) => {
    const blob = new Blob([moduleSource], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    try {
      await import(/* @vite-ignore */ url);
      return url;
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
  };
}

if (typeof window !== 'undefined') {
  bootstrapSidecodeExamples(window.document);
  window.document$?.subscribe(() => {
    bootstrapSidecodeExamples(window.document);
  });
}
