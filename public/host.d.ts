/** Controller layout rendered by the default pad page. Validated by the server. */
export interface Layout {
  /** 'dpad' (default) shows an 8-way d-pad on the left; 'none' hides it. */
  stick?: 'dpad' | 'none';
  /** At most 8 buttons, system buttons included. */
  buttons?: Button[];
  /**
   * 'landscape' (default): a phone held upright shows the pad rotated, so the
   * player turns it sideways (works with the rotation lock on). 'portrait'
   * does the opposite; 'any' follows the phone.
   */
  orientation?: 'landscape' | 'portrait' | 'any';
  /**
   * How the pad places the gameplay buttons. 'grid' (default): rows and columns.
   * 'diamond': the first four as face buttons (bottom, left, right, top), the
   * rest beside them. 'arc': the first button big under the thumb, the rest
   * fanned around it.
   */
  arrangement?: 'grid' | 'diamond' | 'arc';
  /** Short local vibration on every press and d-pad direction change. Default true. */
  haptics?: boolean;
}

export interface Button {
  /** Key in `input(n).buttons`. Must match /^[A-Za-z0-9_-]{1,16}$/, be unique and not be an Object.prototype name (e.g. 'constructor'). */
  id: string;
  /** Text on the button, at most 8 chars. Defaults to the id. */
  label?: string;
  /** Hex color, /^#[0-9a-f]{3,8}$/i. */
  color?: string;
  /** 'large': a bigger round button. 'wide': a long bar under the other buttons (good for a held action). */
  size?: 'large' | 'wide';
  /** Tap feedback length in ms (0-100, 0 = none). Default 10. */
  haptic?: number;
  /** A small pill in the pad's top bar (START, MENU...), away from the thumbs. Reports like any other button. */
  system?: boolean;
}

/** Change what one pad shows. Every field is optional; omitted fields keep their value. */
export interface PadPatch {
  /** Shown in the pad header, at most 20 chars. '' clears it. */
  title?: string;
  /** Accent color of the pad (hex). */
  color?: string;
  /** Button ids that glow and make the phone vibrate briefly (Android only). Disabled wins over highlight. [] clears. */
  highlight?: string[];
  /** Button ids that cannot be pressed. [] clears. */
  disabled?: string[];
  /** Vibrate the phone for this many ms (0-2000). One-shot, Android only. */
  vibrate?: number;
}

export interface Input {
  /** -1 (left) .. 1 (right). The d-pad gives -1, 0 or 1. */
  x: number;
  /** -1 (up) .. 1 (down). The d-pad gives -1, 0 or 1. */
  y: number;
  /** Held state of every layout button. Use for movement/charging, not one-shot actions. */
  buttons: Record<string, boolean>;
  /** Buttons that went down since the previous input(n) call. Latched and cleared on read: use for attacks, jumps, menu selects. */
  pressed: Record<string, true>;
}

export type LeaveReason = 'left' | 'disconnected' | 'timeout' | 'kicked';
export type Status = 'connecting' | 'connected' | 'reconnecting' | 'closed';

export interface HostEvents {
  join: { slot: number; name: string; rejoin: boolean };
  leave: { slot: number; reason: LeaveReason };
  message: { slot: number; data: unknown };
  status: Status;
  /** Server errors after host() resolved. 'replaced' (another tab resumed this room, e.g. a duplicated tab) also closes this room object. */
  error: { code: string; message?: string };
}

export interface HostOptions {
  /** Number of player slots, 1-8. Default 2. */
  slots?: number;
  /** Default: d-pad plus buttons 'a' and 'b'. */
  layout?: Layout;
  /** Joinstick server URL, e.g. 'http://localhost:3000'. Default: where host.js was loaded from. Required when you bundle this file. */
  server?: string;
}

export interface Room {
  /** 4-letter room code, e.g. 'KQZX'. */
  readonly code: string;
  readonly slots: number;
  readonly status: Status;
  /** Current input of slot n (1-based). Never undefined: neutral when the slot is empty. Clears `pressed`. Throws RangeError for a bad slot. */
  input(n: number): Input;
  connected(n: number): boolean;
  /** URL of an SVG QR code that opens the pad for slot n. Use as <img src>. */
  qr(n: number): string;
  /** The URL inside the QR. Show it as text under the QR. */
  joinUrl(n: number): string;
  pad(n: number, patch: PadPatch): void;
  /** Disconnect the phone in slot n; the slot becomes free. */
  kick(n: number): void;
  /** Send any JSON value to the phone in slot n. */
  send(n: number, data: unknown): void;
  broadcast(data: unknown): void;
  /** Returns a function that removes the listener. */
  on<E extends keyof HostEvents>(event: E, fn: (arg: HostEvents[E]) => void): () => void;
  /** Disconnect and forget the room (the server drops it 60 s later). */
  close(): void;
}

/**
 * Create a room, or resume the one stored in sessionStorage (same server and
 * slot count) after a page reload. Resuming resets every pad's state (title,
 * color, highlight, disabled). Pads already connected are visible through
 * connected(n) when this resolves; no 'join' event is emitted for them.
 * Rejects if the server is unreachable or refuses the options.
 */
export function host(options?: HostOptions): Promise<Room>;
