import Monitoring from '../monitoring';
import logger from '../monitoring/datadog';
import type { WorkerStats } from '../types';
import { WINDOW_SIZE } from './sharesManager';

const bigGig = Math.pow(10, 9);
const maxTarget = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF');
const minHash = (BigInt(1) << BigInt(256)) / maxTarget;
const monitoring = new Monitoring();

export function stringifyHashrate(ghs: number): string {
  const unitStrings = ['M', 'G', 'T', 'P', 'E', 'Z', 'Y'];
  let unit = unitStrings[0];
  let hr = ghs * 1000; // Default to MH/s

  for (const u of unitStrings) {
    if (hr < 1000) {
      unit = u;
      break;
    }
    hr /= 1000;
  }

  return `${hr.toFixed(2)}${unit}H/s`;
}

export function getAverageHashrateGHs(
  stats: WorkerStats,
  address: string,
  windowSize = WINDOW_SIZE
): number {
  // if (!stats.recentShares || stats.recentShares.isEmpty()) return 0;
  const relevantShares: { timestamp: number; difficulty: number }[] = [];

  // Use Denque's toArray() method to filter relevant shares
  stats.recentShares.toArray().forEach(share => {
    if (Date.now() - share.timestamp <= windowSize) {
      relevantShares.push(share);
    }
  });

  if (relevantShares.length === 0) {
    logger.warn(
      `Utils ${address}.${stats.workerName}: No relevant shares in the last ${windowSize / 1000} seconds`
    );
    return 0;
  }

  const avgDifficulty =
    relevantShares.reduce((acc, share) => acc + diffToHash(share.difficulty), 0) /
    relevantShares.length;
  const timeDifference = (Date.now() - relevantShares[0].timestamp) / 1000; // in seconds

  return (avgDifficulty * relevantShares.length) / timeDifference;
}

// Function to convert difficulty to hash
export function diffToHash(diff: number): number {
  const hashVal = Number(minHash) * diff;
  const result = hashVal / bigGig;

  return result;
}

// Debug function to log hashrate calculation details
export function debugHashrateCalculation(
  stats: WorkerStats,
  address: string,
  workerRate: number,
  windowSize = WINDOW_SIZE
): void {
  if (!stats.recentShares || stats.recentShares.isEmpty()) {
    monitoring.debug(`[DEBUG] No recent shares for worker ${stats.workerName}`);
    return;
  }

  const relevantShares: { timestamp: number; difficulty: number }[] = [];
  stats.recentShares.toArray().forEach(share => {
    if (Date.now() - share.timestamp <= windowSize) {
      relevantShares.push(share);
    }
  });

  if (relevantShares.length === 0) {
    monitoring.debug(`[DEBUG] No relevant shares in window for worker ${stats.workerName}`);
    return;
  }

  // Improved method calculation
  relevantShares.sort((a, b) => a.timestamp - b.timestamp);

  const timeSpan =
    relevantShares.length > 1
      ? (relevantShares[relevantShares.length - 1].timestamp - relevantShares[0].timestamp) / 1000
      : 1;

  const totalWork = relevantShares.reduce((acc, share) => acc + diffToHash(share.difficulty), 0);
  const improvedHashrate = totalWork / Math.max(timeSpan, 1);

  monitoring.debug(
    `[DEBUG] Hashrate calculation for address ${address} and worker ${stats.workerName}:`
  );
  monitoring.debug(`  - Shares in window: ${relevantShares.length}`);
  monitoring.debug(`  - Time span: ${timeSpan.toFixed(2)}s`);
  monitoring.debug(`  - Total work: ${totalWork.toFixed(2)}`);
  monitoring.debug(`  - Improved hashrate: ${improvedHashrate.toFixed(2)} GH/s`);
  monitoring.debug(`  - Current hashrate: ${workerRate} GH/s`);
  monitoring.debug(`  - Last share: ${new Date(stats.lastShare).toISOString()}`);
}
