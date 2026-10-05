import type { Server } from 'node:http';

export interface AttachOptions {
  /** Also serve this directory (your game) for paths Joinstick does not handle. */
  static?: string;
  /** Origin phones should open, e.g. 'https://play.example.com'. Default: the request's host, else the LAN address. */
  publicUrl?: string;
  /** How long a room waits for its game page to come back before closing, in ms. Default 60000. */
  hostGraceMs?: number;
  /**
   * Header a trusted reverse proxy sets to the visitor's address, e.g. 'fly-client-ip' or
   * 'x-real-ip'. The per-address limits use it (first value) instead of the socket address.
   * Only set it behind a proxy that overwrites the header: clients can send it themselves.
   */
  clientIpHeader?: string;
}

/**
 * Add Joinstick to an existing Node HTTP server: the WebSocket endpoint, the
 * pad page at /j, the browser SDKs at /joinstick/*, QR codes and /llms.txt.
 * Existing 'request' listeners keep working for every other path.
 */
export function attach(server: Server, opts?: AttachOptions): { close(): void };
