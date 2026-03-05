SELECT code, record_date, length(data) as len, updated_at FROM asset_intraday ORDER BY updated_at DESC LIMIT 30;
