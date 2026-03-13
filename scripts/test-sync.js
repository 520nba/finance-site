
const secret = process.env.CRON_SECRET || "";
const baseUrl = "https://stock-tracker.380220.xyz"; // Adjust if needed

async function test() {
    console.log("Triggering Daily Re-queue...");
    const resDaily = await fetch(`${baseUrl}/api/cron/daily?token=${secret}`);
    console.log("Daily Result:", await resDaily.text());

    console.log("Triggering Sync...");
    const resSync = await fetch(`${baseUrl}/api/cron/sync?token=${secret}`);
    console.log("Sync Result:", await resSync.text());
}

test();
