/**
 * event-bus.js — Minimal pub/sub for inter-module communication.
 */
import { assertRuntimeEvent } from '../contracts/runtime-events.js';

const listeners = new Map();

export function on(event, fn) {
  assertRuntimeEvent(event);
  const list = listeners.get(event) || [];
  list.push(fn);
  listeners.set(event, list);
}

export function off(event, fn) {
  assertRuntimeEvent(event);
  const list = listeners.get(event);
  if (!list) return;
  listeners.set(event, list.filter(f => f !== fn));
}

export function emit(event, payload) {
  assertRuntimeEvent(event);
  for (const fn of listeners.get(event) || []) fn(payload);
}
