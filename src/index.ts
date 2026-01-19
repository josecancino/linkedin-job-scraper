import { LinkedInScraper } from './scraper';
import * as dotenv from 'dotenv';

dotenv.config();

(async () => {
    const scraper = new LinkedInScraper();
    await scraper.init();

    try {
        if (process.env.GMAIL_EMAIL && process.env.GMAIL_PASSWORD) {
            await scraper.login(process.env.GMAIL_EMAIL, process.env.GMAIL_PASSWORD);
        } else if (process.env.LINKEDIN_EMAIL && process.env.LINKEDIN_PASSWORD) {
            await scraper.login(process.env.LINKEDIN_EMAIL, process.env.LINKEDIN_PASSWORD);
        } else {
            console.warn("No credentials found in .env, running in public mode (limited results)");
        }

        console.log("Starting scrape...");
        // Broader search to test pagination
        const jobs = await scraper.scrape('Software Engineer', 'Spain', 10);
        console.log(`Found ${jobs.length} jobs.`);

        // Save to file
        const fs = require('fs');
        fs.writeFileSync('jobs.json', JSON.stringify(jobs, null, 2));
        console.log("Saved results to jobs.json");

        console.log("First job preview:");
        console.log(JSON.stringify(jobs[0], null, 2));
    } catch (error) {
        console.error("Error scraping:", error);
    } finally {
        await scraper.close();
    }
})();
