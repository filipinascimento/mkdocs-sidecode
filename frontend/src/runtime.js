import { basicSetup } from 'codemirror';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { javascript } from '@codemirror/lang-javascript';
import { tags } from '@lezer/highlight';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const sidecodeHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--sidecode-syntax-keyword)' },
  { tag: [tags.name, tags.deleted, tags.character, tags.macroName], color: 'var(--sidecode-syntax-name)' },
  { tag: [tags.propertyName, tags.variableName, tags.definition(tags.variableName)], color: 'var(--sidecode-syntax-variable)' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--sidecode-syntax-function)' },
  { tag: [tags.labelName], color: 'var(--sidecode-syntax-label)' },
  { tag: [tags.color, tags.constant(tags.name), tags.standard(tags.name)], color: 'var(--sidecode-syntax-constant)' },
  { tag: [tags.definition(tags.name), tags.separator], color: 'var(--sidecode-syntax-text)' },
  { tag: [tags.typeName, tags.className, tags.number, tags.changed, tags.annotation, tags.modifier, tags.self, tags.namespace], color: 'var(--sidecode-syntax-number)' },
  { tag: [tags.operator, tags.operatorKeyword], color: 'var(--sidecode-syntax-operator)' },
  { tag: [tags.string, tags.regexp, tags.special(tags.string)], color: 'var(--sidecode-syntax-string)' },
  { tag: [tags.meta, tags.comment], color: 'var(--sidecode-syntax-comment)' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.link, color: 'var(--sidecode-syntax-link)', textDecoration: 'underline' },
  { tag: tags.heading, fontWeight: '700', color: 'var(--sidecode-syntax-heading)' },
  { tag: [tags.atom, tags.bool, tags.special(tags.variableName)], color: 'var(--sidecode-syntax-atom)' },
  { tag: tags.invalid, color: 'var(--sidecode-syntax-invalid)' },
]);

const sidecodeEditorTheme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--sidecode-editor-bg)',
    color: 'var(--sidecode-editor-text)',
  },
  '.cm-content': {
    caretColor: 'var(--sidecode-editor-text)',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--sidecode-surface)',
    color: 'var(--sidecode-muted)',
    borderRightColor: 'var(--sidecode-border)',
  },
  '.cm-activeLine, .cm-activeLineGutter': {
    backgroundColor: 'var(--sidecode-active-line)',
  },
});

const sidecodeEditorExtensions = [
  basicSetup,
  javascript(),
  syntaxHighlighting(sidecodeHighlightStyle),
  sidecodeEditorTheme,
  EditorView.lineWrapping,
];

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
  const text = node instanceof HTMLTemplateElement
    ? (node.content.textContent || node.textContent)
    : node.textContent;
  return JSON.parse(text || '{}');
}

function resolveImportMap(importMap = {}, doc = document) {
  const runtimeScript = Array.from(doc.scripts || [])
    .find((script) => script.src && script.src.includes('/assets/mkdocs-sidecode/runtime.js'));
  const baseUrl = runtimeScript?.src || doc.baseURI;
  return Object.fromEntries(Object.entries(importMap).map(([specifier, target]) => {
    try {
      return [specifier, new URL(target, baseUrl).href];
    } catch {
      return [specifier, target];
    }
  }));
}

function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), delay);
  };
}

function canCompileForAutorun(example, registry, bodyCode) {
  const segments = [
    ...example.headerRefs.map((ref) => ref.code),
    example.headerCode,
    ...example.bodyRefs.map((ref) => registry.getBody(ref.name)),
    bodyCode,
  ].filter(Boolean);
  const executable = splitExecutableSegments(segments);
  try {
    // This intentionally excludes ESM imports, which cannot be parsed by Function.
    new AsyncFunction(executable.bodyChunks.join('\n\n'));
    return true;
  } catch {
    return false;
  }
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

function rewriteImportSpecifiers(code, importMap = {}) {
  if (!code || !Object.keys(importMap).length) {
    return code;
  }
  const rewrite = (specifier) => importMap[specifier] ?? specifier;
  return code
    .replace(/(\bfrom\s*)(["'])([^"']+)(\2)/g, (match, prefix, quote, specifier, suffix) => {
      return `${prefix}${quote}${rewrite(specifier)}${suffix}`;
    })
    .replace(/(\bimport\s*)(["'])([^"']+)(\2)/g, (match, prefix, quote, specifier, suffix) => {
      return `${prefix}${quote}${rewrite(specifier)}${suffix}`;
    })
    .replace(/(\bimport\s*\(\s*)(["'])([^"']+)(\2\s*\))/g, (match, prefix, quote, specifier, suffix) => {
      return `${prefix}${quote}${rewrite(specifier)}${suffix}`;
    });
}

function splitExecutableSegments(segments, importMap = {}) {
  const importChunks = [];
  const bodyChunks = [];
  for (const segment of segments) {
    const split = splitImports(segment);
    if (split.imports) {
      importChunks.push(rewriteImportSpecifiers(split.imports, importMap));
    }
    if (split.body) {
      bodyChunks.push(rewriteImportSpecifiers(split.body, importMap));
    }
  }
  return { importChunks, bodyChunks };
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

  const referencedBodySegments = example.bodyRefs
    .map((ref) => registry.getBody(ref.name))
    .filter(Boolean);
  const executable = splitExecutableSegments(
    [...headerSegments, ...referencedBodySegments, state.currentBody],
    state.importMap,
  );

  const runId = `${example.id}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const moduleSource = [
    executable.importChunks.join('\n'),
    `const __ctx = globalThis.__MKDOCS_SIDECODE_CONTEXTS__?.get(${JSON.stringify(runId)});`,
    'if (!__ctx) throw new Error("Sidecode execution context is unavailable.");',
    'const { container, consoleTarget, context, registerCleanup, console } = __ctx;',
    'await (async () => {',
    executable.bodyChunks.join('\n\n'),
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
  const refButtons = root.querySelectorAll('[data-ref-example-id]');
  const visibleRenderTarget = renderTarget;
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
    importMap: registry.importMap,
  };

  const runNow = async () => {
    await executeExample(example, registry, elements, state);
  };
  const autorun = example.autorun !== false;
  const runIfValid = () => {
    if (canCompileForAutorun(example, registry, state.currentBody)) {
      runNow();
    }
  };
  const run = debounce(runIfValid, 300);

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
      ...sidecodeEditorExtensions,
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
            dependentRoot?.dispatchEvent(new CustomEvent('sidecode:source-changed'));
          }
        }
        if (autorun) {
          run();
        }
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
        ...sidecodeEditorExtensions,
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
    renderTarget: visibleRenderTarget,
    consoleTarget,
  });

  runButton?.addEventListener('click', () => {
    runNow();
  });

  for (const button of refButtons) {
    button.addEventListener('click', () => {
      revealReferencedSource(button);
    });
  }

  root.__sidecodeController = {
    editor,
    headerEditor,
    rerun: () => runNow(),
  };

  root.addEventListener('sidecode:rerun', () => {
    runNow();
  });
  root.addEventListener('sidecode:source-changed', () => {
    if (autorun) {
      run();
    }
  });

  if (autorun) {
    runNow();
  }

  window.addEventListener('beforeunload', () => {
    editor.destroy();
    headerEditor.destroy();
    cleanupExample(state, elements);
  }, { once: true });
}

function revealReferencedSource(button) {
  const sourceId = button?.dataset?.refExampleId;
  const kind = button?.dataset?.refKind;
  if (!sourceId) return;
  const sourceRoot = document.querySelector(`[data-sidecode-example="${sourceId}"]`);
  if (!sourceRoot) return;
  sourceRoot.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const targetTab = sourceRoot.querySelector(
    kind === 'header' ? '[data-role="header-tab"]' : '[data-role="body-tab"]',
  );
  if (targetTab && !targetTab.disabled) {
    targetTab.click();
  }
  sourceRoot.classList.add('sidecode--flash-source');
  window.setTimeout(() => sourceRoot.classList.remove('sidecode--flash-source'), 1200);
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
    renderTab?.classList.remove('is-active');
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
  registry.importMap = resolveImportMap(pageData.importMap || {}, doc);
  for (const example of pageData.examples) {
    mountExample(example, registry);
  }
}

export { rewriteImportSpecifiers };

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
