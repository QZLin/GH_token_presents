import { startApp } from './app';

const key = Symbol.for('github-token-profiles:runtime');
const scope = globalThis as typeof globalThis & { [key: symbol]: unknown };
const previous = scope[key];
if (typeof previous === 'function') previous();
const stop = startApp();
const dispose = () => {
  stop();
  if (scope[key] === dispose) delete scope[key];
};
scope[key] = dispose;

if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(dispose);
}
