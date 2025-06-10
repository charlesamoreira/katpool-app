import Monitoring from '../../../monitoring';

const monitoring = new Monitoring();

export default class Jobs {
  private jobs: Map<string, string> = new Map();
  static rewardMapping: Map<string, bigint> = new Map();

  getHash(id: string) {
    return this.jobs.get(id);
  }

  deriveId(hash: string): string {
    const id = crypto.getRandomValues(Buffer.alloc(2)).toString('hex');
    if (this.jobs.has(id)) {
      return this.deriveId(hash);
    }
    this.jobs.set(id, hash);
    return id;
  }

  static setJobIdDaaScoreMapping(id: string, daaScore: bigint) {
    monitoring.debug(`Jobs: id - ${id} daaScore: ${daaScore}`);
    if (!Jobs.rewardMapping.has(id)) {
      Jobs.rewardMapping.set(id, daaScore);
    }
  }

  static getDaaScoreFromJobId(id: string): bigint {
    const value = Jobs.rewardMapping.get(id);
    if (value !== undefined) {
      monitoring.debug(`Jobs: id - ${id} found`);
      return value;
    }
    monitoring.debug(`Jobs: id - ${id} not found, returning 0`);
    return 0n;
  }

  expireNext() {
    this.jobs.delete(this.jobs.entries().next().value![0]);
  }
}
