CREATE TABLE IF NOT EXISTS miners_balance (
  id VARCHAR(255) PRIMARY KEY, 
  miner_id VARCHAR(255), 
  wallet VARCHAR(255),
  balance NUMERIC,
  nacho_rebate_kas NUMERIC DEFAULT 0
);

CREATE TABLE IF NOT EXISTS wallet_total (
  address VARCHAR(255) PRIMARY KEY,
  total NUMERIC
);

CREATE TABLE IF NOT EXISTS payments (
    id SERIAL PRIMARY KEY,
    wallet_address TEXT[] NOT NULL,
    amount BIGINT NOT NULL,
    timestamp TIMESTAMP DEFAULT NOW(),
    transaction_hash VARCHAR(255) NOT NULL
);

CREATE TABLE IF NOT EXISTS nacho_payments (
    id SERIAL PRIMARY KEY,
    wallet_address TEXT[] NOT NULL,
    nacho_amount BIGINT NOT NULL,
    timestamp TIMESTAMP DEFAULT NOW(),
    transaction_hash VARCHAR(255) NOT NULL
);

CREATE TABLE IF NOT EXISTS block_details (
    mined_block_hash VARCHAR(255) PRIMARY KEY,
    miner_id VARCHAR(255),
    pool_address VARCHAR(255),
    reward_block_hash VARCHAR(255),
    wallet VARCHAR(255),
    daa_score VARCHAR(255),
    miner_reward BIGINT NOT NULL,
    timestamp TIMESTAMP DEFAULT NOW()
);