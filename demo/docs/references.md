# Referenced Fragments

```javascript sidecode title="Setup Source"
//@HEADER render_setup
container.innerHTML = '<div class="demo-message">Shared setup</div>';

//@BODY visible_body
container.querySelector('.demo-message').textContent = 'Source body ran';
```

```javascript sidecode title="Dependent Example" console=true
//@REF HEADER render_setup
//@REF BODY visible_body

//@BODY dependent_body
console.log(container.textContent);
```
