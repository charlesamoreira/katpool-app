ALTER TABLE miners_balance ADD nacho_rebate_kas NUMERIC DEFAULT 0;

CREATE TABLE IF NOT EXISTS nacho_payments (
    id SERIAL PRIMARY KEY,
    wallet_address TEXT[] NOT NULL,
    nacho_amount BIGINT NOT NULL,
    timestamp TIMESTAMP DEFAULT NOW(),
    transaction_hash VARCHAR(255) NOT NULL
);