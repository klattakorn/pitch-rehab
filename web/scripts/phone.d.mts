/** Types for phone.mjs — see make-cert.d.mts for why these are separate. */
import type { Plugin } from "vite";

import type { CertStatus } from "./make-cert.d.mts";

export declare function phoneAddresses(): { best: string | undefined; spares: string[] };

export declare function qrLines(
  text: string,
  options?: { columns?: number; color?: boolean },
): { fits: boolean; lines: string[] };

export declare function phoneBanner(options: {
  scheme: string;
  port: string | number;
  columns?: number;
  color?: boolean;
  cert?: CertStatus | null;
}): string[];

export declare function phonePage(options: {
  scheme: string;
  port: string | number;
  stale?: string[];
}): string;

/** Serves `/phone`, and prints a QR code once the dev server is listening. */
export declare function phonePlugin(options?: { cert?: CertStatus | null }): Plugin;
