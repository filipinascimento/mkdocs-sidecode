# Interactive Examples

```javascript sidecode title="Counter Card" console=true
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

```javascript sidecode title="Counter Follow-up" console=true
//@REF HEADER card_setup
//@REF BODY counter_body

//@BODY counter_followup
button.style.background = '#146c5c';
button.style.color = 'white';
console.log(`current count: ${count}`);
```
