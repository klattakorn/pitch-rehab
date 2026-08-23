/**
 * Types for make-cert.mjs, so vite.config.ts can import it under `strict`.
 *
 * The script itself stays plain JavaScript: it has to run under bare `node` from
 * `start.bat`, before anything has been built.
 */
export declare const CERT_DIR: string;
export declare const KEY: string;
export declare const CERT: string;

/** Every IPv4 address this machine has on a local network, most likely first. */
export declare function localAddresses(): string[];

/** One line per address, the first being the one to try. */
export declare function phoneUrls(scheme?: string, port?: string): string[];

export declare function certExists(): boolean;

/** The addresses the certificate on disk actually covers. */
export declare function certAddresses(): string[];

export declare function certCovers(address: string): boolean;

export declare function generateCert(): {
  ok: boolean;
  reason: string;
  addresses: string[];
  sans: string;
};

/** Certificate status: what it was, and what had to be done about it. */
export type CertStatus = "ok" | "created" | "renewed" | "no-openssl";

/** Rewrite the certificate if this machine's address has moved since it was made. */
export declare function ensureCert(): {
  status: CertStatus;
  addresses: string[];
  was: string[];
};
