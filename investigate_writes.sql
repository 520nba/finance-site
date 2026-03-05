SELECT 'asset_intraday' as tab, count(*) as count FROM asset_intraday WHERE updated_at > datetime('now', '-1 hour');
SELECT 'asset_quotes' as tab, count(*) as count FROM asset_quotes WHERE updated_at > datetime('now', '-1 hour');
SELECT 'asset_history' as tab, count(*) as count FROM asset_history LIMIT 1; -- Just to check presence
SELECT code, count(*) as update_count FROM (
    SELECT code FROM asset_intraday WHERE updated_at > datetime('now', '-1 hour')
) GROUP BY code ORDER BY update_count DESC LIMIT 10;
