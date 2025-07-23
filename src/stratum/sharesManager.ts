import type { Socket } from 'bun';
import { calculateTarget } from '../../wasm/kaspa';
import { stringifyHashrate, getAverageHashrateGHs, debugHashrateCalculation } from './utils';
import Monitoring from '../monitoring';
import {
  minerAddedShares,
  minerInvalidShares,
  minerDuplicatedShares,
  workerHashRateGauge,
  activeMinerGuage,
} from '../prometheus';
import { metrics } from '../../index';
import Denque from 'denque';
import type Templates from './templates';
import Jobs from './templates/jobs';
import logger from '../monitoring/datadog';
import { AsicType, type Contribution, type MinerData, type WorkerStats } from '../types';
import JsonBig from 'json-bigint';
import { DEBUG, WINDOW_SIZE } from '../constants';
import { VariableDifficulty } from './variableDifficulty';

export class SharesManager {
  public miners: Map<string, MinerData> = new Map();
  private monitoring: Monitoring;
  private shareWindow: Denque<Contribution>;
  private lastAllocationTime: number;
  private lastAllocationDaaScore: bigint;
  private stratumMinDiff: number;
  private stratumInitDiff: number;
  public port: number;
  public varDiff: VariableDifficulty;

  constructor(
    stratumInitDiff: number,
    stratumMinDiff: number,
    stratumMaxDiff: number,
    port: number
  ) {
    this.stratumMinDiff = stratumMinDiff;
    this.monitoring = new Monitoring();
    this.startStatsThread(); // Start the stats logging thread
    this.shareWindow = new Denque();
    this.lastAllocationTime = Date.now();
    this.lastAllocationDaaScore = 0n;
    this.stratumInitDiff = stratumInitDiff;
    this.port = port;
    this.varDiff = new VariableDifficulty(this, stratumMinDiff, stratumMaxDiff);
  }

  getOrCreateWorkerStats(workerName: string, minerData: MinerData): WorkerStats {
    if (!minerData.workerStats.has(workerName)) {
      let varDiffStatus = false;
      if (this.port === 8888) {
        varDiffStatus = true;
        this.monitoring.debug(
          `SharesManager ${this.port}: New worker stats created for ${workerName}, defaulting to enabled var-diff due to connection to the port 8888.`
        );
      }
      const workerStats: WorkerStats = {
        blocksFound: 0,
        sharesFound: 0,
        sharesDiff: 0,
        staleShares: 0,
        invalidShares: 0,
        workerName,
        startTime: Date.now(),
        lastShare: Date.now(),
        varDiffStartTime: Date.now(),
        varDiffSharesFound: 0,
        varDiffWindow: 0,
        minDiff: this.stratumInitDiff, // Initial difficulty
        recentShares: new Denque<{ timestamp: number; difficulty: number; nonce: bigint }>(),
        hashrate: 0,
        asicType: AsicType.Unknown,
        varDiffEnabled: varDiffStatus,
      };
      minerData.workerStats.set(workerName, workerStats);
      if (DEBUG)
        this.monitoring.debug(
          `SharesManager ${this.port}: Created new worker stats for ${workerName}`
        );
    }
    return minerData.workerStats.get(workerName)!;
  }

  async addShare(
    minerId: string,
    address: string,
    hash: string,
    difficulty: number,
    nonce: bigint,
    templates: Templates,
    id: string
  ) {
    let minerData = this.miners.get(address);
    if (!minerData) {
      minerData = {
        sockets: new Set(),
        workerStats: new Map(),
      };
      this.miners.set(address, minerData);
    }

    const workerStats = this.getOrCreateWorkerStats(minerId, minerData);
    // Critical Section: Check and Add Share
    for (let i = 0; i < workerStats.recentShares.size(); i++) {
      const share = workerStats.recentShares.get(i);
      if (share?.nonce === nonce) {
        metrics.updateGaugeInc(minerDuplicatedShares, [minerId, address]);
        this.monitoring.log(`SharesManager ${this.port}: Duplicate share for miner - ${minerId}`);
        logger.warn('Duplicate share detected', {
          minerId,
          address,
          port: this.port,
          nonce: nonce.toString(),
        });
        return;
      }
    }

    const timestamp = Date.now();
    const currentDifficulty = workerStats.minDiff || difficulty;

    if (DEBUG)
      this.monitoring.debug(
        `SharesManager ${this.port}: Share added for ${minerId} - Address: ${address} - Nonce: ${nonce}`
      );

    const state = templates.getPoW(hash);
    if (!state) {
      if (DEBUG)
        this.monitoring.debug(
          `SharesManager ${this.port}: Stale header for miner ${minerId} and hash: ${hash}`
        );
      workerStats.staleShares++; // Add this to track stale shares in worker stats
      logger.warn('Stale share detected', {
        minerId,
        address,
        port: this.port,
        jobId: id,
      });
      return;
    }

    const [isBlock, target] = state.checkWork(nonce);
    const validity = target <= calculateTarget(currentDifficulty);
    if (!validity) {
      if (DEBUG)
        this.monitoring.debug(
          `SharesManager ${this.port}: Invalid share for target: ${target} for miner ${minerId}`
        );
      metrics.updateGaugeInc(minerInvalidShares, [minerId, address]);
      workerStats.invalidShares++;
      logger.warn('Invalid share detected', {
        minerId,
        address,
        port: this.port,
        target: target.toString(),
        difficulty: currentDifficulty,
      });
      return;
    }

    // Share is valid at this point, increment the valid share metric
    metrics.updateGaugeInc(minerAddedShares, [minerId, address]);

    if (DEBUG)
      this.monitoring.debug(
        `Pool: - SharesManager ${this.port}: Contributed block share added from: ${minerId} with address ${address} for nonce: ${nonce}`
      );

    const daaScore = Jobs.getDaaScoreFromJobId(id);
    const share: Contribution = {
      minerId,
      address,
      difficulty,
      timestamp: Date.now(),
      jobId: id,
      daaScore,
    };
    this.shareWindow.push(share);
    if (isBlock) {
      if (DEBUG)
        this.monitoring.debug(
          `SharesManager ${this.port}: Work found for ${minerId} and target: ${target}`
        );

      // Log block discovery - this is a critical event
      logger.info('Block found!', {
        minerId,
        address,
        port: this.port,
        target: target.toString(),
        difficulty: currentDifficulty,
        hash: hash.substring(0, 16) + '...',
        nonce: nonce.toString(),
        jobId: id,
        daaScore: daaScore.toString(),
      });

      const report = await templates.submit(minerId, address, hash, nonce);
      if (report === 'success') {
        workerStats.blocksFound++;
        logger.info('Block submission successful', {
          minerId,
          address,
          port: this.port,
          hash: hash.substring(0, 16) + '...',
        });
      } else {
        logger.error('Block submission failed', {
          minerId,
          address,
          port: this.port,
          hash: hash.substring(0, 16) + '...',
          report,
        });
      }
    }

    workerStats.sharesFound++;
    workerStats.varDiffSharesFound++;
    workerStats.lastShare = timestamp;
    workerStats.minDiff = currentDifficulty;

    // Update recentShares with the new share
    workerStats.recentShares.push({ timestamp: Date.now(), difficulty: currentDifficulty, nonce });

    while (
      workerStats.recentShares.length > 0 &&
      Date.now() - workerStats.recentShares.peekFront()!.timestamp > WINDOW_SIZE
    ) {
      workerStats.recentShares.shift();
    }
  }

  startStatsThread() {
    const start = Date.now();
    setInterval(() => {
      let str =
        '\n===============================================================================\n';
      str += '  worker name   |  avg hashrate  |   acc/stl/inv  |    blocks    |    uptime   \n';
      str += '-------------------------------------------------------------------------------\n';

      const lines: string[] = [];
      let totalRate = 0;

      this.miners.forEach((minerData, address) => {
        let rate = 0;
        minerData.workerStats.forEach((stats, workerName) => {
          // Update active status metrics
          let workerRate = 0;
          const status = this.checkWorkerStatus(stats);
          metrics.updateGaugeValue(
            activeMinerGuage,
            [workerName, address, stats.asicType, this.port.toString()],
            status
          );
          if (status) {
            workerRate = getAverageHashrateGHs(stats, address);
            debugHashrateCalculation(stats, address, workerRate);
          } else {
            logger.warn(
              `SharesManager ${this.port}: Worker ${address}.${workerName} is inactive, setting hashrate to 0`
            );
            workerRate = 0;
          }
          rate += workerRate;

          // Update hashrate - in metrics and workerStats
          stats.hashrate = workerRate;
          metrics.updateGaugeValue(workerHashRateGauge, [workerName, address], workerRate);

          const rateStr = stringifyHashrate(workerRate);
          const ratioStr = `${stats.sharesFound}/${stats.staleShares}/${stats.invalidShares}`;
          const uptime = (Date.now() - stats.startTime) / 1000;

          lines.push(
            ` ${stats.workerName.padEnd(15)}| ${rateStr.padEnd(14)} | ${ratioStr.padEnd(14)} | ${stats.blocksFound.toString().padEnd(12)} | ${uptime}s`
          );

          try {
            if (status === 0) {
              let found = false;
              let socket: Socket<any>;
              minerData.sockets.forEach(skt => {
                if (skt.data.workers.has(workerName) && !found) {
                  this.monitoring.debug(`\nSharesManager ${this.port}: MinerData before - `);
                  this.logData(minerData);
                  this.monitoring.debug(
                    `SharesManager ${this.port}: Status is inactive for worker: ${workerName}, address: ${address}`
                  );
                  minerData.workerStats.delete(workerName);
                  this.monitoring.debug(
                    `SharesManager ${this.port}: Deleted workerstats: ${workerName}, address: ${address}`
                  );
                  socket = skt;
                  this.monitoring.debug(
                    `SharesManager ${this.port}: Socket found for deletion: ${workerName}, address: ${address}`
                  );
                  found = true;
                  socket.end();
                  socket = skt;
                  minerData.sockets.delete(socket!);
                  this.monitoring.debug(
                    `SharesManager ${this.port}: Deleted socket for : ${workerName}, address: ${address}`
                  );
                  this.monitoring.debug(`\nSharesManager ${this.port}: MinerData after - `);
                  this.logData(minerData);
                }
              });
              if (!found) {
                this.monitoring.debug(
                  `SharesManager ${this.port}: ERROR - No socket found for deletion for worker: ${workerName}, address: ${address}`
                );
                logger.warn(
                  `SharesManager ${this.port}: No socket found for deletion for worker: ${workerName}, address: ${address}`
                );
              }
            }
          } catch (error) {
            this.monitoring.error(
              `SharesManager ${this.port}: Could not delete inactive worker: ${workerName}, address: ${address} - `,
              error
            );
          }
        });
        totalRate += rate;
      });

      lines.sort();
      str += lines.join('\n');

      const rateStr = stringifyHashrate(totalRate);
      const overallStats = this.calculateOverallStats();
      const ratioStr = `${overallStats.sharesFound}/${overallStats.staleShares}/${overallStats.invalidShares}`;

      str += '\n-------------------------------------------------------------------------------\n';
      str += `                | ${rateStr.padEnd(14)} | ${ratioStr.padEnd(14)} | ${overallStats.blocksFound.toString().padEnd(12)} | ${(Date.now() - start) / 1000}s`;
      str += '\n===============================================================================\n';

      this.monitoring.log(str);
    }, WINDOW_SIZE);
  }

  // Helper method for stats calculation
  private calculateOverallStats() {
    return Array.from(this.miners.values()).reduce(
      (acc: any, minerData: MinerData) => {
        minerData.workerStats.forEach(stats => {
          acc.sharesFound += stats.sharesFound;
          acc.staleShares += stats.staleShares;
          acc.invalidShares += stats.invalidShares;
          acc.blocksFound += stats.blocksFound;
        });
        return acc;
      },
      { sharesFound: 0, staleShares: 0, invalidShares: 0, blocksFound: 0 }
    );
  }

  getMiners() {
    return this.miners;
  }

  getSharesSinceLastAllocation(daaScore: bigint): Contribution[] {
    const currentTime = Date.now();
    const shares = [];
    while (
      this.shareWindow.length > 0 &&
      Jobs.getDaaScoreFromJobId(this.shareWindow.peekFront()?.jobId!) <= daaScore
    ) {
      shares.push(this.shareWindow.shift()!);
    }
    this.lastAllocationDaaScore = daaScore;
    return shares;
  }

  getDifficultyAndTimeSinceLastAllocation() {
    const currentTime = Date.now();
    const shares = [];
    const localData: Map<string, MinerData> = this.miners; // Take a local copy, as time can change during processing
    for (const [address, minerData] of localData) {
      if (!minerData || !minerData.workerStats) {
        if (DEBUG)
          this.monitoring.debug(
            `SharesManager ${this.port}: Invalid miner data for address ${address}`
          );
        continue;
      }

      for (const [workerName, workerStats] of minerData.workerStats) {
        if (!workerStats || !workerStats.workerName) {
          if (DEBUG)
            this.monitoring.debug(
              `SharesManager ${this.port}: Invalid worker stats or worker name for worker ${workerName}`
            );
          continue;
        }

        const timeSinceLastShare = Date.now() - (workerStats.lastShare ?? 0);
        if (timeSinceLastShare < 0) {
          if (DEBUG)
            this.monitoring.debug(
              `SharesManager ${this.port}: Skipping share due to negative timestamp for worker ${workerStats.workerName}`
            );
          continue;
        }

        const MAX_ELAPSED_MS = 5 * 60 * 1000; // 5 minutes
        const cappedTime = Math.min(timeSinceLastShare, MAX_ELAPSED_MS);

        // Normalize weight: 0 to 1 (smooth ramp-up for new connections)
        const timeWeight = cappedTime / MAX_ELAPSED_MS;

        // Scaled difficulty with weighted time factor
        let rawDifficulty = Math.round((workerStats.minDiff ?? 0) * timeWeight);
        if (rawDifficulty === 0) {
          const fallback = Math.max(
            1,
            Math.floor((workerStats.minDiff ?? this.stratumMinDiff) * 0.1)
          );
          if (DEBUG)
            this.monitoring.debug(
              `SharesManager ${this.port}: Scaled difficulty for ${workerStats.workerName} was 0, fallback to ${fallback}`
            );
          rawDifficulty = fallback;
        }
        const scaledDifficulty = rawDifficulty;

        // Add to shares array
        shares.push({
          address,
          minerId: workerStats.workerName,
          difficulty: scaledDifficulty,
          timestamp: cappedTime,
          jobId: '',
          daaScore: BigInt(0),
        });
      }
    }
    this.monitoring.debug(
      `SharesManager ${this.port}: Retrieved ${shares.length} shares. Last allocation time: ${this.lastAllocationTime}, Current time: ${currentTime}`
    );
    this.lastAllocationTime = currentTime;
    return shares;
  }

  checkWorkerStatus(stats: WorkerStats) {
    return Date.now() - stats.lastShare <= WINDOW_SIZE ? Math.floor(stats.lastShare / 1000) : 0;
  }

  logData(minerData: MinerData) {
    minerData.workerStats.forEach((stats, workerName) => {
      this.monitoring.log(
        `SharesManager ${this.port}: stats: ${JsonBig.stringify(stats)}, name: ${workerName}`
      );
    });
  }
}
