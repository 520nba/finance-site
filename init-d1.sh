#!/bin/bash
set -e

ACCOUNT_ID="66336439752d587021f595deb04e8fe9"
DB_ID="8451af7d-ba5b-47b3-915f-8aee5fa82723"
TOKEN="xaXtmk1DP6e-zRxije39XgDPJE983pamaf3MBour"
API="https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/d1/database/$DB_ID/query"

run_sql() {
    local sql="$1"
    local result
    result=$(curl -s -X POST "$API" \
        -H "Authorization: Bearer $TOKEN" \
        -H "Content-Type: application/json" \
        --data-raw "{\"sql\": $(echo "$sql" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))')}")
    
    local success
    success=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('success', False))")
    
    if [ "$success" != "True" ]; then
        echo "FAILED: $sql"
        echo "$result"
        exit 1
    fi
    echo "OK: $(echo "$sql" | head -c 60)..."
}

echo "=== Starting D1 Schema Initialization ==="

run_sql "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, last_login DATETIME DEFAULT CURRENT_TIMESTAMP)"

run_sql "CREATE TABLE IF NOT EXISTS user_assets (user_id TEXT NOT NULL, code TEXT NOT NULL, type TEXT NOT NULL, added_at DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(user_id, code, type), FOREIGN KEY(user_id) REFERENCES users(id))"

run_sql "CREATE TABLE IF NOT EXISTS asset_names (code TEXT NOT NULL, type TEXT NOT NULL, name TEXT NOT NULL, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(code, type))"

run_sql "CREATE TABLE IF NOT EXISTS asset_history (code TEXT NOT NULL, type TEXT NOT NULL, price REAL NOT NULL, record_date TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(code, type, record_date))"

run_sql "CREATE TABLE IF NOT EXISTS asset_intraday (code TEXT NOT NULL, record_date TEXT NOT NULL, data TEXT NOT NULL, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(code, record_date))"

run_sql "CREATE TABLE IF NOT EXISTS asset_quotes (code TEXT PRIMARY KEY, name TEXT, price REAL, change REAL, changePercent REAL, prevClose REAL, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)"

run_sql "CREATE TABLE IF NOT EXISTS system_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, level TEXT NOT NULL, module TEXT, message TEXT NOT NULL, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)"

run_sql "CREATE TABLE IF NOT EXISTS admin_sessions (token TEXT PRIMARY KEY, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, expires_at DATETIME NOT NULL)"

run_sql "CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON system_logs(timestamp)"

echo "=== D1 Schema Initialization Complete! ==="
