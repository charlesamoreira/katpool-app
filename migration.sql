CREATE TABLE IF NOT EXISTS reward_block_details (
    id SERIAL PRIMARY KEY,
    reward_block_hash VARCHAR(255) UNIQUE NOT NULL,
    reward_txn_id VARCHAR(255) UNIQUE NOT NULL
);