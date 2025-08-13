import { collectDefaultMetrics, register } from 'prom-client';
import PQueue from 'p-queue';
import Monitoring from '../monitoring';
import express from 'express';
import client from 'prom-client';
import { getServerStatus, serverUptime } from '../shared/heartbeat';
import JsonBig from 'json-bigint';
import { poolStartTime } from '../constants';

const queue = new PQueue({ concurrency: 1 });
const monitoring = new Monitoring();

collectDefaultMetrics();
export { register };

export const minerHashRateGauge = new client.Gauge({
  name: 'miner_hash_rate_GHps',
  help: 'Hash rate of each miner',
  labelNames: ['wallet_address'],
});

export const activeMinerGuage = new client.Gauge({
  name: 'active_workers_10m_count',
  help: 'Active workers data',
  labelNames: ['miner_id', 'wallet_address', 'asic_type', 'port'],
});

export const workerHashRateGauge = new client.Gauge({
  name: 'worker_hash_rate_GHps',
  help: 'Hash rate of worker',
  labelNames: ['miner_id', 'wallet_address'],
});

export const poolHashRateGauge = new client.Gauge({
  name: 'pool_hash_rate_GHps',
  help: 'Overall hash rate of the pool',
  labelNames: ['miner_id', 'pool_address'],
});

export const minerAddedShares = new client.Gauge({
  name: 'added_miner_shares_1min_count',
  help: 'Added shares per miner',
  labelNames: ['miner_id', 'wallet_address'],
});

export const minerInvalidShares = new client.Gauge({
  name: 'miner_invalid_shares_1min_count',
  help: 'Invalid shares per miner',
  labelNames: ['miner_id', 'wallet_address'],
});

export const minerDuplicatedShares = new client.Gauge({
  name: 'miner_duplicated_shares_1min_count',
  help: 'Duplicated shares per miner',
  labelNames: ['miner_id', 'wallet_address'],
});

export const jobsNotFound = new client.Gauge({
  name: 'jobs_not_found_1min_count',
  help: 'Total jobs not Found for registered template',
  labelNames: ['miner_id', 'wallet_address'],
});

// Needed for debugging
export const varDiff = new client.Gauge({
  name: 'var_diff',
  help: 'show the difficulty per miner over time',
  labelNames: ['miner_id', 'port'],
});

const newRegister = new client.Registry();

newRegister.registerMetric(minerHashRateGauge);
newRegister.registerMetric(activeMinerGuage);
newRegister.registerMetric(workerHashRateGauge);
newRegister.registerMetric(poolHashRateGauge);
newRegister.registerMetric(minerAddedShares);
newRegister.registerMetric(minerInvalidShares);
newRegister.registerMetric(minerDuplicatedShares);
newRegister.registerMetric(jobsNotFound);
newRegister.registerMetric(varDiff);

export function startMetricsServer() {
  const app = express();
  app.get('/metrics', async (req, res) => {
    res.set('Content-Type', newRegister.contentType);
    res.end(await newRegister.metrics());
  });

  app.get('/health', (req, res) => {
    const statuses: Record<string, string> = {};

    for (const portStr of Object.keys(serverUptime)) {
      const port = Number(portStr);
      statuses[port] = getServerStatus(port); // 'active', 'idle', or 'dead'
    }

    const hasDead = Object.values(statuses).includes('dead');

    const activePorts = Object.entries(statuses)
      .filter(([_, status]) => status === 'active')
      .map(([port]) => port);

    monitoring.log(`Prometheus: [Heartbeat] Bun server states: ${JsonBig.stringify(statuses)}`);

    const status = hasDead ? 'unhealthy' : 'ok';
    const statusCode = hasDead ? 503 : 200;

    res.status(statusCode).json({
      status,
      startTime: poolStartTime,
      activePorts,
      allPorts: statuses,
    });
  });

  app.listen(9999, () => {
    monitoring.log('Metrics server running at http://localhost:9999');
  });
}

export class PushMetrics {
  updateGaugeValue(gauge: client.Gauge, labels: string[], value: number) {
    queue.add(() => gauge.labels(...labels).set(value));
  }

  updateGaugeInc(gauge: client.Gauge, labels: string[]) {
    queue.add(() => gauge.labels(...labels).inc(1));
  }

  // Query Prometheus metrics to get historical data
  async queryWorkerHashrateHistory(
    workerName: string,
    walletAddress: string,
    samples: number = 5
  ): Promise<number[]> {
    try {
      // Make HTTP request to Prometheus query API
      const endTime = Math.floor(Date.now() / 1000);
      const startTime = endTime - samples * 600; // 30 minutes back
      const step = 600; // 10 minute intervals

      const query = `worker_hash_rate_GHps{miner_id="${workerName}",wallet_address="${walletAddress}"}`;
      const url = `http://localhost:9999/api/v1/query_range?query=${encodeURIComponent(query)}&start=${startTime}&end=${endTime}&step=${step}`;

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as {
        status: string;
        data?: {
          result?: Array<{
            values?: Array<[number, string]>;
          }>;
        };
      };

      if (data.status === 'success' && data.data?.result?.[0]?.values) {
        const values = data.data.result[0].values;
        // Extract the hashrate values from the time series data
        return values.map(([timestamp, value]) => parseFloat(value));
      }

      // Fallback: return empty array if no data found
      return [];
    } catch (error) {
      monitoring.error('Failed to query worker hashrate history:', error);
      return [];
    }
  }
}
