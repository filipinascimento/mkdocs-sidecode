# Helios Interactive Examples

This demo page exercises the MkDocs plugin authoring format.

```javascript helios-example title="Basic Example" console=true
#%HEADER base_setup
container.innerHTML = '<div class="demo-chip">Helios render container ready</div>';
console.log('ready');

#%BODY selection_demo
container.dataset.selection = 'cleared';
console.log('selection cleared');
```

```javascript helios-example title="Selection Follow-up" console=true
#%REF HEADER base_setup
#%REF BODY selection_demo

#%BODY selection_followup
container.dataset.labels = 'selected';
console.log(`labels mode: ${container.dataset.labels}`);
```
