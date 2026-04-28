# Interactive Examples

```javascript sidecode title="Counter Card" console=true height=420
//@HEADER card_setup
container.innerHTML = '<button class="demo-button" type="button">Count: 0</button>';
const button = container.querySelector('button');
let count = 0;

function setCount(value) {
  count = value;
  button.textContent = `Count: ${count}`;
}

button.addEventListener('click', () => {
  setCount(count + 1);
  console.log(`clicked ${count}`);
});

registerCleanup(() => {
  button.replaceWith(button.cloneNode(true));
});

//@BODY counter_body
setCount(3);
console.log('counter initialized');
```

```javascript sidecode title="Counter Follow-up" console=true width=760 height=360
//@REF HEADER card_setup
//@REF BODY counter_body

//@BODY counter_followup
button.style.background = '#146c5c';
button.style.color = 'white';
console.log(`current count: ${count}`);
```

```javascript sidecode console=true render=false autorun=false
//@BODY console_only
console.log('This example has no title and no visible render panel.');
console.log('Use the Run button or Cmd/Ctrl+Enter to execute it.');
```
