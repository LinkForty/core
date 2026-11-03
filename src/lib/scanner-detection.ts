/**
 * Email security scanner detection for click ingestion.
 *
 * Mail security services (Microsoft Defender Safe Links, Mimecast, Proofpoint,
 * Barracuda and others) open every URL in a delivered message, usually in a
 * sandboxed browser, to check where it leads. To the redirect that request is
 * indistinguishable from a person clicking: a GET with a stock desktop browser
 * user agent, so the `isbot` list doesn't catch it. What gives it away is the
 * network it comes from: the scanners run in the large cloud providers' data
 * centers, where people rarely browse from a desktop browser.
 *
 * The rule therefore flags a click when the IP's autonomous system (ASN) is one
 * of the cloud networks below *and* the user agent is a desktop browser. Mobile
 * browsers and app HTTP clients from those networks are left alone.
 *
 * The ASN comes from an MMDB-format ASN database that the instance supplies,
 * such as DB-IP's IP to ASN Lite (CC BY 4.0, attribution required). Without one
 * the rule is simply off and classification works as before.
 */
import { readFileSync } from 'fs';
import { Reader, type AsnResponse } from 'maxmind';

/**
 * Networks the major email security scanners run from, by ASN. These are the
 * hyperscale cloud providers, not the scanner vendors' own corporate networks.
 */
export const DEFAULT_SCANNER_ASNS: readonly number[] = [
  8075, // Microsoft (Azure; Defender for Office 365 Safe Links)
  8070, // Microsoft
  16509, // Amazon (AWS)
  14618, // Amazon (AWS us-east-1)
  15169, // Google
  396982, // Google Cloud
];

/**
 * Networks that must never be on the scanner list: iCloud Private Relay exits
 * through them, so a real person browsing in Safari with Private Relay would be
 * flagged. Rejected in linkforty.config.json (lib/config.ts).
 */
export const RELAY_ASNS: readonly number[] = [
  714, // Apple
  13335, // Cloudflare
  20940, // Akamai
  36183, // Akamai (Private Relay)
  54113, // Fastly
];

/** Looks up the ASN for an IP address, or null when unknown. */
export type AsnLookup = (ip: string) => number | null;

interface ScannerDetectionState {
  lookup: AsnLookup;
  asns: ReadonlySet<number>;
}

let state: ScannerDetectionState | null = null;

/**
 * Turn the email scanner rule on (or off, with `lookup: null`).
 *
 * `asns` replaces DEFAULT_SCANNER_ASNS; an empty list turns the rule off.
 */
export function configureScannerDetection(options: { lookup: AsnLookup | null; asns?: readonly number[] }): void {
  const asns = new Set(options.asns ?? DEFAULT_SCANNER_ASNS);
  state = options.lookup && asns.size > 0 ? { lookup: options.lookup, asns } : null;
}

/** Whether the email scanner rule is active. */
export function isScannerDetectionEnabled(): boolean {
  return state !== null;
}

/**
 * Open an ASN database (`.mmdb` with `autonomous_system_number` records, as
 * DB-IP and MaxMind publish) and return a lookup over it. Reads the
 * file once; lookups are in memory.
 *
 * @throws when the file can't be read or isn't an MMDB database.
 */
export function openAsnDatabase(path: string): AsnLookup {
  const reader = new Reader<AsnResponse>(readFileSync(path));
  return (ip) => {
    try {
      return reader.get(ip)?.autonomous_system_number ?? null;
    } catch {
      // Not a valid IP address (e.g. an empty string when the IP is unknown).
      return null;
    }
  };
}

/**
 * Load the ASN database named by `path` and configure the rule. A missing or
 * unreadable database leaves the rule off rather than stopping the server: the
 * database is an optional enhancement, and classification without it is what
 * every instance did before. Returns whether the rule is now on.
 */
export function loadScannerDetection(
  path: string | undefined,
  options: { asns?: readonly number[]; log?: (message: string) => void } = {}
): boolean {
  const log = options.log ?? ((message: string) => console.warn(message));
  if (!path) {
    configureScannerDetection({ lookup: null });
    return false;
  }
  try {
    configureScannerDetection({ lookup: openAsnDatabase(path), asns: options.asns });
  } catch (error) {
    configureScannerDetection({ lookup: null });
    const reason = error instanceof Error ? error.message : String(error);
    log(`Email scanner detection is off: could not open the ASN database at ${path} (${reason})`);
    return false;
  }
  return isScannerDetectionEnabled();
}

/**
 * A desktop browser user agent: Windows, macOS, Linux (X11) or ChromeOS. Mobile
 * browsers and app HTTP clients (`CFNetwork`, `okhttp`) don't match.
 */
const DESKTOP_BROWSER_UA = /^Mozilla\/5\.0 \((?:Windows NT|Macintosh|X11|CrOS)/;

/** Whether this request looks like an email security scanner opening a link. */
export function isEmailScanner(userAgent: string | undefined, ip: string | undefined): boolean {
  if (!state || !ip || !userAgent) return false;
  if (!DESKTOP_BROWSER_UA.test(userAgent)) return false;
  const asn = state.lookup(ip);
  return asn !== null && state.asns.has(asn);
}
