import { RpcClient, Encoding, Resolver } from "./wasm/kaspa";
import Treasury from "./src/treasury";
import Templates from "./src/stratum/templates";
import Stratum from "./src/stratum";
import Pool from "./src/pool";
import config from "./config/config.json";
import dotenv from 'dotenv';
import Monitoring from './src/monitoring'
import { PushMetrics, startMetricsServer, varDiff } from "./src/prometheus";
import axios from 'axios';
import fs from 'fs';
import path from 'path';

function shutdown() {
  monitoring.log("\n\n Gracefully shutting down the pool")
  process.exit();
}

process.on('SIGINT', shutdown);

export let DEBUG = 0
if (process.env.DEBUG == "1") {
  DEBUG = 1;
}

// Send config.json to API server
async function sendConfig() {
  if (DEBUG) monitoring.debug(`Main: Trying to send config to katpool-monitor`);
  try {
    const configPath = path.resolve('./config/config.json');
    const configData = fs.readFileSync(configPath, 'utf-8');

    const katpoolMonitor = process.env.MONITOR;
    if (!katpoolMonitor) {
      throw new Error('Environment variable MONITOR is not set.');
    }

    const response = await axios.post(`${katpoolMonitor}/postconfig`, {
      config: JSON.parse(configData),
    });

    monitoring.log(`Main: Config sent to API server. Response status: ${response.status}`);
  } catch (error) {
    monitoring.error(`Main: Error sending config: ${error}`);
  }
}

const monitoring = new Monitoring();
monitoring.log(`Main: Starting katpool App`)

dotenv.config();

monitoring.log(`Main: network: ${config.network}`);

const rpc = new RpcClient({
  resolver: new Resolver(),
  encoding: Encoding.Borsh,
  networkId: config.network,
});

try{  
  await rpc.connect();
} catch(err) {
  monitoring.error(`Error while connecting to rpc url : ${rpc.url} Error: ${err}`)
}

monitoring.log(`Main: RPC connection started`)

const serverInfo = await rpc.getServerInfo();
if (!serverInfo.isSynced || !serverInfo.hasUtxoIndex) throw Error('Provided node is either not synchronized or lacks the UTXO index.');

const treasuryPrivateKey = process.env.TREASURY_PRIVATE_KEY;
if (!treasuryPrivateKey) {
  throw new Error('Environment variable TREASURY_PRIVATE_KEY is not set.');
}

export const metrics = new PushMetrics();

sendConfig();

startMetricsServer();

const treasury = new Treasury(rpc, serverInfo.networkId, treasuryPrivateKey, config.treasury.fee);
// Array to hold multiple pools
const pools: Pool[] = [];

for (const stratumConfig of config.stratum) {
    // Create Templates instance
    const templates = new Templates(rpc, treasury.address, stratumConfig.templates.cacheSize);

    // Create Stratum instance
    const stratum = new Stratum(
        templates, 
        stratumConfig.port, 
        stratumConfig.difficulty, 
        treasury.address, 
        stratumConfig.sharesPerMinute,
        stratumConfig.clampPow2,
        stratumConfig.varDiff,
        stratumConfig.extraNonceSize,
        stratumConfig.minDiff,
        stratumConfig.maxDiff,
    );

    // Create Pool instance
    const pool = new Pool(treasury, stratum, stratum.sharesManager);

    // Store the pool for later reference
    pools.push(pool);
}

// Now you have an array of `pools` for each stratum configuration
console.log(`✅ Created ${pools.length} pools.`);