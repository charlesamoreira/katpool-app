CREATE TABLE IF NOT EXISTS pending_krc20_transfers (
    id SERIAL PRIMARY KEY,
    first_txn_id VARCHAR(255) UNIQUE NOT NULL,
    sompi_to_miner BIGINT NOT NULL,
    nacho_amount BIGINT NOT NULL,
    address VARCHAR(255) NOT NULL,
    p2sh_address VARCHAR(255) NOT NULL,
    nacho_transfer_status ENUM('PENDING', 'FAILED', 'COMPLETED') DEFAULT 'PENDING',
    db_entry_status ENUM('PENDING', 'FAILED', 'COMPLETED') DEFAULT 'PENDING',
    timestamp TIMESTAMP DEFAULT NOW()
);