#!/bin/bash

# Stop on errors and make pipeline failures trigger failure
set -e
set -o pipefail

# Set the date format for the backup filename
DATE=$(date +\%Y\%m\%d\%H\%M)

# Define the backup directory
BACKUP_DIR="/backup/files"
mkdir -p $BACKUP_DIR

# Define the backup filename
BACKUP_FILE="$BACKUP_DIR/db_backup_$DATE.sql.gz"

# Perform the backup using pg_dumpall and compress it
echo "[$(date)] Starting backup..."
if PGPASSWORD=$POSTGRES_PASSWORD pg_dumpall -h $POSTGRES_HOSTNAME -U $POSTGRES_USER | gzip > "$BACKUP_FILE"; then
    echo "[$(date)] Backup completed: $BACKUP_FILE"
else
    echo "[$(date)] Backup failed. Check the PostgreSQL server or connection settings."
    exit 1
fi