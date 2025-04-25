import { EventEmitter } from 'events'
import Monitoring from '../monitoring';
import { PrivateKey, UtxoProcessor, UtxoContext, type RpcClient } from "../../wasm/kaspa"
import Database from '../pool/database';

const startTime = BigInt(Date.now())

UtxoProcessor.setCoinbaseTransactionMaturityDAA('mainnet', 200n)
UtxoProcessor.setCoinbaseTransactionMaturityDAA('testnet-10', 200n)
UtxoProcessor.setCoinbaseTransactionMaturityDAA('testnet-11', 2000n)

const db = new Database(process.env.DATABASE_URL || '');

export default class Treasury extends EventEmitter {
  privateKey: PrivateKey
  address: string
  processor: UtxoProcessor
  context: UtxoContext
  fee: number
  rpc: RpcClient
  private monitoring: Monitoring;
  private blockQueue: any[] = [];
  
  constructor(rpc: RpcClient, networkId: string, privateKey: string, fee: number) {
    super()

    this.rpc = rpc  
    this.privateKey = new PrivateKey(privateKey)
    this.address = (this.privateKey.toAddress(networkId)).toString()
    this.processor = new UtxoProcessor({ rpc, networkId })
    this.context = new UtxoContext({ processor: this.processor })
    this.fee = fee
    this.monitoring = new Monitoring();
    this.monitoring.log(`Treasury: Pool Wallet Address: " ${this.address}`)

    this.registerProcessor()
    try {
      this.rpc.subscribeBlockAdded();
    } catch(error) {
      this.monitoring.error(`TREASURY: SUBSCRIBE ERROR: ${error}`);
    }
    try {
      this.listenToBlocks();
    } catch(error) {
      this.monitoring.error(`TREASURY: LISTEN ERROR: ${error}`);
    }
  }

  private async listenToBlocks() {  
    this.rpc.addEventListener("block-added", async (eventData: any) => {
      try {
        const data = eventData.data;  
        const reward_block_hash = data?.block?.header?.hash;
        if (!reward_block_hash) {
          this.monitoring.debug("TREASURY: Block hash is undefined");
          return;
        }
  
        this.blockQueue.push(data);
      } catch(error) {
        this.monitoring.error(`TREASURY: Error in block-added handler: ${error}`);
      }
    });

    const MAX_PARALLEL_JOBS = 10;
    let activeJobs = 0;

    const processQueue = async () => {
      while(true) {
        while (activeJobs < MAX_PARALLEL_JOBS && this.blockQueue.length > 0) {
          const data = this.blockQueue.shift();
          activeJobs++;

          (async () => {
            try {
              await this.processBlockData(data);
            } catch (error) {
              this.monitoring.error(`TREASURY: Error in parallel handler - ${error}`);
            } finally {
              activeJobs--;
            }
          })();
        }

        await new Promise(resolve => setTimeout(resolve, 10));
      }
    };
    processQueue();
  }  

  private async processBlockData(data: any) {
    const transactions = data?.block?.transactions || [];
    if (!Array.isArray(transactions) || transactions.length === 0) return;
  
    const TARGET_ADDRESS = this.address;

    txLoop:
    for (const tx of transactions) {
      for (const [index, vout] of (tx.outputs || []).entries()) {
        const addr = vout?.verboseData?.scriptPublicKeyAddress;
        if (addr === TARGET_ADDRESS) {
          try {
            const reward_block_hash = data?.block?.header?.hash; 
            const txId = tx.verboseData?.transactionId;
            this.monitoring.debug(`Reward hash: ${reward_block_hash} | TX: ${txId}`);
            db.addRewardDetails(reward_block_hash, txId);
            break txLoop;
          } catch(error) {
            this.monitoring.error(`Treasury: Adding reward details -${error}`);
            break txLoop;
          }
        }
      }
    }
  }  
  
  private registerProcessor() {
    this.processor.addEventListener("utxo-proc-start", async () => {
      await this.context.clear()
      await this.context.trackAddresses([this.address])
    })

    this.processor.addEventListener('maturity', async (e) => {
      // this.monitoring.log(`Treasury: Maturity event data : ${JsonBig.stringify(e)}`)
      if (e?.data?.type === 'incoming') {
        // @ts-ignore
        if (!e?.data?.data?.utxoEntries?.some(element => element?.isCoinbase)) {
          this.monitoring.log(`Treasury: Not coinbase event. Skipping`)
          return
        }
        const { timestamps } = await this.rpc.getDaaScoreTimestampEstimate({
          daaScores: [e.data.blockDaaScore]
        })
        if (timestamps[0] < startTime) {
          this.monitoring.log(`Treasury: Earlier event detected. Skipping`)
          return
        }

        // @ts-ignore
        const reward = e.data.value
        const txnId = e.data.id
        const daaScore = e.data.blockDaaScore
        this.monitoring.log(`Treasury: Maturity event received. Reward: ${reward}, Event timestamp: ${Date.now()}, TxnId: ${txnId}`);
        const poolFee = (reward * BigInt(this.fee * 100)) / 10000n
        this.monitoring.log(`Treasury: Pool fees to retain on the coinbase cycle: ${poolFee}.`);
        const reward_block_hash = await db.getRewardBlockHash(txnId.toString());
        if (reward_block_hash != undefined)
          this.emit('coinbase', reward - poolFee, poolFee, reward_block_hash,  txnId, daaScore)
        else
        this.emit('coinbase', reward - poolFee, poolFee, '',  txnId, daaScore)
      }
    })

    this.processor.start()
  }
}