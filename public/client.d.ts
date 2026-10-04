import type { Layout } from './host.js';

export type { Layout } from './host.js';

export interface PadState {
  title?: string;
  color?: string;
  highlight?: string[];
  disabled?: string[];
}

export interface PadPatch extends PadState {
  vibrate?: number;
}

export type ErrorCode =
  | 'room-not-found'
  | 'slot-taken'
  | 'bad-slot'
  | 'bad-message'
  | 'replaced'
  | 'kicked'
  | 'room-closed'
  | 'version'
  | 'rate-limited'
  | 'unreachable';

export interface JoinError {
  code: ErrorCode;
  message?: string;
  /** With 'slot-taken': the slots that are free right now. */
  free?: number[];
}

export type Status = 'connecting' | 'connected' | 'reconnecting' | 'closed';

export interface PadInput {
  /** -1 (left) .. 1 (right). */
  x?: number;
  /** -1 (up) .. 1 (down). */
  y?: number;
  /** Full held state, e.g. { a: true, b: false }. */
  buttons?: Record<string, boolean>;
}

export interface PadEvents {
  /** Data sent by the host with room.send() or room.broadcast(). */
  message: [data: unknown];
  /** The host changed this pad. `state` is the merged state, `patch` what changed (may include vibrate). */
  pad: [state: PadState, patch: PadPatch];
  /** Fatal error after joining (kicked, room-closed, replaced, slot-taken on rejoin...). The pad is closed. */
  error: [error: JoinError];
  status: [status: Status];
}

export interface JoinOptions {
  /** Room code, case-insensitive. */
  room: string;
  /** 1-based slot. Omit to take the first free one. */
  slot?: number;
  /** Player name shown to the host, at most 20 chars. */
  name?: string;
  /** Joinstick server URL. Default: where client.js was loaded from. */
  server?: string;
}

export interface Pad {
  readonly room: string;
  readonly slot: number;
  /** Layout chosen by the host. Render labels with textContent only. */
  readonly layout: Layout & Required<Pick<Layout, 'stick' | 'buttons'>>;
  readonly state: PadState;
  readonly status: Status;
  /** Send the full current state. Cheap to call often: unchanged state is not resent. */
  setInput(input: PadInput): void;
  /** Send any JSON value to the host (arrives as room.on('message')). */
  send(data: unknown): void;
  on<E extends keyof PadEvents>(event: E, fn: (...args: PadEvents[E]) => void): () => void;
  /** Leave the slot for good (no auto-rejoin). The host sees reason 'left'. */
  leave(): void;
}

/**
 * Join a room. Reconnects and rejoins the same slot by itself (network blips,
 * phone locked, server restart). Rejects with an Error carrying a JoinError's
 * fields (`code`, `free`) if the first join fails.
 */
export function join(options: JoinOptions): Promise<Pad>;
