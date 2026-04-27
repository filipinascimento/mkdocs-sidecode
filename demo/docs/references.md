# Referenced Fragments

```javascript helios-example title="Setup Source"
#%HEADER render_setup
container.innerHTML = '<div>Shared setup</div>';

#%BODY visible_body
console.log('source body');
```

```javascript helios-example title="Dependent Example" console=true
#%REF HEADER render_setup
#%REF BODY visible_body

#%BODY dependent_body
console.log('dependent body');
```
