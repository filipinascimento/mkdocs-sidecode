import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
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
      line.className = `helios-example__console-line helios-example__console-line--${method}`;
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

  const moduleSource = [
    importChunks.join('\n'),
    'const __ctx = globalThis.__HELIOS_EXAMPLE_CONTEXT__;',
    'const { container, consoleTarget, context, registerCleanup, console } = __ctx;',
    'await (async () => {',
    executableHeaderChunks.join('\n\n'),
    referencedBody,
    state.currentBody,
    '})();',
  ]
    .filter(Boolean)
    .join('\n\n');

  globalThis.__HELIOS_EXAMPLE_CONTEXT__ = {
    container: elements.renderTarget,
    consoleTarget: elements.consoleTarget,
    context: {
      signal: abortController.signal,
      onCleanup: registerCleanup,
    },
    registerCleanup,
    console: scopedConsole,
  };

  try {
    state.moduleUrl = await moduleLoader(moduleSource);
  } catch (error) {
    scopedConsole.error(error instanceof Error ? error.message : String(error));
  } finally {
    delete globalThis.__HELIOS_EXAMPLE_CONTEXT__;
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
  const root = document.querySelector(`[data-helios-example="${example.id}"]`);
  if (!root) {
    return;
  }

  const editorRoot = root.querySelector('[data-role="editor"]');
  let renderTarget = root.querySelector('[data-role="render"]');
  const consoleTarget = root.querySelector('[data-role="console"]');
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

  const run = debounce(async () => {
    await executeExample(example, registry, elements, state);
  }, 120);

  const editorState = EditorState.create({
    doc: example.bodyCode,
    extensions: [
      javascript(),
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) {
          return;
        }
        state.currentBody = update.state.doc.toString();
        if (example.bodyName) {
          const dependents = registry.updateBody(example.bodyName, state.currentBody);
          for (const dependentId of dependents) {
            const dependentRoot = document.querySelector(`[data-helios-example="${dependentId}"]`);
            dependentRoot?.dispatchEvent(new CustomEvent('helios:rerun'));
          }
        }
        run();
      }),
    ],
  });
  const editor = new EditorView({ state: editorState, parent: editorRoot });
  root.__heliosExampleController = {
    editor,
    rerun: () => run(),
  };

  root.addEventListener('helios:rerun', () => {
    run();
  });

  run();

  window.addEventListener('beforeunload', () => {
    editor.destroy();
    cleanupExample(state, elements);
  }, { once: true });
}

export function bootstrapHeliosExamples(doc = document) {
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
  bootstrapHeliosExamples(window.document);
}
