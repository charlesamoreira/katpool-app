DO $$ BEGIN
    CREATE TYPE status_enum AS ENUM ('PENDING', 'FAILED', 'COMPLETED');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS pending_krc20_transfers (
    id SERIAL PRIMARY KEY,
    first_txn_id VARCHAR(255) UNIQUE NOT NULL,
    sompi_to_miner BIGINT NOT NULL,
    nacho_amount BIGINT NOT NULL,
    address VARCHAR(255) NOT NULL,
    p2sh_address VARCHAR(255) NOT NULL,
    nacho_transfer_status status_enum DEFAULT 'PENDING',
    db_entry_status status_enum DEFAULT 'PENDING',
    timestamp TIMESTAMP DEFAULT NOW()
);