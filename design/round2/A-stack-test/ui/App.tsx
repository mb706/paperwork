import { createSignal, For } from 'solid-js';
import { render } from 'solid-js/web';
export function Slot(props: { count: number; icon: string }) { return <div class="slot" data-icon={props.icon}>{props.count}</div>; }
function App() { const [n, setN] = createSignal(0); setInterval(() => setN(n() + 1), 16); return <div class="grid"><For each={[1,2,3,4,5,6,7,8,9,10]}>{(i) => <Slot count={n() * i} icon="iron-plate" />}</For></div>; }
render(() => <App />, document.getElementById('root')!);
