/**
 * Live connection state per channel (`platform:account`), updated from ChatKit's
 * `connection` events and read by the accounts API so the UI can show which
 * channels are online / connecting / awaiting a QR scan.
 */

export type ConnState = 'connecting' | 'qr' | 'authenticated' | 'open' | 'closed';

const status = new Map<string, ConnState>();

export const statusKey = (platform: string, account: string) => `${platform}:${account}`;

export function setStatus(platform: string, account: string, state: ConnState): void {
	status.set(statusKey(platform, account), state);
}

export function getStatus(platform: string, account: string): ConnState | undefined {
	return status.get(statusKey(platform, account));
}

export function clearStatus(platform: string, account: string): void {
	status.delete(statusKey(platform, account));
}
